use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use crate::next_routes::next_api_route_identity;
use crate::vocabulary::{FactKind, FileRole, RouteFlavor};
use tree_sitter::{Node, Parser};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fact {
    pub kind: FactKind,
    pub file_path: String,
    pub name: String,
    pub value: Option<String>,
    pub imported_name: Option<String>,
    /// S1-05: how (if at all) this import's runtime use is proven.
    /// `Some(RUNTIME_USE_VALUE_POSITION)` - the local binding appears in a value position
    /// (T12's identifier-usage partition). `Some(RUNTIME_USE_DYNAMIC)` - the import is
    /// runtime by construction (`require()` / dynamic `import()`), for which no type-only
    /// reading exists. `None` - no runtime use provable; downstream stays conservative.
    pub runtime_use: Option<String>,
    pub start_line: usize,
    pub end_line: usize,
    /// EW-6 (DET-1): 1-based column, which is what makes two occurrences on one line two facts.
    ///
    /// Without it, `db.query(); db.query();` on a single line produced byte-identical facts, and
    /// the CLI's fact id - derived from (scan, file, kind, name, value, line) - collapsed them into
    /// one stored row. The full-scan path counted the engine's emissions and the incremental path
    /// counted rows, so the two disagreed; the deeper problem was that the second occurrence was
    /// genuinely lost rather than merely miscounted.
    ///
    /// A column rather than an occurrence ordinal, because a column is true independently of
    /// emission order and improves the evidence a finding carries. 1-based to match `start_line`
    /// and to match what an editor shows.
    pub start_column: usize,
    pub end_column: usize,
}

/// Runtime use proven because the binding appears in a value position.
pub const RUNTIME_USE_VALUE_POSITION: &str = "value_position";
/// Runtime use proven by construction: `require()` and dynamic `import()` always execute.
pub const RUNTIME_USE_DYNAMIC: &str = "dynamic";
/// S10. Runtime use proven by construction for a *bindingless* import declaration
/// (`import "@acme/db";`). Executing the module for its side effects is the only thing such
/// an import does, so it is a runtime dependency by definition - there is no type-only
/// reading of it, and nothing for member-level symbol resolution to say about it.
pub const RUNTIME_USE_SIDE_EFFECT: &str = "side_effect";

/// S10. The local name recorded for a side-effect import, which binds nothing.
///
/// Deliberately not a legal JavaScript identifier: this name flows into the import node's
/// `local_name` metadata and into binding-keyed lookups (call-site receivers, data-access
/// binding roots), and it must never collide with a real binding in any of them.
pub const SIDE_EFFECT_IMPORT_BINDING: &str = "(side-effect)";

/// F5, S6-01. The `name` of a `secret_source_read` fact: which source the read came from.
///
/// These are the three strings a phase-5 contract's `secret_sources` list is written in, so the
/// walk names the source in the contract's own words and `security_facts.rs` can gate on it by
/// equality rather than by re-deciding the shape.
pub const SECRET_SOURCE_ENV: &str = "env";
pub const SECRET_SOURCE_CONFIG: &str = "config";
pub const SECRET_SOURCE_SECRET_MANAGER: &str = "secret_manager";

struct ImportBinding {
    imported_name: String,
    local_name: String,
}

#[derive(Debug)]
pub enum FactExtractError {
    ParserLanguage(tree_sitter::LanguageError),
    ParseFailed,
    /// The AST nests deeper than the fact walkers can descend without overflowing the stack.
    TooDeep {
        depth_limit: usize,
    },
}

impl std::fmt::Display for FactExtractError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FactExtractError::ParserLanguage(error) => {
                write!(formatter, "parser language error: {error}")
            }
            FactExtractError::ParseFailed => write!(formatter, "failed to parse TypeScript source"),
            FactExtractError::TooDeep { depth_limit } => write!(
                formatter,
                "AST nests deeper than {depth_limit} levels, which the fact walkers cannot descend without overflowing the stack (typically a minified or generated bundle)"
            ),
        }
    }
}

impl std::error::Error for FactExtractError {}

/// D-PA1: what the parse actually managed, measured rather than assumed.
///
/// Before this existed, NO code path in the crate inspected `tree.root_node().has_error()` - an
/// exhaustive grep for `has_error|is_error|ERROR|is_missing` across crates/drift-engine/src
/// returned exactly one hit, and it was a comment. So foreign content under a TypeScript-family
/// extension produced confident facts with `indexed: true` and not one diagnostic: Python yielded
/// 3 `symbol_called`, Go an `ImportUsed` plus 3 `SymbolCalled`, a README saved as `.ts` a
/// `SymbolCalled` with an empty name. Only `.prisma` was guarded, and only by never being parsed.
///
/// That silence is the product's own stated worst case - a guardrail that reports success when it
/// could not check. Carried on this struct so the caller can say so.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseReport {
    /// Which grammar produced the tree the facts came from. Not always derivable from the
    /// extension: see `parse_with_best_grammar`.
    pub grammar: &'static str,
    /// Nodes tree-sitter could not fit into the grammar (ERROR) or had to invent (MISSING).
    pub error_nodes: usize,
    /// Bytes of the source covered by those nodes.
    pub error_bytes: usize,
    pub source_bytes: usize,
}

impl ParseReport {
    pub fn is_clean(&self) -> bool {
        self.error_nodes == 0
    }

    /// The share of the file the grammar could not read, 0.0 to 1.0.
    pub fn damage_ratio(&self) -> f64 {
        if self.source_bytes == 0 {
            return 0.0;
        }
        (self.error_bytes as f64 / self.source_bytes as f64).min(1.0)
    }
}

pub fn extract_typescript_facts(
    file_path: impl AsRef<Path>,
    source: &str,
) -> Result<Vec<Fact>, FactExtractError> {
    extract_typescript_facts_with_report(file_path, source).map(|(facts, _)| facts)
}

pub fn extract_typescript_facts_with_report(
    file_path: impl AsRef<Path>,
    source: &str,
) -> Result<(Vec<Fact>, ParseReport), FactExtractError> {
    let file_path = file_path.as_ref().to_string_lossy().replace('\\', "/");
    let (tree, grammar) = parse_with_best_grammar(&file_path, source)?;
    let root = tree.root_node();
    let mut error_nodes = 0;
    let mut error_bytes = 0;
    measure_parse_errors(root, &mut error_nodes, &mut error_bytes);
    let report = ParseReport {
        grammar,
        error_nodes,
        error_bytes,
        source_bytes: source.len(),
    };
    let mut facts = Vec::new();

    facts.push(Fact {
        kind: FactKind::FileDetected,
        file_path: file_path.clone(),
        name: file_path.clone(),
        value: None,
        imported_name: None,
        runtime_use: None,
        start_line: 1,
        end_line: source.lines().count().max(1),
        // A file-level fact spans the whole file, so its position is the file's first character.
        // The same holds for the role facts below. These are the only facts whose column is a
        // constant rather than a parse position, and it is a true one.
        start_column: 1,
        end_column: 1,
    });

    let line_count = source.lines().count().max(1);
    let mut is_api_route = false;
    for role in file_roles(&file_path) {
        if role == FileRole::ApiRoute {
            is_api_route = true;
        }
        facts.push(Fact {
            kind: FactKind::FileRoleDetected,
            file_path: file_path.clone(),
            name: role.as_wire().to_string(),
            value: None,
            imported_name: None,
            runtime_use: None,
            start_line: 1,
            end_line: line_count,
            start_column: 1,
            end_column: 1,
        });
    }
    // CV-2: the route's flavour, emitted only for files that are routes at all - a flavour fact on a
    // component would be a classification of something that has no flavour.
    if is_api_route {
        facts.push(Fact {
            kind: FactKind::RouteFlavorDetected,
            file_path: file_path.clone(),
            name: route_flavor(&file_path).to_string(),
            value: None,
            imported_name: None,
            runtime_use: None,
            start_line: 1,
            end_line: line_count,
            start_column: 1,
            end_column: 1,
        });
    }

    // Refuse before descending, not while descending. A file too deep to walk is a file this scan
    // did not read, and the caller already has an honest place to put that: the Err arm records a
    // skip and marks repo completeness incomplete. Truncating the walk instead would produce a
    // file that looks scanned and silently contributes no facts - a false clean, which is strictly
    // worse than the crash it would be replacing.
    if exceeds_max_depth(root, MAX_AST_DEPTH) {
        return Err(FactExtractError::TooDeep {
            depth_limit: MAX_AST_DEPTH,
        });
    }

    walk_node(root, source.as_bytes(), &file_path, &mut facts);
    apply_runtime_use_analysis(root, source.as_bytes(), &mut facts);
    // Strictly after the runtime-use pass, which is what removes the `import_used` facts for
    // type-erased bindings. The binding table below is built from what survives it, so a
    // type-only import cannot become the subject of an alias claim.
    apply_export_alias_analysis(root, source.as_bytes(), &mut facts);

    Ok((facts, report))
}

