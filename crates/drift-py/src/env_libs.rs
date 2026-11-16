//! Environment reads through a configuration library (Python lowering 75):
//! python-decouple (`config("NAME")`, an instance of `Config` or `AutoConfig`),
//! environs (`env = Env()`, `env("NAME")`, `env.int("NAME")`, under `with
//! env.prefixed("APP_"):`), django-environ (`env = environ.Env()`, `env("NAME")`,
//! `env.db("DATABASE_URL")`) and the fields of a pydantic `BaseSettings` class, with
//! its `env_prefix`. Each is keyed on the library's package and its documented API.
//!
//! The fact is the one an `os.environ` read gives, written under the library's import
//! name (`decouple.SECRET_KEY`, `environs.PORT`, `environ.DATABASE_URL`,
//! `pydantic_settings.APP_DATABASE_URL`) so that it is never taken for reading
//! `os.environ` directly. Where the name, or a prefix the API applies to it, is not
//! a literal Drift reads, nothing is recorded, as for `os.environ.get(name)`.
//!
//! Mining is frozen: these reads are kept apart ([`crate::raw::RawSymbol::since_reads`])
//! and linked into the listed reading only, which `drift security` and the practice
//! map read ([`drift_core::Listed`]).

use super::*;

/// The libraries whose objects read the environment, by the import name their
/// facts are written under.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EnvLib {
    Decouple,
    Environs,
    DjangoEnviron,
}

impl EnvLib {
    fn form(self) -> &'static str {
        match self {
            EnvLib::Decouple => "decouple",
            EnvLib::Environs => "environs",
            EnvLib::DjangoEnviron => "environ",
        }
    }

    /// The library's class whose instance reads the environment, by its dotted path.
    fn of_class(dotted: &str) -> Option<Self> {
        match dotted {
            "decouple.Config" | "decouple.AutoConfig" => Some(EnvLib::Decouple),
            "environs.Env" => Some(EnvLib::Environs),
            "environ.Env" | "environ.FileAwareEnv" | "environ.environ.Env" => {
                Some(EnvLib::DjangoEnviron)
            }
            _ => None,
        }
    }

    /// A documented method of the instance that reads one variable, named by its
    /// first argument ("" is a call of the instance itself).
    fn reads_with(self, method: &str) -> bool {
        match self {
            EnvLib::Decouple => method.is_empty(),
            EnvLib::Environs => matches!(
                method,
                "" | "str"
                    | "int"
                    | "bool"
                    | "float"
                    | "decimal"
                    | "list"
                    | "dict"
                    | "json"
                    | "datetime"
                    | "date"
                    | "time"
                    | "timedelta"
                    | "url"
                    | "uuid"
                    | "log_level"
                    | "path"
                    | "enum"
            ),
            EnvLib::DjangoEnviron => matches!(
                method,
                "" | "str"
                    | "bytes"
                    | "bool"
                    | "int"
                    | "float"
                    | "json"
                    | "list"
                    | "tuple"
                    | "dict"
                    | "url"
                    | "db_url"
                    | "db"
                    | "cache_url"
                    | "cache"
                    | "email_url"
                    | "email"
                    | "search_url"
                    | "path"
                    | "get_value"
            ),
        }
    }
}

/// A module-level name bound to an env reader, and whether the prefix its reads
/// take is known: `None` where it is set in a way Drift does not read (environs'
/// `Env(prefix=...)`, django-environ's `env.prefix = ...`), and its reads are then
/// not recorded.
#[derive(Debug, Clone, Default)]
pub(crate) struct EnvTables {
    objects: BTreeMap<String, (EnvLib, bool)>,
    /// `with env.prefixed(P):` blocks of an environs reader: the statement's range,
    /// the reader's name and the prefix (`None`: not a literal).
    prefixed: Vec<(ruff_text_size::TextRange, String, Option<String>)>,
}

