//! Parameter-type facts, part 1: the type declarations of one file.
//!
//! Lowered with the rest of the file, so they are cached by content hash. Only
//! the shapes the resolver in [`crate::typeres`] reads are kept: object types,
//! references to named types (with their type arguments), unions, intersections,
//! string literals and `undefined`. Everything else becomes [`TExpr::Other`]
//! (a type that is not an object and not `undefined`: `string`, a function, an
//! array) or [`TExpr::Unknown`] (a type Drift does not read: mapped,
//! conditional, indexed access, `typeof`, a name declared in a nested scope).
//!
//! This is not a type checker. It records declarations as written, and the
//! resolver answers only where the written declarations decide the answer.

use std::collections::BTreeMap;

use oxc_ast::ast::*;
use oxc_semantic::{Scoping, SymbolFlags};
use serde::{Deserialize, Serialize};

/// Deepest nesting of type expressions kept; deeper types are [`TExpr::Unknown`].
const MAX_TYPE_DEPTH: usize = 8;
/// Most properties kept per object type; a larger one is [`TExpr::Unknown`].
const MAX_PROPS: usize = 512;

/// The type declarations of one file.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RawTypes {
    /// Interfaces, type aliases and classes declared at the top level, by local name.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub decls: BTreeMap<String, TypeDecl>,
    /// Callables by local name: top-level functions, consts bound to a function or
    /// declared with a function type, and class methods as `Class.method`. `None`
    /// when the name has several call signatures (overloads) or a declared type that
    /// is not a function type.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub fns: BTreeMap<String, Option<FnSig>>,
    /// Exported name -> (specifier, imported name) for re-exports, type-only ones
    /// included (`export type { X } from "./x"`, `import { X } ...; export { X }`).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub reexports: BTreeMap<String, (String, String)>,
    /// Exported name -> local name, for local declarations exported under another name.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub aliases: BTreeMap<String, String>,
    /// `export * from "spec"` specifiers (value and type), sorted.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub star: Vec<String>,
    /// Local declarations exported under their own name. Only these (and
    /// [`RawTypes::aliases`]) answer for the module's exports: a declaration that is
    /// not exported does not shadow an `export *`.
    #[serde(default, skip_serializing_if = "std::collections::BTreeSet::is_empty")]
    pub exported: std::collections::BTreeSet<String>,
    /// A declaration file without export declarations: every top-level declaration
    /// is exported.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub all_exported: bool,
    /// Interfaces named in `declare module "…"` and `declare global` blocks. Such an
    /// augmentation can merge members (an index signature) into an interface of
    /// another module, so `Pick`/`Omit` over an interface of that name is unknown.
    #[serde(default, skip_serializing_if = "std::collections::BTreeSet::is_empty")]
    pub augments: std::collections::BTreeSet<String>,
}

/// A type parameter of a declaration, with its default (`<T = undefined>`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TParam {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<TExpr>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum TypeDecl {
    /// `type X<P> = ...`
    Alias { params: Vec<TParam>, ty: TExpr },
    /// `interface X<P> extends A, B { ... }` (merged declarations combined).
    Interface {
        params: Vec<TParam>,
        extends: Vec<TExpr>,
        body: ObjType,
    },
    /// A class used as a type: its instance members. `body` is `None` for a class
    /// with private or protected members (no object literal is assignable to it)
    /// or members Drift does not read.
    Class {
        params: Vec<TParam>,
        extends: Option<TExpr>,
        body: Option<ObjType>,
    },
    /// `enum X {}`: its members are never `undefined`, and it has no keys to pass.
    Enum,
    /// Declared more than once in ways Drift does not merge.
    Opaque,
}

/// An object type's properties. `open` when it has an index signature, so keys it
/// does not list are allowed too.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ObjType {
    pub props: BTreeMap<String, PropT>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub open: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PropT {
    /// Declared with `?`.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub optional: bool,
    pub ty: TExpr,
}

