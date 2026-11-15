//! NestJS guards registered on the application (`app.useGlobalGuards(...)`), and the
//! route metadata a guard class consults before it checks (`@Public()`).
//!
//! Both are read by the practice map and `drift security` only: a registration
//! becomes an entry of each route's `app_middleware`, and what a decorator sets or
//! a guard lets through becomes a control of the listed reading
//! ([`RawSymbol::nest_metadata`]). Mining reads neither.

use super::*;

/// One guard `useGlobalGuards(...)` registers on a Nest application
/// ([`RawFile::nest_global_guards`]).
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawGlobalGuard {
    /// The class built where it is given (`new JwtAuthGuard(reflector)`). None for
    /// any other argument: a variable, the result of a call (`makeGuard()`,
    /// `app.get(JwtAuthGuard)`), a class that is itself the result of a call (`new
    /// (AuthGuard("jwt"))()`), a spread.
    pub guard: Option<RawRef>,
    /// The call stands under a condition, in a loop, in a `catch`, or after a
    /// return or a throw some calls of its function take; or it is not made on a
    /// binding the same function initialised with `NestFactory.create(...)`.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub conditional: bool,
    /// Where it is written, for saying so: `app.useGlobalGuards`.
    pub at: String,
    /// With no [`Self::guard`]: a binding listed among a `@Module`'s providers that
    /// this file does not show to be a class (`providers: [authGuardProvider]`,
    /// imported). Linking reads it as no provider of a guard where it names a class
    /// of the repository, or an export of one of Nest's own packages
    /// (`@nestjs/*`, which export no provider object); anything else may be an
    /// `APP_GUARD` provider and is not read. TypeScript lowering 71.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unless_class: Option<RawRef>,
}

/// Finds every `<application>.useGlobalGuards(...)` of the file.
struct GlobalGuards<'l, 's> {
    l: &'l mut Lowerer<'s>,
    /// Under a condition, in a loop or in a `catch`.
    branches: u32,
    /// For the module and each function being walked, innermost last: a return or a
    /// throw that only some calls take was passed.
    left: Vec<bool>,
    /// For the module and each function being walked, innermost last: the bindings
    /// it initialised with the application `NestFactory.create(...)` built.
    created: Vec<BTreeSet<String>>,
    /// The callback of `NestFactory.create(...).then((app) => ...)`: where it
    /// starts, and the parameter that is the application.
    then: Option<(u32, String)>,
    /// For each function being walked, innermost last: its name and its
    /// parameters, where it is a declaration with plain parameters.
    named: Vec<Option<(String, Vec<String>)>>,
    /// Guards registered on a parameter of a declared function: the function, the
    /// parameter's place, and the guard as it reads where the function is called
    /// with the application.
    on_param: Vec<(String, usize, RawGlobalGuard)>,
    /// Calls that hand an application the calling function built to a function,
    /// for every start: the callee and the argument's place.
    handed: BTreeSet<(String, usize)>,
}

/// `NestFactory.create(...)`, `NestFactory.createMicroservice(...)`: a call that
/// builds an application that serves. Not `createApplicationContext`, which serves
/// nothing.
fn creates_application(e: &Expression) -> bool {
    matches!(peel(e), Expression::CallExpression(c)
        if matches!(unwrap_expr(&c.callee), Expression::StaticMemberExpression(m)
            if matches!(unwrap_expr(&m.object), Expression::Identifier(id) if id.name == "NestFactory")
                && matches!(m.property.name.as_str(), "create" | "createMicroservice")))
}

impl GlobalGuards<'_, '_> {
    fn branch<F: FnOnce(&mut Self)>(&mut self, walk: F) {
        self.branches += 1;
        walk(self);
        self.branches -= 1;
    }

    fn leaves(&mut self) {
        if self.branches > 0
            && let Some(l) = self.left.last_mut()
        {
            *l = true;
        }
    }
}

