//! Raw, pre-resolution facts for one Python file.
//!
//! Lowering depends only on the file's text, so this output is cached by
//! content hash. Imported names keep their specifier as written (`..models`,
//! `app.core.config`); the linker turns them into canonical references.

use drift_core::{SymbolKind, WrapKind};
use serde::{Deserialize, Serialize};

/// Where a reference points before module resolution.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum RawBase {
    /// An imported binding: `from spec import name`, or `import spec` (name `*`).
    Import { spec: String, name: String },
    /// A module-level binding of this file (def, class or assignment).
    Local(String),
    /// A name bound by none of the above: builtins (`print`, `ValueError`) and
    /// undefined names.
    Global(String),
    /// An unbound name in a file with `from x import *`: looked up in the star modules.
    Star(String),
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct RawRef {
    pub base: RawBase,
    /// Member path such as `.objects.filter` or `.get()`; empty for none.
    pub member: String,
}

/// [`RawSymbol::drf_permissions_unread`] of a view class that defines
/// `get_permissions`: the permissions are what the method returns for the request,
/// whatever `permission_classes` any class of its chain declares.
pub const GET_PERMISSIONS: &str = "get_permissions()";

/// A FastAPI dependency before resolution.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum RawDep {
    /// `Depends(get_db)`, `Security(f)`, `Annotated[T, Depends(f)]`, `Depends(Pagination)`.
    Direct(RawRef),
    /// A parameter annotation or default that may name an `Annotated[..., Depends(f)]`
    /// alias (`user: CurrentUser`) or a `Depends(f)` constant (`= API_KEY_REQUIRED`);
    /// dropped when it does not.
    Alias(RawRef),
    /// `Depends(Authorizer(scope="x"))`: an instance made in place. FastAPI calls it, so
    /// its class's `__call__` dependencies run, not its `__init__`'s. A call that makes
    /// a soft dependency (`HTTPBearer(auto_error=False)`, `Auth(required=False)`,
    /// `require(True)` for `def require(optional=False)`) is no dependency of its
    /// callee at all; the linker decides, since positional arguments need the callee's
    /// parameter names.
    Instance(RawRef, SoftArgs),
    /// A dependency whose parameter may be `None` (`user: User | None = Depends(f)`,
    /// `Annotated[str | None, Depends(f)] = None`): a dependency of a dependency that
    /// takes it so is soft, and a chain does not count it (or what it depends on).
    Optional(Box<RawDep>),
    /// A dependency written where Drift cannot read what it is: a list bound to a name
    /// (`dependencies=COMMON`), spread (`[*COMMON]`) or concatenated, `Depends(...)` of
    /// a lookup, a call or a lambda (`Depends(GUARDS[MODE])`), a parameter of an
    /// enclosing function (`Depends(guard)` in `create_app(guard)`). The expression in
    /// words. It may be the guard: never dropped.
    Unread(String),
    /// No dependency: what may give a value of the caller, in
    /// [`RawSymbol::caller_args`] only. A function called with nothing or with the
    /// request (`current_venue_id()`), or an attribute of a request-scoped holder
    /// (`g.venue_id`, `<request>.state.tenant`). The linker keeps it where the
    /// function returns a value of the caller or turns callers away, or where code
    /// of the repository binds a value of the caller on the holder; it gives
    /// nothing otherwise.
    Gives(RawRef),
}

/// An argument's value, as far as a soft flag cares.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum ArgValue {
    True,
    False,
    /// Another literal: a string, number, `None`, or a list, tuple, set or dict display
    /// (`["admin"]`). Not a soft flag's value.
    Literal,
    /// A name, a call or another expression whose value is not known (`not DEBUG`).
    Unknown,
}

/// How a call that makes a FastAPI dependency (an instance, a factory's result) was
/// built, for deciding whether the dependency is soft: it lets a request without
/// credentials through.
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct SoftArgs {
    /// A soft flag passed by keyword: `auto_error=False`, `required=False`,
    /// `optional=True`, or any of the three with a value that is not a literal.
    pub keyword: bool,
    /// The positional arguments, matched against the callee's parameter names by the
    /// linker.
    pub positional: Vec<ArgValue>,
    /// A `*args` argument: which parameters the positional arguments bind is unknown.
    #[serde(default)]
    pub starred: bool,
    /// The arguments as written, for [`drift_core::controls::SHAPE`]: `(...)`.
    #[serde(default)]
    pub shape: String,
}

/// The positional parameters a call to a symbol binds.
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum RawParams {
    /// A class with no `__init__` of its own: its first base's (the linker follows it).
    #[default]
    Inherited,
    /// Not known from the code: a decorated class without `__init__` (a dataclass, an
    /// attrs class builds one from its fields).
    Unknown,
    /// A function's, or a class's own `__init__`'s without `self`: positional-only and
    /// positional-or-keyword names, in order, and whether `*args` takes the rest.
    Own { names: Vec<String>, varargs: bool },
}

