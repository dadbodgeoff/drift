You are checking whether a tool's proposed conventions for the repository **memcode** (https://github.com/lakesare/memcode at `782b0c0293d7c2ab9b7f0ce30786d47f5f84fa24`) cover the conventions the repository documents itself. A checkout is at:

    /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/cache/runs/heldout-ts-2026-11-07-94c2fb3f/repos/memcode

Work only inside that directory, read-only:

- no network, no installs, no builds;
- ignore any `.drift/` directory;
- write only `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/lbx-d02ab6/outbox/005c22c5-a92d-48f3-89da-68274d326b3c/out.jsonl`: no copies, drafts or notes anywhere else, not in your working directory (it is an empty scratch directory) and not in the checkout.

## Decide, for each documented item

**`match`**: compare against the **shown** proposals only.

- **FULL**: one shown proposal (or several together) states the same requirement on substantially the same scope. It would flag essentially the same violations as the documented rule.
  - Wording does not matter.
  - A proposal that lists alternatives ("wrapped in A() or B()") matches a document that allows the same alternatives.
  - Scope matches when the proposal's group covers most of the documented scope. If the document's scope is a whole package and the proposal covers the part of it where the rule actually applies, that also matches.
- **PARTIAL**: one of these:
  - the same requirement on a clearly narrower scope (one sub-area of several the document names);
  - only part of a compound requirement;
  - the same intent stated more weakly, so it would catch only some of the documented violations.
- **NONE**: anything else. Being about the same topic is not a match. For example, "routes call `getSession()`" does not match "routes must be wrapped in `withAuth()`".

**`pool_match`**: the same question, over shown **and** pool proposals. It is always at least as good as `match`.

**`followed`**: does the code follow the documented item?

1. Open two or three files in the item's scope.
2. Use grep to estimate how widely it is followed.
3. Answer `yes`, `mostly` (a few exceptions), `no`, or `unknown` (the scope has no code, or you cannot tell).

## Documented items

- **memcode#R01** (testing, must; CLAUDE.md:46): In tests/*.test.js, test files must live in tests/, and tests that need a DOM (e.g. instantiate Quill) must import tests/setupDom.js as their first import.  
  scope: tests/** test files
- **memcode#R03** (import_restriction, should; CLAUDE.md:79): In backend/**, imports of backend modules should use the `#~/` path alias (mapped to ./backend/* in package.json imports) rather than long relative paths.  
  scope: backend/**/*.js all files
- **memcode#R04** (naming, should; CLAUDE.md:82): In backend/api/**, API controllers should be named `<Entity>Api` (e.g. CourseApi, UserApi).  
  scope: backend/api/** controllers
- **memcode#R05** (calls, must; CLAUDE.md:88): In backend API endpoints, handlers must respond via the injected response.success(obj), response.error(string) and response.validation(array) methods rather than raw res.status().json() (repeated at CLAUDE.md:261 and :395 as 'Always use').  
  scope: backend/api/** endpoint handlers
- **memcode#R06** (import_restriction, should; CLAUDE.md:102): In frontend/**, imports of frontend modules should use the `~/` path alias (e.g. `~/components/Loading`).  
  scope: frontend/**/*.js all files
- **memcode#R07** (file_layout, should; CLAUDE.md:105): In frontend, route-level page components must live in frontend/pages/, one per route.  
  scope: frontend/pages/** page components
- **memcode#R08** (file_layout, should; CLAUDE.md:106): In frontend, reusable (non-page) components should live in frontend/components/ or frontend/appComponents/.  
  scope: frontend/** components
- **memcode#R09** (file_layout, should; frontend/appComponents/Readme.md:1): In frontend, components shared by a few pages but not generic belong in frontend/appComponents/; fully generic components belong in frontend/components/.  
  scope: frontend/appComponents/**, frontend/components/** components
- **memcode#R10** (layering, should; CLAUDE.md:107): In frontend components, backend API calls should go through the centralized services in frontend/api/ (e.g. api.CourseApi.method) rather than direct fetch calls.  
  scope: frontend/** components and pages
- **memcode#R11** (other, should; CLAUDE.md:111): In frontend components, styling should be done with a co-located SCSS CSS module (e.g. `import css from './index.scss'`).  
  scope: frontend/** components
- **memcode#R12** (other, must; CLAUDE.md:151): In frontend component .scss files, there must be exactly one `:local(.componentName)` wrapper per component file.  
  scope: frontend/**/*.scss component stylesheets