impl<'a> Visit<'a> for GlobalGuards<'_, '_> {
    fn visit_function(&mut self, it: &Function<'a>, flags: oxc_semantic::ScopeFlags) {
        self.left.push(false);
        self.created.push(BTreeSet::new());
        if let Some((_, app)) = self.then.take_if(|(at, _)| *at == it.span.start)
            && let Some(top) = self.created.last_mut()
        {
            top.insert(app);
        }
        self.named.push(it.id.as_ref().map(|id| {
            let params = it
                .params
                .items
                .iter()
                .map(|p| match &p.pattern {
                    BindingPattern::BindingIdentifier(id) => id.name.to_string(),
                    _ => String::new(),
                })
                .collect();
            (id.name.to_string(), params)
        }));
        walk::walk_function(self, it, flags);
        self.named.pop();
        self.created.pop();
        self.left.pop();
    }

    fn visit_arrow_function_expression(&mut self, it: &ArrowFunctionExpression<'a>) {
        self.left.push(false);
        self.created.push(BTreeSet::new());
        if let Some((_, app)) = self.then.take_if(|(at, _)| *at == it.span.start)
            && let Some(top) = self.created.last_mut()
        {
            top.insert(app);
        }
        self.named.push(None);
        walk::walk_arrow_function_expression(self, it);
        self.named.pop();
        self.created.pop();
        self.left.pop();
    }

    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        if let Some(init) = &it.init
            && creates_application(init)
            && let BindingPattern::BindingIdentifier(id) = &it.id
            && let Some(top) = self.created.last_mut()
        {
            top.insert(id.name.to_string());
        }
        walk::walk_variable_declarator(self, it);
    }

    fn visit_if_statement(&mut self, it: &IfStatement<'a>) {
        self.branch(|v| walk::walk_if_statement(v, it));
    }

    fn visit_conditional_expression(&mut self, it: &ConditionalExpression<'a>) {
        self.branch(|v| walk::walk_conditional_expression(v, it));
    }

    fn visit_logical_expression(&mut self, it: &LogicalExpression<'a>) {
        self.branch(|v| walk::walk_logical_expression(v, it));
    }

    fn visit_for_statement(&mut self, it: &ForStatement<'a>) {
        self.branch(|v| walk::walk_for_statement(v, it));
    }

    fn visit_for_in_statement(&mut self, it: &ForInStatement<'a>) {
        self.branch(|v| walk::walk_for_in_statement(v, it));
    }

    fn visit_for_of_statement(&mut self, it: &ForOfStatement<'a>) {
        self.branch(|v| walk::walk_for_of_statement(v, it));
    }

    fn visit_while_statement(&mut self, it: &WhileStatement<'a>) {
        self.branch(|v| walk::walk_while_statement(v, it));
    }

    fn visit_do_while_statement(&mut self, it: &DoWhileStatement<'a>) {
        self.branch(|v| walk::walk_do_while_statement(v, it));
    }

    fn visit_switch_statement(&mut self, it: &SwitchStatement<'a>) {
        self.branch(|v| walk::walk_switch_statement(v, it));
    }

    fn visit_catch_clause(&mut self, it: &CatchClause<'a>) {
        self.branch(|v| walk::walk_catch_clause(v, it));
    }

    fn visit_return_statement(&mut self, it: &ReturnStatement<'a>) {
        walk::walk_return_statement(self, it);
        self.leaves();
    }

    fn visit_throw_statement(&mut self, it: &ThrowStatement<'a>) {
        walk::walk_throw_statement(self, it);
        self.leaves();
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if let Expression::StaticMemberExpression(m) = unwrap_expr(&it.callee)
            && m.property.name == "useGlobalGuards"
        {
            let at = match unwrap_expr(&m.object) {
                Expression::Identifier(id) => format!("{}.useGlobalGuards", id.name),
                _ => "useGlobalGuards".to_string(),
            };
            // On the application this function built: a helper that is handed
            // one registers the guard for the applications it is called with,
            // which is not read.
            let on_created = matches!(unwrap_expr(&m.object), Expression::Identifier(id)
                if self.created.last().is_some_and(|c| c.contains(id.name.as_str())));
            let branched = self.branches > 0 || self.left.iter().any(|l| *l);
            let conditional = branched || !on_created;
            // On a parameter of a declared function: decided by its calls.
            let on_param = match (unwrap_expr(&m.object), self.named.last()) {
                (Expression::Identifier(id), Some(Some((function, params)))) if !on_created => {
                    params
                        .iter()
                        .position(|p| p == id.name.as_str())
                        .map(|at| (function.clone(), at))
                }
                _ => None,
            };
            for a in &it.arguments {
                // Only a class named where it is built is one whose body is the
                // guard's: `new JwtAuthGuard()`, `new guards.JwtAuthGuard()`.
                let guard = match a.as_expression().map(unwrap_expr) {
                    Some(Expression::NewExpression(n))
                        if matches!(
                            unwrap_expr(&n.callee),
                            Expression::Identifier(_) | Expression::StaticMemberExpression(_)
                        ) =>
                    {
                        self.l.canon(&n.callee).filter(|r| !r.member.contains('('))
                    }
                    _ => None,
                };
                if let Some((function, place)) = &on_param {
                    self.on_param.push((
                        function.clone(),
                        *place,
                        RawGlobalGuard {
                            guard,
                            conditional: branched,
                            at: at.clone(),
                            unless_class: None,
                        },
                    ));
                    continue;
                }
                let guard = RawGlobalGuard {
                    guard,
                    conditional,
                    at: at.clone(),
                    unless_class: None,
                };
                if !self.l.out.nest_global_guards.contains(&guard) {
                    self.l.out.nest_global_guards.push(guard);
                }
            }
        }
        // `secure(app)`: the application this function built, handed on for
        // every start.
        if let Expression::Identifier(f) = unwrap_expr(&it.callee)
            && self.branches == 0
            && !self.left.iter().any(|l| *l)
        {
            for (at, a) in it.arguments.iter().enumerate() {
                if let Some(Expression::Identifier(id)) = a.as_expression().map(unwrap_expr)
                    && self
                        .created
                        .last()
                        .is_some_and(|c| c.contains(id.name.as_str()))
                {
                    self.handed.insert((f.name.to_string(), at));
                }
            }
        }
        // `NestFactory.create(AppModule).then((app) => { ... })`.
        if let Expression::StaticMemberExpression(m) = unwrap_expr(&it.callee)
            && m.property.name == "then"
            && creates_application(&m.object)
            && let Some(f) = it.arguments.first().and_then(|a| a.as_expression())
        {
            let (at, params) = match unwrap_expr(f) {
                Expression::ArrowFunctionExpression(a) => (a.span.start, Some(&a.params)),
                Expression::FunctionExpression(a) => (a.span.start, Some(&a.params)),
                _ => (0, None),
            };
            if let Some(p) = params.and_then(|p| p.items.first())
                && let BindingPattern::BindingIdentifier(id) = &p.pattern
            {
                self.then = Some((at, id.name.to_string()));
            }
        }
        if matches!(unwrap_expr(&it.callee), Expression::StaticMemberExpression(m)
            if matches!(unwrap_expr(&m.object), Expression::Identifier(id) if id.name == "NestFactory")
                && matches!(m.property.name.as_str(), "create" | "createMicroservice"))
        {
            self.l.out.nest_creates += 1;
        }
        walk::walk_call_expression(self, it);
    }
}