/// How a module-level name is bound.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum RawBinding {
    /// Defined in this file.
    Local,
    /// Imported: `name` is `*` for a module object (`import a.b as c`, `from . import mod`).
    Import {
        spec: String,
        name: String,
        /// `import x as x` / `from y import x as x`: an explicit re-export (PEP 484).
        explicit: bool,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawImport {
    /// Module as written, relative dots included (`..models`, `os.path`, `.`).
    pub spec: String,
    /// Names imported from it (`*` for the module itself or a star import), sorted.
    pub names: Vec<String>,
    /// Inside `if TYPE_CHECKING:`.
    pub type_only: bool,
    /// `from spec import ...` (names may be submodules) rather than `import spec`.
    pub from: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawSymbol {
    pub name: String,
    pub kind: SymbolKind,
    pub line: u32,
    /// An `async def`: a call of it that is not awaited runs nothing
    /// ([`drift_core::not_always::NOT_AWAITED`]).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_async: bool,
    pub wraps: Vec<(RawRef, WrapKind)>,
    pub calls: Vec<RawRef>,
    /// (callee, argument index or [`crate::KWARG_INDEX`], keyword or dict key)
    pub args: Vec<(RawRef, u32, String)>,
    /// Keywords of `args` that other calls to the same callee leave out.
    #[serde(default)]
    pub omits: Vec<(RawRef, u32, String)>,
    /// For a class: its own attributes, each with a callee called directly in its
    /// statement (outside any method), or `None` for the binding itself.
    #[serde(default)]
    pub declares: Vec<(String, Option<RawRef>)>,
    pub controls: Vec<String>,
    pub string_literals: u32,
    pub suppressions: Vec<String>,
    pub reads: Vec<String>,
    pub throws: Vec<RawRef>,
    pub sinks: Vec<String>,
    pub order: Vec<RawRef>,
    /// FastAPI dependencies of a function, in parameter order; of a class, its
    /// `__init__`'s (what `Depends(Class)` runs).
    pub deps: Vec<RawDep>,
    /// Of a class: its `__call__`'s dependencies (what `Depends(instance)` runs).
    #[serde(default)]
    pub call_deps: Vec<RawDep>,
    /// What positional arguments of a call to the symbol bind to.
    #[serde(default)]
    pub params: RawParams,
    /// `params` is unknown only because the class defines `__new__`: a reading the
    /// measured build did not make ([`RawMount::unmeasured`]).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub built_by_new: bool,
    /// HTTP methods a view handles: the handler methods a class defines (`get`, `post`)
    /// or a function view's `require_http_methods` / `api_view` list.
    pub methods: Vec<String>,
    /// Entry-point adapter implied by the symbol itself (`drf` for `APIView` subclasses
    /// and `@api_view` functions, `django` for class-based views).
    pub view: Option<String>,
    /// For a handler method of a class-based view (`PostDetail.get`): the class.
    pub owner: Option<String>,
    /// Kind facts known from the file alone (`abstract`); the linker adds those that
    /// come from resolved bases and decorators.
    pub traits: Vec<String>,
    /// DRF `permission_classes` the symbol declares itself (class attribute or
    /// `@permission_classes([...])`); `Some(vec![])` for an explicit empty list. A view
    /// that declares none gets the settings' `DEFAULT_PERMISSION_CLASSES`.
    #[serde(default)]
    pub drf_permissions: Option<Vec<RawRef>>,
    /// The DRF permission classes the symbol declares could not be read, in the
    /// code's words: `permission_classes` bound to what is no list of classes
    /// (`BASE + (IsAdminUser,)`, a name, `[IsAuthenticated | IsStaff]`), a
    /// `get_permissions` the class defines ([`GET_PERMISSIONS`]), or an action's
    /// own (`@action(permission_classes=...)`, which replace the class's for that
    /// action). The linker says so on the view since the measured build, where
    /// [`Self::drf_permissions`] and the wraps stay what they were.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drf_permissions_unread: Option<String>,
    /// DRF `authentication_classes`, likewise.
    #[serde(default)]
    pub drf_authentication: Option<Vec<RawRef>>,
    /// For a class: what its own `class Meta:` sets, `("model", Some(ref))`, or
    /// `("abstract", None)` / `("proxy", None)` for a `True` flag.
    #[serde(default)]
    pub meta: Vec<(String, Option<RawRef>)>,
    /// For a class: (decorator, the reference it is called with first).
    #[serde(default)]
    pub decorator_args: Vec<(RawRef, RawRef)>,
    /// Names its docstring says it is not or does not use (`Name=phrase`).
    #[serde(default)]
    pub disclaims: Vec<String>,
    /// For a function that may be handed a request or an application (an `async`
    /// function of two parameters that calls its second with its first, a context
    /// manager of one parameter): how it uses its first parameter. Each is the
    /// attribute read on it (`headers`), or `<value>` when the parameter itself is
    /// passed on, subscripted or assigned. None for any other function.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub param_uses: Option<Vec<String>>,
    /// For a function: the callees a call passes one of the function's own parameters
    /// to, as an argument, `*args` or `**kwargs` (`tag.button(*args, **kwargs)` in
    /// `def button(*args, **kwargs)`). The linker turns a same-name one into
    /// [`drift_core::traits::FORWARDS`].
    #[serde(default)]
    pub forwards: Vec<RawRef>,
    /// Callees of `calls`, and errors of `throws`, that the body meets only after it
    /// hands control on to its continuation or on what the continuation handed back
    /// ([`drift_core::Symbol::after_continuation`]).
    #[serde(default)]
    pub after_continuation: Vec<RawRef>,
    /// For a class: each method's own calls and risky operations
    /// ([`drift_core::Symbol::members`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub members: Vec<RawMember>,
    /// Practice facts (facts schema 11), before resolution: see [`drift_core::Symbol`].
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub body_checks: Vec<RawBodyCheck>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub responses: Vec<RawResponse>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub log_calls: Vec<RawLogCall>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub catches: Vec<RawCatch>,
    /// Request header names read ([`drift_core::practice::valid_header`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub headers: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub inputs: Vec<RawInput>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub handles: Vec<RawHandles>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub scoped: Vec<RawScoped>,
    /// Conditions that raise an error class ([`drift_core::Symbol::raise_checks`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub raise_checks: Vec<RawRaiseCheck>,
    /// For a function: the callables its own `return` statements hand back by reference
    /// (a dependency factory's product), resolved by the linker into `calls` as
    /// `<canonical>(ref)`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub returns: Vec<RawReturn>,
    /// For a function: what it reads of a request, decided by the linker for an entry
    /// point (`controls::READS_INPUT` / `NO_INPUT`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_use: Option<RawInputUse>,
    /// Method calls on a receiver `calls` does not hold
    /// ([`drift_core::Symbol::receiver_calls`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub receiver_calls: Vec<RawReceiverCall>,
    /// For a function: the callee or class whose instance it hands back
    /// ([`drift_core::Symbol::returns_instance`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub returns_instance: Option<RawRef>,
    /// For a function: the class its return annotation names
    /// ([`drift_core::Symbol::returns_type`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub returns_type: Option<RawRef>,
    /// For a class: the class of each attribute `__init__` binds on `self`
    /// ([`drift_core::Symbol::attr_types`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attr_types: Vec<(String, RawRef)>,
    /// The body's calls, each with why it does not run for every request, empty where
    /// it does ([`drift_core::Symbol::conditional_calls`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub conditional_calls: Vec<(RawRef, String)>,
    /// The callees whose call's value the body returns
    /// ([`drift_core::Symbol::returns_calls`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub returns_calls: Vec<RawRef>,
    /// The callees the body hands a value of the caller to, each with the
    /// dependency the value is of, if it is of one
    /// ([`drift_core::Symbol::caller_args`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub caller_args: Vec<(RawRef, Option<RawDep>)>,
    /// Where the sides of the comparisons its checks record come from
    /// ([`drift_core::controls::SIDES`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub check_sides: Vec<RawCheckSides>,
    /// Where the values its scoped queries filter by come from
    /// ([`drift_core::controls::FILTER_VALUE`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub filter_values: Vec<RawFilterValue>,
    /// The calls of the repository's code, with what each argument is
    /// ([`drift_core::controls::ARG_VALUE`]): callee, then keyword or `#<position>`
    /// (`*` for an unpacking) and side.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub arg_sides: Vec<(RawRef, Vec<(String, RawSide)>)>,
    /// For a class: the parameter of `__init__` each attribute of `self` is bound
    /// from, with its position ([`drift_core::controls::ATTR_PARAM`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attr_params: Vec<(String, String, u32)>,
    /// How the things at the symbol's guard positions are written, where that is a
    /// call: the callee and its arguments ([`drift_core::controls::SHAPE`]). For a
    /// variable or constant: the call its value is.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub shapes: Vec<(RawRef, String)>,
    /// Decorators the measured build did not read, each with where it sits among
    /// [`Self::wraps`]: one that is no name (`@GUARDS["user"]`, `@(strict if X else
    /// lenient)`), by the expression in words, linked as `unresolved:<words>`
    /// since it may be the guard; and the elements of the list a Flask view class
    /// applies to its handlers (`decorators = [login_required]`, Flask-RESTful's
    /// `method_decorators`), by their reference where they have one.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub since_wraps: Vec<(u32, Option<RawRef>, String)>,
    /// [`Self::since_wraps`] holds the elements of a class's `decorators` or
    /// `method_decorators`: they apply where the class is a Flask view.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub view_decorators: bool,
    /// For a class-based view and its handler methods: the class's decorators that
    /// apply to one method only, each with that method's name
    /// (`@method_decorator(login_required, name="post")` on the class,
    /// `@method_decorator(login_required)` on `post`), `None` where the name is not
    /// read. Read since the measured build: a handler method of another name does
    /// not run them, and the class's own symbol holds none of them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub wraps_only: Vec<(RawRef, Option<String>)>,
    /// A handler method of a class that no view base is read for (`class Items(Base)`
    /// with `Base` of the repository): a symbol of the second link only, where a
    /// route or a registration serves the class and the class defines the method
    /// ([`Linker::handlers`]), as for a view of a package's class. Lowering 68.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub late: bool,
    /// The same for [`Self::since_wraps`], by index: a decorator that is no name
    /// given to `@method_decorator(..., name=...)`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub since_only: Vec<(u32, Option<String>)>,
    /// For a class: what a test given to `@method_decorator(user_passes_test(...),
    /// name=...)` says ([`drift_core::controls::PASSES_TEST_SIGNED_IN`],
    /// [`drift_core::controls::TEST_ASKS_ROLE`] and the others), with the method it
    /// applies to (`None`: a name that is not read): on that method's symbol, not
    /// the class's, which every method of the class reads.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub controls_only: Vec<(String, Option<String>)>,
    /// For a class: `permission_classes` is assigned on it after its body
    /// (`ArchiveList.permission_classes = []`). The classes of the last such
    /// assignment the module makes, where every one is a statement of the module
    /// itself and that one is a list of classes written in place; else the words
    /// of what is not read (an assignment under a branch, in a function, by `+=`,
    /// or of a value that is no such list), with no classes. Read since the
    /// measured build, in place of [`Self::drf_permissions`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drf_reassigned: Option<Reassigned>,
    /// The callees whose value the body returns when there is one, for every
    /// request ([`drift_core::controls::RETURNS_RESULT_OF`]): `denied = check()`
    /// then `if denied: return denied` (the test also `denied is not None`,
    /// `isinstance(denied, ...)`), or `if (denied := check()) is not None: return
    /// denied`, as statements of a function's own body. The linker keeps one for
    /// a callee that turns callers away by the value it hands back.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub returns_result_of: Vec<RawRef>,
    /// For a module-level name bound by assignment: the call its value is, with
    /// its arguments (`bearer = HTTPBearer(auto_error=False)`), or the name it is
    /// another name for, with nothing (`guard = login_required`). One entry per
    /// binding that is one of the two; a name bound again in any other way has an
    /// entry more, of no reference, so that a reader takes neither.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub values: Vec<(Option<RawRef>, String)>,
}

/// [`RawSymbol::drf_reassigned`].
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Reassigned {
    /// Always set: the classes read, none where `unread` says why.
    pub classes: Option<Vec<RawRef>>,
    pub unread: Option<String>,
}

/// A method call on a receiver `calls` does not hold
/// ([`drift_core::Symbol::receiver_calls`]).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum RawReceiverCall {
    /// Named by what the receiver is (`RuleBook().list`, `get_exporter().run`).
    Ref(RawRef),
    /// What the receiver is cannot be told: `param:<name>.<path>` or
    /// `local:<name>.<path>`, as written.
    Unread(String),
}

/// A parameter of a handler, as far as request input goes ([`RawInputUse`]).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum RawParamKind {
    /// Request input: a path, query, body, form, file, header or cookie parameter, a
    /// route kwarg.
    Input,
    /// A FastAPI dependency (`Depends(f)`, `Security(f)`).
    Dep,
    /// A parameter annotated with a name that may be an `Annotated[..., Depends(f)]`
    /// alias (a dependency) or a model (input): the linker decides.
    Alias(RawRef),
    /// The request object itself, or something no input arrives through (`Response`,
    /// `BackgroundTasks`, `self`).
    Other,
}

