/* eslint-disable */
/**
 * End-to-end probe of the Planner DnD target (#269) and the review loop:
 * render plannerLibraryDnd, then
 *   1. drag a person over a committed-zone day (slot ≤ 3) — expect the ⊘
 *      invalid stage and a no-op drop;
 *   2. drop on day 5 of row 0 — expect the grammar `add` to land an
 *      optimistic proposed tile AND flip the row to `pending` (warning dot
 *      appears via the approval/status accessors);
 *   3. click the row's Approve — expect the line to resolve (dot gone).
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

    // Day cells of row 0: data-drop-row=0, slots "1".."6".
    const vetoCell = await page.locator("[data-drop-row='0'][data-drop-slot='2']").boundingBox();
    const okCell = await page.locator("[data-drop-row='0'][data-drop-slot='5']").boundingBox();
    if (!vetoCell || !okCell) throw new Error("day cells not registered with drop attrs");

    const dots = () => page.evaluate(() => document.querySelectorAll("[data-slot='statusDot']").length);
    const dotsBefore = await dots();

    // 1. Committed-zone hover → ⊘, drop → no-op.
    await page.mouse.move(cardBox.x + 10, cardBox.y + 10);
    await page.mouse.down();
    await page.mouse.move(vetoCell.x + vetoCell.width / 2, vetoCell.y + vetoCell.height / 2, { steps: 6 });
    await page.waitForTimeout(120);
    // Per-cell stages: exactly the hovered cell wears ⊘; the committed-zone
    // cells are never marked valid, the open days are.
    const vetoStage = await page.evaluate(() =>
        document.querySelector("[data-drop-row='0'][data-drop-slot='2']")?.hasAttribute("data-drop-invalid") ?? false);
    const stageCounts = await page.evaluate(() => ({
        valid: document.querySelectorAll("[data-drag-cell][data-drop-valid]").length,
        invalidElsewhere: document.querySelectorAll("[data-drop-invalid]").length,
    }));
    console.log(`mid-drag stages: valid cells=${stageCounts.valid} · invalid=${stageCounts.invalidElsewhere}`);
    if (stageCounts.valid !== 6) throw new Error(`expected exactly the 6 open-day cells valid, got ${stageCounts.valid}`);
    if (stageCounts.invalidElsewhere !== 1) throw new Error("expected exactly one ⊘ cell (the hovered one)");
    await page.screenshot({ path: path.resolve(__dirname, "../dist-examples/probe-planner-add-veto.png") });
    await page.mouse.up();
    await page.waitForTimeout(150);
    const dotsAfterVeto = await dots();
    console.log(`veto stage=${vetoStage} · dots ${dotsBefore}→${dotsAfterVeto}`);
    if (!vetoStage) throw new Error("expected the ⊘ stage left of now");
    if (dotsAfterVeto !== dotsBefore) throw new Error("vetoed drop still flipped a row");

    // 2. Drop on day 5, row 0 → tile + pending dot.
    await page.mouse.move(cardBox.x + 10, cardBox.y + 10);
    await page.mouse.down();
    await page.mouse.move(okCell.x + okCell.width / 2, okCell.y + okCell.height / 2, { steps: 6 });
    await page.waitForTimeout(120);
    await page.mouse.up();
    await page.waitForTimeout(300);
    const dotsAfterDrop = await dots();
    const tile = await page.locator("text=Patel, R.").count(); // card + optimistic tile label
    await page.screenshot({ path: path.resolve(__dirname, "../dist-examples/probe-planner-add-pending.png") });
    console.log(`after drop: dots=${dotsAfterDrop} · 'Patel, R.' nodes=${tile}`);
    if (dotsAfterDrop !== dotsBefore + 1) throw new Error("drop did not flip the row pending");
    if (tile < 2) throw new Error("optimistic tile missing");

    // 3. Approve the line — the loop resolves.
    await page.locator("[data-slot='decisionCol']").first().locator("button", { hasText: "Approve" }).click();
    await page.waitForTimeout(300);
    const dotsAfterApprove = await dots();
    const tileAfterApprove = await page.locator("text=Patel, R.").count();
    await page.screenshot({ path: path.resolve(__dirname, "../dist-examples/probe-planner-add-approved.png") });
    console.log(`after approve: dots=${dotsAfterApprove} · 'Patel, R.' nodes=${tileAfterApprove}`);
    if (dotsAfterApprove !== dotsBefore) throw new Error("approve did not resolve the line");
    if (tileAfterApprove < 2) throw new Error("host-owned tile lost on approve");

    await browser.close();
    await server.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
