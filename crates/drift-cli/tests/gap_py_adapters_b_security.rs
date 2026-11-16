//! `drift security --json` lists the Python servers and queues of
//! `drift_py::lower::servers` with their kinds and guards: a Tornado verb behind
//! `@tornado.web.authenticated` is guarded and the one beside it is not, a Django
//! management command is a local `cli` entry, and Huey tasks are `job` and `cron`.

use std::path::Path;
use std::process::Command;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn security(root: &Path) -> Value {
    let out = Command::new(&*BIN)
        .args(["--no-cache", "security", "--json"])
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    serde_json::from_slice(&out.stdout).unwrap()
}

/// `kind METHOD route symbol | guards | local`, for every entry point, sorted.
fn rows(v: &Value) -> Vec<String> {
    let strs = |x: &Value| -> String {
        x.as_array()
            .into_iter()
            .flatten()
            .map(|g| {
                g.as_str()
                    .map(str::to_string)
                    .unwrap_or_else(|| g.to_string())
            })
            .collect::<Vec<_>>()
            .join(", ")
    };
    let mut out: Vec<String> = v["entry_points"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|e| {
            format!(
                "{} {} {} {} | guards [{}] | {}",
                e["kind"].as_str().unwrap_or("-"),
                e["method"].as_str().unwrap_or("-"),
                e["route"].as_str().unwrap_or("-"),
                e["symbol"].as_str().unwrap_or("-"),
                strs(&e["guards"]),
                if e["local"].as_bool() == Some(true) {
                    "local"
                } else {
                    "remote"
                }
            )
        })
        .collect();
    out.sort();
    out
}

#[test]
fn python_servers_and_queues_are_listed_with_guards_and_kinds() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"fx\"\n");
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/handlers.py",
        "import tornado.web\n\n\nclass ProfileHandler(tornado.web.RequestHandler):\n    def get_current_user(self):\n        return self.get_secure_cookie(\"user\")\n\n    @tornado.web.authenticated\n    def get(self, user_id):\n        self.write({})\n\n    def post(self, user_id):\n        self.write({})\n",
    );
    write(
        r,
        "app/web.py",
        "import tornado.web\n\nfrom app.handlers import ProfileHandler\n\n\ndef make_app():\n    return tornado.web.Application([(r\"/users/([0-9]+)\", ProfileHandler)])\n",
    );
    write(r, "app/management/__init__.py", "");
    write(r, "app/management/commands/__init__.py", "");
    write(
        r,
        "app/management/commands/purge.py",
        "from django.core.management.base import BaseCommand\n\n\nclass Command(BaseCommand):\n    def handle(self, *args, **options):\n        return None\n",
    );
    write(
        r,
        "app/tasks.py",
        "from huey import RedisHuey, crontab\n\nhuey = RedisHuey(\"fx\")\n\n\n@huey.task()\ndef send_mail(to):\n    return to\n\n\n@huey.periodic_task(crontab(minute=\"0\", hour=\"3\"))\ndef nightly():\n    return None\n",
    );
    assert_eq!(
        rows(&security(r)),
        [
            "cli - purge Command.handle | guards [] | local",
            "cron - - nightly | guards [] | remote",
            "http GET /users/([0-9]+) ProfileHandler.get | guards [web.authenticated] | remote",
            "http POST /users/([0-9]+) ProfileHandler.post | guards [] | remote",
            "job - - nightly | guards [] | remote",
            "job - - send_mail | guards [] | remote",
        ]
    );
}