/// Nest's `Reflector` methods that hand back one value for a key: what an opt-out
/// tests (`getAllAndMerge` and `getAll` hand back a list, which is always true).
const READS_ONE: &[&str] = &["get", "getAllAndOverride", "getMetadata"];

/// One read of route metadata: where the call starts, whether its result is one
/// value, and its key and where it is read off, where both are literal.
struct MetadataRead {
    start: u32,
    one: bool,
    read: Option<(&'static str, RawOperand)>,
}

impl Lowerer<'_> {
    /// The guards the file registers for a whole Nest application
    /// ([`RawFile::nest_global_guards`]).
    pub(super) fn lower_nest_global_guards(&mut self, program: &Program) {
        let mut v = GlobalGuards {
            l: self,
            branches: 0,
            left: vec![false],
            created: vec![BTreeSet::new()],
            then: None,
            named: Vec::new(),
            on_param: Vec::new(),
            handed: BTreeSet::new(),
        };
        v.visit_program(program);
        // A helper handed the application its caller built registers for it.
        let GlobalGuards {
            on_param, handed, ..
        } = v;
        for (function, at, mut guard) in on_param {
            guard.conditional |= !handed.contains(&(function, at));
            if !self.out.nest_global_guards.contains(&guard) {
                self.out.nest_global_guards.push(guard);
            }
        }
    }

