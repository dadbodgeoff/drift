// Scenarios for the screens of `drift census --from-map`, `drift upgrade` and `drift feedback` (fixtures/screens, written by
// scripts/make-screens-fixtures.mjs). Run from run.mjs with its helpers, so the results land in the same report.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export default async function screens({ test, newPage, open, axe, expect, REPO, app }) {
  const fixture = (p) => JSON.parse(readFileSync(join(app, "fixtures", "screens", p), "utf8"));
  const hash = (page, h) => page.evaluate((x) => (location.hash = x), `#/${h}`);

  await test("proposals from the map: Drift's counts, where each stands, links to Conventions; empty and error states (axe, dark and light)", async () => {
    const doc = fixture("acme/from-map.json").from_map;
    const proposed = doc.filter((e) => e.proposed && !e.note).map((e) => e.id);
    for (const scheme of ["dark", "light"]) {
      const page = await newPage({ colorScheme: scheme });
      await open(page, "attention");
      await page.evaluate((s) => localStorage.setItem("drift-studio:theme", s), scheme);
      await open(page, "from-map");
      await page.waitForSelector(".fm-proposed .fm-prop");
      const ids = await page.locator(".fm-prop").evaluateAll((xs) => xs.map((x) => x.getAttribute("data-id")));
      expect(JSON.stringify(ids) === JSON.stringify(proposed), `proposals in Drift's order: ${ids}`);
      const signIn = await page.textContent(".fm-prop[data-id='D-234880']");
      expect(signIn.includes("89 of the 98 entry points Drift could read here follow it, 9 differ (8 named as departures today)"), `counts: ${signIn}`);
      expect(signIn.includes("not in .drift/conventions.yaml yet"), "where it stands");
      expect((await page.textContent(".fm-held")).includes("Not proposed (3)"), "those not proposed");
      expect((await page.locator(".fm-note[data-note='wiring']").count()) === 2, "the notes");
      expect((await page.textContent(".fm-head")).includes("Read-only"), "read-only");
      await axe(page, `from-map ${scheme}`);
      // A twin the file holds opens in Conventions.
      await page.click(".fm-prop[data-id='D-234880'] .fm-same button:has-text('D-b0d245')");
      await page.waitForFunction(() => location.hash.startsWith("#/conventions/D-b0d245"));
      expect(page.problems.length === 0, `console problems:\n${page.problems.join("\n")}`);
      await page.context().close();
    }
    const other = await newPage();
    await open(other, "from-map", REPO("quiet"));
    await other.waitForSelector(".dui-empty:has-text('Nothing from the map')");
    await axe(other, "from-map empty");
    await open(other, "from-map", REPO("beacon"));
    await other.waitForSelector(".dui-error:has-text('drift census --from-map failed')");
    expect((await other.textContent(".dui-error")).includes("no from-map.json for beacon"), "the error as the run gave it");
    expect((await other.locator(".dui-error button:has-text('Try again')").count()) === 1, "retry");
    expect(other.problems.length === 0, `console problems:\n${other.problems.join("\n")}`);
    await other.context().close();
  });

  await test("upgrade: what is left by who does it; Apply is confirmed, --security-baseline only when ticked (axe)", async () => {
    const page = await newPage();
    await open(page, "upgrade");
    await page.waitForSelector(".ug-left");
    const by = await page.locator(".ug-todo").evaluateAll((xs) => xs.map((x) => x.getAttribute("data-by")));
    expect(JSON.stringify(by.sort()) === JSON.stringify(["apply", "person", "security_baseline"]), `left: ${by}`);
    expect((await page.textContent(".ug-files")).includes(".drift/conventions.yaml"), "the files");
    expect((await page.textContent(".ug-security")).includes("no inventory stamp"), "the baseline has no stamp");
    await axe(page, "upgrade");
    // Without the box: only Drift's own work, and the exact command.
    await page.click(".ug-left button:has-text('Apply…')");
    const dialog = page.locator("[role=dialog]");
    await dialog.waitFor();
    expect((await dialog.textContent()).includes(".claude/settings.json") && !(await dialog.locator(".ug-work").textContent()).includes("security.lock"), "the work, without the baseline");
    expect((await dialog.locator(".st-cmd").textContent()) === "drift upgrade --apply", "the command");
    await axe(page, "upgrade apply dialog");
    await dialog.getByRole("checkbox").click();
    expect((await dialog.locator(".st-cmd").textContent()) === "drift upgrade --apply --security-baseline", "the command with the box ticked");
    expect((await dialog.locator(".ug-work li").count()) === 2, "the baseline's work added");
    await dialog.getByRole("checkbox").click();
    await dialog.locator("button:has-text('Apply')").last().click();
    await page.waitForSelector(".ug-applied");
    expect((await page.textContent(".ug-applied")).includes("refreshed .claude/settings.json"), `done: ${await page.textContent(".ug-applied")}`);
    // What is left is still offered: the baseline alone.
    await page.waitForFunction(() => document.querySelectorAll(".ug-todo[data-by='apply']").length === 0);
    await page.click(".ug-left button:has-text('Apply…')");
    await dialog.waitFor();
    expect((await dialog.textContent()).includes("Nothing without --security-baseline"), "nothing without the box");
    expect(await dialog.locator("button:has-text('Apply')").last().isDisabled(), "Apply is disabled with nothing to do");
    await dialog.getByRole("checkbox").click();
    await dialog.locator("button:has-text('Apply')").last().click();
    await page.waitForFunction(() => document.querySelector(".ug-applied")?.textContent?.includes(".drift/security.lock"));
    expect((await page.locator(".ug-left button:has-text('Apply…')").count()) === 0, "nothing left for apply");
    expect((await page.locator(".ug-todo[data-by='person']").count()) === 1, "the person's work stays");
    await axe(page, "upgrade applied");
    expect(page.problems.length === 0, `console problems:\n${page.problems.join("\n")}`);
    await page.context().close();
    const other = await newPage();
    await open(other, "upgrade", REPO("quiet"));
    await other.waitForSelector(".dui-empty:has-text('Nothing to do')");
    expect((await other.locator("button:has-text('Apply…')").count()) === 0, "no apply");
    await axe(other, "upgrade nothing to do");
    await open(other, "upgrade", REPO("beacon"));
    await other.waitForSelector(".dui-error:has-text('drift upgrade failed')");
    expect(other.problems.length === 0, `console problems:\n${other.problems.join("\n")}`);
    await other.context().close();
  });

  await test("feedback: mark a report from Check, nothing sent, and the list of marks (axe)", async () => {
    const page = await newPage();
    await open(page, "check");
    await page.fill(".st-toolbar input", "PayoutsService");
    await page.waitForSelector(".ck-detail [data-testid='feedback-mark']");
    const control = page.locator(".ck-detail [data-testid='feedback-mark']");
    expect((await control.locator(".fb-mark__current").count()) === 0, "not marked yet");
    await control.locator("button:has-text('Mark wrong…')").click();
    const dialog = page.locator("[role=dialog]");
    await dialog.waitFor();
    expect((await dialog.textContent()).includes("nothing is sent anywhere"), "nothing is sent");
    await dialog.getByLabel("Why (optional)").fill("a service  that only reads");
    const cmd = await dialog.locator(".fb-cmd").textContent();
    expect(cmd === "drift feedback mark --wrong '--why=a service that only reads' -- D-43b8c8 apps/api/src/payouts/payouts.service.ts#PayoutsService", `command: ${cmd}`);
    await axe(page, "feedback mark dialog");
    await dialog.locator("button:has-text('Mark wrong')").last().click();
    await control.locator(".fb-mark__current:has-text('marked wrong')").waitFor();
    expect((await control.textContent()).includes("Your reason: a service that only reads"), "the reason");
    expect((await control.locator(".fb-mark__out").textContent()).includes("on this machine only"), "Drift's output");
    // The list, in the same tab.
    await hash(page, "feedback");
    await page.waitForSelector(".fbv-marks");
    expect((await page.textContent(".fbv-marks")).includes("Marks (3): 1 true, 2 wrong"), `tally: ${await page.textContent(".fbv-marks")}`);
    const rows = await page.locator(".fbv-marks tbody tr").evaluateAll((xs) => xs.map((x) => `${x.getAttribute("data-id")} ${x.getAttribute("data-verdict")}`));
    expect(JSON.stringify(rows) === JSON.stringify(["D-288d8d wrong", "D-43b8c8 wrong", "D-b0d245 true"]), `rows: ${rows}`);
    expect((await page.textContent(".fbv-export")).includes("drift feedback export --dry-run") && (await page.textContent(".fbv-export")).includes("The Studio does not run it"), "export is a command");
    await axe(page, "feedback list");
    expect(page.problems.length === 0, `console problems:\n${page.problems.join("\n")}`);
    await page.context().close();
    const other = await newPage();
    await open(other, "feedback", REPO("quiet"));
    await other.waitForSelector(".dui-empty:has-text('No marks yet')");
    await axe(other, "feedback empty");
    expect(other.problems.length === 0, `console problems:\n${other.problems.join("\n")}`);
    await other.context().close();
  });
}
