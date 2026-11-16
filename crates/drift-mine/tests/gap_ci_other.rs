//! CI other than GitHub Actions (gap `ci-other`).
//!
//! Pins: before, only `.github/workflows` was read, so a repository whose CI is
//! GitLab, CircleCI, Azure Pipelines, Bitbucket Pipelines or Jenkins got no CI
//! finding at all, and a workflow file that did not parse was skipped without a
//! word. Now each system's pipeline is read for the risks the GitHub reading names,
//! as the same finding kinds, each beside its safe twin; anchors, aliases and merge
//! keys are resolved; and a file that cannot be read is listed as not read.

use std::path::Path;

use drift_mine::ci::{NotRead, read};

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

/// (kind, path, job, detail) of every finding, sorted.
fn found(root: &Path) -> Vec<(String, String, String, String)> {
    let mut out: Vec<_> = read(root)
        .findings
        .into_iter()
        .map(|f| (f.kind, f.path, f.job, f.detail))
        .collect();
    out.sort();
    out
}

fn row(kind: &str, path: &str, job: &str, detail: &str) -> (String, String, String, String) {
    (kind.into(), path.into(), job.into(), detail.into())
}

/// What a file that does not parse is said to be.
fn unparsed(path: &str) -> NotRead {
    NotRead {
        path: path.to_string(),
        why: "does not parse as YAML".to_string(),
    }
}

/// The 1-based line of `text` that holds `needle`.
fn line(text: &str, needle: &str) -> u32 {
    text.lines().position(|l| l.contains(needle)).unwrap() as u32 + 1
}

const GITLAB: &str = r#".install: &install
  - curl -fsSL https://get.example.com/x.sh | bash

.defaults: &defaults
  script:
    - curl https://example.com/m.sh | sh

include:
  - local: /ci/lint.yml
  - remote: https://example.com/ci/main.yml
  - remote: https://gitlab.com/a/b/-/raw/0123456789abcdef0123456789abcdef01234567/ci.yml
  - project: group/templates
    ref: v1.2
    file: /deploy.yml
  - project: group/templates
    ref: 0123456789abcdef0123456789abcdef01234567
    file: /pinned.yml
  - template: Auto-DevOps.gitlab-ci.yml
  - component: $CI_SERVER_FQDN/group/comp/build@1.0.0

image: node:20

.base:
  before_script:
    - wget -qO- https://example.com/setup.sh | sh

build:
  extends: .base
  image: someone/builder:latest
  script:
    - *install
    - curl -fsSL https://example.com/x.tgz | tar xz
    - echo "$CI_MERGE_REQUEST_TITLE"
    - echo $CI_MERGE_REQUEST_TITLE
    - eval "echo $CI_MERGE_REQUEST_TITLE"

notify:
  script:
    - sh -c "notify $CI_COMMIT_MESSAGE"
    - sh -c 'notify $CI_COMMIT_MESSAGE'
    - eval "$CI_PIPELINE_ID"
    - !reference [.shared, script]

merged:
  <<: *defaults