/// A reference to a named type before module resolution.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum TRef {
    /// Declared at the top level of this file.
    Local(String),
    /// Imported: `import { name } from "spec"` (`*` for a namespace, with `member`).
    Import {
        spec: String,
        name: String,
        /// `.X` for `ns.X` on a namespace import; empty otherwise.
        member: String,
    },
    /// Not declared in this file (TypeScript's lib or an ambient declaration).
    Global(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum TExpr {
    Object(ObjType),
    Ref {
        target: TRef,
        args: Vec<TExpr>,
    },
    /// A type parameter of the enclosing declaration.
    Param(String),
    Union(Vec<TExpr>),
    Intersection(Vec<TExpr>),
    /// A string literal type (keys of `Pick` and `Omit`).
    Str(String),
    /// `undefined` or `void`.
    Undefined,
    /// A type that is neither an object with listed keys nor `undefined`.
    Other,
    /// `any` (also an implicit `any`): absorbs both unions and intersections.
    Any,
    /// `unknown`: absorbs a union, and is the identity of an intersection.
    Top,
    /// A type Drift does not read.
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FnSig {
    pub params: Vec<ParamT>,
    /// Calling it returns a function ([`returns_function`]): its declared return type
    /// is a function type (`(o: Opts): (h: Handler) => Handler`, a `.d.ts`
    /// declaration included), or it is neither async nor a generator and every
    /// `return` of its own body hands back a function. A factory's product
    /// (`export const withAuth = createAuthWrapper(opts)`) is then a function.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub returns_function: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParamT {
    /// The declared type; `None` when the parameter has no annotation.
    pub ty: Option<TExpr>,
    /// `...rest`: this and every later argument index is not resolved.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub rest: bool,
    /// Top-level keys of an object destructuring pattern that have a default value
    /// (`{ a = 1 }`): optional for the caller whatever the declared type says.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub defaults: Vec<String>,
}

/// Record the type declarations of `program`.
/// `declaration_file` for `.d.ts` files, whose top-level declarations are all
/// exported unless the file says `export {}`.
pub fn lower_types(program: &Program, scoping: &Scoping, declaration_file: bool) -> RawTypes {
    let mut l = TypeLowerer {
        scoping,
        imports: BTreeMap::new(),
        out: RawTypes::default(),
        sigs: BTreeMap::new(),
    };
    for stmt in &program.body {
        if let Statement::ImportDeclaration(imp) = stmt {
            l.import(imp);
        }
    }
    for stmt in &program.body {
        l.statement(stmt);
    }
    // tsc's rule (the binder's export context): a declaration file exports every
    // top-level declaration only when it has no export declaration at all, that is
    // no `export { … }`, `export … from`, `export *`, `export =` and no
    // `export default <expression>`.
    let export_declarations = program.body.iter().any(|s| match s {
        Statement::ExportNamedDeclaration(_)
        | Statement::ExportFromDeclaration(_)
        | Statement::ExportAllDeclaration(_)
        | Statement::TSExportAssignment(_) => true,
        Statement::ExportDefaultDeclaration(e) => e.declaration.as_expression().is_some(),
        _ => false,
    });
    l.out.all_exported = declaration_file && !export_declarations;
    l.finish()
}

/// A `get`/`set` pair's declared types.
#[derive(Default)]
struct Accessor {
    get: Option<TExpr>,
    set: Option<TExpr>,
}

impl Accessor {
    /// The property's type: the one both accessors declare, else unknown.
    fn ty(self) -> TExpr {
        match (self.get, self.set) {
            (Some(g), Some(s)) if g == s => g,
            (Some(g), None) => g,
            (None, Some(s)) => s,
            _ => TExpr::Unknown,
        }
    }
}

/// Call signatures of one name: (bodiless declarations, implementations).
type Sigs = (Vec<Option<FnSig>>, Vec<Option<FnSig>>);

struct TypeLowerer<'s> {
    scoping: &'s Scoping,
    /// Local binding -> (specifier, imported name), type-only imports included.
    imports: BTreeMap<String, (String, String)>,
    out: RawTypes,
    /// Call signatures by name.
    sigs: BTreeMap<String, Sigs>,
}

fn key_name(k: &PropertyKey) -> Option<String> {
    k.static_name()
        .and_then(|n| n.as_str().map(str::to_string))
        .filter(|_| !k.is_private_identifier())
}

impl TypeLowerer<'_> {
    fn type_params(&self, p: Option<&TSTypeParameterDeclaration>) -> Vec<TParam> {
        p.map(|d| {
            d.params
                .iter()
                .map(|t| TParam {
                    name: t.name.name.to_string(),
                    default: t.default.as_ref().map(|d| self.ty(d, 1)),
                })
                .collect()
        })
        .unwrap_or_default()
    }

    fn finish(mut self) -> RawTypes {
        for (name, (decls, imps)) in std::mem::take(&mut self.sigs) {
            // Overload declarations are the callable signatures; the implementation's
            // own signature is not visible to callers.
            let sigs = if decls.is_empty() { imps } else { decls };
            let sig = match sigs.len() {
                1 => sigs.into_iter().next().flatten(),
                _ => None,
            };
            self.out.fns.insert(name, sig);
        }
        self.out.star.sort();
        self.out.star.dedup();
        self.out
    }

    fn import(&mut self, imp: &ImportDeclaration) {
        let spec = imp.source.value.display().to_string();
        for s in imp.specifiers.iter().flatten() {
            let (local, imported) = match s {
                ImportDeclarationSpecifier::ImportSpecifier(s) => {
                    (s.local.name.to_string(), export_name(&s.imported))
                }
                ImportDeclarationSpecifier::ImportDefaultSpecifier(s) => {
                    (s.local.name.to_string(), "default".to_string())
                }
                ImportDeclarationSpecifier::ImportNamespaceSpecifier(s) => {
                    (s.local.name.to_string(), "*".to_string())
                }
            };
            self.imports.insert(local, (spec.clone(), imported));
        }
    }

    fn export_local(&mut self, exported: String, local: &str) {
        if let Some(target) = self.imports.get(local) {
            self.out.reexports.insert(exported, target.clone());
        } else if exported != local {
            self.out.aliases.insert(exported, local.to_string());
        } else {
            self.out.exported.insert(exported);
        }
    }

    fn statement(&mut self, stmt: &Statement) {
        match stmt {
            Statement::ExportNamedDeclaration(e) => {
                for s in &e.specifiers {
                    self.export_local(export_name(&s.exported), &export_name(&s.local));
                }
            }
            Statement::ExportFromDeclaration(e) => {
                let spec = e.source.value.display().to_string();
                for s in &e.specifiers {
                    self.out.reexports.insert(
                        export_name(&s.exported),
                        (spec.clone(), export_name(&s.local)),
                    );
                }
            }
            Statement::ExportAllDeclaration(e) => {
                let spec = e.source.value.display().to_string();
                match &e.exported {
                    Some(ns) => {
                        self.out
                            .reexports
                            .insert(export_name(ns), (spec, "*".to_string()));
                    }
                    None => self.out.star.push(spec),
                }
            }
            Statement::ExportDeclaration(e) => {
                for name in self.declaration(&e.declaration) {
                    self.out.exported.insert(name);
                }
            }
            Statement::ExportDefaultDeclaration(e) => match &e.declaration {
                ExportDefaultDeclarationKind::FunctionDeclaration(f) => {
                    let name = f.id.as_ref().map_or("default", |i| i.name.as_str());
                    self.function(name, f);
                    self.export_local("default".into(), name);
                }
                ExportDefaultDeclarationKind::ClassDeclaration(c) => {
                    let name = c.id.as_ref().map_or("default", |i| i.name.as_str());
                    self.class(name, c);
                    self.export_local("default".into(), name);
                }
                ExportDefaultDeclarationKind::TSInterfaceDeclaration(i) => {
                    self.interface(i);
                    self.export_local("default".into(), i.id.name.as_str());
                }
                other => {
                    if let Some(expr) = other.as_expression() {
                        match strip(expr) {
                            Expression::Identifier(id) => {
                                self.export_local("default".into(), id.name.as_str())
                            }
                            e => {
                                if let Some(sig) = self.function_value(e) {
                                    self.add_sig("default", false, sig);
                                    self.out.exported.insert("default".into());
                                }
                            }
                        }
                    }
                }
            },
            _ => {
                if let Some(d) = stmt.as_declaration() {
                    self.declaration(d);
                }
            }
        }
    }

    /// Record a top-level declaration; returns the names it declares.
    fn declaration(&mut self, d: &Declaration) -> Vec<String> {
        match d {
            Declaration::FunctionDeclaration(f) => {
                if let Some(id) = &f.id {
                    self.function(id.name.as_str(), f);
                    return vec![id.name.to_string()];
                }
                vec![]
            }
            Declaration::ClassDeclaration(c) => {
                if let Some(id) = &c.id {
                    self.class(id.name.as_str(), c);
                    return vec![id.name.to_string()];
                }
                vec![]
            }
            Declaration::TSInterfaceDeclaration(i) => {
                self.interface(i);
                vec![i.id.name.to_string()]
            }
            Declaration::TSEnumDeclaration(e) => {
                self.add_decl(e.id.name.as_str(), TypeDecl::Enum);
                vec![e.id.name.to_string()]
            }
            Declaration::TSTypeAliasDeclaration(a) => {
                let decl = TypeDecl::Alias {
                    params: self.type_params(a.type_parameters.as_deref()),
                    ty: self.ty(&a.type_annotation, 0),
                };
                self.add_decl(a.id.name.as_str(), decl);
                vec![a.id.name.to_string()]
            }
            Declaration::VariableDeclaration(v) => {
                let mut names = Vec::new();
                for d in &v.declarations {
                    let BindingPattern::BindingIdentifier(id) = &d.id else {
                        continue;
                    };
                    let name = id.name.as_str();
                    // A declared type is what callers see, whatever the initializer is.
                    let sig = match &d.type_annotation {
                        Some(t) => match &t.type_annotation {
                            TSType::TSFunctionType(f) => {
                                let mut sig = self.params(&f.params);
                                sig.returns_function = is_function_type(&f.return_type);
                                Some(sig)
                            }
                            _ => None,
                        },
                        None => d.init.as_ref().and_then(|i| self.function_value(strip(i))),
                    };
                    let declared = d.type_annotation.is_some() || d.init.is_some();
                    if declared {
                        self.add_sig_opt(name, false, sig);
                    }
                    names.push(name.to_string());
                }
                names
            }
            Declaration::TSExternalModuleDeclaration(m) => {
                if let Some(b) = &m.body {
                    augmented_interfaces(&b.body, &mut self.out.augments);
                }
                vec![]
            }
            Declaration::TSGlobalDeclaration(g) => {
                augmented_interfaces(&g.body.body, &mut self.out.augments);
                vec![]
            }
            // Namespaces and `import X = ...` are not read; a name they declare
            // resolves to nothing, which is unknown.
            _ => vec![],
        }
    }

    fn add_decl(&mut self, name: &str, decl: TypeDecl) {
        use std::collections::btree_map::Entry;
        match self.out.decls.entry(name.to_string()) {
            Entry::Vacant(v) => {
                v.insert(decl);
            }
            Entry::Occupied(mut o) => {
                let merged = match (o.get().clone(), decl) {
                    (
                        TypeDecl::Interface {
                            params,
                            mut extends,
                            mut body,
                        },
                        TypeDecl::Interface {
                            params: p2,
                            extends: e2,
                            body: b2,
                        },
                    ) if params == p2 => {
                        extends.extend(e2);
                        body.open |= b2.open;
                        let mut clash = false;
                        for (k, v) in b2.props {
                            clash |= body.props.get(&k).is_some_and(|old| *old != v);
                            body.props.insert(k, v);
                        }
                        if clash {
                            TypeDecl::Opaque
                        } else {
                            TypeDecl::Interface {
                                params,
                                extends,
                                body,
                            }
                        }
                    }
                    _ => TypeDecl::Opaque,
                };
                o.insert(merged);
            }
        }
    }

    fn add_sig(&mut self, name: &str, bodiless: bool, sig: FnSig) {
        self.add_sig_opt(name, bodiless, Some(sig));
    }

    fn add_sig_opt(&mut self, name: &str, bodiless: bool, sig: Option<FnSig>) {
        let e = self.sigs.entry(name.to_string()).or_default();
        if bodiless { &mut e.0 } else { &mut e.1 }.push(sig);
    }

    fn function(&mut self, name: &str, f: &Function) {
        let mut sig = self.params(&f.params);
        sig.returns_function = function_returns_function(f);
        self.add_sig(name, f.body.is_none(), sig);
    }

    /// The signature of a function value (`(o: X) => ...`, `function (o: X) {}`).
    fn function_value(&self, e: &Expression) -> Option<FnSig> {
        match e {
            Expression::ArrowFunctionExpression(a) => {
                let mut sig = self.params(&a.params);
                sig.returns_function = arrow_returns_function(a);
                Some(sig)
            }
            Expression::FunctionExpression(f) => {
                let mut sig = self.params(&f.params);
                sig.returns_function = function_returns_function(f);
                Some(sig)
            }
            _ => None,
        }
    }

    fn params(&self, p: &FormalParameters) -> FnSig {
        let mut params: Vec<ParamT> = p
            .items
            .iter()
            .map(|it| {
                let (pattern, _) = match &it.pattern {
                    BindingPattern::AssignmentPattern(a) => (&a.left, true),
                    other => (other, it.initializer.is_some()),
                };
                let mut defaults = Vec::new();
                if let BindingPattern::ObjectPattern(o) = pattern {
                    for prop in &o.properties {
                        if !prop.computed
                            && matches!(prop.value, BindingPattern::AssignmentPattern(_))
                            && let Some(k) = key_name(&prop.key)
                        {
                            defaults.push(k);
                        }
                    }
                }
                defaults.sort();
                ParamT {
                    ty: it
                        .type_annotation
                        .as_ref()
                        .map(|t| self.ty(&t.type_annotation, 0)),
                    rest: false,
                    defaults,
                }
            })
            .collect();
        if p.rest.is_some() {
            params.push(ParamT {
                ty: None,
                rest: true,
                defaults: vec![],
            });
        }
        FnSig {
            params,
            returns_function: false,
        }
    }

    fn interface(&mut self, i: &TSInterfaceDeclaration) {
        let extends = i
            .extends
            .iter()
            .map(|h| self.type_ref(&h.type_name, h.type_arguments.as_deref(), 0))
            .collect();
        let body = self.signatures(&i.body.body, 0);
        let decl = match body {
            Some(body) => TypeDecl::Interface {
                params: self.type_params(i.type_parameters.as_deref()),
                extends,
                body,
            },
            None => TypeDecl::Opaque,
        };
        self.add_decl(i.id.name.as_str(), decl);
    }

    fn class(&mut self, name: &str, c: &Class) {
        let mut props = BTreeMap::new();
        let mut accessors: BTreeMap<String, Accessor> = BTreeMap::new();
        let mut readable = true;
        for el in &c.body.body {
            match el {
                ClassElement::MethodDefinition(m) => {
                    if m.key.is_private_identifier()
                        || matches!(
                            m.accessibility,
                            Some(TSAccessibility::Private | TSAccessibility::Protected)
                        )
                    {
                        readable = false;
                        continue;
                    }
                    if m.kind == MethodDefinitionKind::Constructor {
                        // Parameter properties: `constructor(public x: string)`.
                        for it in &m.value.params.items {
                            let is_prop = it.accessibility.is_some() || it.readonly;
                            if !is_prop {
                                continue;
                            }
                            if matches!(
                                it.accessibility,
                                Some(TSAccessibility::Private | TSAccessibility::Protected)
                            ) {
                                readable = false;
                                continue;
                            }
                            if let BindingPattern::BindingIdentifier(id) = &it.pattern {
                                props.insert(
                                    id.name.to_string(),
                                    PropT {
                                        optional: it.optional,
                                        ty: it
                                            .type_annotation
                                            .as_ref()
                                            .map_or(TExpr::Any, |t| self.ty(&t.type_annotation, 0)),
                                    },
                                );
                            }
                        }
                        continue;
                    }
                    let Some(k) = key_name(&m.key).filter(|_| !m.computed) else {
                        continue;
                    };
                    if m.r#static {
                        let sig = self.params(&m.value.params);
                        self.add_sig(&format!("{name}.{k}"), m.value.body.is_none(), sig);
                        continue;
                    }
                    match m.kind {
                        MethodDefinitionKind::Method => {
                            let sig = self.params(&m.value.params);
                            self.add_sig(&format!("{name}.{k}"), m.value.body.is_none(), sig);
                            props.insert(
                                k,
                                PropT {
                                    optional: m.optional,
                                    ty: TExpr::Other,
                                },
                            );
                        }
                        MethodDefinitionKind::Get => {
                            accessors.entry(k).or_default().get =
                                Some(self.return_type(m.value.return_type.as_deref()));
                        }
                        MethodDefinitionKind::Set => {
                            accessors.entry(k).or_default().set =
                                Some(self.setter_type(&m.value.params));
                        }
                        MethodDefinitionKind::Constructor => {}
                    }
                }
                ClassElement::PropertyDefinition(p) => {
                    if p.key.is_private_identifier()
                        || matches!(
                            p.accessibility,
                            Some(TSAccessibility::Private | TSAccessibility::Protected)
                        )
                    {
                        readable = false;
                        continue;
                    }
                    let Some(k) = key_name(&p.key).filter(|_| !p.computed) else {
                        continue;
                    };
                    // `method = (o: X) => {}` is callable as `Class.method` too.
                    if p.type_annotation.is_none()
                        && let Some(v) = &p.value
                        && let Some(sig) = self.function_value(strip(v))
                    {
                        let key = format!("{name}.{k}");
                        self.add_sig(&key, false, sig);
                    }
                    if p.r#static {
                        continue;
                    }
                    let ty = match (&p.type_annotation, &p.value) {
                        (Some(t), _) => self.ty(&t.type_annotation, 0),
                        // No annotation and no initializer: implicitly `any`.
                        (None, None) => TExpr::Any,
                        // Inferred from the initializer, which Drift does not type.
                        (None, Some(_)) => TExpr::Unknown,
                    };
                    props.insert(
                        k,
                        PropT {
                            optional: p.optional,
                            ty,
                        },
                    );
                }
                ClassElement::AccessorProperty(a) => {
                    if a.key.is_private_identifier()
                        || matches!(
                            a.accessibility,
                            Some(TSAccessibility::Private | TSAccessibility::Protected)
                        )
                    {
                        readable = false;
                        continue;
                    }
                    if a.r#static {
                        continue;
                    }
                    if let Some(k) = key_name(&a.key).filter(|_| !a.computed) {
                        let ty = a
                            .type_annotation
                            .as_ref()
                            .map_or(TExpr::Unknown, |t| self.ty(&t.type_annotation, 0));
                        props.insert(
                            k,
                            PropT {
                                optional: false,
                                ty,
                            },
                        );
                    }
                }
                ClassElement::TSIndexSignature(s) => {
                    if !s.r#static {
                        readable = false;
                    }
                }
                ClassElement::StaticBlock(_) => {}
            }
        }
        for (k, a) in accessors {
            props.insert(
                k,
                PropT {
                    optional: false,
                    ty: a.ty(),
                },
            );
        }
        let extends = c.heritage.as_ref().map(|h| match strip(&h.expression) {
            Expression::Identifier(id) => {
                let args = self.args(h.type_arguments.as_deref(), 0);
                match self.ident_ref(id.name.as_str(), id.reference_id.get()) {
                    Some(TExpr::Ref { target, .. }) => TExpr::Ref { target, args },
                    _ => TExpr::Unknown,
                }
            }
            _ => TExpr::Unknown,
        });
        let decl = TypeDecl::Class {
            params: self.type_params(c.type_parameters.as_deref()),
            extends,
            body: readable.then_some(ObjType { props, open: false }),
        };
        self.add_decl(name, decl);
    }

    fn signatures(&self, sigs: &[TSSignature], depth: usize) -> Option<ObjType> {
        let mut out = ObjType::default();
        let mut accessors: BTreeMap<String, Accessor> = BTreeMap::new();
        for s in sigs {
            match s {
                TSSignature::TSPropertySignature(p) => {
                    if p.computed {
                        continue;
                    }
                    let Some(k) = key_name(&p.key) else { continue };
                    let ty = p
                        .type_annotation
                        .as_ref()
                        .map_or(TExpr::Any, |t| self.ty(&t.type_annotation, depth + 1));
                    out.props.insert(
                        k,
                        PropT {
                            optional: p.optional,
                            ty,
                        },
                    );
                }
                TSSignature::TSMethodSignature(m) if m.kind != TSMethodSignatureKind::Method => {
                    if m.computed {
                        continue;
                    }
                    let Some(k) = key_name(&m.key) else { continue };
                    let a = accessors.entry(k).or_default();
                    if m.kind == TSMethodSignatureKind::Get {
                        a.get = Some(self.return_type(m.return_type.as_deref()));
                    } else {
                        a.set = Some(self.setter_type(&m.params));
                    }
                }
                TSSignature::TSMethodSignature(m) => {
                    if m.computed {
                        continue;
                    }
                    let Some(k) = key_name(&m.key) else { continue };
                    let optional = m.optional || out.props.get(&k).is_some_and(|p| p.optional);
                    out.props.insert(
                        k,
                        PropT {
                            optional,
                            ty: TExpr::Other,
                        },
                    );
                }
                TSSignature::TSIndexSignature(_) => out.open = true,
                TSSignature::TSCallSignatureDeclaration(_)
                | TSSignature::TSConstructSignatureDeclaration(_) => {}
            }
            if out.props.len() > MAX_PROPS {
                return None;
            }
        }
        for (k, a) in accessors {
            // A property declared both ways is not one Drift reads.
            let ty = if out.props.contains_key(&k) {
                TExpr::Unknown
            } else {
                a.ty()
            };
            out.props.insert(
                k,
                PropT {
                    optional: false,
                    ty,
                },
            );
        }
        Some(out)
    }

    /// A getter's declared type: its return annotation, or unknown without one.
    fn return_type(&self, t: Option<&TSTypeAnnotation>) -> TExpr {
        t.map_or(TExpr::Unknown, |t| self.ty(&t.type_annotation, 1))
    }

    /// A setter's declared type: its parameter's annotation, or unknown without one.
    fn setter_type(&self, p: &FormalParameters) -> TExpr {
        p.items
            .first()
            .and_then(|it| it.type_annotation.as_ref())
            .map_or(TExpr::Unknown, |t| self.ty(&t.type_annotation, 1))
    }

    fn args(&self, a: Option<&TSTypeParameterInstantiation>, depth: usize) -> Vec<TExpr> {
        a.map(|a| a.params.iter().map(|t| self.ty(t, depth + 1)).collect())
            .unwrap_or_default()
    }

    /// The reference an identifier in a type position names.
    fn ident_ref(&self, name: &str, reference: Option<oxc_semantic::ReferenceId>) -> Option<TExpr> {
        let symbol = reference.and_then(|r| self.scoping.get_reference(r).symbol_id());
        let Some(sym) = symbol else {
            return Some(TExpr::Ref {
                target: TRef::Global(name.to_string()),
                args: vec![],
            });
        };
        let flags = self.scoping.symbol_flags(sym);
        if flags.contains(SymbolFlags::TypeParameter) {
            return Some(TExpr::Param(name.to_string()));
        }
        if self.scoping.symbol_scope_id(sym) != self.scoping.root_scope_id() {
            return None;
        }
        if let Some((spec, imported)) = self.imports.get(name) {
            return Some(TExpr::Ref {
                target: TRef::Import {
                    spec: spec.clone(),
                    name: imported.clone(),
                    member: String::new(),
                },
                args: vec![],
            });
        }
        Some(TExpr::Ref {
            target: TRef::Local(name.to_string()),
            args: vec![],
        })
    }

    fn type_ref(
        &self,
        name: &TSTypeName,
        args: Option<&TSTypeParameterInstantiation>,
        depth: usize,
    ) -> TExpr {
        let args = self.args(args, depth);
        match name {
            TSTypeName::IdentifierReference(id) => {
                match self.ident_ref(id.name.as_str(), id.reference_id.get()) {
                    Some(TExpr::Ref { target, .. }) => TExpr::Ref { target, args },
                    Some(TExpr::Param(p)) if args.is_empty() => TExpr::Param(p),
                    _ => TExpr::Unknown,
                }
            }
            // `ns.X` on a namespace import: the export `X` of that module.
            TSTypeName::QualifiedName(q) => match &q.left {
                TSTypeName::IdentifierReference(id) => {
                    match self.ident_ref(id.name.as_str(), id.reference_id.get()) {
                        Some(TExpr::Ref {
                            target: TRef::Import { spec, name, .. },
                            ..
                        }) if name == "*" => TExpr::Ref {
                            target: TRef::Import {
                                spec,
                                name,
                                member: format!(".{}", q.right.name),
                            },
                            args,
                        },
                        _ => TExpr::Unknown,
                    }
                }
                _ => TExpr::Unknown,
            },
            TSTypeName::ThisExpression(_) => TExpr::Unknown,
        }
    }

    fn ty(&self, t: &TSType, depth: usize) -> TExpr {
        if depth > MAX_TYPE_DEPTH {
            return TExpr::Unknown;
        }
        match t {
            TSType::TSTypeLiteral(l) => self
                .signatures(&l.members, depth)
                .map_or(TExpr::Unknown, TExpr::Object),
            TSType::TSTypeReference(r) => {
                self.type_ref(&r.type_name, r.type_arguments.as_deref(), depth)
            }
            TSType::TSUnionType(u) => {
                TExpr::Union(u.types.iter().map(|t| self.ty(t, depth + 1)).collect())
            }
            TSType::TSIntersectionType(i) => {
                TExpr::Intersection(i.types.iter().map(|t| self.ty(t, depth + 1)).collect())
            }
            TSType::TSParenthesizedType(p) => self.ty(&p.type_annotation, depth + 1),
            TSType::TSUndefinedKeyword(_) | TSType::TSVoidKeyword(_) => TExpr::Undefined,
            TSType::TSLiteralType(l) => match &l.literal {
                TSLiteral::StringLiteral(s) => TExpr::Str(s.value.display().to_string()),
                _ => TExpr::Other,
            },
            TSType::TSAnyKeyword(_) => TExpr::Any,
            TSType::TSUnknownKeyword(_) => TExpr::Top,
            TSType::TSBigIntKeyword(_)
            | TSType::TSBooleanKeyword(_)
            | TSType::TSIntrinsicKeyword(_)
            | TSType::TSNeverKeyword(_)
            | TSType::TSNullKeyword(_)
            | TSType::TSNumberKeyword(_)
            | TSType::TSObjectKeyword(_)
            | TSType::TSStringKeyword(_)
            | TSType::TSSymbolKeyword(_)
            | TSType::TSArrayType(_)
            | TSType::TSTupleType(_)
            | TSType::TSFunctionType(_)
            | TSType::TSConstructorType(_)
            | TSType::TSTemplateLiteralType(_)
            | TSType::TSTypePredicate(_) => TExpr::Other,
            // `readonly X[]` is an array; `keyof X` and `unique symbol` are not objects.
            TSType::TSTypeOperatorType(o) => match o.operator {
                TSTypeOperatorOperator::Readonly => match &o.type_annotation {
                    TSType::TSArrayType(_) | TSType::TSTupleType(_) => TExpr::Other,
                    _ => TExpr::Unknown,
                },
                TSTypeOperatorOperator::Keyof | TSTypeOperatorOperator::Unique => TExpr::Other,
            },
            _ => TExpr::Unknown,
        }
    }
}

