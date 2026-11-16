//! Three readings this branch made wrong on real repositories, found by comparing,
//! unit by unit, what the build before the sprint and this one read. Each fixture is
//! modelled on the code it was found in, beside a case that must read as before.
//!
//! - R1 (juice-shop `routes/captcha.ts`, `routes/changePassword.ts`): a check that
//!   answers 401 is no sign-in check when what it tests is what the request sent
//!   (a CAPTCHA answer and the stored answer it must match, an empty new password).
//! - R2 (epic `app/routes/users/$username/index.tsx`): what a query found by a route
//!   parameter is not the request's input handed on; the loader reads input and
//!   nothing validates it.
//! - R3 (NodeGoat `app/routes/session.js`, `app/data/allocations-dao.js`): a route
//!   whose handler is one function a constructor function assigns on `this` reaches
//!   what that function calls, not every method of every object the constructor
//!   builds.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn run(root: &Path, args: &[&str]) -> Value {
    let out = Command::new(&*BIN)
        .arg("--no-cache")
        .args(args)
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

/// `path symbol` of each unit of `concern` -> `known <key>`, `none`, or
/// `unknown <reason>`.
fn readings(root: &Path, concern: &str) -> BTreeMap<String, String> {
    let map = run(root, &["practices", "--json", "--units"]);
    let Some(concern) = map["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == concern)
        .cloned()
    else {
        return BTreeMap::new();
    };
    let variants: Vec<Value> = concern["variants"]
        .as_array()
        .into_iter()
        .flatten()
        .cloned()
        .collect();
    concern["units"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|u| {
            let said = match u["assignment"].as_str().unwrap() {
                "known" => {
                    let key = u["key"]
                        .as_str()
                        .or_else(|| {
                            variants
                                .iter()
                                .find(|v| v["id"] == u["variant"])
                                .and_then(|v| v["key"].as_str())
                        })
                        .unwrap_or_default();
                    format!("known {key}")
                }
                "none" => "none".to_string(),
                _ => format!("unknown {}", u["reason"].as_str().unwrap_or_default()),
            };
            let name = format!(
                "{} {}",
                u["path"].as_str().unwrap_or_default(),
                u["symbol"].as_str().unwrap_or_default()
            );
            (name, said)
        })
        .collect()
}

/// The reading of the one unit whose `path symbol` contains every part.
fn of(units: &BTreeMap<String, String>, parts: &[&str]) -> String {
    units
        .iter()
        .find(|(k, _)| parts.iter().all(|p| k.contains(p)))
        .map(|(_, v)| v.clone())
        .unwrap_or_else(|| panic!("no unit {parts:?} in {units:?}"))
}

fn write(files: &[(&str, &str)]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    for (rel, text) in files {
        let p = dir.path().join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }
    dir
}

const EXPRESS_PACKAGE: &str = r#"{ "name": "shop", "dependencies": { "express": "4.19.2", "sequelize": "6.37.3" } }
"#;

/// juice-shop `models/captcha.ts`, shortened.
const CAPTCHA_MODEL: &str = r#"import { Model } from "sequelize";

export class CaptchaModel extends Model {
  declare captchaId: number;
  declare answer: string;
}
"#;

/// juice-shop `lib/insecurity.ts`'s map of signed-in users, shortened.
const USERS: &str = r#"export const authenticatedUsers: any = {
  tokenMap: {},
  get: function (token?: string) {
    return token ? this.tokenMap[token] : undefined;
  },
};
"#;

/// juice-shop `routes/captcha.ts` `verifyCaptcha`, as written there.
const CAPTCHA: &str = r#"import { type Request, type Response, type NextFunction } from "express";
import { CaptchaModel } from "../models/captcha";

export const verifyCaptcha = () => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const captcha = await CaptchaModel.findOne({ where: { captchaId: req.body.captchaId } });
    if ((captcha != null) && req.body.captcha === captcha.answer) {
      next();
    } else {
      res.status(401).send("Wrong answer to CAPTCHA. Please try again.");
    }
  } catch (error) {
    next(error);
  }
};
"#;

