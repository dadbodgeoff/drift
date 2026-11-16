// A review decision in the Conventions view (accept, reject, exempt, answer) must refresh the
// promote list and the funnel too: both are cached with staleTime Infinity, so without this a
// rejected promoted practice stays under "Already promoted" with the old declined count.
import { describe, expect, it } from "vitest";
import { keys, reviewDecisionKeys } from "@/entities/drift";

describe("the queries a review decision invalidates", () => {
  it("include the policy, check, history, promote list and funnel of that repository", () => {
    const repo = { path: "/r", name: "r" };
    const got = reviewDecisionKeys(repo).map((k) => JSON.stringify(k));
    for (const k of [keys.policy(repo), keys.check(repo), keys.history(repo), keys.promoteList(repo), keys.funnel(repo)]) {
      expect(got).toContain(JSON.stringify(k));
    }
  });
});