/// Interfaces declared in a module augmentation's body, at any namespace depth.
fn augmented_interfaces(body: &[Statement], out: &mut std::collections::BTreeSet<String>) {
    for stmt in body {
        let d = match stmt {
            Statement::ExportDeclaration(e) => Some(&e.declaration),
            other => other.as_declaration(),
        };
        match d {
            Some(Declaration::TSInterfaceDeclaration(i)) => {
                out.insert(i.id.name.to_string());
            }
            Some(Declaration::TSNamespaceDeclaration(n)) => {
                let mut ns = &n.body;
                loop {
                    match ns {
                        TSNamespaceDeclarationBody::TSNamespaceDeclaration(inner) => {
                            ns = &inner.body
                        }
                        TSNamespaceDeclarationBody::TSModuleBlock(b) => {
                            augmented_interfaces(&b.body, out);
                            break;
                        }
                    }
                }
            }
            _ => {}
        }
    }
}

fn export_name(n: &ModuleExportName) -> String {
    match n {
        ModuleExportName::IdentifierName(i) => i.name.to_string(),
        ModuleExportName::IdentifierReference(i) => i.name.to_string(),
        ModuleExportName::StringLiteral(s) => s.value.display().to_string(),
    }
}

/// Parentheses and `satisfies` keep a value's type; `as` and `!` do not, so they stay.
/// A declared return type that is a function type: `(h: Handler) => Handler`, in
/// parentheses or not. A name (`Middleware`) is not read: it may alias anything.
fn is_function_type(t: &TSTypeAnnotation) -> bool {
    let mut ty = &t.type_annotation;
    while let TSType::TSParenthesizedType(p) = ty {
        ty = &p.type_annotation;
    }
    matches!(ty, TSType::TSFunctionType(_))
}