/// juice-shop `routes/changePassword.ts`, shortened: the empty-password checks
/// answer 401 before the token is looked at.
const CHANGE_PASSWORD: &str = r#"import { type Request, type Response, type NextFunction } from "express";
import * as security from "../lib/insecurity";

export function changePassword () {
  return async ({ query, headers, connection }: Request, res: Response, next: NextFunction) => {
    const newPassword = query.new as string;
    const repeatPassword = query.repeat;
    if (!newPassword || newPassword === "undefined") {
      res.status(401).send("Password cannot be empty.");
      return;
    } else if (newPassword !== repeatPassword) {
      res.status(401).send("New and repeated password do not match.");
      return;
    }
    const token = headers.authorization ? headers.authorization.substr("Bearer=".length) : null;
    if (token === null) {
      next(new Error("Blocked illegal activity by " + connection.remoteAddress));
      return;
    }
    const loggedInUser = security.authenticatedUsers.get(token);
    if (!loggedInUser) {
      next(new Error("Blocked illegal activity by " + connection.remoteAddress));
      return;
    }
    res.json({ ok: true });
  };
}
"#;

/// What sign-in readings rest on, read as before: the caller's user on the request,
/// and the credential header the request carries.
const SIGNED_IN: &str = r#"import { type Request, type Response } from "express";

export function whoami () {
  return (req: Request, res: Response) => {
    if (!(req as any).user) {
      res.status(401).send("Not signed in");
      return;
    }
    res.json({ user: (req as any).user });
  };
}

export function bearer () {
  return (req: Request, res: Response) => {
    if (!req.headers.authorization) {
      res.status(401).send("Not signed in");
      return;
    }
    res.json({ ok: true });
  };
}
"#;

/// juice-shop `lib/utils.ts` `asyncHandler`.
const UTILS: &str = r#"import { type Request, type Response, type NextFunction } from "express";

export const asyncHandler = (fn: any) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
"#;

const SERVER: &str = r#"import express from "express";
import * as utils from "./lib/utils";
import { verifyCaptcha } from "./routes/captcha";
import { changePassword } from "./routes/changePassword";
import { whoami, bearer } from "./routes/signedIn";

const app = express();
/* POST allowed in order to provide feedback without being logged in */
app.post("/api/Feedbacks", utils.asyncHandler(verifyCaptcha()));
app.get("/rest/user/change-password", utils.asyncHandler(changePassword()));
app.get("/rest/user/whoami", whoami());
app.get("/rest/bearer", bearer());
app.listen(3000);
"#;

/// Pins R1: juice-shop `POST /api/Feedbacks` (open, by the repository's own
/// comment) read signed in by its CAPTCHA check, and `GET /rest/user/change-password`
/// read signed in by its empty-password check (`body_check:param:query.new`). A
/// check on what the request sent is no sign-in check, nor is one of the stored
/// answer that input is compared with; both units read unknown, never none. `if (!req.user)` and a check of the `Authorization` header
/// read signed in, as before.
#[test]
fn a_401_on_what_the_request_sent_is_no_sign_in_check() {
    let dir = write(&[
        ("package.json", EXPRESS_PACKAGE),
        ("models/captcha.ts", CAPTCHA_MODEL),
        ("lib/insecurity.ts", USERS),
        ("lib/utils.ts", UTILS),
        ("routes/captcha.ts", CAPTCHA),
        ("routes/changePassword.ts", CHANGE_PASSWORD),
        ("routes/signedIn.ts", SIGNED_IN),
        ("server.ts", SERVER),
    ]);
    let authn = readings(dir.path(), "authn");
    let feedback = of(&authn, &["server.ts", "POST /api/Feedbacks"]);
    assert!(feedback.starts_with("unknown"), "{authn:?}");
    // Its token check (`next(new Error(...))`) is not read: unknown, not the
    // empty-password check and never none.
    let change = of(&authn, &["server.ts", "change-password"]);
    assert!(change.starts_with("unknown"), "{authn:?}");
    assert_eq!(
        of(&authn, &["server.ts", "whoami"]),
        "known body_check:param:req.user",
        "{authn:?}"
    );
    assert!(
        of(&authn, &["server.ts", "/rest/bearer"]).starts_with("known body_check:param:req"),
        "{authn:?}"
    );
}