    fn imports_nest(&self) -> bool {
        self.out
            .imports
            .iter()
            .any(|i| i.spec.starts_with("@nestjs/"))
    }

    /// A metadata key as a control writes it: the text in double quotes, or the
    /// binding that holds it.
    fn metadata_key(&self, e: &Expression) -> Option<RawOperand> {
        match unwrap_expr(e) {
            Expression::StringLiteral(l) => Some(RawOperand::Text(format!("\"{}\"", lit(l)))),
            x @ (Expression::Identifier(_) | Expression::StaticMemberExpression(_)) => self
                .canon(x)
                .filter(|r| !r.member.contains('(') && !matches!(r.base, RawBase::Global(_)))
                .map(RawOperand::Ref),
            _ => None,
        }
    }

    /// `SetMetadata(KEY, value)` of `@nestjs/common`: the start of its control
    /// ([`drift_core::controls::SETS_METADATA`], with `~` where the value is not a
    /// literal that is true of every route the decorator is written on) and the
    /// key, `?` where the key is no literal.
    fn sets_metadata(&self, c: &CallExpression) -> Option<(String, RawOperand)> {
        let r = self.canon_callee(&c.callee)?;
        let sets = matches!(&r.base, RawBase::Import { spec, name }
            if spec == "@nestjs/common" && name == "SetMetadata")
            && r.member.is_empty();
        if !sets {
            return None;
        }
        let arg = |i: usize| c.arguments.get(i).and_then(|a| a.as_expression());
        let truthy = arg(1).is_some_and(|v| match unwrap_expr(v) {
            Expression::BooleanLiteral(b) => b.value,
            Expression::StringLiteral(s) => !s.value.is_empty(),
            Expression::NumericLiteral(n) => n.value != 0.0,
            Expression::ObjectExpression(_) | Expression::ArrayExpression(_) => true,
            _ => false,
        });
        let sets = drift_core::controls::SETS_METADATA;
        Some(match arg(0).and_then(|k| self.metadata_key(k)) {
            Some(key) if truthy => (sets.to_string(), key),
            Some(key) => (format!("{sets}~"), key),
            None => (sets.to_string(), RawOperand::Text("?".into())),
        })
    }

    /// What `@SetMetadata(KEY, value)` written on a handler or on a class sets
    /// ([`Lowerer::sets_metadata`]), for the route's or the class's own symbol.
    pub(super) fn direct_metadata(&self, decorators: &[Decorator]) -> Vec<(String, RawOperand)> {
        let mut out = Vec::new();
        for d in decorators {
            if let Expression::CallExpression(c) = unwrap_expr(&d.expression)
                && let Some(entry) = self.sets_metadata(c)
                && !out.contains(&entry)
            {
                out.push(entry);
            }
        }
        out
    }

    /// `Reflector.createDecorator()` of `@nestjs/core`: the decorator it builds is
    /// its own key, and sets what each use passes.
    fn creates_decorator(&self, e: &Expression) -> bool {
        matches!(peel(e), Expression::CallExpression(c)
        if self.canon_callee(&c.callee).is_some_and(|r| {
            matches!(&r.base, RawBase::Import { spec, name }
                if spec == "@nestjs/core" && name == "Reflector")
                && r.member == ".createDecorator"
        }))
    }

