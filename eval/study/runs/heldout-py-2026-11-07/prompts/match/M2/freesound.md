You are checking whether a tool's proposed conventions for the repository **freesound** (https://github.com/MTG/freesound at `da3a786e2e5bdcaec1265b0798d4e212d2015720`) cover the conventions the repository documents itself. A checkout is at:

    /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/cache/runs/heldout-py-2026-11-07-4354fab9/repos/freesound

Work only inside that directory, read-only:

- no network, no installs, no builds;
- ignore any `.drift/` directory;
- write only `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/lbx-d02ab6/outbox/9291573c-fe74-415d-80dd-f7f59d8e00ab/out.jsonl`: no copies, drafts or notes anywhere else, not in your working directory (it is an empty scratch directory) and not in the checkout.

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

- **freesound#R02** (other, must; DEVELOPERS.md:20): In Python code, docstrings must follow the Google style (Args:/Returns: sections).  
  scope: **/*.py functions, classes, methods
- **freesound#R03** (typing, should; DEVELOPERS.md:27): In Python docstrings, each entry in the Args section should state its type in parentheses, e.g. `param1 (int): ...`.  
  scope: **/*.py docstrings
- **freesound#R04** (other, must; DEVELOPERS.md:32): In Python docstrings, every sentence, including each argument-list and other list entry, must end with a period.  
  scope: **/*.py docstrings
- **freesound#R05** (argument, must; DEVELOPERS.md:69): In Django template tag functions (registered with @register.inclusion_tag / simple_tag), optional arguments with defaults must be keyword-only (placed after `*`).  
  scope: **/templatetags/*.py template tag functions
- **freesound#R06** (argument, must; DEVELOPERS.md:76): In Django templates, calls to custom template tags must pass optional arguments by keyword (e.g. `size=32`), not positionally.  
  scope: templates/**/*.html template tag usages
- **freesound#R07** (other, should; DEVELOPERS.md:85): In Django apps, custom permissions should be declared in the `Meta.permissions` of the most closely related model, not in a generic permissions-holder model.  
  scope: */models.py Django models
- **freesound#R08** (other, should; DEVELOPERS.md:88): When a custom permission is added, it should be assigned to a `Group` defined in accounts/fixtures/user_groups.json.  
  scope: accounts/fixtures/user_groups.json and models with custom permissions
- **freesound#R09** (calls, should; DEVELOPERS.md:124): In views decorated with @redirect_if_old_username, code should obtain the user via `get_parameter_user_or_404(request)` rather than reading `request.parameter_user` directly.  
  scope: */views.py view functions using redirect_if_old_username
- **freesound#R10** (decorator, should; DEVELOPERS.md:127): In Django views, every public view whose URL path contains a username must be decorated with `utils.username.redirect_if_old_username`.  
  scope: */views.py public views with username URL parameter
- **freesound#R11** (decorator, should; DEVELOPERS.md:128): In Django views, views decorated with @login_required should not also use @redirect_if_old_username.  
  scope: */views.py login-required views
- **freesound#R12** (decorator, should; DEVELOPERS.md:130): In Django views, public username-in-URL views that must not be reachable for anonymized users must also be decorated with `utils.username.raise_404_if_user_is_deleted`.  
  scope: */views.py public views with username URL parameter
- **freesound#R13** (decorator, must; DEVELOPERS.md:131): In Django views using both decorators, `@redirect_if_old_username` must be placed above (outer to) `@raise_404_if_user_is_deleted`.  
  scope: */views.py view functions
- **freesound#R14** (file_layout, should; DEVELOPERS.md:144): In Django migrations, complex data migrations should not be written in migration files; use a schema-only migration plus a management command that copies data.  
  scope: */migrations/*.py migration files
- **freesound#R15** (other, should; DEVELOPERS.md:149): In Django migrations for large tables, new columns should be added as nullable (null=True) rather than with a default, and made non-null in a later migration.  
  scope: */migrations/*.py AddField operations on large tables
- **freesound#R16** (other, should; DEVELOPERS.md:155): In accounts/models.py, every new field added to `Profile` must be handled in `Profile.delete_user` (user anonymization).  
  scope: accounts/models.py Profile model
- **freesound#R17** (other, should; DEVELOPERS.md:161): In sounds/models.py, every new field added to `Sound` must be handled when building `DeletedSound` in the `on_delete_sound` pre_delete handler.  
  scope: sounds/models.py Sound model
- **freesound#R18** (calls, should; DEVELOPERS.md:167): In frontend JS, new modals should be implemented with `handleGenericModal` or `handleGenericModalWithForm` from modal.js rather than custom modal logic.  
  scope: freesound/static/bw-frontend/src/**/*.js modal code
