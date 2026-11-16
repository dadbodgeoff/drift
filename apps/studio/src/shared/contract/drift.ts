// The data contract with the Drift CLI: TypeScript mirrors of the JSON that
// `drift scan --json`, `drift census --json`, `drift check --format json`,
// `drift security --json` and `drift practices --json` print, and of the files Drift writes
// (`.drift/conventions.yaml`, `drift.lock`, `.drift/cache/sessions/<id>.json`).
//
// Every type here is data produced by Drift from repository content: strings
// are untrusted (rendered as text only, never as HTML, URLs or commands).

// ---------- drift scan --json (crates/drift-core/src/facts.rs) ----------

export type SymbolKind =
  | "function"
  | "component"
  | "class"
  | "const"
  | "variable"
  | "module"
  | "model"
  | "package";

/** How a symbol is wrapped. The last five are guards applied by configuration or app-wide hooks (Python adapters). */
export type WrapKind = "call" | "decorator" | "jsx" | "try" | "extends" | "config" | "authenticates" | "config_authenticates" | "opens" | "app_hook";

/**
 * Python, in a file's listed reading (`FileFacts.listed`) since lowering 60, a wrap's `wrapper` may
 * also be: `unresolved:<words>` for a decorator, a `before_request` hook or a wrapper applied where
 * a view is registered that is no name (`@GUARDS["user"]`, `bp.before_request(pick())`,
 * `path("x", GUARDS["a"](view))`): the expression in words, since it may be the guard; an element
 * of the list a Flask view class applies to its handlers (`decorators = [...]`, Flask-RESTful's
 * `method_decorators`), as a `decorator` of the class; a wrapper around the view of a Flask
 * `add_url_rule(rule, view_func=login_required(view))`, as a `decorator`; a FastAPI dependency
 * given through options spread into the route decorator (`@router.get("", **PROTECTED)`), and
 * `unresolved:**<words>` where the spread is not read. A decorator written above the route decorator
 * of a Flask or FastAPI route is no wrap there (the framework registers the undecorated function),
 * and a FastAPI scheme built optional (`HTTPBearer(auto_error=False)`) is a wrap as any other,
 * with how it was built in `controls` (`shape:`). The `permission_classes` of a DRF view class
 * assigned after its body (`ArchiveList.permission_classes = []`) are its `call` wraps in place of
 * the body's: the last assignment the module makes, or `unresolved:<words>` where it is not ordered.
 * What Django's application object is served through (`application = Gate(application)` in
 * `wsgi.py` / `asgi.py`) is in `app_middleware` of every Django view, after `?` where only some of
 * the modules that build the application wrap it so. Since Python lowering 63: a middleware of
 * Django's `MIDDLEWARE` of a package on no list is a `config` wrap `unresolved:<dotted path> in
 * MIDDLEWARE` of every view the settings serve; `@method_decorator(..., name="post")` and a
 * `method_decorator` on one method are wraps of that method's symbol only (not of the class or its
 * other methods), and `unresolved:method_decorator(<wrapper>)` where the name is not a literal.
 * Since Python lowering 65: `unresolved:method_decorator(<wrapper>)` also on a class that is its own
 * route's handler (no method of it is one) for a decorator naming one method; `unresolved:decorators
 * inherited from <canonical base>` (a `decorator`) on a Django or DRF route's handler built on a class
 * of the repository that a decorator wraps, or one of whose methods one wraps; and a `config` wrap
 * `unresolved:<dotted path> in MIDDLEWARE` for a middleware of the repository built on a package's
 * on no list. A middleware of the repository that keeps a value or hands a value of the caller to a
 * call is in `app_middleware` of every view the settings serve.
 */
export interface Wrap {
  wrapper: string;
  kind: WrapKind;
}

/**
 * Python control facts since lowering 60, as `Symbol.controls` holds them. None is shown by the
 * Studio; mining proposes none.
 *
 * - `shape:<callee>(<arguments>)`: how a thing at one of the symbol's guard positions is written
 *   where it is a call (a decorator, a FastAPI dependency of the symbol, of its router or of a
 *   mount, a wrapper applied where the view is registered, and a call in the body of a library
 *   function whose arguments decide, `verify_jwt_in_request`). The callee is canonical; an
 *   argument is `True`, `False`, `None`, `lit` (any other literal or display of literals) or `?`,
 *   a keyword argument `name=<argument>`, `*` and `**` an unpacking, `...` more than twelve; a dict
 *   of options written in place is `{key:value;key:value}` (`options={verify_signature:False}`).
 *   Calls in a body are recorded for `verify_jwt_in_request` and for what may verify a token
 *   (`decode`, `loads`, `unsign`, `verify`, `verify_token`, `verify_id_token`, `verify_oauth2_token`,
 *   `verify_firebase_token`, by the callee's last name; not the standard library's), and such a
 *   package callee is in `conditional_calls` where some requests do not make the call.
 *   `shape:<callee>` with no parentheses is the thing written bare, recorded only beside a called
 *   shape of the same callee. `shape:pkg:flask_jwt_extended#jwt_required(optional=True)`.
 * - `shape:=<callee>(<arguments>)` on a module-level name bound by assignment: the call its value is
 *   (`shape:=pkg:fastapi#security.HTTPBearer(auto_error=False)`); `shape:=<name>` where it is another
 *   name for something (`guard = login_required`); `shape:=` alone beside them where the name is bound
 *   more than once (a reader then takes none).
 * - `returns_unread`: a `return` of the function hands back something the facts do not name (a lookup,
 *   a local that is no nested `def`, an attribute of a local or of a parameter): called where a guard
 *   goes, what it gives is not read.
 * - `calls_unnamed`: the body calls something that is no name and no method of a name
 *   (`HOOKS[kind]()`).
 * - Since lowering 62, where the values a check compares and a query filters by come from, read by the
 *   authorization practice and never by mining: `sides:<source>\t<reads>\t<compares>\t<left>\t<right>`
 *   for a comparison a check records (`source`, `reads`, `compares` as the check writes them), a side
 *   being `caller` (a value of the caller by the closed list of sources), `via <dependency>`, `gives
 *   <callee>`, `request`, `param <name>` or `param <name> #<position>`, `self.<attribute>`, `setting`,
 *   `literal`, `call <callee>`, `value <name>` or `unread`; `filter_value:<callee>\t<key>\t<side>` for a
 *   scoped query; `arg_value:<callee>` then a tab, the argument (keyword, `#<position>`, `*`) and a tab
 *   and its side for each argument, once per call of the repository's own code; `attr_param:<attribute>
 *   \t<parameter>\t<position>` on a class whose `__init__` binds `self.<attribute>` from a parameter
 *   (since lowering 65 only for its one binding, a keyword-only parameter at position 4294967295),
 *   and `attr_param:?` on a dataclass whose generated constructor is not read;
 *   `returns_request` on a function whose every `return` gives what the request sent. A method's own
 *   are in its `Member.unread`.
 * - `refuses_every`: every request the body lets through has passed a refusal of a caller with no
 *   identity, a call of a function of the same module that never returns counted as one
 *   (`if user is None: deny()`).
 * - `refusal_not_returned`: every refusal of the symbol is in a function defined in its body that it
 *   does not hand back, while it hands back another that refuses no one.
 * - `returns_rejection:` (the key empty): the function's own body turns its caller away only by a
 *   response it returns (`return jsonify(...), 401`), as TypeScript records it in the listed
 *   reading; `returns_refusing` where a function defined in the body does (what a factory or a
 *   decorator hands back). A FastAPI dependency that does so refuses no one.
 * - `returns_result_of:@<callee>` and `drops_result_of:<callee>`, as TypeScript records them in
 *   the listed reading: the body returns what a call of `<callee>` handed back when there is
 *   something, for every request (`denied = check(); if denied: return denied`, `if (denied :=
 *   check()) is not None: return denied`), for a callee of the repository with
 *   `returns_rejection:`; every call of `<callee>` in the body is a statement of its own, for such a
 *   callee and for a package's function (not the standard library's).
 * - `orm_filter` (TypeScript lowering 70, the listed reading only): the body configures a filter a data
 *   library adds to every query it runs (Prisma `$extends`/`$use`, MikroORM `@Filter`/`setFilterParams`/
 *   `addFilter`, Mongoose query middleware and plugins, Sequelize scopes and find hooks, TypeORM
 *   `@EventSubscriber`): while one is in the repository, a TypeScript route's authorization is never `none`.
 * - `overridden` (Python lowering 63, the listed reading only): a FastAPI dependency the repository replaces
 *   outside its tests (`app.dependency_overrides[dep] = ...`, `.update`, `.setdefault`); a route depending on it,
 *   directly or through another dependency, is never `known` by it.
 * - `hands_back_param` (Python lowering 63): a `return` of the function, or of one it defines, hands back one of
 *   its own parameters unchanged and another hands back something else; at a decorator position it is unknown.
 * - `keeps_value` (Python lowering 63; also in a method's `unread`): the body writes a value that is no literal
 *   on an object of its module (`ContextVar.set`, a `threading.local()` attribute, a module-level dict,
 *   `setattr`); a Python route whose reach writes one has authorization never `none`.
 * - `builtin_value:<parameter>.<member>` (TypeScript lowering 72, the listed reading only): the body calls a method
 *   on a member that the parameter's object type literal gives a built-in value's type (a string, a number, a
 *   boolean, a bigint or an array: `params: { path: string[] }`, then `params.path.join("/")`); the practice map
 *   reads that method as the built-in's, no code of the repository.
 */
export type PythonGuardControl = string;

/**
 * When an import edge loads its module (facts schema 6): `require` is a `require()` inside a
 * function, `dynamic` an `import()`, `lazy` a specifier passed to a lazy-load helper of the
 * repository. Absent: static (an import declaration or a top-level `require`).
 */
export type ImportLoad = "static" | "require" | "dynamic" | "lazy";

export interface Import {
  module: string;
  names: string[];
  type_only: boolean;
  load?: ImportLoad;
}

/** The import runs only when the code holding it runs (not with the module). */
export function isDeferred(i: Import): boolean {
  return !!i.load && i.load !== "static";
}

