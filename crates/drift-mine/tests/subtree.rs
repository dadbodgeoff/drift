//! A rule whose holders all sit in one subtree of the role, with its outliers in
//! folders of their own elsewhere, is a convention of that subtree (F10): the
//! outliers are another context, not violations. Guard rules and entry points are
//! never narrowed: an outlier elsewhere stays reported.

use drift_core::{EntryPoint, FileFacts, RepoFacts, Symbol, SymbolKind, Wrap, WrapKind};
use drift_mine::check::{Scope, check};
use drift_mine::mine::{Candidate, MineOptions, Rule, mine_unshown as mine};
use drift_mine::policy::{ConventionsFile, Lock, Status};
use drift_mine::roles::role_covers_path;

/// The role's folder, five levels deep as in the dev case (roles are formed down to
/// depth 5, so the holders' folder below it is no role of its own).
const RUNNER: &str = "src/engine/manager/migration/runner";

fn class(path: &str, name: &str, wraps: &[(&str, WrapKind)]) -> FileFacts {
    FileFacts {
        path: path.into(),
        lang: "ts".into(),
        parse_ok: true,
        symbols: vec![Symbol {
            name: name.into(),
            kind: SymbolKind::Class,
            exported_as: vec![name.into()],
            line: 3,
            wraps: wraps
                .iter()
                .map(|(w, k)| Wrap {
                    wrapper: (*w).into(),
                    kind: *k,
                })
                .collect(),
            ..Default::default()
        }],
        ..Default::default()
    }
}

fn repo(files: Vec<FileFacts>) -> RepoFacts {
    let mut r = RepoFacts {
        files,
        ..Default::default()
    };
    r.normalize();
    r
}

/// 40 handlers under `runner/action-handlers/<group>/services/` that follow `rule`,
/// `outliers` (path, name) that do not, and 40 unrelated services next to the runner
/// so that the rule is specific to it (and the runner's role, at depth 5, is where it
/// is mined, as in the dev case).
fn runner_repo(target: &str, kind: WrapKind, outliers: &[(&str, &str)]) -> RepoFacts {
    let mut files = Vec::new();
    for i in 0..40 {
        files.push(class(
            &format!(
                "{RUNNER}/action-handlers/group-{}/services/handler-{i}.service.ts",
                i % 8
            ),
            &format!("Handler{i}Service"),
            &[(target, kind)],
        ));
    }
    for (path, name) in outliers {
        files.push(class(path, name, &[]));
    }
    for i in 0..40 {
        files.push(class(
            &format!(
                "src/engine/manager/migration/area-{}/thing-{i}.service.ts",
                i % 5
            ),
            &format!("Thing{i}Service"),
            &[],
        ));
    }
    repo(files)
}

/// The deferred handlers, registries and runner services next to `action-handlers/`.
const ELSEWHERE: &[(&str, &str)] = &[
    (
        "src/engine/manager/migration/runner/deferred-action-handlers/services/build-index.service.ts",
        "BuildIndexService",
    ),
    (
        "src/engine/manager/migration/runner/deferred-action-handlers/services/validate-key.service.ts",
        "ValidateKeyService",
    ),
    (
        "src/engine/manager/migration/runner/registry/handler-registry.service.ts",
        "HandlerRegistryService",
    ),
    (
        "src/engine/manager/migration/runner/services/runner.service.ts",
        "RunnerService",
    ),
];

fn extends_rule(target: &str) -> Rule {
    Rule::WrappedBy {
        kind: WrapKind::Extends,
        any_of: vec![target.into()],
    }
}

fn find<'a>(cs: &'a [Candidate], rule: &Rule) -> &'a Candidate {
    cs.iter()
        .find(|c| &c.rule == rule)
        .unwrap_or_else(|| panic!("{rule:?} is proposed"))
}

fn accepted(r: &RepoFacts) -> (Vec<Candidate>, ConventionsFile) {
    let mined = mine(r, &MineOptions { max_per_repo: 200 });
    let mut policy = ConventionsFile::merge(None, "test", mined.kinds.clone(), &mined.candidates);
    for c in &mut policy.conventions {
        c.status = Status::Accepted;
    }
    (mined.candidates, policy)
}

fn reported(r: &RepoFacts, policy: &ConventionsFile, id: &str) -> Vec<String> {
    check(r, policy, &Lock::default(), Scope::Accepted, None)
        .violations
        .into_iter()
        .filter(|v| v.id == id)
        .map(|v| v.symbol)
        .collect()
}