/// A React Router app in framework mode, with the packages epic uses.
const ROUTER_PACKAGE: &str = r#"{ "name": "web", "dependencies": { "react-router": "7.1.0", "@react-router/node": "7.1.0", "@epic-web/invariant": "1.0.0", "@prisma/client": "6.0.0" } }
"#;

const DB: &str = r#"import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
"#;

/// epic `app/routes/users/$username/index.tsx` `loader`, as written there.
const PROFILE: &str = r##"import { invariantResponse } from "@epic-web/invariant";
import { prisma } from "#app/utils/db.server.ts";

export async function loader({ params }: { params: { username: string } }) {
  const user = await prisma.user.findFirst({
    select: { id: true, name: true, username: true, createdAt: true },
    where: { username: params.username },
  });

  invariantResponse(user, "User not found", { status: 404 });

  return { user, userJoinedDisplay: user.createdAt.toLocaleDateString() };
}
"##;

/// epic `app/routes/admin/cache/lru.$cacheKey.ts`: the input itself is handed to
/// the package's call, which may check it.
const CACHE_KEY: &str = r#"import { invariantResponse } from "@epic-web/invariant";

export async function loader({ params }: { params: { cacheKey: string } }) {
  const { cacheKey } = params;
  invariantResponse(cacheKey, "cacheKey is required", { status: 400 });
  return { cacheKey };
}
"#;

const TSCONFIG: &str = r##"{ "compilerOptions": { "paths": { "#app/*": ["./app/*"] } } }
"##;

/// Pins R2: four epic loaders that look a row up by a route parameter and hand
/// the row to `invariantResponse` read unknown ("input handed to a package's
/// call") where "reads input, nothing validates it" was true: the row was taken
/// for the input. A loader that hands the input itself to the call stays unknown.
#[test]
fn a_row_found_by_the_input_is_not_the_input() {
    let dir = write(&[
        ("package.json", ROUTER_PACKAGE),
        ("tsconfig.json", TSCONFIG),
        ("app/utils/db.server.ts", DB),
        ("app/routes/users.$username.tsx", PROFILE),
        ("app/routes/cache.$cacheKey.ts", CACHE_KEY),
    ]);
    let validation = readings(dir.path(), "validation");
    assert_eq!(
        of(&validation, &["users.$username.tsx", "loader"]),
        "none",
        "{validation:?}"
    );
    assert_eq!(
        of(&validation, &["cache.$cacheKey.ts", "loader"]),
        "unknown unclassified",
        "{validation:?}"
    );
}

const NODE_PACKAGE: &str = r#"{ "name": "goat", "dependencies": { "express": "4.19.2", "mongodb": "6.0.0" } }
"#;

/// NodeGoat `app/data/allocations-dao.js`, shortened: a constructor function
/// written as a value, with the NoSQL injection in one of its methods.
const ALLOCATIONS_DAO: &str = r#"const AllocationsDAO = function (db) {
    "use strict";
    const allocationsCol = db.collection("allocations");

    this.update = (userId, stocks, callback) => {
        allocationsCol.update({ userId: parseInt(userId) }, { userId, stocks }, { upsert: true }, callback);
    };

    this.getByUserIdAndThreshold = (userId, threshold, callback) => {
        const searchCriteria = () => {
            if (threshold) {
                return { $where: `this.userId == ${parseInt(userId)} && this.stocks > '${threshold}'` };
            }
            return { userId: parseInt(userId) };
        };
        allocationsCol.find(searchCriteria()).toArray(callback);
    };
};

module.exports = { AllocationsDAO };
"#;

/// NodeGoat `app/routes/session.js`, shortened: it builds the DAO and only calls
/// `update`.
const SESSION: &str = r#"const AllocationsDAO = require("../data/allocations-dao").AllocationsDAO;