/// D-PA2: the grammar, chosen by extension and then checked.
///
/// It used to be chosen by suffix alone - TSX for `.tsx`/`.jsx`, TypeScript for everything else -
/// which put `.js` on a grammar that cannot read JSX. Identical component source parsed as
/// `profile.js` yielded 4 facts and as `profile.jsx` 6. The two missing were a `setOpen(false)`
/// call and a `posts.map(...)` call inside the JSX return, both with exact line and column when
/// parsed right. The `.js` scan reported full success having dropped two real call sites, and JSX
/// in a plain `.js` file is not an edge case - it is how a large share of React code is written.
///
/// `.js` cannot contain TypeScript-only syntax, so TSX is a strict improvement for it in principle.
/// In practice there is one ambiguity - `a < b && c > (d)` can be misread as a JSX element, which
/// is exactly why TypeScript makes you rename to `.tsx` - so the choice is checked rather than
/// asserted: if the TSX parse has errors, the file is parsed again as TypeScript and whichever
/// grammar covered more of the file wins. Ties go to TSX, which is the better default for the
/// extension. The second parse only happens when the first one failed at something, so it costs
/// nothing on the overwhelming majority of files.
///
/// `.ts` gets no alternate. A `.ts` file containing JSX does not compile, so parsing one as TSX
/// would be inventing recall for source that cannot run.
fn parse_with_best_grammar(
    file_path: &str,
    source: &str,
) -> Result<(tree_sitter::Tree, &'static str), FactExtractError> {
    let jsx_capable = file_path.ends_with(".tsx") || file_path.ends_with(".jsx");
    // The plain-JavaScript family, where the extension does not settle whether JSX is present.
    let ambiguous =
        file_path.ends_with(".js") || file_path.ends_with(".mjs") || file_path.ends_with(".cjs");

    let (primary, primary_name): (tree_sitter::Language, &'static str) = if jsx_capable || ambiguous
    {
        (tree_sitter_typescript::LANGUAGE_TSX.into(), "tsx")
    } else {
        (
            tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            "typescript",
        )
    };

    let tree = parse_with(primary, source)?;
    if !ambiguous || !tree.root_node().has_error() {
        return Ok((tree, primary_name));
    }

    let alternate = parse_with(tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(), source)?;
    let mut primary_errors = (0, 0);
    let mut alternate_errors = (0, 0);
    measure_parse_errors(
        tree.root_node(),
        &mut primary_errors.0,
        &mut primary_errors.1,
    );
    measure_parse_errors(
        alternate.root_node(),
        &mut alternate_errors.0,
        &mut alternate_errors.1,
    );
    if alternate_errors.1 < primary_errors.1 {
        return Ok((alternate, "typescript"));
    }
    Ok((tree, primary_name))
}

fn parse_with(
    language: tree_sitter::Language,
    source: &str,
) -> Result<tree_sitter::Tree, FactExtractError> {
    let mut parser = Parser::new();
    parser
        .set_language(&language)
        .map_err(FactExtractError::ParserLanguage)?;
    parser
        .parse(source, None)
        .ok_or(FactExtractError::ParseFailed)
}

/// Count the ERROR and MISSING nodes and the bytes they cover.
///
/// A MISSING node has an empty byte range - it is a token the grammar had to invent to keep
/// going - so it counts as one byte rather than none; a file whose only damage is missing tokens
/// still has damage.
fn measure_parse_errors(node: Node<'_>, nodes: &mut usize, bytes: &mut usize) {
    if node.is_error() || node.is_missing() {
        *nodes += 1;
        *bytes += node.byte_range().len().max(1);
        return;
    }
    if !node.has_error() {
        return;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        measure_parse_errors(child, nodes, bytes);
    }
}

/// Remove `import_used` facts for bindings that are only ever used in *type* positions.
///
/// `import type { X }` and inline `type X` are already skipped syntactically, but a plain
/// value-syntax import whose binding is used only as a type is erased by TypeScript just the
/// same and creates no runtime dependency on the module. On dub this was 39 of 458 baseline
/// findings (8.5%) - shapes like:
///
/// ```ts
/// import { Domain } from "@prisma/client";
/// function f(d: Pick<Domain, "id">) {}   // never a value
/// ```
///
/// The direction of caution matters. Wrongly dropping a real data client would create a
/// silent miss, which is the worst failure class in this codebase, so a binding is dropped
/// only when the AST shows at least one type-position use and *no* value-position use.
/// Absent positive evidence of type usage, the fact is kept.
fn apply_runtime_use_analysis(root: Node<'_>, source: &[u8], facts: &mut Vec<Fact>) {
    let mut value_uses: BTreeSet<String> = BTreeSet::new();
    let mut type_uses: BTreeSet<String> = BTreeSet::new();
    collect_identifier_usage(root, source, &mut value_uses, &mut type_uses);

    facts.retain(|fact| {
        if fact.kind != FactKind::ImportUsed {
            return true;
        }
        // Runtime-by-construction imports (`require()`, dynamic `import()`, and the S10
        // bindingless side-effect import) execute the module regardless of how any binding
        // is used; the type-only erasure below never applies to them.
        //
        // The side-effect case is named explicitly rather than left to fall through. Its
        // binding is the `(side-effect)` sentinel, which no identifier can equal, so
        // `used_as_type` is necessarily false and the retain below would keep it anyway -
        // but that is the filter's *default*, and a default is not a decision. If the
        // sentinel ever became a real name this would silently start erasing the only fact
        // that proves the dependency.
        if matches!(
            fact.runtime_use.as_deref(),
            Some(RUNTIME_USE_DYNAMIC) | Some(RUNTIME_USE_SIDE_EFFECT)
        ) {
            return true;
        }
        let name = fact.name.as_str();
        let used_as_type = type_uses.contains(name);
        let used_as_value = value_uses.contains(name);
        // Drop only on positive evidence: used as a type somewhere and never as a value.
        // A binding with no type use at all, or with any value use, is kept - naming the
        // condition rather than negating it inline, since `!used_as_type || used_as_value`
        // is the same predicate with the reasoning removed.
        let erased_at_runtime = used_as_type && !used_as_value;
        !erased_at_runtime
    });

    // S1-05: carry the value/type verdict forward on the fact rather than recomputing it at
    // the graph-assembly diagnostic site - two copies of the analysis is how the duplicated
    // resolvers in S1-04 diverged. A binding seen in a value position is provably runtime.
    for fact in facts.iter_mut() {
        if fact.kind == FactKind::ImportUsed
            && fact.runtime_use.is_none()
            && value_uses.contains(fact.name.as_str())
        {
            fact.runtime_use = Some(RUNTIME_USE_VALUE_POSITION.to_string());
        }
    }
}

/// R8-04, R8-07 (D-2). Say out loud when a module's *exported surface* is another module's binding.
///
/// `export { db } from "./db"` carries a `source` field, so `extract_export` emits `re_export_used`
/// and the graph grows an edge a chain walk can follow. `import { db } from "./db"; export const
/// client = db;` is the same laundering with the `from` moved one line up, and it produces an
/// `import_used` and an `exported_symbol` with nothing stating that they are the same value. The
/// chain walk terminates at the laundering module and the route importing `client` looks clean.
/// Measured on the Part 0.2 fixture: three of four laundering modules produced zero edges between
/// their export and the data layer they publish.
///
/// This is not type inference and does not want to be. Knowing that `client` has type
/// `PrismaClient` answers nothing the checker asks; knowing that `client` was *bound from* the `db`
/// import answers all of it, and that is a syntactic fact.
///
/// **Direction of caution.** These facts widen a prohibition, never an acceptance, so the failure
/// modes are not symmetric: a miss leaves today's silent gap, an over-emission blocks a merge that
/// should have passed. Every condition below therefore demands positive syntactic proof, and every
/// shape that cannot supply it is skipped rather than guessed at. The skips are deliberate misses,
/// pinned as `known_evasion` rows rather than left as folklore:
///
/// - **`source` field present** - a re-export, already modelled; emitting here would double-count.
/// - **Type-only export** (`export type { Db }`, `export { type Db }`) - erased at compile time, so
///   it cannot carry a value at runtime. Both forms are text-tested exactly as
///   `extract_local_export_list` tests them, because the grammar gives no field that says so.
/// - **Binding not from a value import** - the table is built from the `import_used` facts that
///   survived `apply_runtime_use_analysis`, so a type-only import is absent by construction.
/// - **`SIDE_EFFECT_IMPORT_BINDING`** - excluded by name, not by the fact that no identifier can
///   equal `(side-effect)`. That is the filter's default, and a default is not a decision.
/// - **Two bindings of one local name** - if two `import_used` facts disagree about the specifier
///   for a name, the module is not making one claim and neither is this pass.
/// - **Any reassignment of either name** (`export let client = db; client = safeWrapper;`) - the
///   identity claim is false from the assignment onward, and this pass has no flow sensitivity to
///   say where. Disqualifies on the exported name *and* on the imported binding.
/// - **More than one declarator** (`export const a = db, b = db;`) - not needed by any observed
///   shape, and one declarator is what makes the `name`/`value` pairing unambiguous.
/// - **Anything that is not a bare identifier** - `export const q = db.user` (member),
///   `export const api = { db }` (object property), `export const c = ns.db` (namespace member).
///   The fact model has no member path; naming one would be inventing evidence.
/// - **`async` or generator functions** - an `async` function returns a Promise and a generator
///   returns an iterator. Neither *is* the binding, and saying it is would be a claim about types
///   this engine does not make.
/// - **A body that declares the returned name** - `export function getClient() { const db =
///   local(); return db; }` returns a local. Resolving the scope chain properly is the right fix;
///   bailing out on any same-name declaration anywhere in the function is one condition and cannot
///   be wrong in the dangerous direction.
/// - **Returns belonging to a nested function** - only `return`s whose nearest enclosing function
///   is the candidate are collected, so an inner callback's return is never attributed outward.
/// - **Disagreeing, absent, or bare `return`s** - every return must be the *same* bare identifier,
///   and there must be at least one. A concise arrow body counts as that single return.
///
/// `name` is the EXPORTED name and `imported_name` is the source symbol in the target module,
/// mirroring EW-4: `export { db as client }` records `name=client, imported_name=db`, because
/// recording only the alias makes a renamed export unresolvable in the module it came from. The
/// span is the export statement, not the import - the laundering line is what the evidence is
/// about.
fn apply_export_alias_analysis(root: Node<'_>, source: &[u8], facts: &mut Vec<Fact>) {
    let bindings = imported_value_bindings(facts);
    if bindings.is_empty() {
        return;
    }
    // Every fact in this vector belongs to the file being extracted, and `file_detected` is pushed
    // before the walk starts, so there is always one to read the path from. Taken from the facts
    // rather than threaded in as a parameter to keep this pass the same shape as
    // `apply_runtime_use_analysis`, which is the precedent for a whole-file post-pass here.
    let Some(file_path) = facts.first().map(|fact| fact.file_path.clone()) else {
        return;
    };

    let mut reassigned: BTreeSet<String> = BTreeSet::new();
    collect_reassigned_identifiers(root, source, &mut reassigned);

    let mut emitted = Vec::new();
    collect_export_alias_facts(
        root,
        source,
        &file_path,
        &bindings,
        &reassigned,
        &mut emitted,
    );
    facts.extend(emitted);
}

/// What an import bound, keyed by the local name it bound it to.
#[derive(Clone, PartialEq, Eq)]
struct ImportedBinding {
    /// The specifier as written (`./db`), which is what the resolver takes.
    specifier: String,
    /// The symbol in the target module, which is what has to resolve there.
    imported_name: Option<String>,
}

/// The binding table, read off the `import_used` facts already collected for this file.
///
/// Deliberately not a second binding tracker. The join this pass needs - exported name to local
/// binding to specifier - is already half-recorded in `import_used`, and the two divergent copies
/// of `is_forbidden_import` are what this codebase has already paid for twice.
fn imported_value_bindings(facts: &[Fact]) -> BTreeMap<String, ImportedBinding> {
    let mut table: BTreeMap<String, ImportedBinding> = BTreeMap::new();
    let mut ambiguous: BTreeSet<String> = BTreeSet::new();
    for fact in facts {
        if fact.kind != FactKind::ImportUsed {
            continue;
        }
        // S10's sentinel, excluded by name. `(side-effect)` is not a legal identifier so nothing
        // could match it, but that is the loop's default rather than this pass's decision - see
        // the same argument at the head of `apply_runtime_use_analysis`'s retain.
        if fact.name == SIDE_EFFECT_IMPORT_BINDING {
            continue;
        }
        let Some(specifier) = fact.value.clone() else {
            continue;
        };
        let binding = ImportedBinding {
            specifier,
            imported_name: fact.imported_name.clone(),
        };
        match table.get(&fact.name) {
            Some(existing) if *existing != binding => {
                ambiguous.insert(fact.name.clone());
            }
            Some(_) => {}
            None => {
                table.insert(fact.name.clone(), binding);
            }
        }
    }
    for name in ambiguous {
        table.remove(&name);
    }
    table
}

/// Every identifier that is assigned to anywhere in the file.
///
/// Whole-file rather than scoped: this pass has no flow sensitivity, so it cannot say whether the
/// assignment runs before or after the export. Treating any assignment as disqualifying is the
/// conservative reading, and the shape it exists for - trap 2's `export let client = db; client =
/// safeWrapper;` - is one where the alias claim is simply false.
fn collect_reassigned_identifiers(node: Node<'_>, source: &[u8], out: &mut BTreeSet<String>) {
    if matches!(
        node.kind(),
        "assignment_expression" | "augmented_assignment_expression"
    ) && let Some(left) = node.child_by_field_name("left")
        && left.kind() == "identifier"
        && let Some(text) = node_text(left, source)
    {
        out.insert(text);
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_reassigned_identifiers(child, source, out);
    }
}

/// Walk to every `export_statement` and let `push_export_alias_facts` judge it.
///
/// Does not descend into an export statement it has already judged: an export nested inside one
/// is not a second module export, and re-reading its declaration would double-emit.
fn collect_export_alias_facts(
    node: Node<'_>,
    source: &[u8],
    file_path: &str,
    bindings: &BTreeMap<String, ImportedBinding>,
    reassigned: &BTreeSet<String>,
    out: &mut Vec<Fact>,
) {
    if node.kind() == "export_statement" {
        push_export_alias_facts(node, source, file_path, bindings, reassigned, out);
        return;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_export_alias_facts(child, source, file_path, bindings, reassigned, out);
    }
}

fn push_export_alias_facts(
    node: Node<'_>,
    source: &[u8],
    file_path: &str,
    bindings: &BTreeMap<String, ImportedBinding>,
    reassigned: &BTreeSet<String>,
    out: &mut Vec<Fact>,
) {
    // A `source` field is what makes a statement a re-export, and the branch at the top of
    // `extract_export` already models those. Nothing here is about them.
    if node.child_by_field_name("source").is_some() {
        return;
    }
    let Some(statement) = node_text(node, source) else {
        return;
    };
    // `export type { Db };` - the whole clause is erased, and no field on the node says so, only
    // the text. Same test as `extract_local_export_list`.
    if statement.trim_start().starts_with("export type") {
        return;
    }

    let span = FactSpan {
        start_line: node.start_position().row + 1,
        end_line: node.end_position().row + 1,
        start_column: node.start_position().column + 1,
        end_column: node.end_position().column + 1,
    };
    let is_default_export = is_runtime_default_export_statement(&statement);

    // (b) Detached-clause form: `export { db };` / `export { db as client };`.
    if let Some(clause) = (0..node.named_child_count())
        .filter_map(|index| node.named_child(index))
        .find(|child| child.kind() == "export_clause")
    {
        for index in 0..clause.named_child_count() {
            let Some(specifier) = clause.named_child(index) else {
                continue;
            };
            if specifier.kind() != "export_specifier" {
                continue;
            }
            // The per-specifier type form, `export { value, type Only };`.
            if node_text(specifier, source)
                .as_deref()
                .is_some_and(|text| text.trim_start().starts_with("type "))
            {
                continue;
            }
            let Some(local_name) = specifier
                .child_by_field_name("name")
                .and_then(|child| node_text(child, source))
            else {
                continue;
            };
            let exported_name = specifier
                .child_by_field_name("alias")
                .and_then(|child| node_text(child, source))
                .unwrap_or_else(|| local_name.clone());
            push_binding_fact(
                LaunderingShape::Alias,
                file_path,
                &exported_name,
                &local_name,
                bindings,
                reassigned,
                span,
                out,
            );
        }
        return;
    }

    // (c) Default form: `export default db;`. The export node carries the expression on its
    // `value` field, and only a bare identifier is a binding this pass can name.
    if is_default_export && let Some(value) = node.child_by_field_name("value") {
        if value.kind() == "identifier"
            && let Some(local_name) = node_text(value, source)
        {
            push_binding_fact(
                LaunderingShape::Alias,
                file_path,
                "default",
                &local_name,
                bindings,
                reassigned,
                span,
                out,
            );
        }
        return;
    }

    let Some(declaration) = node.child_by_field_name("declaration") else {
        return;
    };

    match declaration.kind() {
        // `export function getClient() { return db; }`, and its default form. A
        // `generator_function_declaration` is a distinct node kind and deliberately not matched:
        // calling it returns an iterator, not the binding.
        "function_declaration" => {
            let exported_name = if is_default_export {
                // What importers actually bind, matching how `exported_symbol` names the default
                // export. The local function name is not importable and would be a name nothing
                // downstream could resolve.
                Some("default".to_string())
            } else {
                declaration
                    .child_by_field_name("name")
                    .and_then(|name| node_text(name, source))
            };
            let Some(exported_name) = exported_name else {
                return;
            };
            if let Some(local_name) =
                wrapped_binding_name(declaration, source, bindings, reassigned)
            {
                push_binding_fact(
                    LaunderingShape::Wrap,
                    file_path,
                    &exported_name,
                    &local_name,
                    bindings,
                    reassigned,
                    span,
                    out,
                );
            }
        }
        "lexical_declaration" | "variable_declaration" => {
            // Exactly one declarator, so that the exported name and the value it was bound from
            // are a pair rather than a correspondence this pass has to guess at.
            let declarators = (0..declaration.named_child_count())
                .filter_map(|index| declaration.named_child(index))
                .filter(|child| child.kind() == "variable_declarator")
                .collect::<Vec<_>>();
            let [declarator] = declarators.as_slice() else {
                return;
            };
            let Some(name_node) = declarator.child_by_field_name("name") else {
                return;
            };
            // A destructuring pattern (`export const { db } = deps;`) binds through a shape this
            // pass cannot describe, so it is not an identifier and not a candidate.
            if name_node.kind() != "identifier" {
                return;
            }
            let Some(exported_name) = node_text(name_node, source) else {
                return;
            };
            let Some(value) = declarator.child_by_field_name("value") else {
                return;
            };
            match value.kind() {
                // (a) Declarator form: `export const client = db;`.
                "identifier" => {
                    let Some(local_name) = node_text(value, source) else {
                        return;
                    };
                    push_binding_fact(
                        LaunderingShape::Alias,
                        file_path,
                        &exported_name,
                        &local_name,
                        bindings,
                        reassigned,
                        span,
                        out,
                    );
                }
                // `export const getClient = () => db;`. Restricted to `const`, because a `let` or
                // `var` holding a function can be replaced with a different one, and the wrap
                // claim is about what this exported name calls.
                "arrow_function" | "function_expression" if is_const_declaration(declaration) => {
                    if let Some(local_name) =
                        wrapped_binding_name(value, source, bindings, reassigned)
                    {
                        push_binding_fact(
                            LaunderingShape::Wrap,
                            file_path,
                            &exported_name,
                            &local_name,
                            bindings,
                            reassigned,
                            span,
                            out,
                        );
                    }
                }
                _ => {}
            }
        }
        _ => {}
    }
}

/// The four span numbers, carried together so the emit helper does not take eight arguments.
#[derive(Clone, Copy)]
struct FactSpan {
    start_line: usize,
    end_line: usize,
    start_column: usize,
    end_column: usize,
}

/// Which of the two laundering relations a candidate proved.
///
/// D2: two kinds, not one. Aliasing is an identity claim decidable from a single declarator;
/// wrapping is a claim about every return of a function, and carries a real conservatism boundary
/// (nested functions, disagreeing returns, shadowing). Conflating them would make the weaker claim
/// inherit the stronger one's blocking status, and neither could be gated off alone if a corpus
/// sweep turned up a false positive on one of them.
#[derive(Clone, Copy)]
enum LaunderingShape {
    /// The exported name IS the imported binding.
    Alias,
    /// Every return of the exported function IS the imported binding.
    Wrap,
}

impl LaunderingShape {
    fn fact_kind(self) -> FactKind {
        match self {
            LaunderingShape::Alias => FactKind::ExportAliasesImport,
            LaunderingShape::Wrap => FactKind::ExportWrapsImport,
        }
    }
}

/// Emit one fact, if the local name really is an unreassigned import binding.
///
/// The reassignment test covers BOTH names. The imported binding, because an import that is
/// written over no longer names the module it came from; and the exported name, because
/// `export let client = db; client = safeWrapper;` publishes something that stopped being `db`.
#[allow(clippy::too_many_arguments)]
fn push_binding_fact(
    shape: LaunderingShape,
    file_path: &str,
    exported_name: &str,
    local_name: &str,
    bindings: &BTreeMap<String, ImportedBinding>,
    reassigned: &BTreeSet<String>,
    span: FactSpan,
    out: &mut Vec<Fact>,
) {
    let Some(binding) = bindings.get(local_name) else {
        return;
    };
    if reassigned.contains(local_name) || reassigned.contains(exported_name) {
        return;
    }
    out.push(Fact {
        kind: shape.fact_kind(),
        file_path: file_path.to_string(),
        name: exported_name.to_string(),
        value: Some(binding.specifier.clone()),
        imported_name: binding.imported_name.clone(),
        runtime_use: None,
        start_line: span.start_line,
        end_line: span.end_line,
        start_column: span.start_column,
        end_column: span.end_column,
    });
}

fn is_const_declaration(declaration: Node<'_>) -> bool {
    let mut cursor = declaration.walk();
    declaration
        .children(&mut cursor)
        .any(|child| child.kind() == "const")
}

/// The single imported binding every `return` of this function hands back, if there is one.
///
/// `None` the moment the function stops being a pass-through of one binding - which is most
/// functions, and is meant to be.
fn wrapped_binding_name(
    function: Node<'_>,
    source: &[u8],
    bindings: &BTreeMap<String, ImportedBinding>,
    reassigned: &BTreeSet<String>,
) -> Option<String> {
    // `async` and `*` are anonymous tokens on the function node rather than fields. An `async`
    // function returns a Promise and a generator returns an iterator; neither is the binding.
    let mut cursor = function.walk();
    if function
        .children(&mut cursor)
        .any(|child| matches!(child.kind(), "async" | "*"))
    {
        return None;
    }
    if matches!(
        function.kind(),
        "generator_function" | "generator_function_declaration"
    ) {
        return None;
    }

    let body = function.child_by_field_name("body")?;

    let returned = if body.kind() == "statement_block" {
        let mut returns = Vec::new();
        collect_own_return_statements(body, &mut returns);
        // No return at all is not a wrap of anything.
        if returns.is_empty() {
            return None;
        }
        let mut single: Option<String> = None;
        for return_statement in returns {
            // `return;` has no expression; `return getDb()` and `return db.client` are a call and
            // a member, neither of which is a bare binding.
            let expression = return_statement.named_child(0)?;
            if expression.kind() != "identifier" {
                return None;
            }
            let name = node_text(expression, source)?;
            match &single {
                // Two returns of different identifiers means the exported name is not one
                // binding, and picking either would be a coin toss recorded as evidence.
                Some(existing) if *existing != name => return None,
                Some(_) => {}
                None => single = Some(name),
            }
        }
        single?
    } else {
        // A concise arrow body IS the return: `() => db`.
        if body.kind() != "identifier" {
            return None;
        }
        node_text(body, source)?
    };

    if !bindings.contains_key(&returned) || reassigned.contains(&returned) {
        return None;
    }

    // Trap 3. If anything inside this function declares the same name - a `const`, a parameter, a
    // catch binding, a nested function, or the function's own name - the returned identifier may
    // be that local rather than the import. Resolving the scope chain is the correct fix; refusing
    // to guess is the one that cannot be wrong in the dangerous direction.
    let mut declared = BTreeSet::new();
    collect_declared_binding_names(function, source, &mut declared);
    if declared.contains(&returned) {
        return None;
    }

    Some(returned)
}

/// Every `return` whose NEAREST enclosing function is this one.
///
/// Trap 4: a plain subtree walk attributes an inner callback's return to the outer function, so
/// `export function f() { items.map(() => db); }` would read as returning `db` when it returns
/// `undefined`. Descent stops at any nested function.
fn collect_own_return_statements<'tree>(node: Node<'tree>, out: &mut Vec<Node<'tree>>) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if is_function_like(child.kind()) {
            continue;
        }
        if child.kind() == "return_statement" {
            out.push(child);
        }
        collect_own_return_statements(child, out);
    }
}

