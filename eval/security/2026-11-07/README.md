# `drift security` precision audit, 2026-11-07

How often is a finding of `drift security --json` real? Measured on the dev clones (16
TypeScript repos of `eval/repos.json`, the 6 of `eval/repos-py.json` without polar and
CTFd, the 12 of `eval/repos-py-2.json`), before and after branch `ws/security-precision`.
Nothing here is recall: misses seen while reading code are listed, not counted.

## Method (read this first)

- **Binaries.** Verified release builds (`build-verified.sh`): main `a7d6183` (CGU 143)
  and the branch merged with it (CGU 43). The sample was drawn from main at `83ed451`
  and drawn again, identically, at `6569a7c`; every sampled finding is in the
  `a7d6183` output too. Each repo was scanned on its own, with a private, fresh
  `DRIFT_CACHE_DIR`.
- **Kinds.** Four kinds of finding, each sampled separately:
  1. *no wrapper*: an entry point with no wrapper, decorator or configured guard
     (`entry_points[]` with empty `guards`);
  2. *reaching*: one `reaches[]` row (entry point, sink kind, call chain);
  3. *leak*: one `client_leaks[]` group;
  4. *sink*: one `sinks[]` row.
- **Sampling.** Stratified by kind, then spread over repos: repos shuffled with
  `random.seed(43)`, each repo's findings shuffled, then one finding per repo in turn
  until the quota (14 no-wrapper, 14 reaching, 16 sinks; all 4 leak groups, the whole
  population). Script: `sample.py` in the agent's scratch folder (not committed); the
  drawn rows are in the tables below.
- **Verdict.** Read against the code. TP: the finding is what it says (an entry point
  with no wrapper; a chain that runs and ends in that kind of operation; a client file
  that ships a non-public env read or server-only code; a call of that risky kind with
  the input it needs to be risky). FP: it is not. A TP may still be harmless (a health
  check with no wrapper is fine); that is noted, not counted against it.
- **After.** "In-sample after" is the sampled findings the branch still reports. The
  branch removes many reaching rows, so a fresh sample of 12 reaching rows was drawn
  from the branch's own output (`random.seed(4343)`, same procedure; drawn before the
  branch merged `a7d6183`, and all 12 rows are in the final output) to see what is left.

## Precision per kind (dev, in-sample)

| Kind | Population before → after | Before | After (sampled findings still reported) | After (fresh sample) |
| --- | --- | --- | --- | --- |
| No wrapper | 3001 → 2879 | 12/14 (86%) | 12/13 (92%) | |
| Reaching | 1646 rows → 677 | 4/14 (29%) | 4/5 (80%) | 8/12 (67%) |
| Leak | 4 groups → 1 | 1/4 (25%) | 1/1 (100%) | |
| Sink | 1768 → 1675 | 12/16 (75%) | 12/14 (86%) | |

## Findings and verdicts

### No wrapper (14)

