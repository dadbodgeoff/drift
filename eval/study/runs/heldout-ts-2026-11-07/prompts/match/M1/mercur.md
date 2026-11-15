You are checking whether a tool's proposed conventions for the repository **mercur** (https://github.com/mercurjs/mercur at `fd4e5a3e311fe1d39596f6b53c5e729a65ff2d4d`) cover the conventions the repository documents itself. A checkout is at:

    /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/cache/runs/heldout-ts-2026-11-07-94c2fb3f/repos/mercur

Work only inside that directory, read-only:

- no network, no installs, no builds;
- ignore any `.drift/` directory;
- write only `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/lbx-d02ab6/outbox/bc143493-1e76-4680-a7b8-ba4312252e4b/out.jsonl`: no copies, drafts or notes anywhere else, not in your working directory (it is an empty scratch directory) and not in the checkout.

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

- **mercur#R01** (typing, must; CLAUDE.md:64): In all TypeScript files, code must not use the `any` type.  
  scope: **/*.{ts,tsx} all files
- **mercur#R02** (other, must; CLAUDE.md:65): In all source files, comments must not narrate what the code does or explain the obvious; comments are only allowed for non-obvious intent (workarounds, gotchas, why).  
  scope: **/* all source files
- **mercur#R03** (testing, must; CLAUDE.md:72): In integration-tests/**, tests must be written with Jest.  
  scope: integration-tests/** test files
- **mercur#R04** (testing, must; CLAUDE.md:73): In integration-tests/**, integration specs must use `medusaIntegrationTestRunner` from `@medusajs/test-utils`.  
  scope: integration-tests/**/*.spec.ts
- **mercur#R05** (testing, should; CLAUDE.md:74): In integration-tests/**, specs should create admin users, sellers and customers through the helpers in `integration-tests/helpers` rather than ad hoc setup.  
  scope: integration-tests/**/*.spec.ts
- **mercur#R06** (file_layout, must; CLAUDE.md:75): In integration-tests/http/**, spec files must be placed under per-surface folders (`<domain>/admin/`, `<domain>/vendor/`, `<domain>/store/`), e.g. `http/product/vendor/product.spec.ts`.  
  scope: integration-tests/http/** spec files
- **mercur#R09** (other, must; docs/ARCHITECTURE.md:62): In packages/core/src/workflows/**, steps must return a `StepResponse` and workflows must return a `WorkflowResponse`.  
  scope: packages/core/src/workflows/** steps and workflows
- **mercur#R10** (layering, must; docs/ARCHITECTURE.md:63): In packages/core/src/modules/**, a module must not import or reference another module directly; cross-module communication must go through links (`src/links`) and workflows.  
  scope: packages/core/src/modules/** module code
- **mercur#R11** (calls, must; docs/ARCHITECTURE.md:77): In packages/admin, packages/vendor and dashboard apps, HTTP calls must go through `@mercurjs/client` (`createClient` proxy) and no other HTTP layer.  
  scope: packages/{admin,vendor,dashboard-shared}/src/**, apps/{admin-test,vendor}/src/**
- **mercur#R12** (calls, must; docs/ARCHITECTURE.md:126): In commission code (packages/core commission module/workflows), money arithmetic must use BigNumber (MathBN) rather than plain JS number arithmetic.  
  scope: packages/core/src/** commission and payout code
- **mercur#R13** (typing, must; docs/ARCHITECTURE.md:127): In packages/core and plugins, steps and subscribers must resolve the payout module typed as `IPayoutModuleService` from `@mercurjs/types`.  
  scope: packages/**/src/{workflows,subscribers}/** payout code
- **mercur#R14** (file_layout, must; docs/UI-ARCHITECTURE.md:101): In the dashboards, a new primitive used by both admin and vendor must live in `packages/dashboard-shared`; page-specific composites stay in the consuming package.  
  scope: packages/{admin,vendor,dashboard-shared}/src/components/**
- **mercur#R15** (layering, must; docs/UI-ARCHITECTURE.md:54): In packages/dashboard-shared, code must not contain pages, routes, providers or i18n configuration; it is a library that re-exports from `src/index.ts`.  
  scope: packages/dashboard-shared/src/**
- **mercur#R16** (other, must; docs/UI-ARCHITECTURE.md:162): In packages/{admin,vendor}/src/get-route-map.tsx, each route leaf must be a `lazy()` import of a page module that exports `Component` (optionally `loader`, `Breadcrumb`, `ErrorBoundary`).  
  scope: packages/{admin,vendor}/src/get-route-map.tsx and page modules
- **mercur#R17** (file_layout, must; docs/UI-ARCHITECTURE.md:182): In packages/{admin,vendor}/src/pages/<domain>/, each domain folder must have an `index.ts` barrel, a `common/` folder for shared hooks/utils, and `<domain>-list/`, `<domain>-detail/`, `<domain>-create/`, `<domain>-edit/` subfolders with `<domain>-<page>.tsx` files.  
  scope: packages/{admin,vendor}/src/pages/**
- **mercur#R18** (file_layout, should; docs/UI-ARCHITECTURE.md:197): In packages/{admin,vendor}/src/pages/<domain>/<domain>-detail/, the detail page must provide `breadcrumb.tsx` and a react-router `loader.ts` alongside `<domain>-detail.tsx`.  
  scope: packages/{admin,vendor}/src/pages/**/*-detail/
- **mercur#R19** (file_layout, must; docs/UI-ARCHITECTURE.md:206): In packages/{admin,vendor}/src/pages/**/<domain>-create/components/create-<domain>-form/, each tab must be its own `create-<domain>-<tab>.tsx` file exporting a `Root` with `_tabMeta`, and the Zod schema must live in `schema.ts`.  
  scope: packages/{admin,vendor}/src/pages/**/*-create/
- **mercur#R20** (file_layout, should; docs/UI-ARCHITECTURE.md:219): In packages/vendor/src/pages/**, new pages should use the admin-style folders (`<domain>-list/`, `<domain>-detail/`, `components/`) rather than `_components/` and `[id]/`.  
  scope: packages/vendor/src/pages/** new pages
- **mercur#R21** (other, must; docs/UI-ARCHITECTURE.md:221): In packages/{admin,vendor}/src/pages/**, every page must be exported as a compound component built with `Object.assign(Root, { Header, HeaderTitle, ... })`.  
  scope: packages/{admin,vendor}/src/pages/** page components
- **mercur#R22** (render, must; docs/UI-ARCHITECTURE.md:233): In packages/{admin,vendor}/src/pages/**, a page `Root` must render `Children.count(children) > 0 ? children : <DefaultContent />`.  
  scope: packages/{admin,vendor}/src/pages/** page Root components
- **mercur#R23** (render, must; docs/UI-ARCHITECTURE.md:237): In dashboard pages, page content must mount inside `SingleColumnPage` (lists, settings, simple detail) or `TwoColumnPage` (detail with sidebar).  
  scope: packages/{admin,vendor}/src/pages/**, apps/*/src/routes/**
- **mercur#R24** (render, must; docs/UI-ARCHITECTURE.md:248): In dashboard detail pages, `TwoColumnPage` must have exactly two children: `TwoColumnPage.Main` and `TwoColumnPage.Sidebar`.  
  scope: dashboard detail pages using TwoColumnPage
- **mercur#R25** (argument, must; docs/UI-ARCHITECTURE.md:249): In dashboard pages, when `showJSON` or `showMetadata` is set on a page layout, `data={entity}` must also be passed.  
  scope: dashboard pages using SingleColumnPage/TwoColumnPage
- **mercur#R26** (render, must; docs/UI-ARCHITECTURE.md:254): In dashboard pages, every section must be a `Container` from `@medusajs/ui` with `className="divide-y p-0"`.  
  scope: packages/{admin,vendor}/src/pages/** sections
- **mercur#R27** (render, must; docs/UI-ARCHITECTURE.md:268): In dashboard sections, the header row must use `flex items-center justify-between px-6 py-4` with a `<Heading>` on the left and actions on the right; each row uses `px-6 py-4`.  
  scope: dashboard section headers and rows
- **mercur#R28** (calls, should; docs/UI-ARCHITECTURE.md:269): In dashboard sections, label/value rows should use the `SectionRow` component.  
  scope: dashboard section label/value rows
- **mercur#R29** (avoid, must; docs/UI-ARCHITECTURE.md:273): In dashboard forms, code must not use react-hook-form `Controller` directly; fields must go through `Form.Field`.  
  scope: packages/{admin,vendor,dashboard-shared}/src/** forms
- **mercur#R30** (render, must; docs/UI-ARCHITECTURE.md:295): In dashboard forms, every `Form.Field` render must wrap its content in `<Form.Item>` with `Form.Label`, `Form.Control` and `Form.ErrorMessage`.  
  scope: dashboard form fields
- **mercur#R31** (render, must; docs/UI-ARCHITECTURE.md:297): In dashboard forms, field error text must not be rendered manually; use `Form.ErrorMessage`.  
  scope: dashboard form fields
- **mercur#R32** (render, should; docs/UI-ARCHITECTURE.md:298): In dashboard forms, help text below an input should use `Form.Hint`.  
  scope: dashboard form fields
- **mercur#R33** (argument, must; docs/UI-ARCHITECTURE.md:299): In dashboard forms, `Select` fields must destructure `{ ref, onChange, ...field }`, pass `onValueChange={onChange}` and `dir={useDocumentDirection()}`.  
  scope: dashboard form Select fields
- **mercur#R34** (wrapper, must; docs/UI-ARCHITECTURE.md:300): In dashboard forms, the form element must be wrapped in `<KeyboundForm>` rather than a raw `<form>`.  
  scope: dashboard forms
- **mercur#R35** (file_layout, must; docs/UI-ARCHITECTURE.md:304): In dashboard forms, each form must have one exported Zod schema in `schema.ts` or co-located with the form.  
  scope: dashboard forms
- **mercur#R36** (typing, must; docs/UI-ARCHITECTURE.md:305): In dashboard forms, `useForm` must use `zodResolver(schema)` and the form type must be `z.infer<typeof Schema>`.  
  scope: dashboard forms
- **mercur#R37** (calls, must; docs/UI-ARCHITECTURE.md:306): In dashboard forms, nullable/optional values must pass through `transformNullableFormData` / `transformNullableFormNumber` before calling the mutation.  
  scope: dashboard form submit handlers
- **mercur#R38** (render, must; docs/UI-ARCHITECTURE.md:310): In dashboard forms, tab content bodies must use `flex w-full max-w-[720px] flex-col gap-y-8` and drawer bodies `flex flex-col gap-y-4`.  
  scope: dashboard form bodies
- **mercur#R39** (calls, should; docs/UI-ARCHITECTURE.md:312): In dashboard forms, toggle rows should use `SwitchBox` rather than a hand-styled `Switch`.  
  scope: dashboard forms
- **mercur#R40** (wrapper, must; docs/UI-ARCHITECTURE.md:316): In dashboard create pages, the page must be hosted in `RouteFocusModal`, and multi-step creates must use `TabbedForm`.  
  scope: packages/{admin,vendor}/src/pages/**/*-create/
- **mercur#R41** (other, must; docs/UI-ARCHITECTURE.md:341): In `TabbedForm` create flows, each tab component's `Root` must set `Root._tabMeta = defineTabMeta<Schema>({ id, labelKey, validationFields })`.  
  scope: dashboard TabbedForm tab components
- **mercur#R42** (calls, should; docs/UI-ARCHITECTURE.md:344): In `TabbedForm` create flows, typed tab components with `_tabMeta` should be preferred over bare `TabbedForm.Tab`.  
  scope: dashboard TabbedForm usages
