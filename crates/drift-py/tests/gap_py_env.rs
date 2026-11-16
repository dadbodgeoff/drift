//! Env reads through a configuration library (Python lowering 75): python-decouple,
//! environs, django-environ and pydantic settings classes, each keyed on the
//! library's package and documented API, beside a twin that is not an env read. They
//! are in the reading `drift security` and the practice map take
//! (`RepoFacts::listed`); what mining reads is what the measured build read, so the
//! mining copy has none of them.

use std::path::Path;

use drift_core::RepoFacts;
use drift_py::{ScanOptions, scan};

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn reads(repo: &RepoFacts, path: &str, symbol: &str) -> Vec<String> {
    let f = repo
        .files
        .iter()
        .find(|f| f.path == path)
        .unwrap_or_else(|| panic!("{path} not scanned"));
    f.symbols
        .iter()
        .find(|s| s.name == symbol)
        .map(|s| s.reads.clone())
        .unwrap_or_default()
}

const DECOUPLE: &str = r#"from decouple import config

SECRET_KEY = config("SECRET_KEY", default="dev-only")
DEBUG = config("DEBUG", default=False, cast=bool)
WEBHOOK_TOKEN = config("WEBHOOK_TOKEN")
NAME = "MAIL_HOST"
MAIL_HOST = config(NAME)


def db_url():
    return config("DATABASE_URL", default="sqlite://")


def by_name(name):
    return config(name)
"#;

const DECOUPLE_MODULE: &str = r#"import decouple
from decouple import AutoConfig, Config, RepositoryEnv

config = AutoConfig(search_path=".")
repo = Config(RepositoryEnv(".env"))

REDIS = decouple.config("REDIS_URL")
BROKER = config("BROKER_URL")
CACHE = repo("CACHE_URL")
"#;

/// A function of the repository named `config`: not decouple's.
const NOT_DECOUPLE: &str = r#"def config(name):
    return {"a": 1}.get(name)


VALUE = config("NOT_AN_ENV_READ")
"#;

const ENVIRONS: &str = r#"from environs import Env

env = Env()
env.read_env()
API_TOKEN = env("API_TOKEN")
PORT = env.int("PORT", 8000)
HOSTS = env.list("ALLOWED_HOSTS", [])
DUMPED = env.dump()

PREFIX = compute()


def prefixed():
    with env.prefixed("APP_"):
        name = env.str("NAME")
        with env.prefixed("DB_"):
            host = env("HOST")
    return name, host


def hidden():
    with env.prefixed(PREFIX):
        return env("HIDDEN")


def redis():
    return env.str("REDIS_URL")


class Other:
    def int(self, name):
        return 1


other = Other()
NOT_ENV = other.int("NOT_AN_ENV_READ")
"#;

const DJANGO_ENVIRON: &str = r#"import environ

env = environ.Env(DEBUG=(bool, False))
environ.Env.read_env()
SECRET_KEY = env("DJANGO_SECRET_KEY")
DEBUG = env.bool("DEBUG")
DATABASES = {"default": env.db("DATABASE_URL")}
CACHES = {"default": env.cache()}
"#;

/// django-environ's `env.prefix` set: which reads it is in front of is not followed.
const DJANGO_ENVIRON_PREFIX: &str = r#"import environ

env = environ.Env()
env.prefix = "DJANGO_"
SECRET_KEY = env("SECRET_KEY")
"#;

const SETTINGS: &str = r#"from typing import ClassVar

from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="APP_", env_file=".env")

    database_url: str
    debug: bool = False
    secret_key: str = Field(alias="THE_SECRET")
    _cache: dict = {}
    VERSION: ClassVar[str] = "1"


class Plain(BaseSettings):
    redis_url: str = "redis://"


class Exact(BaseSettings, case_sensitive=True):
    mixedCase: str


PREFIX = compute()


class Unread(BaseSettings):
    model_config = SettingsConfigDict(env_prefix=PREFIX)

    token: str


class NotSettings(BaseModel):
    database_url: str
"#;

const SETTINGS_V1: &str = r#"from pydantic import BaseSettings, Field


class Settings(BaseSettings):
    api_key: str
    token: str = Field(..., env="TOKEN_V1")

    class Config:
        env_prefix = "V1_"
"#;

const HOOK: &str = r#"from flask import Flask, abort, request

from app.dec import WEBHOOK_TOKEN

app = Flask(__name__)


@app.post("/hook")
def hook():
    if request.headers.get("X-Token") != WEBHOOK_TOKEN:
        abort(401)
    return "ok"
"#;

fn repo() -> RepoFacts {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "requirements.txt",
        "flask\npython-decouple\nenvirons\ndjango-environ\npydantic-settings\n",
    );
    write(r, "app/__init__.py", "");
    write(r, "app/dec.py", DECOUPLE);
    write(r, "app/dec_module.py", DECOUPLE_MODULE);
    write(r, "app/not_decouple.py", NOT_DECOUPLE);
    write(r, "app/envs.py", ENVIRONS);
    write(r, "app/dj.py", DJANGO_ENVIRON);
    write(r, "app/dj_prefix.py", DJANGO_ENVIRON_PREFIX);
    write(r, "app/settings.py", SETTINGS);
    write(r, "app/settings_v1.py", SETTINGS_V1);
    write(r, "app/hook.py", HOOK);
    scan(
        r,
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .unwrap()
    .0
}

