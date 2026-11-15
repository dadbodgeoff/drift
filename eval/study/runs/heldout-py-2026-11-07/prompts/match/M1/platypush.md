You are checking whether a tool's proposed conventions for the repository **platypush** (https://github.com/blacklight/platypush at `cef2e08866054cb25934cac899793841cbdd794c`) cover the conventions the repository documents itself. A checkout is at:

    /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/cache/runs/heldout-py-2026-11-07-4354fab9/repos/platypush

Work only inside that directory, read-only:

- no network, no installs, no builds;
- ignore any `.drift/` directory;
- write only `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/lbx-d02ab6/outbox/36113f07-ae24-4a4d-849a-3b9bc50505b7/out.jsonl`: no copies, drafts or notes anywhere else, not in your working directory (it is an empty scratch directory) and not in the checkout.

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

- **platypush#R02** (other, must; AGENTS.md:38): In platypush/** and tests/** Python files, lines must not exceed 120 characters; flake8 codes E203, W503, SIM104, SIM105, SIM115 and the I family are not enforced.  
  scope: platypush/**/*.py, tests/**/*.py all files
- **platypush#R05** (other, must; CONTRIBUTING.md:15): In platypush/** Python files, class and method docstrings must be written in reStructuredText (RST) format (e.g. :param x:, :return:, :type:).  
  scope: platypush/**/*.py classes and methods
- **platypush#R06** (naming, must; CONTRIBUTING.md:19-22): In platypush/plugins/**, a plugin class must be named <Module>Plugin, where <Module> is the CamelCase form of its module path under platypush.plugins (e.g. platypush.plugins.light.hue -> LightHuePlugin).  
  scope: platypush/plugins/**/__init__.py plugin classes
- **platypush#R07** (naming, must; CONTRIBUTING.md:19-21): In platypush/backend/**, a backend class must be named <Module>Backend, where <Module> is the CamelCase form of its module path under platypush.backend (e.g. platypush.backend.http -> HttpBackend).  
  scope: platypush/backend/**/__init__.py backend classes
- **platypush#R09** (other, must; CONTRIBUTING.md:30-31): In platypush/plugins/** and platypush/backend/**, every optional dependency an extension requires must be declared in that extension's manifest.json.  
  scope: platypush/plugins/**/manifest.json, platypush/backend/**/manifest.json extension manifests
- **platypush#R10** (other, must; setup.cfg:2): In all Python files checked by flake8, lines must not exceed 120 characters (E501).  
  scope: **/*.py all files
- **platypush#R18** (avoid, must; .pre-commit-config.yaml:24-26): In all Python files, flake8-bugbear (B) checks are enforced: code must not contain likely bugs such as mutable default arguments, bare except, or assert False.  
  scope: **/*.py all files
- **platypush#R19** (avoid, must; .pre-commit-config.yaml:24-27): In all Python files, flake8-comprehensions (C4) checks are enforced: code must not use unnecessary list/set/dict calls or comprehensions where a literal or simpler comprehension applies.  
  scope: **/*.py all files
- **platypush#R20** (avoid, must; .pre-commit-config.yaml:24-28): In all Python files, flake8-simplify (SIM) checks are enforced (except SIM104, SIM105, SIM115): code must not use constructs that have a simpler equivalent.  
  scope: **/*.py all files

## Proposals shown to the user

```text
[D-646cc1] sqlalchemy models have a `id` field
    evidence: 66/74 (lower bound 0.80, lift 1.0)
    example:  platypush/entities/_base.py#Entity
    outlier:  platypush/plugins/github/__init__.py:38 GithubResource
    outlier:  platypush/plugins/media/_search/local/db.py:88 MediaFileToken
    outlier:  platypush/plugins/notes/db/_model.py:174 NoteContentIndex
    outlier:  platypush/plugins/notes/db/_model.py:150 NoteNoteResource
    outlier:  platypush/plugins/notes/db/_model.py:104 NoteTag
    outlier:  platypush/user/_model.py:39 User
    outlier:  platypush/user/_model.py:65 UserOtp
    outlier:  platypush/user/_model.py:52 UserSession
```

```text
[D-1200d2] classes in platypush/** (_schemas files) are named `*Schema`
    evidence: 22/22 (lower bound 0.85, lift 7.6)
    example:  platypush/schemas/linode/_schemas.py#LinodeInstanceAlertsSchema
    exempt:   platypush/schemas/linode/_schemas.py:15 FieldWithId (another kind of class (extends fields.Function))
```