/// [`FnSig::returns_function`] for a function declaration or expression: a declared
/// function return type, or a plain (not async, not generator) body every `return` of
/// which hands back a function ([`body_returns_function`]).
fn function_returns_function(f: &Function) -> bool {
    if f.r#async || f.generator {
        return false;
    }
    f.return_type.as_deref().is_some_and(is_function_type)
        || f.body.as_deref().is_some_and(body_returns_function)
}

/// [`FnSig::returns_function`] for an arrow: a declared function return type, or a
/// plain (not async) arrow whose concise body is a function
/// (`(o) => (h) => ...`) or whose block body returns one on every `return`.
fn arrow_returns_function(a: &ArrowFunctionExpression) -> bool {
    if a.r#async {
        return false;
    }
    if a.return_type.as_deref().is_some_and(is_function_type) {
        return true;
    }
    if a.is_expression() {
        return a.get_expression().is_some_and(is_function_value);
    }
    a.get_function_body().is_some_and(body_returns_function)
}

/// A function written in place: an arrow or a function expression (in parentheses,
/// `as` or `satisfies` included). A call, a name or anything else may be any value.
fn is_function_value(e: &Expression) -> bool {
    let mut e = e;
    loop {
        e = match e {
            Expression::ParenthesizedExpression(p) => &p.expression,
            Expression::TSSatisfiesExpression(x) => &x.expression,
            Expression::TSAsExpression(x) => &x.expression,
            _ => break,
        };
    }
    matches!(
        e,
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
    )
}

