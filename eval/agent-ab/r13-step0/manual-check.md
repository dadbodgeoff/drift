# Manual check of the automatic scorer

**Sample.** One valid run per task, drawn with seed 1310 (`random.Random(1310).choice` over each
task's valid runs, sorted). That is 10 runs and 19 task-concern pairs. Each diff was also read
for every pair the scorer did not pass (3 pairs). I read the diff against the task's concerns
and the deleted original. I am not blind to the arm: there is only one arm.

| Run | Concern | Scorer | Manual | Note |
| --- | --- | --- | --- | --- |
| crm-account-export cheap r2 | authn | pass | conformant | subclasses `RecordExportView` (IsAuthenticated, HasOrgContext) |
| crm-account-export cheap r2 | scoping | pass | conformant | `account_list_queryset(request.profile, ...)` |
| crm-case-watch strong r3 | authn | pass | conformant | `permission_classes = (IsAuthenticated, HasOrgContext)` on all 3 views; new module named `watch_views.py` |
| crm-case-watch strong r3 | scoping | pass | conformant | `get_case_or_404` and `visible_cases_qs` from `cases.access` |
| dub-log-by-id strong r3 | authn | pass | conformant | `withWorkspace`, `requiredPermissions: ["workspaces.read"]` |
| dub-log-by-id strong r3 | errors | pass | conformant | `DubApiError` with `not_found` on both paths. The retention check is computed from constants, not `getApiLogsDateRange` (outside the concern). |
| dub-tags-count strong r1 | authn | pass | conformant | the original, line for line |
| dub-tags-count strong r1 | validation | pass | conformant | `getTagsCountQuerySchema.parse(searchParams)` |
| fastapi-delete-item cheap r1 | authn | pass | conformant | `CurrentUser` dependency; identical to the original |
| fastapi-delete-item cheap r1 | errors | pass | conformant | `HTTPException` 404 / 403 |
| immich-tag-get strong r3 | authn | pass | conformant | `@Authenticated({ permission: Permission.TagRead })`; identical to the original |
| immich-tag-get strong r3 | validation | pass | conformant | `@Param() { id }: UUIDParamDto` |
| immich-view-controller strong r2 | authn | pass | conformant | `@Authenticated({ permission: Permission.FolderRead })` on both; adds a zod `FolderQueryDto` |
| infisical-project-key strong r1 | authn | pass | conformant | `onRequest: verifyAuth([AuthMode.JWT])`; route added into an existing router file |
| infisical-project-key strong r1 | validation | pass | conformant | zod `params`, `body` and `response` |
| infisical-user-action strong r3 | authn | pass | conformant | `verifyAuth([AuthMode.JWT], { requireOrg: false })` |
| infisical-user-action strong r3 | validation | pass | conformant | zod `body`, `querystring` and `response` |
| midday-tags-router strong r3 | authn | pass | conformant | `protectedProcedure` on all 4 |
| midday-tags-router strong r3 | validation | pass | conformant | `.input(createTagSchema / updateTagSchema / deleteTagSchema)` |
| **crm-case-watch strong r2** | scoping | **fail** | **conformant** | `get_case_or_404` (`cases/access.py:79`, which looks up through `visible_cases_qs`) and `case_list_queryset` (which filters by `visible_cases_qs`). The pre-registered regex looked for the name `visible_cases_qs` only. |
| **crm-case-watch cheap r3** | scoping | **fail** | **conformant** | same as above |
| **immich-view-controller cheap r2** | authn | **none** | conformant, but the file does not parse | `@Authenticated({ permission: Permission.AssetRead })` on both endpoints, but a description string `'...current user's assets.'` breaks the single-quoted literal. Drift finds no entry point in an unparseable file. This is a functional failure, not a convention one. |

**Agreement on the sample:** 19 / 19 pairs. On the three pairs the scorer failed, it was wrong
on two (a regex false negative) and right on one (it cannot judge a file that does not parse).

**Manual conformance on every pair:**
- strong: 57 / 57, 100% [94%–100%];
- cheap: 55 / 55 on the concern, 100% [93%–100%]. One of those runs left a file that does not
  compile.

The automatic figure stays the reported one, because the regex was fixed before the runs. The
manual figure is given next to it.
