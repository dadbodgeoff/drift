//! Config, secrets and feature flags (PLAN-R13 §1.7). Population: symbols that read
//! the environment (`reads`), call an env-schema or config library, or call a
//! feature-flag SDK.
//!
//! Uses:
//! - `config_module:<file>`: the read is in the repo's config module, a file whose
//!   symbols read at least [`CONFIG_MODULE_READS`] env names and that at least
//!   [`CONFIG_MODULE_IMPORTERS`] files import;
//! - `in_place:<form>`: a read where the value is used (`process.env`,
//!   `import.meta.env`, `os.environ`);
//! - `env_schema:<library>`: t3-env `createEnv`, envalid, `@nestjs/config`, convict,
//!   pydantic-settings `BaseSettings`, Django settings, dynaconf, decouple, environs,
//!   dotenv;
//! - `flag_sdk:<library>` (LaunchDarkly, Unleash, GrowthBook, PostHog flags, ...) and
//!   `env_flag:<form>` (an env read named like a switch: `FEATURE_X`, `ENABLE_Y`);
//! - `secret_client:<form>`: a secret-named read (`*_SECRET`, `*_KEY`, `*_TOKEN`) in a
//!   `"use client"` file, outside a server-only branch.
//!
//! The population is what a read or a call proves, so every unit is known; a file
//! that did not parse is unknown. There is no `none`.

use std::collections::BTreeSet;

use drift_core::{FileFacts, Symbol, WrapKind};

use super::common::{self, unknown, use_of};
use super::libraries::{config_library, flag_env, flag_library, secret_env};
use super::{Assignment, Concern, Cx, UnitRef, UnknownReason, Use, VariantSource};

pub struct Config;

/// Distinct env names a file's symbols read for it to be a config module.
pub const CONFIG_MODULE_READS: usize = 3;
/// Files that import a file for it to be a config module.
pub const CONFIG_MODULE_IMPORTERS: usize = 3;

fn libraries(s: &Symbol) -> impl Iterator<Item = &String> {
    s.calls.iter().chain(
        s.wraps
            .iter()
            .filter(|w| w.kind == WrapKind::Extends)
            .map(|w| &w.wrapper),
    )
}

fn in_population(s: &Symbol) -> bool {
    !s.reads.is_empty()
        || libraries(s).any(|c| config_library(c).is_some() || flag_library(c).is_some())
}

/// `process.env.X` -> (`process.env`, `X`).
fn split_read(r: &str) -> (&str, &str) {
    r.rsplit_once('.').unwrap_or(("env", r))
}

/// The file is the repo's config module.
pub fn config_module(cx: &Cx<'_>, file: &FileFacts) -> bool {
    let names: BTreeSet<&str> = file
        .symbols
        .iter()
        .flat_map(|s| s.reads.iter().map(|r| split_read(r).1))
        .collect();
    names.len() >= CONFIG_MODULE_READS
        && cx
            .facts
            .files
            .iter()
            .filter(|f| f.imports.iter().any(|i| i.module == file.path))
            .count()
            >= CONFIG_MODULE_IMPORTERS
}

impl Concern for Config {
    fn id(&self) -> &'static str {
        super::CONFIG
    }

    fn unit(&self) -> &'static str {
        "symbol"
    }

    fn population<'a>(&self, cx: &Cx<'a>) -> Vec<UnitRef<'a>> {
        let mut out = Vec::new();
        for file in &cx.facts.files {
            for symbol in file.symbols.iter().filter(|s| in_population(s)) {
                out.push(UnitRef::Symbol { file, symbol });
            }
        }
        out
    }

    fn assign<'a>(&self, cx: &Cx<'a>, unit: &UnitRef<'a>) -> Assignment {
        let UnitRef::Symbol { file, symbol } = *unit else {
            return unknown(UnknownReason::NoSymbol, "");
        };
        if !file.parse_ok {
            return unknown(UnknownReason::Unparsed, &file.path);
        }
        let mut uses: Vec<Use> = Vec::new();
        if !symbol.reads.is_empty() {
            if config_module(cx, file) {
                uses.push(use_of("config_module", &file.path));
            } else {
                for r in &symbol.reads {
                    uses.push(use_of("in_place", split_read(r).0));
                }
            }
        }
        let client = file.directives.iter().any(|d| d == "use client");
        for r in &symbol.reads {
            let (form, name) = split_read(r);
            if flag_env(name) {
                uses.push(use_of("env_flag", form));
            }
            if client && secret_env(name) && !symbol.server_reads.contains(r) {
                uses.push(use_of("secret_client", form));
            }
        }
        for c in libraries(symbol) {
            if let Some(l) = config_library(c) {
                uses.push(use_of("env_schema", &l));
            }
            if let Some(l) = flag_library(c) {
                uses.push(use_of("flag_sdk", &l));
            }
        }
        let source = if uses.iter().any(|u| u.mechanism == "config_module") {
            VariantSource::Usage
        } else {
            VariantSource::Vocab
        };
        common::known(uses, source)
    }
}

#[cfg(test)]
mod tests {
    use super::super::common::fixtures;
    use super::super::common::testkit::{assign_all, empty, key, of};
    use super::*;

    #[test]
    fn module_in_place_schema_flags() {
        let d = empty();
        let facts = fixtures::ts_cases();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Config, &cx);
        assert_eq!(
            key(&of(&all, "lib/env.ts", "env")),
            "config_module:lib/env.ts"
        );
        assert_eq!(
            key(&of(&all, "app/api/open/route.ts", "GET")),
            "env_flag:process.env+in_place:process.env"
        );
        assert_eq!(
            key(&of(&all, "lib/flags.ts", "growthbook")),
            "flag_sdk:@growthbook/growthbook"
        );
        assert_eq!(
            key(&of(&all, "lib/env2.ts", "env")),
            "env_schema:@t3-oss/env-nextjs"
        );
        assert_eq!(
            key(&of(&all, "components/pay.tsx", "Pay")),
            "in_place:process.env+secret_client:process.env"
        );
        let facts = fixtures::py_cases();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Config, &cx);
        assert_eq!(
            key(&of(&all, "svc/app/settings.py", "Settings")),
            "env_schema:pydantic_settings"
        );
        assert_eq!(
            key(&of(&all, "svc/app/db.py", "engine")),
            "in_place:os.environ"
        );
        assert_eq!(
            of(&all, "svc/app/broken.py", "helper"),
            unknown(UnknownReason::Unparsed, "svc/app/broken.py")
        );
    }
}
