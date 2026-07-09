/* eslint-disable */
/**
 * End-to-end probe of the Planner DnD target (#269) and the review loop:
 * render plannerLibraryDnd (row 0 flat, row 1 AM/PM bucket lanes), then
 *   1. drag a person over a committed-zone day (slot ≤ 3) — expect the ⊘
 *      invalid stage and a no-op drop;
 *   2. drop on day 5 of row 0 (flat) — expect the grammar `add` to land an
 *      optimistic proposed tile, flip the row to `pending` (warning dot via
 *      the approval/status accessors), and log `add · … @ 5` on the LAST line;
 *   3. click the row's Approve — expect the line to resolve (dot gone,
 *      `approve · r0` logged);
 *   4. drop the other card on row 1's day-5 PM lane — expect the composite
 *      `5:pm` slot key on the LAST line and the tile inside that lane.
 *
 * Run: pnpm --filter @elaraai/east-ui-components exec tsx scripts/probe-planner-add.ts
 */
import { createServer } from "vite";
import { launchChromium } from "../../../scripts/snapshot-capture.mts";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HARNESS_ROOT = path.resolve(__dirname, "../snapshot");

async function main() {
    const server = await createServer({ root: HARNESS_ROOT, server: { port: 0, host: "127.0.0.1" }, logLevel: "warn" });
    await server.listen();
    const addr = server.httpServer?.address();
    const port = server.config.server.port ?? (addr && typeof addr === "object" ? addr.port : 5173);
    const baseUrl = `http://127.0.0.1:${port}`;
    console.log(`probing planner add at ${baseUrl}`);

    const browser = await launchChromium({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 780 } });
    const page = await ctx.newPage();
    page.on("pageerror", err => console.log("[pageerror]", err.message));
    await page.addInitScript(() => { (globalThis as any).__name = (globalThis as any).__name || ((f: any) => f); });

    await page.goto(`${baseUrl}/?file=${encodeURIComponent("collections/planner")}&example=plannerLibraryDnd`, { waitUntil: "networkidle", timeout: 30_000 });
    await page.evaluate(() => (document as any).fonts.ready);
    await page.waitForSelector("[data-slot='cell']", { timeout: 15_000 });

    const card = page.locator("text=Patel, R.").first();
    const cardBox = await card.boundingBox();
    if (!cardBox) throw new Error("no card");

    // Row 0 is flat: data-drop-row=0, slots "1".."6". Row 1 is bucketed:
    // its lanes carry composite slots "1:am".."6:pm".
    const vetoCell = await page.locator("[data-drop-row='0'][data-drop-slot='2']").boundingBox();
    const okCell = await page.locator("[data-drop-row='0'][data-drop-slot='5']").boundingBox();
    if (!vetoCell || !okCell) throw new Error("day cells not registered with drop attrs");

    const dots = () => page.evaluate(() => document.querySelectorAll("[data-slot='statusDot']").length);
    const lastLine = async () => (await page.locator("text=LAST ·").textContent())?.trim() ?? "";
    const dotsBefore = await dots();

    // 1. Committed-zone hover → ⊘, drop → no-op.
    await page.mouse.move(cardBox.x + 10, cardBox.y + 10);
    await page.mouse.down();
    await page.mouse.move(vetoCell.x + vetoCell.width / 2, vetoCell.y + vetoCell.height / 2, { steps: 6 });
    await page.waitForTimeout(120);
    // Per-cell stages: exactly the hovered cell wears ⊘; the committed-zone
    // cells are never marked valid, the open days are — 3 flat (row 0,
    // days 4-6) + 6 lanes (row 1, days 4-6 × am/pm).
    const vetoStage = await page.evaluate(() =>
        document.querySelector("[data-drop-row='0'][data-drop-slot='2']")?.hasAttribute("data-drop-invalid") ?? false);
    const stageCounts = await page.evaluate(() => ({
        valid: document.querySelectorAll("[data-drag-cell][data-drop-valid]").length,
        invalidElsewhere: document.querySelectorAll("[data-drop-invalid]").length,
    }));
    console.log(`mid-drag stages: valid cells=${stageCounts.valid} · invalid=${stageCounts.invalidElsewhere}`);
    if (stageCounts.valid !== 9) throw new Error(`expected 3 flat + 6 lane open cells valid, got ${stageCounts.valid}`);
    if (stageCounts.invalidElsewhere !== 1) throw new Error("expected exactly one ⊘ cell (the hovered one)");
    await page.screenshot({ path: path.resolve(__dirname, "../dist-examples/probe-planner-add-veto.png") });
    await page.mouse.up();
    await page.waitForTimeout(150);
    const dotsAfterVeto = await dots();
    const lastAfterVeto = await lastLine();
    console.log(`veto stage=${vetoStage} · dots ${dotsBefore}→${dotsAfterVeto} · ${lastAfterVeto}`);
    if (!vetoStage) throw new Error("expected the ⊘ stage left of now");
    if (dotsAfterVeto !== dotsBefore) throw new Error("vetoed drop still flipped a row");
    if (!/none yet/i.test(lastAfterVeto)) throw new Error(`vetoed drop still logged: ${lastAfterVeto}`);

    // 2. Drop on day 5, row 0 (flat) → tile + pending dot + LAST log.
    await page.mouse.move(cardBox.x + 10, cardBox.y + 10);
    await page.mouse.down();
    await page.mouse.move(okCell.x + okCell.width / 2, okCell.y + okCell.height / 2, { steps: 6 });
    await page.waitForTimeout(120);
    await page.mouse.up();
    await page.waitForTimeout(300);
    const dotsAfterDrop = await dots();
    const tile = await page.getByText("patel", { exact: true }).count(); // optimistic tile wears the card key
    const lastAfterDrop = await lastLine();
    await page.screenshot({ path: path.resolve(__dirname, "../dist-examples/probe-planner-add-pending.png") });
    console.log(`after drop: dots=${dotsAfterDrop} · 'patel' tiles=${tile} · ${lastAfterDrop}`);
    if (dotsAfterDrop !== dotsBefore + 1) throw new Error("drop did not flip the row pending");
    if (tile !== 1) throw new Error("optimistic tile missing");
    if (!lastAfterDrop.includes("add · patel → r0 @ 5")) throw new Error(`add not logged: ${lastAfterDrop}`);

    // 3. Approve the line — the loop resolves and logs.
    await page.locator("[data-slot='decisionCol']").first().locator("button", { hasText: "Approve" }).click();
    await page.waitForTimeout(300);
    const dotsAfterApprove = await dots();
    const tileAfterApprove = await page.getByText("patel", { exact: true }).count();
    const lastAfterApprove = await lastLine();
    await page.screenshot({ path: path.resolve(__dirname, "../dist-examples/probe-planner-add-approved.png") });
    console.log(`after approve: dots=${dotsAfterApprove} · 'patel' tiles=${tileAfterApprove} · ${lastAfterApprove}`);
    if (dotsAfterApprove !== dotsBefore) throw new Error("approve did not resolve the line");
    if (tileAfterApprove !== 1) throw new Error("host-owned tile lost on approve");
    if (!lastAfterApprove.includes("approve · r0")) throw new Error(`approve not logged: ${lastAfterApprove}`);

    // 4. Drop the other card on row 1's day-5 PM lane → composite slot key.
    const kimCard = page.locator("text=Kim, A.").first();
    const kimBox = await kimCard.boundingBox();
    if (!kimBox) throw new Error("no Kim card");
    const pmLane = await page.locator("[data-drop-row='1'][data-drop-slot='5:pm']").boundingBox();
    if (!pmLane) throw new Error("row 1 pm lane not registered with a composite drop slot");
    await page.mouse.move(kimBox.x + 10, kimBox.y + 10);
    await page.mouse.down();
    await page.mouse.move(pmLane.x + pmLane.width / 2, pmLane.y + pmLane.height / 2, { steps: 6 });
    await page.waitForTimeout(120);
    await page.mouse.up();
    await page.waitForTimeout(300);
    const lastAfterLane = await lastLine();
    const laneTile = await page.locator("[data-drop-row='1'][data-drop-slot='5:pm']").getByText("kim", { exact: true }).count();
    const dotsAfterLane = await dots();
    await page.screenshot({ path: path.resolve(__dirname, "../dist-examples/probe-planner-add-lane.png") });
    console.log(`after lane drop: dots=${dotsAfterLane} · 'kim' in 5:pm lane=${laneTile} · ${lastAfterLane}`);
    if (!lastAfterLane.includes("add · kim → r1 @ 5:pm")) throw new Error(`composite add not logged: ${lastAfterLane}`);
    if (laneTile !== 1) throw new Error("optimistic tile did not land in the 5:pm lane");
    if (dotsAfterLane !== dotsBefore + 1) throw new Error("lane drop did not flip row 1 pending");

    await browser.close();
    await server.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
