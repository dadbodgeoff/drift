//! The scan path's validator registry — the thing that makes `request_validation_called`
//! obtainable at all.
//!
//! Before this, the scan path called the 3-arg `extract_security_facts`, whose wrapper hard-codes
//! an empty validator slice. `request_validation_called` is emitted only for calls matching an
//! accepted validator, so the kind had zero instances in every repo Drift had ever scanned. The
//! proposer's request-validation family sources that kind and nothing else, so the family could
//! never form, so no candidate of the kind ever carried `enforcement_semantics: "presence"`, so
//! `presence_findings` was structurally unreachable for it.
//!
//! These tests hold the extractor-level half down. The workflow half — proposer emits the family,
//! a human accepts it in block mode, the check flags the unvalidated handler and exits 2 — is
//! `test/e2e/gt-canary.test.ts > request-validation presence family fires per handler`.

use drift_engine::{
    AcceptedRequestValidator, FactKind, RequestValidatorKind,
    extract_security_facts_with_validation, extract_typescript_facts, scan_time_request_validators,
};

fn validators_for(source: &str) -> Vec<AcceptedRequestValidator> {
    let facts = extract_typescript_facts("app/api/orders/route.ts", source).expect("ts facts");
    scan_time_request_validators(&facts)
}

fn symbols_for(source: &str) -> Vec<String> {
    validators_for(source)
        .into_iter()
        .map(|validator| validator.symbol)
        .collect()
}

/// A route that imports the symbol it calls — the minimum shape the registry accepts.
fn route_calling(symbol: &str) -> String {
    format!(
        r#"
import {{ {symbol} }} from "@/server/validation";

export async function POST(request: Request) {{
  const body = await request.json();
  const parsed = {symbol}(body);
  return Response.json({{ parsed }});
}}
"#
    )
}

/// The shape table this registry shares with `is_validation_candidate_symbol`
/// (`candidate_command.rs`), asserted case by case.
///
/// They are two functions rather than one only because that one is private to a module this change
/// is not permitted to edit. If a future change moves the proposer's table, this test is where the
/// divergence shows up — and divergence matters in a specific way: the family's nominator is
/// `always_candidate_symbol`, so every symbol carrying this fact kind joins the family. This
/// predicate is the only narrowing there is.
#[test]
fn scan_time_validator_shapes_match_the_proposer_table() {
    for symbol in ["validateBody", "validateQuery", "bodyValidator"] {
        assert!(
            !validators_for(&route_calling(symbol)).is_empty(),
            "`{symbol}` is a shape the proposer nominates and the scanner must recognise it"
        );
    }

    // The exclusions. `revalidate*` is Next.js cache revalidation; `*permission*` and `*role*`
    // belong to the authorization family. Admitting any of them would put a non-validator into a
    // family whose acceptance then reads as "this route validates its input".
    for symbol in [
        "revalidatePath",
        "revalidateTag",
        "hasPermission",
        "checkPermissions",
        "requireRole",
        "assertRoles",
    ] {
        assert!(
            validators_for(&route_calling(symbol)).is_empty(),
            "`{symbol}` is excluded by the proposer's table and must not become a validator"
        );
    }

    // Unrelated calls stay out, which is what keeps the family from becoming the 89-member dub
    // aggregate that `FAMILY_SPECS` documents as the reason `symbol_called` was excluded there.
    for symbol in [
        "bulkDeleteLinks",
        "addDomainToVercel",
        "capitalize",
        "nanoid",
    ] {
        assert!(
            validators_for(&route_calling(symbol)).is_empty(),
            "`{symbol}` is not a validation shape"
        );
    }
}

