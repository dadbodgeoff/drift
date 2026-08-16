// D-S2 symptom (a): a file MIXING inline and list exports. The inline `TOAST_LIMIT` gives it a key
// in the resolver's exported_symbols, which is the condition the conservative gate uses to decide
// absence is provable - so every consumer of `toast` or `useToast` got a false
// unresolved_import_symbol. This is taxonomy's real components/ui/use-toast.ts shape, where 8 files
// import from it and all 8 were flagged.
export const TOAST_LIMIT = 1;

function toast(message: string) {
  return { id: String(Date.now()), message };
}

function useToast() {
  return { toast };
}

export { toast, useToast };