| Repo | Finding | Verdict | Reason | After |
| --- | --- | --- | --- | --- |
| twenty | `twenty-website/.../enterprise/release/route.ts` POST | TP | no wrapper; checks the enterprise key in its body | kept |
| infisical | `ee/routes/v1/ldap-router.ts` POST /login | **FP** | `preValidation: passport.authenticate("ldapauth")`, but `passport` is a `new Authenticator()` bound inside the router function, which lowering does not resolve, so the hook is dropped | kept (not fixed) |
| nest | `tools/benchmarks/src/frameworks/fastify.ts` GET / | TP | benchmark server, no wrapper (non-production code not left out) | kept |
| novu | `human-dashboard/.../configure/actions.ts` `createConnectCodeAction` | TP | server action; `requireHumanAccount()` in the body | kept |
| documenso | `openpage-api/app/github/forks/route.ts` OPTIONS | TP | CORS preflight, public by design | kept |
| pontoon | `search/views.py` `entity_alternate` | TP | plain Django view | kept |
| full-stack-fastapi-template | `api/routes/utils.py` `health_check` | TP | health check | kept |
| create-t3-app | `template/.../[...nextauth]/route.ts` GET | TP | the auth handler itself (template code) | kept |
| Misago | `likes/urls.py` `thread_post_likes_view` | TP | public view; the private variant is wrapped in urls.py | kept |
| wger | `exercises/tasks.py` `sync_videos_task` (cron) | TP | Celery task; nothing to guard | kept |
| paperless-ngx | `documents/views.py` `RemoteVersionView.get` | TP | DRF authentication in settings but no permission class (DRF default `AllowAny`) | kept |
| simplelogin | `oauth_tester.py` `profile` | TP | a developer test app at the repo root | kept |
| excalidraw | `dev-docs/src/pages/index.tsx` (page) | **FP** | a Docusaurus page: the package does not use Next.js | **gone** |
| open-wearables | `api/routes/v1/oauth.py` `oauth_success` | TP | public success page | kept |

### Reaching a risky operation (14)

| Repo | Entry point → sink (via) | Verdict | Reason | After |
| --- | --- | --- | --- | --- |
| dub | cron `links/delete` POST → dynamic_fetch (deleteLink → `storage` → `StorageClient`) | **FP** | `storage.delete()` fetches the configured endpoint; the `fetch(url)` is in another method of the class | **gone** |
| documenso | envelope item PDF GET → dynamic_fetch (… → `getFileFromS3`) | TP | fetches a presigned URL | kept |
| twenty | `deleteValidationRule` → dynamic_fetch (3 service classes) | **FP** | each hop is "some method of the class"; the method called fetches nothing | **gone** |
| saleor | task `handle_promotion_toggle` → sql_string_interpolation (→ `PromotionRule`) | **FP** | `PromotionRule.objects.using()` is the manager; the f-string SQL is in a static method not called | **gone** |
| Misago | `oauth2_login` → dynamic_redirect | TP | redirects to a computed provider URL | kept |
| wger | `IngredientInfoViewSet` → dynamic_fetch (→ `Ingredient` → image task) | **FP** | `Ingredient.objects.select_related()`; the task is queued from `save()` | **gone** |
| formbricks | settings page → dynamic_redirect (→ `redirectBillingRoleFromRestrictedSettings`) | TP | `redirect()` to a computed path | kept |
| InvenTree | `src/frontend/src/pages/Auth/Login.tsx` → raw_html | **FP** | a Vite SPA component, not a Next.js page (the `dangerouslySetInnerHTML` itself is real) | **gone** |
| novu | POST /events/trigger/broadcast → dynamic_fetch (4 use-case classes) | TP | each use case's `execute()` calls the next; the last one calls `got` | kept, now via the methods |
| tasking-manager | `split_task` → dynamic_fetch (ProjectService → UserService → OSMService) | **FP** | `ProjectService.exists()` touches no user service | **gone** |
| midday | gmail install-url GET → dynamic_fetch (InboxConnector → OutlookProvider) | **FP** | `connect()` on a Gmail connector builds a URL; Outlook's token fetch is elsewhere | **gone** |
| changedetection.io | `Watch.put` → raw_html (→ `model`) | **FP** | `WatchModel.get_property_names()`; `Markup` is in another method | **gone** |
| lotus | `change_prepaid_units` → dynamic_fetch (… → `send_invoice_to_salesforce`) | **FP** | the chain is real but the sink is not: `url = "https://api.vessel.land/crm/note"; requests.post(url)` | kept (not fixed) |
| ai | devtools POST /api/clear → dynamic_fetch (→ `notifyServerAsync`) | **FP** | `fetch(\`http://localhost:${PORT}/api/notify\`)`: literal host | **gone** |