- **mercur#R43** (wrapper, must; docs/UI-ARCHITECTURE.md:350): In dashboard edit pages, the page must be hosted in `RouteDrawer` with the form in `RouteDrawer.Form` + `KeyboundForm`, and a footer with secondary Cancel (`RouteDrawer.Close`) and primary Save with `isLoading={isPending}`.  
  scope: packages/{admin,vendor}/src/pages/**/*-edit/
- **mercur#R44** (render, must; docs/UI-ARCHITECTURE.md:390): In dashboard edit drawers, the edit form must only render when `ready = !isPending && !!entity`.  
  scope: dashboard edit pages
- **mercur#R45** (calls, must; docs/UI-ARCHITECTURE.md:391): In dashboard route modals/drawers, the mutation `onSuccess` must call `useRouteModal().handleSuccess(path?)` to close and navigate.  
  scope: dashboard RouteDrawer/RouteFocusModal forms
- **mercur#R46** (error_handling, must; docs/UI-ARCHITECTURE.md:392): In dashboard pages using query hooks, components must `if (isError) throw error` so the `ErrorBoundary` catches it.  
  scope: dashboard page components using query hooks
- **mercur#R47** (calls, must; docs/UI-ARCHITECTURE.md:419): In dashboard list tables, columns must be built with `createColumnHelper<Row>()` and include an `actions` display column rendering `<ActionMenu>`.  
  scope: dashboard table column hooks (use-<domain>-table-columns.tsx)
- **mercur#R48** (argument, must; docs/UI-ARCHITECTURE.md:420): In dashboard list tables, row navigation must be configured via `navigateTo={(row) => row.id}` on the DataTable.  
  scope: dashboard DataTable usages
- **mercur#R49** (argument, must; docs/UI-ARCHITECTURE.md:421): In dashboard list tables, the page size must be `PAGE_SIZE = 20`.  
  scope: dashboard list pages
- **mercur#R50** (argument, must; docs/UI-ARCHITECTURE.md:422): In dashboard list query hooks, paginated queries must use `keepPreviousData` from TanStack Query.  
  scope: dashboard list pages/hooks
- **mercur#R51** (calls, must; docs/UI-ARCHITECTURE.md:423): In dashboard list tables, filters and search must be wired through a `use<Domain>TableQuery` hook returning `{ raw, searchParams }`.  
  scope: dashboard list tables
- **mercur#R52** (render, must; docs/UI-ARCHITECTURE.md:427): In dashboard tables, empty states must use `<NoResults />` (filtered, no matches) or `<NoRecords />` (no records yet).  
  scope: dashboard list/table empty states
- **mercur#R53** (calls, must; docs/UI-ARCHITECTURE.md:434): In dashboard pages, row and section action menus must be rendered with `ActionMenu`; hand-built dropdowns are not allowed.  
  scope: dashboard row/section actions
- **mercur#R54** (other, must; docs/UI-ARCHITECTURE.md:446): In `ActionMenu` groups, edit/navigation actions must come first and destructive actions last in their own group.  
  scope: dashboard ActionMenu groups
- **mercur#R55** (argument, should; docs/UI-ARCHITECTURE.md:447): In `ActionMenu` actions, unavailable actions should be shown with `disabled` + `disabledTooltip` rather than hidden.  
  scope: dashboard ActionMenu actions
- **mercur#R56** (file_layout, must; docs/UI-ARCHITECTURE.md:452): In dashboard pages, destructive actions must be encapsulated in a `use-delete-<entity>-action.tsx` hook under `pages/<domain>/common/hooks/`.  
  scope: packages/{admin,vendor}/src/pages/**/common/hooks/
- **mercur#R57** (calls, must; docs/UI-ARCHITECTURE.md:454): In delete-action hooks, the hook must call `usePrompt()` from `@medusajs/ui` with translated title/description/confirmText/cancelText, then the mutation, then `toast.success`/`toast.error`, then navigate back.  
  scope: use-delete-*-action.tsx hooks
- **mercur#R58** (avoid, must; docs/UI-ARCHITECTURE.md:459): In dashboard pages, confirmation modals for destructive actions must not be inlined; use the delete-action hook with `usePrompt()`.  
  scope: dashboard destructive actions
- **mercur#R59** (avoid, must; docs/UI-ARCHITECTURE.md:463): In dashboard pages, code must not call `fetch` directly; all HTTP must go through the typed `sdk` from `lib/client`.  
  scope: packages/{admin,vendor}/src/pages/**
- **mercur#R60** (calls, must; docs/UI-ARCHITECTURE.md:465): In packages/admin, API calls must use the `sdk.admin.*` namespace; in packages/vendor, `sdk.vendor.*`.  
  scope: packages/{admin,vendor}/src/hooks/api/**
- **mercur#R61** (typing, must; docs/UI-ARCHITECTURE.md:482): In dashboard data hooks, request/response types must come from `InferClientInput` / `InferClientOutput` and errors typed as `ClientError` from `@mercurjs/client`.  
  scope: packages/{admin,vendor}/src/hooks/api/**
- **mercur#R62** (naming, must; docs/UI-ARCHITECTURE.md:486): In packages/{admin,vendor}/src/hooks/api/<domain>.tsx, each domain file must create `const xQueryKeys = queryKeysFactory("x")` and expose `useX`, `useXList` and `useCreate/Update/DeleteX` hooks.  
  scope: packages/{admin,vendor}/src/hooks/api/*.tsx
- **mercur#R63** (calls, must; docs/UI-ARCHITECTURE.md:490): In dashboard mutation hooks, mutations must invalidate `lists()` / `details()` / `detail(id)` query keys and forward `onSuccess` to the caller.  
  scope: packages/{admin,vendor}/src/hooks/api/*.tsx mutation hooks
- **mercur#R64** (calls, must; docs/UI-ARCHITECTURE.md:492): In dashboard data hooks, query keys for any new domain must be built with `queryKeysFactory`.  
  scope: packages/{admin,vendor}/src/hooks/api/*.tsx
- **mercur#R65** (other, should; docs/UI-ARCHITECTURE.md:494): In dashboard detail pages, initial data should come from a `loader.ts` and be passed to the query hook via `initialData`.  
  scope: dashboard detail pages
- **mercur#R66** (calls, must; docs/UI-ARCHITECTURE.md:498): In dashboard UI code, every user-facing string must go through `useTranslation()` / `t(key)`; no literal UI strings.  
  scope: packages/{admin,vendor}/src/** UI components
- **mercur#R67** (file_layout, must; docs/UI-ARCHITECTURE.md:499): In packages/{admin,vendor}, translations must live in `src/i18n/translations/<lng>.json` and new keys must also be reflected in `$schema.json`.  
  scope: packages/{admin,vendor}/src/i18n/translations/
- **mercur#R68** (calls, must; docs/UI-ARCHITECTURE.md:501): In dashboard UI, tab labels must use `labelKey` on `_tabMeta` and column headers, drawer titles and dialog copy must use i18n keys.  
  scope: dashboard tabs, tables, drawers, dialogs
- **mercur#R69** (argument, must; docs/UI-ARCHITECTURE.md:503): In dashboard UI, `Select`, `DropdownMenu` and similar menu components must receive `dir={useDocumentDirection()}`.  
  scope: dashboard Select/DropdownMenu/Combobox usages
- **mercur#R70** (import_restriction, must; docs/UI-ARCHITECTURE.md:507): In dashboard packages, UI components must come from `@medusajs/ui` (and `@mercurjs/dashboard-shared`); no other UI component library may be imported.  
  scope: packages/{admin,vendor,dashboard-shared}/src/**
- **mercur#R71** (import_restriction, must; docs/UI-ARCHITECTURE.md:510): In dashboard packages, Radix primitives not re-exported by Medusa UI must be imported from the bundled `radix-ui` package (not individual `@radix-ui/*` packages).  
  scope: packages/{admin,vendor,dashboard-shared}/src/**
- **mercur#R72** (avoid, must; docs/UI-ARCHITECTURE.md:511): In dashboard packages, code must not restyle Medusa UI components with custom CSS or introduce a parallel UI library.  
  scope: packages/{admin,vendor,dashboard-shared}/src/**
- **mercur#R73** (import_restriction, must; docs/UI-ARCHITECTURE.md:515): In dashboard packages, icons must be imported only from `@medusajs/icons`.  
  scope: packages/{admin,vendor,dashboard-shared}/src/**
- **mercur#R74** (import_restriction, must; docs/UI-ARCHITECTURE.md:516): In dashboard packages, code must not import other icon packs (lucide, heroicons) or define custom SVG icon components.  
  scope: packages/{admin,vendor,dashboard-shared}/src/**
- **mercur#R75** (argument, must; docs/UI-ARCHITECTURE.md:517): In `ActionMenu` row/section actions, each icon must be passed via the action descriptor's `icon` prop.  
  scope: dashboard ActionMenu actions
- **mercur#R76** (avoid, must; docs/UI-ARCHITECTURE.md:522): In dashboard UI code, colors must use Medusa UI tokens (`bg-ui-*`, `text-ui-fg-*`, `border-ui-border-*`, `shadow-elevation-*`); hex, `rgb(...)` and palette utilities (e.g. `text-gray-500`) are not allowed.  
  scope: packages/{admin,vendor,dashboard-shared}/src/** classNames and styles
- **mercur#R77** (calls, must; docs/UI-ARCHITECTURE.md:529): In dashboard UI code, conditional class merging must use `clx` from `@medusajs/ui` (not clsx/classnames).  
  scope: packages/{admin,vendor,dashboard-shared}/src/**
- **mercur#R78** (render, must; docs/UI-ARCHITECTURE.md:533): In dashboard UI code, headings must use `<Heading>` (`level="h2"` for sidebar sections); raw `<h1>`-`<h6>` elements must not be used.  
  scope: packages/{admin,vendor,dashboard-shared}/src/** JSX
- **mercur#R79** (render, should; docs/UI-ARCHITECTURE.md:534): In dashboard UI code, table-row/section text should use `<Text size="small" leading="compact">`, chips/breadcrumbs `<Text size="xsmall">`, emphasis `weight="plus"`.  
  scope: dashboard JSX text
- **mercur#R80** (render, must; docs/UI-ARCHITECTURE.md:536): In dashboard UI code, body/subtle copy must use `<Text>` with `text-ui-fg-subtle`/`text-ui-fg-muted`; raw `<p>` with palette classes must not be used.  
  scope: dashboard JSX text
- **mercur#R81** (render, must; docs/UI-ARCHITECTURE.md:540): In dashboard UI code, spacing must use the documented scale (`px-6 py-4` rows, `gap-x-2/3/4` clusters, `gap-y-3` page stack, `gap-y-4` drawers, `gap-y-8` focus modals, `grid grid-cols-1 gap-4 md:grid-cols-2` field grids).  
  scope: dashboard JSX classNames
- **mercur#R82** (argument, must; docs/UI-ARCHITECTURE.md:541): In dashboard toolbars and footers, `Button` must use `size="small"` with `primary` (save), `secondary` (cancel/nav) or `transparent` variants.  
  scope: dashboard toolbar/footer buttons
- **mercur#R83** (render, must; docs/UI-ARCHITECTURE.md:545): In dashboard sections, status must be rendered with `StatusBadge` using color/label helpers from `pages/<domain>/common/utils.ts`, placed in the header row before the `ActionMenu`.  
  scope: dashboard section headers
- **mercur#R84** (render, must; docs/UI-ARCHITECTURE.md:549): In dashboard pages, loading placeholders must use `Skeleton` (detail pages: `TwoColumnPageSkeleton`).  
  scope: dashboard loading states
- **mercur#R85** (naming, must; docs/UI-ARCHITECTURE.md:553): In dashboard UI code, every interactive element (buttons, inputs, headings, dropdown items) must carry a kebab-case `data-testid` scoped to the page/section.  
  scope: packages/{admin,vendor,dashboard-shared}/src/** JSX
- **mercur#R86** (file_layout, must; docs/UI-ARCHITECTURE.md:591): In packages/{admin,vendor}, new translation keys must be added to `src/i18n/translations/en.json` under the domain namespace.  
  scope: packages/{admin,vendor}/src/i18n/translations/en.json
- **mercur#R87** (file_layout, must; docs/UI-ARCHITECTURE.md:604): In dashboard packages, TanStack Query hooks must live in `packages/<dashboard>/src/hooks/api/<domain>.tsx`; helpers shared by multiple pages in `src/lib/`.  
  scope: packages/{admin,vendor}/src/hooks/api/**
- **mercur#R88** (file_layout, should; docs/UI-ARCHITECTURE.md:612): In dashboard packages, a primitive duplicated in both admin and vendor should instead be placed once in `@mercurjs/dashboard-shared` and imported.  
  scope: packages/{admin,vendor}/src/components/**
- **mercur#R89** (import_restriction, must; docs/UI-ICONS.md:5): In all UI code, icons must be imported only from `@medusajs/icons`; `lucide-react`, `react-icons`, `heroicons`, `phosphor` etc. must not be imported.  
  scope: packages/**/src/** and apps/** UI code
- **mercur#R90** (avoid, must; docs/UI-ICONS.md:5): In UI code, missing icons must not be replaced with hand-rolled SVG components; pick the closest `@medusajs/icons` match.  
  scope: UI code
- **mercur#R91** (avoid, must; docs/UI-ICONS.md:19): In UI code, icon colors must be set with Medusa UI token classes; hex colors must not be passed to icons.  
  scope: UI code using @medusajs/icons
- **mercur#R92** (render, should; docs/UI-ICONS.md:237): In UI code, `Mini`/`Micro` icon variants should only be used inside dense UI (tables, inline labels, badges); buttons and menus use default size.  
  scope: UI code using @medusajs/icons
- **mercur#R93** (avoid, must; docs/UI-ICONS.md:245): In UI code, raw `<svg>` markup must not be inlined except for user-uploaded content.  
  scope: UI JSX
- **mercur#R94** (avoid, must; docs/UI-ICONS.md:246): In UI code, icon size must not be set with hardcoded `width`/`height` props; use Tailwind size classes or a sized container.  
  scope: UI code using @medusajs/icons
- **mercur#R95** (argument, must; docs/PERFORMANCE.md:19): In cart, offer, pricing and listing workflows, `createWorkflow` must not set `retentionTime`, `idempotent`, `timeout`, `retryInterval`, `store` or `async` steps.  
  scope: packages/core/src/workflows/{cart,offer,price-list,...}/** workflows
- **mercur#R96** (argument, must; docs/PERFORMANCE.md:21): In API route handlers on high-frequency routes, workflow runs must not pass a deterministic `transactionId`.  
  scope: packages/core/src/api/** hot-path routes
- **mercur#R97** (calls, must; docs/PERFORMANCE.md:29): In Mercur workflows, independent steps (seller lookup, commission rule resolution, payout reads) must be grouped in one `parallelize(...)`.  
  scope: packages/core/src/workflows/**
- **mercur#R98** (other, must; docs/PERFORMANCE.md:40): In workflow steps, every step must return early on empty input.  
  scope: packages/**/src/workflows/**/steps/*.ts
- **mercur#R99** (calls, must; docs/PERFORMANCE.md:47): In split-order completion workflows, `acquireLockStep` must lock on `cart_id` (timeout 30, ttl 120); inventory locks must be per inventory item, never per seller or global.  
  scope: packages/core/src/workflows/cart/** completion workflows
- **mercur#R100** (other, should; docs/PERFORMANCE.md:57): In Mercur workflows, query fields should be per-purpose constants, sub-workflows should accept a preloaded entity, and `transform` lookups should use `Map`.  
  scope: packages/core/src/workflows/**
- **mercur#R101** (argument, must; docs/PERFORMANCE.md:67): In Mercur steps and services, module update methods must be called with a `{ id, ...data }[]` array, never one selector per row.  
  scope: packages/**/src/workflows/**/steps, module services