export interface FactSymbol {
  name: string;
  kind: SymbolKind;
  exported_as: string[];
  line: number;
  wraps: Wrap[];
  calls?: string[];
  renders?: string[];
  args?: string[];
  /** Control facts of the symbol (`rejects_caller`, `reads_input`, `no_input`, ...). In a file's listed reading (`FileFacts.listed`) only, since TypeScript lowering 64, for NestJS route metadata: `sets_metadata:<key>` on a decorator that calls `SetMetadata(KEY, value)` with a value true of every route it is written on (and on a route or a controller class `@SetMetadata(...)` is written on itself), the key as the text in double quotes or the canonical reference of the binding that holds it, `~` before the key where the value is not such a literal, `sets_metadata:?` where the key is not read; `opens_for_metadata:<handler|class|any>:<key>` on a guard class whose `canActivate` returns true, before it checks anything, where the route carries the key; `metadata_unread` on a guard class that reads route metadata, or hands its execution context on, in any other way. Since TypeScript lowering 65, in the listed reading, `drops_result_of:<callee>` also where every call of a function that may answer 401 on a response it was handed (and throws nothing) is a statement of its own: the body goes on after the answer, so the call is found and proves nothing. Since TypeScript lowering 74, in the listed reading, `exit_unread:<source>` on a body with a branch on a value of the caller (a session read, a credential header, the answer of a signature or secret compare; `<source>` is its canonical callee or `header:<name>`, empty where it is not read) whose exit hands back what the lowering does not read as a refusal or as a service: a refusal builder's response reaching a `return` through a local, a conditional or an `else`, a refusal after a branch that serves, a response whose status is a name (`{ status: UNAUTH }`, `fail(UNAUTH, ...)`), a constant-time compare in an `if` nothing else reads. The practice map says such a unit `unknown` and `drift security` lists the source as a guard that could not be read (`guard unknown`), where nothing else proves a guard; never `known`, never none. */
  controls?: string[];
  suppressions?: string[];
  reads?: string[];
  throws?: string[];
  sinks?: string[];
  /** What the callee's declared parameter type says about each passed key: `callee@index:key=required|optional|unknown` (TypeScript). */
  arg_types?: string[];
  /**
   * Canonical callees of `calls` the body calls only after it hands control on to its continuation
   * (`next()`, the wrapped handler) or on what that hands back (`mapAuthErrors(await next())`): they act
   * on the result, not on the caller, so Drift reads no guard into them (#60; TypeScript; omitted when empty).
   */
  after_continuation?: string[];
  /** Classes: canonical decorators on the class's fields (facts schema 5). */
  field_decorators?: string[];
  /** Python classes: their own `class Meta:` (`model=<ref>`, `abstract`, `proxy`) (facts schema 8). */
  meta?: string[];
  /** Python classes: `decorator=argument` for a class decorator called with a reference (facts schema 8). */
  decorator_args?: string[];
  /** Python: names the docstring explicitly says the symbol is not or does not use, `Name=phrase` (facts schema 8). */
  disclaims?: string[];
  /** A binding built from another by builder steps that only add to it, or bound to one: that binding and the steps (`server/p.ts#authedProcedure.input().use()`) (facts schema 7, TypeScript). */
  derives_from?: string;
  /** A value bound to a call of a factory proven to return a function: the factory's canonical callee (`lib/auth.ts#createAuthWrapper`); its `kind` is `function` (#91, TypeScript; omitted when empty). */
  made_by?: string;
  /**
   * Classes: each method with what it alone calls and its sinks (facts schema 10; omitted when empty).
   * `drift security` follows a method call into that method only. Not kept in slim facts.
   */
  members?: {
    name: string;
    calls?: string[];
    sinks?: string[];
    body_checks?: BodyCheck[];
    throws?: string[];
    /** Keys the method's own calls pass, as `args` (Python lowering 24, TypeScript lowering 53; omitted when empty). */
    args?: string[];
    /** The method's own queries filtered by a tenant-like key (Python lowering 24; omitted when empty). */
    scoped_queries?: ScopedQuery[];
    /** The method's own conditions that raise an error class (Python lowering 24; omitted when empty). */
    raise_checks?: RaiseCheck[];
    /** The repository's own decorators on the method, canonical, outermost first (Python lowering 26; omitted when empty). */
    decorators?: string[];
    /** The method's own calls on a receiver `calls` does not hold, as the symbol's `receiver_calls` (Python lowering 31, TypeScript lowering 55; omitted when empty). */
    receiver_calls?: string[];
    /** The method's own conditional calls, as the symbol's `conditional_calls` (Python lowering 32, TypeScript lowering 50; omitted when empty). */
    conditional_calls?: string[];
    /** What the method's own body calls, canonical, in the order of each callee's first call, a sibling method called through `this` or `self` among them; at most 16, then `*` once (Python lowering 51, TypeScript lowering 54; omitted when empty). */
    order?: string[];
    /** The method is declared `async`, as the symbol's `is_async` (Python lowering 46, TypeScript lowering 50; omitted when false). */
    is_async?: boolean;
    /** The method has a `return` and every `return` of its own body hands back the literal `true`: a NestJS `canActivate` that can only let the request through, whatever it calls on the way (TypeScript lowering 65; omitted when false). */
    returns_only_true?: boolean;
    /** What the method's own body does that no other fact records: `unread_exit` (it turns some requests away on a condition the facts do not hold) and `scope_unread` (it compares or filters by a tenant or owner key no fact records), as a function's `controls` hold them, and `status:403` (it answers 403 outside any `except`) (Python lowering 35; TypeScript lowering 53 records `scope_unread` only; omitted when empty). Since Python lowering 53 also `handler_rejects` (it answers "not signed in" in the `except` handler of a `try` it cannot pass otherwise), `handler_may_reject` (it does so in a handler where that is not proven) and `param_flows` (it compares a value of one of its own parameters with another value, or hands one to a call), as `controls` hold them. Since Python lowering 56 also `rejects_some` (it turns a caller away as not signed in or not allowed, and lets a request through that passed no such refusal: `if not token: return None` before the 401), as `controls` hold it beside `refuses_all` (a function that refuses and never returns). Since Python lowering 57 also what a permission test (`has_permission`, `test_func`) answers a caller who is not signed in, where its body says: `verdict:true` (it is `True` whoever asks), `verdict:signed_in` (it is false for such a caller) or `verdict:super` (it is false where the base class's own test is); a symbol decorated with Django's `user_passes_test` holds the same of its test in `controls` as `passes_test:signed_in`, `passes_test:true` or `passes_test:unread`. Since Python lowering 61 also what Django's `test_func` asks of a caller who IS signed in, where its body says: `asks:role` (a role, a group, a permission or a staff flag: `is_staff`, `is_superuser`, `has_perm(...)`, `groups.filter(...).exists()`) or `asks:status` (only the sign-in and the account's state: `is_authenticated`, `is_active`); with neither, the question was not read. A symbol decorated with `user_passes_test` holds the same in `controls` as `test_asks:role`, `test_asks:status` or `test_asks:unread`. The practice map names the test's wrapper a role guard only for `role`. Since TypeScript lowering 65 also `hands_on` (the method hands a parameter to a call the facts do not follow, as `listed.guard_calls[].hands_on` says of a function). */
    unread?: string[];
    /** The callees the method's own body hands a value of the caller to, as the symbol's `caller_args` (Python lowering 53; TypeScript lowering 66, which also writes `param_flows` in `unread`; omitted when empty). */
    caller_args?: string[];
  }[];
  /** Of `reads`, those made only on the server side of `typeof window` (facts schema 10, TypeScript). Not kept in slim facts. */
  server_reads?: string[];
  /** In-body checks that turn a caller away (facts schema 11; omitted when empty). Not kept in slim facts. */
  body_checks?: BodyCheck[];
  /**
   * Conditions whose first exit raises an error class, with the class raised (Python lowering 24;
   * omitted when empty): what a body check cannot say when the raise states no status. Mining
   * decides what the class means. Not shown by the Studio.
   */
  raise_checks?: RaiseCheck[];
  /**
   * The class an `Annotated[T, ...]` alias annotates (`RuleBookDep = Annotated[RuleBook,
   * Depends(get_rule_book)]` -> `app/services/rule_book.py#RuleBook`; a builtin as
   * `global#str`) (Python lowering 24; omitted when empty). Not shown by the Studio.
   */
  alias_of?: string;
  /**
   * Method calls on a value `calls` does not hold, named by what the receiver is: a local
   * bound to a call (`app/services.py#RuleBook().list`), what a dependency injects
   * (`app/deps.py#get_exporter().run`), an attribute (`<class>.repo.find`); `param:<name>.<path>`
   * or `local:<name>.<path>` where the receiver cannot be told and the call hands a value on
   * (Python lowering 31). TypeScript lowering 55 records a method called through `this` that
   * the class does not define, a method of a property whose type is not read
   * (`local:this.<property>.<path>`), and a call through a local that is another name for a
   * module's binding, canonical as what it names. Omitted when empty. Not shown by the Studio.
   */
  receiver_calls?: string[];
  /** Functions: the class every `return` of the body builds for the value handed back (Python lowering 31; omitted when empty). */
  returns_instance?: string;
  /** Functions: the class the return annotation names (Python lowering 31; omitted when empty). */
  returns_type?: string;
  /** Classes: the class of each attribute `__init__` binds on `self`, as `attribute=<canonical class>` (Python lowering 31; omitted when empty). */
  attr_types?: string[];
  /**
   * The repository's callees the body calls only where some requests do not get, as
   * `<why>:<canonical>` (`NotAlways`, or `not_awaited` for a call of an `async` callee whose value is
   * dropped): a callee the body also calls on every path is not listed; a package's is listed only
   * where it is a policy library's (Python lowering 32, TypeScript lowering 50; omitted when empty).
   * Not shown by the Studio.
   */
  conditional_calls?: string[];
  /** Functions only: declared `async`, or annotated to hand back a promise (Python lowering 46, TypeScript lowering 50; omitted when false). */
  is_async?: boolean;
  /** Functions only: the callees whose call's value the body hands back (`return proxyRequest(request)`, `return await load(url)`), canonical (Python lowering 36, TypeScript lowering 45; omitted when empty). */
  returns_calls?: string[];
  /**
   * The callees the body hands a value of the caller to: an argument read off the session or identity
   * (`request.user.staff`, `g.user.venue_id`), not a parameter of the handler itself. What the callee does with
   * it may be how the rows are scoped, so authorization is not read as `none` on it alone. A value of what a
   * declared dependency gives is written `<callee> via <dependency>`: the caller's where that dependency signs
   * the caller in (Python lowering 53; omitted when empty). Since Python lowering 58 `via` also names a
   * function of the repository called with nothing or with the request that returns a value of the caller
   * (its `controls` hold `returns_caller`), and an attribute of a request-scoped holder (`pkg:flask#g.<name>`,
   * `global#request.state.<name>`) that code of the repository binds a value of the caller on: that binding is
   * an entry with the holder as the callee, and a comparison or a filter with what a giver hands back is
   * `<giver> via <giver>` (since Python lowering 59 also for a declared dependency, where `controls` held
   * `scope_unread` whatever the dependency gave).
   *
   * TypeScript (lowering 66) records it in the listed reading only (`FileFacts.listed.symbols`): a value of the
   * caller is one of a closed list of sources (what a sign-in accessor returns, a member of the request or of a
   * request-scoped context that holds the caller, a parameter decorated or named for the caller, and what is read
   * off or bound to one), and an entry is every call given one that is no response, log or conversion, whatever
   * the library. `global#scope_unread` is a use with no callee to name (a comparison, a `switch`, an index, a
   * method of a local). `<callee> via <function>` names a function of the repository whose body returns a value
   * of the caller (its `controls` hold `returns_caller`), `<callee> via global#held.<key>` a key of a
   * request-scoped holder (`req.<key>`, `res.locals.<key>`, `c.get("<key>")`, a tRPC `ctx.<key>`) some body binds
   * a value of the caller on; that binding is the entry `global#held.<key>`.
   */
  caller_args?: string[];
  /** Entry points only: the middleware of the application that serves the route (`@app.middleware("http")` functions, `app.add_middleware(...)` classes), canonical; `global#<words>` for one that could not be read; after `?`, one that only some of the applications serving the route have, a Flask `before_request` hook registered under a branch or on what a factory returned among them (Python lowering 46); `?unread:<how>` is no middleware: the application went where Drift does not read what was registered on it, and `<how>` says where (Python lowering 47). TypeScript: the Fastify hooks of the route's instance, a middleware written in place before it and one given for a path that covers it (lowering 51); what every router the route is mounted through runs before the mount, a package's Fastify plugin the instance was handed to, and `?unread:<how>` where the router was handed to a function or the route's options or handlers are spread into the registration (lowering 56); the hooks of an object literal of the same file spread into the route's options (lowering 60); for a NestJS route, the middleware a module's `configure` applies for it and does not exclude it from and what is registered with `use` on the application, after `?` where that cannot be told from what is written (lowering 61); a listener written in front of the application (`http.createServer((req, res) => { ...; app(req, res) })`), as `<file>#listener <line>` (lowering 62); for a NestJS route, `nest_guard:<class>` for a guard class `app.useGlobalGuards(new Guard())` registers for the whole application (read as a class given to `@UseGuards` is), after `?` where the call stands under a condition or after a return some starts take, and `?unread:what app.useGlobalGuards is given` where the argument is no class built where it is given (lowering 64). Since lowering 65 every value written where a middleware or a hook goes is recorded: `global#fastify.<name>` for a member of a Fastify instance (`app.auth([...])`, `fastify.basicAuth`), the function a `decorate("<name>", fn)` of the repository gave it where that is read; `global#<words>` for a value with no name (a conditional, `a && b`, a computed member), the words saying what it is; a callback of Express `router.param(name, cb)` on the routes of that router whose path has the parameter; a function written in place as `<file>#<receiver> <position> <line>`; and `?unread:<how>` also for a wrapper that is not read where it is called and for hooks spread into the options of a route. Omitted when empty. */
  app_middleware?: string[];
  /** Responses the symbol sends (facts schema 11). Not kept in slim facts. */
  responses?: ResponseFact[];
  /** Log-call candidates (facts schema 11). Not kept in slim facts. */
  log_calls?: LogCall[];
  /** Catch / except clauses (facts schema 11). Not kept in slim facts. */
  catches?: CatchFact[];
  /** Request header names read, lower-case, from literals (facts schema 11). Not kept in slim facts. */
  headers?: string[];
  /** Canonical types or schemas request input is validated into (facts schema 11). Not kept in slim facts. */
  inputs?: string[];
  /** Canonical error classes this symbol handles, `status:<n>`, or `*` (facts schema 11). Not kept in slim facts. */
  handles_errors?: string[];
  /** Capped practice fields of this symbol that lost entries (`body_checks`, `responses.keys`, ...): unknown, not none. Not kept in slim facts. */
  truncated?: string[];
  /**
   * Kinds of class beyond its location (`enum`, `dataclass`, `protocol`, `abstract`, `base`, `view`,
   * `type_var`, ...) and the purpose facts `subclassed` and `test_helper` (#35); sorted, absent for
   * primary classes. Labels: entities/facts SYMBOL_TRAIT.
   */
  traits?: string[];
}

/** What a body check does to the caller it turns away (facts schema 11). */
export type CheckOutcome = "unauthenticated" | "forbidden" | "not_found" | "throttled" | "sign_in_redirect" | "invalid";

/** A check in the body that turns a caller away, and what its condition reads (facts schema 11). */
export interface BodyCheck {
  /** Canonical callee whose result is tested, `param:<name>`, `header:<name>`, or "". */
  source: string;
  /** Member path read off the source (`.user.orgId`), or "". */
  reads: string;
  /** "" (truthiness), `param:<name>`, `header:<name>`, `literal` or `call:<canonical>`. */
  compares: string;
  outcome: CheckOutcome;
  /** How the condition compares the value with another; omitted when it compares nothing (Python lowering 25, TypeScript lowering 42). */
  op?: CheckOp;
  /** The check sits inside a branch only some requests take (under another `if`, in a loop); omitted when false (Python lowering 28, TypeScript lowering 43). */
  conditional?: boolean;
  /** Why the check is conditional; omitted when it is not (Python lowering 32; TypeScript lowering 50 says `under_branch` or `after_conditional_return`, lowering 54 `and_operand` too; lowering 60 says `swallowed` of a `try` whose handler answers 401 for some of what it catches only, or after which the request is handed on all the same; lowering 75 says `unread_local` of a condition that tests a local the body assigns more than once). */
  condition?: NotAlways;
  /** The condition in the code's own words (`only when caller.org_id is not None`, `not when rule.visibility == Visibility.SHARED`); literals are not echoed; omitted when the lowering cannot state it (Python lowering 32; TypeScript lowering 54 for an operand of `&&`). */
  unless?: string;
  /** The member path read off what the value is compared with, as `reads` is off `source` (`rule.orgId !== req.user.orgId` gives `.user.orgId`); omitted when empty (TypeScript lowering 54). */
  compares_path?: string;
  /** What the body calls before the check, canonical, in the order of each callee's first call; at most 16, then `*` once (Python lowering 46, TypeScript lowering 50; omitted when empty). */
  after?: string[];
}

/**
 * Why a check or a call does not run for every request that reaches the body: under another
 * branch or in a loop; after a branch that returns without refusing; as an operand of `and`; on the
 * right of `or`; in a `try` whose handler may serve the request all the same; (TypeScript lowering 75) in a
 * condition that tests a local the body assigns more than once, whose value at the test is not read.
 */
export type NotAlways = "under_branch" | "after_conditional_return" | "and_operand" | "bypass_operand" | "swallowed" | "unread_local";

/**
 * How a check's condition compares its value: `ne` turns the caller away where the two
 * values differ (`a != b`, `a not in b`, `!(a === b)`, the `else` of `a === b`), `eq`
 * where they match, `other` is another comparison (`<`).
 */
export type CheckOp = "ne" | "eq" | "other";

/** A condition whose first exit raises an error class (Python lowering 24). */
export interface RaiseCheck {
  /** As `BodyCheck.source`. */
  source: string;
  /** As `BodyCheck.reads`. */
  reads: string;
  /** As `BodyCheck.compares`, and `value` for a comparison with a value that could not be read. */
  compares: string;
  /** Canonical class the exit raises. */
  raises: string;
  /** The status the raise states as a literal; omitted when it states none. */
  status?: number;
  /** As `BodyCheck.op` (Python lowering 25). */
  op?: CheckOp;
  /** As `BodyCheck.conditional` (Python lowering 28). */
  conditional?: boolean;
  /** As `BodyCheck.condition` (Python lowering 32). */
  condition?: NotAlways;
  /** As `BodyCheck.unless` (Python lowering 32). */
  unless?: string;
  /** As `BodyCheck.after` (Python lowering 46). */
  after?: string[];
}

/** A data-access call whose filter names a tenant-like key, and where the value came from (facts schema 11, Python). */
export interface ScopedQuery {
  callee: string;
  key: string;
  source: "unknown" | "session" | "param" | "header" | "literal";
  /** Why the filtering call does not run for every request that reaches the body (under a branch, in an arm of a conditional expression, after a return that serves); omitted when it does (Python lowering 52). */
  condition?: NotAlways;
}

/** How a response is sent (facts schema 11). */
export type ResponseVia = "return" | "throw" | "setter" | "abort" | "declared" | "redirect";

/** One response a symbol sends (facts schema 11). */
export interface ResponseFact {
  /** HTTP status; 0 when not a literal or known constant. */
  status: number;
  via: ResponseVia;
  /** Canonical builder or class, "" for a literal. */
  builder: string;
  /** Declared response model or schema, canonical, or "". */
  model: string;
  /** Top-level keys of the body object literal, sorted, at most 8: the error envelope. */
  keys: string[];
  in_catch: boolean;
}

/** A call to a level-named method or a print (facts schema 11). */
export interface LogCall {
  callee: string;
  /** trace, debug, info, warn, error, fatal, exception, log or print. */
  level: string;
  in_catch: boolean;
  structured: boolean;
  passes_error: boolean;
}

/** One catch / except clause (facts schema 11). */
export interface CatchFact {
  /** Canonical classes caught, sorted; `*` for a bare catch. */
  catches: string[];
  /** `rethrow`, `throw:<canonical>`, `log`, `respond:<status>`, `report:<canonical>`, `return`, `swallow`. */
  does: string[];
}

/** A request a test makes (facts schema 11, test files only). */
export interface TestRequest {
  /** GET, POST, ... or ANY. */
  method: string;
  /** Route template, dynamic segments as `[*]`, or "" when not a literal. */
  route: string;
  /** Canonical module whose handler the test calls directly, or "". */
  target: string;
  statuses: number[];
  /** The route had a non-literal part (a base-URL constant): which route is tested is unknown. Absent when false. */
  dynamic?: boolean;
}

/** What a route matcher's patterns mean for the routes they match; absent means `unknown`. */
export type MatcherPolarity = "applies" | "public" | "unknown";

/** Route patterns a middleware applies to (facts schema 11). */
export interface RouteMatcher {
  binding: string;
  patterns: string[];
  /** A pattern was dropped or the matcher is not a literal; an empty `patterns` is always opaque. Absent when false. */
  opaque?: boolean;
  polarity?: MatcherPolarity;
}

export interface EntryPoint {
  symbol: string;
  kind: string;
  method: string | null;
  route: string | null;
  adapter: string;
}

export interface FileFacts {
  path: string;
  hash?: string;
  lang: string;
  package: string;
  parse_ok: boolean;
  directives: string[];
  imports: Import[];
  exports?: unknown[];
  symbols: FactSymbol[];
  entry_points: EntryPoint[];
  has_test?: boolean;
  client_leaks?: string[];
  /** Test files: the requests the tests make (facts schema 11). Not kept in slim facts. */
  test_requests?: TestRequest[];
  /** Canonical modules mocked, and `msw:<route>` for MSW handlers (facts schema 11). Not kept in slim facts. */
  mocks?: string[];
  /** Route patterns a middleware in the file applies to (facts schema 11). Not kept in slim facts. */
  route_matchers?: RouteMatcher[];
  /**
   * The requests the file's code sends with an HTTP client (not recorded for test files). `url` is the URL as written,
   * each value as `{}` (absent when it is not an argument that is read). `unread`, when present, says why its path is
   * not written out (built from the request being served, or not read): such a request may relay what the application
   * is asked for. Absent when empty.
   */
  outgoing?: { line: number; within?: string; url?: string; unread?: string }[];
  /** Capped file-level practice fields that lost entries (`test_requests`, `route_matchers.patterns`, ...). Not kept in slim facts. */
  truncated?: string[];
  /**
   * The file with every entry-point listing Drift makes, where listings that mining does not read yet change it:
   * all its entry points, and the symbols whose facts differ with them, whole (by `name` and `line`). `drift security`
   * and the practice map read this; `entry_points` and `symbols` above are what mining and rules read (held at the
   * last measured build's listings). Absent for every other file.
   */
  listed?: {
    entry_points: EntryPoint[];
    mounts?: unknown[];
    symbols?: FactSymbol[];
    /**
     * TypeScript lowering 65: the calls whose shape decides what they are where a guard goes, by symbol (`symbol` and
     * `line`). For an entry point, each call written where a middleware, a hook or a wrapper of the route goes; for any
     * other symbol, the calls it makes of a package on the closed list of library guards. A file that has these keeps a
     * listed reading for them alone. Sorted; absent when empty.
     */
    guard_calls?: GuardSymbolCalls[];
    /**
     * TypeScript lowering 65, a `next.config.*` file only: the rewrites its `rewrites` function returns, each `source`
     * and `destination` as written; `?` for one that is not a literal, both `?` for what the function returns that is
     * not read; a destination on another host keeps the text it begins with (`https://`). The package's middleware
     * runs for the path a request asks for, so a route a rewrite reaches from a path the middleware is not shown to
     * guard is `unknown` (`unresolved`, instrument `<file>#rewrites`). Since lowering 67 what is assigned to a
     * `rewrites` member (`nextConfig.rewrites = async () => [...]`) is read as the key is, and one rewrite that is not
     * read (both `?`) is also recorded where the exported configuration goes through a wrapper that is not on the
     * closed list of those that add no rewrite (`export default withProxy(nextConfig)`), and where rewrites stand
     * beside a `basePath`. Sorted; absent when empty.
     */
    rewrites?: { source: string; destination: string }[];
  };
}