/// Every `return` of a function body hands back a function, and the body ends in one,
/// so it never falls through to `undefined`. A returned name counts only when the
/// body's own top-level statements declare it as a function (`function inner() {}`,
/// `const inner = () => ...`) and the `return` is one of those statements, where the
/// name can only be that declaration. Returns inside nested functions and classes are
/// theirs, not this body's.
fn body_returns_function(body: &FunctionBody) -> bool {
    let Some(Statement::ReturnStatement(_)) = body.statements.last() else {
        return false;
    };
    let mut local_fns: Vec<&str> = Vec::new();
    for s in &body.statements {
        match s {
            Statement::FunctionDeclaration(f) => {
                if let Some(id) = &f.id {
                    local_fns.push(id.name.as_str());
                }
            }
            Statement::VariableDeclaration(v) if v.kind.is_const() => {
                for d in &v.declarations {
                    if let (BindingPattern::BindingIdentifier(id), Some(init)) = (&d.id, &d.init)
                        && is_function_value(init)
                    {
                        local_fns.push(id.name.as_str());
                    }
                }
            }
            _ => {}
        }
    }
    let top_level_name = |r: &ReturnStatement| {
        let Some(Expression::Identifier(id)) = r.argument.as_ref() else {
            return false;
        };
        local_fns.contains(&id.name.as_str())
            && body
                .statements
                .iter()
                .any(|s| matches!(s, Statement::ReturnStatement(t) if std::ptr::eq(t.as_ref(), r)))
    };
    let mut returns = Returns::default();
    for s in &body.statements {
        returns.walk(s);
    }
    !returns.all.is_empty()
        && returns
            .all
            .iter()
            .all(|r| r.argument.as_ref().is_some_and(is_function_value) || top_level_name(r))
}