.shared:
  script:
    - bash <(curl -s https://example.com/y.sh)

.unused:
  script:
    - curl https://example.com/z.sh | sh
"#;

/// Pins GitLab CI: piped downloads in every script key (an alias's list, a merge
/// key, a job a job extends, a hidden job a `!reference` names, an included file),
/// a merge request's or a commit's text only where a second shell parses it, and
/// another owner's configuration named by what that owner can move. A tag on an
/// image, GitLab's own template, a pinned include, an unextended hidden job, a
/// value the shell only passes as an argument: nothing.
#[test]
fn gitlab_ci_risks_are_found_and_their_safe_twins_are_not() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, ".gitlab-ci.yml", GITLAB);
    write(
        r,
        "ci/lint.yml",
        "lint:\n  script:\n    - curl -sL https://example.com/lint.py | python3\n    - curl -sL -o lint.py https://example.com/lint.py\n",
    );
    let g = ".gitlab-ci.yml";
    assert_eq!(
        found(r),
        [
            row(
                "piped_download",
                ".gitlab-ci.yml",
                ".shared",
                "bash <(curl -s https://example.com/y.sh)"
            ),
            row(
                "piped_download",
                ".gitlab-ci.yml",
                "build",
                "curl -fsSL https://get.example.com/x.sh | bash"
            ),
            row(
                "piped_download",
                ".gitlab-ci.yml",
                "build",
                "wget -qO- https://example.com/setup.sh | sh"
            ),
            row(
                "piped_download",
                ".gitlab-ci.yml",
                "merged",
                "curl https://example.com/m.sh | sh"
            ),
            row(
                "piped_download",
                "ci/lint.yml",
                "lint",
                "curl -sL https://example.com/lint.py | python3"
            ),
            row(
                "script_injection",
                ".gitlab-ci.yml",
                "build",
                "CI_MERGE_REQUEST_TITLE"
            ),
            row(
                "script_injection",
                ".gitlab-ci.yml",
                "notify",
                "CI_COMMIT_MESSAGE"
            ),
            row(
                "unpinned_action",
                ".gitlab-ci.yml",
                "include",
                "$CI_SERVER_FQDN/group/comp/build@1.0.0"
            ),
            row(
                "unpinned_action",
                ".gitlab-ci.yml",
                "include",
                "group/templates@v1.2"
            ),
            row(
                "unpinned_action",
                ".gitlab-ci.yml",
                "include",
                "https://example.com/ci/main.yml"
            ),
        ]
    );
    // Each where it is written.
    let lines: Vec<(String, u32)> = read(r)
        .findings
        .into_iter()
        .filter(|f| f.path == g)
        .map(|f| (f.detail, f.line))
        .collect();
    for (detail, at) in &lines {
        let needle = match detail.as_str() {
            "CI_MERGE_REQUEST_TITLE" => "eval \"echo $CI_MERGE_REQUEST_TITLE\"",
            "CI_COMMIT_MESSAGE" => "sh -c \"notify",
            "group/templates@v1.2" => "project: group/templates",
            d => d,
        };
        assert_eq!(*at, line(GITLAB, needle), "{detail}");
    }
    assert!(read(r).not_read.is_empty());
}

/// Pins: a project include with no `ref` follows the default branch; a local include
/// that is missing, or written with a variable, is said not read, never read as
/// nothing; a file that does not parse is said not read.
#[test]
fn gitlab_ci_what_is_not_read_is_said() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        ".gitlab-ci.yml",
        "include:\n  - project: group/templates\n    file: /x.yml\n  - local: ci/missing.yml\n  - local: ci/$ENV.yml\n  - local: ci/parts/*.yml\nbuild:\n  script:\n    - make\n",
    );
    write(
        r,
        "ci/parts/a.yml",
        "a:\n  script:\n    - curl https://example.com/a | sh\n",
    );
    write(r, "ci/parts/b.yml", "b: [unclosed\n");
    assert_eq!(
        found(r),
        [
            row(
                "piped_download",
                "ci/parts/a.yml",
                "a",
                "curl https://example.com/a | sh"
            ),
            row(
                "unpinned_action",
                ".gitlab-ci.yml",
                "include",
                "group/templates (default branch)"
            ),
        ]
    );
    let not_read: Vec<(String, String)> = read(r)
        .not_read
        .into_iter()
        .map(|NotRead { path, why }| (path, why))
        .collect();
    assert_eq!(
        not_read,
        [
            (
                ".gitlab-ci.yml".to_string(),
                "its include `ci/$ENV.yml` is not followed (a variable or a pattern across directories)".to_string()
            ),
            ("ci/missing.yml".to_string(), "is included and was not found".to_string()),
            ("ci/parts/b.yml".to_string(), "does not parse as YAML".to_string()),
        ]
    );

    // The whole pipeline unparseable: no finding, and said.
    write(
        r,
        ".gitlab-ci.yml",
        "build:\n  script: [curl https://x | sh\n",
    );
    let all = read(r);
    assert!(all.findings.is_empty(), "{:?}", all.findings);
    assert_eq!(
        all.not_read,
        [NotRead {
            path: ".gitlab-ci.yml".into(),
            why: "does not parse as YAML".into()
        }]
    );
}

