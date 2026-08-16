// NEAR-MISS (TDD §4.3). The name carries the auth signal — `withAuthorHat` starts with
// `with` and contains `auth`, so `is_auth_candidate_symbol` nominates it — while the
// CONTENT contradicts it completely: this decorates a response with a byline and checks
// nothing. It resolves to a different module, so `dominant_family_key` must not let it
// join the auth family, and routes that call only it must still be flagged.
export function withAuthorHat(handler) {
  return function wrapped(req, res) {
    const byline = { author: "staff", hat: "editorial" };
    return handler(req, res, byline);
  };
}
