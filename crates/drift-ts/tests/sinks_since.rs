//! Risky operations read since the measured build (TypeScript lowering 76): a file
//! at a path built from a part that is no constant, template text that is not
//! written out, a MongoDB `$where` built from a part that is no constant, Angular's
//! `bypassSecurityTrust*`, a signing secret written in the code, and TLS that does
//! not verify the certificate. They are in the reading `drift security` takes
//! ([`drift_core::Listed`]); what mining reads is what the measured build read.

use std::fs;
use std::path::Path;

use drift_core::RepoFacts;
use drift_ts::{ScanOptions, scan};

fn repo(files: &[(&str, &str)]) -> RepoFacts {
    let dir = tempfile::tempdir().expect("tempdir");
    for (path, text) in files {
        let p = dir.path().join(path);
        fs::create_dir_all(p.parent().unwrap_or(Path::new("."))).expect("mkdir");
        fs::write(p, text).expect("write");
    }
    scan(
        dir.path(),
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .expect("scan")
    .0
}

fn sinks(r: &RepoFacts, symbol: &str) -> Vec<String> {
    r.files
        .iter()
        .find(|f| f.path == "src/ops.ts")
        .expect("src/ops.ts scanned")
        .symbols
        .iter()
        .find(|s| s.name == symbol)
        .unwrap_or_else(|| panic!("no symbol {symbol}"))
        .sinks
        .clone()
}

const PACKAGE: &str = "{ \"name\": \"api\", \"dependencies\": { \"express\": \"4.19.0\" } }\n";

const OPS: &str = r#"import fs from "fs";
import { readFile } from "fs/promises";
import path from "path";
import ejs from "ejs";
import jwt from "jsonwebtoken";
import session from "express-session";
import https from "https";

declare const users: any;
declare const sanitizer: any;
const UPLOADS = "/srv/uploads";

export function joined(name: string) {
  return fs.readFileSync(path.join(UPLOADS, name));
}

export function templated(name: string) {
  return fs.createReadStream(`/srv/uploads/${name}`);
}

export async function promised(dir: string, name: string) {
  return readFile(path.resolve(dir, name));
}

export function sent(res: any, name: string) {
  res.sendFile(path.join(__dirname, "files", name));
}

export function fixedPath() {
  return fs.readFileSync(path.join(__dirname, "..", "package.json"));
}

export function plainName(file: string) {
  return fs.readFileSync(file);
}

export function rendered(body: string) {
  return ejs.render(body, {});
}

export function renderedLiteral() {
  return ejs.render("<p>hello</p>", {});
}

export function where(owner: string) {
  return users.find({ $where: `this.owner == '${owner}'` });
}

export function whereLiteral() {
  return users.find({ $where: "this.active == true" });
}

export function trusted(html: string) {
  return sanitizer.bypassSecurityTrustHtml(html);
}

export function signed(payload: object) {
  return jwt.sign(payload, "not-a-real-key");
}

export function signedFromEnv(payload: object) {
  return jwt.sign(payload, process.env.JWT_KEY as string);
}

export const sessions = session({ secret: "kekse", resave: false });

export function unverified(url: string) {
  return https.request(url, { rejectUnauthorized: false });
}
"#;

#[test]
fn the_operations_read_since_are_in_the_listed_reading() {
    let r = repo(&[("package.json", PACKAGE), ("src/ops.ts", OPS)]);
    let listed = r.listed();
    for (symbol, want) in [
        ("joined", "path_traversal"),
        ("templated", "path_traversal"),
        ("promised", "path_traversal"),
        ("sent", "path_traversal"),
        ("rendered", "template_injection"),
        ("where", "nosql_injection"),
        ("trusted", "raw_html"),
        ("signed", "hardcoded_secret"),
        ("sessions", "hardcoded_secret"),
        ("unverified", "tls_verify_disabled"),
    ] {
        assert!(
            sinks(&listed, symbol).iter().any(|k| k == want),
            "{symbol}: {:?}",
            sinks(&listed, symbol)
        );
    }
    for symbol in [
        "fixedPath",
        "plainName",
        "renderedLiteral",
        "whereLiteral",
        "signedFromEnv",
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
    let r = repo(&[("package.json", PACKAGE), ("src/ops.ts", OPS)]);
    for symbol in [
        "joined",
        "templated",
        "promised",
        "sent",
        "rendered",
        "where",
        "trusted",
        "signed",
        "sessions",
    ] {
        assert!(
            sinks(&r, symbol).is_empty(),
            "{symbol}: {:?}",
            sinks(&r, symbol)
        );
    }
}