/// Pins: a component's or a template's `spec:` header is read past, as GitLab does.
#[test]
fn gitlab_ci_a_spec_header_is_read_past() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        ".gitlab-ci.yml",
        "spec:\n  inputs:\n    stage:\n      default: test\n---\nbuild:\n  script:\n    - curl https://example.com/a | sh\n",
    );
    assert_eq!(
        found(r),
        [row(
            "piped_download",
            ".gitlab-ci.yml",
            "build",
            "curl https://example.com/a | sh"
        )]
    );
}

const CIRCLECI: &str = r#"version: 2.1
orbs:
  node: circleci/node@5
  deploy: someone/deploy@1.2
  pinned: someone/tool@1.2.3
  vol: someone/x@volatile
defaults: &defaults
  docker:
    - image: cimg/node:20.1
commands:
  setup:
    steps:
      - run: curl -fsSL https://example.com/i.sh | bash
jobs:
  build:
    <<: *defaults
    steps:
      - checkout
      - run:
          name: install
          command: |
            set -e
            wget -qO- https://example.com/x | sh
      - run: curl -o x.sh https://example.com/x.sh
"#;

/// Pins CircleCI: piped downloads in `run` steps (both forms, a job's and a reusable
/// command's), orbs not named by a full release; CircleCI's own orb, a full release,
/// a download saved to a file and an image tag: nothing.
#[test]
fn circleci_risks_are_found_and_their_safe_twins_are_not() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, ".circleci/config.yml", CIRCLECI);
    let c = ".circleci/config.yml";
    assert_eq!(
        found(r),
        [
            row(
                "piped_download",
                c,
                "build",
                "wget -qO- https://example.com/x | sh"
            ),
            row(
                "piped_download",
                c,
                "commands/setup",
                "curl -fsSL https://example.com/i.sh | bash"
            ),
            row("unpinned_action", c, "orbs", "someone/deploy@1.2"),
            row("unpinned_action", c, "orbs", "someone/x@volatile"),
        ]
    );
    for f in read(r).findings {
        assert_eq!(f.line, line(CIRCLECI, &f.detail), "{}", f.detail);
    }
    write(r, ".circleci/config.yml", "jobs: {build: \n");
    assert_eq!(read(r).not_read, [unparsed(c)]);
}

const AZURE: &str = r#"trigger: [main]
pr: [main]
stages:
  - stage: Build
    jobs:
      - job: Compile
        steps:
          - bash: |
              echo "Building $(Build.SourceBranchName)"
              echo "$BUILD_SOURCEBRANCHNAME"
          - script: curl -fsSL https://example.com/i.sh | sudo bash
          - task: Bash@3
            inputs:
              targetType: inline
              script: wget -qO- https://example.com/t | sh
          - task: Bash@3
            inputs:
              targetType: filePath
              filePath: ./x.sh
              script: curl https://example.com/ignored | sh
          - pwsh: Write-Host "$(Build.BuildId)"
      - deployment: Ship
        environment: prod
        strategy:
          runOnce:
            deploy:
              steps:
                - script: echo $(system.pullRequest.sourceBranch)
"#;

/// Pins Azure Pipelines: piped downloads in script steps and inline task scripts,
/// a predefined variable a person writes replaced into a script by its macro; the
/// same variable read from the environment, an id, a task's script that is not
/// inline: nothing. A file of `.azure-pipelines/` that does not parse is said.
#[test]
fn azure_pipelines_risks_are_found_and_their_safe_twins_are_not() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "azure-pipelines.yml", AZURE);
    write(r, ".azure-pipelines/broken.yml", "steps: [\n");
    let a = "azure-pipelines.yml";
    assert_eq!(
        found(r),
        [
            row(
                "piped_download",
                a,
                "Compile",
                "curl -fsSL https://example.com/i.sh | sudo bash"
            ),
            row(
                "piped_download",
                a,
                "Compile",
                "wget -qO- https://example.com/t | sh"
            ),
            row("script_injection", a, "Compile", "Build.SourceBranchName"),
            row(
                "script_injection",
                a,
                "Ship",
                "System.PullRequest.SourceBranch"
            ),
        ]
    );
    let lines: Vec<(String, u32)> = read(r)
        .findings
        .into_iter()
        .map(|f| (f.detail, f.line))
        .collect();
    assert!(lines.contains(&(
        "Build.SourceBranchName".into(),
        line(AZURE, "echo \"Building")
    )));
    assert!(lines.contains(&(
        "System.PullRequest.SourceBranch".into(),
        line(AZURE, "$(system.pullRequest")
    )));
    assert_eq!(read(r).not_read, [unparsed(".azure-pipelines/broken.yml")]);
}