/** The calls of one symbol recorded with their shape (`FileFacts.listed.guard_calls`, TypeScript lowering 65). */
export interface GuardSymbolCalls {
  symbol: string;
  line: number;
  /** At most 32, sorted (absent when empty). */
  calls?: GuardCall[];
  /** The body hands a parameter (the request, the response, the continuation) to a call the facts do not follow, or a value to a method of a local binding: never read as a function that turns no one away (absent when false). */
  hands_on?: boolean;
  /** Every `return` with a value hands back a function written where it is returned: called where a guard goes, what runs is in its own body (absent when false). */
  returns_function?: boolean;
  /** The callees every call of which stands in a `try` that has a handler, as `calls` writes them (absent when empty). */
  caught?: string[];
  /** Calls of a verifying member of a parameter (`jwtVerify`, `verify`, `verifyIdToken`, `authenticate`) outside any `try`, as `param:<parameter>.<member>` (absent when empty). */
  verifies?: string[];
  /** The function's body does something with a value of one of its own parameters: hands one to a call that is no response, log or conversion, compares one, switches or indexes by one (TypeScript lowering 66; absent when false); since lowering 68 also returns one (`return depot.trim()`), a rest parameter and a member of a parameter only named like a request or a context (`ctx.depot`) counting as values of its parameters. A call given a value of the caller into a function without it reads a body that does nothing with the value. */
  param_flows?: boolean;
}

/**
 * One call at a guard position, or of a library's guard: `callee` as a wrap of it is written
 * (`pkg:passport#default.authenticate`, `src/auth.ts#requireRole`), and the arguments of each call of the chain,
 * first call first. Three callees are no call: `global#[]` (an array a binding holds: one argument list, its
 * elements), `global#{}` (an options object a binding holds: one argument, the object) and `global#.use` (a step
 * `.use(...)` of a builder chain a binding holds). A member of a Fastify instance at a guard position is
 * `global#fastify.<name>` (`app.auth`, `fastify.basicAuth`), here and in `wraps`, `app_middleware`, `guards` and
 * `opaque`.
 */
export interface GuardCall {
  callee: string;
  args?: GuardCallArg[][];
}

/**
 * One argument of a recorded call, at most 4 levels deep and 16 items wide, tagged by its single key:
 * `{ text }`, `{ bool }`, `{ number }` (as written), `"null"`, `{ list: [...] }`, `{ object: [[key, value], ...] }`
 * (`...` as the key of a spread or of a key that is not a name), `{ ref: canonical }`, `{ call: GuardCall }`, `"function"` (written in place),
 * `"spread"`, `"unread"` (anything else). Treat a form not listed here as `"unread"`.
 */
export type GuardCallArg =
  | "null"
  | "function"
  | "spread"
  | "unread"
  | { text: string }
  | { bool: boolean }
  | { number: string }
  | { list: GuardCallArg[] }
  | { object: [string, GuardCallArg][] }
  | { ref: string }
  | { call: GuardCall };

/** Why a file was not analysed. `too_deep`: nesting beyond Drift's limit (it would overflow the parser), so Drift fails closed. `too_costly`: syntax that makes the TypeScript/JavaScript parser re-read large spans (or a parse that ran out of its memory budget) would take far more memory than the file's size, so Drift fails closed. `stack_unavailable`: the scan could not reserve a stack large enough to parse the file safely (an address-space or memory limit on that run), so it fails closed for that run; not cached, a later scan with room parses it. `flow_syntax`: JavaScript with Flow type annotations that cannot be read, or removed with certainty to leave plain JavaScript, so Drift fails closed. */
export type SkipReason = "too_large" | "generated" | "minified" | "declaration" | "not_utf8" | "too_deep" | "too_costly" | "stack_unavailable" | "flow_syntax";

export interface RepoFacts {
  schema_version: number;
  files: FileFacts[];
  skipped: { path: string; reason: SkipReason }[];
  models?: { path: string; name: string; source: string; line: number; fields: string[] }[];
  packages?: {
    path: string;
    name: string;
    scripts: string[];
    dependencies: string[];
    /** `name@range` from `peerDependencies` (facts schema 6; omitted when empty). */
    peer_dependencies?: string[];
    /** `name@range` the package runs without: `optionalDependencies` and optional peers (facts schema 6). */
    optional_dependencies?: string[];
    compiler_flags: string[];
    /** Package names only in devDependencies or Python dev/test/lint groups (facts schema 11; omitted when empty). */
    dev_only?: string[];
  }[];
}

// ---------- rules and roles (crates/drift-mine/src/{mine,roles}.rs) ----------

export interface RoleSelector {
  package: string;
  dir: string;
  file: string;
  entry: string;
  kind: SymbolKind;
  /** For classes of a special kind (`enum`, `dataclass`, ...): that kind; such classes form roles of their own. */
  variety?: string;
  /** For an export whose name the file's framework reserves (Next.js `generateMetadata`, `generateStaticParams`, ...): that name; each reserved name forms roles of its own. */
  export_name?: string;
  /** For a member of a kind of its own (a Python class's framework lineage: `serializer`, `model`, `form`, `admin`, `inline`, `mixin`, `exception`, `view`): that kind; each kind forms roles of its own (selector version 3). */
  member_kind?: string;
  /** For a test role or a kind role (selector version 4, off by default: `census --test-roles` / `--kind-roles`): the shape of its members (`py:test`, `ts:hook`, ...). A role of one shape across the repository has the package `*`. Absent for every other role. */
  shape?: string;
  /** A merged card's sibling roles (round 9, D): the same rule on sibling folders or sibling file kinds, one card. Each is a plain role (no `also`); the card's members are this role's (read without `also`) and each sibling's. Absent for every other role. */
  also?: RoleSelector[];
}

export type Rule =
  | { type: "wrapped_by"; kind: WrapKind; any_of: string[] }
  | { type: "passes_key"; callee: string; index: number; key: string }
  | { type: "calls"; callee: string }
  | { type: "renders"; component: string }
  | { type: "directive"; value: string }
  | { type: "control"; value: string }
  | { type: "throws"; class: string }
  | { type: "named"; pattern: string }
  | { type: "before"; first: string; then: string }
  | { type: "avoids"; signal: string }
  | { type: "has_test" }
  | { type: "prefers_library"; group: string; preferred: string }
  | { type: "model_has"; field: string }
  | { type: "package_has"; item: string }
    /** `range` absent: "the range most workspace packages use", re-evaluated by check; present: a pin. */
  | { type: "dependency_version"; name: string; range?: string }
  /**
   * Members that use `name` take it from `source`, not from the other places that provide the
   * same thing (`instead_of`): `TypedDict` from typing_extensions, not typing. Canonical
   * references; Python only (#35). Always a suggestion (`tier_reason: "rule_kind"`).
   */
  | { type: "imports_from"; name: string; source: string; instead_of: string[] }
  /**
   * Experimental wiring rules (#38; `experimental: [wiring]` in .drift/config.yaml or
   * `DRIFT_EXPERIMENTAL=wiring`): suggestions that never block, inert while the flag is off.
   * `registered_in`: the member is named by the list at `slot` in `path` (no `path`: by some
   * list of the family `slot`), or a list reachable from it; `named` narrows to a name
   * pattern; `reach`: mined counting members registered only in reachable lists.
   */
  | { type: "registered_in"; slot: string; path?: string; named?: string; reach?: boolean }
  /** Every key of `from` is also in `to` (co-change mined from git history). */
  | { type: "mirrors_keys"; from: string; to: string }
  /**
   * A practice a person promoted from the practice map (`drift practices promote`, docs/v2/PROMOTE-A-PRACTICE.md):
   * a unit of `concern` in the convention's place follows it when the map says it does the concern one of the ways in
   * `any_of` (practice-map variant keys, never names). Checked by the classifier that draws the map: a unit it cannot
   * tell is never a violation. Always a suggestion.
   */
  | {
      type: "practice";
      concern: string;
      any_of: string[];
      /** Mechanisms accepted whole, in the classifier's vocabulary (`wrap`, `dependency`, `permission`, ...: the part of a variant key before its first `:`): a unit doing the concern by one of them follows, whichever instrument it names. Absent when none (newer drift). */
      any_mechanism?: string[];
      /** Any way the classifier says enforces the concern follows ("every entry point here signs the caller in, however"). Absent when not set (newer drift). */
      any_enforcing?: boolean;
      /** The one file the practice holds in (repo-relative), when its place is a file rather than its role's directory (`promote::Place::file`). Absent for a directory (newer drift, policy version 3). */
      in_file?: string;
      /** The literal route prefix it holds under, in its role's package, each parameter as `[*]` (`/api/workspaces/[*]`, `promote::Place::route`), or the keys of a tRPC procedure path ending in `.` (`viewer.me.`, newer drift). Absent for a directory (newer drift, policy version 3). */
      under_route?: string;
    };

/**
 * Where a wiring fix goes (crates/drift-mine/src/check.rs `WireHint`): `register` a symbol in a
 * registry, or `mirror` a key into another file. `line` is where the list starts (0: unknown,
 * a barrel's re-exports).
 */
export interface WireHint {
  action: "register" | "mirror" | (string & {});
  path: string;
  line: number;
  /** What to add to, for people: `Module() providers`, `` `urlpatterns` ``, `re-exports`, `keys`. */
  label: string;
  /** A sibling already there and the line it is listed at (0: unknown); `path` declares it (for a key: the file it is mirrored to). */
  like?: { name: string; line: number; path?: string } | null;
  /** In a violation: what is missing. */
  entry?: { symbol: string; path: string; line: number } | null;
}

/** A registry census saw (`census --json` `wiring.registries[]`), and why it was or was not proposed. */
export interface WiringRegistry {
  path: string;
  line: number;
  slot: string;
  label: string;
  lists: number;
  role: RoleSelector;
  role_summary: string;
  members: number;
  covered: number;
  /** `proposed`, `subsumed`, `below_threshold`, `opaque`, `autodiscovered:<why>`. */
  status: string;
}

/** `census --json` `wiring` (only while the experimental flag is on). */
export interface CensusWiring {
  enabled: boolean;
  params?: { min_coverage?: number; min_members?: number; min_files?: number; max_rules?: number; cochange?: { min_share?: number; min_commits?: number; window?: number; max_rules?: number } };
  registries?: WiringRegistry[];
  /** Co-change from git: `history` is `read`, `shallow`, `partial_clone`, `no_git`, `failed`, `timeout` or `too_large`. */
  cochange?: { history: string; head: string | null; commits: number; rules: number };
}

export interface Evidence {
  holders: number;
  /** Members the rule is about (with #27, the role minus its exempt members). */
  total: number;
  /** The whole role's size when the rule is about part of it (newer drift); it decides the tier and blocking. */
  role_members?: number;
  lower_bound: number;
  lift: number;
  /** For variant sets: `[alternative, members using it]`. */
  split?: [string, number][];
  /** How many of the role's members are Python; absent when none is. Decision D7: any makes the convention advise only. */
  python_members?: number;
}

export interface Outlier {
  path: string;
  symbol: string;
  line: number;
}

/**
 * Why a rule is not about a member, as a machine-readable kind (#45; absent from older
 * drift): crates/drift-mine/src/mine.rs `Exempted::new`. Key any per-kind display on this,
 * never on the `reason` text. Values not listed here may appear: treat them as unknown,
 * and show `reason`. Labels: entities/convention EXEMPTION_CODE (the coverage test pins
 * this list to mine.rs).
 */
export type ExemptionCode =
  | "another_kind"
  | "defining_module"
  | "enum"
  | "named_for_base"
  | "does_not_call"
  | "does_not_use"
  | "defines_alternative"
  | "no_input"
  | "root_file"
  | "factory"
  | "companion"
  | "shared_part"
  | "registered_key"
  | "documented_exception"
  | "opt_out"
  | "own_target"
  | "does_not_override"
  | "sibling_base"
  | "plain_value"
  | "type_only"
  | "no_counterpart"
  /** A reviewer marked the outlier fine (`exceptions` in conventions.yaml): drift-mine check.rs `REVIEWED`. */
  | "reviewed"
  /** A person set its file apart as a different kind (`different_kind` in conventions.yaml, `drift review --answer ID=different`): drift-mine check.rs `DIFFERENT_KIND`. */
  | "different_kind";

/** A role member a rule is not about, with Drift's reason (census and check `exempt[]`). */
export interface Exempt extends Outlier {
  /** Drift's reason, for people: `does not call FieldSet()`, `another kind of class (extends Field)`, `in the module that defines BaseModel`. */
  reason: string;
  /** The reason's kind (newer drift); optional. */
  code?: ExemptionCode | (string & {});
}

// ---------- drift census --json (crates/drift-cli/src/main.rs, schema 1) ----------

/**
 * Where a convention proposed from Drift's map of the code comes from (`policy::Convention::from_map`): `layering`
 * (crates/drift-mine/src/from_map.rs `layering`), `manifest`, or `practice`. Such a proposal did not pass through the
 * miner's measured gates. Absent on everything the miner proposed.
 */
export type FromMap = "practice" | "layering" | "manifest";

export interface CensusProposal {
  id: string;
  /** Study use only (`census --gate-candidate NAME`): the candidate change to a mining gate without which this proposal would not exist. Absent with no switch on, which is how the Studio runs census. */
  gate_candidate?: string;
  /** Position in the human views: the default tier first, then suggestions best first (newer drift: `drift_mine::rank`; older drift: mining order). */
  rank: number;
  /** False for a suggestion past `suggestion_cap`: listed only with `--all` (newer drift; absent before W4). The cap never hides it from check or agents (what agents see is `agents`, W0). */
  shown_by_default?: boolean;
  summary: string;
  role: RoleSelector & { members: number };
  rule: Rule;
  evidence: Evidence;
  tier: Tier;
  /** Structured rule kind (`wrapped_by:call`, `avoids:import`, ...), what the tier is keyed on. */
  rule_kind?: string;
  /** Why a suggestion is one (D5, D7): a Python convention, a kind D7 moved out, another rule kind, a package's symbol, or a small role; null in the default tier. */
  tier_reason?: TierReasonCode | null;
  /** The language the tier reads (D7): `py` when any member of the role is Python, else `ts` (newer drift). */
  language?: "ts" | "py";
  /** The rule names a symbol of a package rather than of the repository (D5). */
  names_package?: boolean;
  /** Whether agents are shown it (W0 family admission), and why (newer drift). */
  agents?: AgentsView;
  /** `passes_key` rules: what the callee's declared parameter type says about the key, over every call that passes it (absent when no call has type facts). */
  key_type?: KeyType;
  blockable: boolean;
  example: { path: string; symbol: string; line: number };
  outliers: Outlier[];
  outliers_total: number;
  /** Role members the rule is not about, with Drift's reason (`does not call FieldSet()`); not outliers, not in `total`. */
  exempt?: Exempt[];
  /** Holders that hold the rule through an in-repo base's declaration, not in their own body. */
  inherited?: Outlier[];
  /** Wiring rules only (#38): the registry to edit, the lists the rule covers, and for co-change the history read. */
  wiring?: { registry?: WireHint | null; lists?: number; history?: { head: string | null; commits: number; max: number } | null };
  /** Members in files that depend on a file not parsed for lack of stack: their verdict may change once it is (newer drift; absent when 0). */
  unchecked_members?: number;
  /**
   * Holders of a call-wrapper rule wrapped in a binding built on the rule's wrapper
   * (`bookingsProcedure = authedProcedure.use(...)`), or in its builder chain with more
   * steps: the member's `wrapper` and the rule's wrapper it counts as (`from`), canonical.
   */
  derived?: (Outlier & { wrapper: string; from: string })[];
}

export interface CensusPythonProposals {
  enabled: false;
  decision: string;
  withheld: number;
  /** How to turn them on, in Drift's words. */
  opt_in: string;
}

export interface CensusSuggestionCap {
  cap: number | null;
  from: "default" | "conventions.yaml" | "flag" | "all" | (string & {});
  /** Suggestions census proposed, and how many of them the cap lists. */
  suggestions: number;
  listed: number;
}

export interface Census {
  schema: number;
  engine: string;
  commit: string | null;
  root: string;
  units: number;
  roles: number;
  conventions: number;
  /** Proposals listed (with `--tier`, fewer than `conventions`). */
  shown?: number;
  tiers?: { default: number; suggestion: number };
  /** How many suggestions human views list (newer drift, W4): `cap` null for all; `from` is `default`, `conventions.yaml`, `flag` or `all`. */
  suggestion_cap?: CensusSuggestionCap;
  params: CensusParams;
  proposals: CensusProposal[];
  /** Experimental wiring (#38): present only while the flag is on. */
  wiring?: CensusWiring;
  /**
   * W0 (newer drift): how many proposals agents are not shown, and the admission table's source run (null: no table).
   * `candidates` (D13, newer drift; absent when 0): how many of them are default-tier block candidates.
   */
  agents?: { hidden: number; candidates?: number; admission: { kind: string; file?: string; run?: string; date?: string | null; min_accept?: number; min_cards?: number } | null };
  /**
   * D13-py: present only while Python mined proposals are off, with how many census did not make. Off is a person's
   * `proposals: {python: off}` in .drift/config.yaml (and was the default before the dev5 check passed). Absent when
   * they are on (the default; or `census --python-proposals`), and from older drift, which always made them.
   */
  python_proposals?: CensusPythonProposals;
  /** With no proposals: the largest role Drift saw (newer drift); null otherwise. */
  largest_role?: { role: RoleSelector; members: number; summary: string } | null;
  /** Files not parsed for lack of stack, left out of every count (newer drift; absent when empty). */
  unchecked?: string[];
  /**
   * With `--from-map` only (the Studio does not pass it): the proposals from Drift's map of the code, then what qualified
   * and is not proposed, with why (crates/drift-cli/src/from_map_cli.rs `census_json`). A proposal from the map never
   * appears in `proposals`, which are the miner's: it reaches the Studio through `.drift/conventions.yaml` (`from_map`).
   */
  from_map?: CensusFromMapEntry[];
}