/// The pydantic settings classes' base, by dotted path, and the import name their
/// reads are written under.
fn settings_base(dotted: &str) -> Option<&'static str> {
    match dotted {
        "pydantic_settings.BaseSettings" | "pydantic_settings.main.BaseSettings" => {
            Some("pydantic_settings")
        }
        "pydantic.BaseSettings"
        | "pydantic.v1.BaseSettings"
        | "pydantic.env_settings.BaseSettings" => Some("pydantic"),
        _ => None,
    }
}

impl Lowerer<'_> {
    /// The module's env readers ([`EnvTables`]): a name bound once at module level
    /// to an instance of a library's reader class, and the `with env.prefixed(...)`
    /// blocks anywhere in the file.
    pub(crate) fn collect_env_libraries(&mut self, body: &[Stmt]) {
        let mut seen: BTreeMap<String, u32> = BTreeMap::new();
        let mut objects = BTreeMap::new();
        for s in body {
            let targets: Vec<&Expr> = match s {
                Stmt::Assign(a) => a.targets.iter().collect(),
                Stmt::AnnAssign(a) => vec![a.target.as_ref()],
                Stmt::FunctionDef(f) => {
                    *seen.entry(f.name.to_string()).or_default() += 1;
                    continue;
                }
                Stmt::ClassDef(c) => {
                    *seen.entry(c.name.to_string()).or_default() += 1;
                    continue;
                }
                _ => continue,
            };
            for t in &targets {
                if let Expr::Name(n) = t {
                    *seen.entry(n.id.to_string()).or_default() += 1;
                }
            }
            let value = match s {
                Stmt::Assign(a) => Some(a.value.as_ref()),
                Stmt::AnnAssign(a) => a.value.as_deref(),
                _ => None,
            };
            if let ([Expr::Name(n)], Some(Expr::Call(c))) = (targets.as_slice(), value)
                && let Some(lib) = self
                    .canon(&c.func)
                    .as_ref()
                    .and_then(dotted)
                    .as_deref()
                    .and_then(EnvLib::of_class)
            {
                // environs' `prefix` argument is not read: the reads are not recorded.
                let known = !(lib == EnvLib::Environs && keyword(c, "prefix").is_some());
                objects.insert(n.id.to_string(), (lib, known));
            }
        }
        objects.retain(|name, _| seen.get(name).is_some_and(|n| *n == 1));
        if objects.is_empty() {
            return;
        }
        struct Find<'o> {
            objects: &'o mut BTreeMap<String, (EnvLib, bool)>,
            prefixed: Vec<(ruff_text_size::TextRange, String, Option<String>)>,
        }
        impl<'a> Visitor<'a> for Find<'_> {
            fn visit_stmt(&mut self, s: &'a Stmt) {
                match s {
                    // django-environ's `env.prefix = "APP_"` sets the prefix of every
                    // read after it: which reads it is in front of is not followed.
                    Stmt::Assign(a) => {
                        for t in &a.targets {
                            if let Expr::Attribute(x) = t
                                && x.attr.as_str() == "prefix"
                                && let Expr::Name(n) = x.value.as_ref()
                                && let Some((EnvLib::DjangoEnviron, known)) =
                                    self.objects.get_mut(n.id.as_str())
                            {
                                *known = false;
                            }
                        }
                    }
                    Stmt::With(w) => {
                        for item in &w.items {
                            if let Expr::Call(c) = &item.context_expr
                                && let Expr::Attribute(x) = c.func.as_ref()
                                && x.attr.as_str() == "prefixed"
                                && let Expr::Name(n) = x.value.as_ref()
                                && matches!(
                                    self.objects.get(n.id.as_str()),
                                    Some((EnvLib::Environs, _))
                                )
                            {
                                let prefix = match &*c.arguments.args {
                                    [p] if c.arguments.keywords.is_empty() => string_value(p),
                                    _ => None,
                                };
                                self.prefixed.push((w.range(), n.id.to_string(), prefix));
                            }
                        }
                    }
                    _ => {}
                }
                visitor::walk_stmt(self, s);
            }
        }
        let mut find = Find {
            objects: &mut objects,
            prefixed: Vec::new(),
        };
        for s in body {
            find.visit_stmt(s);
        }
        let mut prefixed = find.prefixed;
        prefixed.sort_by_key(|(r, _, _)| r.start());
        self.env_libs = EnvTables { objects, prefixed };
    }

    /// The variable a call reads through a configuration library, as
    /// `<library>.<NAME>`: `decouple.config("X")`, a call of a reader instance
    /// (`env("X")`, `config("X")`) or of one of its documented typed methods
    /// (`env.int("X")`, `env.db("X")`), with the environs prefixes of the blocks
    /// it is in. `None` where the name or a prefix is not a literal Drift reads.
    pub(crate) fn env_library_read(&self, col: &Collector, c: &ast::ExprCall) -> Option<String> {
        let r = col.canon(&c.func)?;
        let (lib, object) = match &r.base {
            RawBase::Import { .. } if dotted(&r).as_deref() == Some("decouple.config") => {
                (EnvLib::Decouple, None)
            }
            RawBase::Local(name) => {
                let (lib, known) = *self.env_libs.objects.get(name)?;
                let method = r.member.strip_prefix('.').unwrap_or(&r.member);
                if !known || !lib.reads_with(method) {
                    return None;
                }
                (lib, Some(name.as_str()))
            }
            _ => return None,
        };
        let first = c.arguments.args.first().filter(|a| !a.is_starred_expr())?;
        let key = self.env_key(col, first)?;
        let mut name = String::new();
        if lib == EnvLib::Environs
            && let Some(object) = object
        {
            let at = c.range().start();
            for (range, of, prefix) in &self.env_libs.prefixed {
                if of == object && range.contains(at) {
                    name.push_str(prefix.as_deref()?);
                }
            }
        }
        name.push_str(&key);
        Some(format!("{}.{name}", lib.form()))
    }

    /// The env variables each pydantic settings class of the module reads, added to
    /// its symbol's [`RawSymbol::since_reads`]: a class whose base is `BaseSettings`
    /// (pydantic-settings, or pydantic 1), one variable per annotated field, named
    /// by the field's literal alias (`Field(alias=...)`, `validation_alias`, or
    /// pydantic 1's `env=`) or by the field with the class's literal `env_prefix`
    /// (`model_config = SettingsConfigDict(env_prefix=...)`, the class's keyword,
    /// or pydantic 1's inner `class Config`), upper-cased unless the class sets
    /// `case_sensitive=True`. A prefix or a case setting that is not a literal, a
    /// configuration written another way, or an alias that is not a literal string,
    /// is not read: the class's (or the field's) variables are not recorded. Fields
    /// a base class of the repository declares are not followed.
    pub(crate) fn lower_settings_reads(&mut self, body: &[Stmt]) {
        let mut found: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for s in body {
            let Stmt::ClassDef(class) = s else {
                continue;
            };
            let Some(args) = class.arguments.as_deref() else {
                continue;
            };
            let Some(form) = args.args.iter().find_map(|b| {
                self.canon(b)
                    .as_ref()
                    .and_then(dotted)
                    .as_deref()
                    .and_then(settings_base)
            }) else {
                continue;
            };
            if let Some(reads) = settings_class_reads(class, args, form) {
                found.insert(class.name.to_string(), reads);
            }
        }
        if found.is_empty() {
            return;
        }
        for sym in &mut self.out.symbols {
            if sym.kind == SymbolKind::Class
                && let Some(reads) = found.remove(&sym.name)
            {
                sym.since_reads.extend(reads);
            }
        }
    }
}