- **mercur#R102** (argument, must; docs/PERFORMANCE.md:83): In import/export, payout batch and reindex workflows, long work must use `async: true` background steps with 50-1000 item chunks; async steps must never be used on cart paths.  
  scope: packages/**/src/workflows/** import/export/payout batch workflows
- **mercur#R103** (argument, must; docs/PERFORMANCE.md:91): In cached `useQueryGraphStep` queries touching Mercur link tables, explicit `Link<Name>:list:*` cache tags must be provided.  
  scope: packages/core/src/workflows/** cached queries
- **mercur#R104** (avoid, must; docs/PERFORMANCE.md:104): In Mercur backend code, data must be read with one `query.graph` with explicit `fields`, never by looping over sellers calling services.  
  scope: packages/**/src backend code
- **mercur#R105** (avoid, must; docs/PERFORMANCE.md:106): In list routes, `query.graph` must not expand unbounded one-to-many links (e.g. seller to products); internal lookups should pass only `take` (no `skip`).  
  scope: packages/**/src/api/** list routes and internal lookups
- **mercur#R106** (other, must; docs/PERFORMANCE.md:118): In Mercur modules, models must use `model.define`, modules must not configure `database.clientUrl`, and filters must only target persisted columns.  
  scope: packages/core/src/modules/**
- **mercur#R107** (argument, must; docs/PERFORMANCE.md:138): In Mercur module services, every nested service call must receive the `@MedusaContext() sharedContext`; bulk create/update arrays and `upsertWithReplace` should be used for imports.  
  scope: packages/**/src/modules/**/service*.ts
- **mercur#R108** (other, must; docs/PERFORMANCE.md:151): In Mercur data models, composite indexes must be declared for every filter combination used on list routes (e.g. `seller_id + status`, `seller_id + created_at`).  
  scope: packages/**/src/modules/**/models/*.ts
- **mercur#R109** (other, must; docs/PERFORMANCE.md:153): In Mercur backend code, any raw SQL query must include a `deleted_at IS NULL` condition.  
  scope: packages/**/src raw SQL / knex queries
- **mercur#R110** (calls, must; docs/PERFORMANCE.md:166): In Mercur pricing reads, the pricing context must be passed through `QueryContext(req.pricingContext)` on `variants.calculated_price`; `calculatePrices` must never be called per variant.  
  scope: packages/core/src/** pricing code
- **mercur#R111** (argument, must; docs/PERFORMANCE.md:176): In packages/core/src/links, the seller-product link must be marked `filterable`, and entity ids must be ULIDs.  
  scope: packages/core/src/links/product-seller-link.ts and models
- **mercur#R113** (typing, must; docs/PERFORMANCE.md:195): In Mercur subscribers, handlers must accept `id: string[]` payloads; events must be emitted from workflows with `emitEventStep`, emitting arrays in one call.  
  scope: packages/**/src/subscribers/**, workflows
- **mercur#R114** (argument, must; docs/PERFORMANCE.md:222): In seller and product listing routes, `query.graph` must be called with `{ cache: { enable: true }, locale }`.  
  scope: packages/core/src/api/**/sellers, products list routes
- **mercur#R115** (naming, must; docs/PERFORMANCE.md:224): In Mercur modules, events must be named `<entity>.<op>` (e.g. `seller.updated`) with `{ id }` payloads, and cached queries must always select `id`.  
  scope: packages/core/src/** events and cached queries
- **mercur#R116** (calls, must; docs/PERFORMANCE.md:226): In Mercur backend code, commission rule resolution and seller shipping aggregation should be wrapped in `useCache`, and cached results must never be mutated in place.  
  scope: packages/core/src/** commission/shipping code
- **mercur#R117** (other, must; docs/PERFORMANCE.md:242): In module `onApplicationStart` hooks, heavy work must be guarded by a `worker_mode !== "server"` check.  
  scope: packages/**/src/modules/** onApplicationStart hooks
- **mercur#R118** (argument, must; docs/PERFORMANCE.md:249): In Mercur route validators, find-params `limit` must have `.max(100)`, and field allowlists must be extended with `allowFields(...)` rather than widening core allowlists; `/vendor/*` routes need a middleware setting the relations limit.  
  scope: packages/core/src/api/**/validators.ts, middlewares.ts
- **mercur#R119** (argument, must; docs/PERFORMANCE.md:252): In vendor product list routes and queries, curated field lists must be used, never `*`-relation defaults.  
  scope: packages/core/src/api/vendor/products/**, vendor dashboard product queries
- **mercur#R120** (calls, should; docs/PERFORMANCE.md:291): In seller-scoped listing middlewares, code should reuse `normalizeDataForContext`, `setPricingContext` and `setTaxContext` from `@medusajs/medusa/api/utils/middlewares` rather than reimplementing them.  
  scope: packages/core/src/api/** listing middlewares
- **mercur#R121** (calls, must; packages/core/ARCHITECTURE.md:103): In packages/core/src/modules/<name>/index.ts, the module must be registered with `Module(MercurModules.<NAME>, { service, loaders? })`.  
  scope: packages/core/src/modules/*/index.ts
- **mercur#R122** (base_class, must; packages/core/ARCHITECTURE.md:119): In packages/core/src/modules/*/service.ts, the service must extend `MedusaService({ ...Models })` and custom methods must use `@InjectManager` / `@InjectTransactionManager`.  
  scope: packages/core/src/modules/*/service.ts
- **mercur#R123** (naming, must; packages/core/ARCHITECTURE.md:121): In packages/core, module identifier strings must come from the `MercurModules` enum in `@mercurjs/types`, not string literals.  
  scope: packages/core/src/** module registration and resolution
- **mercur#R125** (calls, must; packages/core/ARCHITECTURE.md:131): In packages/core/src/links/, relationships between Mercur and Medusa entities must be declared with `defineLink(...)` in `*-link.ts` files.  
  scope: packages/core/src/links/*.ts
- **mercur#R126** (file_layout, should; packages/core/ARCHITECTURE.md:206): In packages/core/src/api/** endpoint directories, handlers go in `route.ts`, Zod schemas in `validators.ts`, default fields/pagination in `query-config.ts`, private helpers in `helpers.ts`, and path params in `[id]/` subdirectories.  
  scope: packages/core/src/api/** endpoint folders
- **mercur#R127** (naming, must; packages/core/ARCHITECTURE.md:210): In packages/core/src/api/**/middlewares.ts, route middleware bindings must be exported as a named array called `<scope><Resource>Middlewares` (e.g. `vendorProductsMiddlewares`).  
  scope: packages/core/src/api/**/middlewares.ts
- **mercur#R128** (calls, should; packages/core/ARCHITECTURE.md:215): In packages/core/src/api/**/route.ts, handlers should resolve `ContainerRegistrationKeys.QUERY` for reads and run a workflow for writes.  
  scope: packages/core/src/api/**/route.ts