Fresh sample of the branch's reaching rows (12): TP midday Slack `response_url`, wger
remote image URL, saleor `HttpResponseRedirect(image.url)`, simplelogin `redirect(next_url)`,
tasking-manager `f"DELETE FROM {table}"` (whitelisted), dub avatar upload through
`StorageClient.upload` → `urlToBlob` (found through the methods), twenty `${filterExpression}`
in raw SQL, supabase `fetchHandler(input)`; FP pontoon `redirect(redirect_url)` where
`redirect_url = reverse(...)`, paperless `HttpResponseRedirect(f"{oauth_manager.oauth_redirect_url}?...")`,
lotus (as above), infisical `res.redirect(\`${appCfg.SITE_URL}/...\`)`. All four FPs are sink
classification (a URL from a local binding or a config object), none is a wrong chain.

### Client leaks (all 4)

| Repo | Group | Verdict | Reason | After |
| --- | --- | --- | --- | --- |
| cal.com | `env:VERCEL_URL` from `app/_trpc/trpc-client.ts` | **FP** | read only on the `typeof window === "undefined"` side of a ternary | **gone** |
| dub | `env:VERCEL` from `app/app.dub.co/layout.tsx` | TP | read while rendering a client component; not inlined for the browser (no secret, but undefined there) | kept |
| create-t3-app | `env:VERCEL_URL` from `template/.../trpc/react.tsx` | **FP** | after `if (typeof window !== "undefined") return ...` | **gone** |
| create-t3-app | `env:PORT` from the same file | **FP** | same | **gone** |

### Sinks (16)

| Repo | Sink | Verdict | Reason | After |
| --- | --- | --- | --- | --- |
| paperless-ngx | raw_html `BootstrapIconComponent` | TP | `element.innerHTML = this.svg()` | kept |
| create-t3-app | shell_exec `getDefaultBranch` | **FP** | `execSync("git config ...").toString()`: a literal command, and the `.toString()` call on its result was matched as the call | **gone** |
| infisical | dynamic_fetch `SecretAccessInsights` | **FP** | `axios.isAxiosError(e)` | **gone** |
| midday | dynamic_fetch `fetchJson` | TP | `fetch(url)` wrapper | kept |
| changedetection.io | raw_html `markup_text_links_to_html` | **FP** | every part is escaped before `Markup(''.join(...))` | kept (two of its three `Markup` calls are now read as safe; the join is not) |
| lotus | dynamic_fetch `BraintreeConnector` | **FP** | `url = f"https://api.nango.dev/..."; requests.get(url)` | kept (not fixed) |
| pontoon | dynamic_fetch `wrapFetch` | TP | `fetch(url)` wrapper | kept |
| Misago | dynamic_redirect `ModelFormView` | TP | `redirect(request.path_info)`, `redirect(self.root_link)` | kept |
| cal.com | dynamic_redirect settings `Page` | TP | `redirect(redirectUrl)` | kept |
| documenso | dynamic_redirect `cscOAuthCallbackRoute` | TP | computed targets; before, Hono's status `302` was read as the target | kept |
| simplelogin | dynamic_redirect `mfa_cancel` | TP | `redirect(request.url)` | kept |
| wger | dynamic_fetch `check_min_server_version` | TP | URL from a configured remote server | kept |
| ralph | raw_html `DataCenterAsset` | TP | `mark_safe("...{}".format(..., asset))`, unescaped | kept |
| fastapi | unsafe_deserialize `scripts/docs.py` | TP | `yaml.unsafe_load` (docs script) | kept |
| flask | eval `Config` | TP | `exec(compile(config_file.read()))`, by design | kept |
| saleor | dynamic_redirect `handle_thumbnail` | TP | `HttpResponseRedirect(thumbnail.image.url)` | kept |

## Root causes fixed (general, not per repo)