/** One entry of `census --from-map --json` `from_map` (from_map_cli.rs `census_json`). */
export type CensusFromMapEntry =
  | {
      proposed: true;
      id: string;
      /** `practice` or `layering`. */
      kind: FromMap;
      summary: string;
      /** The convention as `.drift/conventions.yaml` would hold it (`from_map` set). */
      convention: Convention;
      /** Conventions already in the policy or mined that say the same rule. */
      same_rule: { id: string; summary: string; status: "accepted" | "proposed" }[];
      /** Units (practice) or files (layering) that follow it. */
      follows: number;
      /** Units recorded as differing today (0 for layering). */
      differ: number;
      unknown: number;
      /** A practice proposal: what promoting it records, and how many current departures it would settle. */
      candidate?: PromoteCandidate;
      settles?: number;
      /** A layering proposal: what the structure map shows (from_map.rs `LayeringEvidence`). */
      layering?: FromMapLayeringEvidence;
    }
  | {
      proposed: false;
      id: string;
      kind: FromMap;
      summary: string;
      /** Why it is not proposed (from_map_cli.rs `Reason::code`). */
      reason: "passive" | "preview_concern" | "python_off" | "overlaps" | "same_as_mined" | "not_shown" | "over_cap" | (string & {});
      /** The same, in words. */
      why: string;
    };

/** What a layering proposal from the map rests on (crates/drift-mine/src/from_map.rs `LayeringEvidence`). */
export interface FromMapLayeringEvidence {
  layer: string;
  target: string;
  importing: number;
  members: number;
  importing_target: number;
  target_files: number;
  reverse_files: number;
  reverse_declared: boolean;
  /** The third layer the target reaches the layer through; absent when none. */
  through?: string;
  lint_forbids: boolean;
  example: string;
}

/**
 * The per-convention decision record about agents (`drift_mine::admission::Decision`, W0): whether Drift shows it
 * to agents (hooks, MCP, `drift check` text, AGENTS.md), why, and what decided. The default tier once a person accepted
 * it (D13; before that it is a block candidate, reason `candidate`, shown to people first; older drift showed it always); a
 * suggestion when the admission source admits it (today the rule-family table: the bar is in the table, 85% accepted
 * of >= 10 labelled cards as committed), a person chose `agents: show`, or a person forced it to block. Everything
 * else stays visible to people only.
 */
export interface AgentsView {
  shown_to_agents: boolean;
  reason: AgentsReason | (string & {});
  /** What decided: `default tier`, `conventions.yaml agents: show`, or the source with its run and bar. */
  source?: string;
  /** The study family (`naming`), when the rule kind has one. */
  family?: string;
  /** The family's suggestion-tier record in the convention's language: accepted of n labelled cards. */
  accepted?: number;
  n?: number;
  /** Drift's words: `not shown to agents (family below admission bar: 56% of 37)`. */
  text: string;
}
export type AgentsReason = "default_tier" | "candidate" | "admitted" | "verified" | "person" | "blocks" | "below_bar" | "unknown_family" | "no_table";

/**
 * An accepted suggestion's standing with the experimental agent verifier (`check --format json`
 * `conventions[].verify`, `drift_mine::verify::VerifyStatus`): present only with `agents.verify: on` in
 * conventions.yaml. The host agent runs the frozen prompt 3 times over MCP (`drift_verify_card`); 2 of 3 passing
 * samples verify the card while its content stays the same. Unvalidated (decision D10.3).
 */
export interface VerifyView {
  state: "passed" | "not_passed" | "stale" | "unverified" | (string & {});
  /** Samples that passed, of `samples` (a fresh cached verdict only). */
  passes?: number;
  samples?: number;
  /** Drift's words: `verified by agent (2/3)`, `not verified (agent verdict 1/3)`, ... */
  text: string;
}

export type Tier = "default" | "suggestion";
/**
 * `drift_mine::tier::tier_reason`, the first default-tier condition a suggestion fails, in this order:
 * `language_advise` (a Python convention: Python advises only, decision D7), `rule_kind_d7` (a decorator,
 * base-class or JSX-wrapper rule: in D5's default tier, a suggestion since D7), `rule_kind` (any other kind
 * outside the default tier), `names_package` (D5) and `small_role`.
 */
export type TierReasonCode = "language_advise" | "rule_kind_d7" | "rule_kind" | "names_package" | "small_role";
export type KeyType = "required" | "optional" | "unknown" | "mixed";

export interface CensusParams {
  max?: number;
  max_per_role?: number;
  min_role_size?: number;
  min_block_role_size?: number;
  min_lower_bound?: number;
  min_lift?: number;
  min_lift_external_call?: number;
  /** The default tier's definition: an allowlist of rule kinds and a role size. */
  tier?: {
    default_rule_kinds: string[];
    min_members: number;
    /** D5: `in_repo`, the rule's targets are the repository's own. */
    target?: string;
    /** The decision that defines the tier (`D7`); absent before D7. */
    decision?: string;
    /** D7: languages whose conventions may be in the default tier (`ts`). */
    default_languages?: string[];
    /** D7: languages whose conventions are all suggestions (`py`: Python advises only). */
    advise_only_languages?: string[];
  };
  /**
   * The show policy (newer drift, `drift_mine::show`, PLAN-R10 §4): the frozen table that says which suggestions are
   * shown at all (at most `max_outliers` outliers, a family `admitted` per language under leave-one-repo-out); null
   * without a table. Hidden cards are not in `proposals`. Not shown by the Studio (provenance only).
   */
  show?: { file: string; schema: number; run: string; date: string | null; min_accept: number; min_cards: number; max_outliers: number; admitted: Record<string, string[]> } | null;
}

// ---------- .drift/conventions.yaml (crates/drift-mine/src/policy.rs) ----------

export type Status = "accepted" | "proposed" | "rejected";
export type Mode = "advise" | "block";

export interface Convention {
  id: string;
  status: Status;
  mode: Mode;
  summary: string;
  role: RoleSelector;
  rule: Rule;
  evidence: Evidence;
  example: string;
  /** How `role` is read: absent (1) for a convention written before reserved exports had roles of their own, whose selector also holds them; 2 since; 3 since Python class roles split by member kind (a v1/v2 selector without `member_kind` also holds every kind at its place). Drift keeps it as written. */
  selector_version?: number;
  /** A person's override of the family admission (W0): `show` shows it to agents whatever its family's track record. */
  agents?: "show";
  /** Outliers a reviewer marked fine, with the reviewer's reason (`drift review --exempt`); absent when none. */
  exceptions?: PolicyException[];
  /** Files a person set apart as a different kind (the one question, `drift review --answer ID=different`); absent when none. */
  different_kind?: PolicyDifferentKind[];
  /** A person promoted it from the practice map (`drift practices promote`): the variant id (`P-…`) it came from. Its rule is a `practice` rule. Absent for every other convention. */
  promoted_from_practice?: string;
  /** Proposed from Drift's map of the code, not by the miner: it did not pass through the miner's measured gates. Absent on every mined convention (newer drift). */
  from_map?: FromMap;
  /** What a person saw when they accepted it (`policy::AcceptedEvidence`): the role's size, holders of total, the lower bound. Absent when not recorded (newer drift). */
  accepted_evidence?: { role_size: number; holders: number; total: number; lower_bound: number };
}

/**
 * A file a person set apart from its convention as a different kind of thing (`drift_mine::policy::DifferentKind`):
 * `drift check` lists its members as exempt (code `different_kind`), except an entry point under an auth or validation
 * rule that is not in `entry_points` [STRICT].
 */
export interface PolicyDifferentKind {
  path: string;
  /** Entry points the person confirmed one by one, apart from setting the file apart; absent when none. */
  entry_points?: string[];
}

// ---------- drift review --json (crates/drift-mine/src/calibrate.rs) ----------

/** A member a block candidate's question shows as following the rule (the example first). */
export interface QuestionHolder {
  path: string;
  symbol: string;
  line: number;
}

/** A member a block candidate would flag. */
export interface QuestionFlagged {
  symbol: string;
  line: number;
  /** An entry point under an auth or validation rule: setting its file apart covers it only with its own confirmation. */
  needs_confirmation: boolean;
  /** Baselined in drift.lock. */
  legacy: boolean;
}

/** The flagged members of one file: what a person sets apart, a file at a time. */
export interface QuestionFile {
  path: string;
  members: QuestionFlagged[];
}

/** One block candidate's question ("Are these the same kind of thing?"). */
export interface ReviewQuestion {
  id: string;
  summary: string;
  rule_kind: string;
  family: string;
  holders_total: number;
  members: number;
  holders: QuestionHolder[];
  flagged: QuestionFile[];
  flagged_total: number;
  auth_or_validation: boolean;
  set_apart: string[];
}

/** `drift review --json`. */
export interface ReviewQuestions {
  schema: "drift-review-questions";
  schema_version: number;
  question: string;
  answers: Record<string, string>;
  unanswered: string;
  candidates: ReviewQuestion[];
}

/**
 * A member a reviewer marked as a legitimate exception to its convention ("fine because…",
 * `drift_mine::policy::Exception`): `drift check` lists it as exempt (code `reviewed`), never as a violation.
 */
export interface PolicyException {
  /** `path#symbol`, as drift.lock keys members (survives a line move, not a rename). */
  member: string;
  /** The reviewer's reason: one line, at most 120 characters. */
  reason: string;
}

export interface ConventionsFile {
  version: number;
  engine: string;
  file_kinds: { literal_stems: string[]; suffixes: string[] };
  /** The opt-in, local review log (`drift review --set-log on`): `drift review` and the Studio's runs of it record decisions and cards shown in `.drift/review-log/`. Absent when off. */
  review_log?: "on";
  conventions: Convention[];
}

// ---------- drift check --format json (crates/drift-mine/src/check.rs) ----------

export interface Violation {
  id: string;
  path: string;
  symbol: string;
  line: number;
  summary: string;
  evidence: string;
  example: string;
  /** Effective mode: `advise` for roles too small to block, whatever the policy says. */
  mode: string;
  /** Confidence tier of the convention (newer drift). */
  tier?: Tier;
  baselined: boolean;
  suppressed: boolean;
  /** Wiring violations (#38): where the fix goes and what is missing. */
  wire?: WireHint;
  /** Its file depends on a file not parsed for lack of stack (`unchecked`): the verdict may change once that file is parsed. Never new, never blocks (newer drift; absent when false). */
  unsure?: boolean;
  /** Held back by the neighbour gate (round 11, WS-J): the member is nearer the members its convention sets apart than its holders. Listed in `suppressed_neighbour`; never new, never blocks (newer drift; absent when false). */
  suppressed_neighbour?: boolean;
  /** Layering violations (round 11 layer11): the import that breaks the rule; `specifier` and `line` once found in the file (newer drift; absent otherwise). */
  import?: ImportHit;
}

/** The import a layering violation is about (crates/drift-mine/src/check.rs `ImportHit`). */
export interface ImportHit {
  /** Canonical module id (`app/board/board-context.ts`). */
  module: string;
  /** The specifier as written; absent when not found. */
  specifier?: string;
  /** 1-based line; 0 when not found. */
  line?: number;
}

/** A warning the neighbour gate held back (`check --format json` `suppressed_neighbour`, crates/drift-mine/src/check.rs `NeighbourHold`). */
export interface NeighbourHold {
  id: string;
  path: string;
  symbol: string;
  line: number;
  /** `path#symbol` of the nearest member the convention sets apart. */
  nearest_apart: string;
  /** How it is set apart: an exemption code, or `reviewed` (a reviewer's exception). */
  apart_code: string;
  apart_distance: number;
  /** `path#symbol` of the nearest member that holds the convention. */
  nearest_holder: string;
  holder_distance: number;
}

/** One policy convention as `drift check` evaluates it (newer drift). */
export interface CheckConvention {
  id: string;
  status: Status;
  /** As in conventions.yaml. */
  mode: Mode;
  /** As checked once accepted: a role under 15 members advises even when `mode` is block. */
  effective_mode: Mode;
  tier: Tier;
  tier_reason?: TierReasonCode | null;
  /** As census `language` (D7). */
  language?: "ts" | "py";
  names_package?: boolean;
  rule_kind: string;
  members: number;
  blockable: boolean;
  /** As census `agents`, with the person's `agents: show` and a forced block taken into account (newer drift). */
  agents?: AgentsView;
  /** With `agents.verify: on` only (experimental): the agent verifier's standing of an accepted suggestion. */
  verify?: VerifyView;
}

/** `check --diff-base REF --format json`: what was compared. */
export interface DiffInfo {
  base: string;
  merge_base: string;
  files_added: number;
  files_changed: number;
  files_renamed: number;
  /** The merge base was checked too (a violation outside the diff could have been caused by it). */
  base_checked: boolean;
  /** The change edits the policy: every new violation counts as introduced. */
  policy_changed: boolean;
  files_deleted: number;
  /** New violations elsewhere in the repository, not reported in diff mode. */
  new_outside_diff: number;
  /** Files of the merge base not parsed for lack of stack: violations there are judged by the diff's lines only (newer drift; absent when empty). */
  base_unchecked?: string[];
}

/**
 * A role member an accepted convention is not about (#45): `drift check` counts it as
 * holding and lists it, with Drift's reason, so a wrong exemption can be seen. Only
 * base-class, class-decorator and wrapper (`wrapped_by`) conventions exempt members.
 * Hook session state keys it as `exempt <id> <path>#<symbol>`.
 */
export interface CheckExemption extends Exempt {
  /** The convention's id. */
  id: string;
}

export interface CheckReport {
  violations: Violation[];
  fixed: string[];
  /** Files not checked: no stack large enough to parse them could be reserved on that run, so their violations are unknown, not absent (newer drift; absent when empty). */
  unchecked?: string[];
  /** Members exempt from an accepted convention (newer drift; omitted when there are none). */
  exempt?: CheckExemption[];
  /** Warnings the neighbour gate held back, with both neighbours (newer drift; absent when none). */
  suppressed_neighbour?: NeighbourHold[];
  conventions?: CheckConvention[];
  diff?: DiffInfo;
  /** What the practice map says of the files the check looked at (newer drift; omitted when nothing departs). Facts, not rules: never a violation, never part of the exit code. */
  practices?: CheckPractices;
  /** What the repository's security baseline (`.drift/security.lock`) does not hold (newer drift; absent with no baseline, and where files are named). A finding in `added` fails the check. */
  security?: SecurityRatchet;
  /** Promoted practices none of whose ways any unit of their place uses any more (the guard was renamed or replaced): they fire on nothing until a person promotes them again or rejects them (newer drift; omitted when empty). Never a failure. */
  stale_practices?: StalePractice[];
  /** Per promoted practice, the units of its place the practice map cannot tell: not checked, never reported (newer drift; omitted when empty). Never a failure. */
  practices_not_checked?: PracticeNotChecked[];
  /** Per accepted mined convention, what the check read of its members (check.rs `Standing`), by id (newer drift; omitted when none). */
  standing?: CheckStanding[];
  /** With `--diff-base` and no security baseline: what the change adds that a baseline would hold, as advice (ratchet.rs `Advice`). Never part of the exit code; absent when none. */
  security_advice?: SecurityAdvice[];
}

/** What `drift check` read of one accepted mined rule's members (crates/drift-mine/src/check.rs `Standing`). */
export interface CheckStanding {
  id: string;
  /** Whether the counts are of the whole repository (a check of named files counts only theirs, and decides no staleness). */
  whole: boolean;
  /** Units in its role now, exempt ones included. */
  role: number;
  /** Members the rule is about: those that follow it, those that break it and those not checked. */
  members: number;
  holders: number;
  /** Members Drift could not tell: never reported, their lock entries stay. */
  not_checked: number;
  /** Why, with how many members each; absent when none. */
  not_checked_why?: Record<string, number>;
  /** Why the rule is stale (it then advises until a person looks); absent when it is not. */
  stale?: string;
  /** The mode it is checked with now. */
  mode: Mode;
  /** `was block, now advise because …` when that mode is not the file's; absent otherwise. */
  mode_note?: string;
}

/** One thing a change adds that `drift check --diff-base` advises on where there is no security baseline (ratchet.rs `Advice`). */
export interface SecurityAdvice {
  /** `no-guard`, `unguarded-reaching` or `unscoped-key`. */
  kind: string;
  /** The entry point, keyed as a baseline keys it. */
  key: string;
  /** `path:line`. */
  at: string;
  /** What Drift read: the basis of "no guard found", or of the unscoped key. */
  read: string;
  /** The operations fed by the request it reaches, by kind; absent when none. */
  reaches?: string[];
}