- **mercur#R129** (file_layout, must; packages/core/ARCHITECTURE.md:221): In packages/core/src/workflows/<entity>/, workflows must be split into `steps/` and `workflows/` subdirectories with a barrel `index.ts`, all re-exported from `src/workflows/index.ts`.  
  scope: packages/core/src/workflows/**
- **mercur#R130** (naming, must; packages/core/ARCHITECTURE.md:245): In packages/core workflows, event names must be referenced through the constants in `src/workflows/events.ts` (e.g. `SellerWorkflowEvents`), not string literals.  
  scope: packages/core/src/workflows/** event emission
- **mercur#R131** (calls, must; packages/core/ARCHITECTURE.md:304): In packages/core vendor handlers and middleware, the acting seller must be read from `req.seller_context` (typed via `src/types/seller-context.ts`).  
  scope: packages/core/src/api/vendor/**
- **mercur#R132** (file_layout, must; packages/dashboard-shared/ARCHITECTURE.md:214): In packages/dashboard-shared, public components and hooks must be re-exported through `src/components/index.ts` / `src/hooks/index.ts` barrels from `src/index.ts`.  
  scope: packages/dashboard-shared/src/index.ts and barrels
- **mercur#R133** (import_restriction, must; packages/dashboard-shared/ARCHITECTURE.md:218): In consumers of `@mercurjs/dashboard-shared`, imports must come from the package root `@mercurjs/dashboard-shared`, never from sub-paths or `dist/...`.  
  scope: packages/{admin,vendor,registry}/**, apps/**, blocks
- **mercur#R134** (import_restriction, must; packages/dashboard-shared/ARCHITECTURE.md:246): In packages/registry blocks, dashboard primitives must be imported from `@mercurjs/dashboard-shared`.  
  scope: packages/registry/src/** block UI code
- **mercur#R135** (calls, must; packages/dashboard-shared/ARCHITECTURE.md:265): In dashboard forms, schemas must be built with `zod` and resolved via `@hookform/resolvers/zod`; address/email/transfer-ownership rules must reuse `AddressSchema`, `EmailSchema`, `TransferOwnershipSchema` from `lib/schemas.ts`.  
  scope: dashboard forms
- **mercur#R136** (argument, must; packages/dashboard-shared/ARCHITECTURE.md:268): In dashboard forms, composite forms (`AddressForm`, `EmailForm`, `MetadataForm`) must receive the parent's `control` and must not create an inner `useForm`.  
  scope: dashboard composite forms
- **mercur#R137** (calls, must; packages/dashboard-shared/ARCHITECTURE.md:269): In dashboard forms, toggles must use `SwitchBox`, country pickers `CountrySelect` / `ProvinceSelect`, and slug fields `HandleInput`.  
  scope: dashboard forms
- **mercur#R138** (avoid, should; packages/dashboard-shared/ARCHITECTURE.md:276): In new dashboard list pages, code should use the current `DataTable` (`components/data-table`) and not the deprecated `_DataTable`.  
  scope: new dashboard list pages
- **mercur#R139** (calls, should; packages/dashboard-shared/ARCHITECTURE.md:278): In dashboard tables, column cells should use the shared cell primitives (`TextCell`, `StatusCell`, `MoneyAmountCell`, `DateCell`, ...).  
  scope: dashboard table columns
- **mercur#R140** (other, must; packages/dashboard-shared/ARCHITECTURE.md:284): In dashboard pages, `DataGrid` must only be used for bulk-editable matrices, not as a table replacement; price columns use `createDataGridColumnHelper` / `createDataGridPriceColumns`.  
  scope: dashboard DataGrid usages
- **mercur#R141** (calls, must; packages/dashboard-shared/ARCHITECTURE.md:290): In dashboard UI, overflow and row-action menus must be `ActionMenu`.  
  scope: dashboard row/section actions
- **mercur#R142** (render, should; packages/dashboard-shared/ARCHITECTURE.md:298): In dashboard pages, loading states should render `SingleColumnPageSkeleton` / `TwoColumnPageSkeleton` (or `TableSkeleton` for tables) matching the final layout.  
  scope: dashboard loading states
- **mercur#R143** (calls, must; packages/dashboard-shared/ARCHITECTURE.md:306): In dashboard UI, displayed dates must be formatted with the `useDate` hook.  
  scope: dashboard date display
- **mercur#R144** (calls, must; packages/dashboard-shared/ARCHITECTURE.md:319): In dashboard data hooks, every `useX` / `useXList` hook must build keys with `queryKeysFactory(globalKey)`.  
  scope: dashboard query hooks
- **mercur#R145** (avoid, must; packages/dashboard-shared/ARCHITECTURE.md:323): In dashboard UI, currency formatting must use `getLocaleAmount` / `getDecimalDigits` / `getNativeSymbol` and must not call `Intl.NumberFormat` directly.  
  scope: dashboard money formatting
- **mercur#R146** (layering, must; packages/dashboard-shared/ARCHITECTURE.md:376): In packages/dashboard-shared, code must not contain routing or domain/business logic.  
  scope: packages/dashboard-shared/src/**
- **mercur#R147** (other, must; packages/dashboard-shared/ARCHITECTURE.md:210): In packages/dashboard-shared build config, `react`, `react-dom` and `virtual:mercur/*` modules must be marked external.  
  scope: packages/dashboard-shared/tsup.config.*
- **mercur#R148** (file_layout, must; apps/admin-test/CLAUDE.md:26): In apps/admin-test, custom admin pages must be `page.tsx` files under `src/routes`, with the file path controlling the route.  
  scope: apps/admin-test/src/routes/**
- **mercur#R149** (other, must; apps/admin-test/CLAUDE.md:28): In apps/admin-test/src/routes, a page that appears in navigation must export a route config.  
  scope: apps/admin-test/src/routes/**/page.tsx
- **mercur#R150** (calls, should; apps/admin-test/CLAUDE.md:44): In apps/admin-test, UI should use existing wrappers and `@medusajs/ui` before introducing new primitives.  
  scope: apps/admin-test/src/**
- **mercur#R151** (calls, must; apps/admin-test/CLAUDE.md:45): In apps/admin-test, user-facing strings must use i18n rather than hardcoded copy.  
  scope: apps/admin-test/src/**
- **mercur#R152** (calls, should; apps/admin-test/CLAUDE.md:46): In apps/admin-test, API calls should use the typed Mercur client (`@mercurjs/client`).  
  scope: apps/admin-test/src/**
- **mercur#R153** (render, should; apps/admin-test/CLAUDE.md:47): In apps/admin-test screens, loading, error, empty and success states should be handled.  
  scope: apps/admin-test/src/routes/**
- **mercur#R154** (file_layout, must; apps/vendor/CLAUDE.md:26): In apps/vendor, custom vendor pages must be `page.tsx` files under `src/routes`, with the file path controlling the route.  
  scope: apps/vendor/src/routes/**
- **mercur#R155** (calls, should; apps/vendor/CLAUDE.md:33): In apps/vendor, UI should use existing wrappers and `@medusajs/ui` before adding lower-level primitives.  
  scope: apps/vendor/src/**
- **mercur#R156** (calls, must; apps/vendor/CLAUDE.md:34): In apps/vendor, user-facing strings must use i18n.  
  scope: apps/vendor/src/**
- **mercur#R157** (calls, should; apps/vendor/CLAUDE.md:35): In apps/vendor, requests should use the typed client rather than ad hoc request code (e.g. raw fetch).  
  scope: apps/vendor/src/**
- **mercur#R158** (render, should; apps/vendor/CLAUDE.md:36): In apps/vendor flows, loading, empty, error and success states should be handled.  
  scope: apps/vendor/src/routes/**
- **mercur#R159** (file_layout, must; templates/basic/apps/admin/CLAUDE.md:26): In templates/basic/apps/admin, custom admin pages must be `page.tsx` files under `src/routes`.  
  scope: templates/basic/apps/admin/src/routes/**
- **mercur#R160** (calls, must; templates/basic/apps/admin/CLAUDE.md:45): In templates/basic/apps/admin, user-facing strings must use i18n rather than hardcoded copy.  
  scope: templates/basic/apps/admin/src/**
- **mercur#R161** (calls, should; templates/basic/apps/admin/CLAUDE.md:46): In templates/basic/apps/admin, API calls should use the typed Mercur client.  
  scope: templates/basic/apps/admin/src/**
- **mercur#R162** (file_layout, must; templates/basic/apps/vendor/CLAUDE.md:26): In templates/basic/apps/vendor, custom vendor pages must be `page.tsx` files under `src/routes`.  
  scope: templates/basic/apps/vendor/src/routes/**
- **mercur#R163** (calls, must; templates/basic/apps/vendor/CLAUDE.md:34): In templates/basic/apps/vendor, user-facing strings must use i18n.  
  scope: templates/basic/apps/vendor/src/**
- **mercur#R164** (calls, should; templates/basic/apps/vendor/CLAUDE.md:35): In templates/basic/apps/vendor, requests should use the typed client rather than ad hoc request code.  
  scope: templates/basic/apps/vendor/src/**
- **mercur#R165** (file_layout, must; templates/basic/packages/api/CLAUDE.md:67): In templates/basic/packages/api, backend code must live under `src/api`, `src/modules`, `src/workflows`, `src/links`, `src/subscribers`, `src/jobs` or `src/scripts`.  
  scope: templates/basic/packages/api/src/**
- **mercur#R166** (layering, should; templates/basic/packages/api/CLAUDE.md:81): In templates/basic/packages/api, relationships across modules must be defined as links (`src/links`), domain events handled by subscribers, scheduled work by jobs, and multi-step processes by workflows.  
  scope: templates/basic/packages/api/src/**
- **mercur#R167** (other, must; .claude/skills/mercur-review/references/medusa-backend.md:9): In backend route handlers, a write route must only run one workflow with `{ id: req.params.id, ...req.validatedBody }`, refetch the entity with `req.queryConfig.fields`, and `res.json` it.  
  scope: packages/core/src/api/**/route.ts, packages/plugins/*/src/api/**/route.ts
- **mercur#R168** (calls, must; .claude/skills/mercur-review/references/medusa-backend.md:19): In backend API routes, the refetch helper must live in the resource's `helpers.ts` and use `refetchEntity` from `@medusajs/framework/http`.  
  scope: packages/**/src/api/**/helpers.ts
- **mercur#R169** (calls, must; .claude/skills/mercur-review/references/medusa-backend.md:21): In backend API routes, validation must be wired in `middlewares.ts` with `validateAndTransformBody` (zod `.strict()` schema) and `validateAndTransformQuery` (query-config defaults); field lists must be in `query-config.ts`, never inline in `route.ts`.  
  scope: packages/**/src/api/**
- **mercur#R170** (layering, must; .claude/skills/mercur-review/references/medusa-backend.md:22): In backend route files, code must not call `createStep`/`createWorkflow`, call module `service.*` methods, resolve ids via lookups, branch on entity state, run two workflows, pass `throwOnError: false`, or read module options.  
  scope: packages/**/src/api/**/route.ts
- **mercur#R171** (layering, must; .claude/skills/mercur-review/references/medusa-backend.md:23): In `src/api/hooks/**` webhook routes, the handler must only emit an event; parsing and running the workflow (by id) belongs in a subscriber.  
  scope: packages/**/src/api/hooks/**/route.ts
- **mercur#R172** (naming, must; .claude/skills/mercur-review/references/medusa-backend.md:29): In workflow files, code must export `xWorkflowId` (kebab-case string), `type XWorkflowInput`, and `xWorkflow = createWorkflow(xWorkflowId, function (input) {...})` with a short JSDoc.  
  scope: packages/**/src/workflows/**/workflows/*.ts
- **mercur#R173** (argument, must; .claude/skills/mercur-review/references/medusa-backend.md:30): In workflows, the input must take ids and minimal values rather than whole entities; data must not be passed in only to forward it to an event.  
  scope: packages/**/src/workflows/** workflow inputs
- **mercur#R174** (calls, must; .claude/skills/mercur-review/references/medusa-backend.md:31): In workflows, data loading must use `useQueryGraphStep(...)` and every repeated query step must have a unique `.config({ name })`.  
  scope: packages/**/src/workflows/**
- **mercur#R175** (calls, must; .claude/skills/mercur-review/references/medusa-backend.md:32): In workflow composition functions, branching must use named `when("name", {deps}, fn).then(...)` and calculations must happen only inside `transform`.  
  scope: packages/**/src/workflows/** composition functions
- **mercur#R176** (avoid, must; .claude/skills/mercur-review/references/medusa-backend.md:33): In workflow composition functions, a `when` must not be nested inside another `when`'s `.then`; use sibling `when` blocks.  
  scope: packages/**/src/workflows/**
- **mercur#R177** (other, must; .claude/skills/mercur-review/references/medusa-backend.md:34): In workflows, a query whose `id: [...]` or `$or: [...]` filter could be empty must be wrapped in a `when` guard.  
  scope: packages/**/src/workflows/**
- **mercur#R178** (error_handling, must; .claude/skills/mercur-review/references/medusa-backend.md:35): In `validate-*` workflow steps, failures must throw `MedusaError` with a proper type (`NOT_FOUND`, `NOT_ALLOWED`, `INVALID_DATA`, `CONFLICT`) and success must return `new StepResponse(void 0)`.  
  scope: packages/**/src/workflows/**/steps/validate-*.ts