fn is_function_like(kind: &str) -> bool {
    matches!(
        kind,
        "function_declaration"
            | "generator_function_declaration"
            | "function_expression"
            | "generator_function"
            | "arrow_function"
            | "method_definition"
    )
}

/// Every name declared anywhere inside a subtree.
///
/// Over-collects on purpose: type annotations and parameter defaults contribute identifiers that
/// are not bindings. Every extra name can only cause the shadowing bail-out above to fire, which
/// costs recall on a shape nobody has observed and never produces a wrong claim.
fn collect_declared_binding_names(node: Node<'_>, source: &[u8], out: &mut BTreeSet<String>) {
    match node.kind() {
        "variable_declarator"
        | "function_declaration"
        | "generator_function_declaration"
        | "function_expression"
        | "generator_function"
        | "class_declaration" => {
            if let Some(name) = node.child_by_field_name("name") {
                collect_pattern_identifiers(name, source, out);
            }
        }
        "formal_parameters" => collect_pattern_identifiers(node, source, out),
        "catch_clause" => {
            if let Some(parameter) = node.child_by_field_name("parameter") {
                collect_pattern_identifiers(parameter, source, out);
            }
        }
        _ => {}
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_declared_binding_names(child, source, out);
    }
}

fn collect_pattern_identifiers(node: Node<'_>, source: &[u8], out: &mut BTreeSet<String>) {
    if matches!(
        node.kind(),
        "identifier" | "shorthand_property_identifier_pattern"
    ) && let Some(text) = node_text(node, source)
    {
        out.insert(text);
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_pattern_identifiers(child, source, out);
    }
}

/// Partition every identifier occurrence into type positions and value positions.
///
/// tree-sitter-typescript exposes these as distinct node kinds: a name used as a type parses
/// as `type_identifier`, and one used as a value parses as `identifier`. That distinction is
/// the grammar's, not a heuristic of ours, which is why this is done on the AST rather than
/// by matching text.
fn collect_identifier_usage(
    node: Node<'_>,
    source: &[u8],
    value_uses: &mut BTreeSet<String>,
    type_uses: &mut BTreeSet<String>,
) {
    // Do not count the import clause itself as a use of its own bindings.
    if node.kind() == "import_statement" {
        return;
    }

    match node.kind() {
        "type_identifier" => {
            if let Some(text) = node_text(node, source) {
                type_uses.insert(text);
            }
        }
        // A qualified type name (`type Row = T.PrismaLike`) parses its module part as a
        // plain `identifier`, and a type query (`keyof typeof T`) wraps one too - but both
        // are type positions erased at compile time. Counting them as value uses made a
        // namespace import used only in types look runtime (S1-05's negative control).
        "nested_type_identifier" | "type_query" => {
            collect_type_context_identifiers(node, source, type_uses);
            return;
        }
        "identifier" | "shorthand_property_identifier" => {
            if let Some(text) = node_text(node, source) {
                value_uses.insert(text);
            }
        }
        _ => {}
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_identifier_usage(child, source, value_uses, type_uses);
    }
}

/// Record every identifier under a type-context node as a type use.
fn collect_type_context_identifiers(
    node: Node<'_>,
    source: &[u8],
    type_uses: &mut BTreeSet<String>,
) {
    if matches!(node.kind(), "identifier" | "type_identifier")
        && let Some(text) = node_text(node, source)
    {
        type_uses.insert(text);
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_type_context_identifiers(child, source, type_uses);
    }
}

/// How deep the fact walkers may descend.
///
/// `walk_node`, `collect_identifier_usage`, `collect_type_context_identifiers` and the runtime-use
/// analysis all recurse once per AST child. tree-sitter *parses* iteratively, so it hands back a
/// tree far deeper than these walkers can descend: a 129 KB `public/js/vendor.min.js` containing a
/// single 20,000-term `+` chain aborted the whole scan with
/// `fatal runtime error: stack overflow`, exit 1, no database written, and every rerun failing
/// identically. `public/`, `static/` and `assets/` are not skipped and `.js` is indexed, so a
/// vendored bundle is an ordinary thing for a repository to contain.
///
/// Measured crash thresholds were 15k (`+` chains, union types) and 20k (call chains, bracket
/// nesting). 2,000 sits an order of magnitude below the nearest of those and two orders above any
/// hand-written source - the deepest file in this repository's own test corpus is well under 200.
const MAX_AST_DEPTH: usize = 2_000;

/// Measure whether the tree is deeper than `limit`, iteratively.
///
/// Deliberately a cursor walk rather than a recursive one: a recursive depth check would overflow
/// on exactly the inputs it exists to detect.
fn exceeds_max_depth(root: Node<'_>, limit: usize) -> bool {
    let mut cursor = root.walk();
    let mut depth: usize = 0;
    loop {
        if depth > limit {
            return true;
        }
        if cursor.goto_first_child() {
            depth += 1;
            continue;
        }
        loop {
            if cursor.goto_next_sibling() {
                break;
            }
            if !cursor.goto_parent() {
                return false;
            }
            depth -= 1;
        }
    }
}