/// What a function reads of the request it serves.
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawInputUse {
    /// The body reads request input (`request.json`, `request.GET`, `request.data`,
    /// `request.get_json()`, `request.body`).
    pub reads: bool,
    /// The request is handed on whole (to a call, a binding), or the body calls a
    /// method of `self`: what is read of it is not known.
    pub escapes: bool,
    /// `*args` / `**kwargs`: route kwargs may arrive there.
    pub variadic: bool,
    pub params: Vec<RawParamKind>,
}

/// A callable a function returns ([`RawSymbol::returns`]).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum RawReturn {
    /// `return verify`, `return deps.verify`: a module-level or imported name.
    Ref(RawRef),
    /// `return BearerAuth(...)`: an instance of a class; `soft` when built soft
    /// (`auto_error=False`, `required=False`, `optional=True`).
    Instance(RawRef, bool),
    /// `return functools.partial(f, ...)`: `f`, or `None` when it is no reference.
    Partial(Option<RawRef>),
}

/// A data-access call filtering on a tenant-like key ([`drift_core::ScopedQuery`]).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawScoped {
    pub callee: Option<RawRef>,
    pub key: String,
    pub source: drift_core::ScopeSource,
    /// [`drift_core::ScopedQuery::condition`].
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub condition: String,
}