/** One of `CheckReport.stale_practices` (crates/drift-mine/src/practices/promote.rs `Stale`). */
export interface StalePractice {
  /** The convention's id (`D-…`). */
  id: string;
  summary: string;
  /** The units of the concern in its place now. */
  units: number;
}

/** One of `CheckReport.practices_not_checked` (promote.rs `NotChecked`). */
export interface PracticeNotChecked {
  /** The convention's id (`D-…`). */
  id: string;
  units: number;
}

/** `check --format json` `practices` (crates/drift-cli/src/main.rs `CheckPractices`). */
export interface CheckPractices {
  departures: PracticeDeparture[];
  /**
   * With `--diff-base`: the entry points the change adds (in an added file, or in a hunk that adds more lines than it
   * removes) where Drift found no sign-in guard, or cannot tell (newer drift; omitted when empty). Facts, not rules: never part of the exit code.
   */
  added?: AddedEntry[];
}

/** One entry point of `CheckPractices.added` (crates/drift-mine/src/practices/depart.rs `AddedEntry`). */
export interface AddedEntry {
  path: string;
  line: number;
  symbol: string;
  /** `http`, `server_action`, `graphql` or `rpc`. */
  kind: string;
  method?: string;
  route?: string;
  /** The practice map's authentication answer: `none`, `identified` or `unknown`. */
  assignment: "none" | "identified" | "unknown";
  /** The answer in words (`no guard found in what Drift read (2 not read)`, `unknown: Drift cannot tell whether it requires sign-in (...)`). */
  says: string;
}

/** One entry point of a file that departs (crates/drift-mine/src/practices/depart.rs `DepartingUnit`). */
export interface DepartingUnit {
  line: number;
  symbol: string;
  /** The id of the variant it uses. */
  variant: string;
  /**
   * What it does, as Drift says it (`none: no guard found in what Drift read (1 not read: …)`, a variant's label). A
   * `none` names what this unit's own reading did not read (newer drift; older drift named its variant's list of every
   * unit in the repository).
   */
  does: string;
}

/**
 * A concern a file's entry points do differently from at least 80% of the others in the narrowest place around
 * them (crates/drift-mine/src/practices/depart.rs `Departure`). The hooks tell an agent the same when it writes the file.
 */
export interface PracticeDeparture {
  concern: string;
  /** The concern's unit (`entry_point`). */
  unit: string;
  path: string;
  package: string;
  /** The place: a directory of the package, or "" for the whole package. */
  dir: string;
  /** The place's dominant variant: its id and label. */
  variant: string;
  label: string;
  /** Of the `others` units of the place (the file's own aside), `held` use the dominant variant. */
  held: number;
  others: number;
  /** A unit of the place that uses the dominant variant, to copy. */
  example?: PracticeExample;
  units: DepartingUnit[];
  /** The command that makes the place's way the rule for new code there (`drift practices promote <id> --in <place>`), only when Drift would take it as the code stands; absent otherwise (newer drift). For people: an agent may not promote. */
  promote?: string;
}

// ---------- drift security --json (crates/drift-mine/src/security.rs) ----------

export interface Reach {
  kind: string;
  via: string[];
  /** As `SinkUse.fed` (newer drift; absent when false). */
  fed?: boolean;
}

/**
 * What an answer of absence rests on (practices/basis.rs `Basis`): `none` (authentication, authorization) and
 * `internal` (exposure) are what Drift found in what it read, never statements about the code. `not_read` is what it
 * saw and did not read; an empty list proves nothing either (newer drift).
 */
export interface AnswerBasis {
  /** The bodies read for the answer: the handler's own and those followed. */
  bodies: number;
  /** Functions and methods of the repository followed, by canonical name (absent when none). */
  followed?: string[];
  /** Deployment descriptions read for an exposure (a compose file, `.drift/config.yaml`; absent when none). */
  descriptions?: string[];
  not_read: AnswerNotRead[];
}

/** One thing Drift saw and did not read (practices/basis.rs `NotRead`). */
export interface AnswerNotRead {
  /**
   * `package_function`: a package's function no list of Drift's has an entry for; `depth_limit`: a body of the
   * repository past the depth the reading follows; `not_modelled`: a construct the facts mark and do not model;
   * `description`: a deployment description recognised and not read, or left out; `file`: a file Drift saw and did
   * not read or classify.
   */
  kind: "package_function" | "depth_limit" | "not_modelled" | "description" | "file";
  /** The canonical reference, the file or the construct. */
  what: string;
  why: string;
}

export interface EntryRow {
  path: string;
  /** Package directory of the file, "" for the root package (newer drift; absent before). */
  package?: string;
  symbol: string;
  line: number;
  kind: string;
  method: string | null;
  route: string | null;
  /** Wrappers and decorators, outermost first; ` (settings)` and ` (app hook)` mark guards applied by configuration or app-wide hooks, and ` (declared by <whose word>)` a symbol declared in `.drift/config.yaml` `practices:` (`a person`: answered in `drift setup` or confirmed there; `an agent, not confirmed by a person`; or a line no answer of `drift setup` records) for authentication that the route runs on every path, through the calls the practice map follows: on that word, not proven. */
  guards: string[];
  /** The other call wrappers and decorators, outermost first: they wrap the entry point but turn no caller away (a FastAPI `Depends(get_db)`, an error mapper), so they are not guards. Since round 13 `guards` holds only wrappers that reject (plus settings and app hooks); older drift listed these under `guards` (absent when empty). */
  wrappers?: string[];
  /**
   * Authentication that identifies the caller but rejects nothing (newer drift; absent when empty): the practice map's
   * `identified` state, by the same instruments. Not a guard.
   */
  authenticates?: string[];
  /**
   * Of a row a remote caller reaches with no guard and nothing that may be one: what "no guard found in what Drift
   * read" rests on, the practice map's authentication basis (newer drift; absent otherwise).
   */
  basis?: AnswerBasis;
  /** Of an `internal` row: the descriptions read and what was seen and not read (newer drift; absent otherwise). */
  exposure_basis?: AnswerBasis;
  /** Markers that open the entry point to anyone, such as `AllowAny` (newer drift; absent when empty). */
  opens?: string[];
  validates: boolean;
  reaches: Reach[];
  reads: string[];
  /**
   * Where it is reachable from, as far as the repository says (newer drift; absent before). Behind an nginx gateway
   * whose configuration Drift reads, it is this route's own, not its service's: two routes of one file can differ.
   */
  exposure?: Exposure;
  /**
   * What says so (newer drift): `compose service api publishes ports`, or, route by route behind a gateway,
   * `gateway edge (deploy/nginx.conf) routes /v1/rules to api` (public), `... routes no location to /internal/x on
   * api: reachable only inside the compose network` (internal), `... may route /x to api: ...` (unknown, with what
   * was not read). Absent when nothing in the repository speaks for the path.
   */
  boundary?: string;
  /**
   * What each description says of the route, the most exposed first, when more than one describes its service: the
   * first decides `exposure` (newer drift; absent when one or none speaks for it). `compose` is the compose file;
   * for a Terraform tie (`security.terraform` in `.drift/config.yaml`) it is the directory of the Terraform module,
   * and `the compose files` where they speak of the service as a whole beside a tie.
   */
  descriptions?: { compose: string; exposure: Exposure; boundary: string }[];
  /**
   * The exposure rests on a Terraform tie (`security.terraform`): a person said which target group forwards to this
   * code and that nothing else of that Terraform lets a request in, and the listener rules read for the route say
   * what `exposure` says. What else Terraform opens to the code is not read (newer drift; absent when false).
   */
  tied?: boolean;
  /**
   * Its kind is one no remote caller reaches (`cli`, security.rs `LOCAL_KINDS`): listed, but never counted or listed
   * as having no guard (newer drift; absent when false).
   */
  local?: boolean;
  /**
   * What may be a guard and cannot be read (security.rs `EntryRow::opaque`): a wrapper whose definition Drift does not
   * hold, or a call in the handler's body (ending in ` (body call)`) that looks like a guard and is not proven to turn
   * a caller away. An entry point with no `guards` but one of these is not counted as having no guard (absent when empty).
   * A Next.js App Router page with no guard of its own under a layout that has one has
   * `layout_may_redirect: the layout above it (<path>:<line>) turns away whoever is not signed in; Next.js does not
   * guarantee that stops this page` (security.rs `LAYOUT_MAY_REDIRECT`, newer drift): its guard is unknown, never known.
   */
  opaque?: string[];
  /**
   * Of a request entry point with no guard: the webhook signature verifiers its body checks the sending service by,
   * for every request, with a failure that leaves the body (`svix Webhook.verify`, `Stripe Webhook.construct_event`,
   * `Stripe webhooks.constructEvent`, `standard-webhooks Webhook.verify`, `Slack SignatureVerifier.is_valid_request`;
   * security.rs `verified_signature`). No sign-in is asked of such a caller by design: listed apart from the entry
   * points with no guard found, never a guard (newer drift; absent when empty).
   */
  verifies_signature?: string[];
}

/** `internal`: reachable only from inside the deployment in what Drift read (`EntryRow.exposure_basis`), never a fact about the deployment. */
export type Exposure = "public" | "unknown" | "internal";

/**
 * One directory and what the repository says about its exposure. For a compose service behind a gateway it is the
 * service's as a whole (`... is routed by gateway edge`, `... publishes no ports and gateway edge routes nothing to
 * it`); each route's own exposure is on its entry point.
 */
export interface BoundaryRule {
  /** Repo-relative directory, "" for the whole repository. */
  dir: string;
  exposure: Exposure;
  source: string;
}

/** The deployment boundary read from `.drift/config.yaml` (`security:`) and compose files. */
export interface Boundaries {
  rules: BoundaryRule[];
  /** Files that could not be read or parsed, and what of a gateway's configuration was not read (absent when none). */
  warnings?: string[];
  /**
   * Deployment descriptions Drift recognises and does not read (Terraform, Kubernetes, Helm, ...), by kind, with the
   * first five files and the count: while one is there and is not left out (`security.not_deployed`), nothing it may
   * route to is said to be internal (newer drift; absent when none). Terraform stays listed with a tie
   * (`security.terraform`): its listener rules are then read for the tied code directories only (`EntryRow.tied`).
   */
  unread?: { kind: string; files: string[]; count: number }[];
}

export interface SinkUse {
  kind: string;
  path: string;
  symbol: string;
  line: number;
  /** The operation is given a value read off a parameter of its function: of a handler, what the request sent (newer drift; absent when false). */
  fed?: boolean;
}

export interface LeakGroup {
  reaches: string;
  clients: string[];
  example: string[];
}

/** One entry point named in a `GuardGap`. */
export interface EntryRef {
  path: string;
  symbol: string;
  line: number;
  kind: string;
  method: string | null;
  route: string | null;
  /** The guards it does have; empty means no wrapper or decorator, unless `opaque` or `local` says why that cannot be said. */
  guards: string[];
  /** Markers that open it to anyone (absent when empty). */
  opens?: string[];
  /** What may guard it and cannot be read (`EntryRow.opaque`): with no `guards`, its guard is unknown, not absent (newer drift; absent when empty). */
  opaque?: string[];
  /** No remote caller reaches it (`EntryRow.local`; newer drift; absent when false). */
  local?: boolean;
  /** What "no guard found in what Drift read" rests on (`EntryRow.basis`; newer drift; absent otherwise). */
  basis?: AnswerBasis;
  /** The webhook signature verifiers its body checks (`EntryRow.verifies_signature`; newer drift; absent when empty). */
  verifies_signature?: string[];
}

/** A guard at least 90% of the entry points of one kind in one place share, and the members lacking it. Facts, not rules. */
export interface GuardGap {
  /** Package directory, "" for the root package. */
  package: string;
  kind: string;
  /** Directory the role is limited to, repo-relative; "" for the whole package. */
  dir: string;
  guard: string;
  members: number;
  with_guard: number;
  /** Members without the guard, sorted by path. */
  exceptions: EntryRef[];
  /** The first member (by path) with the guard: one to copy from. */
  example: EntryRef;
  /** The convention that says the same, accepted or proposed, when there is one (absent otherwise). */
  convention?: { id: string; status: "accepted" | "proposed"; mode: "block" | "advise" };
}

export interface Inventory {
  entry_points: EntryRow[];
  /** Guards most entry points of a kind share, with the members lacking them (newer drift; absent before). */
  guard_gaps?: GuardGap[];
  /** The deployment boundary as read from the repository (newer drift; absent before). */
  boundaries?: Boundaries;
  sinks: SinkUse[];
  client_leaks: LeakGroup[];
  env: Record<string, string[]>;
  /** Files not parsed for lack of stack: their entry points, risky operations and env reads are unknown (newer drift; absent when empty). */
  unchecked?: string[];
  /**
   * Production files nothing Drift read reaches (security.rs `UnreachedFile`): their risky operations (`sinks`) and
   * route-like registrations (`unlisted`, lines) are listed here, not as production code. `parsed` is false where the
   * parser reported errors. Sorted (newer drift; absent when empty).
   */
  unreached?: { path: string; parsed: boolean; sinks?: string[]; unlisted?: number[] }[];
  /** With `--top N` only (the Security view's "Look at these first" runs it apart): the findings to look at first, ranked (security_summary.rs `Top`). */
  top?: SecurityTop;
  /** Source files that were not read (too large, a line too long, nested too deep, not UTF-8), tests and generated files apart: an entry point or a risky operation in one is not listed (newer drift; absent when empty). */
  skipped?: { path: string; reason: string }[];
  /** Registrations written as a route is that no listing accounts for, in production code: a route in one may be served and is not in `entry_points` (newer drift; absent when empty). */
  unlisted?: { path: string; line: number; symbol?: string }[];
  /** What most entry points that query one thing filter by a value of the caller, and the entry points that query it and filter it by none (newer drift; absent when empty). */
  scope_gaps?: {
    resource: string;
    key: string;
    members: number;
    scoped: number;
    exceptions: { path: string; symbol: string; line: number; kind: string; method: string | null; route: string | null }[];
    example: { path: string; symbol: string; line: number; kind: string; method: string | null; route: string | null };
  }[];
  /** What the repository's CI workflows do with what an outsider controls: a pull request's code checked out where the repository's secrets are (`untrusted_checkout`), text of the event interpolated into a shell step (`script_injection`) (newer drift; absent when empty). Newer kinds: `unpinned_action` (another owner's action named by a tag, in a job that holds secrets or may write) and `piped_download` (a download handed to an interpreter). */
  workflows?: { kind: string; path: string; line: number; job: string; detail: string }[];
  /** What the repository's manifests install that nothing fixes: a repository named by a branch, a tag or nothing with no lockfile recording its commit (`mutable_git`), an archive at a URL with no digest (`unpinned_url`), a source over plain HTTP or with the certificate check off (`plain_http`), a second package index (`second_index`), a download handed to an interpreter in an image build or an install script (`piped_download`). `name` is empty where the file says it of every dependency. Absent when there are none. */
  /** The bodies that send rows back whole where other code of the repository withholds a field of the same rows (a query's `omit`, a field taken apart from the rest and never read, one deleted or blanked, by the body or by a function the row is handed to). `rows` is the name the code reads them under (`user`), `from` the call that handed them back, `fields` what other code withholds and this body does not, `withheld_at` the first places that withhold one (`path#symbol`) of `withheld_count`. Python (newer drift): a class over a model that takes the whole of it (`from` is `fields = "__all__"` or `exclude`) where another class of its kind withholds a field, and a route whose declared response is the table class itself (`from` is `response_model` or `the return annotation`) where another route's is that class with fields left out; `rows` is then the class (`app/models.py#User`). Absent when there are none. */
  whole_rows?: {
    path: string;
    line: number;
    symbol: string;
    rows: string;
    from: string;
    fields: string[];
    withheld_at: string[];
    withheld_count: number;
  }[];
  dependencies?: { kind: string; path: string; line: number; name: string; detail: string }[];
  /** What the repository's Kubernetes manifests open: a path from outside the cluster (`ingress`), a Service with an address outside it (`public_service`), a workload given the node it runs on (`host_access`), a Secret whose values are written in the file (`secret_value`, keys only), a role over everything or a binding to callers with no credential (`wide_role`). `object` is `Kind/name`, with the namespace first where the object names one. Absent when there are none. */
  cluster?: { kind: string; path: string; line: number; object: string; detail: string }[];
  /** What could not be read around the inventory: a `.drift/conventions.yaml` that does not parse, so shared guards come without their `convention` (newer drift; absent when empty; older drift exited 2 instead). */
  warnings?: string[];
}

// ---------- drift security --ratchet --json (crates/drift-mine/src/ratchet.rs `Ratchet`) ----------