- **mercur#R179** (calls, must; .claude/skills/mercur-review/references/medusa-backend.md:36): In workflows, existing Medusa/Mercur steps must be reused, nested workflows invoked with `xWorkflow.runAsStep({ input })`, and extension points exposed with `createHook`.  
  scope: packages/**/src/workflows/**
- **mercur#R180** (file_layout, must; .claude/skills/mercur-review/references/medusa-backend.md:37): In workflows, pure helpers (no container, no IO) must live in `workflows/<domain>/utils/`; helpers that query or write must be steps, not utils.  
  scope: packages/**/src/workflows/**/utils/
- **mercur#R181** (file_layout, must; .claude/skills/mercur-review/references/medusa-backend.md:43): In workflow `steps/` folders, each file must define exactly one step and `steps/index.ts` must re-export every step file.  
  scope: packages/**/src/workflows/**/steps/
- **mercur#R182** (naming, must; .claude/skills/mercur-review/references/medusa-backend.md:44): In step files, code must export `xStepId` and `xStep = createStep(xStepId, invoke, compensate)`.  
  scope: packages/**/src/workflows/**/steps/*.ts
- **mercur#R183** (other, must; .claude/skills/mercur-review/references/medusa-backend.md:45): In workflow steps, each step must make one module call and its compensation must restore exactly what it changed.  
  scope: packages/**/src/workflows/**/steps/*.ts
- **mercur#R184** (other, must; .claude/skills/mercur-review/references/medusa-backend.md:46): In workflow steps without a compensation function, a one-line comment must explain why the effect cannot be undone.  
  scope: packages/**/src/workflows/**/steps/*.ts
- **mercur#R185** (argument, must; .claude/skills/mercur-review/references/medusa-backend.md:47): In batch workflow steps, input must be an array and the step must handle `[]` without failing.  
  scope: packages/**/src/workflows/**/steps/*.ts
- **mercur#R186** (naming, must; .claude/skills/mercur-review/references/medusa-backend.md:53): In module services, the class must be named `XModuleService` and extend `MedusaService({ ...models })`; custom methods must use domain verbs that do not collide with generated CRUD names.  
  scope: packages/**/src/modules/**/service*.ts
- **mercur#R187** (decorator, must; .claude/skills/mercur-review/references/medusa-backend.md:55): In module services, public write methods must be decorated with `@InjectManager()` and `@EmitEvents()` and take a trailing `@MedusaContext() sharedContext?: Context`.  
  scope: packages/**/src/modules/**/service*.ts
- **mercur#R188** (decorator, must; .claude/skills/mercur-review/references/medusa-backend.md:56): In module services, internal transactional write methods must be `protected async x_()` (trailing underscore) decorated with `@InjectTransactionManager()`.  
  scope: packages/**/src/modules/**/service*.ts
- **mercur#R189** (naming, must; .claude/skills/mercur-review/references/medusa-backend.md:57): In module services, provider calls must be in `protected async xFromProvider_()` methods outside the transaction so no row lock is held across a network call.  
  scope: packages/**/src/modules/**/service*.ts
- **mercur#R190** (avoid, must; .claude/skills/mercur-review/references/medusa-backend.md:58): In module service files, there must be no free functions or module-scope helpers; helpers must be `protected` methods and constants `static readonly`; status derivation lives in the service, not `utils/`.  
  scope: packages/**/src/modules/**/service*.ts
- **mercur#R191** (calls, must; .claude/skills/mercur-review/references/medusa-backend.md:59): In module services, provider access must go through a provider service (`retrieveProvider`) and optional provider methods must be guarded before calling.  
  scope: packages/**/src/modules/** provider-backed services
- **mercur#R192** (layering, must; .claude/skills/mercur-review/references/medusa-backend.md:60): In modules, code must not import other modules, and module migrations must not touch other modules' tables.  
  scope: packages/**/src/modules/**
- **mercur#R193** (calls, must; .claude/skills/mercur-review/references/medusa-backend.md:64): In backend code, links must be created in workflows via `createRemoteLinkStep`, not with `link.create` inside a util.  
  scope: packages/**/src/workflows/**
- **mercur#R194** (naming, must; .claude/skills/mercur-review/references/medusa-backend.md:66): In link definitions, a link alias must not match an existing relation name on the same module.  
  scope: packages/**/src/links/*.ts
- **mercur#R195** (argument, must; .claude/skills/mercur-review/references/medusa-backend.md:67): In client/backend queries, `fields` entries meant to extend route defaults must be prefixed with `+` or `-`.  
  scope: fields params in client calls and queries
- **mercur#R196** (calls, must; .claude/skills/mercur-review/references/medusa-backend.md:68): In workflows, events must be emitted with `emitEventStep({ eventName, data })` using event-name constants from `@mercurjs/types`.  
  scope: packages/**/src/workflows/**
- **mercur#R197** (other, must; .claude/skills/mercur-review/references/medusa-backend.md:72): In route overrides of core Medusa routes, the override must include the route file and list the core middleware in `disableMedusaMiddlewares`.  
  scope: packages/core/src/api/** overrides
- **mercur#R198** (testing, must; .claude/skills/mercur-review/references/medusa-backend.md:77): In integration specs, products must be created with the `createVendorProduct` helper from `integration-tests/helpers`.  
  scope: integration-tests/**/*.spec.ts
- **mercur#R199** (argument, must; .claude/skills/mercur-review/references/dashboard-ui.md:8): In dashboard list pages, the table must be configured with `filters`, `pagination`, `navigateTo` and `noRecords`.  
  scope: packages/{admin,vendor}/src/pages/**, plugin src/{admin,vendor}/**
- **mercur#R200** (render, must; .claude/skills/mercur-review/references/dashboard-ui.md:9): In dashboard detail pages, `TwoColumnPage` must include `showJSON` and `WidgetZone`s, and the general section header must hold the title, a `StatusBadge` and an `ActionMenu`.  
  scope: dashboard detail pages
- **mercur#R201** (avoid, must; .claude/skills/mercur-review/references/dashboard-ui.md:10): In dashboard pages, page-level tabs and KPI/count strips must not be used; related entities must be nested sidebar items via `defineRouteConfig({ nested: "/parent" })`.  
  scope: dashboard pages and plugin panels
- **mercur#R202** (other, must; .claude/skills/mercur-review/references/dashboard-ui.md:11): In plugin panels, entities already shown by core pages must be extended with a widget in that page's zone rather than a duplicate page or table.  
  scope: packages/plugins/*/src/{admin,vendor}/**
- **mercur#R203** (calls, must; .claude/skills/mercur-review/references/dashboard-ui.md:16): In dashboard pages, links to another entity must use `SidebarLink` or a section row link (`text-ui-fg-subtle hover:text-ui-fg-base`), not a hand-made card.  
  scope: dashboard pages
- **mercur#R204** (file_layout, must; .claude/skills/mercur-review/references/dashboard-ui.md:22): In plugin panels, create/edit drawers must be routed as parallel route folders (`routes/x/@create/page.tsx`) over a list rendered with `SingleColumnPage hasOutlet`.  
  scope: packages/plugins/*/src/{admin,vendor}/routes/**
- **mercur#R205** (avoid, must; .claude/skills/mercur-review/references/dashboard-ui.md:23): In dashboard and plugin panel forms, forms must use react-hook-form + `zodResolver`; `useState`-managed forms and raw `Drawer` must not be used.  
  scope: dashboard and plugin panel forms
- **mercur#R206** (render, must; .claude/skills/mercur-review/references/dashboard-ui.md:24): In dashboard forms, entity pickers must be a `Combobox` searching the API, never a free-text id input.  
  scope: dashboard forms
- **mercur#R207** (argument, should; .claude/skills/mercur-review/references/dashboard-ui.md:25): In dashboard `ActionMenu` actions, each action should carry `permission`, `disabled` and `disabledTooltip`.  
  scope: dashboard ActionMenu actions
- **mercur#R208** (other, must; .claude/skills/mercur-review/references/dashboard-ui.md:29): In dashboard query hooks, query hooks must return `{ ...data, ...rest }` and mutation hooks must accept options and forward `onSuccess` after invalidating.  
  scope: packages/{admin,vendor}/src/hooks/api/*.tsx
- **mercur#R209** (argument, must; .claude/skills/mercur-review/references/dashboard-ui.md:30): In dashboard client queries, undefined params (e.g. `q: undefined`) must not be spread into the query; they must be added conditionally.  
  scope: dashboard client calls
- **mercur#R210** (argument, must; .claude/skills/mercur-review/references/dashboard-ui.md:31): In vendor product lists, queries must use `useProductTableQuery`'s curated fields and must not add `+field` to `GET /vendor/products`.  
  scope: packages/vendor/src/** product lists
- **mercur#R211** (render, must; .claude/skills/mercur-review/references/dashboard-ui.md:35): In dashboard UI, status enums and provider codes must be mapped to labels and names shown instead of ids; raw values must not be rendered.  
  scope: dashboard UI
- **mercur#R213** (file_layout, must; .claude/skills/mercur-review/references/dashboard-ui.md:37): In core panels, new strings must be added to both `en.json` and `$schema.json` together.  
  scope: packages/{admin,vendor}/src/i18n/translations/
- **mercur#R214** (argument, must; .claude/skills/mercur-review/references/dashboard-ui.md:38): In plugin panels, nav items for plugin routes must be `type: "extension"`, and brand icons must follow the Medusa extension-icon shape (15x15 square, brand fill, gradient overlay, 9x9 glyph).  
  scope: packages/plugins/*/src/{admin,vendor}/** navigation and icons
- **mercur#R215** (avoid, must; .claude/skills/mercur-review/references/dashboard-ui.md:42): In dashboard and plugin panel UI, only Medusa UI tokens and `@medusajs/icons` may be used; brand marks are the only exception and must carry a one-line comment saying so.  
  scope: dashboard and plugin panel UI
- **mercur#R216** (naming, must; .claude/skills/mercur-review/references/dashboard-ui.md:44): In dashboard and plugin panel UI, headings, inputs, buttons and menu triggers must have kebab-case page-scoped `data-testid`s.  
  scope: dashboard and plugin panel JSX
- **mercur#R217** (file_layout, must; .claude/skills/mercur-review/references/reviewers.md:12): In backend code, steps/workflows must not be defined inside route files, a file must not hold several steps, and steps must have ids and compensation where rollback is possible.  
  scope: packages/core/src/**, packages/plugins/*/src/** backend
- **mercur#R218** (calls, must; .claude/skills/mercur-review/references/reviewers.md:35): In backend code, money arithmetic must use `MathBN`.  
  scope: packages/**/src backend money calculations