fn walk_node(node: Node<'_>, source: &[u8], file_path: &str, facts: &mut Vec<Fact>) {
    match node.kind() {
        "import_statement" => extract_imports(node, source, file_path, facts),
        "lexical_declaration" | "variable_declaration" => {
            extract_runtime_imports(node, source, file_path, facts)
        }
        "call_expression" => {
            extract_call(node, source, file_path, facts);
            extract_secret_source_read(node, source, file_path, facts);
        }
        "member_expression" | "subscript_expression" => {
            extract_secret_source_read(node, source, file_path, facts)
        }
        "export_statement" => extract_export(node, source, file_path, facts),
        _ => {}
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        walk_node(child, source, file_path, facts);
    }
}

fn extract_imports(node: Node<'_>, source: &[u8], file_path: &str, facts: &mut Vec<Fact>) {
    let Some(statement) = node_text(node, source) else {
        return;
    };
    let source_value = node
        .child_by_field_name("source")
        .and_then(|child| node_text(child, source))
        .map(unquote);

    let bindings = import_value_bindings(&statement);
    if bindings.is_empty() {
        // S10: a bindingless `import "@acme/db";`. No binding is exactly why this shape was
        // invisible - and exactly why it is a violation: an import with nothing to bind exists
        // only to execute the module.
        if let Some(specifier) = source_value.as_deref()
            && is_bindingless_import(&statement)
            && is_module_like_specifier(specifier)
        {
            facts.push(Fact {
                kind: FactKind::ImportUsed,
                file_path: file_path.to_string(),
                name: SIDE_EFFECT_IMPORT_BINDING.to_string(),
                value: source_value.clone(),
                imported_name: Some(SIDE_EFFECT_IMPORT_BINDING.to_string()),
                runtime_use: Some(RUNTIME_USE_SIDE_EFFECT.to_string()),
                start_line: node.start_position().row + 1,
                end_line: node.end_position().row + 1,
                start_column: node.start_position().column + 1,
                end_column: node.end_position().column + 1,
            });
        }
        return;
    }

    for binding in bindings {
        facts.push(Fact {
            kind: FactKind::ImportUsed,
            file_path: file_path.to_string(),
            name: binding.local_name,
            value: source_value.clone(),
            imported_name: Some(binding.imported_name),
            runtime_use: None,
            start_line: node.start_position().row + 1,
            end_line: node.end_position().row + 1,
            start_column: node.start_position().column + 1,
            end_column: node.end_position().column + 1,
        });
    }
}

/// An import declaration whose clause is the module specifier itself: `import "x";`.
///
/// `import type ...`, `import x from "x"` and `import {} ... ` all fail this - the first
/// because it is erased, the rest because they have a clause before the `from`.
fn is_bindingless_import(statement: &str) -> bool {
    let trimmed = statement.trim();
    let Some(rest) = trimmed.strip_prefix("import") else {
        return false;
    };
    let rest = rest.trim_start();
    rest.starts_with('"') || rest.starts_with('\'')
}

/// Whether a bindingless specifier names a *module* rather than an asset.
///
/// `import "./globals.css"`, `import "../logo.svg"` and friends are bundler instructions, not
/// module dependencies: nothing in a stylesheet can be a data layer, and the resolver cannot
/// follow them because assets are not in the scanned snapshot. Left in, they would each raise
/// an `unresolved_import` diagnostic - and one of those on a route file makes the entire check
/// fail closed (exit 3). That would turn a recall fix into an availability bug.
///
/// The test is a whitelist, not a blacklist of known asset extensions, because the blacklist
/// can only ever be as complete as today's bundler ecosystem while the whitelist errs toward
/// the status quo (silence). A specifier with no extension is module-like; one with an
/// extension is module-like only if that extension is JavaScript or TypeScript. The cost is
/// that `import "@acme/db.core"` stays missed, which is where it already was.
fn is_module_like_specifier(specifier: &str) -> bool {
    let path = specifier
        .split(['?', '#'])
        .next()
        .unwrap_or(specifier)
        .trim_end_matches('/');
    let last_segment = path.rsplit('/').next().unwrap_or(path);
    match last_segment.rsplit_once('.') {
        None => true,
        Some((_, extension)) => matches!(
            extension.to_ascii_lowercase().as_str(),
            "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "mts" | "cts"
        ),
    }
}

fn extract_runtime_imports(node: Node<'_>, source: &[u8], file_path: &str, facts: &mut Vec<Fact>) {
    let Some(statement) = node_text(node, source) else {
        return;
    };
    let Some(source_value) = runtime_import_source(&statement) else {
        return;
    };
    let Some(binding_clause) = runtime_import_binding_clause(&statement) else {
        return;
    };

    for binding in runtime_import_bindings(binding_clause) {
        facts.push(Fact {
            kind: FactKind::ImportUsed,
            file_path: file_path.to_string(),
            name: binding.local_name,
            value: Some(source_value.clone()),
            imported_name: Some(binding.imported_name),
            // `require()` and dynamic `import()` execute the module by construction; no
            // type-only reading of them exists (S1-05).
            runtime_use: Some(RUNTIME_USE_DYNAMIC.to_string()),
            start_line: node.start_position().row + 1,
            end_line: node.end_position().row + 1,
            start_column: node.start_position().column + 1,
            end_column: node.end_position().column + 1,
        });
    }
}

fn runtime_import_source(statement: &str) -> Option<String> {
    quoted_call_argument(statement, "require(")
        .or_else(|| quoted_call_argument(statement, "import("))
}

fn quoted_call_argument(statement: &str, marker: &str) -> Option<String> {
    let after_marker = statement.split(marker).nth(1)?;
    let quote = after_marker
        .chars()
        .find(|value| *value == '"' || *value == '\'')?;
    let after_quote = after_marker.split_once(quote)?.1;
    let value = after_quote.split_once(quote)?.0.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn runtime_import_binding_clause(statement: &str) -> Option<&str> {
    let trimmed = statement.trim();
    let after_keyword = trimmed
        .strip_prefix("const ")
        .or_else(|| trimmed.strip_prefix("let "))
        .or_else(|| trimmed.strip_prefix("var "))?;
    let (binding_clause, _) = after_keyword.split_once('=')?;
    let binding_clause = binding_clause.trim();
    (!binding_clause.is_empty()).then_some(binding_clause)
}

fn runtime_import_bindings(binding_clause: &str) -> Vec<ImportBinding> {
    let trimmed = binding_clause.trim();
    if trimmed.starts_with('{') {
        let Some(end) = trimmed.find('}') else {
            return Vec::new();
        };
        let mut bindings = Vec::new();
        for specifier in trimmed[1..end].split(',') {
            let specifier = specifier.trim();
            if specifier.is_empty() {
                continue;
            }
            if let Some((imported_name, local_name)) = specifier.split_once(':') {
                push_import_binding(&mut bindings, imported_name, local_name);
            } else {
                push_import_binding(&mut bindings, specifier, specifier);
            }
        }
        bindings
    } else {
        let mut bindings = Vec::new();
        push_import_binding(&mut bindings, "default", trimmed);
        bindings
    }
}

fn extract_call(node: Node<'_>, source: &[u8], file_path: &str, facts: &mut Vec<Fact>) {
    let Some(function) = node.child_by_field_name("function") else {
        return;
    };
    let Some((name, receiver)) = callable_parts(function, source) else {
        return;
    };

    facts.push(Fact {
        kind: FactKind::SymbolCalled,
        file_path: file_path.to_string(),
        name: name.clone(),
        value: receiver.clone(),
        imported_name: None,
        runtime_use: None,
        start_line: node.start_position().row + 1,
        end_line: node.end_position().row + 1,
        start_column: node.start_position().column + 1,
        end_column: node.end_position().column + 1,
    });

    let Some(receiver) = receiver else {
        return;
    };
    if !is_data_access_binding(receiver_root(&receiver), file_path, facts) {
        return;
    }
    let Some((store_name, operation_kind)) = data_operation_shape(&receiver, &name) else {
        return;
    };
    facts.push(Fact {
        kind: FactKind::DataOperationDetected,
        file_path: file_path.to_string(),
        name,
        value: Some(receiver),
        imported_name: Some(format!("{operation_kind}:{store_name}")),
        runtime_use: None,
        start_line: node.start_position().row + 1,
        end_line: node.end_position().row + 1,
        start_column: node.start_position().column + 1,
        end_column: node.end_position().column + 1,
    });
}

/// Every sink candidate in a file, for callers that have a reason to want them.
///
/// NOT part of the base walk, and the reason is measured. One fact per call site is an enormous
/// number of call sites: emitting these from `extract_typescript_facts` took a `packages/` scan
/// from 33,808 facts to 63,951 (+89%) and from 1.80s to 3.05s (+69%), for a fact that only the
/// secret-exposure proof reads. Nothing else consumes it and nothing needs it on the wire.
///
/// So it is gated exactly the way `secret_read` already is: produced only where an accepted
/// phase-5 contract exists to give it a consumer. Scan mode passes `accepted_phase5: None` and
/// gets none of these, which is why a scan stream holds zero `secret_read` facts today too.
///
/// The cost is a second parse of the file. That is paid only for files a phase-5 convention is
/// actually scoped to, against a base walk that already parses every file in the repository.
pub(crate) fn sink_candidate_facts(
    file_path: &str,
    source: &str,
) -> Result<Vec<Fact>, FactExtractError> {
    let (tree, _) = parse_with_best_grammar(file_path, source)?;
    let root = tree.root_node();
    if exceeds_max_depth(root, MAX_AST_DEPTH) {
        return Err(FactExtractError::TooDeep {
            depth_limit: MAX_AST_DEPTH,
        });
    }
    let mut facts = Vec::new();
    walk_sink_candidates(root, source.as_bytes(), file_path, &mut facts);
    Ok(facts)
}

fn walk_sink_candidates(node: Node<'_>, source: &[u8], file_path: &str, facts: &mut Vec<Fact>) {
    if node.kind() == "call_expression" {
        extract_sink_candidate(node, source, file_path, facts);
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        walk_sink_candidates(child, source, file_path, facts);
    }
}

/// F5, S6-06. A call, positioned at its CALLEE, with the identifiers it references.
///
/// WHY THIS IS NOT `symbol_called`. S6-02 reused `symbol_called` for sink detection on the
/// reasoning that it already carries callee and receiver. It carries neither in the form a sink
/// test needs, and both gaps cost real findings:
///
///   - its span is the CALL EXPRESSION's. Measured on `res\n .status(500)\n .json({ e: apiKey })`,
///     `symbol_called` reports `name=json lines=3-5`: line 3 is where `res` is written, line 5 is
///     where `.json` and the secret are. A sink keyed on that line lands nowhere near the secret,
///     so the exposure vanished. Prettier breaks chains of three or more links by default, so this
///     is the ordinary spelling of the shape, not an exotic one.
///   - `callable_parts` returns `(name, None)` for an `identifier` callee, so `captureException(x)`
///     has no receiver. A contract's `log_sinks` is free text with nothing requiring a dotted
///     name, and a directly imported reporter is the common shape.
///
/// So this fact carries the callee NAME TOKEN's position - the `.json` property, not the head of
/// the chain - and a `callee` string that is present with or without a receiver.
///
/// It also carries the identifiers the call REFERENCES, gathered from the call's own subtree. That
/// is what finally closes the reported defect: `secret_sink_exposures` asked
/// `line_uses_identifier(raw_line, variable)`, so `console.error("start"); // apiKey is never
/// logged` was a real sink whose line happened to contain the token `apiKey` inside a comment.
/// A comment contributes no `identifier` node, so it contributes no reference.
fn extract_sink_candidate(node: Node<'_>, source: &[u8], file_path: &str, facts: &mut Vec<Fact>) {
    let Some(function) = node.child_by_field_name("function") else {
        return;
    };
    // A callee that is neither an identifier nor a member expression - `wrap(console.error)(x)`,
    // `handlers["error"](x)` - has no name node to stand at, but the raw line scan still matched a
    // sink string anywhere inside it, and `wrap(console.error)(apiKey)` really does pass the secret
    // to a wrapped reporter. So it falls back to the callee's own compacted text, which keeps the
    // substring test finding what it used to find without inventing a name.
    let (name, receiver, position) = match callee_name_node(function, source) {
        Some((name_node, receiver)) => {
            let Some(name) = node_text(name_node, source) else {
                return;
            };
            (name, receiver, name_node)
        }
        None => {
            let Some(text) = compacted_text(function, source) else {
                return;
            };
            (text, None, function)
        }
    };
    let callee = match receiver.as_deref() {
        Some(receiver) => format!("{receiver}.{name}"),
        None => name.clone(),
    };
    let mut identifiers = Vec::new();
    collect_referenced_identifiers(node, source, &mut identifiers);
    identifiers.sort();
    identifiers.dedup();

    facts.push(Fact {
        kind: FactKind::SinkCandidateCalled,
        file_path: file_path.to_string(),
        name,
        value: Some(
            serde_json::json!({
                "callee": callee,
                "has_receiver": receiver.is_some(),
                "identifiers": identifiers,
            })
            .to_string(),
        ),
        imported_name: None,
        runtime_use: None,
        // The CALLEE's position, deliberately, and the call's end. A sink is where the call is
        // written, and for a wrapped chain that is the property line, not the receiver line.
        start_line: position.start_position().row + 1,
        end_line: node.end_position().row + 1,
        start_column: position.start_position().column + 1,
        end_column: node.end_position().column + 1,
    });
}

/// The callee's own name node, plus its receiver where it has one.
///
/// Unlike `callable_parts` this returns the NODE rather than the text, because the position is the
/// whole point, and it reports the receiver as `Option` rather than folding a missing one into a
/// dropped fact. The receiver text is compacted for the same reason `receiver_text` compacts:
/// `logger\n  .error` is one callee however it is wrapped, and a sink test that disagreed with
/// itself depending on line breaks is the bug this fact exists to fix.
fn callee_name_node<'tree>(
    node: Node<'tree>,
    source: &[u8],
) -> Option<(Node<'tree>, Option<String>)> {
    match node.kind() {
        "identifier" => Some((node, None)),
        "member_expression" => {
            let property = node.child_by_field_name("property")?;
            let receiver = receiver_text(node, source);
            Some((property, receiver))
        }
        _ => None,
    }
}