1. **Class read as a whole** (7 of 10 reaching FPs; about 70% of all reach rows went
   through a class). A class's facts were the union of its methods, so a call of any
   method "reached" what every method did. Facts now record each method's own calls and
   sinks (`Symbol::members`, facts schema 10), with sibling calls through
   `this`/`self`/`cls`. `drift security` follows `X.m()`, `this.x.m()` (NestJS
   injection), `binding.m()` on `const binding = new X()` and `X()` / `new X()` (the
   constructor) into that method only, through in-repo bases; a member that is no method
   (`Model.objects`) runs none of them; Django's `as_view()` is the class as a whole.
   Calls between sibling methods are not counted as hops.
2. **Next.js entry points by file name in packages that do not use Next.js**: `pages/`
   of Vite SPAs (InvenTree 66, lotus 25), Docusaurus sites, scaffold templates (novu
   27). A route, page, layout or middleware now needs a package built with Next.js: its
   manifest (or one above it) lists `next`, or a `next.config.*` is on the way; a package
   whose own manifest declares no dependencies (or no manifest at all) still counts, so
   nothing is dropped for lack of one. Server actions keep their `"use server"` rule.
3. **Sink classification**: `axios.isAxiosError()`/`axios.create()` read as requests
   (infisical 48); a method called on `execSync()`'s result read as the call; literal
   shell commands (`execSync("git --version")`, `os.system("clear")`); a literal host
   with only the port interpolated (`http://localhost:${port}/x`, TS and Python); Hono's
   `c.redirect(url, 302)` read the status as the target; `Markup(escape(x))` and
   f-strings whose every interpolation is escaped.
4. **Client leaks**: an env read on the server side of `typeof window` (a ternary, an
   `if`, or after `if (typeof window !== "undefined") return`) is recorded in
   `Symbol::server_reads` and is no leak; the env inventory still lists it.

## Remaining FPs seen (not fixed)

- A URL or redirect target bound to a local variable first (`url = "https://..."`,
  `redirect_url = reverse(...)`): sink detection reads the variable, not its value.
- A configured origin read from an object other than `env`/`config`/`settings`
  (`appCfg.SITE_URL`, `oauth_manager.oauth_redirect_url`).
- `Markup("".join(parts))` over parts escaped one by one.
- A route hook built from a function-local binding (`const passport = new Authenticator()`
  inside the router function) is dropped, so the route looks unwrapped.

## Misses seen while reading (false negatives, not measured)

- `new X().m()` is recorded as `X(new)` only: the method called on an instance built
  in place is not followed.
- `Model.objects.create()` runs `save()`; it is not followed.
- HTTP clients made once and reused (`axios.create()` instances, `requests.Session()`,
  `httpx.AsyncClient()`, `self.client.get(url)`) are not read as fetches.
- Guards in a handler's body (`requireHumanAccount()`, `verifyEnterpriseKey()`) are not
  shown: "no wrapper" is literal, and a reader cannot tell those from unguarded ones.
- FastAPI's `docs_src/` tutorials (366 of fastapi's 463 entry points) and repo-root
  developer scripts are inventoried as production code.
- Class field initializers (`private client = new S3Client()`) belong to no method.

## Before / after counts per repo

`reaching a sink` counts entry points, `reach rows` their `reaches[]` rows;
`leaking client files` counts distinct `"use client"` files in `client_leaks[]`.

