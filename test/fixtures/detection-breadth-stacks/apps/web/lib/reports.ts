// D-S2 symptom (a): a file MIXING an inline export with a bare export list. The inline export gives
// it a key in the resolver's exported_symbols, and that key is exactly what makes absence look
// provable - so before W7 every consumer of `listReports` got a FALSE unresolved_import_symbol.
// On taxonomy this shape produced all 8 of the repo's diagnostics from one file.
//
// A service module, not a data layer: the route that imports it is the properly-layered control.
export const REPORT_LIMIT = 50;

async function listReports() {
  return Array.from({ length: REPORT_LIMIT }, (_value, index) => ({ id: index }));
}

function reportCount() {
  return REPORT_LIMIT;
}

export { listReports, reportCount };