/// Every identifier the subtree mentions.
///
/// `property_identifier` and the shorthand property kinds are included because the raw-line token
/// test this replaces matched them too - `{ error: apiKey }` and `{ apiKey }` both put the token on
/// the line - and dropping them would narrow detection while claiming not to.
fn collect_referenced_identifiers(node: Node<'_>, source: &[u8], identifiers: &mut Vec<String>) {
    if matches!(
        node.kind(),
        "identifier"
            | "property_identifier"
            | "shorthand_property_identifier"
            | "shorthand_property_identifier_pattern"
    ) && let Some(text) = node_text(node, source)
    {
        identifiers.push(text);
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_referenced_identifiers(child, source, identifiers);
    }
}

/// F5, S6-01. Where a secret source is *read*, as a position in the tree.
///
/// The phase-5 scanner used to find these by splitting the raw line on `"process.env."`,
/// `"config."` and `"secretManager.get("`, which is why `// const shadow = process.env.KEY;`
/// produced a `secret_read` fact indistinguishable from the real one. A read is a
/// `member_expression`, a `subscript_expression` or a `.get()` call in the tree or it is not a
/// read, and a comment is none of those.
///
/// The fact deliberately carries NO key text, hash or expression: only the source kind and the
/// span. `secret_read`'s whole reason for hashing its key is that env key names should not travel
/// in scan payloads, and a base fact is streamed on every scan of every repo. The redacted form is
/// still built in `security_facts.rs`, from the source text under this span - which is code by
/// construction now, rather than a line that merely contained it.
fn extract_secret_source_read(
    node: Node<'_>,
    source: &[u8],
    file_path: &str,
    facts: &mut Vec<Fact>,
) {
    let Some(source_kind) = secret_source_kind(node, source) else {
        return;
    };
    facts.push(Fact {
        kind: FactKind::SecretSourceRead,
        file_path: file_path.to_string(),
        name: source_kind.to_string(),
        value: None,
        imported_name: None,
        runtime_use: None,
        start_line: node.start_position().row + 1,
        end_line: node.end_position().row + 1,
        start_column: node.start_position().column + 1,
        end_column: node.end_position().column + 1,
    });
}