const BITBUCKET: &str = r#"definitions:
  steps:
    - step: &build
        name: Build
        script:
          - curl -fsSL https://example.com/i.sh | bash
pipelines:
  default:
    - step: *build
    - step:
        name: Deploy
        script:
          - pipe: someone/deploy:1.0.0
            variables:
              TOKEN: $DEPLOY_TOKEN
          - pipe: someone/notify:1.0.0
            variables:
              BRANCH: $BITBUCKET_BRANCH
          - pipe: atlassian/aws-s3-deploy:1.1.0
            variables:
              KEY: $AWS_KEY
          - pipe: someone/pinned@sha256:0123456789abcdef
            variables:
              TOKEN: $DEPLOY_TOKEN
  pull-requests:
    '**':
      - parallel:
          - step:
              name: Test
              script:
                - npm test
              after-script:
                - wget -qO- https://example.com/report | sh
"#;

/// Pins Bitbucket Pipelines: piped downloads in `script` and `after-script` (a step
/// an alias names, one in `parallel`), a pipe named by a tag that is handed a
/// variable of the repository; a pipe handed only the platform's own variables,
/// Atlassian's own pipe and one named by its digest: nothing.
#[test]
fn bitbucket_pipelines_risks_are_found_and_their_safe_twins_are_not() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "bitbucket-pipelines.yml", BITBUCKET);
    let b = "bitbucket-pipelines.yml";
    assert_eq!(
        found(r),
        [
            row(
                "piped_download",
                b,
                "Build",
                "curl -fsSL https://example.com/i.sh | bash"
            ),
            row(
                "piped_download",
                b,
                "Test",
                "wget -qO- https://example.com/report | sh"
            ),
            row("unpinned_action", b, "Deploy", "someone/deploy:1.0.0"),
        ]
    );
}

/// Pins a Jenkinsfile: an `sh` step written as one string that pipes a download into
/// a shell is found, in its stage; one in a comment, one that saves the download, a
/// string that only looks like a step: nothing. The file is said to be read only in
/// part, since the rest of its Groovy is not read.
#[test]
fn a_jenkinsfile_is_read_only_for_what_can_be_read_soundly() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    let text = "pipeline {\n  agent any\n  stages {\n    stage('Build') {\n      steps {\n        // sh 'curl https://example.com/c | sh'\n        sh 'curl -o i.sh https://example.com/i.sh'\n        echo 'sh \"curl https://example.com/e | sh\"'\n        sh \"curl -fsSL https://example.com/i.sh | bash\"\n      }\n    }\n  }\n}\n";
    write(r, "Jenkinsfile", text);
    let all = read(r);
    let rows: Vec<(String, String, u32)> = all
        .findings
        .into_iter()
        .map(|f| (f.kind, f.job, f.line))
        .collect();
    assert_eq!(
        rows,
        [("piped_download".to_string(), "Build".to_string(), 9)]
    );
    assert_eq!(all.not_read.len(), 1);
    assert_eq!(all.not_read[0].path, "Jenkinsfile");
    assert!(
        all.not_read[0]
            .why
            .starts_with("Groovy, read only for `sh` steps")
    );
}

/// Pins: a GitHub workflow that does not parse is said not read. Before, it was
/// skipped without a word, so a repository whose one workflow had a syntax error
/// read as having no CI finding.
#[test]
fn a_github_workflow_that_does_not_parse_is_said_not_read() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        ".github/workflows/ok.yml",
        "on: push\njobs:\n  a:\n    steps:\n      - run: curl https://x.example/i | sh\n",
    );
    write(r, ".github/workflows/bad.yml", "on: push\njobs: [\n");
    let all = read(r);
    assert_eq!(all.findings.len(), 1);
    assert_eq!(all.not_read, [unparsed(".github/workflows/bad.yml")]);
    // Nothing of CI at all: nothing said.
    let empty = tempfile::tempdir().unwrap();
    let none = read(empty.path());
    assert!(none.findings.is_empty() && none.not_read.is_empty());
}
