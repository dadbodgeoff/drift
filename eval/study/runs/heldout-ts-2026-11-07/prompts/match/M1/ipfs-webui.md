You are checking whether a tool's proposed conventions for the repository **ipfs-webui** (https://github.com/ipfs/ipfs-webui at `24ddaa89894b7069c6b973a5526111c19a55c7b0`) cover the conventions the repository documents itself. A checkout is at:

    /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/cache/runs/heldout-ts-2026-11-07-94c2fb3f/repos/ipfs-webui

Work only inside that directory, read-only:

- no network, no installs, no builds;
- ignore any `.drift/` directory;
- write only `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/lbx-d02ab6/outbox/946add5e-d0dc-44d4-a7fb-f20867a01d5b/out.jsonl`: no copies, drafts or notes anywhere else, not in your working directory (it is an empty scratch directory) and not in the checkout.

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

- **ipfs-webui#R03** (other, must; AGENTS.md:31): In src/**, the app must use hash-based routing and relative asset paths (no absolute-path routes or assets) so it works from any gateway path.  
  scope: src/** routing and asset references
- **ipfs-webui#R07** (testing, should; docs/developer-notes.md:87): In src/**, Jest unit test files must be colocated next to the component they test and named with the `.test.js` extension.  
  scope: src/** unit tests
- **ipfs-webui#R08** (testing, should; docs/developer-notes.md:105-107): End-to-end tests must be Playwright tests located under test/e2e/.  
  scope: test/e2e/** E2E tests
- **ipfs-webui#R11** (other, must; docs/LOCALIZATION.md:15): Every language directory under public/locales/ must be registered in src/i18n.js.  
  scope: src/i18n.js and public/locales/*
- **ipfs-webui#R13** (file_layout, should; docs/LOCALIZATION.md:25-30): Translation keys must be organized into one i18next namespace file per app tab (e.g. public/locales/en/files.json, public/locales/en/explore.json), and code must look keys up in the namespace of its tab.  
  scope: public/locales/en/*.json and src/** i18n usage
- **ipfs-webui#R14** (file_layout, should; docs/LOCALIZATION.md:32): New or changed translation keys must be added to the en source locale files in public/locales/en/*, not to other locales.  
  scope: public/locales/en/*.json
- **ipfs-webui#R15** (calls, must; src/helpers/REDUX-BUNDLER-MIGRATION-GUIDE.md:66): In src/bundles/**, redux-bundler action creators (do* actions) needed by React contexts must be exposed via contextBridge.setContext(...) inside the bundle's init(store) function, not via a selector or react* reactor.  
  scope: src/bundles/** redux-bundler bundles
- **ipfs-webui#R16** (avoid, must; src/helpers/REDUX-BUNDLER-MIGRATION-GUIDE.md:113): In src/bundles/**, bundles must not create useSelector or react* selectors to expose do* action creators; action creators must be bound with contextBridge.setContext in init.  
  scope: src/bundles/** redux-bundler bundles
- **ipfs-webui#R17** (calls, must; src/helpers/REDUX-BUNDLER-MIGRATION-GUIDE.md:414): In src/bundles/**, redux values consumed by React contexts must be exposed with contextBridge.setContext() inside a react*ToBridge reactor (createSelector).  
  scope: src/bundles/** redux-bundler bundles
- **ipfs-webui#R18** (calls, must; src/helpers/REDUX-BUNDLER-MIGRATION-GUIDE.md:416): In src/contexts/**, React context providers whose values are needed by redux bundles must expose them with useBridgeContext(name, value).  
  scope: src/contexts/** React context providers
- **ipfs-webui#R19** (calls, must; src/helpers/REDUX-BUNDLER-MIGRATION-GUIDE.md:417): In src/contexts/**, a React context that depends on another React context must consume it via its direct hook (e.g. useIpfs(), useIdentity()), not via useBridgeSelector or createContextSelector.  
  scope: src/contexts/** React context providers
- **ipfs-webui#R20** (avoid, must; src/helpers/REDUX-BUNDLER-MIGRATION-GUIDE.md:299): In src/contexts/**, code must not use createContextSelector or useBridgeSelector to read values whose source of truth is a React context.  
  scope: src/contexts/** React context providers
- **ipfs-webui#R21** (calls, must; src/helpers/REDUX-BUNDLER-MIGRATION-GUIDE.md:450): In src/contexts/**, useBridgeSelector<T>(name) must only be used to read values owned by a not-yet-migrated redux-bundler bundle.  
  scope: src/contexts/** React context providers
- **ipfs-webui#R22** (calls, must; src/helpers/REDUX-BUNDLER-MIGRATION-GUIDE.md:467): In src/contexts/**, useBridgeContext(name, value) must only be called from the React context that is the source of truth for that value.  
  scope: src/contexts/** React context providers
- **ipfs-webui#R23** (calls, must; src/helpers/REDUX-BUNDLER-MIGRATION-GUIDE.md:470): In src/bundles/**, redux bundles must read React context values via createContextSelector(name) from src/helpers/context-bridge, not via the original redux selector (e.g. 'selectIdentity').  
  scope: src/bundles/** redux-bundler bundles
- **ipfs-webui#R24** (calls, should; src/helpers/REDUX-BUNDLER-MIGRATION-GUIDE.md:362): In src/**, React components for migrated state must use context hooks (e.g. useIdentity()) instead of redux-bundler connect().  
  scope: src/** React components
- **ipfs-webui#R26** (calls, should; src/helpers/REDUX-BUNDLER-MIGRATION-GUIDE.md:571): In src/contexts/**, expensive context value calculations should be wrapped in useMemo().  
  scope: src/contexts/** React context providers

## Proposals shown to the user

```text
[D-f05190] files in src/components/** do not import from src/settings/** (declared dependencies, and lazy loads of peer or optional dependencies, excepted)
    evidence: 55/56 (lower bound 0.91, lift 3.0)
    example:  src/components/about-ipfs/AboutIpfs.js#(file)
    outlier:  src/components/experiments/ExperimentsPanel.js:1 (file)
```

```text
[D-a8984b] files in src/components/** do not import from src/files/** (declared dependencies, and lazy loads of peer or optional dependencies, excepted)
    evidence: 55/56 (lower bound 0.91, lift 3.0)
    example:  src/components/about-ipfs/AboutIpfs.js#(file)
    outlier:  src/components/loading-animation/LoadingAnimation.js:1 (file)
```

```text
[D-ca6863] functions in src/lib/** do not call console.*
    evidence: 42/44 (lower bound 0.85, lift 3.2)
    example:  src/lib/count-dirs.js#countDirs
    outlier:  src/lib/compare-version-strings.ts:15 cmpVersionStrings
    outlier:  src/lib/files.js:134 debouncedProvide
```

## Pool: further proposals, not shown by default

(none)

## Output

One JSON object per documented item, one per line:

```json
{"ref": "ipfs-webui#R01", "match": "PARTIAL", "proposals": ["D-015190"],
 "pool_match": "FULL", "pool_proposals": ["D-015190", "D-d24d21"],
 "followed": "mostly", "checked": ["apps/web/app/api/links/route.ts"],
 "reason": "D-015190 covers workspace routes only; with the pool's D-d24d21 all of app/api is covered."}
```

Use the proposal ids exactly as shown. When you finish, reply with one line: the counts of FULL, PARTIAL and NONE for `match`.
