// Documentation helper for a migration guide. The name states that this module does NOT
// touch the data layer, and a bare `contains("data-access")` matched it anyway.
export function describeNoDataAccessHere() {
  return "This module performs no data access.";
}