/// Which accepted secret source this node reads, if any.
///
/// The three shapes are exactly the three the line scan recognised - `process.env.X`,
/// `process.env["X"]`, `config.X` and `secretManager.get("X")` - so this narrows *where* a read can
/// be found without widening *what* counts as one. `config["X"]` is left out for that reason: the
/// scan required a literal `config.`, and admitting the subscript form here would be a detection
/// change wearing a correctness fix's clothes.
fn secret_source_kind(node: Node<'_>, source: &[u8]) -> Option<&'static str> {
    match node.kind() {
        "member_expression" => {
            let receiver = receiver_text(node, source)?;
            if receiver_is(&receiver, "process.env") {
                Some(SECRET_SOURCE_ENV)
            } else if receiver_is(&receiver, "config") {
                Some(SECRET_SOURCE_CONFIG)
            } else {
                None
            }
        }
        "subscript_expression" => {
            receiver_is(&receiver_text(node, source)?, "process.env").then_some(SECRET_SOURCE_ENV)
        }
        "call_expression" => {
            let function = node.child_by_field_name("function")?;
            if function.kind() != "member_expression" {
                return None;
            }
            let property = node_text(function.child_by_field_name("property")?, source)?;
            if property != "get" {
                return None;
            }
            let receiver = receiver_text(function, source)?;
            (receiver_is(&receiver, "secretManager") || receiver_is(&receiver, "secret_manager"))
                .then_some(SECRET_SOURCE_SECRET_MANAGER)
        }
        _ => None,
    }
}

/// Whether a receiver names the given accessor, at any qualification.
///
/// B3. The line scan tested `line.contains("config.")`, so `this.config.apiKey` and
/// `globalThis.process.env.API_KEY` matched: any prefix in front was irrelevant to a substring
/// test. S6-01 replaced that with `receiver == "config"`, which silently stopped recognising both -
/// and `this.config` is how every class-based service reads its configuration.
///
/// A SUFFIX on a dot boundary is the tree-shaped spelling of "any prefix is irrelevant". It is
/// deliberately not `contains`, which would make `appConfig.password` a secret read because the
/// letters happen to line up, and not equality, which is the narrowing this repairs.
fn receiver_is(receiver: &str, accessor: &str) -> bool {
    receiver == accessor || receiver.ends_with(&format!(".{accessor}"))
}

/// The `object` of a member or subscript expression with whitespace removed.
///
/// `process\n  .env.API_KEY` is one expression the moment it is parsed, but its object's source
/// text carries the newline and the indentation. Comparing the compacted form is what lets the
/// wrapped spelling be recognised as the same read - the same problem `data_operation_shape`
/// solves by trimming its store segment.
fn receiver_text(node: Node<'_>, source: &[u8]) -> Option<String> {
    compacted_text(node.child_by_field_name("object")?, source)
}

/// A node's source text with all whitespace removed.
fn compacted_text(node: Node<'_>, source: &[u8]) -> Option<String> {
    Some(
        node_text(node, source)?
            .chars()
            .filter(|character| !character.is_whitespace())
            .collect(),
    )
}

fn extract_export(node: Node<'_>, source: &[u8], file_path: &str, facts: &mut Vec<Fact>) {
    let statement = node_text(node, source);
    if let Some(source_value) = node
        .child_by_field_name("source")
        .and_then(|child| node_text(child, source))
        .map(unquote)
        && let Some(statement) = statement.as_deref()
    {
        let start_line = node.start_position().row + 1;
        let end_line = node.end_position().row + 1;
        let start_column = node.start_position().column + 1;
        let end_column = node.end_position().column + 1;
        for identifier in reexport_value_identifiers(statement) {
            // `export * as ns from "m"` exports a NAMESPACE named `ns` - it does not
            // flatten `m`'s exports into this file the way a bare `export *` does. Emit
            // the namespace name as a directly exported symbol of this file (so importers
            // of `ns` resolve here) and keep its ReExportUsed name distinct from `*` so
            // the export-star chain map never descends through it.
            if let Some(namespace_name) = identifier.strip_prefix("* as ") {
                facts.push(Fact {
                    kind: FactKind::ImportUsed,
                    file_path: file_path.to_string(),
                    name: namespace_name.to_string(),
                    value: Some(source_value.clone()),
                    imported_name: Some("*".to_string()),
                    runtime_use: None,
                    start_line,
                    end_line,
                    start_column,
                    end_column,
                });
                facts.push(Fact {
                    kind: FactKind::ReExportUsed,
                    file_path: file_path.to_string(),
                    name: namespace_name.to_string(),
                    value: Some(source_value.clone()),
                    imported_name: Some("*".to_string()),
                    runtime_use: None,
                    start_line,
                    end_line,
                    start_column,
                    end_column,
                });
                facts.push(Fact {
                    kind: FactKind::ExportedSymbol,
                    file_path: file_path.to_string(),
                    name: namespace_name.to_string(),
                    value: None,
                    imported_name: None,
                    runtime_use: None,
                    start_line,
                    end_line,
                    start_column,
                    end_column,
                });
                continue;
            }
            // EW-4: `<source> as <exported>` carries both names. The exported alias is what this
            // module exports; `imported_name` is what must be resolved in the target module. Only
            // recording the alias made a re-export of a default (or of any renamed symbol) look
            // unresolvable in its source.
            let (source_name, exported_name) = match identifier.split_once(" as ") {
                Some((source, exported)) => (Some(source.to_string()), exported.to_string()),
                None => (None, identifier.clone()),
            };
            facts.push(Fact {
                kind: FactKind::ImportUsed,
                file_path: file_path.to_string(),
                name: exported_name.clone(),
                value: Some(source_value.clone()),
                imported_name: source_name.clone(),
                runtime_use: None,
                start_line,
                end_line,
                start_column,
                end_column,
            });
            facts.push(Fact {
                kind: FactKind::ReExportUsed,
                file_path: file_path.to_string(),
                name: exported_name,
                value: Some(source_value.clone()),
                imported_name: source_name,
                runtime_use: None,
                start_line,
                end_line,
                start_column,
                end_column,
            });
        }
    }

    // EW-4: `export default <expression>;` where the expression is not a declaration.
    //
    // `export default prisma;` has no declaration child - the identifier was declared on an
    // earlier line, so `first_named_declaration_identifier` returns None. Before EW-4 the module
    // reported no `default` export at all, and every `import x from "./m"` against it raised
    // `unresolved_import_symbol`.
    //
    // Measured on cal.com: 242 such diagnostics against `packages/prisma/index.ts`, whose line 112
    // is exactly `export default prisma;`. Because that is the *data layer*, every route importing
    // it the ordinary way carried an unresolved symbol on the very import a finding rests on - so
    // the finding stayed withheld and the check refused, on edits as small as adding a comment.
    //
    // Emitted only for an actual `export default`, never for a named export: claiming a default
    // export a module does not have would turn a missing-symbol gap into a wrong answer. Type-only
    // default exports (`export type { X as default }`) are erased and are excluded, matching how
    // every other type-only export is treated here.
    //
    // D2 (ground-truth remediation §5.2): ONE declaration produces ONE fact.
    //
    // This branch used to be gated on the statement having no declaration child, and the branch
    // below emitted a second `(name = <local identifier>, value = None)` fact for the declaration
    // form. That second fact was wrong. `export default function handler()` does not create a
    // named export `handler` - nothing can write `import { handler } from "./orders"` - and
    // `exported_symbols_by_file` (main.rs:2174) keys purely on `fact.name`, so the engine resolved
    // that import against a module exporting no such name. A false resolution, not a duplicate.
    //
    // Canonical model: `name = "default"` (what importers actually bind), `value = <local
    // identifier or None>` (metadata for following the default back to what it names). The gate is
    // gone, so `export default function f() {}`, `export default class C {}`, `export default
    // prisma;` and `export default () => 1` are all one fact of the same shape.
    let default_export_local_name = first_named_declaration_identifier(node, source)
        .or_else(|| default_export_identifier(node, source));
    let is_runtime_default_export = statement
        .as_deref()
        .is_some_and(is_runtime_default_export_statement);

    if is_runtime_default_export {
        facts.push(Fact {
            kind: FactKind::ExportedSymbol,
            file_path: file_path.to_string(),
            name: "default".to_string(),
            // The local binding when there is one (`export default prisma`, `export default
            // function handler()`), so consumers can follow the default back to what it names.
            // Absent for an anonymous expression, where there is nothing to follow - `default` is
            // the whole of what the module exports.
            value: default_export_local_name,
            imported_name: None,
            runtime_use: None,
            start_line: node.start_position().row + 1,
            end_line: node.end_position().row + 1,
            start_column: node.start_position().column + 1,
            end_column: node.end_position().column + 1,
        });
    }

    extract_local_export_list(node, source, file_path, facts);

    if let Some(name) = first_named_declaration_identifier(node, source) {
        let start_line = node.start_position().row + 1;
        let end_line = node.end_position().row + 1;
        let start_column = node.start_position().column + 1;
        let end_column = node.end_position().column + 1;
        // D2: only a NAMED export declares a symbol under its own identifier. The default form's
        // fact was emitted above, under the name importers actually bind.
        if !is_runtime_default_export {
            facts.push(Fact {
                kind: FactKind::ExportedSymbol,
                file_path: file_path.to_string(),
                name: name.clone(),
                value: None,
                imported_name: None,
                runtime_use: None,
                start_line,
                end_line,
                start_column,
                end_column,
            });
        }

        let is_default_export = is_runtime_default_export;

        // In a Next.js pages/api module the request handler is the *default* export.
        // Named exports are not handlers: `export const config = { api: { bodyParser:
        // false } }` is Next.js route configuration (the documented idiom for webhooks
        // and uploads), and files also legitimately export helpers and types.
        //
        // Emitting RouteDeclared for every named export meant such a file produced two
        // route declarations both named "default", which collided into duplicate
        // `normalized_entrypoints` rows and aborted onboarding with a UNIQUE constraint
        // failure (cal.com, papermark). It also polluted method resolution, since
        // `config` was reported as a route method.
        if is_next_pages_api_path(file_path) {
            if is_default_export {
                facts.push(Fact {
                    kind: FactKind::RouteDeclared,
                    file_path: file_path.to_string(),
                    name: "default".to_string(),
                    value: Some(name.clone()),
                    imported_name: None,
                    runtime_use: None,
                    start_line,
                    end_line,
                    start_column,
                    end_column,
                });
            }
        } else if is_api_route_path(file_path)
            && matches!(name.as_str(), "GET" | "POST" | "PUT" | "PATCH" | "DELETE")
        {
            facts.push(Fact {
                kind: FactKind::RouteDeclared,
                file_path: file_path.to_string(),
                name: name.clone(),
                value: None,
                imported_name: None,
                runtime_use: None,
                start_line,
                end_line,
                start_column,
                end_column,
            });
        }
        // D2: the `default` fact for this declaration was emitted above, once, with `name` as its
        // `value`. It used to be emitted a second time from here, alongside the bare-identifier
        // fact - the pair the canonical model replaces.
    }
}

/// D-S2: `export { a, b };` referring to identifiers declared on earlier lines.
///
/// `extract_export` had three fact-producing paths - a list export WITH a `from` source, a bare
/// `export default <expr>`, and an inline declaration on the export node - and none of them saw
/// this one. It is the ordinary way a module publishes helpers declared above, and it produced no
/// `exported_symbol` fact at all. Two distinct symptoms, both worse than a missing fact:
///
///   (a) A file MIXING inline and list exports has a key in `resolver.exported_symbols` from its
///       inline exports, and that key is precisely the condition the conservative-diagnostic gate
///       in main.rs uses to decide absence is provable. So every consumer of a list-exported symbol
///       got a FALSE `unresolved_import_symbol`. On taxonomy, all 8 files importing `{ toast }` or
///       `{ useToast }` from `components/ui/use-toast.ts` were flagged, though TypeScript resolves
///       them without complaint - the file exports `const TOAST_LIMIT` inline and `toast`,
///       `useToast` by list. Those diagnostics feed check completeness, so they withhold findings.
///
///   (b) A file exporting ONLY via bare lists has no key at all, so the gate stays silent: no
///       fact, no gap, no signal. Nothing anywhere says the module was not understood.
///
/// Both contradict what `ts.import_resolution.v1` and `ts.syntax_facts.v1` declare about themselves
/// in packages/core/src/semantic-capabilities.ts - `certification: "certified_deterministic"`,
/// `can_block: true`.
///
/// Read off the AST rather than the statement text, because the text route cannot tell
/// `export { a, b };` from `export const x = { a: 1 };` - both contain a brace pair, and the second
/// would have yielded a phantom export named `a:`.
///
/// Deliberately NOT emitting `RouteDeclared` for `export { GET };`. Re-exported handlers have never
/// produced one either (formbricks' 28 `export { GET } from "@/modules/..."` routes), so adding it
/// here would fix half of a different gap and move route counts on every repo for a reason this
/// change has not measured.
fn extract_local_export_list(
    node: Node<'_>,
    source: &[u8],
    file_path: &str,
    facts: &mut Vec<Fact>,
) {
    // With a source this is a re-export, which the branch at the top of `extract_export` owns.
    if node.child_by_field_name("source").is_some() {
        return;
    }
    let Some(clause) = (0..node.named_child_count())
        .filter_map(|index| node.named_child(index))
        .find(|child| child.kind() == "export_clause")
    else {
        return;
    };
    // `export type { Foo };` is erased at compile time, exactly like `import type`. The whole clause
    // is type-only and there is no field on the node that says so, only the statement text.
    if node_text(node, source)
        .as_deref()
        .is_some_and(|text| text.trim_start().starts_with("export type"))
    {
        return;
    }

    let start_line = node.start_position().row + 1;
    let end_line = node.end_position().row + 1;
    let start_column = node.start_position().column + 1;
    let end_column = node.end_position().column + 1;

    for index in 0..clause.named_child_count() {
        let Some(specifier) = clause.named_child(index) else {
            continue;
        };
        if specifier.kind() != "export_specifier" {
            continue;
        }
        // The per-specifier form, `export { value, type Only };`.
        if node_text(specifier, source)
            .as_deref()
            .is_some_and(|text| text.trim_start().starts_with("type "))
        {
            continue;
        }
        let Some(local_name) = specifier
            .child_by_field_name("name")
            .and_then(|child| node_text(child, source))
        else {
            continue;
        };
        // `export { handler as default };` exports `default`; the alias is what the module publishes.
        let exported_name = specifier
            .child_by_field_name("alias")
            .and_then(|child| node_text(child, source))
            .unwrap_or_else(|| local_name.clone());
        facts.push(Fact {
            kind: FactKind::ExportedSymbol,
            file_path: file_path.to_string(),
            // The local binding when the export is renamed, so consumers can follow the exported
            // name back to what it names - the same convention the default-export branch uses.
            value: (exported_name != local_name).then_some(local_name),
            name: exported_name,
            imported_name: None,
            runtime_use: None,
            start_line,
            end_line,
            start_column,
            end_column,
        });
    }
}

fn import_value_bindings(statement: &str) -> Vec<ImportBinding> {
    let trimmed = statement.trim();
    if !trimmed.starts_with("import ") || trimmed.starts_with("import type ") {
        return Vec::new();
    }

    let mut bindings = Vec::new();
    let import_clause = trimmed
        .trim_start_matches("import")
        .trim()
        .split(" from ")
        .next()
        .unwrap_or("")
        .trim();
    if import_clause.is_empty()
        || import_clause.starts_with('"')
        || import_clause.starts_with('\'')
        || import_clause.starts_with("type ")
    {
        return Vec::new();
    }

    if let Some(named_start) = import_clause.find('{') {
        let default_import = import_clause[..named_start]
            .trim()
            .trim_end_matches(',')
            .trim();
        push_import_binding(&mut bindings, "default", default_import);
        if let Some(named_end) = import_clause[named_start + 1..].find('}') {
            let named_imports = &import_clause[named_start + 1..named_start + 1 + named_end];
            for specifier in named_imports.split(',') {
                let specifier = specifier.trim();
                if specifier.is_empty() || specifier.starts_with("type ") {
                    continue;
                }
                if let Some((imported_name, local_name)) = specifier.split_once(" as ") {
                    push_import_binding(&mut bindings, imported_name, local_name);
                } else {
                    push_import_binding(&mut bindings, specifier, specifier);
                }
            }
        }
    } else if let Some(namespace_name) = import_clause
        .strip_prefix("* as ")
        .and_then(|value| value.split_whitespace().next())
    {
        push_import_binding(&mut bindings, "*", namespace_name);
    } else {
        push_import_binding(
            &mut bindings,
            "default",
            import_clause.trim_end_matches(',').trim(),
        );
    }

    bindings.sort_by(|left, right| {
        left.local_name
            .cmp(&right.local_name)
            .then(left.imported_name.cmp(&right.imported_name))
    });
    bindings.dedup_by(|left, right| {
        left.local_name == right.local_name && left.imported_name == right.imported_name
    });
    bindings
}

fn reexport_value_identifiers(statement: &str) -> Vec<String> {
    let trimmed = statement.trim();
    if !trimmed.starts_with("export ") {
        return Vec::new();
    }
    let export_clause = trimmed
        .trim_start_matches("export")
        .trim()
        .split(" from ")
        .next()
        .unwrap_or("")
        .trim();
    if export_clause.is_empty() || export_clause.starts_with("type ") {
        return Vec::new();
    }
    if let Some(rest) = export_clause.strip_prefix('*') {
        // `export * as ns from "m"`: return the marker `* as ns` so extract_export can
        // treat the namespace re-export differently from a flattening `export *`.
        if let Some(namespace_name) = rest.trim_start().strip_prefix("as ") {
            let name = namespace_name.split_whitespace().next().unwrap_or("");
            if !name.is_empty() && name.chars().all(is_identifier_char) {
                return vec![format!("* as {name}")];
            }
        }
        return vec!["*".to_string()];
    }

    let mut identifiers = Vec::new();
    if let Some(named_start) = export_clause.find('{')
        && let Some(named_end) = export_clause[named_start + 1..].find('}')
    {
        let named_exports = &export_clause[named_start + 1..named_start + 1 + named_end];
        for specifier in named_exports.split(',') {
            let specifier = specifier.trim();
            if specifier.is_empty() || specifier.starts_with("type ") {
                continue;
            }
            if let Some((source_name, exported_name)) = specifier.split_once(" as ") {
                // EW-4: keep BOTH names. The exported alias is what this module exports; the source
                // name is what has to be resolved in the target module, and they are different
                // things. Recording only the alias made `export { default as prisma } from "./m"`
                // claim to import `prisma` from a module that exports only `default`, so the engine
                // reported an unresolved symbol against a barrel that resolves perfectly - the shape
                // every barrel over a default-only data layer is forced to use.
                //
                // Carried as a marker for the same reason `* as ns` is: this function returns names,
                // and threading a pair through every caller to serve one shape would be worse than
                // the marker the caller already knows how to split.
                let source_name = source_name.trim();
                let exported_name = exported_name.trim();
                if !source_name.is_empty()
                    && source_name != exported_name
                    && (source_name == "default" || source_name.chars().all(is_identifier_char))
                {
                    // Pushed directly: `push_import_identifier` keeps only the first
                    // whitespace-separated token, which would reduce the marker to its source name.
                    if exported_name.chars().all(is_identifier_char) {
                        identifiers.push(format!("{source_name} as {exported_name}"));
                    } else {
                        push_import_identifier(&mut identifiers, exported_name);
                    }
                } else {
                    push_import_identifier(&mut identifiers, exported_name);
                }
            } else {
                push_import_identifier(&mut identifiers, specifier);
            }
        }
    }
    identifiers.sort();
    identifiers.dedup();
    identifiers
}

fn push_import_identifier(identifiers: &mut Vec<String>, value: &str) {
    let identifier = value
        .split_whitespace()
        .next()
        .unwrap_or("")
        .trim_matches(',')
        .trim();
    if !identifier.is_empty() && identifier.chars().all(is_identifier_char) {
        identifiers.push(identifier.to_string());
    }
}

fn push_import_binding(bindings: &mut Vec<ImportBinding>, imported_name: &str, local_name: &str) {
    let imported_name = imported_name
        .split_whitespace()
        .next()
        .unwrap_or("")
        .trim_matches(',')
        .trim();
    let local_name = local_name
        .split_whitespace()
        .next()
        .unwrap_or("")
        .trim_matches(',')
        .trim();
    if !imported_name.is_empty()
        && !local_name.is_empty()
        && (imported_name == "*" || imported_name.chars().all(is_identifier_char))
        && local_name.chars().all(is_identifier_char)
    {
        bindings.push(ImportBinding {
            imported_name: imported_name.to_string(),
            local_name: local_name.to_string(),
        });
    }
}

fn is_identifier_char(value: char) -> bool {
    value == '_' || value == '$' || value.is_ascii_alphanumeric()
}

fn callable_parts(node: Node<'_>, source: &[u8]) -> Option<(String, Option<String>)> {
    match node.kind() {
        "identifier" => node_text(node, source).map(|name| (name, None)),
        "member_expression" => {
            let name = node
                .child_by_field_name("property")
                .and_then(|property| node_text(property, source))?;
            let receiver = node
                .child_by_field_name("object")
                .and_then(|object| node_text(object, source));
            Some((name, receiver))
        }
        _ => None,
    }
}

#[cfg(test)]
mod data_operation_shape_tests {
    use super::data_operation_shape;

    #[test]
    fn a_receiver_broken_across_lines_names_the_same_store() {
        let inline = data_operation_shape("prisma.commission", "findMany").expect("shape");
        let wrapped =
            data_operation_shape("prisma.commission\n            ", "findMany").expect("shape");
        assert_eq!(inline.0, "commission");
        // Without the trim these were two different stores, and therefore two graph nodes.
        assert_eq!(inline.0, wrapped.0);
    }

    #[test]
    fn a_whitespace_only_segment_is_not_a_store() {
        assert!(data_operation_shape("prisma.   ", "findMany").is_none());
    }
}

fn data_operation_shape(receiver: &str, operation_name: &str) -> Option<(String, &'static str)> {
    let mut parts = receiver.split('.');
    let _root = parts.next()?;
    // Trimmed because the receiver is raw source text, and a chained call broken across lines
    // carries the newline and indentation into the segment:
    //
    //     prisma.commission
    //         .findMany(...)
    //
    // yielded a store named "commission\n            ", which became its own `data_store` node id.
    // Measured on dub: 96 nodes for 77 distinct stores, so ~9% of the set were whitespace shards of
    // a table that already had a node.
    let store_name = parts.next()?.trim();
    if store_name.is_empty() {
        return None;
    }
    let operation_kind = data_operation_kind(operation_name);
    Some((store_name.to_string(), operation_kind))
}

fn is_data_access_binding(receiver_root: &str, file_path: &str, facts: &[Fact]) -> bool {
    is_data_access_local_name(receiver_root)
        || facts.iter().any(|fact| {
            fact.kind == FactKind::ImportUsed
                && fact.file_path == file_path
                && fact.name == receiver_root
                && fact.value.as_deref().is_some_and(is_data_access_reference)
        })
}

fn is_data_access_local_name(value: &str) -> bool {
    matches!(value, "db" | "prisma" | "database")
}

fn is_data_access_reference(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.contains("prisma")
        || lower.contains("database")
        || lower.contains("/db")
        || lower.ends_with("db")
        || lower.contains("data-access")
        || lower.contains("/repositories/")
        || lower.contains("/repository/")
}

fn receiver_root(receiver: &str) -> &str {
    receiver.split('.').next().unwrap_or(receiver)
}

fn data_operation_kind(operation_name: &str) -> &'static str {
    let lower = operation_name.to_ascii_lowercase();
    if matches!(
        lower.as_str(),
        "find"
            | "findfirst"
            | "findfirstorthrow"
            | "findmany"
            | "findunique"
            | "finduniqueorthrow"
            | "get"
            | "getmany"
            | "select"
            | "query"
            | "count"
            | "aggregate"
            | "groupby"
    ) {
        "read"
    } else if matches!(
        lower.as_str(),
        "create"
            | "createmany"
            | "update"
            | "updatemany"
            | "upsert"
            | "insert"
            | "insertmany"
            | "save"
            | "set"
    ) {
        "write"
    } else if matches!(
        lower.as_str(),
        "delete" | "deletemany" | "remove" | "removemany" | "destroy" | "destroymany"
    ) {
        "delete"
    } else {
        "unknown"
    }
}

