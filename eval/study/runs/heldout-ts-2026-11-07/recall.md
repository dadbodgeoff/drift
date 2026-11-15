# Recall against documented conventions: eval/study/runs/heldout-ts-2026-11-07

- 1746 documented, code-checkable, enabled items in 18 repos

|  | Items | Recall@shown strict | Recall@shown lenient | Recall@pool strict | Recall@pool lenient |
| --- | --- | --- | --- | --- | --- |
| All documented | 1746 | 0% [0%–0%] (repo bootstrap 0%–0%) | 1% [0%–1%] (repo bootstrap 0%–2%) | 0% [0%–0%] (repo bootstrap 0%–0%) | 1% [0%–1%] (repo bootstrap 0%–2%) |
| Followed by the code | 1288 | 0% [0%–1%] (repo bootstrap 0%–0%) | 1% [1%–2%] (repo bootstrap 0%–2%) | 0% [0%–1%] (repo bootstrap 0%–0%) | 1% [1%–2%] (repo bootstrap 0%–2%) |
| From lint configs | 413 | 0% [0%–1%] | 0% [0%–1%] | 0% [0%–1%] | 0% [0%–1%] |
| From prose (AGENTS.md, CONTRIBUTING...) | 1333 | 0% [0%–1%] | 1% [1%–2%] | 0% [0%–1%] | 1% [1%–2%] |

## Per repo

| Repo | Items | Followed | @shown strict | @shown lenient | @pool lenient |
| --- | --- | --- | --- | --- | --- |
| thunderhub | 30 | 27 | 0% [0%–11%] | 0% [0%–11%] | 0% [0%–11%] |
| fedify | 129 | 90 | 0% [0%–3%] | 0% [0%–3%] | 0% [0%–3%] |
| hedgedoc | 66 | 53 | 0% [0%–6%] | 0% [0%–6%] | 0% [0%–6%] |
| mercur | 330 | 202 | 0% [0%–2%] | 2% [1%–4%] | 2% [1%–4%] |
| genkit | 89 | 67 | 0% [0%–4%] | 0% [0%–4%] | 0% [0%–4%] |
| taxhacker | 5 | 4 | 0% [0%–43%] | 0% [0%–43%] | 0% [0%–43%] |
| computer-science-fundamentals | 95 | 88 | 0% [0%–4%] | 0% [0%–4%] | 0% [0%–4%] |
| memcode | 44 | 35 | 0% [0%–8%] | 0% [0%–8%] | 0% [0%–8%] |
| zyfun | 41 | 29 | 0% [0%–9%] | 0% [0%–9%] | 0% [0%–9%] |
| tududi | 120 | 81 | 1% [0%–5%] | 3% [1%–8%] | 3% [1%–8%] |
| cursorless | 75 | 53 | 0% [0%–5%] | 1% [0%–7%] | 1% [0%–7%] |
| backend | 234 | 227 | 0% [0%–2%] | 0% [0%–2%] | 0% [0%–2%] |
| kan | 63 | 52 | 0% [0%–6%] | 3% [1%–11%] | 3% [1%–11%] |
| ipfs-webui | 17 | 17 | 0% [0%–18%] | 0% [0%–18%] | 0% [0%–18%] |
| restty | 42 | 38 | 0% [0%–8%] | 0% [0%–8%] | 0% [0%–8%] |
| e2e | 78 | 58 | 0% [0%–5%] | 0% [0%–5%] | 0% [0%–5%] |
| glyph | 228 | 134 | 0% [0%–2%] | 0% [0%–2%] | 0% [0%–2%] |
| dyrectorio | 60 | 33 | 0% [0%–6%] | 0% [0%–6%] | 0% [0%–6%] |

## Per category