#[test]
fn a_rule_held_in_one_subtree_applies_to_that_subtree() {
    let base = "src/engine/manager/migration/runner/action-handler.ts#MigrationActionHandler";
    let r = runner_repo(base, WrapKind::Extends, ELSEWHERE);
    let (cs, policy) = accepted(&r);
    let c = find(&cs, &extends_rule(base));
    assert_eq!(c.role.dir, format!("{RUNNER}/action-handlers"));
    assert_eq!((c.evidence.holders, c.evidence.total), (40, 40));
    assert!(c.outliers.is_empty(), "{:?}", c.outliers);
    assert!(
        c.example.starts_with(&format!("{RUNNER}/action-handlers/")),
        "{}",
        c.example
    );
    // The card says where it applies.
    let conv = policy.conventions.iter().find(|p| p.id == c.id).unwrap();
    assert!(
        conv.summary
            .contains("classes in src/engine/manager/migration/runner/action-handlers/**"),
        "{}",
        conv.summary
    );

    // `check` applies the narrowed scope: the deferred handlers are not reported, a
    // new handler without the base is, and so is one in a new group folder.
    assert!(reported(&r, &policy, &c.id).is_empty());
    let mut grown = r.clone();
    grown.files.push(class(
        &format!("{RUNNER}/action-handlers/group-1/services/new.service.ts"),
        "NewHandlerService",
        &[],
    ));
    grown.files.push(class(
        &format!("{RUNNER}/action-handlers/group-new/services/other.service.ts"),
        "OtherHandlerService",
        &[],
    ));
    grown.files.push(class(
        &format!("{RUNNER}/deferred-action-handlers/services/new-deferred.service.ts"),
        "NewDeferredService",
        &[],
    ));
    grown.normalize();
    assert_eq!(
        reported(&grown, &policy, &c.id),
        ["NewHandlerService", "OtherHandlerService"]
    );

    // A file about to be written (the hooks) is covered the same way.
    let covers = |rel: &str| role_covers_path(&conv.role, rel, None, None, &policy.file_kinds);
    assert!(covers(&format!(
        "{RUNNER}/action-handlers/group-9/services/x.service.ts"
    )));
    assert!(!covers(&format!(
        "{RUNNER}/deferred-action-handlers/services/x.service.ts"
    )));
    assert!(!covers(&format!("{RUNNER}/services/x.service.ts")));
    assert!(!covers(&format!("{RUNNER}/action-handlers/group-1/x.ts")));
}

#[test]
fn the_folder_of_the_holders_or_above_them_keeps_its_outliers() {
    let base = "src/engine/manager/migration/runner/action-handler.ts#MigrationActionHandler";
    // A service in the runner's own folder, above the handlers: a missing base next to
    // the classes that have it is a mistake, not another context.
    let mut outliers = ELSEWHERE.to_vec();
    outliers.push((
        "src/engine/manager/migration/runner/stray.service.ts",
        "StrayService",
    ));
    let r = runner_repo(base, WrapKind::Extends, &outliers);
    let (cs, policy) = accepted(&r);
    let c = find(&cs, &extends_rule(base));
    assert_eq!(c.role.dir, RUNNER);
    assert_eq!(c.outliers.len(), 5);
    assert!(reported(&r, &policy, &c.id).contains(&"StrayService".to_string()));
}

#[test]
fn guard_rules_are_never_narrowed() {
    // By name: a decorator that says access control.
    let guard = "src/auth/require-permission.ts#RequirePermission";
    let r = runner_repo(guard, WrapKind::Decorator, ELSEWHERE);
    let (cs, policy) = accepted(&r);
    let rule = Rule::WrappedBy {
        kind: WrapKind::Decorator,
        any_of: vec![guard.into()],
    };
    let c = find(&cs, &rule);
    assert_eq!(c.role.dir, RUNNER, "an auth rule keeps its role");
    assert_eq!(c.outliers.len(), ELSEWHERE.len());
    // The outlier outside the subtree is a real mistake, and stays reported.
    assert!(reported(&r, &policy, &c.id).contains(&"RunnerService".to_string()));

    // By use: a neutral name that decorates an entry point somewhere is a guard too.
    let audited = "src/lib/audited.ts#Audited";
    let mut r = runner_repo(audited, WrapKind::Decorator, ELSEWHERE);
    let mut route = class(
        "src/api/users.controller.ts",
        "listUsers",
        &[(audited, WrapKind::Decorator)],
    );
    route.symbols[0].kind = SymbolKind::Function;
    route.entry_points.push(EntryPoint {
        symbol: "listUsers".into(),
        kind: "http".into(),
        method: Some("GET".into()),
        route: Some("/users".into()),
        adapter: "nestjs".into(),
    });
    r.files.push(route);
    r.normalize();
    let rule = Rule::WrappedBy {
        kind: WrapKind::Decorator,
        any_of: vec![audited.into()],
    };
    let c = find(&mined_all(&r), &rule).clone();
    assert_eq!(
        c.role.dir, RUNNER,
        "a rule on what guards a route keeps its role"
    );
}