    /// The route metadata the top-level functions and values of the file set
    /// ([`drift_core::controls::SETS_METADATA`]), on their symbols.
    pub(super) fn lower_nest_metadata(&mut self, program: &Program) {
        if !self.imports_nest() {
            return;
        }
        let mut found: Vec<(String, Vec<(String, RawOperand)>)> = Vec::new();
        let mut keys_of = |l: &Self, name: &str, walk: &dyn Fn(&mut SetsMetadata)| {
            let mut v = SetsMetadata {
                l,
                keys: Vec::new(),
            };
            walk(&mut v);
            if !v.keys.is_empty() {
                found.push((name.to_string(), v.keys));
            }
        };
        for stmt in &program.body {
            let decl = match stmt {
                Statement::ExportDefaultDeclaration(e) => {
                    if let ExportDefaultDeclarationKind::FunctionDeclaration(f) = &e.declaration {
                        let name =
                            f.id.as_ref()
                                .map_or_else(|| "default".to_string(), |i| i.name.to_string());
                        keys_of(self, &name, &|v| {
                            v.visit_function(f, oxc_semantic::ScopeFlags::Function)
                        });
                    }
                    continue;
                }
                Statement::ExportDeclaration(e) => Some(&e.declaration),
                s => s.as_declaration(),
            };
            match decl {
                Some(Declaration::FunctionDeclaration(f)) => {
                    if let Some(id) = &f.id {
                        keys_of(self, &id.name, &|v| {
                            v.visit_function(f, oxc_semantic::ScopeFlags::Function)
                        });
                    }
                }
                Some(Declaration::VariableDeclaration(d)) => {
                    for d in &d.declarations {
                        if let (BindingPattern::BindingIdentifier(id), Some(init)) =
                            (&d.id, &d.init)
                        {
                            keys_of(self, &id.name, &|v| {
                                if v.l.creates_decorator(init) {
                                    v.keys.push((
                                        format!("{}~", drift_core::controls::SETS_METADATA),
                                        RawOperand::Ref(RawRef {
                                            base: RawBase::Local(id.name.to_string()),
                                            member: String::new(),
                                        }),
                                    ));
                                }
                                v.visit_expression(init)
                            });
                        }
                    }
                }
                _ => {}
            }
        }
        for (name, keys) in found {
            if let Some(sym) = self
                .out
                .symbols
                .iter_mut()
                .find(|s| s.name == name && s.kind != SymbolKind::Class)
            {
                for entry in keys {
                    if !sym.nest_metadata.contains(&entry) {
                        sym.nest_metadata.push(entry);
                    }
                }
            }
        }
    }

    /// A call that reads route metadata: `this.reflector.get(KEY, context.getHandler())`,
    /// `getAllAndOverride(KEY, [context.getHandler(), context.getClass()])`,
    /// `getAllAndMerge`, `Reflect.getMetadata(KEY, context.getHandler())`.
    fn metadata_read(&self, c: &CallExpression) -> Option<MetadataRead> {
        let Expression::StaticMemberExpression(m) = unwrap_expr(&c.callee) else {
            return None;
        };
        let method = m.property.name.as_str();
        let reflector = || {
            let typed = self.canon(&m.object).is_some_and(|r| {
                matches!(&r.base, RawBase::Import { spec, name }
                    if spec == "@nestjs/core" && name == "Reflector")
            });
            // With no type to say so (JavaScript), the name it is held under.
            let named = match unwrap_expr(&m.object) {
                Expression::StaticMemberExpression(p) => p.property.name.as_str(),
                Expression::Identifier(id) => id.name.as_str(),
                _ => "",
            };
            typed || named.to_ascii_lowercase().contains("reflector")
        };
        let reads = match method {
            "getAllAndOverride" | "getAllAndMerge" => true,
            "get" | "getAll" => reflector(),
            "getMetadata" | "getOwnMetadata" => {
                matches!(unwrap_expr(&m.object), Expression::Identifier(id) if id.name == "Reflect")
            }
            _ => false,
        };
        if !reads {
            return None;
        }
        let arg = |i: usize| c.arguments.get(i).and_then(|a| a.as_expression());
        let target = |e: &Expression| -> Option<(bool, bool)> {
            let Expression::CallExpression(t) = unwrap_expr(e) else {
                return None;
            };
            match call_name(&t.callee) {
                Some("getHandler") => Some((true, false)),
                Some("getClass") => Some((false, true)),
                _ => None,
            }
        };
        let targets = arg(1).and_then(|e| match unwrap_expr(e) {
            Expression::ArrayExpression(a) => {
                a.elements.iter().try_fold((false, false), |(h, c), el| {
                    let (eh, ec) = target(el.as_expression()?)?;
                    Some((h || eh, c || ec))
                })
            }
            x => target(x),
        });
        let read = match (targets, arg(0).and_then(|k| self.metadata_key(k))) {
            (Some((true, true)), Some(k)) => Some(("any", k)),
            (Some((true, false)), Some(k)) => Some(("handler", k)),
            (Some((false, true)), Some(k)) => Some(("class", k)),
            _ => None,
        };
        Some(MetadataRead {
            start: c.span.start,
            one: READS_ONE.contains(&method),
            read,
        })
    }