/// What a settings class's configuration says of its variables' names.
struct NameRule {
    prefix: String,
    case_sensitive: bool,
}

impl NameRule {
    /// Reads `env_prefix` and `case_sensitive` from one setting; `false` where
    /// either is not a literal.
    fn set(&mut self, key: &str, value: &Expr) -> bool {
        match key {
            "env_prefix" => match string_value(value) {
                Some(p) => {
                    self.prefix = p;
                    true
                }
                None => false,
            },
            "case_sensitive" => match value {
                Expr::BooleanLiteral(b) => {
                    self.case_sensitive = b.value;
                    true
                }
                _ => false,
            },
            _ => true,
        }
    }

    /// Every setting of a configuration call or dict written in place.
    fn read(&mut self, value: &Expr) -> bool {
        match value {
            Expr::Call(c) => {
                c.arguments.args.is_empty()
                    && c.arguments.keywords.iter().all(|k| match &k.arg {
                        Some(a) => self.set(a.as_str(), &k.value),
                        None => false,
                    })
            }
            Expr::Dict(d) => d
                .items
                .iter()
                .all(|i| match i.key.as_ref().and_then(string_value) {
                    Some(k) => self.set(&k, &i.value),
                    None => false,
                }),
            _ => false,
        }
    }

    fn name(&self, field: &str) -> String {
        let n = format!("{}{field}", self.prefix);
        if self.case_sensitive {
            n
        } else {
            n.to_ascii_uppercase()
        }
    }
}

