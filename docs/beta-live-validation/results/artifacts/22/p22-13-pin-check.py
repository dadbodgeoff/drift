import json
pkg = json.load(open("package.json"))
scripts = pkg.get("scripts", {})
pins = {
    "private": (pkg.get("private"), True),
    "packageManager": (pkg.get("packageManager"), "pnpm@10.28.0"),
    "engines.node": (pkg.get("engines",{}).get("node"), ">=20.0.0"),
    "scripts.verify": (scripts.get("verify"), "pnpm build:engine && pnpm build && pnpm typecheck && pnpm test && pnpm test:e2e"),
    "scripts.verify:ci": (scripts.get("verify:ci"), "pnpm verify && pnpm test:harness && pnpm format:engine:check && pnpm lint:engine && pnpm check:boundaries && pnpm check:storage-lifecycle && pnpm check:storage-invariants && pnpm check:error-contract && pnpm check:vocabulary && pnpm check:surface-parity && pnpm check:payload-invariants && pnpm check:cell-ledger && pnpm check:engine-schema-parity && node scripts/validate-engine-release-matrix.mjs --allow-unverified && pnpm validate:claims && pnpm beta:proof && git diff --check"),
    "scripts.verify:evals": (scripts.get("verify:evals"), "pnpm eval:external && pnpm eval:breadth && pnpm eval:evasion && pnpm eval:bench && pnpm eval:presence && pnpm eval:determinism"),
    "scripts.verify:full": (scripts.get("verify:full"), "pnpm verify:ci && pnpm verify:evals"),
}
mismatches = sum(1 for k,(a,e) in pins.items() if a != e)
print(f"{mismatches} mismatch(es) out of {len(pins)} pins checked")
