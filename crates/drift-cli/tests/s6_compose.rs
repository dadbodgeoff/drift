//! A compose file laid over the base (`docker compose -f compose.yml -f
//! compose.deploy.yml`) is a stack of the files named with `-f`: the override file
//! `docker compose` merges only when no `-f` is given is not part of it (stream S6,
//! audit 5).

use std::fs;
use std::path::Path;

use drift_mine::security::{Boundaries, Exposure};

fn write(root: &Path, files: &[(&str, &str)]) {
    for (path, text) in files {
        let p = root.join(path);
        fs::create_dir_all(p.parent().unwrap_or(Path::new("."))).expect("mkdir");
        fs::write(p, text).expect("write");
    }
}

/// Pins the deploy overlay: before, the stack named by `docker-compose.deploy.yml`
/// merged `docker-compose.override.yml` (the dev file that publishes the port) and
/// read the service as internet-facing; with the base stack left out, the deploy
/// stack alone decides, and it publishes nothing.
#[test]
fn a_deploy_overlay_does_not_load_the_dev_override() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        &[
            ("docker-compose.yml", "services:\n  api:\n    build: ./api\n"),
            (
                "docker-compose.override.yml",
                "services:\n  api:\n    ports: [\"8000:8000\"]\n",
            ),
            (
                "docker-compose.deploy.yml",
                "services:\n  api:\n    restart: always\n",
            ),
            ("api/main.py", "print('api')\n"),
            (
                ".drift/config.yaml",
                "security:\n  not_deployed:\n    - docker-compose.yml\n",
            ),
        ],
    );
    let b = Boundaries::load(r);
    let (exposure, source) = b.of("api/main.py");
    assert_ne!(exposure, Exposure::Public, "{source:?} {:?}", b.rules);
    assert!(
        !source.unwrap_or_default().contains("override"),
        "{source:?}"
    );
}