/// Whether a statement is a default export that exists at runtime.
///
/// `export default X` does. `export type { X as default }` does not - it is erased, like every other
/// type-only export. The check is on the statement text because tree-sitter models a type-only
/// export clause as an ordinary export statement with a `type` keyword child, and the text is what
/// the rest of this module already reasons about.
fn is_runtime_default_export_statement(statement: &str) -> bool {
    let trimmed = statement.trim_start();
    trimmed.starts_with("export default") && !trimmed.starts_with("export default type ")
}

/// The local binding a bare `export default <identifier>;` names, if it is a plain identifier.
///
/// `None` for anything else - an object literal, an arrow, a call - because there is no binding to
/// name and inventing one would be worse than saying nothing.
fn default_export_identifier(node: Node<'_>, source: &[u8]) -> Option<String> {
    let mut cursor = node.walk();
    node.children(&mut cursor)
        .find(|child| child.kind() == "identifier")
        .and_then(|child| node_text(child, source))
}

fn first_named_declaration_identifier(node: Node<'_>, source: &[u8]) -> Option<String> {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if matches!(
            child.kind(),
            "function_declaration" | "generator_function_declaration" | "class_declaration"
        ) && let Some(name) = child
            .child_by_field_name("name")
            .and_then(|name| node_text(name, source))
        {
            return Some(name);
        }
        if matches!(child.kind(), "lexical_declaration" | "variable_declaration")
            && let Some(name) = first_variable_declaration_identifier(child, source)
        {
            return Some(name);
        }
        if let Some(name) = first_named_declaration_identifier(child, source) {
            return Some(name);
        }
    }
    None
}

fn first_variable_declaration_identifier(node: Node<'_>, source: &[u8]) -> Option<String> {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == "variable_declarator"
            && let Some(name) = child
                .child_by_field_name("name")
                .and_then(|name| node_text(name, source))
        {
            return Some(name);
        }
        if let Some(name) = first_variable_declaration_identifier(child, source) {
            return Some(name);
        }
    }
    None
}

fn node_text(node: Node<'_>, source: &[u8]) -> Option<String> {
    node.utf8_text(source).ok().map(ToOwned::to_owned)
}

fn unquote(value: String) -> String {
    value.trim_matches('"').trim_matches('\'').to_string()
}

/// CV-2: which flavour of route this file is, from its path segments below the api boundary.
///
/// dub's 494 route files are 358 app, 111 cron and 25 webhook. Cron and webhook routes authenticate by
/// signature rather than session, so a session convention scored against one global denominator either
/// has its confidence dragged down by routes it was never about or, accepted, flags every cron route as
/// missing auth.
///
/// Emitted as a fact so the candidate deriver reads a classification instead of matching globs itself -
/// the deriver getting its own glob engine is the BB-11 divergence in a new place. The TypeScript side
/// has one predicate for this, `routeFlavor` in packages/core/src/convention-scope.ts, and the two are
/// held together by a differential test rather than by shared code, which the process boundary does not
/// allow. The names are the existing entrypoint-kind vocabulary rather than new strings.
///
/// Per SEGMENT, never substring: `app/api/crontab-editor/route.ts` is an ordinary route.
pub fn route_flavor(file_path: &str) -> RouteFlavor {
    const CRON_SEGMENTS: &[&str] = &["cron", "crons", "jobs", "scheduled"];
    const WEBHOOK_SEGMENTS: &[&str] = &["webhook", "webhooks"];

    let lower = file_path.to_ascii_lowercase();
    let all = lower.split('/').collect::<Vec<_>>();
    // Only segments below the route root decide flavour: a repo mounted under `apps/cron-service/`
    // does not make every route inside it a cron job.
    //
    // D-H2 made the `None` arm reachable for real paths, and it was wrong: it fell back to the WHOLE
    // path, so `apps/cron/app/wellknown/route.ts` - a route handler in a repo whose app directory is
    // called `cron` - would have been classified `cron_job` and dropped out of the session family's
    // denominator. `app` is the route root when there is no `api` below it, so it is the boundary.
    let route_root = all
        .iter()
        .rposition(|segment| *segment == "api")
        .or_else(|| all.iter().rposition(|segment| *segment == "app"));
    let below = match route_root {
        Some(index) => &all[index + 1..],
        None => &all[..],
    };
    let segments = below
        .iter()
        // Next route groups - `(ee)`, `(admin)` - are organisational and carry no flavour.
        .filter(|segment| !(segment.starts_with('(') && segment.ends_with(')')))
        .map(|segment| {
            segment
                .strip_suffix(".ts")
                .or_else(|| segment.strip_suffix(".tsx"))
                .or_else(|| segment.strip_suffix(".js"))
                .or_else(|| segment.strip_suffix(".jsx"))
                .unwrap_or(segment)
        })
        .collect::<Vec<_>>();

    if segments
        .iter()
        .any(|segment| CRON_SEGMENTS.contains(segment))
    {
        return RouteFlavor::CronJob;
    }
    if segments
        .iter()
        .any(|segment| WEBHOOK_SEGMENTS.contains(segment))
    {
        return RouteFlavor::WebhookHandler;
    }
    RouteFlavor::ApiRoute
}

fn file_roles(file_path: &str) -> Vec<FileRole> {
    let mut roles = Vec::new();
    if is_api_route_path(file_path) {
        roles.push(FileRole::ApiRoute);
    }
    if is_service_module_path(file_path) {
        roles.push(FileRole::ServiceModule);
    }
    if is_data_access_module_path(file_path) {
        roles.push(FileRole::DataAccessModule);
    }
    if is_cli_command_module_path(file_path) {
        roles.push(FileRole::CliCommandModule);
    }
    if is_core_module_path(file_path) {
        roles.push(FileRole::CoreModule);
    }
    if is_query_module_path(file_path) {
        roles.push(FileRole::QueryModule);
    }
    if is_factgraph_module_path(file_path) {
        roles.push(FileRole::FactgraphModule);
    }
    if is_adapter_module_path(file_path) {
        roles.push(FileRole::AdapterModule);
    }
    if is_storage_module_path(file_path) {
        roles.push(FileRole::StorageModule);
    }
    if is_engine_bridge_module_path(file_path) {
        roles.push(FileRole::EngineBridgeModule);
    }
    if is_mcp_module_path(file_path) {
        roles.push(FileRole::McpModule);
    }
    if is_test_path(file_path) {
        roles.push(FileRole::Test);
    }
    if is_config_path(file_path) {
        roles.push(FileRole::Config);
    }
    roles
}

fn is_api_route_path(file_path: &str) -> bool {
    next_api_route_identity(file_path).is_some()
}

fn is_next_pages_api_path(file_path: &str) -> bool {
    next_api_route_identity(file_path)
        .is_some_and(|identity| identity.framework == "next_pages_api")
}

fn is_service_module_path(file_path: &str) -> bool {
    path_segments(file_path)
        .iter()
        .any(|segment| matches!(segment.as_str(), "service" | "services"))
        || file_path.ends_with(".service.ts")
        || file_path.ends_with(".service.tsx")
        || file_path.ends_with(".service.js")
        || file_path.ends_with(".service.jsx")
}

fn is_data_access_module_path(file_path: &str) -> bool {
    let segments = path_segments(file_path);
    segments.iter().any(|segment| {
        matches!(
            segment.as_str(),
            "db" | "database" | "data-access" | "repositories" | "repository"
        )
    }) || file_path.ends_with("/db.ts")
        || file_path.ends_with("/db.tsx")
        || file_path.ends_with("/database.ts")
        || file_path.ends_with("/database.tsx")
        || file_path.ends_with("/prisma.ts")
        || file_path.ends_with("/prisma.tsx")
}

fn is_cli_command_module_path(file_path: &str) -> bool {
    file_path.contains("/cli/src/commands/") || file_path.starts_with("packages/cli/src/commands/")
}

fn is_core_module_path(file_path: &str) -> bool {
    file_path.contains("/core/src/") || file_path.starts_with("packages/core/src/")
}

fn is_query_module_path(file_path: &str) -> bool {
    file_path.contains("/query/src/") || file_path.starts_with("packages/query/src/")
}

fn is_factgraph_module_path(file_path: &str) -> bool {
    file_path.contains("/factgraph/src/") || file_path.starts_with("packages/factgraph/src/")
}

fn is_adapter_module_path(file_path: &str) -> bool {
    file_path.contains("/adapters/") && file_path.contains("/src/")
}

fn is_storage_module_path(file_path: &str) -> bool {
    file_path.contains("/storage/src/") || file_path.starts_with("packages/storage/src/")
}

fn is_engine_bridge_module_path(file_path: &str) -> bool {
    file_path.contains("/cli/src/engine/") || file_path.starts_with("packages/cli/src/engine/")
}

fn is_mcp_module_path(file_path: &str) -> bool {
    file_path.contains("/mcp/src/") || file_path.starts_with("packages/mcp/src/")
}

fn is_test_path(file_path: &str) -> bool {
    let lower = file_path.to_ascii_lowercase();
    lower.contains("/test/")
        || lower.contains("/tests/")
        || lower.ends_with(".test.ts")
        || lower.ends_with(".test.tsx")
        || lower.ends_with(".spec.ts")
        || lower.ends_with(".spec.tsx")
        || lower.ends_with(".test.js")
        || lower.ends_with(".spec.js")
}

fn is_config_path(file_path: &str) -> bool {
    let file_name = file_path
        .rsplit('/')
        .next()
        .unwrap_or(file_path)
        .to_ascii_lowercase();
    file_name.contains(".config.")
        || matches!(
            file_name.as_str(),
            "vite.config.ts"
                | "vitest.config.ts"
                | "eslint.config.js"
                | "eslint.config.mjs"
                | "next.config.js"
                | "next.config.mjs"
                | "next.config.ts"
        )
}

fn path_segments(file_path: &str) -> Vec<String> {
    file_path
        .split('/')
        .map(|segment| segment.to_ascii_lowercase())
        .collect()
}

#[cfg(test)]
mod ast_depth_tests {
    use super::*;

    /// A minified bundle must be refused, not crashed on.
    ///
    /// Reproduced before this guard existed: a 129 KB `public/js/vendor.min.js` holding one
    /// 20,000-term `+` chain aborted the entire scan with `fatal runtime error: stack overflow`,
    /// exit 1, no database written, and every rerun failing identically. `public/` is not skipped
    /// and `.js` is indexed, so this is ordinary repository content.
    #[test]
    fn refuses_a_tree_too_deep_to_walk_instead_of_overflowing() {
        let chain = (0..20_000)
            .map(|index| format!("a{index}"))
            .collect::<Vec<_>>()
            .join("+");
        let source = format!("var z={chain};\n");

        let error = extract_typescript_facts("public/js/vendor.min.js", &source)
            .expect_err("a 20,000-deep expression must be refused");

        assert!(matches!(error, FactExtractError::TooDeep { .. }));
        // The caller turns Err into a recorded skip plus incomplete repo completeness, so the
        // message has to say what the reader should do about it.
        assert!(error.to_string().contains("minified"));
    }

