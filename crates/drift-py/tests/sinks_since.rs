//! Risky operations read since the measured build (Python lowering 69): a file at a
//! path built from a part that is no constant, template text that is not written
//! out, a MongoDB `$where` built from a part that is no literal, an XML parser set
//! to resolve external entities, a signing key written in the code, a server
//! started in debug mode and a request that does not verify the certificate. They
//! are in the reading `drift security` takes (`RepoFacts::listed`); what mining
//! reads is what the measured build read.

use std::path::Path;

use drift_core::RepoFacts;
use drift_py::{ScanOptions, scan};

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn sinks(repo: &RepoFacts, symbol: &str) -> Vec<String> {
    let f = repo.files.iter().find(|f| f.path == "app/ops.py").unwrap();
    f.symbols
        .iter()
        .find(|s| s.name == symbol)
        .unwrap_or_else(|| panic!("{symbol}"))
        .sinks
        .clone()
}

const OPS: &str = r#"import os

import jwt
import requests
from flask import Flask, render_template_string, send_file
from lxml import etree

app = Flask(__name__)
UPLOADS = "/srv/uploads"


def joined(name):
    with open(os.path.join(UPLOADS, name)) as f:
        return f.read()


def formatted(name):
    return send_file(f"/srv/uploads/{name}")


def beside_the_code():
    with open(os.path.join(os.path.dirname(__file__), "schema.sql")) as f:
        return f.read()


def plain_name(path):
    with open(path) as f:
        return f.read()


def rendered(body):
    return render_template_string(body)


def rendered_literal():
    return render_template_string("<p>hello</p>")


def where(users, owner):
    return users.find({"$where": f"this.owner == '{owner}'"})


def parsed(data):
    return etree.fromstring(data, etree.XMLParser(resolve_entities=True))


def parsed_safely(data):
    return etree.fromstring(data, etree.XMLParser(resolve_entities=False))


def signed(payload):
    return jwt.encode(payload, "not-a-real-key", algorithm="HS256")


def signed_from_env(payload):
    return jwt.encode(payload, os.environ["JWT_KEY"], algorithm="HS256")


def keyed():
    app.secret_key = "not-a-real-key"


def unverified(url):
    return requests.get(url, verify=False)


def assigned(User, request):
    return User(**request.json)


def served():
    app.run(host="0.0.0.0", debug=True)
"#;

fn repo() -> RepoFacts {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "requirements.txt", "flask\n");
    write(r, "app/__init__.py", "");
    write(r, "app/ops.py", OPS);
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

#[test]
fn the_operations_read_since_are_in_the_listed_reading() {
    let r = repo();
    let listed = r.listed();
    for (symbol, want) in [
        ("joined", "path_traversal"),
        ("formatted", "path_traversal"),
        ("rendered", "template_injection"),
        ("where", "nosql_injection"),
        ("parsed", "xml_external_entities"),
        ("signed", "hardcoded_secret"),
        ("keyed", "hardcoded_secret"),
        ("unverified", "tls_verify_disabled"),
        ("served", "debug_enabled"),
        ("assigned", "mass_assignment"),
    ] {
        assert!(
            sinks(&listed, symbol).iter().any(|k| k == want),
            "{symbol}: {:?}",
            sinks(&listed, symbol)
        );
    }
    for symbol in [
        "beside_the_code",
        "plain_name",
        "rendered_literal",
        "parsed_safely",
        "signed_from_env",
    ] {
        assert!(
            sinks(&listed, symbol).is_empty(),
            "{symbol}: {:?}",
            sinks(&listed, symbol)
        );
    }
}

#[test]
fn mining_reads_none_of_them() {
    let r = repo();
    for symbol in [
        "joined",
        "formatted",
        "rendered",
        "where",
        "parsed",
        "signed",
        "keyed",
        "served",
    ] {
        assert!(
            sinks(&r, symbol).is_empty(),
            "{symbol}: {:?}",
            sinks(&r, symbol)
        );
    }
}