/// The values a plain (not async, not generator) function hands back when calling it
/// can only end at a `return` with a value: its body ends in a `return`, so it never
/// falls through to `undefined`, and every `return` of the body ([`Returns`]) has one.
/// `None` otherwise. Used to prove what a function returns from what each `return`
/// is (see [`body_returns_function`]).
pub(crate) fn plain_function_returns<'b, 'a>(
    f: &'b Function<'a>,
) -> Option<Vec<&'b Expression<'a>>> {
    if f.r#async || f.generator {
        return None;
    }
    body_returns(f.body.as_deref()?)
}

/// [`plain_function_returns`] for an arrow: a concise body is its one value.
pub(crate) fn plain_arrow_returns<'b, 'a>(
    a: &'b ArrowFunctionExpression<'a>,
) -> Option<Vec<&'b Expression<'a>>> {
    if a.r#async {
        return None;
    }
    if a.is_expression() {
        return a.get_expression().map(|e| vec![e]);
    }
    body_returns(a.get_function_body()?)
}

fn body_returns<'b, 'a>(body: &'b FunctionBody<'a>) -> Option<Vec<&'b Expression<'a>>> {
    let Some(Statement::ReturnStatement(_)) = body.statements.last() else {
        return None;
    };
    let mut returns = Returns::default();
    for s in &body.statements {
        returns.walk(s);
    }
    returns.all.iter().map(|r| r.argument.as_ref()).collect()
}