/// What a [`RawBodyCheck`] reads or compares with, before resolution.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum RawOperand {
    /// Nothing that can be read (`""`).
    None,
    /// The result of a call, or a module-level object (`current_user`): its canonical
    /// reference (`call:<canonical>` as a compare).
    Ref(RawRef),
    /// A handler parameter bound to a FastAPI dependency: the dependency's canonical id,
    /// else `param:<name>`.
    Dep(RawDep, String),
    Param(String),
    Header(String),
    /// A string or number literal (never echoed).
    Literal,
    /// An env-derived secret (`os.environ["API_KEY"]`, a module constant bound from one,
    /// an HMAC keyed with one): `env` as a compare, the name never echoed.
    Env,
}

/// Where a value that is compared or filtered by comes from
/// ([`drift_core::controls::SIDES`]), before resolution.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum RawSide {
    /// A value of the caller by its own source.
    Caller,
    /// What a dependency, a helper or a holder gives: a reader judges it.
    Gives(RawDep),
    /// What the request sent.
    Request,
    /// A parameter of the function, or read off one: its name, and its position
    /// among the positional parameters (`self` and `cls` left out), where it has one.
    Param(String, Option<u32>),
    /// A parameter whose annotation may name a dependency
    /// (`user: CurrentUser`): what the dependency gives where the linker finds one,
    /// else the parameter; read through a method called on it where the flag says.
    Annotated(RawDep, String, Option<u32>, bool),
    /// What a method called on what a declared dependency gives hands back
    /// (`db.get(Document, id)` of `db=Depends(get_db)`).
    Called(RawDep),
    /// Read off this attribute of `self`.
    SelfAttr(String),
    /// An environment read, or a name bound to one.
    Setting,
    Literal,
    /// What a call handed back.
    Call(RawRef),
    /// A module-level name that is no call.
    Value(RawRef),
    Unread,
}

/// The two sides of a comparison a check records ([`drift_core::controls::SIDES`]),
/// keyed as the check is.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawCheckSides {
    pub source: RawOperand,
    pub reads: String,
    pub compares: RawOperand,
    pub left: RawSide,
    pub right: RawSide,
}

/// The value a scoped query filters by ([`drift_core::controls::FILTER_VALUE`]).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawFilterValue {
    pub callee: Option<RawRef>,
    pub key: String,
    pub value: RawSide,
}

/// A check in the body that turns the caller away ([`drift_core::BodyCheck`]).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawBodyCheck {
    pub source: RawOperand,
    pub reads: String,
    pub compares: RawOperand,
    pub outcome: drift_core::CheckOutcome,
    /// How the condition compares ([`drift_core::BodyCheck::op`]).
    #[serde(default)]
    pub op: String,
    /// Inside a branch only some requests take ([`drift_core::BodyCheck::conditional`]).
    #[serde(default)]
    pub conditional: bool,
    /// Why, and the condition in words ([`drift_core::BodyCheck::condition`],
    /// [`drift_core::BodyCheck::unless`]).
    #[serde(default)]
    pub condition: String,
    #[serde(default)]
    pub unless: String,
    /// What the function calls before the check ([`drift_core::BodyCheck::after`]).
    #[serde(default)]
    pub after: Vec<RawReceiverCall>,
}

/// A condition whose first exit raises an error class ([`drift_core::RaiseCheck`]).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawRaiseCheck {
    pub source: RawOperand,
    pub reads: String,
    pub compares: RawOperand,
    /// Compared with a value that could not be read (`compares` is then `None`).
    pub unread_compare: bool,
    pub raises: RawRef,
    pub status: u16,
    /// How the condition compares ([`drift_core::RaiseCheck::op`]).
    #[serde(default)]
    pub op: String,
    /// Inside a branch only some requests take ([`drift_core::RaiseCheck::conditional`]).
    #[serde(default)]
    pub conditional: bool,
    /// Why, and the condition in words ([`drift_core::RaiseCheck::condition`],
    /// [`drift_core::RaiseCheck::unless`]).
    #[serde(default)]
    pub condition: String,
    #[serde(default)]
    pub unless: String,
    /// What the function calls before the check ([`drift_core::RaiseCheck::after`]).
    #[serde(default)]
    pub after: Vec<RawReceiverCall>,
}

/// One response the symbol sends ([`drift_core::ResponseFact`]).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawResponse {
    pub status: u16,
    pub via: drift_core::ResponseVia,
    pub builder: Option<RawRef>,
    pub model: Option<RawRef>,
    pub keys: Vec<String>,
    pub in_catch: bool,
}

/// A log-call candidate ([`drift_core::LogCall`]).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawLogCall {
    pub callee: RawRef,
    pub level: String,
    pub in_catch: bool,
    pub structured: bool,
    pub passes_error: bool,
    /// A receiver that is a parameter: `<name>.<method>`, written `param:<name>.<method>`
    /// (`callee` is then unused).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub param: Option<String>,
    /// The receiver is a logger derived with bound fields.
    #[serde(default)]
    pub bound: bool,
}

/// What an `except` clause does ([`drift_core::CatchFact::does`]).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum RawDoes {
    Rethrow,
    Throw(RawRef),
    Log,
    Respond(u16),
    Report(RawRef),
    Return,
}

/// One `except` clause ([`drift_core::CatchFact`]): the classes caught (`None` for a
/// bare `except:`) and what the clause does (`swallow` when none of it).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawCatch {
    pub catches: Vec<Option<RawRef>>,
    pub does: Vec<RawDoes>,
}

/// A type or schema request input is validated into ([`drift_core::Symbol::inputs`]).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum RawInput {
    /// Validated in the body (`UserSerializer(data=request.data)`,
    /// `schema.load(request.json)`) or declared (`serializer_class = X`).
    Validated(RawRef),
    /// The annotation of a handler parameter (`body: ItemIn`): kept by the linker only
    /// for an entry point, when it names an in-repo class.
    Param(RawRef),
}

/// What a symbol is registered to handle ([`drift_core::Symbol::handles_errors`]).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum RawHandles {
    Class(RawRef),
    Status(u16),
    Any,
}