#[test]
fn an_entry_point_outside_the_subtree_is_judged_by_the_rule() {
    let base = "src/engine/manager/migration/runner/action-handler.ts#MigrationActionHandler";
    let r = runner_repo(base, WrapKind::Extends, ELSEWHERE);
    let mut files = r.files.clone();
    // The runner service is a controller: its file declares a route.
    for f in &mut files {
        if f.path.ends_with("services/runner.service.ts") {
            f.entry_points.push(EntryPoint {
                symbol: "run".into(),
                kind: "http".into(),
                method: Some("POST".into()),
                route: Some("/run".into()),
                adapter: "nestjs".into(),
            });
        }
    }
    let r = repo(files);
    let c = find(&mined_all(&r), &extends_rule(base)).clone();
    assert_eq!(c.role.dir, RUNNER);
    assert!(c.outliers.iter().any(|o| o.symbol == "RunnerService"));
}

fn mined_all(r: &RepoFacts) -> Vec<Candidate> {
    mine(r, &MineOptions { max_per_repo: 200 }).candidates
}

const INJECTABLE: &str = "pkg:@nestjs/common#Injectable";

/// The runner repo with Nest's `@Injectable()` on every service, as in twenty: the
/// holders, the outliers next to `action-handlers/` and the repo's other services (all
/// but `undecorated` of the 40); and 200 entities, which carry no decorator.
fn injectable_repo(base: &str, undecorated: usize) -> RepoFacts {
    let mut files = Vec::new();
    for i in 0..40 {
        files.push(class(
            &format!(
                "{RUNNER}/action-handlers/group-{}/services/handler-{i}.service.ts",
                i % 8
            ),
            &format!("Handler{i}Service"),
            &[(base, WrapKind::Extends), (INJECTABLE, WrapKind::Decorator)],
        ));
    }
    for (path, name) in ELSEWHERE {
        files.push(class(path, name, &[(INJECTABLE, WrapKind::Decorator)]));
    }
    for i in 0..40 {
        let wraps: &[(&str, WrapKind)] = if i < undecorated {
            &[]
        } else {
            &[(INJECTABLE, WrapKind::Decorator)]
        };
        files.push(class(
            &format!(
                "src/engine/manager/migration/area-{}/thing-{i}.service.ts",
                i % 5
            ),
            &format!("Thing{i}Service"),
            wraps,
        ));
    }
    for i in 0..200 {
        files.push(class(
            &format!("src/entities/e-{}/e{i}.entity.ts", i % 10),
            &format!("E{i}Entity"),
            &[],
        ));
    }
    repo(files)
}

/// A decorator nearly every class of the role's file kind carries (`@Injectable()` on
/// 82 of 84 services here, as on twenty's services) is no mark of the holders' line: it
/// says what "`*.service` files" already says. So the outliers beside `action-handlers/`
/// are another context (relabel4: twenty's two such cards were WRONG for a mixed group),
/// while a decorator characteristic of the holders still keeps the role (below).
#[test]
fn a_decorator_of_the_whole_file_kind_is_no_mark_of_the_holders() {
    let base = "src/engine/manager/migration/runner/action-handler.ts#MigrationActionHandler";
    let r = injectable_repo(base, 2);
    let (cs, _) = accepted(&r);
    let c = find(&cs, &extends_rule(base));
    assert_eq!(c.role.dir, format!("{RUNNER}/action-handlers"));
    assert!(c.outliers.is_empty(), "{:?}", c.outliers);

    // Carried by fewer than 90% of the services (30 of 84 lack it), and by every
    // holder: it marks the holders' line, and the role keeps its outliers.
    let r = injectable_repo(base, 30);
    let (cs, _) = accepted(&r);
    let c = find(&cs, &extends_rule(base));
    assert_eq!(c.role.dir, RUNNER);
}

/// Hysteresis: an accepted convention keeps its role where mining would narrow it to
/// the holders' subtree (another id).
#[test]
fn an_accepted_role_is_not_narrowed() {
    let base = "src/engine/manager/migration/runner/action-handler.ts#MigrationActionHandler";
    let r = runner_repo(base, WrapKind::Extends, ELSEWHERE);
    let mined = mine(&r, &MineOptions { max_per_repo: 200 });
    let narrowed = find(&mined.candidates, &extends_rule(base));
    assert_eq!(narrowed.role.dir, format!("{RUNNER}/action-handlers"));
    let mut role = narrowed.role.clone();
    role.dir = RUNNER.into();
    let accepted = [(role.clone(), extends_rule(base))];
    let kept = drift_mine::mine::mine_keeping(
        &r,
        &MineOptions { max_per_repo: 200 },
        mined.kinds.clone(),
        &accepted,
    );
    let c = find(&kept.candidates, &extends_rule(base));
    assert_eq!(c.role, role);
    assert_eq!(c.outliers.len(), ELSEWHERE.len());
}