/// The registry requires an import, and `safeParse` is the case that makes it matter.
///
/// The consumer of this fact is the family, and `family_member_inputs` drops any symbol whose
/// `dominant_import_source` is `None` — so an unimported symbol can never be a member. It is not
/// inert either: a second, older per-symbol loop over `request_validation_called` emits a candidate
/// that the live `symbol_called` path already emits under the same id, so registering an
/// unimportable symbol buys a duplicate candidate and no family member.
///
/// `safeParse` is exactly that: always written `Schema.safeParse(body)`, never imported. It is also
/// the sibling proof cell's symbol, and that cell re-extracts with the accepted schema at check
/// time — it never wanted a scanned fact.
#[test]
fn only_imported_helpers_register_and_schema_methods_do_not() {
    let source = r#"
import { validateBody } from "@/server/validation";
import { OrderSchema } from "@/server/schemas";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = validateBody(body);
  const result = OrderSchema.safeParse(body);
  return Response.json({ parsed, result });
}
"#;
    assert_eq!(symbols_for(source), vec!["validateBody"]);

    let validator = &validators_for(source)[0];
    // Always a free function here, so the `Helper` arm of `accepted_request_validator_for_call` —
    // which requires a call with no receiver — is the one that can match.
    assert_eq!(validator.kind, RequestValidatorKind::Helper);
    // The id shape the proposer writes into `requires.validators`, so a family accepted from these
    // facts names its members the way the rest of the pipeline expects.
    assert_eq!(validator.validator_id, "validator:validateBody");

    // A locally-defined helper of the right name is not registered either: same reason, no import
    // to resolve, so it could never join a family.
    let local = r#"
function validateBody(input: unknown) { return input; }

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = validateBody(body);
  return Response.json({ parsed });
}
"#;
    assert!(validators_for(local).is_empty());
}

/// The regression itself, stated as the difference the empty slice makes.
///
/// This is the extractor-level mutation control: the `&[]` the scan path used to pass produces no
/// fact, the derived registry produces one. Same source, same extractor, one argument apart.
#[test]
fn the_empty_validator_slice_is_what_suppressed_the_fact() {
    let source = r#"
import { validateBody } from "@/server/validation";

const db = { order: { create: async (input: unknown) => input } };

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = validateBody(body);
  await db.order.create({ data: parsed });
  return Response.json({ ok: true });
}
"#;

    let suppressed =
        extract_security_facts_with_validation("app/api/orders/route.ts", source, &[], &[])
            .expect("security facts");
    assert!(
        !suppressed
            .iter()
            .any(|fact| fact.kind == FactKind::RequestValidationCalled),
        "the empty slice is the bug: no accepted validator, so no fact, so no family, so the \
         presence path is unreachable"
    );

    let recognised = extract_security_facts_with_validation(
        "app/api/orders/route.ts",
        source,
        &[],
        &validators_for(source),
    )
    .expect("security facts");

    let validation = recognised
        .iter()
        .find(|fact| fact.kind == FactKind::RequestValidationCalled)
        .expect("the derived registry must make the fact obtainable");
    assert_eq!(validation.name, "validateBody");
    let value = validation.value.as_deref().expect("fact value");
    assert!(value.contains("\"input_var\":\"body\""), "{value}");
    assert!(value.contains("\"result_var\":\"parsed\""), "{value}");
    // Not a guess. A recognised shape says a validation call happened; it says nothing about
    // whether the helper throws, returns a parsed value or returns a boolean. Acceptance pins the
    // contract down later, and the proof path reads it from the accepted convention.
    assert!(value.contains("\"behavior\":\"unknown\""), "{value}");
}

/// A route with no validation-shaped call registers nothing, so scanning an ordinary repo is
/// unchanged — which the corpus census confirms: the fix adds exactly two fact kinds
/// (`request_validation_called`, `validated_input_used`) and moves no other count.
#[test]
fn a_route_with_no_validation_shape_registers_nothing() {
    let source = r#"
const db = { order: { create: async (input: unknown) => input } };

export async function POST(request: Request) {
  const body = await request.json();
  await db.order.create({ data: body });
  return Response.json({ ok: true });
}
"#;
    assert!(validators_for(source).is_empty());
    assert!(
        !extract_security_facts_with_validation(
            "app/api/orders/route.ts",
            source,
            &[],
            &validators_for(source),
        )
        .expect("security facts")
        .iter()
        .any(|fact| fact.kind == FactKind::RequestValidationCalled)
    );
}

/// The registry is a deduplicated, ordered function of the file's own calls — the scan writes these
/// facts into the database the proposer later reads, so order-instability would churn candidate ids.
#[test]
fn the_registry_is_deduplicated_and_ordered() {
    let source = r#"
import { validateQuery } from "@/server/validation";
import { validateBody } from "@/server/validation";

export async function POST(request: Request) {
  const body = await request.json();
  const a = validateBody(body);
  const b = validateBody(body);
  const c = validateQuery(body);
  return Response.json({ a, b, c });
}
"#;
    assert_eq!(symbols_for(source), vec!["validateBody", "validateQuery"]);
}