- **memcode#R13** (other, should; CLAUDE.md:152): In frontend component .scss files, child selectors should be nested deeply inside the :local() wrapper mirroring the DOM rather than written flat.  
  scope: frontend/**/*.scss component stylesheets
- **memcode#R14** (render, must; CLAUDE.md:153): In frontend components, only the root wrapper element uses the CSS module object (className={css.componentName}); nested elements must use string-literal classNames, not css.className.  
  scope: frontend/** React components
- **memcode#R16** (calls, should; CLAUDE.md:168): In backend, new API routes should query the database with Knex rather than pg-promise.  
  scope: backend/api/** new API routes
- **memcode#R17** (other, must; CLAUDE.md:194): In frontend React code, existing class components must not be converted to function components.  
  scope: frontend/**, meresei/frontend/** React class components
- **memcode#R18** (avoid, must; CLAUDE.md:195): In all JS files, code must not use `export const`; use a default export or an object-form named export (`export { a, b }`).  
  scope: **/*.js all files
- **memcode#R19** (other, should; CLAUDE.md:201): In all JS files, consecutive assignments and object literal values should be column-aligned with extra spaces, and existing alignment must not be collapsed.  
  scope: **/*.js all files
- **memcode#R20** (other, must; CLAUDE.md:211): In all files, comments must not be hard-wrapped onto multiple lines; long single-line comments are allowed (no max-len).  
  scope: **/*.js all files
- **memcode#R21** (other, must; CLAUDE.md:212): In all files, agent-written comments must be avoided unless absolutely necessary; when added they must be a single `//` line prefixed with `[claude comment]`.  
  scope: **/*.js all files (agent-authored code)
- **memcode#R22** (other, should; CLAUDE.md:213): In all JS files, branches that both return should be written as `if { return } else { return }` rather than an early return followed by a bare return.  
  scope: **/*.js all files
- **memcode#R23** (other, should; CLAUDE.md:214): In all JS files, fallback values should be written as a ternary (`x ? x : fallback`) rather than `x || fallback`.  
  scope: **/*.js all files
- **memcode#R25** (naming, should; CLAUDE.md:216): In frontend/pages/**, page components should be named in `Page_<route_segments>` style (e.g. Page_courses_new), not camelCase.  
  scope: frontend/pages/** page components
- **memcode#R27** (other, should; CLAUDE.md:218): In backend pg-promise queries, SQL is written as single-quoted strings with pg-promise `${name}` placeholders and must not be converted into JS template literals.  
  scope: backend/** pg-promise queries
- **memcode#R30** (other, should; CLAUDE.md:227): In React class components, members should be ordered: static methods, then lifecycle methods, then everything else, with render() last.  
  scope: frontend/** React class components
- **memcode#R31** (other, should; CLAUDE.md:251): In backend/**, modules must use ES module import/export syntax rather than CommonJS require/module.exports.  
  scope: backend/**/*.js all files