- **mercur#R219** (avoid, must; .claude/skills/mercur-review/references/reviewers.md:38): In backend hot paths, code must not issue N+1 queries or unbounded `take: null` list queries.  
  scope: packages/**/src backend
- **mercur#R220** (wrapper, must; .claude/skills/mercur-review/references/reviewers.md:45): In backend admin and vendor routes, vendor routes must be scoped to `req.seller_context` and admin/vendor routes must apply `requirePermission`.  
  scope: packages/**/src/api/{admin,vendor}/**
- **mercur#R221** (other, must; .claude/skills/mercur-review/references/reviewers.md:48): In webhook handlers, payloads must be verified with the provider's signature check before being trusted.  
  scope: packages/**/src/api/hooks/**, providers
- **mercur#R222** (avoid, must; .claude/skills/mercur-review/references/reviewers.md:49): In backend code, raw SQL / `raw()` must not interpolate request input.  
  scope: packages/**/src backend SQL
- **mercur#R223** (argument, must; .claude/skills/mercur-review/references/reviewers.md:50): In backend POST routes, request bodies must be validated with a zod `.strict()` validator.  
  scope: packages/**/src/api/** POST routes
- **mercur#R224** (other, must; .claude/skills/mercur-review/references/reviewers.md:56): In all code, comments must not narrate code, restate names, reference specs/tickets or say "Mercur-specific"/"for robustness"; only external gotchas warrant comments.  
  scope: all source files
- **mercur#R225** (typing, must; .claude/skills/mercur-review/references/reviewers.md:57): In TypeScript code, `any`, `as never` and `as unknown as` casts must not be used where a real type exists.  
  scope: **/*.{ts,tsx}
- **mercur#R226** (naming, must; .claude/skills/mercur-review/references/reviewers.md:58): In backend code, names must follow Medusa vocabulary (`create`/`process`/`update`/`refetch`) rather than `dispatch*`, `evaluate*`, `ensure*`.  
  scope: packages/**/src backend functions, steps, workflows
- **mercur#R227** (avoid, should; .claude/skills/mercur-review/references/reviewers.md:60): In all code, dead code, unused exports, unneeded compatibility shims and single-caller abstractions should not be added.  
  scope: all source files
- **mercur#R228** (file_layout, should; .claude/skills/mercur-review/references/reviewers.md:61): In all code, files should not exceed ~300 lines while mixing concerns.  
  scope: all source files
- **mercur#R229** (avoid, must; .claude/skills/mercur-review/references/reviewers.md:62): In code and comments, there must be no mention of AI tools, Mirakl, "port of" or "the connector".  
  scope: all source files
- **mercur#R230** (import_restriction, must; .claude/skills/figma-ui/references/components.md:10): In dashboard packages, code must not import MUI, Chakra, Ant, Mantine, lucide, heroicons, react-icons, FontAwesome, styled-components or emotion.  
  scope: packages/{admin,vendor,dashboard-shared}/src/**
- **mercur#R231** (avoid, must; .claude/skills/figma-ui/references/components.md:45): In dashboard create/edit pages, raw `FocusModal` / `Drawer` from `@medusajs/ui` must not be rendered; use `RouteFocusModal` / `RouteDrawer`.  
  scope: dashboard create/edit pages
- **mercur#R232** (avoid, must; .claude/skills/figma-ui/references/components.md:64): In dashboard forms, raw `<input>`, `<textarea>`, `<select>` elements and `<Controller>` must not be used; use Medusa UI/shared primitives inside `Form.Field`.  
  scope: dashboard forms
- **mercur#R233** (avoid, must; .claude/skills/figma-ui/references/components.md:101): In dashboard UI, Medusa UI component appearance must be chosen with variant/size props, not overridden via `className` (className-overriding Medusa UI components is forbidden).  
  scope: dashboard JSX using @medusajs/ui
- **mercur#R234** (argument, must; .claude/skills/figma-ui/references/components.md:111): In dashboard UI, `StatusBadge` color/label must come from `pages/<domain>/common/utils.ts` helpers, not hardcoded.  
  scope: dashboard StatusBadge usages
- **mercur#R235** (render, should; .claude/skills/figma-ui/references/spacing.md:20): In dashboard UI, spacing should use the scale (`py-4`, `px-6`, `gap-y-3/4/8`) rather than arbitrary `mt-*` / `space-y-[...]` values.  
  scope: dashboard JSX classNames
- **mercur#R236** (avoid, must; .claude/skills/figma-ui/references/spacing.md:46): In dashboard UI, buttons must not be hand-colored; use `Button` variants or `IconButton`.  
  scope: dashboard buttons
- **mercur#R237** (render, must; .claude/skills/figma-ui/references/spacing.md:48): In dashboard UI, focus rings must use `shadow-borders-focus`, not custom outlines.  
  scope: dashboard JSX classNames
- **mercur#R238** (avoid, must; .claude/skills/figma-ui/references/spacing.md:5): In dashboard UI, colors must not be forked per theme (e.g. `dark:` color overrides); rely on Medusa UI tokens.  
  scope: dashboard JSX classNames
- **mercur#R239** (avoid, must; .claude/skills/figma-ui/references/patterns.md:22): In dashboard sections, a section `Container` must not omit `p-0`, raw `<h2>`/`<h3>` must not replace `<Heading>`, and dropdowns must not be hand-built instead of `ActionMenu`.  
  scope: dashboard sections
- **mercur#R240** (calls, must; .claude/skills/figma-ui/references/patterns.md:53): In dashboard UI, a modal opened inside a route modal must use `StackedFocusModal` / `StackedDrawer`, not a nested raw modal.  
  scope: dashboard modals
- **mercur#R241** (avoid, must; .claude/skills/figma-ui/references/patterns.md:118): In dashboard UI, arbitrary spacing values must not be used where the scale has a value.  
  scope: dashboard JSX classNames
- **mercur#R242** (avoid, must; .claude/skills/figma-ui/references/patterns.md:104): In dashboard UI, every visible string must use `t(key)`; literal UI strings are not allowed.  
  scope: packages/{admin,vendor}/src/**
- **mercur#R243** (avoid, must; .claude/skills/mercur-figure/SKILL.md:24): In docs figure sources (apps/docs/figures/*.mjs), colours and sizes must not be defined outside `.claude/skills/mercur-figure/kit.mjs`.  
  scope: apps/docs/figures/*.mjs
- **mercur#R245** (other, must; .claude/skills/mercur-figure/SKILL.md:49): In apps/docs/figures/<name>.mjs, the module must `export default { name, width, height, alt, draw(f) }` and draw using only kit primitives.  
  scope: apps/docs/figures/*.mjs
- **mercur#R246** (avoid, must; .claude/skills/mercur-figure/SKILL.md:72): In apps/docs/figures/*.mjs, figures must not contain raw `<rect>` markup, hex colours or font sizes; missing primitives go into `kit.mjs`.  
  scope: apps/docs/figures/*.mjs
- **mercur#R247** (render, must; .claude/skills/mercur-figure/references/rules.md:43): In docs figure sources, text must never be coloured and the violet accent should mark only one place.  
  scope: apps/docs/figures/*.mjs
- **mercur#R248** (layering, must; apps/docs/learn/architecture.mdx:16): In API route handlers, every write must run a workflow, and each workflow step must have a compensation function.  
  scope: src/api/** route handlers, src/workflows/** steps
- **mercur#R249** (layering, must; apps/docs/learn/architecture.mdx:17): In modules, a module must never import another module; module services are called from workflow steps.  
  scope: src/modules/**
- **mercur#R250** (layering, must; apps/docs/learn/architecture.mdx:18): In module models, relationships between modules must not use foreign keys between their tables; they must be recorded as links.  
  scope: src/modules/**/models, src/links/**
- **mercur#R251** (calls, must; apps/docs/learn/architecture.mdx:20): In API route handlers, reads must use Medusa Query (`query.graph`) rather than workflows or cross-module service calls.  
  scope: src/api/** GET handlers
- **mercur#R252** (base_class, must; apps/docs/learn/architecture.mdx:79): In payout providers, the provider must implement `IPayoutProvider` from `@mercurjs/types` (`createPayoutAccount`, `createOnboarding`, `createPayout`, `getWebhookActionAndData`).  
  scope: src/providers/** payout providers, packages/plugins/stripe-connector
- **mercur#R253** (calls, should; apps/docs/references/api/conventions.mdx:16): In clients of the Mercur API (panels, storefront, integrations), calls should use the typed `@mercurjs/client`.  
  scope: API client code
- **mercur#R254** (argument, must; apps/docs/references/api/conventions.mdx:99): In `fields` query parameters meant to merge with route defaults, every entry must be prefixed with `+` or `-`.  
  scope: API client calls with fields
- **mercur#R255** (error_handling, must; apps/docs/references/api/conventions.mdx:108): In Mercur API routes, errors must follow Medusa's `{ type, message }` format (thrown as `MedusaError` types such as `invalid_data`, `not_allowed`, `not_found`).  
  scope: packages/core/src/api/**
- **mercur#R256** (layering, must; apps/docs/resources/best-practices/overview.mdx:15): In backend and frontend code, each layer (Frontend -> API Route -> Workflow -> Module) may only call the layer directly beneath it.  
  scope: all backend and panel code
- **mercur#R257** (layering, must; apps/docs/resources/best-practices/overview.mdx:58): In API routes, subscribers and scheduled jobs, code must not write to the database directly; all mutations must run a workflow.  
  scope: src/api/**, src/subscribers/**, src/jobs/**
- **mercur#R258** (naming, must; apps/docs/resources/best-practices/overview.mdx:62): In API `route.ts` files, only `GET`, `POST` and `DELETE` handlers may be exported; `PUT` and `PATCH` must not be used.  
  scope: src/api/**/route.ts
- **mercur#R259** (layering, must; apps/docs/resources/best-practices/overview.mdx:66): In module services, code must never import or call another module's service.  
  scope: src/modules/**/service.ts
- **mercur#R260** (layering, must; apps/docs/resources/best-practices/overview.mdx:71): In module services, methods must not touch more than one module's data; such logic belongs in a workflow.  
  scope: src/modules/**/service.ts
- **mercur#R261** (other, must; apps/docs/resources/best-practices/overview.mdx:72): In workflow steps, each step must perform a single mutation and define its compensation.  
  scope: src/workflows/**/steps
- **mercur#R262** (layering, must; apps/docs/resources/best-practices/overview.mdx:80): In backend code, input shape validation must be done with Zod schemas at the API route, not in module services or workflows.  
  scope: src/api/**, src/modules/**, src/workflows/**
- **mercur#R263** (layering, must; apps/docs/resources/best-practices/overview.mdx:88): In backend code, domain events must be emitted from workflow steps (`emitEventStep`), not from module services or subscribers.  
  scope: src/modules/**, src/subscribers/**, src/workflows/**
- **mercur#R264** (layering, must; apps/docs/resources/best-practices/overview.mdx:89): In backend code, response field selection must be defined in the API route `queryConfig`, not in the module service.  
  scope: src/api/**, src/modules/**
- **mercur#R265** (layering, must; apps/docs/resources/best-practices/overview.mdx:86): In API routes, side effects reacting to an event (emails, sync, indexing) must not be inlined; they belong in a subscriber that runs a workflow, and periodic work in a scheduled job.  
  scope: src/api/**, src/subscribers/**, src/jobs/**
- **mercur#R266** (typing, must; apps/docs/resources/best-practices/api-routes.mdx:68): In API route handlers, the request must be typed `AuthenticatedMedusaRequest<TBodyOrQuery>` and the response `MedusaResponse<TResponse>`; a bare `MedusaResponse` must not be used.  
  scope: src/api/**/route.ts
