/* eslint-disable */
/**
 * Pixel-perfect audit of the Slice.Edit popover + its typed value inputs.
 *
 * Renders single slice examples full-bleed in the snapshot harness
 * (`?file=slice/slice&example=<name>`), opens each Slice.Edit case, and dumps
 * the popover's computed CSS (content chrome + head/body/foot children) plus the
 * value control's element (tag · type · role) — to diff against
 * `design/slice.html#slice-edit` without eyeballing a snapshot.
 *
 * Run: pnpm --filter @elaraai/east-ui-components exec tsx scripts/probe-slice.ts
 */
import { chromium } from "playwright";
import { createServer } from "vite";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HARNESS_ROOT = path.resolve(__dirname, "../snapshot");

/** Each case: the example to render, and an optional trigger to click (else already-open via editOpen). */
const CASES: ReadonlyArray<{ label: string; example: string; triggerText?: string }> = [
    { label: "Filter · add builder (editOpen)", example: "sliceFilter" },
    { label: "Cohort · new predicate editor",    example: "sliceCohort", triggerText: "+ cohort" },
    { label: "Range · picker (editOpen)",         example: "sliceRange" },
];

async function dumpOpenPopover(page: any, label: string): Promise<void> {
    const css = await page.evaluate(() => {
        const portals = Array.from(document.querySelectorAll("[data-scope='popover'][data-part='content']"));
        if (portals.length === 0) return null;
        const el = portals[portals.length - 1] as HTMLElement;
        const pick = (node: Element, props: string[]) => {
            const cs = window.getComputedStyle(node);
            const out: Record<string, string> = {};
            for (const p of props) out[p] = cs.getPropertyValue(p);
            return out;
        };
        const rect = el.getBoundingClientRect();
        const content = { width: `${Math.round(rect.width)}px`, ...pick(el, ["border-top-width", "border-color", "border-radius", "box-shadow", "background-color", "padding"]) };
        const zones = Array.from(el.children)
            .filter(c => (c as HTMLElement).dataset.part !== "arrow")
            .map((c, i) => ({ i, h: `${Math.round((c as HTMLElement).getBoundingClientRect().height)}px`, ...pick(c, ["padding", "max-height", "overflow-y", "border-bottom-width", "border-top-width"]) }));
        // Every form control in the editor — to compare value-input vs the
        // field/op selects (and the cohort name input) for size consistency.
        const controls = Array.from(el.querySelectorAll("select, input, textarea")).map(c => {
            const cs = window.getComputedStyle(c);
            return {
                tag: c.tagName.toLowerCase(),
                type: c.getAttribute("type") ?? "",
                h: `${Math.round((c as HTMLElement).getBoundingClientRect().height)}px`,
                "font-size": cs.getPropertyValue("font-size"),
                padding: cs.getPropertyValue("padding"),
            };
        });
        return { content, zones, controls };
    });
    console.log(`\n--- ${label} ---`);
    if (!css) { console.log("  (popover not open)"); return; }
    console.log("  content     :", JSON.stringify(css.content));
    css.zones.forEach((z: any) => console.log(`  zone[${z.i}]    :`, JSON.stringify(z)));
    (css.controls ?? []).forEach((c: any, i: number) => console.log(`  control[${i}] :`, JSON.stringify(c)));
}

async function main() {
    const server = await createServer({ root: HARNESS_ROOT, server: { port: 0, host: "127.0.0.1" }, logLevel: "warn" });
    await server.listen();
    const addr = server.httpServer?.address();
    const port = server.config.server.port ?? (addr && typeof addr === "object" ? addr.port : 5173);
    const baseUrl = `http://127.0.0.1:${port}`;
    console.log(`probing slice at ${baseUrl}`);

    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 } });
    const page = await ctx.newPage();
    page.on("pageerror", err => console.log("[pageerror]", err.message));
    // tsx/esbuild `keepNames` wraps fns with `__name` in the serialized evaluate
    // body; shim it in the page so those calls resolve.
    await page.addInitScript(() => { (globalThis as any).__name = (globalThis as any).__name || ((f: any) => f); });

    for (const c of CASES) {
        try {
            await page.goto(`${baseUrl}/?file=slice/slice&example=${c.example}`, { waitUntil: "networkidle", timeout: 30_000 });
            await page.evaluate(() => (document as any).fonts.ready);
            await page.waitForTimeout(500);
            // Open the popover if not already (editOpen) — by its text trigger or the popover trigger.
            if (await page.locator("[data-scope='popover'][data-part='content']").count() === 0) {
                const trigger = c.triggerText
                    ? page.getByText(c.triggerText, { exact: false }).first()
                    : page.locator("[data-scope='popover'][data-part='trigger']").first();
                await trigger.click({ timeout: 4000 });
                await page.waitForTimeout(300);
            }
            await dumpOpenPopover(page, c.label);
            const content = page.locator("[data-scope='popover'][data-part='content']").last();
            if (await content.count() > 0) {
                const out = path.resolve(__dirname, `../dist-examples/probe-slice-${c.example}.png`);
                await content.screenshot({ path: out });
                console.log(`  shot        : ${out}`);
            }
        } catch (e: any) {
            console.log(`\n--- ${c.label} ---\n  ERROR: ${e.message}`);
        }
    }

    await browser.close();
    await server.close();
}

main().catch(err => { console.error(err); process.exit(1); });