/// A module a test mocks ([`drift_core::FileFacts::mocks`]), before resolution.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum RawMock {
    /// `patch("a.b.c")`: a dotted path, resolved to its longest module.
    Dotted(String),
    /// `patch.object(mod, "x")`, `monkeypatch.setattr(mod, "x", v)`: the object's module.
    Ref(RawRef),
    /// A module id known as written (`pkg:httpx` for respx).
    Module(String),
}

/// One method of a class, as lowered ([`drift_core::Member`]).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawMember {
    pub name: String,
    pub calls: Vec<RawRef>,
    pub sinks: Vec<String>,
    /// The method's own checks that turn the caller away.
    #[serde(default)]
    pub body_checks: Vec<RawBodyCheck>,
    /// Error classes the method's own body raises.
    #[serde(default)]
    pub throws: Vec<RawRef>,
    /// Keys the method's own calls pass ([`drift_core::Member::args`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<(RawRef, u32, String)>,
    /// The method's own scoped queries ([`drift_core::Member::scoped_queries`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub scoped: Vec<RawScoped>,
    /// The method's own conditions that raise an error class
    /// ([`drift_core::Member::raise_checks`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub raise_checks: Vec<RawRaiseCheck>,
    /// The decorators on the method, outermost first
    /// ([`drift_core::Member::decorators`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub decorators: Vec<RawRef>,
    /// The method's own calls on a receiver `calls` does not hold
    /// ([`drift_core::Member::receiver_calls`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub receiver_calls: Vec<RawReceiverCall>,
    /// The method's own conditional calls
    /// ([`drift_core::Member::conditional_calls`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub conditional_calls: Vec<(RawRef, String)>,
    /// What the method's own body calls, in the order of each callee's first call
    /// ([`drift_core::Member::order`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub order: Vec<RawReceiverCall>,
    /// The callees the method's own body hands a value of the caller to
    /// ([`drift_core::Member::caller_args`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub caller_args: Vec<(RawRef, Option<RawDep>)>,
    /// [`RawSymbol::check_sides`] and [`RawSymbol::filter_values`] of the method's
    /// own body.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub check_sides: Vec<RawCheckSides>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub filter_values: Vec<RawFilterValue>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub arg_sides: Vec<(RawRef, Vec<(String, RawSide)>)>,
    /// What the method's own body does that no other fact records
    /// ([`drift_core::Member::unread`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unread: Vec<String>,
    /// An `async def` ([`RawSymbol::is_async`]).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_async: bool,
}

/// A decorator that registers the symbol with a router, app or task queue whose
/// type is only known after linking (`@router.get("/x")`, `@app.task`).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawRoute {
    pub symbol: String,
    /// The router, app or Celery instance.
    pub receiver: RawRef,
    /// Decorator attribute: `get`, `post`, `route`, `api_route`, `websocket`, `task`, ...
    pub verb: String,
    /// First positional string argument (or `path=`/`rule=`), when literal.
    pub path: Option<String>,
    /// `methods=[...]`, upper-cased.
    pub methods: Vec<String>,
    /// `dependencies=[Depends(x)]`.
    pub deps: Vec<RawDep>,
    /// Keyword names passed to the decorator.
    pub keywords: Vec<String>,
    /// `name=` (Celery task names).
    pub name: Option<String>,
    pub line: u32,
    /// Where the decorator sits among the symbol's other decorators, outermost first;
    /// used to put it back as a plain decorator when the receiver is not a router.
    pub position: u32,
    /// How many of the symbol's decorator wraps, and of its
    /// [`RawSymbol::since_wraps`], are written above this one: Flask and FastAPI
    /// register the function the route decorator is handed, so a decorator above
    /// it wraps a function no request reaches. Read since the measured build.
    #[serde(default)]
    pub above: (u32, u32),
    /// The dependencies options spread into the decorator give
    /// (`@router.get("", **PROTECTED)` with `PROTECTED = {"dependencies":
    /// [Depends(f)]}` bound once at module level, or a dict written in place; the
    /// last `dependencies` key wins); a spread that is not read is one
    /// [`RawDep::Unread`]. Read since the measured build.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub splat_deps: Vec<RawDep>,
}

/// A module-level instance that may be a router, app or queue:
/// `router = APIRouter(prefix="/x")`, `bp = Blueprint("auth", __name__, url_prefix="/auth")`.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawRouter {
    pub name: String,
    /// The constructor (`APIRouter`, a subclass, a re-export).
    pub callee: RawRef,
    /// `prefix=` (FastAPI).
    pub prefix: Option<String>,
    /// `url_prefix=` (Flask).
    pub url_prefix: Option<String>,
    /// `path=` (flask-restx `Namespace`).
    pub path: Option<String>,
    /// First positional string (flask-restx's default path is `/<name>`).
    pub first: Option<String>,
    /// `dependencies=[Depends(x)]` (FastAPI).
    pub deps: Vec<RawDep>,
    /// How the instance was built: built soft (`auto_error=False`, `required=False`,
    /// `optional=True`, by keyword or position), as a FastAPI dependency it does not
    /// reject a request, so it never stands for its class (which a strict instance does).
    #[serde(default)]
    pub args: SoftArgs,
    /// The keywords of the constructor call, as written; options spread into it are
    /// `**<what>`.
    #[serde(default)]
    pub keywords: Vec<String>,
    /// `lifespan=<function>`: it is handed the application.
    #[serde(default)]
    pub lifespan: Option<RawRef>,
    /// 1-based line of the assignment.
    #[serde(default)]
    pub line: u32,
    /// `middleware=[Middleware(SignIn), ...]` of the constructor (Starlette,
    /// FastAPI): the classes named, outermost first. Read since the measured build.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub middleware: Vec<RawRef>,
    /// The constructor is given `middleware=` and that is not all in
    /// [`Self::middleware`]: not a list written in place, or an element that is no
    /// `Middleware(<class>, ...)`. What it holds may turn callers away.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub middleware_unread: bool,
}

/// A reference that may hand a router or an application on ([`RawFile::router_uses`]).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawUse {
    /// The name or dotted name read; for a call, the method called (`app.frobnicate`).
    pub on: RawRef,
    /// A method call that is not one Drift knows ([`crate::lower::adapters::READ_METHODS`]).
    pub call: bool,
    /// 1-based line of the first such reference.
    pub line: u32,
}