- **memcode#R32** (other, should; CLAUDE.md:257): In backend, new endpoints should be exposed as controller methods via dynamic routing `/api/:controllerName.:methodName` rather than traditional REST routes like /api/courses/:id.  
  scope: backend/api/** endpoints
- **memcode#R33** (calls, must; CLAUDE.md:280): In backend, new database code must use the Knex query builder imported from `#~/db/knex.js`.  
  scope: backend/** new database queries
- **memcode#R34** (avoid, must; CLAUDE.md:281): In backend, new code must not use pg-promise queries.  
  scope: backend/** new code
- **memcode#R35** (naming, should; CLAUDE.md:282): In backend application code, database fields must be referenced in camelCase (converted by knex-stringcase), while DB columns stay snake_case.  
  scope: backend/** database access code
- **memcode#R37** (calls, should; CLAUDE.md:292): In frontend components, async API calls should use the SPE pattern: state key `speXxx` initialized to {}, and `api.SomeApi.method((speXxx) => this.setState({ speXxx }), data)` with status 'request'|'success'|'failure'.  
  scope: frontend/** components making API calls
- **memcode#R38** (render, should; CLAUDE.md:314): In frontend components, SPE request/success/failure states should be rendered with `<Loading spe={...}>` from `~/components/Loading` (optionally with enabledStatuses).  
  scope: frontend/** components rendering async data
- **memcode#R39** (other, should; CLAUDE.md:335): In frontend forms, field values should be kept in `this.state.formState` and inputs receive `{...this.inputProps()}` where inputProps returns { formState, updateFormState }.  
  scope: frontend/** form components
- **memcode#R40** (other, should; CLAUDE.md:358): In frontend form submit handlers, submission should use an SPE state (speSubmit), return early when speSubmit.status === 'request', disable the submit button while requesting, and show failures with <Loading enabledStatuses={['failure']}>.  
  scope: frontend/** form components
- **memcode#R41** (file_layout, should; backend/api/PageApi/Readme.md:1): In backend, per-page data-fetching GET routes should be placed in backend/api/PageApi/.  
  scope: backend/api/PageApi/** routes
- **memcode#R42** (other, must; backend/api/PageApi/Readme.md:5): In backend/api/PageApi/**, only GET (read) routes may be defined; deletes and updates must not be placed there.  
  scope: backend/api/PageApi/** routes
- **memcode#R43** (other, must; eslint.config.js:22): In frontend/**/*.js, React, PropTypes, connect, Quill, process and require are read-only globals injected by frontend/esbuild-shims.js and must not be reassigned; other undeclared globals are flagged by no-undef.  
  scope: frontend/**/*.js
- **memcode#R44** (avoid, must; eslint.config.js:38): In frontend/**/*.js, unused variables must not be declared (unused function arguments and rest-sibling vars are allowed).  
  scope: frontend/**/*.js
- **memcode#R47** (other, must; eslint.config.js:42): In frontend/**/*.js, the React global used by JSX must be marked as used (prevents false no-unused-vars on React).  
  scope: frontend/**/*.js
- **memcode#R48** (other, must; eslint.config.js:43): In frontend/**/*.js, variables referenced as JSX elements must be counted as used for no-unused-vars.  
  scope: frontend/**/*.js
- **memcode#R49** (render, must; eslint.config.js:44): In frontend/**/*.js, JSX elements in arrays or iterators (e.g. .map) must have a `key` prop.  
  scope: frontend/**/*.js React components
- **memcode#R50** (avoid, must; eslint.config.js:45): In frontend/**/*.js, deprecated React APIs and lifecycle methods (e.g. componentWillMount, ReactDOM.render where deprecated) must not be used.  
  scope: frontend/**/*.js React components
- **memcode#R51** (avoid, must; eslint.config.js:46): In frontend/**/*.js React class components, this.state must not be mutated directly outside the constructor; use setState.  
  scope: frontend/**/*.js React class components
- **memcode#R52** (render, must; eslint.config.js:47): In frontend/**/*.js, children must not be passed via a `children` prop; nest them as JSX children instead.  
  scope: frontend/**/*.js React components
- **memcode#R53** (avoid, must; eslint.config.js:60): In backend/**, services/**, tests/**, env*.js, *.config.js and frontend/esbuild*.js, unused variables must not be declared (unused function arguments and rest-sibling vars are allowed).  
  scope: backend/**/*.js, services/**/*.js, tests/**/*.js, env*.js, *.config.js, frontend/esbuild*.js

## Proposals shown to the user

```text
[D-3a63a0] files in backend/** do not import from meresei/backend/** (declared dependencies, and lazy loads of peer or optional dependencies, excepted)
    evidence: 108/109 (lower bound 0.95, lift 3.0)
    example:  backend/afterMiddleware.js#(file)
    outlier:  backend/index.js:1 (file)
```

## Pool: further proposals, not shown by default

(none)

## Output

One JSON object per documented item, one per line:

```json
{"ref": "memcode#R01", "match": "PARTIAL", "proposals": ["D-015190"],
 "pool_match": "FULL", "pool_proposals": ["D-015190", "D-d24d21"],
 "followed": "mostly", "checked": ["apps/web/app/api/links/route.ts"],
 "reason": "D-015190 covers workspace routes only; with the pool's D-d24d21 all of app/api is covered."}
```

Use the proposal ids exactly as shown. When you finish, reply with one line: the counts of FULL, PARTIAL and NONE for `match`.