/// The `return` statements of one function body, not of the functions and classes
/// nested in it.
#[derive(Default)]
struct Returns<'b, 'a> {
    all: Vec<&'b ReturnStatement<'a>>,
}

impl<'b, 'a> Returns<'b, 'a> {
    fn walk(&mut self, s: &'b Statement<'a>) {
        match s {
            Statement::ReturnStatement(r) => self.all.push(r),
            Statement::BlockStatement(b) => b.body.iter().for_each(|s| self.walk(s)),
            Statement::IfStatement(i) => {
                self.walk(&i.consequent);
                if let Some(a) = &i.alternate {
                    self.walk(a);
                }
            }
            Statement::TryStatement(t) => {
                t.block.body.iter().for_each(|s| self.walk(s));
                if let Some(h) = &t.handler {
                    h.body.body.iter().for_each(|s| self.walk(s));
                }
                if let Some(f) = &t.finalizer {
                    f.body.iter().for_each(|s| self.walk(s));
                }
            }
            Statement::SwitchStatement(sw) => {
                for c in &sw.cases {
                    c.consequent.iter().for_each(|s| self.walk(s));
                }
            }
            Statement::ForStatement(f) => self.walk(&f.body),
            Statement::ForInStatement(f) => self.walk(&f.body),
            Statement::ForOfStatement(f) => self.walk(&f.body),
            Statement::WhileStatement(w) => self.walk(&w.body),
            Statement::DoWhileStatement(w) => self.walk(&w.body),
            Statement::LabeledStatement(l) => self.walk(&l.body),
            Statement::WithStatement(w) => self.walk(&w.body),
            // Declarations, expressions and the rest hold no `return` of this body:
            // one inside a nested function or class is that function's.
            _ => {}
        }
    }
}

fn strip<'b, 'a>(mut e: &'b Expression<'a>) -> &'b Expression<'a> {
    loop {
        e = match e {
            Expression::ParenthesizedExpression(p) => &p.expression,
            Expression::TSSatisfiesExpression(x) => &x.expression,
            _ => return e,
        };
    }
}
