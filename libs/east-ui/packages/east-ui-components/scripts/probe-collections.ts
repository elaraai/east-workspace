/* eslint-disable */
/**
 * Pixel audit of the Collections.Table / Gantt / Planner examples vs the bsys
 * spec (`index.html` "Rows & tables" + `configure__pattern__{gantt,planner}`).
 *
 * Renders single examples full-bleed in the snapshot harness, screenshots each
 * to `dist-examples/probe-coll-<example>.png` (legible — one example, not the
 * down-scaled combined sheet), and dumps the computed CSS of the table header /
 * cell / row + the first gantt/planner bar (fill · radius · height) to diff
 * against spec numbers.
 *
 * Run: pnpm --filter @elaraai/east-ui-components exec tsx scripts/probe-collections.ts
 */
import { chromium } from "playwright";
import { createServer } from "vite";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HARNESS_ROOT = path.resolve(__dirname, "../snapshot");

const TABLE_EXAMPLES = [
    "tableBasic", "tableCustomHeaders", "tableStriped", "tableInteractive",
    "tableWithBadge", "tableFullStyled", "tableComplexColumns",
    "tableColumnRenderWithRow", "tableWrappingTags", "tableInteractiveCallbacks",
    "tableCustomHeight", "tableFrozenColumns", "tableRowStatus", "tableWithFooter",
    "tableColumnGroups", "tableReactivePagination", "tableReactiveSelection",
    "tableExpandedContent", "tableDensityCompact", "tableColourOverrides",
    "tableExpandedRichDetail", "tableMultiRowFooter", "tableNestedColumnGroups",
    "tablePaginationServerSide", "tableMultiSelection", "tableRangeSelection",
    "tableDensityComfortable",
];

const TARGETS: ReadonlyArray<{ file: string; example: string }> = [
    ...TABLE_EXAMPLES.map(example => ({ file: "collections/table", example })),
    { file: "collections/gantt",   example: "ganttWithProgress" },
    { file: "collections/gantt",   example: "ganttWithMilestones" },
    { file: "collections/gantt",   example: "ganttColorful" },
    { file: "collections/planner", example: "plannerWithLabels" },
    { file: "collections/planner", example: "plannerMultipleEvents" },
    { file: "collections/planner", example: "plannerBasic" },
];

async function main() {
    const server = await createServer({ root: HARNESS_ROOT, server: { port: 0, host: "127.0.0.1" }, logLevel: "warn" });
    await server.listen();
    const addr = server.httpServer?.address();
    const port = server.config.server.port ?? (addr && typeof addr === "object" ? addr.port : 5173);
    const baseUrl = `http://127.0.0.1:${port}`;
    console.log(`probing collections at ${baseUrl}`);

    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1120, height: 560 } });
    const page = await ctx.newPage();
    page.on("pageerror", err => console.log("[pageerror]", err.message));
    await page.addInitScript(() => { (globalThis as any).__name = (globalThis as any).__name || ((f: any) => f); });

    for (const t of TARGETS) {
        try {
            await page.goto(`${baseUrl}/?file=${encodeURIComponent(t.file)}&example=${t.example}`, { waitUntil: "networkidle", timeout: 30_000 });
            await page.evaluate(() => (document as any).fonts.ready);
            // Tables lazy-load virtualized rows (skeleton → data after `loadingDelay`).
            // Wait for the first body cell to carry real content; report if it never does.
            let loaded = true;
            try {
                await page.waitForFunction(() => {
                    const td = document.querySelector("table tbody td");
                    if (!td) return true; // gantt/planner: no <table> body cells in the timeline
                    return (td.textContent ?? "").trim().length > 0;
                }, { timeout: 6000 });
            } catch { loaded = false; }
            await page.waitForTimeout(400);
            const out = path.resolve(__dirname, `../dist-examples/probe-coll-${t.example}.png`);
            await page.screenshot({ path: out, fullPage: true });

            const css = await page.evaluate(() => {
                const pick = (sel: string, props: string[]) => {
                    const el = document.querySelector(sel);
                    if (!el) return null;
                    const cs = window.getComputedStyle(el);
                    const out: Record<string, string> = { h: `${Math.round((el as HTMLElement).getBoundingClientRect().height)}px` };
                    for (const p of props) out[p] = cs.getPropertyValue(p);
                    return out;
                };
                return {
                    th: pick("table thead th", ["font-family", "font-size", "letter-spacing", "padding", "background-color", "border-bottom"]),
                    td: pick("table tbody td", ["font-size", "padding", "border-bottom", "vertical-align"]),
                    tr: pick("table tbody tr", []),
                    // Gantt/Planner bars: the renderers paint absolutely-positioned
                    // blocks inside the timeline grid — grab the most-likely bar.
                    bar: pick("[data-part='task'], [data-part='event'], [class*='bar'], [class*='task'], [class*='event']", ["background-color", "border-radius", "border", "color", "font-size"]),
                    // Header text vertical centering: label text box top/bottom gap
                    // inside the th. Equal gaps = centered; smaller top gap = sits high.
                    thLabel: (() => {
                        const th = document.querySelector("table thead th") as HTMLElement | null;
                        const label = th?.querySelector("span,p,div") as HTMLElement | null;
                        if (!th || !label) return null;
                        const tr = th.getBoundingClientRect(), lr = label.getBoundingClientRect();
                        return { thH: Math.round(tr.height), gapTop: Math.round(lr.top - tr.top), gapBottom: Math.round(tr.bottom - lr.bottom), lineHeight: window.getComputedStyle(label).lineHeight, display: window.getComputedStyle(th).display, alignItems: window.getComputedStyle(th).alignItems };
                    })(),
                };
            });
            console.log(`\n=== ${t.example} ===  rows-loaded=${loaded}`);
            console.log("  th  :", JSON.stringify(css.th));
            console.log("  td  :", JSON.stringify(css.td));
            console.log("  tr  :", JSON.stringify(css.tr));
            console.log("  bar :", JSON.stringify(css.bar));
            if (css.thLabel) console.log("  thLb:", JSON.stringify(css.thLabel));
            console.log("  shot:", out);
        } catch (e: any) {
            console.log(`\n=== ${t.example} ===\n  ERROR: ${e.message}`);
        }
    }

    await browser.close();
    await server.close();
}

main().catch(err => { console.error(err); process.exit(1); });