/// Every form, read in the listed reading: (file, symbol, the reads it has).
const LISTED: &[(&str, &str, &[&str])] = &[
    // python-decouple: `config(...)`, its name through a module constant, in a
    // function, through the module, and through `AutoConfig` and `Config` instances.
    ("app/dec.py", "SECRET_KEY", &["decouple.SECRET_KEY"]),
    ("app/dec.py", "DEBUG", &["decouple.DEBUG"]),
    ("app/dec.py", "MAIL_HOST", &["decouple.MAIL_HOST"]),
    ("app/dec.py", "db_url", &["decouple.DATABASE_URL"]),
    ("app/dec_module.py", "REDIS", &["decouple.REDIS_URL"]),
    ("app/dec_module.py", "BROKER", &["decouple.BROKER_URL"]),
    ("app/dec_module.py", "CACHE", &["decouple.CACHE_URL"]),
    // environs: a call of the reader, typed methods, prefixed blocks, nested.
    ("app/envs.py", "API_TOKEN", &["environs.API_TOKEN"]),
    ("app/envs.py", "PORT", &["environs.PORT"]),
    ("app/envs.py", "HOSTS", &["environs.ALLOWED_HOSTS"]),
    (
        "app/envs.py",
        "prefixed",
        &["environs.APP_DB_HOST", "environs.APP_NAME"],
    ),
    ("app/envs.py", "redis", &["environs.REDIS_URL"]),
    // django-environ.
    ("app/dj.py", "SECRET_KEY", &["environ.DJANGO_SECRET_KEY"]),
    ("app/dj.py", "DEBUG", &["environ.DEBUG"]),
    ("app/dj.py", "DATABASES", &["environ.DATABASE_URL"]),
    // pydantic-settings: the prefix, the alias without it, upper-cased; a class
    // without configuration; one that is case-sensitive.
    (
        "app/settings.py",
        "Settings",
        &[
            "pydantic_settings.APP_DATABASE_URL",
            "pydantic_settings.APP_DEBUG",
            "pydantic_settings.THE_SECRET",
        ],
    ),
    ("app/settings.py", "Plain", &["pydantic_settings.REDIS_URL"]),
    ("app/settings.py", "Exact", &["pydantic_settings.mixedCase"]),
    // pydantic 1: the inner `class Config`, and `Field(env=...)`.
    (
        "app/settings_v1.py",
        "Settings",
        &["pydantic.TOKEN_V1", "pydantic.V1_API_KEY"],
    ),
];

/// The twins: no env read is recorded. A name or a prefix that is not a literal, a
/// method of the reader that reads nothing, a repository function or object of the
/// same shape, and a model that is not a settings class.
const NOT_READ: &[(&str, &str)] = &[
    ("app/dec.py", "by_name"),
    ("app/not_decouple.py", "VALUE"),
    ("app/envs.py", "(module)"),
    ("app/envs.py", "DUMPED"),
    ("app/envs.py", "hidden"),
    ("app/envs.py", "NOT_ENV"),
    ("app/dj.py", "CACHES"),
    ("app/dj_prefix.py", "SECRET_KEY"),
    ("app/settings.py", "Unread"),
    ("app/settings.py", "NotSettings"),
];

#[test]
fn each_library_form_is_an_env_read_in_the_listed_reading() {
    let r = repo();
    let listed = r.listed();
    for (path, symbol, want) in LISTED {
        assert_eq!(
            reads(&listed, path, symbol),
            want.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
            "{path} {symbol}"
        );
    }
    for (path, symbol) in NOT_READ {
        assert!(
            reads(&listed, path, symbol).is_empty(),
            "{path} {symbol}: {:?}",
            reads(&listed, path, symbol)
        );
    }
}

#[test]
fn mining_reads_none_of_them() {
    let r = repo();
    for (path, symbol, _) in LISTED {
        assert!(
            reads(&r, path, symbol).is_empty(),
            "{path} {symbol}: {:?}",
            reads(&r, path, symbol)
        );
    }
}

/// A token compared with a module constant read through decouple is compared with a
/// value from the environment, as one read from `os.environ` is: in the listed
/// reading only.
#[test]
fn a_constant_read_through_a_library_is_env_derived_when_compared() {
    let r = repo();
    let compares = |repo: &RepoFacts| -> Vec<String> {
        let f = repo.files.iter().find(|f| f.path == "app/hook.py").unwrap();
        f.symbols
            .iter()
            .find(|s| s.name == "hook")
            .unwrap()
            .body_checks
            .iter()
            .map(|b| b.compares.clone())
            .collect()
    };
    assert!(
        compares(&r.listed()).iter().any(|c| c == "env"),
        "{:?}",
        compares(&r.listed())
    );
    assert!(
        !compares(&r).iter().any(|c| c == "env"),
        "{:?}",
        compares(&r)
    );
}

/// A secret read through a library with a literal default is not a secret written in
/// the code, as `os.environ.get("X", "literal")` is not.
#[test]
fn a_literal_default_is_not_a_hardcoded_secret() {
    let r = repo();
    let listed = r.listed();
    let f = listed
        .files
        .iter()
        .find(|f| f.path == "app/dec.py")
        .unwrap();
    assert!(
        f.symbols
            .iter()
            .all(|s| !s.sinks.iter().any(|k| k == "hardcoded_secret")),
        "{:?}",
        f.symbols
            .iter()
            .map(|s| (&s.name, &s.sinks))
            .collect::<Vec<_>>()
    );
}