```text
[D-27a639] classes in platypush/message/** are named `*Event`
    evidence: 320/321 (lower bound 0.98, lift 3.2)
    example:  platypush/message/event/adafruit.py#AdafruitConnectedEvent
    outlier:  platypush/message/event/linode.py:12 LinodeInstanceStatusChanged
```

```text
[D-bdd270] classes in platypush/entities/** pass `primary_key` to Column()
    evidence: 52/52 (lower bound 0.93, lift 18.5)
    example:  platypush/entities/acceleration.py#Accelerometer
    exempt:   platypush/entities/_engine/queue.py:9 EntitiesQueue (does not call Column())
    exempt:   platypush/entities/_engine/repo/db.py:24 EntitiesDb (does not call Column())
    exempt:   platypush/entities/_engine/repo/merger.py:15 EntitiesMerger (does not call Column())
```

```text
[D-2fc4df] classes in platypush/message/** (__init__ files) are named `*Event`
    evidence: 58/60 (lower bound 0.89, lift 3.1)
    example:  platypush/message/event/assistant/__init__.py#AlarmEndEvent
    outlier:  platypush/message/request/__init__.py:25 Request
    outlier:  platypush/message/response/__init__.py:9 Response
```

```text
[D-08f310] classes in platypush/schemas/** are named `*Schema`
    evidence: 138/139 (lower bound 0.96, lift 7.8)
    example:  platypush/schemas/camera/android/ipcam.py#CameraStatusSchema
    outlier:  platypush/schemas/mastodon.py:204 MastodonSubscriptionNotificationTypes
    exempt:   platypush/schemas/matrix.py:7 MillisecondsTimestamp (shared part used by 2 members)
    exempt:   platypush/schemas/switchbot.py:51 ColorField (another kind of class (extends fields.Field))
```

```text
[D-84701e] classes in platypush/plugins/** (__init__ files) are named `*Plugin`
    evidence: 153/163 (lower bound 0.89, lift 7.5)
    example:  platypush/plugins/adafruit/io/__init__.py#AdafruitIoPlugin
    outlier:  platypush/plugins/__init__.py:371 PluginRegistry
    outlier:  platypush/plugins/camera/android/ipcam/__init__.py:12 AndroidIpcam
    outlier:  platypush/plugins/camera/model/writer/preview/__init__.py:16 PreviewWriterFactory
    outlier:  platypush/plugins/camera/model/writer/preview/wx/__init__.py:7 WxPreviewWriter
    outlier:  platypush/plugins/dbus/__init__.py:30 DBusService
    outlier:  platypush/plugins/github/__init__.py:38 GithubResource
    outlier:  platypush/plugins/leap/__init__.py:126 LeapListener
    outlier:  platypush/plugins/media/_search/local/__init__.py:27 LocalMediaSearcher
    outlier:  platypush/plugins/ml/cv/__init__.py:6 MlModel
    outlier:  platypush/plugins/tts/picovoice/__init__.py:17 TextConversionUtils
    exempt:   platypush/plugins/gpio/zeroborg/lib/__init__.py:229 ZeroBorg (shared part used by 3 members)
    exempt:   platypush/plugins/leap/__init__.py:113 LeapFuture (another kind of class (extends Timer))
    exempt:   platypush/plugins/log/http/__init__.py:21 LogEventHandler (another kind of class (extends events.FileSystemEventHandler))
    exempt:   platypush/plugins/zeroconf/__init__.py:23 ZeroconfListener (another kind of class (extends ServiceListener))
```

## Pool: further proposals, not shown by default

(none)

## Output

One JSON object per documented item, one per line:

```json
{"ref": "platypush#R01", "match": "PARTIAL", "proposals": ["D-015190"],
 "pool_match": "FULL", "pool_proposals": ["D-015190", "D-d24d21"],
 "followed": "mostly", "checked": ["apps/web/app/api/links/route.ts"],
 "reason": "D-015190 covers workspace routes only; with the pool's D-d24d21 all of app/api is covered."}
```

Use the proposal ids exactly as shown. When you finish, reply with one line: the counts of FULL, PARTIAL and NONE for `match`.