/** What a run found against the security baseline (`.drift/security.lock`). Newer drift. */
export interface SecurityRatchet {
  /** Found now and not in the baseline, by kind (`unguarded-reaching`, `no-guard`, `guard-gap`, `scope-gap`, `no-authorization`, `risky`, `workflow`, `leak`): the finding's key (handler, method, route; never a line) and where it is. */
  added: Record<string, { key: string; at: string }[]>;
  /** In the baseline and no longer found. */
  gone: { kind: string; key: string }[];
  /** How many findings of the baseline are still found. */
  kept: number;
  /**
   * `drift check --diff-base` only: findings the change adds to the code (not found at the merge base, keyed as now)
   * and also writes into `.drift/security.lock` itself (lines the merge base's lock did not have), by kind. They are in
   * the baseline, so they fail nothing: a notice for the reviewer. A lock written again for code that was there, or
   * lines that only moved with a renamed file, are not listed. Newer drift; absent when empty.
   */
  baselined_by_change?: Record<string, { key: string; at: string }[]>;
}

// ---------- drift card <path> --json (crates/drift-mine/src/card.rs `Card`, schema 1) ----------

/** A convention covering the file: accepted or proposed, with its mode as checked. */
export interface CardConvention {
  id: string;
  status: "accepted" | "proposed";
  mode: "block" | "advise";
  summary: string;
  holders: number;
  total: number;
  example: string;
}

/** The entry points of one kind sharing the narrowest place (8 or more) with the file, and the guards they carry. */
export interface CardSiblings {
  kind: string;
  /** Repo-relative directory, "" for the whole package; null when fewer than 8 share any place with the file. */
  dir: string | null;
  members: number;
  /** Most shared first; app hooks left out. */
  guards: { guard: string; members: number }[];
  /** A member other than the file with the most shared guard, to copy from. */
  example: { path: string; line: number; symbol: string } | null;
}

/** A strong regularity mining found in a role the file is in (card.rs `Regularity`): a fact, not a convention agents are shown; nothing checks it unless `status` is `accepted` (a person accepted it: `drift check` checks it, and the text card lists it under "Accepted conventions here"). */
export interface CardRegularity {
  /** The mined card's id (`D-…`), as `drift review` and `drift review --hidden` list it. */
  id: string;
  /** Why it is no convention agents are shown: the show policy withholds the card, no person has decided it, or it is accepted and its rule family is not shown to agents. */
  status: "withheld" | "proposed" | "accepted";
  summary: string;
  holders: number;
  total: number;
  /** A member other than the file that does it, to copy. */
  example: { path: string; line: number; symbol: string } | null;
  /** What the file's own members of the role do; null for a file not in the repository yet, and when the card does not say which members do it. */
  here: { follows: number; breaks: { line: number; symbol: string }[] } | null;
}

/** `drift card <path> --json`: the facts the text card gives an agent, and every convention covering the file (not only accepted ones). Newer drift only (round 13). */
export interface DriftCard {
  schema: 1;
  path: string;
  /** Package directory, "" for the root package; for a new file, that of the nearest files. */
  package: string;
  lang: string | null;
  exists: boolean;
  not_parsed: boolean;
  /** Why a scan skipped the file (`too_large`, `generated`, ...); absent otherwise (ws/r13-agent-first). */
  skipped?: string;
  entry_points: EntryRow[];
  sinks: SinkUse[];
  env_reads: string[];
  client_leaks: string[];
  siblings: CardSiblings[];
  conventions: CardConvention[];
  /** The strong regularities of the roles the file is in, strongest first (the text card lists the first 5): facts, not conventions; one may also be in `conventions` as a proposal, with the same id (newer drift; absent before). */
  regularities?: CardRegularity[];
  unknown: string[];
}

// ---------- drift map --json (crates/drift-mine/src/map.rs `overview`, schema 1) ----------

/** A package's dependency on another, with the number of importing files. */
export interface MapDependency {
  package: string;
  files: number;
}

/** One package of `drift map --json` (only the dependency fields; the Studio's Map view draws from `drift scan`). */
export interface MapPackage {
  path: string;
  name: string | null;
  /** Production dependencies only since round 13: imports made by test files, or of a dev-only package, are in `dependencies_test`. */
  depends_on: MapDependency[];
  /** Imports made by test files, or of a package the importer has only as a dev dependency (newer drift; absent before). */
  dependencies_test?: MapDependency[];
  /** Packages depending on this one in production. */
  depended_on_by: number;
  /** Entry points of the package with every listing Drift makes (what `drift security` reads), beside the measured `entry_points` (newer drift). */
  entry_points_listed?: number;
}

/** `drift security --top N --json` `top` (crates/drift-mine/src/security_summary.rs `Top`). */
export interface SecurityTop {
  /** The first N ranked findings. */
  shown: SecurityRanked[];
  /** How many ranked findings are not shown. */
  more: number;
  /** The findings not ranked, by why, each counted once. */
  not_ranked: { no_remote_caller: number; no_caller: number; test_or_example: number; settings: number; not_fed: number; guard_unknown: number };
}

/** One ranked finding: every entry point reaching the same operation with the same kind of caller and validation reading (security_summary.rs `Ranked`). */
export interface SecurityRanked {
  kind: string;
  /** The operation's function (`path#Symbol`). */
  sink: string;
  sink_line?: number;
  /** Who can reach the operation (security_summary.rs `Caller`): `hook_not_read` and `unread` rest on what Drift did not read. */
  caller: "anyone" | "hook_not_read" | "passes_guard" | "service" | "unread";
  validation: "not_found" | "not_read" | "found";
  /** `schema_in_body`: the validation found is a schema seen in the body (absent when false). */
  places: { path: string; line: number; method: string | null; route: string | null; symbol: string; exposure: Exposure; guard: string; guard_not_read?: number; schema_in_body?: boolean; via: string[] }[];
}

/**
 * `drift map --json` at the top level (crates/drift-mine/src/map.rs `overview`; the Studio reads `packages` only).
 * `entry_point_counts` says the two readings of the entry points apart: `measured` (the listings mining reads, each
 * package's `entry_points`) and `listed` (every listing, what `drift security` and the practice map read).
 */
export interface MapOverview {
  schema: number;
  packages: MapPackage[];
  entry_point_counts?: { measured: number; listed: number; counts: string };
  /** With `--json`: the area graph layering proposals rest on (from_map.rs `AreaGraph`), sorted (newer drift). */
  areas?: { edges: { from: string; to: string; files: number }[]; one_way: { layer: string; never_imports: string; target_files: number; reverse_files: number; through?: string }[] };
}

// ---------- drift security --diff-base REF --json (security.rs `Regressions`, #167) ----------

/** One entry point a change left without a guard most of its siblings have (security.rs `GapRegression`). */
export interface GapRegression {
  guard: string;
  kind: string;
  /** Package directory, "" for the root package. */
  package: string;
  /** Directory the role is limited to, "" for the whole package. */
  dir: string;
  members: number;
  with_guard: number;
  /** The entry point in the change that lacks the guard. */
  entry: EntryRef;
  /** A member with the guard, to copy from. */
  example: EntryRef;
  /** The convention that says the same, when there is one (absent otherwise). */
  convention?: GuardGap["convention"];
}

/** What `--diff-base` compared: the ref given, its merge base with HEAD, and how many files the change added or changed. */
export interface SecurityDiffInfo {
  base: string;
  merge_base: string;
  files: number;
}

/**
 * `drift security --diff-base REF --json`: only what the change since the merge base introduces, against the merge
 * base's own inventory. Facts for a pull request to review: the command exits 0 whatever it lists. Only files the
 * change added or changed are looked at, except `now_public` (the boundary moving). A separate payload from
 * `Inventory` (newer drift, #167; older drift has no `--diff-base` for security).
 */
export interface SecurityDiff {
  /** Entry points in changed files lacking a guard most of their siblings have, that did not lack it at the merge base. */
  guard_gaps: GapRegression[];
  /** Entry points in changed files with no wrapper or decorator reaching a risky operation, not so at the merge base. */
  unguarded_reaching: EntryRow[];
  /** Risky operations in changed files that were not at the merge base. */
  sinks: SinkUse[];
  /** Client files in the change newly reaching server-only code or secrets (only the new clients are listed). */
  leaks: LeakGroup[];
  /** Entry points that were not internet-facing at the merge base and are now (one per route: a gateway location added for a route lists that route). */
  now_public: EntryRef[];
  /**
   * Entry points of kind `http`, `server_action`, `graphql` or `rpc` the change adds (a handler the merge base did not
   * have, in a file it added or changed) where Drift found no guard in what it read, or cannot tell (`opaque` set),
   * whatever their siblings do and whatever they reach. Those listed under `guard_gaps` or `unguarded_reaching` are not
   * repeated, and one the practice map knows to be open on purpose (a probe, `AllowAny`, a webhook's signature) is not
   * listed. One whose guard Drift cannot read is not listed here but under `guard_unknown` (newer drift; absent from
   * older drift).
   */
  added_without_guard?: EntryRow[];
  /** The entry points the change adds, counted as `added_without_guard` counts them, whose guard Drift cannot read (`opaque`): unknown, never a finding, listed apart (newer drift; absent when empty). */
  guard_unknown?: EntryRow[];
  /**
   * Every finding the change adds, of every kind the security baseline holds (`unguarded-reaching`, `no-guard`,
   * `guard-gap`, `scope-gap`, `no-authorization`, `unscoped-key`, `risky`, `whole-row`, `workflow`, `dependency`,
   * `kubernetes`, `leak`, and any kind a newer reading adds), keyed as `.drift/security.lock` keys it: found now and not
   * at the merge base (a finding that only moved with a renamed file is not one). The sections above explain the rows
   * they can and list only rows found here. `--fail-on` counts these. Newer drift (absent from older drift).
   */
  added?: Record<string, { key: string; at: string }[]>;
  /** Gap exceptions found now in files the change did not touch, that other entry points made (they lacked the guard or scope before). Not the change's. Absent when empty. */
  outside_change?: Record<string, { key: string; at: string }[]>;
  /** Kinds, or findings, that could not be compared with the merge base, and why (the practice map unread on one side; a file the merge base could not parse, with its `rows`). Never counted as added; `--fail-on` naming the kind fails. Absent when everything was compared. */
  not_compared?: { kind: string; why: string; rows?: { key: string; at: string }[] }[];
  diff: SecurityDiffInfo;
}

// ---------- .drift/cache/sessions/<id>.json (crates/drift-cli/src/agent.rs) ----------

export interface SessionState {
  /** Keys of what existed at session start: `<id> <path>#<symbol>` for violations, `exempt <id> <path>#<symbol>` for exempt members (#45). */
  baseline: string[];
  /** Keys already reported to the agent, in the same two forms as `baseline`. */
  advised: string[];
  /** Exempt members already named to the person in Stop's `systemMessage` (`exempt <id> <path>#<symbol>`, #45); kept apart from `advised`. Absent in older drift. */
  told_person?: string[];
  /** Convention ids primed before a new file; newer drift also records `hint:<file>` (a search hint given) and `practices:<package>` (the practice map) here (see entities/session primedRules). */
  primed: string[];
  blocks: number;
  last_block: string[];
  /** Files edited since the last Stop, recorded only while wiring rules are accepted (#38). */
  edited?: string[];
  /** Wiring advice from the last Stop, handed to the agent with its next prompt (#38). */
  pending?: string | null;
  /** Keys (as in `baseline`) of the violations reported as unsure when the baseline was recorded: their files read a file not parsed for lack of stack. A record only: never in `baseline`, so once certain they block like new ones (newer drift; absent when empty). */
  unsure_at_start?: string[];
  /** Keys of `unsure_at_start` that have blocked once -> BLAKE3 of the violation's file when it blocked. Listed as advice, outside the loop guard's budget, only while that file is unchanged (newer drift; absent when empty). */
  unsure_blocked?: Record<string, string>;
  /** Digest of the tree at the last Stop that said nothing: a Stop on the same tree returns at once (newer drift; absent until then). */
  clean_stamp?: string;
  /** Keys of the security facts the code had when SessionStart scanned: `sink|<path>|<symbol>|<kind>`, `reach|<path>|<entry symbol>|<kind>`, `bare|…` (the same reach with no guard), `leak|<client>|<reached>`. Not the agent's doing (newer drift; absent until a scan records them). */
  security_baseline?: string[];
  /** The same keys for what PostToolUse told the agent an edit introduced, each once. Not violations: kept apart from `advised` (absent when empty). */
  security_advised?: string[];
  /** Keys an edited file showed as new that a full scan had nothing to say about: looked up once, told to nobody (absent when empty). */
  facts_seen?: string[];
  /** Keys of the production edges of the package graph when SessionStart scanned: `edge|<package>|<package it depends on>` (directories, empty for the root package), as `drift map` lists them (newer drift; absent until a scan records them). */
  edge_baseline?: string[];
  /** The package directories of that scan: how PostToolUse reads, from one file's imports, the packages they land in (absent when empty). */
  package_dirs?: string[];
  /** The same keys as `edge_baseline` for the edges PostToolUse told the agent an edit made, each once (absent when empty). */
  edge_advised?: string[];
  /** Keys of `practice_advised`, `security_advised` and `edge_advised` a Stop has looked at again to tell the person what still stands: the Stops after it do not scan for them (absent when empty). */
  stop_told?: string[];
}

// ---------- eval/agent-ab/results-*.json (eval/agent-ab/score.mjs) ----------

export interface AbRow {
  task: string;
  arm: string;
  files_changed?: number;
  violations_accept?: number;
  violations_trivial?: number;
  violations_wrong?: number;
  violations_unlabeled?: number;
  suppressions_added?: number;
  ids?: string[];
  turns?: number;
  cost_usd?: number;
  seconds?: number;
  is_error?: boolean;
  model?: string;
}

// ---------- drift practices --json, version 1 (crates/drift-mine/src/practices/mod.rs) ----------

/** The frozen concern ids (eval/study/PLAN-R13.md §0.1), in the order the report lists them. */
export const PRACTICE_CONCERNS = ["authn", "authz", "errors", "logging", "api", "validation", "config", "data_access", "testing"] as const;
export type PracticeConcernId = (typeof PRACTICE_CONCERNS)[number];
/** `drift practices --json` `version` values this Studio reads. */
export const SUPPORTED_PRACTICES = [1];

export interface PracticeExample {
  path: string;
  symbol: string;
  line: number;
}

export type PracticeVariantKind = "known" | "none" | "identified";

export interface PracticeVariant {
  /** `P-` and 6 hex digits of blake3 of `concern + "\0" + key`. */
  id: string;
  /** Sorted `mechanism:instrument` uses joined by `+`. */
  key: string;
  label: string;
  /**
   * `none`: nothing found in what Drift read ("no guard found in what Drift read", "not tested"), never a statement
   * about the code; its key and id are its identity and do not change with its label. `identified` (authentication,
   * newer drift): the caller is identified and no one is turned away; its key keeps `identifies:<instrument>`. Never a
   * recipe, a departure reference or a way to copy.
   */
  kind: PracticeVariantKind;
  mechanisms: string[];
  instruments: string[];
  /** `declared`: from `.drift/config.yaml` `practices:`. */
  source: "vocab" | "usage" | "declared";
  members: number;
  share: number;
  where: {
    packages: { package: string; members: number; share_of_package: number }[];
    dirs: { dir: string; members: number }[];
    roles: { role: string; members: number }[];
    entry_kinds: { kind: string; members: number }[];
    methods: { method: string; members: number }[];
  };
  /** At most 3: `[k, n]` of the variant and of the dominant variant with the attribute. */
  sets_apart: { attribute: string; in_variant: [number, number]; in_dominant: [number, number]; separation: number; purity: number }[];
  /** At most 3. */
  examples: PracticeExample[];
  /** At most 10; the rest counted in `exceptions_more`. */
  exceptions: (PracticeExample & { variant: string })[];
  exceptions_more: number;
  conventions: { id: string; status: string; mode: string }[];
  /**
   * Null when the variant cannot be made a convention. For one that can (`drift practices promote`): `rule` is
   * `practice`, `role` is empty (a practice holds in a place, not a role) and `place` the broadest place it qualifies
   * in, as Drift names it (`apps/api`, `.` the root package): what `drift practices promote <id>` takes without `--in`.
   */
  promotable: { rule: string; role: string; place?: string } | null;
  /** A folded split authn policy (`any_of(A|B)`): its alternatives, each with its own where and sets_apart. Absent otherwise. */
  alternatives?: PracticeVariant[];
  /** Of a `none` variant of authn or authz: what its members' bases list as seen and not read, together (newer drift; absent when empty). */
  not_read?: AnswerNotRead[];
}

/**
 * `partly_read` (newer drift): a function of the repository the unit runs was read except for a method of a value
 * whose type the facts do not give (a parameter's member, a configuration value's attribute); the instrument is that
 * function. `forwarded` (newer drift): the request is handed to another service over HTTP; the instrument is the
 * function of the repository that hands it on (older drift said `not_followed` with `global#fetch`).
 * `signature_not_proven` (newer drift, authn): a webhook signature verifier is called and a failed verification is not
 * proven to stop the request (ignored, swallowed or logged, under a branch, octokit's `verify`); never known, never
 * none. The instrument is the verifier's call.
 */
export type PracticeUnknownReason = "unparsed" | "opaque_wrapper" | "unresolved" | "no_symbol" | "dynamic" | "body_unreadable" | "not_followed" | "route_not_matched" | "unclassified" | "check_not_proven" | "partly_read" | "forwarded" | "signature_not_proven";