| repo | entry points | no wrapper | reaching a sink | reach rows | sinks | leaking client files | env vars |
| --- | --- | --- | --- | --- | --- | --- | --- |
| py2/Django-CRM | 531 | 84 | 0 | 0 | 7 | 0 | 66 |
| py2/InvenTree | 126 → **60** | 82 → **16** | 1 → **0** | 1 → **0** | 45 | 0 | 36 |
| py2/Misago | 207 | 136 | 18 → **19** | 18 → **19** | 131 | 0 | 8 |
| py2/changedetection.io | 26 | 2 | 1 → **0** | 1 → **0** | 40 | 0 | 113 |
| py2/lotus | 157 → **132** | 93 → **68** | 34 → **4** | 34 → **4** | 4 | 0 | 21 |
| py2/open-wearables | 169 | 47 | 39 → **1** | 46 → **1** | 82 | 0 | 19 |
| py2/paperless-ngx | 60 | 28 | 9 → **2** | 9 → **2** | 7 | 0 | 88 |
| py2/pontoon | 176 | 75 | 28 | 28 | 32 | 0 | 119 |
| py2/ralph | 0 | 0 | 0 | 0 | 39 | 0 | 110 |
| py2/simplelogin | 235 | 3 | 74 | 76 | 55 | 0 | 135 |
| py2/tasking-manager | 198 | 8 | 151 → **3** | 300 → **3** | 31 → **30** | 0 | 102 |
| py2/wger | 102 | 34 | 14 → **12** | 14 → **12** | 28 | 0 | 4 |
| py/fastapi | 463 | 366 | 0 | 0 | 6 | 0 | 8 |
| py/flask | 0 | 0 | 0 | 0 | 7 | 0 | 4 |
| py/full-stack-fastapi-template | 23 | 1 | 0 | 0 | 0 | 0 | 3 |
| py/langchain | 0 | 0 | 0 | 0 | 7 | 0 | 18 |
| py/netbox | 244 | 74 | 19 → **5** | 20 → **5** | 109 | 0 | 22 |
| py/saleor | 129 | 60 | 11 → **2** | 11 → **2** | 6 | 0 | 129 |
| ts/ai | 64 | 64 | 1 → **0** | 1 → **0** | 16 → **15** | 0 | 35 |
| ts/cal.com | 529 | 119 | 25 → **20** | 25 → **20** | 153 → **147** | 1 → **0** | 227 |
| ts/create-t3-app | 49 | 22 | 0 | 0 | 13 → **6** | 1 → **0** | 17 |
| ts/documenso | 341 | 54 | 29 → **24** | 29 → **24** | 45 | 0 | 36 |
| ts/dub | 911 | 385 | 142 → **112** | 148 → **115** | 94 → **92** | 1 | 109 |
| ts/excalidraw | 1 → **0** | 1 → **0** | 0 | 0 | 22 → **18** | 0 | 31 |
| ts/formbricks | 434 | 272 | 55 | 58 | 112 | 0 | 208 |
| ts/immich | 319 → **318** | 9 → **8** | 16 → **2** | 38 → **2** | 34 | 0 | 28 |
| ts/infisical | 1704 → **1702** | 122 → **120** | 6 | 6 | 93 → **45** | 0 | 90 |
| ts/midday | 535 | 149 | 42 → **24** | 48 → **25** | 78 → **76** | 0 | 135 |
| ts/nest | 3 | 3 | 0 | 0 | 6 | 0 | 6 |
| ts/node-express-boilerplate | 15 | 1 | 0 | 0 | 1 → **0** | 0 | 0 |
| ts/novu | 608 → **581** | 115 → **88** | 145 → **110** | 168 → **126** | 149 → **134** | 0 | 373 |
| ts/supabase | 565 | 546 | 93 → **88** | 95 → **90** | 101 → **99** | 0 | 203 |
| ts/trpc | 0 | 0 | 0 | 0 | 8 → **7** | 0 | 5 |
| ts/twenty | 908 | 46 | 375 → **58** | 472 → **59** | 207 → **204** | 0 | 89 |
| **total** | 9832 → 9710 | 3001 → 2879 | 1328 → 649 | 1646 → 677 | 1768 → 1675 | 3 → 1 | 2597 → 2597 |

## Census

`census --json --max 15` on all 34 clones, same binaries: no proposal id added or
removed, no tier, holder, total or outlier count changed. In novu only the `lift` of
four suggestions moved in the third decimal (27 template entry points fewer in the
population): D-af3463 (suggestion, v3 WRONG), D-36a604, D-3f3e16, D-52c44b
(suggestions, v3 ACCEPT).