| Category | Items | @shown lenient | @pool lenient |
| --- | --- | --- | --- |
| argument | 63 | 0% [0%–6%] | 0% [0%–6%] |
| avoid | 192 | 0% [0%–2%] | 0% [0%–2%] |
| base_class | 12 | 0% [0%–24%] | 0% [0%–24%] |
| calls | 213 | 2% [1%–5%] | 2% [1%–5%] |
| decorator | 29 | 0% [0%–12%] | 0% [0%–12%] |
| error_handling | 60 | 5% [2%–14%] | 5% [2%–14%] |
| file_layout | 166 | 1% [0%–4%] | 1% [0%–4%] |
| import_restriction | 100 | 0% [0%–4%] | 0% [0%–4%] |
| layering | 114 | 0% [0%–3%] | 0% [0%–3%] |
| naming | 114 | 3% [1%–7%] | 3% [1%–7%] |
| other | 338 | 0% [0%–2%] | 0% [0%–2%] |
| render | 83 | 0% [0%–4%] | 0% [0%–4%] |
| testing | 144 | 0% [0%–3%] | 0% [0%–3%] |
| typing | 101 | 0% [0%–4%] | 0% [0%–4%] |
| wrapper | 17 | 6% [1%–27%] | 6% [1%–27%] |

## Precision labels against the repo's own policy

| Shown proposals | n | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- | --- |
| Match a documented convention | 11 | 4 | 0 | 7 |
| No documented counterpart | 46 | 18 | 1 | 27 |

Labelled WRONG although the repo documents the convention (check the label, the match, or whether the doc is stale):
- mercur/D-c598ed (mercur#R62, mercur#R64, mercur#R144): customers.tsx:20, offer-conditions.tsx:19, requests.tsx:13 and return-requests.tsx:17 are literally `= queryKeysFactory(...)`, and orders.tsx assigns _orderKeys built by queryKeysFactory; 5 of 7 listed outliers follow the rule, so the tool misread the code.
- mercur/D-a8afe2 (mercur#R62): Every exported non-function value in hooks/api is a queryKeysFactory-based query-key object named *QueryKeys (api-keys.tsx, promotions.tsx, orders.tsx), and no lint rule in eslint.config.mts or .oxlintrc.json enforces naming, so not TRIVIAL; but the only non-following member, sellers.tsx:257 SELLER_STATUS_LABELS, is a UI label map, a different kind of value that is neither a definition nor the aggregator and can recur, so by R1/R2 it counts as legit (0 of 1 mistakes) and an agent exporting another constant from a hooks file would be told to name it *Keys. Hesitated with ACCEPT since the tool exempts it; wording 'exported values' is also loose because exported const arrow functions (useX, sellerStatusOptions, meQueryOptions) are excluded.
- mercur/D-abfb09 (mercur#R63, mercur#R208): Mutation hooks invalidate inside useMutation's onSuccess (useDeleteCustomer, useCreateRegion), so the order is structural; the outlier transitionSellerStatus is a plain async helper (not a hook) orchestrating several SDK calls for store-edit forms, a different kind of function, 0 of 1.
- tududi/D-57d79e (tududi#R40): Validation files also hold helpers that are not validators: a title builder (inbox), a date formatter (projects), a query parser and priority converter (search), a DB lookup getRecurringParentEndDate and an is* predicate (tasks/utils); naming them validate* would be wrong, so new helpers would get false alarms.
- tududi/D-744c2d (tududi#R09, tududi#R52): Both outliers wrap every handler in a file-local handle() helper that does try { ... } catch (error) { next(error) } (habits/controller.js:5, webhooks/controller.js:13), the same error handling as the per-method try blocks in projects/notes controllers; the tool missed the indirection.
- cursorless/D-373f39 (cursorless#R28): Per-language LanguageScopeSupportFacetMap exports (c.ts, python.ts, typescriptreact.ts) are named *ScopeSupport, but both outliers are facet description tables (Record<Facet, ScopeSupportFacetInfo>), a different kind of export whose *Infos name is apt; 0 of 2 counted outliers are mistakes, so a new info/metadata table here would be wrongly flagged.
- kan/D-eda068 (kan#R18): Procedures throw TRPCError because they have error paths (not found, unauthorized) as in label.ts and checklist.ts; the only outlier, health in health.ts, has no failure to raise and reports errors as a status field instead, so the rule follows from what the code does rather than a choice, and a new procedure with no error path would be flagged for nothing.

Second matcher on 599 items: agreement 100%, κ 0.92

Second extractor (in-scope items, E1/E2): hedgedoc 66/74, genkit 89/91, computer-science-fundamentals 95/135