- **mercur#R267** (typing, must; apps/docs/resources/best-practices/api-routes.mdx:85): In API routes, validation must be wired in `middlewares.ts` via `validateAndTransformBody` / `validateAndTransformQuery`, and every Zod schema in `validators.ts` must export its `z.infer` type.  
  scope: src/api/**/validators.ts, middlewares.ts
- **mercur#R268** (calls, must; apps/docs/resources/best-practices/api-routes.mdx:100): In API validators, list query params must use `createFindParams` and retrieve params `createSelectParams`, not hand-rolled objects.  
  scope: src/api/**/validators.ts
- **mercur#R269** (avoid, must; apps/docs/resources/best-practices/api-routes.mdx:121): In API route handlers, input must be read from `req.validatedBody` / validated query and must not be re-validated inside the handler.  
  scope: src/api/**/route.ts
- **mercur#R270** (avoid, must; apps/docs/resources/best-practices/api-routes.mdx:173): In API route handlers, filters must be forwarded from `req.filterableFields`; handlers must not build `where` clauses by hand, and scoping filters are injected by middleware.  
  scope: src/api/**/route.ts
- **mercur#R271** (calls, must; apps/docs/resources/best-practices/api-routes.mdx:213): In backend queries, `query.graph` filters must only use fields of the entity's own module; cross-module filters must use `query.index`.  
  scope: src/** query.graph calls
- **mercur#R272** (other, must; apps/docs/resources/best-practices/api-routes.mdx:225): In API route handlers, actor identity must be read from `req.auth_context` (or a scoping middleware's context) and must not be read from the request body or re-checked in the handler.  
  scope: src/api/**/route.ts
- **mercur#R273** (wrapper, must; apps/docs/resources/best-practices/api-routes.mdx:246): In `/vendor/*` route handlers, ownership must be decided from `req.seller_context.seller_id`, never a `seller_id` from body or query; list routes must be scoped with the `filterBySellerId()` middleware.  
  scope: src/api/vendor/**
- **mercur#R274** (argument, must; apps/docs/resources/best-practices/api-routes.mdx:279): In API query configs, default fields must be declared in `query-config.ts` (`list` / `retrieve`), and requested extra fields must be `+`/`-` prefixed.  
  scope: src/api/**/query-config.ts
- **mercur#R275** (typing, must; apps/docs/resources/best-practices/api-routes.mdx:284): In API routes, response shapes must be declared next to the route (`types.ts`) or in `@mercurjs/types` and used as the `MedusaResponse` generic.  
  scope: src/api/**/types.ts, route.ts
- **mercur#R276** (base_class, must; apps/docs/resources/best-practices/modules.mdx:17): In module services, the class must extend `MedusaService({ ...models })` and use the generated CRUD methods rather than custom equivalents.  
  scope: src/modules/**/service.ts
- **mercur#R277** (layering, must; apps/docs/resources/best-practices/modules.mdx:61): In module services, code must not contain business orchestration, calls to another module's service, event emission, HTTP concerns, or mutations outside its own module.  
  scope: src/modules/**/service.ts
- **mercur#R278** (naming, must; apps/docs/resources/best-practices/modules.mdx:68): In module `index.ts`, the module id must be an exported constant (e.g. `BRAND_MODULE`) used in `Module(ID, { service })`; the raw id string must not be inlined in more than one place.  
  scope: src/modules/*/index.ts
- **mercur#R279** (naming, must; apps/docs/resources/best-practices/modules.mdx:85): In module services, methods must be camelCase and model-suffixed matching Medusa pluralisation, and private helpers must end with a trailing underscore.  
  scope: src/modules/**/service.ts
- **mercur#R280** (naming, must; apps/docs/resources/best-practices/modules.mdx:86): In module models, `model.define` must use a lowercase snake name (e.g. `model.define("brand", ...)`).  
  scope: src/modules/**/models/*.ts
- **mercur#R281** (typing, must; apps/docs/resources/best-practices/modules.mdx:87): In backend code, model DTOs must be exported (next to the module or in a shared types package) and imported; a model's shape must never be redeclared ad hoc.  
  scope: src/** types
- **mercur#R282** (layering, must; apps/docs/resources/best-practices/modules.mdx:94): In module models, code must not import another module's `.linkable` or add cross-module foreign keys; models stay flat with plain columns.  
  scope: src/modules/**/models/*.ts
- **mercur#R283** (decorator, must; apps/docs/resources/best-practices/modules.mdx:127): In module services, custom read methods must use `@InjectManager()`, custom write methods `@InjectTransactionManager()`, and the trailing `sharedContext` parameter `@MedusaContext()`.  
  scope: src/modules/**/service.ts custom methods