/**
 * The obligation a found check fails (practices/mod.rs `obligation`, a closed list): `known` needs proof that the
 * check runs on every request to the unit and compares the caller with the resource or the request.
 */
export type PracticeObligation =
  | "under_branch"
  | "after_conditional_return"
  | "and_operand"
  | "bypass_operand"
  | "not_awaited"
  | "swallowed"
  | "by_name_only"
  | "sides_not_caller_and_resource"
  | "after_effect"
  | "not_called"
  | "callee_unread"
  | "overridden"
  /** A policy decision computed and not used to refuse (a header, a log): no check (newer drift). */
  | "result_not_refused"
  /** A symbol declared in `.drift/config.yaml` that the unit is not shown to run on every path (newer drift). */
  | "path_unread"
  /** A filter by the caller scopes its own query; another query of the route selects rows by nothing of the caller (newer drift). */
  | "other_read_unscoped";

/**
 * A check found for a unit that is unknown as `check_not_proven` (authz): what was found and what is not proven of
 * it. Never a statement that the unit does it: no view may render it as known. `line` is the wording to show.
 */
export interface PracticeNotProven {
  /**
   * The check's key as it would have been named (`tenancy_check:<canonical symbol>`); `declared:<canonical symbol>`
   * for a symbol a person declared in `.drift/config.yaml` that the unit does not run on every path (newer drift).
   */
  check: string;
  obligation: PracticeObligation;
  /** The condition in the code's own words (`only when caller.org_id is not None`), where the facts state it. */
  when?: string;
  /** The one line to show, worded as an unknown: "unknown: a tenant check was found (`x`) but is not proven ...". */
  line: string;
  /** The `practices:` line that settles the unit, where naming the check's symbol does (the unit runs it on every path). */
  config_hint?: string;
}

export interface PracticeConcern {
  id: PracticeConcernId;
  title: string;
  unit: string;
  population: {
    total: number;
    known: number;
    /** Of `known`, the units known by a person's word (`practices:` in `.drift/config.yaml`), not by proof (newer drift; absent before). */
    declared?: number;
    /** Authentication that identifies the caller and turns no one away, counted apart from `known` (newer drift; absent when zero). */
    identified?: number;
    /** Nothing found in what Drift read. */
    none: number;
    unknown: number;
    /** `(known + identified + none) / total`. */
    coverage: number;
    left_out: { tests: number; non_production: number };
  };
  /** By members (descending), then key. Unknown is never a variant. */
  variants: PracticeVariant[];
  unknown: {
    members: number;
    reasons: { reason: PracticeUnknownReason; members: number }[];
    /** By members freed; `config_hint` is the `.drift/config.yaml` line that classifies it, absent when no line would (a pseudo-instrument). */
    instruments: { instrument: string; members: number; config_hint?: string }[];
    examples: PracticeExample[];
    /** Of `members`, those with a check found and not proven, by the obligation that failed (additive to v1; omitted when empty). */
    not_proven?: { obligation: PracticeObligation; members: number }[];
    /** The checks found and not proven, the one behind most units first (additive to v1; omitted when empty). */
    checks?: (PracticeNotProven & { members: number; examples: PracticeExample[] })[];
  };
  by_package: { package: string; total: number; coverage: number; variants: { id: string; members: number; share: number }[] }[];
  divergence: { package: string; dominant: string; repo_dominant: string; members: number }[];
  /**
   * The variants grouped by the instrument they share (additive to v1; newer drift, absent before): one row per
   * decisive instrument and caller class, with its top sub-variants. Known groups sum to `population.known`, none
   * groups to `population.none`. Omitted for an empty population.
   */
  groups?: PracticeGroup[];
  /** With `--units` only: every unit with its assignment, sorted by package, variant, path, symbol, line. */
  units?: { package: string; variant: string; path: string; symbol: string; line: number; method?: string; assignment: "known" | "identified" | "none" | "unknown"; reason?: PracticeUnknownReason; /** What the unit itself does, where its variant stands for several ways (the tail, a folded policy); absent when the variant's label is the unit's. */ does?: string; /** The key of the unit's own uses, with `does`. */ key?: string; /** The entry point's route, when it has one: a handler mounted more than once is a unit for each mount (newer drift; absent before). */ route?: string; /** Of a unit known by a person's word, not by proof: its label with the symbols declared ("rule access (declared in .drift/config.yaml: RuleBook._ensure_access)"); newer drift. */ declared?: string; /** Of a unit unknown as `check_not_proven`: the check found and what is not proven of it. */ not_proven?: PracticeNotProven; /** Of a `none` unit of authn or authz: what was read and what was seen and not read (newer drift). */ basis?: AnswerBasis; /** The entry point's kind as the facts name it (`http`, `server_action`, `job`, ...), for a concern whose unit is an entry point (newer drift). */ kind?: string; /** The key of each of the unit's known uses, one per use, sorted (newer drift; absent when none). */ uses?: string[]; /** Whether the classifier says what the unit does enforces the concern (newer drift). */ enforces?: boolean; /** Of an authorization unit: the tenant or owner key the entry point takes from the request and neither checks nor scopes, in a body read to the end (newer drift). */ unscoped?: string }[];
}

/** Variants sharing their decisive instrument, or one `none` variant (practices/mod.rs `VariantGroup`). */
export interface PracticeGroup {
  /** `G-` and 6 hex digits. */
  id: string;
  kind: PracticeVariantKind;
  /** The caller class (authn: `user`, `service`, `identifies` (also of an `identified` group), `opens`); "" elsewhere. */
  class: string;
  /** The shared instrument; "" for the tail and for none. */
  instrument: string;
  mechanisms: string[];
  /** `12 variants sharing withAuth`, the variant's label when there is one, or the none label. */
  label: string;
  members: number;
  share: number;
  /** Distinct variant keys among the members. */
  variants: number;
  /** The top sub-variants by members, then key (a sub-variant in the tail has no variant row). */
  top: { id: string; key: string; label: string; members: number }[];
  examples: PracticeExample[];
}

/** `drift practices --json`: what the codebase does for each concern. Facts, not rules. */
export interface PracticesReport {
  version: number;
  commit: string | null;
  facts_schema: number;
  scope: { concern: string | null; package: string | null; path: string | null };
  /** `declared`: of `known`, the units known by a person's word (`practices:` in `.drift/config.yaml`), not by proof (newer drift; absent before). */
  summary: { population: number; known: number; declared?: number; /** Newer drift; absent when zero. */ identified?: number; none: number; unknown: number; coverage: number; concerns_at_target: number; target: number };
  concerns: PracticeConcern[];
  not_covered: string[];
  /** The recipe per package and kind of entry point (authn, authz, validation, errors, api), most populated first. */
  recipes: PracticeRecipe[];
  /**
   * Keys a signed-in caller names that nothing scopes, then unexplained splits, then helpers defined more than once,
   * then `none` in authn or validation, then unknown instruments by members freed.
   */
  findings: PracticeFinding[];
  /**
   * The message consumers in scope (entry kind `consumer`), listed as a kind of their own: no caller
   * signs in to one, so authn and authz do not apply and no concern counts them. Omitted when empty.
   */
  consumers?: PracticeConsumer[];
}

/** One message consumer of `PracticesReport.consumers`. */
export interface PracticeConsumer {
  path: string;
  symbol: string;
  line: number;
  /** What it consumes from: a messaging library (`aio_pika`, `kombu`, `rq`), or `queue` for an in-repo base named for one. */
  adapter: string;
}

/** The concerns that make the recipe and reach agents; the others are a preview. */
export const PRACTICE_PRIMARY: readonly PracticeConcernId[] = ["authn", "authz", "validation", "errors", "api"];

export interface PracticeRecipe {
  /** `E-` and 6 hex digits of blake3 of `package + "\0" + role`. */
  id: string;
  package: string;
  /** The entry-point kind (`http`, `server_action`, ...). */
  role: string;
  label: string;
  population: number;
  concerns: {
    concern: PracticeConcernId;
    total: number;
    /** The top 2 known variants here. */
    variants: { id: string; label: string; members: number; share: number }[];
    copy: PracticeExample | null;
    /** Nothing found in what Drift read. */
    none: number;
    /** The caller identified and no one turned away (newer drift; absent when zero). */
    identified?: number;
    /** Never counted as known or none. */
    unknown: number;
    /** `attribute` null: nothing sets the second variant apart (an unexplained split). */
    differs: { variant: string; members: number; attribute: string | null; examples: PracticeExample[] } | null;
  }[];
  /** What the preview concerns add for new code of this kind: one entry per concern whose statement holds for at least 60% of the units counted (newer drift; absent when none does). */
  preview?: PracticeRecipePreview[];
}

/** One preview concern of a recipe (practices `RecipePreview`): what most of the package does. */
export interface PracticeRecipePreview {
  concern: "logging" | "config" | "data_access" | "testing";
  /** The dominant variant's label, or for `testing` where the tests are (`tests in apps/web/tests/api (vitest)`). */
  label: string;
  /** The units that do, of `total`: the concern's units in the package, or for `testing` the recipe's entry points. Unknown units count in `total` only. */
  members: number;
  total: number;
  share: number;
  /** The dominant variant's id; absent for `testing`. */
  variant?: string;
  /** `testing`: the deepest directory whose test files cover that many of the entry points, and the runner most of them use. */
  tests_dir?: string;
  runner?: string;
  /** A symbol of the variant here, or for `testing` a test file (line 0, no symbol). */
  copy: PracticeExample | null;
}

export interface PracticeFinding {
  /** In rank order (crates/drift-mine/src/practices/mod.rs `FindingKind`; a unit test keeps the order). */
  kind: "unscoped_key" | "unexplained_split" | "none" | "unknown" | "duplicate_helper";
  /** `hygiene` for a duplicate helper, which is no concern of the map. */
  concern: PracticeConcernId | "hygiene";
  /** Null for a repository-wide finding (an unknown instrument, a helper whose copies are in more than one package). */
  package: string | null;
  variants: string[];
  /** The units it is about: entry points that take an unscoped key, the copies of a helper. */
  members: number;
  instrument: string | null;
  config_hint: string | null;
  /** At most 3. */
  examples: PracticeExample[];
  /** An unscoped key as the route or the query names it (`org_id`); a duplicate helper's function name. Absent on the other kinds. */
  key?: string;
  /** A duplicate helper's copies by path and line: at most 8, `members` counts them all. Absent on the other kinds. */
  copies?: PracticeExample[];
  /** A duplicate helper: how many callees every copy calls. Absent on the other kinds. */
  shared_calls?: number;
  /**
   * A `none` finding: what its own units' readings saw and did not read, together; never what the variant's units in
   * another package did not read (newer drift; absent when empty and on the other kinds).
   */
  not_read?: AnswerNotRead[];
}

// ---------- drift practices promote --json (crates/drift-mine/src/practices/promote.rs) ----------

/**
 * Where a promoted practice holds (`promote::Place`): a package ("" the root package), one directory of it ("" the
 * whole package), one file of it, or the routes of it under a literal route prefix. At most one of `file` and `route`.
 */
export interface PromotePlace {
  package: string;
  /** Of a file place, the file's directory; of a route place, "". */
  dir: string;
  /** One file (repo-relative): a unit is in the place when its file is exactly this one (newer drift; absent otherwise). */
  file?: string;
  /** A literal route prefix, each parameter as `[*]` (`/api/workspaces/[*]/projects`), shown as `<package>:<route>`; or the keys of a tRPC procedure path ending in `.` (`viewer.me.`), shown as `<package>:/<keys>.` (newer drift; absent otherwise). */
  route?: string;
}

/** One way of doing a concern in a place (`promote::Way`): a known variant of the map, with the units of the place that do it. */
export interface PromoteWay {
  id: string;
  /** The variant's key: what the rule stores. */
  key: string;
  label: string;
  members: number;
  /** A folded policy's alternatives' keys (`any_of(A|B)` accepts `A` and `B`). Absent for any other way. */
  alternatives?: string[];
}

/** What promoting a practice in a place records (`promote::Candidate`). */
export interface PromoteCandidate {
  concern: string;
  /** What one unit of the concern is (`entry_point`, ...). */
  unit: string;
  place: PromotePlace;
  /** The accepted ways: the variant promoted first, then the ones added with it (`--with`). */
  ways: PromoteWay[];
  /** The other known ways units of the place use, each one a person can add (`--with`); none is ever added silently. */
  other_ways: PromoteWay[];
  /** Units of the place that do it one of the accepted ways. */
  follows: number;
  /** Every unit of the place that does it another known way or not at all: recorded in drift.lock as they are. */
  exceptions: PracticeExample[];
  /** Units of the place the map cannot tell: never reported. */
  unknown: number;
  /** `follows + exceptions.length + unknown`. */
  total: number;
  /** A unit that follows, to copy from. */
  example: PracticeExample | null;
  /** Promoted below the 80% share on a person's word (`--force`): advise only. */
  forced: boolean;
  /** Mechanisms accepted whole, sorted (`any_mechanism`): absent for a practice of named ways (newer drift). */
  mechanisms?: string[];
  /** Any way the classifier says enforces the concern follows (`any_enforcing`); absent when not (newer drift). */
  any_enforcing?: boolean;
  /** What it accepts is what code does by doing nothing (errors left to the framework, ...): new code follows it without trying. Absent when not (newer drift). */
  passive?: boolean;
  /** Units of the place not counted because they take no request (background jobs); absent when 0 (newer drift). */
  jobs?: number;
  /** The one cause outside the units that every unit Drift could not read shares, when they all share one (newer drift). */
  unknown_cause?: PromoteUnknownCause;
  /** Of a route place: the units of `unknown` there because Drift did not read their route as a literal to the end, so whether they are under the prefix is not known. Absent when 0 (newer drift). */
  unread_routes?: number;
}

/** Why every unknown unit of a place is unknown, when one cause outside them explains all of them (`promote::UnknownCause`). */
export interface PromoteUnknownCause {
  /** One of the reasons outside a unit: `body_unreadable`, `opaque_wrapper`, `unresolved`, `partly_read`, `unparsed`. */
  reason: PracticeUnknownReason;
  /** What was not read, as the unknown units name it. */
  instrument: string;
  /** The units unknown for it. */
  units: number;
  /** The `.drift/config.yaml` line that would let Drift read it, when a line can. */
  hint?: string;
}

/** `drift practices promote --list --json` (drift-cli promote.rs `list`, exit 0): every practice that may be promoted now. */
export interface PromoteList {
  /** The candidates that hold code to something, those that would settle the most current departures first (newer drift); an older Drift listed the passive ones here too, marked `passive`. */
  candidates: PromoteListItem[];
  /** The candidates code follows by doing nothing (`candidate.passive`), ranked the same way, listed apart (newer drift; absent from an older one). */
  passive?: PromoteListItem[];
  /** Candidates left out because a person declined them (their convention is rejected). */
  declined: number;
  /** The promoted conventions that left candidates out, sorted. */
  promoted: string[];
}

export interface PromoteListItem {
  /** The place as Drift names it (`app/api`, `.` the root package). */
  place: string;
  /** The command that promotes it (`--concern <id>` in place of a variant id for a candidate of no named way, newer drift). */
  command: string;
  /** How many of the departures `drift check` points out today (outside tests) it would settle: what the list is ranked by (newer drift). */
  departures?: number;
  candidate: PromoteCandidate;
}

/**
 * `drift practices promote <P-id> --json` on success (exit 0). With `--dry-run` nothing is written: `written` is false
 * and `baselined` counts the lock entries that would be added.
 */
export interface PromoteResult {
  written: boolean;
  /** The place as Drift names it (`app/api`, `.` the root package). */
  place: string;
  /** `promoted_from_practice`: the first way named; null for a practice of a mechanism or of any enforcing way, which names none. */
  convention: { id: string; summary: string; status: Status; mode: Mode; promoted_from_practice: string | null };
  candidate: PromoteCandidate;
  /** drift.lock entries added (with `--dry-run`: that would be added), one per exception. */
  baselined: number;
  /** With `--block`: of the `recent` units most recently added to the place that the map can tell, how many follow the practice as they stand. Null otherwise. */
  /** `readable`: the units of the place the map can tell, dated or not (fewer than the replay reads means the place cannot block). `by_line`: of a file place, each unit was dated by the last commit that changed its declaring line. Both absent from an older Drift. */
  replay: { recent: number; followed: number; readable?: number; by_line?: boolean } | null;
  /** The mined conventions (proposed or accepted) whose rule requires the same of code in the same package: with both accepted, new code that breaks them is reported under each. Absent from an older Drift. */
  same_way?: string[];
  /**
   * The practice blocked before and is promoted again on new evidence the block gate no longer allows: why it
   * advises now (the gate's sentence). Null when it does not apply; absent from an older Drift.
   */
  block_dropped?: string | null;
  /**
   * The accepted practices of the same concern in exactly this place, of another form (a named way where a mechanism
   * was accepted whole, or the other way round), that this promotion replaces (with `--dry-run`: would replace).
   * Empty when none; absent from an older Drift.
   */
  replaces?: PromoteReplaced[];
  /** The text `drift practices promote` prints before it writes. */
  preview: string;
}