/// [`Lowerer::lower_settings_reads`] of one class; `None` where its configuration
/// is not read.
fn settings_class_reads(
    class: &ast::StmtClassDef,
    args: &ast::Arguments,
    form: &str,
) -> Option<Vec<String>> {
    let mut rule = NameRule {
        prefix: String::new(),
        case_sensitive: false,
    };
    for k in &args.keywords {
        if !rule.set(k.arg.as_ref()?.as_str(), &k.value) {
            return None;
        }
    }
    for s in &class.body {
        match s {
            Stmt::Assign(a)
                if a.targets
                    .iter()
                    .any(|t| matches!(t, Expr::Name(n) if n.id.as_str() == "model_config")) =>
            {
                if !rule.read(&a.value) {
                    return None;
                }
            }
            Stmt::AnnAssign(a) if matches!(a.target.as_ref(), Expr::Name(n) if n.id.as_str() == "model_config") => {
                if !rule.read(a.value.as_deref()?) {
                    return None;
                }
            }
            Stmt::ClassDef(inner) if inner.name.as_str() == "Config" => {
                for st in &inner.body {
                    if let Stmt::Assign(a) = st
                        && let [Expr::Name(n)] = a.targets.as_slice()
                        && !rule.set(n.id.as_str(), &a.value)
                    {
                        return None;
                    }
                }
            }
            _ => {}
        }
    }
    let mut out = Vec::new();
    for s in &class.body {
        let Stmt::AnnAssign(a) = s else {
            continue;
        };
        let Expr::Name(n) = a.target.as_ref() else {
            continue;
        };
        let field = n.id.as_str();
        if field.starts_with('_') || field == "model_config" || class_var(&a.annotation) {
            continue;
        }
        let alias = match a.value.as_deref() {
            Some(Expr::Call(c)) if super::practice::callee_name(&c.func) == Some("Field") => {
                ["validation_alias", "alias", "env"]
                    .iter()
                    .find_map(|k| keyword(c, k))
            }
            _ => None,
        };
        let name = match alias {
            // An alias is the variable's name, without the prefix.
            Some(alias) => match string_value(alias) {
                Some(alias) if rule.case_sensitive => alias,
                Some(alias) => alias.to_ascii_uppercase(),
                None => continue,
            },
            None => rule.name(field),
        };
        out.push(format!("{form}.{name}"));
    }
    Some(out)
}

/// `ClassVar[...]` (or `typing.ClassVar`): an attribute of the class, not a field.
fn class_var(annotation: &Expr) -> bool {
    let head = match annotation {
        Expr::Subscript(s) => s.value.as_ref(),
        e => e,
    };
    match head {
        Expr::Name(n) => n.id.as_str() == "ClassVar",
        Expr::Attribute(a) => a.attr.as_str() == "ClassVar",
        _ => false,
    }
}