    /// What a guard class consults of the route it runs for
    /// ([`RawSymbol::nest_metadata`]): for each metadata key whose presence makes
    /// `canActivate` let the request through before anything else
    /// ([`drift_core::controls::OPENS_FOR_METADATA`]), where it is read and the key;
    /// and [`drift_core::controls::METADATA_UNREAD`] where the class reads metadata
    /// in any other way, or hands its execution context to code of the repository.
    ///
    /// The opt-out is read only in this shape, at the top of `canActivate`: the
    /// declarations of what the context gives, `const x = <read>`, and `if (x)
    /// return true;` (or `if (<read>) return true;`).
    pub(super) fn nest_guard_metadata(&self, class: &Class) -> Vec<(String, RawOperand)> {
        let mut out: Vec<(String, RawOperand)> = Vec::new();
        let can_activate = class.body.body.iter().find_map(|el| match el {
            ClassElement::MethodDefinition(m)
                if key_name(&m.key).as_deref() == Some("canActivate") =>
            {
                Some(&m.value)
            }
            _ => None,
        });
        let context = can_activate
            .and_then(|f| f.params.items.first())
            .and_then(|p| match &p.pattern {
                BindingPattern::BindingIdentifier(id) => Some(id.name.to_string()),
                _ => None,
            });
        let mut consumed: HashSet<u32> = HashSet::new();
        if let Some(body) = can_activate.and_then(|f| f.body.as_deref()) {
            // Locals bound to one metadata value, by name.
            let mut bound: HashMap<&str, (u32, &'static str, RawOperand)> = HashMap::new();
            let readable = |e: &Expression| -> Option<(u32, &'static str, RawOperand)> {
                let Expression::CallExpression(c) = peel(e) else {
                    return None;
                };
                let r = self.metadata_read(c).filter(|r| r.one)?;
                let (target, key) = r.read?;
                Some((r.start, target, key))
            };
            for st in &body.statements {
                match st {
                    Statement::VariableDeclaration(v) => {
                        let mut plain = true;
                        for d in &v.declarations {
                            let Some(init) = &d.init else { continue };
                            if let (BindingPattern::BindingIdentifier(id), Some(read)) =
                                (&d.id, readable(init))
                            {
                                bound.insert(id.name.as_str(), read);
                            } else if !chain_root_ident(init)
                                .is_some_and(|r| Some(r.name.as_str()) == context.as_deref())
                            {
                                plain = false;
                            }
                        }
                        if !plain {
                            break;
                        }
                    }
                    Statement::IfStatement(i) if i.alternate.is_none() => {
                        let returns_true = |s: &Statement| {
                            matches!(s, Statement::ReturnStatement(r)
                                if matches!(r.argument.as_ref().map(unwrap_expr),
                                    Some(Expression::BooleanLiteral(b)) if b.value))
                        };
                        let opens = match &i.consequent {
                            Statement::BlockStatement(b) => {
                                matches!(b.body.as_slice(), [one] if returns_true(one))
                            }
                            s => returns_true(s),
                        };
                        // `if (x)`, `if (x === true)`.
                        let test = match unwrap_expr(&i.test) {
                            Expression::BinaryExpression(b)
                                if matches!(
                                    b.operator,
                                    BinaryOperator::StrictEquality | BinaryOperator::Equality
                                ) && matches!(unwrap_expr(&b.right),
                                    Expression::BooleanLiteral(t) if t.value) =>
                            {
                                unwrap_expr(&b.left)
                            }
                            t => t,
                        };
                        let read = match test {
                            Expression::Identifier(id) => bound.remove(id.name.as_str()),
                            t => readable(t),
                        };
                        let (true, Some((start, target, key))) = (opens, read) else {
                            break;
                        };
                        consumed.insert(start);
                        let entry = (
                            format!("{}{target}:", drift_core::controls::OPENS_FOR_METADATA),
                            key,
                        );
                        if !out.contains(&entry) {
                            out.push(entry);
                        }
                    }
                    _ => break,
                }
            }
        }
        let mut uses = MetadataUses {
            l: self,
            context: context.as_deref(),
            consumed: &consumed,
            unread: false,
        };
        uses.visit_class(class);
        if uses.unread {
            out.push((
                drift_core::controls::METADATA_UNREAD.to_string(),
                RawOperand::None,
            ));
        }
        out
    }
}

/// Finds the `SetMetadata(...)` calls of a function or a value
/// ([`Lowerer::sets_metadata`]).
struct SetsMetadata<'l, 's> {
    l: &'l Lowerer<'s>,
    keys: Vec<(String, RawOperand)>,
}

impl<'a> Visit<'a> for SetsMetadata<'_, '_> {
    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if let Some(k) = self.l.sets_metadata(it)
            && !self.keys.contains(&k)
        {
            self.keys.push(k);
        }
        walk::walk_call_expression(self, it);
    }
}