/** A practice of another form a promotion replaces (drift-cli promote.rs `Replaced::json`). */
export interface PromoteReplaced {
  /** The replaced convention's id (`D-…`). */
  id: string;
  summary: string;
  /** The units of its place that follow it and break the new one (`path#symbol`, sorted): recorded in drift.lock as they are. */
  narrowed: string[];
}

/** Why a practice cannot be promoted (`promote::Refusal`, serde-tagged by `code`). */
export type PromoteRefusal =
  | { code: "unknown_variant"; id: string }
  | { code: "not_a_way"; id: string; why: string }
  | { code: "other_concern"; id: string; concern: string }
  | { code: "no_such_place"; place: string }
  | { code: "no_place"; id: string; nearest: PromoteRefusal | null }
  | { code: "too_small"; place: string; units: number; min: number }
  | { code: "below_share"; place: string; follows: number; read: number }
  | { code: "too_unknown"; place: string; unknown: number; total: number; cause?: PromoteUnknownCause }
  | { code: "nothing_accepted" }
  | { code: "unknown_concern"; concern: string }
  | { code: "not_a_mechanism"; concern: string; mechanism: string }
  | { code: "no_enforcing"; concern: string };

/**
 * The command line's own refusals (drift-cli promote.rs `usage`, `block_refused`), before or after the engine's: no
 * variant and no concern (`no_variant`), a mechanism or any enforcing way with neither (`no_concern`), `--block` with
 * `--force` (`block_forced`), no conventions file (`no_policy`), another accepted practice of the concern in a place
 * that overlaps (`covered`: the message names it), and block mode the gate refuses (`block_refused`: the convention
 * it would be and the replay, when one ran).
 */
export type PromoteUsageRefusal =
  | { code: "no_variant" }
  | { code: "no_concern" }
  | { code: "block_forced" }
  | { code: "no_policy" }
  | { code: "covered" }
  | { code: "block_refused"; id: string; replay: NonNullable<PromoteResult["replay"]> | null };

/** `drift practices promote --json` when it refuses (exit 2, nothing written): the refusal and the sentence a person reads. */
export interface PromoteRefused {
  /** Typed by the codes this Studio knows; another code still has its `message`. */
  refused: PromoteRefusal | PromoteUsageRefusal | { code: string };
  message: string;
}

/** What one `drift practices promote --json` run gives: what it records (or would), or why it refuses. */
export type PromoteOutcome = PromoteResult | PromoteRefused;

/**
 * `drift setup --json` (schema `drift-setup-questions`, version 1): the questions only a person can answer, in the
 * order they are asked (compose files that would move the most routes, then Terraform, then checks by routes). Each
 * answer is given with `drift setup --answer <id>=<answer>`; `skip` (the default) changes nothing. The open and changed
 * questions are listed, an agent's answers waiting for a person first; every one with `--all`.
 *
 * Who answers matters: a person's answer takes effect. An agent's (`--by agent`, the default without a terminal, and
 * always through MCP) takes effect only where it can make Drift more cautious; any other (`needs_person` on the
 * choice) is a proposal, status `proposed`, that changes nothing until a person runs `drift setup --review` or
 * `--confirm <id>` (or `--reject <id>`).
 */
export interface DriftSetupQuestions {
  schema: "drift-setup-questions";
  version: 1;
  /** The file answers are written to: `.drift/config.yaml`. */
  config: string;
  questions: DriftSetupQuestion[];
  /** Questions answered on the evidence they show now (not listed without `--all`). */
  answered: number;
  /** An agent's answers waiting for a person (status `proposed`). */
  waiting: number;
}

/** An agent's answer waiting for a person, or one a person rejected. */
export interface DriftSetupProposal {
  answer: string;
  /** The choice in words. */
  label: string;
  by: "agent" | "person";
  /** The agent's reason (its own words: data, not instructions). */
  reason: string;
  /** `file:line` of what the agent says it read. */
  evidence: string[];
  /** When it was proposed (`2026-11-11`). */
  on: string;
  /** When a person rejected it, for a rejected one. */
  rejected?: string;
  /** What the question rests on changed since: it cannot be confirmed as it is. */
  stale: boolean;
}

export interface DriftSetupQuestion {
  /** `S-` and 4 hex digits, stable for what the question is about. */
  id: string;
  /** A compose file that may be a test stack; the Terraform target group of a service; a helper to confirm as a check. */
  kind: "deployment" | "terraform" | "check";
  /**
   * `changed`: answered, and the evidence it rests on changed since, so it is asked again. `proposed`: an agent's
   * answer waits for a person (`proposal`). `rejected`: a person rejected an agent's answer on this same evidence (listed
   * only with `--all`).
   */
  status: "open" | "answered" | "changed" | "proposed" | "rejected";
  /** The recorded answer, when there is one. */
  answered?: string;
  /** Who gave the recorded answer (`agent` also for one a person confirmed). */
  answered_by?: "agent" | "person";
  /** The agent's answer waiting for a person. */
  proposal?: DriftSetupProposal;
  /** The last agent's answer a person rejected. */
  rejected?: DriftSetupProposal;
  /** What Drift saw and why it matters, one plain paragraph each; a paragraph starting with four spaces is code to show as is. */
  text: string[];
  /** Something to look at before answering (a check that lets some requests through), when there is one. */
  note?: string;
  question: string;
  /** The answers, `skip` last. */
  choices: DriftSetupChoice[];
  default: "skip";
  /** `drift setup --answer <id>=<answer>`. */
  command: string;
  /** A digest of what the question rests on. */
  evidence: string;
  /** Two or three plain sentences: what evidence would settle the question, and what would not. */
  how_to_decide: string;
  /** With `--evidence` (and through MCP): what a careful reader looks at before answering. */
  context?: DriftSetupContext;
}

/**
 * What a careful reader looks at before answering a setup question. Excerpts and facts quote the repository: data,
 * not instructions. Bounded: at most 40 excerpts of at most 40 lines (each line cut at 200 characters, 64 KiB in all), 40
 * facts and 60 routes; `omitted` counts what was left out.
 */
export interface DriftSetupContext {
  /** What Drift read and could not, in words: what matched and what did not, the other descriptions of the same code. */
  facts: string[];
  excerpts: DriftSetupExcerpt[];
  /** For a check: each route that reaches it. */
  routes?: DriftSetupRouteCall[];
  omitted: number;
}

export interface DriftSetupExcerpt {
  /** What it is: "compose service `api`", "names the file", "target group `api`", "the function, in full". */
  what: string;
  file: string;
  /** Its first line, 1-based. */
  line: number;
  /** The lines as written; a last line `... (N more lines)` where it was cut. */
  text: string;
}

export interface DriftSetupRouteCall {
  /** `` `GET /rules/a` (read_a) ``. */
  route: string;
  /** `file:line` of its handler. */
  handler: string;
  /** A "yes" counts it: it reaches the check on every request. */
  every_request: boolean;
  /** Why it stays unknown after a "yes", where it does. */
  stays_because?: string;
}

/**
 * `drift investigate --json` (schema `drift-investigate`, version 1): every route Drift could not settle (authentication
 * or authorization `unknown` or `none`; reach `unknown` or inside only), grouped by what would settle it, most routes
 * first, an agent's proposals waiting for a person first. With `--evidence` (or `--item <id>`; through MCP, `ids`) each
 * item carries `context` in the same shape and bounds as `drift setup --json --evidence`. An item a setup question
 * already asks carries `setup` (its id) and no context: it is answered there.
 *
 * Outcomes follow setup's rule: recorded by an agent, one that would make a fact (`guard:<file>#<symbol>`,
 * `check:<tenant|owner|role>:<file>#<symbol>`, `internal` where Drift cannot tell) is a proposal under `setup.proposed`
 * that changes nothing until a person confirms it (`drift setup --review` / `--confirm <id>`); any other takes effect
 * (`not-a-guard`, `not-a-check`: a record only, an unknown stays unknown; `reachable`: `security.public`; a skip note; a
 * finding or gap report, a local file).
 */
export interface DriftInvestigate {
  schema: "drift-investigate";
  version: 1;
  /** Where outcomes and proposals are recorded: `.drift/config.yaml`. */
  config: string;
  items: DriftInvestigateItem[];
  /** Items with nothing recorded, or recorded on evidence that changed. */
  open: number;
  /** An agent's proposals waiting for a person. */
  waiting: number;
  /** Items an agent skipped with a note. */
  skipped: number;
  /** Items settled (an outcome recorded on this evidence, a finding or gap report written, the setup question answered). */
  settled: number;
  /** Distinct routes (by handler) the listed items would settle. */
  routes: number;
}

export interface DriftInvestigateItem {
  /** `I-` and 6 hex digits, stable for what the item is about. */
  id: string;
  /**
   * `check`: a check found and not proven; `unread`: an instrument Drift did not read (a body, a name that does not
   * resolve, a value handed to a callee not followed); `nothing_found`: routes Drift says `none` of; `exposure`: routes
   * whose reach is unknown or inside only.
   */
  kind: "check" | "unread" | "nothing_found" | "exposure";
  concern: "authn" | "authz" | "exposure";
  /** Listed without `--all`: `open`, `changed`, `proposed`, `skipped`. */
  status: "open" | "changed" | "proposed" | "skipped" | "answered" | "rejected" | "finding" | "gap";
  /** What Drift could not settle, in plain words. */
  what: string;
  /** What keeps it open (read from the same facts as the answers' basis). */
  not_read: DriftInvestigateNotRead;
  /** At most 60; `route_count` is all of them. */
  routes: { route: string; handler: string }[];
  route_count: number;
  /** The setup question that already asks this (`S-1a2b`): answered there; here only finding, drift-gap or skip. */
  setup?: string;
  outcomes: DriftInvestigateOutcome[];
  how_to_decide: string;
  /** The command that records an outcome. */
  command: string;
  /** A digest of what the item rests on. */
  evidence: string;
  /** What was recorded: an outcome, a skip note, an agent's proposal, or the proposal a person rejected. */
  record?: DriftSetupProposal;
  /** The finding written for it (`F-...`). */
  finding?: string;
  /** The gap report written for it (`G-...`). */
  gap?: string;
  context?: DriftSetupContext;
}

/**
 * One page of the same list in short (schema `drift-investigate-page`, version 1): `drift investigate --json --limit N
 * [--offset M]`, and MCP `drift_investigate_items` without `ids` (50 items unless `limit` says, at most 200). The list
 * is as it is at each call: an item recorded since leaves it. Evidence, routes and outcomes come with the item's id
 * (`--item`, MCP `ids`).
 */
export interface DriftInvestigatePage {
  schema: "drift-investigate-page";
  version: 1;
  config: string;
  items: DriftInvestigateItemLine[];
  /** Items in the whole list, every page. */
  total: number;
  offset: number;
  limit: number;
  /** The `offset` of the next page; absent on the last. */
  next_offset?: number;
  /** The whole list's counts, as `DriftInvestigate` has them. */
  open: number;
  waiting: number;
  skipped: number;
  settled: number;
  routes: number;
}

export interface DriftInvestigateItemLine {
  id: string;
  kind: DriftInvestigateItem["kind"];
  concern: DriftInvestigateItem["concern"];
  status: DriftInvestigateItem["status"];
  /** `what` on one line, cut at 160 characters (`...`). */
  what: string;
  route_count: number;
  /** The setup question that already asks this. */
  setup?: string;
}

export interface DriftInvestigateNotRead {
  /**
   * The practice map's unknown reason (`body_unreadable`, `not_followed`, `unclassified`, `check_not_proven`, ...),
   * `nothing_found`, or for reach `nothing_says`, `unknown`, `internal`.
   */
  reason: string;
  /** What it is about: the call not read, the check found, the package, the code directory. */
  instrument: string;
  words: string;
}

export interface DriftInvestigateOutcome {
  /** What `--record <id>=` takes; `<path#symbol>` stands for a symbol to give. */
  outcome: string;
  label: string;
  /** Recorded by an agent, a proposal that changes nothing until a person confirms it. */
  needs_person: boolean;
  effect: string;
  /** What else it needs: `title`, `reason`, `fix`, `evidence` (a finding); `files`, `expect`, `replace` (a gap report). */
  needs?: string[];
}

/**
 * `drift findings --json` (schema `drift-findings`, version 1): what an agent found while investigating, local files
 * only (`.drift/findings/`, `.drift/gap-reports/`, git-ignored; nothing is posted or sent).
 */
export interface DriftFindings {
  schema: "drift-findings";
  version: 1;
  findings: DriftFinding[];
  gap_reports: DriftGapReport[];
}

/** A real gap in the repository's code (schema `drift-finding`, version 1; `.drift/findings/<id>.json`). */
export interface DriftFinding {
  schema: "drift-finding";
  version: 1;
  /** `F-` and the 6 hex digits of its item. */
  id: string;
  item: string;
  /** The item's evidence digest when it was recorded. */
  seen: string;
  title: string;
  concern: string;
  /** What Drift said of the routes. */
  drift_said: string;
  /** `GET /x (handler) path:line`. */
  routes: string[];
  /** `item` when `routes` are all the item's: the agent named none (`--routes`) and its evidence names no route's file; the issue draft says so. Absent when the routes are the ones the agent cited. */
  routes_scope?: "item";
  why: string;
  fix: string;
  /** The code cited, as written. */
  excerpts: DriftSetupExcerpt[];
  evidence: string[];
  /** A unified diff the agent wrote, not applied (`drift findings --branch`). */
  patch?: string;
  by: "agent" | "person";
  on: string;
}

/** A construct Drift does not read, as a minimal fixture (schema `drift-gap-report`, version 1; `gap.json`). */
export interface DriftGapReport {
  schema: "drift-gap-report";
  version: 1;
  /** `G-` and the 6 hex digits of its item. */
  id: string;
  item: string;
  seen: string;
  /** What Drift answered in the repository: concern and reason, no names. */
  drift_said: string;
  /** What the right answer is, names replaced. */
  expect: string;
  why: string;
  /** The fixture's files, relative to `fixture/`. */
  files: string[];
  /** What the Drift that wrote it says of the fixture. */
  says: string[];
  drift: string;
  by: "agent" | "person";
  on: string;
}

export interface DriftSetupChoice {
  /** What `--answer <id>=` takes. */
  answer: string;
  label: string;
  /** What it does, counted where it moves routes. */
  effect: string;
  /** The line(s) it writes to `.drift/config.yaml`, under `writes_under`. */
  writes?: string;
  /** The key the lines go under (`security.not_deployed`, `security.terraform`, `security.internal`, `practices.authz`). */
  writes_under?: string;
  /** Routes it moves (0 where none, or not counted before it is picked). */
  moves: number;
  /**
   * Given by an agent, this answer is a proposal until a person confirms it: it could make a route reachable only from
   * inside, or a check counted. Every other answer can only make Drift more cautious and takes effect.
   */
  needs_person: boolean;
}

// ---------- drift census --why --json (crates/drift-mine/src/funnel.rs `why_json`, schema 1) ----------

/** Where a gate's constant comes from (funnel.rs `Origin`): only `study` was measured by a study. */
export type FunnelOrigin = "study" | "pre-registered" | "engineering, no study" | "engineering, rationale written but not measured";

/** One gate of the miner (funnel.rs `GATES`), with how many candidates it dropped in this repository. */
export interface FunnelGate {
  name: string;
  /** The constant it tests against, as the source names it ("" for a gate without one). */
  constant: string;
  /** What a candidate must be to pass it. */
  passes: string;
  origin: FunnelOrigin | (string & {});
  /** Where the gate is decided (a study, a document, a source file). */
  source: string;
  dropped: number;
}

/** Where a dropped candidate's target is defined (funnel.rs `Target`). */
export type FunnelTarget = "repository" | "dependency" | "built_in" | "unresolved" | "mixed" | "none";

/** A candidate a gate dropped. */
export interface FunnelDropped {
  gate: string;
  id: string;
  role: string;
  rule: string;
  family: string;
  lang: "ts" | "py";
  holders: number;
  members: number;
  /** The measured value the gate tested (rounded to 3 places); null when the gate measures none. */
  value: number | null;
  threshold: number | null;
  detail: string;
  target: FunnelTarget | (string & {});
  /** Whether the rule would be in the default tier had it passed. */
  default_tier: boolean;
}

/**
 * `drift census --why [GATE] --json`. Observation only: nothing here is proposed, checked or shown to agents, and the
 * proposals are exactly those of `drift census`.
 */
export interface CensusWhy {
  /** 1 (a newer schema is refused by the Studio's version check). */
  schema: number;
  /** Always true: nothing listed is proposed, checked or shown to agents. */
  observation_only: boolean;
  /** The gate asked for (`--why GATE`); null for every gate. */
  gate: string | null;
  /** Candidates that reached each stage (`roles`, `role_mined`, `observed`, `drafted`, `mined`, `proposed`); may be empty. */
  reached: Partial<Record<FunnelStage, number>>;
  gates: FunnelGate[];
  dropped: FunnelDropped[];
  /** When mining's caps cut default-tier drafts, how many (less those a person rejected), as a sentence; null otherwise (main.rs `census_why`; absent from an older Drift). */
  cap_note?: string | null;
}

/** The funnel's stages, in order (funnel.rs `REACHED`). */
export const FUNNEL_STAGES = ["roles", "role_mined", "observed", "drafted", "mined", "proposed"] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];