- **freesound#R19** (other, should; DEVELOPERS.md:177): In utils/search/search_query_processor.py, new search page options must be added as `SearchOption` subclass members of `SearchQueryProcessor`.  
  scope: utils/search/search_query_processor.py
- **freesound#R20** (other, should; DEVELOPERS.md:180): In search code, calculations deriving `query_params` for `search_sounds` from a search option should live in `SearchQueryProcessor.as_query_params`.  
  scope: utils/search/search_query_processor.py
- **freesound#R21** (render, should; DEVELOPERS.md:184): In templates/search/search.html, new search options should be rendered in the form, preferably via the `display_search_option` template tag.  
  scope: templates/search/search.html
- **freesound#R22** (base_class, must; DEVELOPERS.md:206): In utils/search/backends, search engine backend classes must subclass `utils.search.SearchEngineBase` and implement its documented API.  
  scope: utils/search/backends/*.py backend classes
- **freesound#R24** (calls, should; DEVELOPERS.md:359): In Python code, metrics should be counted with a `prometheus_client.Counter` and its `.inc()` method.  
  scope: **/*.py metric emission
- **freesound#R25** (file_layout, should; DEVELOPERS.md:360): In Python code, a Prometheus metric used in one place should be defined in that module; a metric incremented from several modules should be defined in a shared domain module.  
  scope: **/*.py prometheus metric definitions
- **freesound#R28** (naming, must; pyproject.toml:91): In Python files, code must not shadow Python builtins (flake8-builtins A rules).  
  scope: **/*.py all files
- **freesound#R29** (avoid, must; pyproject.toml:92): In Python files, code must not contain flake8-bugbear (B) likely-bug patterns.  
  scope: **/*.py all files
- **freesound#R30** (other, must; pyproject.toml:93): In Python files, code must pass pycodestyle error (E) checks.  
  scope: **/*.py all files
- **freesound#R31** (other, must; pyproject.toml:94): In Python files, code must pass pyflakes (F) checks such as unused imports and undefined names.  
  scope: **/*.py all files
- **freesound#R32** (other, must; pyproject.toml:95): In Python files, imports must be sorted and grouped per isort (I) rules.  
  scope: **/*.py imports
- **freesound#R33** (avoid, must; pyproject.toml:96): In Python files, code must not use insecure patterns flagged by flake8-bandit (S).  
  scope: **/*.py all files
- **freesound#R34** (other, must; pyproject.toml:97): In Python files, Django code must follow flake8-django (DJ) rules.  
  scope: **/*.py Django models, forms, views
- **freesound#R35** (avoid, must; pyproject.toml:98): In Python files, code must not contain unnecessary constructs flagged by flake8-pie (PIE).  
  scope: **/*.py all files
- **freesound#R36** (other, must; pyproject.toml:99): In Python files, code must not contain pylint error (PLE) issues.  
  scope: **/*.py all files
- **freesound#R61** (other, must; .eslintrc:20): In frontend JS, statements must end with a semicolon.  
  scope: freesound/static/bw-frontend/src/**/*.js
- **freesound#R62** (naming, should; .eslintrc:21): In frontend JS, variables and arguments should not be left unused unless their names start with `_` (rest siblings are exempt).  
  scope: freesound/static/bw-frontend/src/**/*.js
- **freesound#R63** (avoid, must; .eslintrc:12): In frontend JS, the globals `$`, `Highcharts`, `MapboxGeocoder`, `d3` and `mapboxgl` may be used but must not be reassigned.  
  scope: freesound/static/bw-frontend/src/**/*.js

## Proposals shown to the user

```text
[D-4e8196] functions in utils/** do not use redirects to computed URLs
    evidence: 149/150 (lower bound 0.96, lift 15.3)
    example:  utils/audioprocessing/color_schemes.py#color_from_value
    outlier:  utils/url.py:28 redirect_inline
```

## Pool: further proposals, not shown by default

(none)

## Output

One JSON object per documented item, one per line:

```json
{"ref": "freesound#R01", "match": "PARTIAL", "proposals": ["D-015190"],
 "pool_match": "FULL", "pool_proposals": ["D-015190", "D-d24d21"],
 "followed": "mostly", "checked": ["apps/web/app/api/links/route.ts"],
 "reason": "D-015190 covers workspace routes only; with the pool's D-d24d21 all of app/api is covered."}
```

Use the proposal ids exactly as shown. When you finish, reply with one line: the counts of FULL, PARTIAL and NONE for `match`.