    /// The guard must not fire on real source, or it trades a crash for silent recall loss.
    #[test]
    fn ordinary_source_is_nowhere_near_the_depth_limit() {
        let source = r#"
            import { prisma } from "@/lib/prisma";
            export async function GET() {
              const rows = await prisma.user.findMany({ where: { active: true } });
              return Response.json(rows.map((row) => ({ ...row, seen: true })));
            }
        "#;

        let facts = extract_typescript_facts("app/api/users/route.ts", source)
            .expect("ordinary source must parse");
        assert!(facts.iter().any(|fact| fact.kind == FactKind::ImportUsed));
    }
}

#[cfg(test)]
mod export_alias_analysis_tests {
    use super::*;

    fn facts_of(source: &str) -> Vec<Fact> {
        extract_typescript_facts("lib/launder.ts", source).expect("fixture must parse")
    }

    /// The two new kinds, rendered as `kind(name, specifier, imported_name)` so an expectation
    /// reads the way the fact does.
    fn laundering(source: &str) -> Vec<String> {
        facts_of(source)
            .into_iter()
            .filter(|fact| {
                matches!(
                    fact.kind,
                    FactKind::ExportAliasesImport | FactKind::ExportWrapsImport
                )
            })
            .map(|fact| {
                format!(
                    "{}({}, {}, {})",
                    fact.kind.as_wire(),
                    fact.name,
                    fact.value.unwrap_or_else(|| "-".to_string()),
                    fact.imported_name.unwrap_or_else(|| "-".to_string()),
                )
            })
            .collect()
    }

    /// Assert a shape emits nothing, and say why it is a deliberate miss rather than an oversight.
    fn emits_nothing(reason: &str, source: &str) {
        assert_eq!(
            laundering(source),
            Vec::<String>::new(),
            "expected no laundering fact ({reason}) for:\n{source}"
        );
    }

    // ---- E04: the exported name IS the import -------------------------------------------------

    #[test]
    fn a_const_bound_to_an_import_is_an_alias() {
        assert_eq!(
            laundering("import { db } from \"./db\";\nexport const client = db;\n"),
            vec!["export_aliases_import(client, ./db, db)"]
        );
    }

    /// E04b. One token away from the barrel, and on the wrong side of the `source`-field test.
    #[test]
    fn a_detached_export_clause_is_an_alias() {
        assert_eq!(
            laundering("import { db } from \"./db\";\nexport { db };\n"),
            vec!["export_aliases_import(db, ./db, db)"]
        );
    }

    /// EW-4's reasoning: the alias is what this module publishes, the source name is what has to
    /// resolve in the target. Recording only one of them loses a renamed export.
    #[test]
    fn a_renamed_detached_export_keeps_both_names() {
        assert_eq!(
            laundering("import { db } from \"./db\";\nexport { db as client };\n"),
            vec!["export_aliases_import(client, ./db, db)"]
        );
    }

    #[test]
    fn a_renamed_import_resolves_to_the_source_symbol_not_the_local_one() {
        assert_eq!(
            laundering("import { db as prisma } from \"./db\";\nexport { prisma as client };\n"),
            vec!["export_aliases_import(client, ./db, db)"]
        );
    }

    #[test]
    fn a_default_export_of_an_import_is_an_alias() {
        assert_eq!(
            laundering("import { db } from \"./db\";\nexport default db;\n"),
            vec!["export_aliases_import(default, ./db, db)"]
        );
    }

    /// The span is the EXPORT statement. The import is on line 1 and says nothing about
    /// laundering; line 2 is the evidence a reader has to be shown.
    #[test]
    fn the_span_is_the_laundering_line_not_the_import() {
        let fact = facts_of("import { db } from \"./db\";\nexport const client = db;\n")
            .into_iter()
            .find(|fact| fact.kind == FactKind::ExportAliasesImport)
            .expect("alias fact");
        assert_eq!((fact.start_line, fact.end_line), (2, 2));
        assert_eq!((fact.start_column, fact.end_column), (1, 26));
    }

    // ---- E05: every return of the exported function IS the import -----------------------------

    #[test]
    fn a_function_returning_only_the_import_is_a_wrap() {
        assert_eq!(
            laundering(
                "import { db } from \"./db\";\nexport function getClient() {\n  return db;\n}\n"
            ),
            vec!["export_wraps_import(getClient, ./db, db)"]
        );
    }

    #[test]
    fn a_const_arrow_returning_only_the_import_is_a_wrap() {
        assert_eq!(
            laundering("import { db } from \"./db\";\nexport const getClient = () => db;\n"),
            vec!["export_wraps_import(getClient, ./db, db)"]
        );
    }

    #[test]
    fn a_const_function_expression_returning_only_the_import_is_a_wrap() {
        assert_eq!(
            laundering(
                "import { db } from \"./db\";\nexport const getClient = function () { return db; };\n"
            ),
            vec!["export_wraps_import(getClient, ./db, db)"]
        );
    }

    /// Two returns are fine when they are the same binding - the claim is still one identity.
    #[test]
    fn several_returns_of_the_same_binding_are_still_a_wrap() {
        assert_eq!(
            laundering(
                "import { db } from \"./db\";\nexport function getClient(flag) {\n  if (flag) { return db; }\n  return db;\n}\n"
            ),
            vec!["export_wraps_import(getClient, ./db, db)"]
        );
    }

    /// `export default function f()` exports `default`; nothing can import `f` by name, and
    /// naming it here would produce a symbol no consumer could resolve.
    #[test]
    fn a_default_exported_function_is_named_default() {
        assert_eq!(
            laundering(
                "import { db } from \"./db\";\nexport default function f() { return db; }\n"
            ),
            vec!["export_wraps_import(default, ./db, db)"]
        );
    }

    // ---- Deliberate misses. Each is a shape this pass refuses to claim. -----------------------

    /// Trap 2. The alias claim is true on line 2 and false on line 3, and this pass has no flow
    /// sensitivity to say which line a consumer reaches.
    #[test]
    fn a_reassigned_let_is_not_an_alias() {
        emits_nothing(
            "trap 2: the binding is written over later in the file",
            "import { db } from \"./db\";\nexport let client = db;\nclient = safeWrapper;\n",
        );
    }

    /// Trap 3. The returned `db` is the local, not the import.
    #[test]
    fn a_shadowed_local_is_not_a_wrap() {
        emits_nothing(
            "trap 3: the body declares its own `db`",
            "import { db } from \"./db\";\nexport function getClient() {\n  const db = local();\n  return db;\n}\n",
        );
    }

    #[test]
    fn a_shadowing_parameter_is_not_a_wrap() {
        emits_nothing(
            "trap 3: the parameter shadows the import",
            "import { db } from \"./db\";\nexport function getClient(db) {\n  return db;\n}\n",
        );
    }

    #[test]
    fn a_member_expression_is_not_an_alias() {
        emits_nothing(
            "the fact model has no member path, so naming `user` would be invented evidence",
            "import { db } from \"./db\";\nexport const q = db.user;\n",
        );
    }

    /// Trap 7. A namespace member is the same gap as any other member expression, and must not
    /// fall through into the declarator rule by accident.
    #[test]
    fn a_namespace_member_is_not_an_alias() {
        emits_nothing(
            "trap 7: `ns.db` is a member expression, not a bare binding",
            "import * as ns from \"./db\";\nexport const client = ns.db;\n",
        );
    }

    #[test]
    fn an_object_literal_is_not_an_alias() {
        emits_nothing(
            "property laundering needs an object-shape relation this pass does not have",
            "import { db } from \"./db\";\nexport const api = { db };\n",
        );
    }

    /// Trap 5, clause form. Erased at compile time; it cannot carry a value at runtime.
    #[test]
    fn a_type_only_export_clause_is_not_an_alias() {
        emits_nothing(
            "trap 5: `export type { ... }` is erased",
            "import { db } from \"./db\";\nexport type { db };\n",
        );
    }

    /// Trap 5, per-specifier form.
    #[test]
    fn a_type_only_specifier_is_not_an_alias() {
        emits_nothing(
            "trap 5: the `type ` prefix erases this specifier",
            "import { db } from \"./db\";\nexport { type db };\n",
        );
    }

    #[test]
    fn a_plain_local_is_not_an_alias() {
        emits_nothing(
            "negative control: nothing was imported",
            "export const x = 1;\n",
        );
    }

    /// A type-only import produces no `import_used` fact at all, so it is absent from the binding
    /// table by construction rather than by a second exclusion rule.
    #[test]
    fn a_binding_from_a_type_only_import_is_not_an_alias() {
        emits_nothing(
            "a type-only import cannot launder a value",
            "import type { Db } from \"./db\";\nexport const client = Db;\n",
        );
    }

    #[test]
    fn an_inline_type_only_import_specifier_is_not_an_alias() {
        emits_nothing(
            "the inline `type` specifier is erased just like the statement form",
            "import { type Db } from \"./db\";\nexport const client = Db;\n",
        );
    }

    /// An `async` function returns a Promise. Saying it returns the client is a claim about types
    /// this engine does not make.
    #[test]
    fn an_async_function_is_not_a_wrap() {
        emits_nothing(
            "an async function returns a Promise, not the binding",
            "import { db } from \"./db\";\nexport async function getClient() {\n  return db;\n}\n",
        );
    }

    #[test]
    fn an_async_arrow_is_not_a_wrap() {
        emits_nothing(
            "an async arrow returns a Promise, not the binding",
            "import { db } from \"./db\";\nexport const getClient = async () => db;\n",
        );
    }

    #[test]
    fn a_generator_is_not_a_wrap() {
        emits_nothing(
            "a generator returns an iterator, not the binding",
            "import { db } from \"./db\";\nexport function* getClient() {\n  return db;\n}\n",
        );
    }

    #[test]
    fn a_generator_function_expression_is_not_a_wrap() {
        emits_nothing(
            "a generator returns an iterator, not the binding",
            "import { db } from \"./db\";\nexport const getClient = function* () { return db; };\n",
        );
    }

    #[test]
    fn two_returns_of_different_identifiers_are_not_a_wrap() {
        emits_nothing(
            "the exported name is not one binding, and picking either would be a coin toss",
            "import { db } from \"./db\";\nimport { other } from \"./other\";\nexport function getClient(flag) {\n  if (flag) { return db; }\n  return other;\n}\n",
        );
    }

    #[test]
    fn a_conditional_return_of_something_else_is_not_a_wrap() {
        emits_nothing(
            "one branch returns something that is not the binding; that needs the control-flow tier",
            "import { db } from \"./db\";\nexport function getClient(flag) {\n  if (flag) { return db; }\n  return fallback();\n}\n",
        );
    }

    #[test]
    fn returning_a_call_is_not_a_wrap() {
        emits_nothing(
            "`getDb()` is a call; what it returns is not decidable here",
            "import { db } from \"./db\";\nexport function getClient() {\n  return getDb();\n}\n",
        );
    }

    #[test]
    fn returning_a_member_is_not_a_wrap() {
        emits_nothing(
            "`db.client` is a member expression, the same gap as `export const q = db.user`",
            "import { db } from \"./db\";\nexport function getClient() {\n  return db.client;\n}\n",
        );
    }

    /// Trap 4. The `return db` belongs to the callback, not to `getClient`, which returns
    /// `undefined`. A naive subtree walk claims the opposite.
    #[test]
    fn a_return_from_a_nested_callback_only_is_not_a_wrap() {
        emits_nothing(
            "trap 4: the return belongs to the inner arrow, not the exported function",
            "import { db } from \"./db\";\nexport function getClient(items) {\n  items.map(() => db);\n}\n",
        );
    }

    #[test]
    fn a_function_with_no_return_is_not_a_wrap() {
        emits_nothing(
            "there is nothing to be a pass-through of",
            "import { db } from \"./db\";\nexport function getClient() {\n  log(db);\n}\n",
        );
    }

    #[test]
    fn a_bare_return_is_not_a_wrap() {
        emits_nothing(
            "`return;` hands back undefined",
            "import { db } from \"./db\";\nexport function getClient(flag) {\n  if (flag) { return; }\n  return db;\n}\n",
        );
    }

    /// A re-export already carries its own `source`, is already modelled as `re_export_used`, and
    /// emitting here would double-count the same laundering.
    #[test]
    fn a_barrel_reexport_is_left_to_the_reexport_branch() {
        emits_nothing(
            "the `source` field makes this a re-export, already modelled",
            "export { db } from \"./db\";\n",
        );
    }

    /// Two declarators make the pairing of exported name to bound value something this pass would
    /// have to guess at, and no observed shape needs it.
    #[test]
    fn several_declarators_in_one_statement_are_not_an_alias() {
        emits_nothing(
            "one declarator is what makes the name/value pairing unambiguous",
            "import { db } from \"./db\";\nexport const a = db, b = db;\n",
        );
    }

    #[test]
    fn a_destructuring_pattern_is_not_an_alias() {
        emits_nothing(
            "a destructured binding is a shape this pass cannot describe",
            "import { deps } from \"./db\";\nexport const { db } = deps;\n",
        );
    }
}