/// A middleware given to an application: `app.add_middleware(Class)`,
/// `app.middleware("http")(function)`, `@app.middleware("http")`.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawMiddleware {
    pub app: RawRef,
    /// The class or function; none when it is not a name.
    pub what: Option<RawRef>,
    /// `add_middleware`: a class. Otherwise a function taking the request.
    pub class: bool,
    /// As written, for the message.
    pub text: String,
    pub line: u32,
}

/// The `middleware=` lists a request passes on its way from an application to a
/// route of its route table, outermost first: of each Starlette `Mount(...)` around
/// the route, of a `Router(...)` or `Starlette(...)` built in a mount, and of the
/// `Route(...)` itself. Each runs for every request of what it is given on, as the
/// application's own does. Read since the measured build.
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawBehind {
    /// The classes named (`Middleware(SignIn, ...)`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub middleware: Vec<RawRef>,
    /// What was not read, each with its line: a `middleware=` that is no list of
    /// `Middleware(<class>, ...)` written in place (`` `middleware=` of
    /// `Mount(...)` ``), and the application that holds a `Mount` no route table
    /// read holds. Any may turn callers away.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unread: Vec<(String, u32)>,
}

impl RawBehind {
    pub fn is_empty(&self) -> bool {
        self.middleware.is_empty() && self.unread.is_empty()
    }
}

/// What a reading made since the measured build knows of a Starlette
/// `Mount(path, app=...)` ([`RawMount::table`]).
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawTableMount {
    /// The application whose route table holds the `Mount`, and the full prefix of
    /// the mount in that table. None where no route table that was read holds it:
    /// the mount is then under a prefix that is not known, as it was.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub at: Option<(RawRef, String)>,
    /// The middleware on the way from that application to what is mounted.
    #[serde(default, skip_serializing_if = "RawBehind::is_empty")]
    pub behind: RawBehind,
    /// The application is built in the call (`app=Router(routes=[...])`) and its
    /// routes are listed where the table is read: the mount stands for nothing more.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub listed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum MountTarget {
    /// A router object (`items.router`, `bp`), or a DRF router's `.urls`.
    Ref(RawRef),
    /// A URLconf module named by string: Django `include("shop.urls")`.
    Module(String),
    /// An include Drift cannot follow (`include(get_plugin_urls())`, an f-string): what
    /// the parent URLconf serves is not fully known.
    Dynamic,
    /// An application mounted under a path that Drift cannot name
    /// (`app.mount("/v1", make_app())`): any application of the project may be the
    /// one, so none of them is known to be served at its own paths only.
    Unfollowed,
}

/// How many [`RawFile::router_uses`] one file keeps.
pub const MAX_ROUTER_USES: usize = 2048;

/// One router mounted under another: `app.include_router(r, prefix="/v1")`,
/// `app.register_blueprint(bp)`, Django `path("api/", include("api.urls"))`.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawMount {
    /// The parent router; `None` for this module's Django URLconf or a router that
    /// is local to a function (an app factory), which counts as a root.
    pub parent: Option<RawRef>,
    pub target: MountTarget,
    /// Prefix given at the mount; `None` when not given (Flask then uses the
    /// blueprint's own `url_prefix`).
    pub prefix: Option<String>,
    /// Dependencies or guards added at the mount.
    pub deps: Vec<RawDep>,
    /// What the mount adds could not be read (`dependencies=DEPS`, `**options`):
    /// `deps` is then not all of it.
    #[serde(default)]
    pub opaque: bool,
    /// The target is mounted as a whole application (`app.mount(path, sub)`, a
    /// Starlette `Mount`, a `DispatcherMiddleware` entry), not included as a router:
    /// one that is no router Drift reads may still be an application of the project.
    #[serde(default)]
    pub whole_app: bool,
    /// A listing the last build whose mined proposals were measured did not make
    /// ([`drift_core::Listed`]): linked for `drift security` and the practice map,
    /// left out of what mining reads.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub unmeasured: bool,
    /// A Starlette `Mount(path, app=...)`: where it is and what it is behind, as a
    /// reading made since the measured build takes it. The measured build read the
    /// mount as the other fields say (no parent, under a prefix that is not known).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub table: Option<Box<RawTableMount>>,
}

/// A view registered by reference from another place: Django `path("x/", views.f)`,
/// DRF `router.register("users", UserViewSet)`, `app.add_url_rule("/x", view_func=f)`.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawRegistration {
    pub target: RawRef,
    /// Router the route is registered on (for its prefix); `None` for this module's URLconf.
    pub router: Option<RawRef>,
    pub adapter: String,
    pub route: String,
    pub methods: Vec<String>,
    /// Wrappers applied at the registration (`login_required(views.f)`), outermost first.
    pub guards: Vec<RawRef>,
    /// As [`RawMount::unmeasured`].
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub unmeasured: bool,
    /// Not a registration that is read: a name the module of a `urlpatterns` Drift
    /// cannot read refers to, which that list may route. The linker keeps it when it
    /// is a view (a function of the request, a view class), at a path that is not
    /// known. The same of a name read in a file with a registration call that is not
    /// placed (`app.add_url_rule(rule, view_func=view)` in a loop over a table): the
    /// linker keeps a function or a class, and follows a table or a module of
    /// another file to the views it names.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub candidate: bool,
    /// A route of a Starlette route table: the middleware given on the way from
    /// the application to it.
    #[serde(default, skip_serializing_if = "RawBehind::is_empty")]
    pub behind: RawBehind,
    /// How the wrappers of [`Self::guards`] that are calls are written
    /// (`permission_required("x")(view)`), for [`drift_core::controls::SHAPE`].
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub shapes: Vec<(RawRef, String)>,
    /// Wrappers applied at the registration that the measured build did not read,
    /// outermost first: one that is no name (`GUARDS["x"](view)`), by its words;
    /// and those around the view of a Flask `add_url_rule(rule,
    /// view_func=login_required(view))`, by their reference.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub since_guards: Vec<(Option<RawRef>, String)>,
}

/// `@bp.before_request` and similar hooks that guard every route of a router.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawHook {
    pub router: RawRef,
    pub hook: RawRef,
    /// `before_app_request` on a blueprint: runs before every request of the app the
    /// blueprint is registered on, not only the blueprint's own routes.
    #[serde(default)]
    pub app_wide: bool,
    /// Application middleware (`@app.middleware("http")`, `app.add_middleware(X)`):
    /// it runs before every request of the application, and is no wrap of a route
    /// ([`drift_core::Symbol::app_middleware`]).
    #[serde(default)]
    pub middleware: bool,
    /// Registered under a branch, in a loop or in a `try` (`if staff_only:
    /// app.before_request(require_staff)` in a factory that builds more than one
    /// application): it runs for the applications that took the branch, which is
    /// not read.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub conditional: bool,
    /// A hook the measured build did not record ([`RawMount::unmeasured`]): what
    /// is given is no name (`bp.before_request(HOOKS["session"])`), kept by its
    /// words since it may be the guard.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub unmeasured: bool,
}

