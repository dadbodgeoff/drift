import { describe, expect, it } from "vitest";
import { conventionScopeFiles, routeFlavor, type AcceptedConvention } from "../src/index.js";

/**
 * CV-2: cron routes are not session routes.
 *
 * dub's 494 route files are 358 app, 111 cron and 25 webhook. Cron and webhook routes authenticate by
 * signature rather than session, so one global denominator either drags a session family's confidence
 * down by counting routes it was never about or - accepted - flags every cron route as missing auth.
 *
 * The negative controls come first, and the substring trap is the one that matters: this predicate
 * decides scope, and a scope predicate that matches substrings is F3/F4 in a new place.
 */

const conventionWith = (matcher: Partial<AcceptedConvention["matcher"]>): AcceptedConvention =>
  ({
    id: "convention_cv2",
    kind: "api_route_requires_auth_helper",
    scope: {
      path_globs: [],
      exclude_path_globs: [],
      file_roles: ["api_route" as const]
    },
    matcher: {
      kind: "api_route_requires_auth_helper",
      required_calls: ["withSession"],
      applies_to_file_roles: ["api_route" as const],
      ...matcher
    }
  }) as unknown as AcceptedConvention;

describe("CV-2 route flavour", () => {
  describe("negative controls", () => {
    it("matches segments, not substrings", () => {
      // The trap. A route directory that merely starts with "cron" or contains "webhook" as part of a
      // longer word is an ordinary route, and calling it a cron job would move it out of the session
      // family's denominator - silently shrinking what the family is measured against.
      expect(routeFlavor("app/api/crontab-editor/route.ts")).toBe("api_route");
      expect(routeFlavor("app/api/cronjobs-docs/route.ts")).toBe("api_route");
      expect(routeFlavor("app/api/webhooks-docs/route.ts")).toBe("api_route");
      expect(routeFlavor("app/api/synchronised/route.ts")).toBe("api_route");
    });

    it("only segments below the api boundary decide flavour", () => {
      // A service mounted under a cron-named directory does not make its ordinary routes cron jobs.
      expect(routeFlavor("apps/cron-service/app/api/users/route.ts")).toBe("api_route");
      expect(routeFlavor("apps/cron/app/api/users/route.ts")).toBe("api_route");
      // ...and the same repo's genuine cron route still classifies.
      expect(routeFlavor("apps/cron/app/api/cron/rollup/route.ts")).toBe("cron_job");
    });

    it("does not manufacture a flavour for an ordinary repo", () => {
      // CV-2's red #2: a repo with no cron or webhook paths must yield one unconditioned flavour, not
      // an invented split.
      for (const path of [
        "app/api/users/route.ts",
        "app/api/users/[id]/route.ts",
        "apps/web/app/(admin)/api/projects/route.ts",
        "pages/api/users.ts"
      ]) {
        expect(routeFlavor(path)).toBe("api_route");
      }
    });

    it("an unconditioned convention still covers every flavour", () => {
      // Absent or empty `applies_to_route_flavors` must mean "all", or adding the field would silently
      // narrow every convention that predates it.
      const unconditioned = conventionWith({});
      const files = [
        "app/api/users/route.ts",
        "app/api/cron/rollup/route.ts",
        "app/api/stripe/webhook/route.ts"
      ];
      expect(conventionScopeFiles(files, unconditioned)).toEqual(files);

      const explicitlyEmpty = conventionWith({ applies_to_route_flavors: [] });
      expect(conventionScopeFiles(files, explicitlyEmpty)).toEqual(files);
    });
  });

  describe("classification", () => {
    it("classifies cron routes", () => {
      expect(routeFlavor("apps/web/app/(ee)/api/cron/aggregate-clicks/route.ts")).toBe("cron_job");
      expect(routeFlavor("app/api/cron/rollup/route.ts")).toBe("cron_job");
      expect(routeFlavor("app/api/jobs/nightly/route.ts")).toBe("cron_job");
      expect(routeFlavor("app/api/scheduled/digest/route.ts")).toBe("cron_job");
    });

    it("classifies webhook receivers", () => {
      expect(routeFlavor("apps/web/app/(ee)/api/appsflyer/webhook/route.ts")).toBe("webhook_handler");
      expect(routeFlavor("app/api/webhooks/stripe/route.ts")).toBe("webhook_handler");
    });

    it("prefers cron when a path carries both signals", () => {
      // Deterministic rather than arbitrary: a scheduled job that posts to a webhook is still a job,
      // and whichever way this resolved it must resolve the same way every time.
      expect(routeFlavor("app/api/cron/webhooks/replay/route.ts")).toBe("cron_job");
    });

    it("ignores Next route groups", () => {
      expect(routeFlavor("apps/web/app/(ee)/api/cron/x/route.ts")).toBe("cron_job");
      expect(routeFlavor("apps/web/app/(ee)/api/admin/x/route.ts")).toBe("api_route");
    });
  });

  describe("scope narrowing", () => {
    it("a session-flavoured convention does not cover cron routes", () => {
      // The whole point: accepted in block mode, this convention must not flag a cron route for
      // missing the session wrapper it was never supposed to use.
      const sessionOnly = conventionWith({ applies_to_route_flavors: ["api_route"] });
      const inScope = conventionScopeFiles(
        [
          "app/api/users/route.ts",
          "app/api/cron/rollup/route.ts",
          "app/api/stripe/webhook/route.ts"
        ],
        sessionOnly
      );
      expect(inScope).toEqual(["app/api/users/route.ts"]);
    });

    it("a signature-flavoured convention covers exactly the cron and webhook routes", () => {
      const signatureOnly = conventionWith({
        applies_to_route_flavors: ["cron_job", "webhook_handler"]
      });
      const inScope = conventionScopeFiles(
        [
          "app/api/users/route.ts",
          "app/api/cron/rollup/route.ts",
          "app/api/stripe/webhook/route.ts"
        ],
        signatureOnly
      );
      expect(inScope).toEqual([
        "app/api/cron/rollup/route.ts",
        "app/api/stripe/webhook/route.ts"
      ]);
    });

    it("flavour narrows but never widens - exclusions and non-routes still win", () => {
      const cronOnly = conventionWith({ applies_to_route_flavors: ["cron_job"] });
      const withExclusion = {
        ...cronOnly,
        scope: { ...cronOnly.scope, exclude_path_globs: ["**/cron/rollup/**"] }
      } as AcceptedConvention;

      // An excluded file stays excluded even though its flavour matches.
      expect(conventionScopeFiles(["app/api/cron/rollup/route.ts"], withExclusion)).toEqual([]);
      // A non-route file is not pulled in by flavour either.
      expect(conventionScopeFiles(["lib/cron/scheduler.ts"], cronOnly)).toEqual([]);
    });
  });
});