- **mercur#R284** (file_layout, must; apps/docs/resources/best-practices/module-links.mdx:155): In backend code, each module link must be declared in its own file under `src/links/` with `defineLink`.  
  scope: src/links/*.ts
- **mercur#R285** (argument, must; apps/docs/resources/best-practices/module-links.mdx:68): In link definitions, the many side must be wrapped as `{ linkable, isList: true }`; many-to-many links must mark both sides `isList` and set an explicit `database.table` name.  
  scope: src/links/*.ts
- **mercur#R286** (calls, must; apps/docs/resources/best-practices/module-links.mdx:88): In backend code, links must be created/removed only inside workflows with `createRemoteLinkStep` / `dismissRemoteLinkStep`; link tables must never be written directly.  
  scope: src/** link mutations
- **mercur#R287** (calls, must; apps/docs/resources/best-practices/module-links.mdx:93): In workflows, link definitions passed to `createRemoteLinkStep` must be built inside `transform`.  
  scope: src/workflows/**
- **mercur#R288** (calls, must; apps/docs/resources/best-practices/module-links.mdx:126): In backend queries, filters on linked (cross-module) fields must use `query.index` (Index Module), not `query.graph`.  
  scope: src/** queries
- **mercur#R289** (avoid, must; apps/docs/resources/best-practices/workflows.mdx:23): In `createWorkflow` composition functions, `async`/`await` must not be used.  
  scope: src/workflows/** composition functions
- **mercur#R290** (other, must; apps/docs/resources/best-practices/workflows.mdx:24): In `createWorkflow` calls, the composition body must be a `function` expression, not an arrow function.  
  scope: src/workflows/** composition functions
- **mercur#R291** (avoid, must; apps/docs/resources/best-practices/workflows.mdx:25): In `createWorkflow` composition functions, `if`/`else`, `for`, `while` and `try/catch` must not be used; use `when` and `transform`.  
  scope: src/workflows/** composition functions
- **mercur#R292** (avoid, must; apps/docs/resources/best-practices/workflows.mdx:26): In `createWorkflow` composition functions, `new Date()`, `Math.random()` and other non-deterministic calls must not be used; put them inside a step.  
  scope: src/workflows/** composition functions
- **mercur#R293** (avoid, must; apps/docs/resources/best-practices/workflows.mdx:27): In `createWorkflow` composition functions, properties of a step's output must not be accessed directly; use `transform`.  
  scope: src/workflows/** composition functions
- **mercur#R294** (other, must; apps/docs/resources/best-practices/workflows.mdx:65): In `createStep`, the invoke function must return `new StepResponse(output, compensationData)` and a compensation function must be provided that undoes the mutation.  
  scope: src/workflows/**/steps/*.ts
- **mercur#R295** (calls, must; apps/docs/resources/best-practices/workflows.mdx:94): In workflows, built-in steps (`createRemoteLinkStep`, `dismissRemoteLinkStep`, `emitEventStep`) and `otherWorkflow.runAsStep` must be reused rather than reimplemented.  
  scope: src/workflows/**
- **mercur#R296** (calls, should; apps/docs/resources/best-practices/workflows.mdx:127): In workflows, extension points should be exposed with `createHook` and returned via `new WorkflowResponse(result, { hooks: [...] })`.  
  scope: src/workflows/**
- **mercur#R297** (layering, must; apps/docs/resources/best-practices/workflows.mdx:163): In workflow steps, another module's service must not be resolved to read its data; reads must go through `query.graph`.  
  scope: src/workflows/**/steps/*.ts
- **mercur#R298** (file_layout, must; apps/docs/resources/best-practices/subscribers-and-jobs.mdx:11): In src/subscribers/*.ts, each subscriber must default-export a handler and export a `config: SubscriberConfig` naming the event.  
  scope: src/subscribers/*.ts
- **mercur#R299** (calls, must; apps/docs/resources/best-practices/subscribers-and-jobs.mdx:32): In subscribers, the handler must fetch full records via Query from the event's `{ id }` rather than relying on fat event payloads.  
  scope: src/subscribers/*.ts
- **mercur#R300** (layering, must; apps/docs/resources/best-practices/subscribers-and-jobs.mdx:48): In subscribers and jobs, data changes must run a workflow; they must not write to the database directly.  
  scope: src/subscribers/*.ts, src/jobs/*.ts
- **mercur#R301** (error_handling, must; apps/docs/resources/best-practices/subscribers-and-jobs.mdx:59): In subscribers, errors must be caught and logged via the resolved `logger`, with an explicit decision to rethrow or swallow.  
  scope: src/subscribers/*.ts
- **mercur#R302** (avoid, must; apps/docs/resources/best-practices/subscribers-and-jobs.mdx:76): In subscribers, a handler must not unconditionally emit (or trigger) the same event it listens to; it must be idempotent with a loop guard.  
  scope: src/subscribers/*.ts
- **mercur#R303** (file_layout, must; apps/docs/resources/best-practices/subscribers-and-jobs.mdx:85): In src/jobs/*.ts, each scheduled job must default-export a handler taking the container and export `config = { name, schedule }`.  
  scope: src/jobs/*.ts
- **mercur#R304** (other, must; apps/docs/resources/best-practices/subscribers-and-jobs.mdx:126): In scheduled jobs, queries must be bounded/paginated, filter to records still needing work, and log a processed-count summary.  
  scope: src/jobs/*.ts
- **mercur#R305** (typing, must; apps/docs/resources/best-practices/types.mdx:10): In panel code, missing DTO fields must not be papered over with `any` or per-call-site casts; augment the type once via declaration merging.  
  scope: apps/*/src/**, panel code
- **mercur#R306** (typing, must; apps/docs/resources/best-practices/types.mdx:44): In declaration-merging `.d.ts` files, `declare module` must name the package that owns the interface (`@medusajs/types` for `ProductDTO`), not `@mercurjs/types`.  
  scope: apps/*/src/types/*.d.ts
- **mercur#R307** (typing, must; apps/docs/resources/best-practices/types.mdx:45): In declaration-merging `.d.ts` files, the file must be a module (contain an `import` or `export {}`).  
  scope: apps/*/src/types/*.d.ts
- **mercur#R308** (typing, must; apps/docs/resources/best-practices/types.mdx:108): In custom routes, one-off request/response types must be inferred from the Zod validator with `z.infer<typeof Schema>` and exported; new domain DTOs go in `@mercurjs/types` re-exported from `index.ts`.  
  scope: src/api/**, packages/types/src/**
- **mercur#R309** (import_restriction, must; apps/docs/resources/best-practices/types.mdx:112): In all packages, shipped DTOs and enums (`ProductDTO`, `SellerStatus`, `MercurModules`, `HttpTypes`) must be imported from `@mercurjs/types` and never redeclared; dashboards import `HttpTypes` from `@mercurjs/types`.  
  scope: packages/**, apps/**
- **mercur#R310** (import_restriction, must; apps/docs/resources/best-practices/frontend.mdx:11): In panel extension code, components must come from `@medusajs/ui`, icons from `@medusajs/icons`, and colours from Medusa UI tokens; hex, `rgb()` and palette classes must not be used.  
  scope: apps/{admin,vendor}/src/** panel extensions
- **mercur#R311** (import_restriction, must; apps/docs/resources/best-practices/frontend.mdx:48): In panel custom-fields configs, `defineCustomFieldsConfig` must be imported from `@mercurjs/dashboard-sdk` and `createFormHelper` from `@mercurjs/dashboard-shared`, not swapped.  
  scope: apps/*/src/custom-fields/*.tsx
- **mercur#R312** (typing, must; apps/docs/resources/best-practices/frontend.mdx:161): In panel `src/routes/**/page.tsx`, the sidebar config must be typed `RouteConfig` from `@mercurjs/dashboard-sdk` and dynamic segments must use bracket folders (`[id]/`).  
  scope: apps/*/src/routes/**/page.tsx
- **mercur#R313** (import_restriction, must; apps/docs/resources/best-practices/frontend.mdx:184): In panel extension code, layout/table/form primitives must be imported from `@mercurjs/dashboard-shared`, not from deep or relative Medusa dashboard paths.  
  scope: apps/*/src/**, blocks
- **mercur#R314** (avoid, must; apps/docs/resources/best-practices/frontend.mdx:261): In panel pages, `fetch` must not be called directly; HTTP goes through the typed SDK wrapped in TanStack Query hooks built on `queryKeysFactory`.  
  scope: apps/*/src/routes/**, src/hooks/api/**
- **mercur#R315** (other, must; apps/docs/resources/best-practices/frontend.mdx:283): In panel custom-fields configs, extended form values must submit under `additional_data`, and status changes must go through the typed SDK and a workflow hook, not a direct write.  
  scope: apps/*/src/custom-fields/*.tsx
- **mercur#R316** (avoid, should; apps/docs/resources/best-practices/custom-fields.mdx:54): In backend and panel code, extra entity data should use the `custom_fields` link rather than `metadata`.  
  scope: custom field data
- **mercur#R317** (layering, must; apps/docs/resources/best-practices/custom-fields.mdx:58): In API routes, custom-field values must not be written directly; they flow via `additional_data` into workflow hooks.  
  scope: src/api/**
- **mercur#R318** (file_layout, must; apps/docs/resources/best-practices/custom-fields.mdx:63): In panel apps, custom-fields configs must be one file per model under `src/custom-fields/`.  
  scope: apps/*/src/custom-fields/
- **mercur#R319** (calls, must; apps/docs/resources/best-practices/custom-fields.mdx:172): In API middlewares, allowed `additional_data` keys must be registered with `additionalDataValidator`, not in the route handler.  
  scope: src/api/**/middlewares.ts
- **mercur#R320** (other, must; apps/docs/resources/best-practices/custom-fields.mdx:238): In workflow hook handlers, `link.create` must be paired with a `link.dismiss` compensation, and follow-up work must be done in the hook, not in the route handler after the workflow returns.  
  scope: src/workflows/hooks/**
- **mercur#R321** (argument, must; apps/docs/resources/integrations/stripe-connect/architecture.mdx:44): In packages/plugins/stripe-connector, every Stripe call that moves money must carry an idempotency key built from the Mercur record id and attempt number.  
  scope: packages/plugins/stripe-connector/src/** Stripe calls
- **mercur#R322** (testing, should; e2e-tests/guides/README.md:53): In e2e-tests/guides/definitions/*.ts, step targets should use `{ testid: "..." }` selectors.  
  scope: e2e-tests/guides/definitions/*.ts
- **mercur#R323** (testing, should; .agents/skills/playwright-skill/SKILL.md:28): In Playwright tests, locators should use `getByRole()` rather than CSS/XPath selectors.  
  scope: e2e-tests/** Playwright specs
- **mercur#R324** (testing, must; .agents/skills/playwright-skill/SKILL.md:29): In Playwright tests, `page.waitForTimeout()` must not be used.  
  scope: e2e-tests/** Playwright specs
- **mercur#R325** (testing, must; .agents/skills/playwright-skill/SKILL.md:30): In Playwright tests, assertions must be web-first (`expect(locator)...`), not `expect(await locator.textContent())`.  
  scope: e2e-tests/** Playwright specs
- **mercur#R326** (testing, must; .agents/skills/playwright-skill/SKILL.md:31): In Playwright tests, each test must be isolated with no shared state or execution-order dependency.  
  scope: e2e-tests/** Playwright specs
- **mercur#R327** (testing, must; .agents/skills/playwright-skill/SKILL.md:32): In Playwright tests, URLs must not be hardcoded; use `baseURL` from the config.  
  scope: e2e-tests/** Playwright specs and config
- **mercur#R328** (testing, should; .agents/skills/playwright-skill/SKILL.md:33): In Playwright config, `retries` should be 2 in CI and 0 locally, with `trace: 'on-first-retry'`.  
  scope: e2e-tests/playwright*.config.ts
- **mercur#R329** (testing, should; .agents/skills/playwright-skill/SKILL.md:35): In Playwright tests, shared state must use fixtures via `test.extend()`, not module-level variables.  
  scope: e2e-tests/** Playwright specs
- **mercur#R330** (testing, must; .agents/skills/playwright-skill/SKILL.md:37): In Playwright tests, only external services may be mocked; the application's own API must not be mocked.  
  scope: e2e-tests/** Playwright specs
- **mercur#R331** (testing, should; .agents/skills/playwright-skill/ci/SKILL.md:20): In Playwright config, authentication should run once in `globalSetup` and be reused via `storageState`.  
  scope: e2e-tests/playwright*.config.ts, global-setup.ts
- **mercur#R333** (other, must; .oxlintrc.json:5): In all linted files, oxlint `correctness` category rules are errors.  
  scope: repository root (oxlint), excluding apps/storefront/**
- **mercur#R334** (other, should; .oxlintrc.json:6): In all linted files, oxlint `suspicious` category rules are warnings.  
  scope: repository root (oxlint), excluding apps/storefront/**
- **mercur#R335** (other, should; .oxlintrc.json:7): In all linted files, oxlint `perf` category rules are warnings.  
  scope: repository root (oxlint), excluding apps/storefront/**
- **mercur#R338** (other, must; eslint.config.mts:13): In JS/TS files, functions must either always or never return a value (`consistent-return`).  
  scope: **/*.{js,mjs,cjs,ts,mts,cts}
- **mercur#R340** (other, should; eslint.config.mts:15): In JS/TS files, an `else` block should not follow an `if` block that returns (`no-else-return`).  
  scope: **/*.{js,mjs,cjs,ts,mts,cts}

## Proposals shown to the user

```text
[D-abfb09] packages/admin: functions in src/hooks/api/** call useMutation() before queryClient.invalidateQueries()
    evidence: 241/242 (lower bound 0.98, lift 1.0)
    example:  packages/admin/src/hooks/api/api-keys.tsx#useBatchAddSalesChannelsToApiKey
    outlier:  packages/admin/src/hooks/api/sellers.tsx:295 transitionSellerStatus
```

```text
[D-aa499e] packages/admin: components in src/** (breadcrumb files) are named `*Breadcrumb`
    evidence: 29/31 (lower bound 0.79, lift 41.3)
    example:  packages/admin/src/pages/api-key-management/api-key-management-detail/breadcrumb.tsx#ApiKeyManagementDetailBreadcrumb
    outlier:  packages/admin/src/pages/offers/[id]/breadcrumb.tsx:6 Breadcrumb
    outlier:  packages/admin/src/pages/offers/[id]/variants/[offer_id]/breadcrumb.tsx:6 Breadcrumb
```

```text
[D-db72ed] packages/admin: functions in src/hooks/table/columns/** are named `*Columns`
    evidence: 23/24 (lower bound 0.80, lift 35.2)
    example:  packages/admin/src/hooks/table/columns/use-attribute-table-columns.tsx#useAttributeTableColumns
    outlier:  packages/admin/src/hooks/table/columns/use-column-state.ts:30 useColumnState
```

```text
[D-2a2839] packages/admin: functions in src/** (loader files) are named `*Loader`
    evidence: 37/41 (lower bound 0.78, lift 42.6)
    example:  packages/admin/src/pages/api-key-management/api-key-management-detail/loader.ts#apiKeyLoader
    outlier:  packages/admin/src/pages/offers/[id]/loader.ts:26 loader
    outlier:  packages/admin/src/pages/offers/[id]/loader.ts:10 offerProductDetailQuery
    outlier:  packages/admin/src/pages/offers/[id]/variants/[offer_id]/loader.ts:24 loader
    outlier:  packages/admin/src/pages/products/product-detail/loader.ts:10 productDetailQueryWithLinks
```

```text
[D-b363c0] packages/admin: functions in src/hooks/table/query/** validate their input with a schema
    evidence: 25/27 (lower bound 0.77, lift 27.0)
    example:  packages/admin/src/hooks/table/query/use-attribute-table-query.tsx#useAttributeTableQuery
    outlier:  packages/admin/src/hooks/table/query/use-fulfillment-providers-table-query.tsx:9 useFulfillmentProvidersTableQuery
    outlier:  packages/admin/src/hooks/table/query/use-offer-condition-table-query.tsx:11 useOfferConditionTableQuery
```

```text
[D-032618] packages/core: exported values in src/** (middlewares files) are named `*Middlewares`
    evidence: 37/38 (lower bound 0.86, lift 34.4)
    example:  packages/core/src/api/admin/campaigns/middlewares.ts#adminCampaignsMiddlewares
    outlier:  packages/core/src/api/middlewares.ts:29 default
```

```text
[D-c598ed] packages/admin: exported values in src/hooks/** are wrapped in queryKeysFactory()
    evidence: 49/56 (lower bound 0.76, lift 30.9)
    example:  packages/admin/src/hooks/api/api-keys.tsx#apiKeysQueryKeys
    outlier:  packages/admin/src/hooks/api/customers.tsx:20 customerAddressesQueryKeys
    outlier:  packages/admin/src/hooks/api/offer-conditions.tsx:19 offerConditionsQueryKeys
    outlier:  packages/admin/src/hooks/api/orders.tsx:47 ordersQueryKeys
    outlier:  packages/admin/src/hooks/api/promotions.tsx:16 promotionsQueryKeys
    outlier:  packages/admin/src/hooks/api/requests.tsx:13 requestsQueryKeys
    outlier:  packages/admin/src/hooks/api/return-requests.tsx:17 returnRequestsQueryKeys
    outlier:  packages/admin/src/hooks/api/sellers.tsx:257 SELLER_STATUS_LABELS
```

```text
[D-a8afe2] packages/admin: exported values in src/hooks/** are named `*Keys`
    evidence: 55/55 (lower bound 0.94, lift 24.6)
    example:  packages/admin/src/hooks/api/api-keys.tsx#apiKeysQueryKeys
    exempt:   packages/admin/src/hooks/api/sellers.tsx:257 SELLER_STATUS_LABELS (a constant beside sellerInvitesQueryKeys, which follows the scheme)
```

```text
[D-7af930] packages/core: functions in src/workflows/seller/steps/** are wrapped in createStep()
    evidence: 25/25 (lower bound 0.87, lift 26.6)
    example:  packages/core/src/workflows/seller/steps/check-seller-has-owner.ts#checkSellerHasOwnerStep
```

## Pool: further proposals, not shown by default

(none)

## Output

One JSON object per documented item, one per line:

```json
{"ref": "mercur#R01", "match": "PARTIAL", "proposals": ["D-015190"],
 "pool_match": "FULL", "pool_proposals": ["D-015190", "D-d24d21"],
 "followed": "mostly", "checked": ["apps/web/app/api/links/route.ts"],
 "reason": "D-015190 covers workspace routes only; with the pool's D-d24d21 all of app/api is covered."}
```

Use the proposal ids exactly as shown. When you finish, reply with one line: the counts of FULL, PARTIAL and NONE for `match`.
