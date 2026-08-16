// D-S2 symptom (b): a file exporting ONLY via a bare list has no key in exported_symbols at all, so
// the gate stays silent. No fact, no gap, no signal - nothing anywhere says the module was not
// understood. Renamed and type-only specifiers are here because they are the shapes a text-based
// reading gets wrong.
const alpha = 1;

function beta() {
  return alpha;
}

type Gamma = { value: number };

export { alpha, beta as betaFn, type Gamma };