/// A function-local app passed to another function: `init_hooks(app)` in `create_app()`.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawAppPass {
    /// The local (`create_app.app`).
    pub from: RawRef,
    pub callee: RawRef,
    /// Positional index, or the keyword it is passed as.
    pub index: Option<u32>,
    pub keyword: Option<String>,
    /// 1-based line of the call.
    #[serde(default)]
    pub line: u32,
    /// A pass the measured build did not record ([`RawMount::unmeasured`]): of a
    /// module-level application or router of the file (`init_auth(admin)` below
    /// `admin = Flask(...)`), or of an imported name whose every read as a value in
    /// the file is an argument of a call (`handler = Mangum(app)`).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub unmeasured: bool,
    /// The value of the call is what is served: handed to another call
    /// (`uvicorn.run(require_signature(app))`), returned, bound to the name the
    /// application had (`app = require_signature(app)`) or to a name a server is
    /// pointed at (`application = ...`). Not a call that is a statement of its own
    /// (`init_hooks(app)`), nor one bound to another name (`celery =
    /// make_celery(app)`). What a function of the repository hands back for an
    /// application may answer in its place.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub used: bool,
}

/// Django settings a module assigns at module level, in statement order. Any module may
/// assign them; the linker decides which modules are settings (`DJANGO_SETTINGS_MODULE`,
/// `settings.py`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RawSettings {
    /// String settings whose name ends in `URLCONF` or `HOSTCONF` (`ROOT_URLCONF`,
    /// `PUBLIC_SCHEMA_URLCONF`, `ROOT_HOSTCONF`); the last assignment wins.
    pub urlconfs: Vec<(String, String)>,
    /// `MIDDLEWARE`.
    pub middleware: Option<RawList>,
    /// `REST_FRAMEWORK`.
    pub drf: Option<RawDrf>,
    /// A literal `DJANGO_SETTINGS_MODULE` (`os.environ.setdefault(...)` or
    /// `os.environ[...] = ...`) anywhere in the file.
    pub settings_module: Option<String>,
}

/// A list setting. `extends` is true when the module only adds to the value it inherits
/// (`+=`, `.append`, `[*MIDDLEWARE, ...]`); a plain assignment rebinds it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RawList {
    pub extends: bool,
    pub items: Vec<String>,
}

/// `REST_FRAMEWORK`. `extends` is true when the module only updates the dict it inherits
/// (`REST_FRAMEWORK["K"] = ...`, `.update`, `{**REST_FRAMEWORK, ...}`); a plain
/// assignment rebinds it, and a key it leaves out is DRF's default.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RawDrf {
    pub extends: bool,
    /// `DEFAULT_PERMISSION_CLASSES` (an empty list when not a literal).
    pub permissions: Option<Vec<String>>,
    /// `DEFAULT_AUTHENTICATION_CLASSES`.
    pub authentication: Option<Vec<String>>,
    /// `EXCEPTION_HANDLER`: the dotted path of the function DRF hands every error to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exception_handler: Option<String>,
}

impl RawSettings {
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }

    pub fn urlconf(&self, key: &str) -> Option<&str> {
        self.urlconfs
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }
}

/// The task a Celery beat entry runs.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum RawBeatTask {
    /// `"task": "proj.tasks.cleanup"` in a beat schedule: a task name.
    Name(String),
    /// `add_periodic_task(60, cleanup.s())`: the task object.
    Ref(RawRef),
}