/// Finds what a guard class does with route metadata that
/// [`Lowerer::nest_guard_metadata`] did not read as an opt-out.
struct MetadataUses<'c, 'l, 's> {
    l: &'l Lowerer<'s>,
    /// The name of `canActivate`'s execution context.
    context: Option<&'c str>,
    /// The reads an opt-out tests, by where they start.
    consumed: &'c HashSet<u32>,
    unread: bool,
}

impl<'a> Visit<'a> for MetadataUses<'_, '_, '_> {
    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        match self.l.metadata_read(it) {
            Some(r) => self.unread |= !self.consumed.contains(&r.start),
            None => {
                // The context, or the reflector, handed to what is not Nest's own:
                // what that reads of the route is not read here.
                let hands_on =
                    it.arguments
                        .iter()
                        .any(|a| match a.as_expression().map(unwrap_expr) {
                            Some(Expression::Identifier(id)) => {
                                Some(id.name.as_str()) == self.context
                            }
                            Some(x @ Expression::StaticMemberExpression(_)) => {
                                self.l.canon(x).is_some_and(|r| {
                                    matches!(&r.base, RawBase::Import { spec, name }
                                    if spec == "@nestjs/core" && name == "Reflector")
                                        && r.member.is_empty()
                                })
                            }
                            _ => false,
                        });
                let nests_own = matches!(unwrap_expr(&it.callee),
                    Expression::StaticMemberExpression(m) if matches!(unwrap_expr(&m.object), Expression::Super(_)))
                    || self.l.canon_callee(&it.callee).is_some_and(|r| {
                        matches!(&r.base, RawBase::Import { spec, .. } if spec.starts_with("@nestjs/"))
                    });
                self.unread |= hands_on && !nests_own;
            }
        }
        walk::walk_call_expression(self, it);
    }
}