function SessionHandler(db) {
    "use strict";
    const allocationsDAO = new AllocationsDAO(db);

    this.displayLoginPage = (req, res, next) => {
        return res.render("login", { userName: "", password: "", loginError: "" });
    };

    this.handleSignup = (req, res, next) => {
        allocationsDAO.update(req.body.userId, 10, (err) => {
            if (err) return next(err);
            return res.redirect("/dashboard");
        });
    };
}

module.exports = SessionHandler;
"#;

/// NodeGoat `app/routes/allocations.js`: the route that does reach the injection.
const ALLOCATIONS: &str = r#"const AllocationsDAO = require("../data/allocations-dao").AllocationsDAO;

function AllocationsHandler(db) {
    "use strict";
    const allocationsDAO = new AllocationsDAO(db);

    this.displayAllocations = (req, res, next) => {
        const { userId } = req.params;
        const { threshold } = req.query;
        allocationsDAO.getByUserIdAndThreshold(userId, threshold, (err, allocations) => {
            if (err) return next(err);
            return res.render("allocations", { userId, allocations });
        });
    };
}

module.exports = AllocationsHandler;
"#;

/// NodeGoat `app/routes/index.js`, shortened.
const INDEX: &str = r#"const SessionHandler = require("./session");
const AllocationsHandler = require("./allocations");

const index = (app, db) => {
    "use strict";
    const sessionHandler = new SessionHandler(db);
    const allocationsHandler = new AllocationsHandler(db);

    app.get("/login", sessionHandler.displayLoginPage);
    app.post("/signup", sessionHandler.handleSignup);
    app.get("/allocations/:userId", allocationsHandler.displayAllocations);
};

module.exports = index;
"#;

const NODE_SERVER: &str = r#"const express = require("express");
const { MongoClient } = require("mongodb");
const routes = require("./app/routes");

MongoClient.connect(process.env.MONGODB_URI, (err, db) => {
    const app = express();
    routes(app, db);
    app.listen(4000);
});
"#;

/// The sink kinds each entry point reaches, by `METHOD route`.
fn reaches(root: &Path) -> BTreeMap<String, Vec<String>> {
    let inv = run(root, &["security", "--json"]);
    inv["entry_points"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            let name = format!(
                "{} {}",
                e["method"].as_str().unwrap_or_default(),
                e["route"].as_str().unwrap_or_default()
            );
            let kinds = e["reaches"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|r| r["kind"].as_str().unwrap_or_default().to_string())
                .collect();
            (name, kinds)
        })
        .collect()
}

/// Pins R3: NodeGoat's login, signup and logout routes read as reaching the NoSQL
/// injection in `AllocationsDAO.getByUserIdAndThreshold`, through the session
/// handler's constructor, which builds the DAO and calls only `update`. A route
/// whose handler is one function the constructor assigns on `this` reaches what
/// that function calls; the allocations route, which calls the method with the
/// injection, still reaches it.
#[test]
fn a_method_of_a_constructor_function_reaches_what_it_calls() {
    let dir = write(&[
        ("package.json", NODE_PACKAGE),
        ("app/data/allocations-dao.js", ALLOCATIONS_DAO),
        ("app/routes/session.js", SESSION),
        ("app/routes/allocations.js", ALLOCATIONS),
        ("app/routes/index.js", INDEX),
        ("server.js", NODE_SERVER),
    ]);
    let reached = reaches(dir.path());
    let of = |route: &str| -> &Vec<String> {
        reached
            .get(route)
            .unwrap_or_else(|| panic!("no entry point {route} in {reached:?}"))
    };
    assert!(
        !of("GET /login").iter().any(|k| k == "nosql_injection"),
        "{reached:?}"
    );
    assert!(
        !of("POST /signup").iter().any(|k| k == "nosql_injection"),
        "{reached:?}"
    );
    assert!(
        of("GET /allocations/:userId")
            .iter()
            .any(|k| k == "nosql_injection"),
        "{reached:?}"
    );
}