/// One Celery beat entry: `beat_schedule` / `CELERY_BEAT_SCHEDULE` items, `add_periodic_task`.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawBeat {
    /// The entry's key (or `name=`); `None` when it has none.
    pub name: Option<String>,
    pub task: RawBeatTask,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawModel {
    pub name: String,
    /// `django`, `sqlalchemy`, `sqlmodel`.
    pub source: String,
    pub line: u32,
    pub fields: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RawFile {
    pub parse_ok: bool,
    pub imports: Vec<RawImport>,
    /// Module-level names and how they are bound (attribute lookups and re-exports).
    pub bindings: Vec<(String, RawBinding)>,
    /// Static `__all__`, when the file defines one.
    pub all: Option<Vec<String>>,
    /// `from x import *` specifiers, in order.
    pub star_imports: Vec<String>,
    pub symbols: Vec<RawSymbol>,
    /// `X = Annotated[T, Depends(f)]` aliases: name -> dependencies.
    pub dep_aliases: Vec<(String, Vec<RawDep>)>,
    /// `X = Annotated[T, ...]` aliases: name -> the class annotated
    /// ([`drift_core::Symbol::alias_of`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub alias_types: Vec<(String, RawRef)>,
    pub routes: Vec<RawRoute>,
    pub routers: Vec<RawRouter>,
    /// The other bindings of a name of [`Self::routers`] to an instance of a class:
    /// one name bound twice (`app = FastAPI()`, then `app = TokenMiddleware(app)`)
    /// is in `routers` once, by its first binding in sort order, whichever that is.
    /// Read since the measured build, where the binding kept is no application and
    /// one of these is. Sorted.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub routers_rebound: Vec<RawRouter>,
    /// The module-level functions that hand back one of their own parameters, and
    /// nothing else (`def configure(app): ...; return app`): an application passed
    /// to one and bound to its result is the same application. Sorted.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hands_back: Vec<String>,
    pub mounts: Vec<RawMount>,
    /// References that may hand a router on to a mount Drift does not read: every
    /// name read as a value that is an import or a router of the file, except where
    /// reading it hands nothing on (the receiver of a method call, a decorator, the
    /// argument of a mount Drift read). Sorted, at most [`MAX_ROUTER_USES`]; with
    /// more, [`RawFile::uses_all`].
    #[serde(default)]
    pub router_uses: Vec<RawUse>,
    /// Middleware given to an application or router of any file.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub middlewares: Vec<RawMiddleware>,
    /// The file has more such references than are kept, or reaches modules or code
    /// by a computed name (`importlib`, `__import__`, `pkgutil`, `runpy`,
    /// `sys.modules`, `exec`, `eval`): any router may be mounted from it.
    #[serde(default)]
    pub uses_all: bool,
    /// The file reads its own namespace (`globals()`, or `locals()`, `vars()` or
    /// `dir()` at module level): every name it binds is handed on.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub uses_namespace: bool,
    pub registrations: Vec<RawRegistration>,
    /// The module's own functions and classes that are read as values (in a table,
    /// as an argument): what a table of the module may hand to a registration that
    /// is not placed ([`RawRegistration::candidate`]). Sorted.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub value_defs: Vec<String>,
    pub hooks: Vec<RawHook>,
    /// Entry points known from the file alone (`@shared_task`, `@dramatiq.actor`). A Celery
    /// task without `name=` has route `None`: its default name, `module.function`, needs
    /// the module's import name, which the linker knows.
    pub entry_points: Vec<drift_core::EntryPoint>,
    pub models: Vec<RawModel>,
    #[serde(default)]
    pub settings: RawSettings,
    #[serde(default)]
    pub beats: Vec<RawBeat>,
    #[serde(default)]
    pub app_passes: Vec<RawAppPass>,
    /// `host(r"api", "proj.api_urls")` (django-hosts): URLconfs a hostconf serves.
    #[serde(default)]
    pub host_urlconfs: Vec<String>,
    /// `request.urlconf = "proj.alt_urls"` anywhere in the file.
    #[serde(default)]
    pub request_urlconfs: Vec<String>,
    /// The dependencies the file replaces in a FastAPI application
    /// (`app.dependency_overrides[get_user] = ...`, `.update({get_user: ...})`)
    /// anywhere in the file, `None` for one whose key is not a reference
    /// ([`drift_core::controls::OVERRIDDEN`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub dependency_overrides: Vec<Option<RawRef>>,
    /// Positional parameters of functions that register hooks or blueprints on one of
    /// their parameters (`def init_hooks(app)`).
    #[serde(default)]
    pub factory_params: Vec<(String, Vec<String>)>,
    /// What a function does with a local it registers a hook, a mount or a route on
    /// (an application built in a factory) beyond the methods Drift reads: an
    /// attribute read or assigned, a method called (`app.before_request_funcs`,
    /// `app.wsgi_app = ...`), as [`RawFile::router_uses`] holds of module-level
    /// ones. Sorted.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub local_uses: Vec<RawUse>,
    /// Module-level names bound to the result of a call of a function
    /// (`admin = make_app("admin")`) that the file then registers a hook, a
    /// middleware, a mount or a route on: the name and the function called.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub factory_results: Vec<(String, RawRef)>,
    /// Lists of references: wiring registries (see `lower::registries`).
    #[serde(default)]
    pub lists: Vec<RawRefList>,
    /// Autodiscovery markers (`celery:autodiscover_tasks`).
    #[serde(default)]
    pub discovers: Vec<String>,
    /// The requests the file sends ([`drift_core::FileFacts::outgoing`]); the linker
    /// leaves them out for test files.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub outgoing: Vec<drift_core::OutgoingRequest>,
    /// Requests the file's test functions make ([`drift_core::FileFacts::test_requests`]);
    /// the linker keeps them for test files only.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub test_requests: Vec<drift_core::TestRequest>,
    /// Modules the file mocks; the linker keeps them for test files only.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mocks: Vec<RawMock>,
    /// `app.add_exception_handler(X, handler)`: what the handler handles, and the handler.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub error_handlers: Vec<(RawHandles, RawRef)>,
}

/// One entry of a [`RawRefList`].
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum RawListItem {
    Ref(RawRef),
    /// A module path written as a string directly in a list (`"dcim"`, `"proj.tasks"`).
    Module(String),
    /// A module included by string (Django `include("shop.urls")`): its lists are
    /// reachable from this one; the list is opaque when it cannot be resolved.
    Include(String),
    /// Spread into the list (`*extra`): stands for that list's items.
    Spread(RawRef),
    /// Something no reference describes (a lambda, `*helper()`, a helper call):
    /// the list is opaque (see `drift_core::Registry::opaque`).
    Opaque,
}

/// Where a [`RawRefList`] sits.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum RawListSlot {
    /// Positional argument `index`, or keyword `key` (index `KWARG_INDEX`), of a call.
    Arg {
        callee: RawRef,
        index: u32,
        key: String,
    },
    /// A module-level binding (`urlpatterns`, `INSTALLED_APPS`).
    Binding(String),
    /// Every statement-level call of a method of this receiver.
    Calls(RawRef),
}

/// A list of references in one file, before resolution.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawRefList {
    pub slot: RawListSlot,
    pub line: u32,
    pub items: Vec<(RawListItem, u32)>,
}

impl RawSymbol {
    pub fn empty(name: &str, kind: SymbolKind, line: u32) -> Self {
        Self {
            name: name.to_string(),
            kind,
            line,
            is_async: false,
            wraps: vec![],
            calls: vec![],
            args: vec![],
            omits: vec![],
            declares: vec![],
            controls: vec![],
            string_literals: 0,
            suppressions: vec![],
            reads: vec![],
            throws: vec![],
            sinks: vec![],
            order: vec![],
            deps: vec![],
            call_deps: vec![],
            param_uses: None,
            params: RawParams::Inherited,
            built_by_new: false,
            methods: vec![],
            view: None,
            owner: None,
            traits: vec![],
            drf_permissions: None,
            drf_permissions_unread: None,
            drf_authentication: None,
            meta: vec![],
            decorator_args: vec![],
            disclaims: vec![],
            forwards: vec![],
            after_continuation: vec![],
            members: vec![],
            body_checks: vec![],
            responses: vec![],
            log_calls: vec![],
            catches: vec![],
            headers: vec![],
            inputs: vec![],
            handles: vec![],
            scoped: vec![],
            raise_checks: vec![],
            returns: vec![],
            input_use: None,
            receiver_calls: vec![],
            returns_instance: None,
            returns_type: None,
            attr_types: vec![],
            conditional_calls: vec![],
            returns_calls: vec![],
            caller_args: vec![],
            check_sides: vec![],
            filter_values: vec![],
            arg_sides: vec![],
            attr_params: vec![],
            shapes: vec![],
            since_wraps: vec![],
            view_decorators: false,
            wraps_only: vec![],
            late: false,
            since_only: vec![],
            controls_only: vec![],
            drf_reassigned: None,
            returns_result_of: vec![],
            values: vec![],
        }
    }
}
