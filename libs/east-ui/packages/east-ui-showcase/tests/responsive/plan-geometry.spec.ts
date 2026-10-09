/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Plan's geometry, measured in a real browser (#817): every body item —
 * row, group band, rail, gap band — renders at exactly the height the model
 * laid it out at (`rowHeight`, which each item carries as `data-plan-h`), for
 * every row kind the Plan examples draw, at each density, with chart rows at
 * rest and expanded, and under both row focuses (R1 rails and gap bands, R2
 * context strips and the grown focal row).
 *
 * The model and the recipe read ONE geometry table — the model directly, the
 * recipe through the CSS variables the canvas writes — so a mismatch here
 * means they parted: the paging ledger's "band px == rendered px" invariant
 * rests on this.
 *
 * Every measurement is polled until it holds, on a page at rest, never read
 * once after a fixed pause.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test plan-geometry --project desktop`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";
import { PLAN_EVENT_EXAMPLES, PLAN_EXAMPLES, openExample, planBox, rowId, rowSel, sizeBox } from "./plan-page";
import { cutNumbers, cutText, rulerFaults } from "./plan-text";

/** The Plan examples, between them every row kind, group strips, pinned
 *  rows, number and ordinal axes, rows folded to a coarser resolution and a
 *  bound ui state (#824). */
const EXAMPLES = ["planTargetState", "planMeasures", "planNumberAxis", "planOrdinalAxis"];

/** Every body item whose rendered height is not the model's. */
async function mismatches(entry: Locator): Promise<string[]> {
    return entry.evaluate((root) => [...root.querySelectorAll("[data-plan-h]")].flatMap((el) => {
        const model = Number(el.getAttribute("data-plan-h"));
        const rendered = el.getBoundingClientRect().height;
        if (Math.abs(model - rendered) <= 0.5) return [];
        const name = el.getAttribute("data-plan-row") ?? el.getAttribute("data-plan-group")
            ?? el.getAttribute("data-plan-rail") ?? `gap ${el.getAttribute("data-plan-gap")}`;
        return [`${name}: model ${model}px, rendered ${rendered}px`];
    }));
}

/** How many body items the entry measures. */
const measured = (entry: Locator) => entry.locator("[data-plan-h]").count();

/** Every row kind the Plan draws. */
const KINDS = ["buckets", "cards", "chart", "events", "heat", "span", "table"];

// ── What #1258 measures (`Plan links.html`), evaluated in the page ──
// Each returns what it found wrong, in words: an empty list holds.

/**
 * Each link that does not leave its source's END or enter its destination's
 * START as the element draws (#1258) — a bar, a chip, a mark's glyph or the
 * cell a tile sits in. Its band starts on the source's right edge at its
 * middle, or — no room before the plot's end — lifts off its top or bottom edge
 * within its last 7px; its head's tip meets the destination's left edge at its
 * middle, or — no room after the plot's start — drops onto its top or bottom
 * edge within its first 10px; each on the plot's edge where the element lies
 * past the window. An end out of view meets the view's edge in a stub instead,
 * which this leaves to the view's checks. A link names its ends on its hit
 * path, each a row's id and an element's key.
 */
const ribbonEnds = (root: Element): string[] => {
    const svg = root.querySelector("[data-plan-ribbons] svg")!.getBoundingClientRect();
    const nums = (d: string) => d.split(/[\sMLAZ]+/).filter((t) => t !== "").map(Number);
    const near = (a: number, b: number) => Math.abs(a - b) <= 0.6;
    const within = (v: number, lo: number, hi: number) => v >= lo - 0.6 && v <= hi + 0.6;
    const out: string[] = [];
    /** The element an end names, as it draws. */
    const elementOf = (rowKey: string | null, key: string | null): Element | null => {
        const row = root.querySelector(`[data-plan-row=${JSON.stringify(rowKey)}]`);
        if (row === null) return null;
        const keyed = (sel: string, attr: string) => [...row.querySelectorAll(sel)].find((e) => e.getAttribute(attr) === key);
        return keyed("[data-run]", "data-run") ?? keyed("[data-chip]", "data-chip")
            ?? keyed("[data-mark][role='button']", "data-mark") ?? keyed("[data-event]", "data-event")?.closest("[data-plan-cell]") ?? null;
    };
    for (const g of root.querySelectorAll("[data-plan-link]")) {
        const hit = g.querySelector("[data-link]")!;
        const name = `link ${hit.getAttribute("data-link-key")}`;
        const heads = g.querySelectorAll("[data-plan-ribbon-head]");
        const toOff = heads[0]!.hasAttribute("data-plan-stub");
        const fromOff = heads[1]?.hasAttribute("data-plan-stub") ?? false;
        const srcEl = elementOf(hit.getAttribute("data-link-from"), hit.getAttribute("data-link-from-run"));
        const dstEl = elementOf(hit.getAttribute("data-link-to"), hit.getAttribute("data-link-to-run"));
        if ((!fromOff && srcEl === null) || (!toOff && dstEl === null)) { out.push(`${name}: an element it joins is not drawn`); continue; }
        const plot = root.querySelector("[data-plan-row] [data-plan-plot]")!.getBoundingClientRect();
        const onPlot = (x: number) => Math.min(plot.right, Math.max(plot.left, x));
        if (!fromOff) {
            const src = srcEl!.getBoundingClientRect();
            const p0 = g.querySelector<SVGPathElement>("[data-plan-ribbon-band]")!.getPointAtLength(0);
            const [x0, y0] = [svg.left + p0.x, svg.top + p0.y];
            const end = onPlot(src.right);
            const level = near(x0, end) && near(y0, (src.top + src.bottom) / 2);
            const lifted = within(x0, Math.max(onPlot(src.left), end - 7), end) && (near(y0, src.top) || near(y0, src.bottom));
            if (!level && !lifted) out.push(`${name} leaves at (${x0.toFixed(1)}, ${y0.toFixed(1)}), not its source's end (${end.toFixed(1)}, ${((src.top + src.bottom) / 2).toFixed(1)})`);
        }
        if (!toOff) {
            const dst = dstEl!.getBoundingClientRect();
            const tip = nums(heads[0]!.getAttribute("d")!).slice(2, 4);
            const [tx, ty] = [svg.left + tip[0]!, svg.top + tip[1]!];
            const start = onPlot(dst.left);
            const level = near(tx, start) && near(ty, (dst.top + dst.bottom) / 2);
            const dropped = within(tx, start, Math.min(start + 10, onPlot(dst.right))) && (near(ty, dst.top) || near(ty, dst.bottom));
            if (!level && !dropped) out.push(`${name} enters at (${tx.toFixed(1)}, ${ty.toFixed(1)}), not its destination's start (${start.toFixed(1)}, ${((dst.top + dst.bottom) / 2).toFixed(1)})`);
        }
    }
    return out;
};

/**
 * Whatever of a links focus lies outside the plot (ruled by the user): no
 * link, head, casing, caption or slot crosses into the gutter — the canvas's
 * first column — or past the plot's end, and the layer is clipped to the plot.
 * A link's hit area is its band's own path.
 */
const outsidePlot = (root: Element): string[] => {
    const out: string[] = [];
    const svgEl = root.querySelector<SVGSVGElement>("[data-plan-ribbons] svg");
    if (svgEl === null) return ["no links layer"];
    const svg = svgEl.getBoundingClientRect();
    const plot = root.querySelector("[data-plan-row] [data-plan-plot]")!.getBoundingClientRect();
    for (const el of svgEl.querySelectorAll<SVGGraphicsElement>("[data-plan-clip] path, [data-plan-clip] rect, [data-plan-clip] text")) {
        const b = el.getBBox();
        const [left, right] = [svg.left + b.x, svg.left + b.x + b.width];
        const what = [...el.attributes].map((a) => a.name).find((n) => n.startsWith("data-")) ?? el.tagName;
        if (left < plot.left - 0.05) out.push(`${what}: ${(plot.left - left).toFixed(1)}px into the gutter`);
        if (right > plot.right + 0.05) out.push(`${what}: ${(right - plot.right).toFixed(1)}px past the plot's end`);
    }
    const clip = svgEl.querySelector("clipPath rect");
    const group = svgEl.querySelector("[data-plan-clip]");
    if (clip === null || group === null || !group.getAttribute("clip-path")?.includes(svgEl.querySelector("clipPath")!.id)) {
        out.push("the layer is not clipped to the plot");
    } else {
        // A clip path's shapes are never drawn: its rect's place is its attributes, in the layer's coordinates.
        const left = svg.left + Number(clip.getAttribute("x"));
        const right = left + Number(clip.getAttribute("width"));
        if (Math.abs(left - plot.left) > 0.5 || Math.abs(right - plot.right) > 0.5) out.push(`clipped to ${left}–${right}, the plot is ${plot.left}–${plot.right}`);
    }
    return out;
};

/**
 * Each part of a links focus drawn otherwise than `Plan links.html` draws it
 * (#1258): each link at its weight — its quantity's third of the family's
 * largest (`want.weights`, by link) — its head 8 long and max(8, 2 × weight)
 * wide, its casing the paper one px either side of its band and round its head,
 * every casing under every link; each caption on a knockout 12 tall and 4 either
 * side of its text, no two within 60 × 12 of each other; each end past the
 * window in a dashed slot 40 wide and its bar's height, on the plot's edge; and
 * the links at z 5, under the row controls (6) and the now line (7).
 */
const linkFigures = (root: Element, want: { weights: readonly number[]; slots: number; bar: number }): string[] => {
    const out: string[] = [];
    const near = (a: number, b: number, tol = 0.6) => Math.abs(a - b) <= tol;
    const nums = (d: string) => d.split(/[\sMLZ]+/).filter((t) => t !== "").map(Number);
    const layer = root.querySelector("[data-plan-ribbons]")!;
    const svgEl = layer.querySelector("svg")!;
    const svg = svgEl.getBoundingClientRect();
    const links = [...root.querySelectorAll("[data-plan-link]")];
    const weights = links.map((g) => Number(g.querySelector("[data-plan-ribbon-band]")!.getAttribute("stroke-width")));
    if (JSON.stringify(weights) !== JSON.stringify(want.weights)) out.push(`weights ${JSON.stringify(weights)}, want ${JSON.stringify(want.weights)}`);
    for (const g of links) {
        const i = g.getAttribute("data-plan-link")!;
        const w = Number(g.querySelector("[data-plan-ribbon-band]")!.getAttribute("stroke-width"));
        const headD = g.querySelector("[data-plan-ribbon-head]")!.getAttribute("d")!;
        const n = nums(headD);
        const across = Math.hypot(n[4]! - n[0]!, n[5]! - n[1]!);
        const along = Math.hypot(n[2]! - (n[0]! + n[4]!) / 2, n[3]! - (n[1]! + n[5]!) / 2);
        if (!near(across, Math.max(8, 2 * w), 0.15) || !near(along, 8, 0.15)) out.push(`link ${i}: head ${along.toFixed(1)} long × ${across.toFixed(1)} wide, want 8 × ${Math.max(8, 2 * w)}`);
        const casing = root.querySelector(`[data-plan-ribbon-casing="${i}"]`);
        if (casing === null) { out.push(`link ${i}: no casing`); continue; }
        const cband = casing.querySelector("[data-plan-casing='band']")!;
        if (cband.getAttribute("d") !== g.querySelector("[data-plan-ribbon-band]")!.getAttribute("d")) out.push(`link ${i}: its casing does not follow its band`);
        if (Number(cband.getAttribute("stroke-width")) !== w + 2) out.push(`link ${i}: casing ${cband.getAttribute("stroke-width")} wide round a ${w} band, want ${w + 2}`);
        if (casing.querySelector("[data-plan-casing='head']")?.getAttribute("d") !== headD) out.push(`link ${i}: its head is not cased`);
    }
    // Every casing under every link's ink — the layer's children, in the plot's clip.
    const kids = [...svgEl.querySelector("[data-plan-clip]")!.children];
    const lastCasing = kids.map((k) => k.hasAttribute("data-plan-ribbon-casing")).lastIndexOf(true);
    const firstInk = kids.findIndex((k) => k.hasAttribute("data-plan-link"));
    if (lastCasing > firstInk) out.push("a casing is drawn over a link's ink");
    // The captions, each on its knockout.
    const placed: { x: number; y: number; text: string }[] = [];
    for (const label of root.querySelectorAll("[data-plan-ribbon-label]")) {
        const text = label.querySelector<SVGTextElement>("[data-plan-ribbon-caption]")!;
        const knockout = label.querySelector("[data-plan-ribbon-knockout]")!;
        const [x, y] = [Number(text.getAttribute("x")), Number(text.getAttribute("y"))];
        const len = text.getComputedTextLength();
        const k = ["x", "y", "width", "height"].map((a) => Number(knockout.getAttribute(a)));
        const want_ = [x - len / 2 - 4, y - 9.5, len + 8, 12];
        if (k.some((v, j) => !near(v, want_[j]!))) out.push(`caption "${text.textContent}": knockout ${k.map((v) => v.toFixed(1)).join(" ")}, want ${want_.map((v) => v.toFixed(1)).join(" ")}`);
        const tb = text.getBoundingClientRect();
        const kb = knockout.getBoundingClientRect();
        if (tb.top < kb.top - 0.5 || tb.bottom > kb.bottom + 0.5) out.push(`caption "${text.textContent}": its text leaves its knockout`);
        for (const p of placed) {
            if (Math.abs(p.x - x) < 60 && Math.abs(p.y - y) < 12) out.push(`captions "${p.text}" and "${text.textContent}" within 60 × 12 of each other`);
        }
        placed.push({ x, y, text: text.textContent ?? "" });
    }
    // The slots, on the plot's edges.
    const plots = [...root.querySelectorAll("[data-plan-plot]")].map((el) => el.getBoundingClientRect());
    const plotLeft = Math.min(...plots.map((p) => p.left));
    const plotRight = Math.max(...plots.map((p) => p.right));
    const slots = [...root.querySelectorAll<SVGPathElement>("[data-plan-linkslot]")];
    if (slots.length !== want.slots) out.push(`${slots.length} slots, want ${want.slots}`);
    for (const slot of slots) {
        const b = slot.getBBox();
        const side = slot.getAttribute("data-plan-linkslot");
        const edge = side === "right" ? svg.left + b.x + b.width : svg.left + b.x;
        if (!near(b.width, 40) || !near(b.height, want.bar)) out.push(`slot (${side}): ${b.width.toFixed(1)} × ${b.height.toFixed(1)}, want 40 × ${want.bar}`);
        if (!near(edge, side === "right" ? plotRight : plotLeft)) out.push(`slot (${side}): not on the plot's edge`);
    }
    // The layers.
    const z = (el: Element | null) => (el === null ? "absent" : getComputedStyle(el).zIndex);
    const zs = { links: z(layer), controls: z(root.querySelector("[data-plan-control]")?.parentElement ?? null), now: z(root.querySelector("[data-plan-row] [data-plan-now]")) };
    if (zs.links !== "5" || zs.controls !== "6" || zs.now !== "7") out.push(`layers ${JSON.stringify(zs)}, want links 5, controls 6, now 7`);
    return out;
};

/**
 * Each row control drawn otherwise than #1258 draws it — the user's ruling
 * over `Plan links.html`'s hover reveal: 24px sm ghost buttons, no ring, at the
 * end of the row's gutter line, after its label, value and status, inside the
 * gutter cell and centred on the line — and always shown, so a row says it has
 * links before it is hovered.
 */
const rowControlsLaidOut = (root: Element): string[] => {
    const out: string[] = [];
    const boxes = [...new Set([...root.querySelectorAll("[data-plan-control]")].map((c) => c.parentElement!))];
    if (boxes.length === 0) return ["no row control"];
    for (const box of boxes) {
        const row = box.closest("[data-plan-row]")!.getAttribute("data-plan-row")!;
        const cell = box.closest("[role='rowheader']")!;
        const line = box.closest("[data-plan-gutter='name']")!;
        let opacity = 1;
        for (let el: Element | null = box; el !== null && el !== cell; el = el.parentElement) opacity *= Number(getComputedStyle(el).opacity);
        if (Math.abs(opacity - 1) > 0.01 || getComputedStyle(box).visibility !== "visible") out.push(`${row}: its controls are hidden (opacity ${opacity.toFixed(2)})`);
        const b = box.getBoundingClientRect();
        const cs = getComputedStyle(cell);
        const end = cell.getBoundingClientRect().right - Number.parseFloat(cs.borderRightWidth) - Number.parseFloat(cs.paddingRight);
        if (Math.abs(end - b.right) > 0.5) out.push(`${row}: its controls end ${(end - b.right).toFixed(1)}px short of its gutter line's end`);
        const l = line.getBoundingClientRect();
        if (Math.abs((b.top + b.bottom) / 2 - (l.top + l.bottom) / 2) > 0.5) out.push(`${row}: its controls are off its line`);
        for (const part of ["label", "right"]) {
            const before = line.querySelector(`[data-plan-gutter='${part}']`);
            if (before !== null && before.getBoundingClientRect().right > b.left + 0.5) out.push(`${row}: its ${part} runs under its controls`);
        }
        for (const btn of box.querySelectorAll("[data-plan-control]")) {
            const r = btn.getBoundingClientRect();
            if (Math.abs(r.width - 24) > 0.5 || Math.abs(r.height - 24) > 0.5) out.push(`${row}: a control ${r.width}×${r.height}, want 24×24`);
            if (getComputedStyle(btn).boxShadow !== "none") out.push(`${row}: a ring round a control`);
        }
    }
    return out;
};

/**
 * How each links-focus tag draws (#1277), by its row: `whole`; `ellipsized`,
 * a letter and the ellipsis at least inside its padding; or `hidden`, wrapped
 * off its line, out of sight — by #1264's rule. Anything else is said in words.
 */
const tagStates = (root: Element): { row: string; state: string }[] => [...root.querySelectorAll("[data-plan-gutter='named']")].map((line) => {
    const row = line.closest("[data-plan-row]")!.getAttribute("data-plan-row")!;
    const tag = line.querySelector<HTMLElement>(":scope > [data-plan-focustag]")!;
    if (tag.getBoundingClientRect().top >= line.getBoundingClientRect().bottom - 0.5) return { row, state: "hidden" };
    if (tag.scrollWidth <= tag.clientWidth) return { row, state: "whole" };
    const cs = getComputedStyle(tag);
    const probe = document.body.appendChild(document.createElement("span"));
    probe.style.cssText = `position: fixed; visibility: hidden; white-space: pre; font: ${cs.font}; letter-spacing: ${cs.letterSpacing}`;
    probe.textContent = "00";
    const twoCh = probe.getBoundingClientRect().width;
    probe.remove();
    const inside = tag.clientWidth - Number.parseFloat(cs.paddingLeft) - Number.parseFloat(cs.paddingRight);
    return { row, state: inside + 0.5 >= twoCh ? "ellipsized" : `cut to ${inside.toFixed(1)}px, under a letter and the ellipsis (${twoCh.toFixed(1)}px)` };
});

/** The ways #1264's rule lets a tag draw. */
const TAG_DRAWN = ["whole", "ellipsized", "hidden"];

/** The row kinds among the entry's measured rows. */
async function kindsMeasured(entry: Locator): Promise<string[]> {
    return entry.evaluate((root) => [...new Set(
        [...root.querySelectorAll("[data-plan-h][data-plan-kind]")].map((el) => el.getAttribute("data-plan-kind") ?? ""),
    )].sort());
}

test.describe("Plan geometry (#817)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

    for (const name of EXAMPLES) {
        test(`${name}: every body item renders at its model height`, async ({ page }) => {
            const entry = await openExample(page, name);
            await expect.poll(() => measured(entry)).toBeGreaterThan(0);
            await expect.poll(() => mismatches(entry)).toEqual([]);
        });
    }

    test("chart rows hold at rest and expanded", async ({ page }) => {
        const entry = await openExample(page, "planMeasures");
        const spark = entry.locator(rowSel("spark", "spark"));
        const rest = Number(await spark.getAttribute("data-plan-h"));
        // The expandable spark's gutter is its toggle.
        await spark.locator("> :first-child").click();
        await expect(spark).not.toHaveAttribute("data-plan-h", String(rest));
        await expect.poll(() => mismatches(entry), "expanded").toEqual([]);
        await spark.locator("> :first-child").click();
        await expect(spark).toHaveAttribute("data-plan-h", String(rest));
        await expect.poll(() => mismatches(entry), "at rest").toEqual([]);
    });

    test("every row kind holds at every density, its chart at rest and expanded", async ({ page }) => {
        // The configurator's canvas holds every row kind, and its density
        // control re-rhythms them all.
        const entry = await openExample(page, "planVariants");
        // The configurator's preview pane is phone-width, so the canvas lays
        // out as narrow cards (§10) — which have no rows. Widen the canvas
        // itself: it measures its own container, and lays out rows.
        await page.addStyleTag({ content: "[data-plan-body] { min-width: 960px; }" });
        await expect(entry.locator("[data-plan-row]").first()).toBeVisible();
        const chart = entry.locator('[data-plan-kind="chart"]');
        // The widened canvas overflows the pane on both sides, so the gutter
        // lies outside the pane's clip and a pointer there lands on the
        // controls beside it — the toggle is dispatched to the gutter itself.
        // (Layout boxes, which is all this measures, are not clipped.)
        const toggleChart = () => chart.locator("> :first-child").dispatchEvent("click");
        // A one-line span row — the shared row, which density sets.
        const spanRow = entry.locator(rowSel("press", "p04"));
        const rowAt: Record<string, number> = {};
        for (const density of ["COMFORTABLE", "CONDENSED", "COMPACT"]) {
            await entry.getByText(density, { exact: true }).click();
            await expect(entry.getByRole("radio", { name: density })).toBeChecked();
            await expect.poll(() => kindsMeasured(entry), density).toEqual(KINDS);
            await expect.poll(() => mismatches(entry), density).toEqual([]);
            rowAt[density] = Number(await spanRow.getAttribute("data-plan-h"));
            // The spark's gutter is its toggle: the chart expanded, then back.
            const rest = await chart.getAttribute("data-plan-h") ?? "";
            await toggleChart();
            await expect(chart).not.toHaveAttribute("data-plan-h", rest);
            await expect.poll(() => mismatches(entry), `${density} · chart expanded`).toEqual([]);
            await toggleChart();
            await expect(chart).toHaveAttribute("data-plan-h", rest);
            await expect.poll(() => mismatches(entry), `${density} · chart at rest`).toEqual([]);
        }
        // The sweep reached the canvas: compact tightens the shared row, and
        // condensed keeps the default rhythm.
        expect(rowAt.COMPACT).toBeLessThan(rowAt.COMFORTABLE!);
        expect(rowAt.CONDENSED).toBe(rowAt.COMFORTABLE);
    });

    test("row focus holds — rails and gap bands (R1), context strips and the grown focal row (R2)", async ({ page }) => {
        const entry = await openExample(page, "planTargetState");
        await entry.locator('[data-plan-control="links"]').first().click();
        // Rails and gap bands are measured items too — they carry the model's height.
        await expect(entry.locator("[data-plan-rail][data-plan-h], [data-plan-gap][data-plan-h]").first()).toBeVisible();
        await expect.poll(() => mismatches(entry), "R1").toEqual([]);
        await entry.locator("[data-plan-focusback]").click();
        await entry.locator('[data-plan-control="expand"]').first().click();
        await expect(entry.locator("[data-plan-row][data-ctx][data-plan-h]").first()).toBeVisible();
        await expect(entry.locator("[data-plan-row][data-expanded][data-plan-h]")).toHaveCount(1);
        await expect.poll(() => mismatches(entry), "R2").toEqual([]);
        // A strip's tile is a mark as wide as its parts, nothing between them (#1266): those on its line, each one's —
        // inside its border, which a proposal's dashed ring draws.
        const stripTiles = () => entry.evaluate((root) => [...root.querySelectorAll("[data-plan-row][data-ctx] [data-event][data-ctx]")].flatMap((el) => {
            const b = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            const parts = [...el.children].map((c) => c.getBoundingClientRect());
            if (parts.length === 0 || parts.some((p) => p.top >= b.bottom)) return [];
            const across = parts.reduce((sum, p) => sum + p.width, 0);
            const inside = b.width - Number.parseFloat(cs.borderLeftWidth) - Number.parseFloat(cs.borderRightWidth);
            return [{ key: el.getAttribute("data-event"), n: parts.length, width: Math.round(inside * 10) / 10, parts: Math.round(across * 10) / 10 }];
        }));
        // A proposal's grip and its word among them: two parts side by side.
        await expect.poll(async () => (await stripTiles()).filter((t) => t.n > 1).length, "no strip tile of two parts on its line").toBeGreaterThan(0);
        expect((await stripTiles()).filter((t) => Math.abs(t.width - t.parts) > 0.5)).toEqual([]);
    });
});

/**
 * The toolbar's segments, against the `Plan Spec v2.html` §1 mock's toolbar
 * (#632): the GROUP · RESOURCE strip rides between the search and the range,
 * the WEEK · DAY strip after the range, and both are the mock's `.seg` — a
 * 25px strip of 23px segments. The grain it picks re-lays the body, whose
 * strips must hold their model heights like every other item.
 */
test.describe("Plan toolbar segments (#632)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

    test("the grain segment sits between the search and the range, both strips at the mock's size; GROUP re-lays the body at its model heights", async ({ page }) => {
        const entry = await openExample(page, "planTargetState");
        const toolbar = entry.locator("[data-builder-frame] [data-frame-slot='toolbar']");
        const grain = toolbar.locator("[data-plan-seg='grain']");
        const resolution = toolbar.locator("[data-plan-seg='resolution']");
        await expect(grain.getByRole("radio")).toHaveText(["GROUP", "RESOURCE"]);
        await expect(grain.getByRole("radio", { name: "RESOURCE" })).toBeChecked();
        const layout = () => toolbar.evaluate((bar) => {
            const box = (el: Element | null) => (el === null ? null : el.getBoundingClientRect());
            // The toolbar's items (#952): the rail's cluster, the grain strip,
            // the range cluster between the two strips, the resolution strip.
            const item = (key: string) => box(bar.querySelector(`[data-toolbar-item='${key}']`));
            const cluster = item("cluster");
            const range = item("range");
            const g = item("grain")!;
            const r = item("resolution")!;
            const heights = [...bar.querySelectorAll("[data-plan-seg]")].map((s) => ({
                strip: s.getBoundingClientRect().height,
                segments: [...s.querySelectorAll("[role='radio']")].map((b) => b.getBoundingClientRect().height),
            }));
            return {
                order: cluster !== null && range !== null
                    && cluster.right <= g.left && g.right <= range.left && range.right <= r.left,
                heights,
            };
        });
        await expect.poll(layout).toEqual({
            order: true,
            heights: [{ strip: 25, segments: [23, 23] }, { strip: 25, segments: [23, 23, 23] }],
        });
        await expect(resolution.getByRole("radio")).toHaveText(["MONTH", "WEEK", "DAY"]);

        await grain.getByRole("radio", { name: "GROUP" }).click();
        await expect(grain.getByRole("radio", { name: "GROUP" })).toBeChecked();
        await expect(entry.locator("[data-slot='ruler'] > :first-child")).toHaveText("GROUP");
        await expect(entry.locator("[data-plan-group][aria-expanded='false']").first()).toBeVisible();
        await expect.poll(() => mismatches(entry), "GROUP grain").toEqual([]);
    });
});

/**
 * The links focus, as `Plan links.html` draws it (#1258). Its links are laid
 * out from the model (#818) — the body's own heights, the geometry table's
 * bars, the scale across the plot — and never measured; here, in a real
 * layout, each leaves its source run's end and enters its destination run's
 * start, at its weight, cased in the paper, its caption on its knockout, an end
 * past the window in its slot, all under the row controls and the now line.
 */
test.describe("Plan links focus (#818, #1258)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured at the desktop project's widths");

    /** The links focuses measured: each example, the row whose links control
     *  opens its family, its links' weights in order — each link's quantity's
     *  third of the family's largest — and how many of their ends land past the
     *  window. planTargetState holds two families. H1-P09's is the spec's own:
     *  24, 40, 88, 32, 18 and 91 k sheets, the largest 91 — an S, a same-row
     *  runoff between abutting runs, loopbacks, one dropping onto its
     *  destination at the window's start, a rising loop, and a landing past the
     *  window (dlv's run starts where the window ends). H1-P03's one link, its
     *  family's largest, leaves a run that abuts the next and enters one that
     *  abuts the last. planEventLinks is every case at once (`EVENT_ROUTES`
     *  below), on a bounded canvas: at rest the two links between rows below its
     *  view draw nothing. */
    const FOCUSES = [
        { label: "planTargetState (H1-P09's family)", name: "planTargetState", file: PLAN_EXAMPLES, row: rowSel("detail", "H1-P09"), weights: [2, 4, 8, 4, 2, 8], slots: 1 },
        { label: "planTargetState (H1-P03's transfer)", name: "planTargetState", file: PLAN_EXAMPLES, row: rowSel("presses", "Hall 1", "H1-P03"), weights: [8], slots: 0 },
        {
            label: "planEventLinks", name: "planEventLinks", file: PLAN_EVENT_EXAMPLES, row: rowSel("presses.span", "Hall A", "a1"),
            weights: [1.5, 2, 2, 8, 4, 8, 2, 4, 2, 2, 4, 4, 4, 2, 4], slots: 2,
        },
    ] as const;
    /** The desktop project's width, and a laptop's. */
    const WIDTHS = [1280, 1024] as const;

    /** Open a family's links focus at a width — the page taking `css` first, when given — and let the focused
     *  canvas come to rest. */
    async function focusLinks(page: Page, focus: (typeof FOCUSES)[number], width: number, css?: string): Promise<Locator> {
        await page.setViewportSize({ width, height: 800 });
        const entry = await openExample(page, focus.name, focus.file);
        if (css !== undefined) await page.addStyleTag({ content: css });
        await entry.locator(`${focus.row} [data-plan-control="links"]`).click();
        await expect(entry.locator("[data-plan-ribbons] [data-plan-link]")).toHaveCount(focus.weights.length);
        // Away from every link and row: nothing lit, no control hovered.
        await page.mouse.move(0, 0);
        await settled(page);
        return entry;
    }

    for (const focus of FOCUSES) {
        for (const width of WIDTHS) {
            test(`${focus.label} at ${width}px: each link leaves its source's end and enters its destination's start as they draw, and nothing of it leaves the plot`, async ({ page }) => {
                const entry = await focusLinks(page, focus, width);
                await expect.poll(() => entry.evaluate(ribbonEnds)).toEqual([]);
                await expect.poll(() => entry.evaluate(outsidePlot)).toEqual([]);
            });

            test(`${focus.label} at ${width}px: each link at its quantity's weight, its head 8 × max(8, 2 × weight), cased in the paper under every link's ink; each caption on its knockout, none within 60 × 12 of another; an end past the window in its 40px slot; the links under the row controls and the now line`, async ({ page }) => {
                const entry = await focusLinks(page, focus, width);
                await expect.poll(() => entry.evaluate(linkFigures, { weights: [...focus.weights], slots: focus.slots, bar: 20 })).toEqual([]);
            });
        }
    }

    /** planEventLinks' links by key, and the figure each draws at rest: every case of the grammar once. The two
     *  links between rows below the view (`folded`, `books`) draw nothing; four reach a row below it in a stub. */
    const EVENT_ROUTES_AT_REST = {
        plates: "s", covers: "s", card: "s", inserts: "loop", "report-covers": "loop", "seed-prints": "loop",
        tags: "feed", pads: "runoff", proofs: "loop", "proof-sheets": "s", tickets: "s",
        sections: "stub", "sections-more": "stub", posters: "stub", "book-blocks": "stub",
    };
    /** …and scrolled to the end, the paper stock's rows under the events (#1259): the plates and the tags draw
     *  nothing, and five leave a row above the view in a stub. */
    const EVENT_ROUTES_AT_THE_END = {
        covers: "stub", card: "stub", inserts: "stub", "report-covers": "loop", "seed-prints": "loop",
        pads: "runoff", proofs: "loop", "proof-sheets": "stub", tickets: "s", sections: "s", "sections-more": "s",
        folded: "s", books: "s", posters: "stub", "book-blocks": "loop",
    };

    test("planEventLinks: every case its own link — each draws its figure at rest and scrolled to the end, meeting its elements as they draw; scrolled between, the posters' link crosses the view as a band; the night run is entered from above; the layer lies in the rows' own stacking context", async ({ page }) => {
        const entry = await focusLinks(page, FOCUSES[2], 1280);
        const routes = () => entry.evaluate((root) => Object.fromEntries([...root.querySelectorAll("[data-plan-link]")].map((g) =>
            [g.querySelector("[data-link]")!.getAttribute("data-link-key"), g.getAttribute("data-plan-route")])));
        await expect.poll(routes).toEqual(EVENT_ROUTES_AT_REST);
        // The night run starts at the window's start: its link drops onto it, its head pointing down onto the bar.
        const proofsHead = () => entry.evaluate((root) => {
            const g = root.querySelector('[data-link-key="proofs"]')!.closest("[data-plan-link]")!;
            const n = g.querySelector("[data-plan-ribbon-head]")!.getAttribute("d")!.split(/[\sMLZ]+/).filter((t) => t !== "").map(Number);
            return n[1] === n[5] && n[3]! > n[1]! ? "down" : "level";
        });
        expect(await proofsHead()).toBe("down");
        const frame = entry.locator('[data-virtual-rows="bounded"]');
        await frame.evaluate((el) => { el.scrollTop = el.scrollHeight; });
        await expect.poll(routes).toEqual(EVENT_ROUTES_AT_THE_END);
        await expect.poll(() => entry.evaluate(ribbonEnds)).toEqual([]);
        await expect.poll(() => entry.evaluate(outsidePlot)).toEqual([]);
        // Between: the shop posters' press above the view and the dispatch bay below it.
        await frame.evaluate((el) => { el.scrollTop = 80; });
        await expect.poll(async () => (await routes())["posters"]).toBe("band");
        await expect.poll(() => entry.evaluate(outsidePlot)).toEqual([]);
        // In the rows' translated column, the layer sorts with what they draw: the row controls and the now line over it.
        expect(await entry.evaluate((root) => {
            const box = root.querySelector("[data-plan-ribbons]")!.closest("[data-virtual-overlay]");
            return box !== null && box.parentElement!.querySelector(":scope > [data-index]") !== null;
        })).toBe(true);
    });

    test("planEventLinks: a caption drawn wider than the layout reckons it — as a minimum font size draws it — still lies inside the plot, moved in by its drawn width", async ({ page }) => {
        // Each letter 3px wider than the mono face draws it: the layout places
        // a caption by its reckoned width, and only the drawn width keeps the
        // captions it moved in at the plot's edges inside it.
        const entry = await focusLinks(page, FOCUSES[2], 1280, "[data-plan-ribbon-caption] { letter-spacing: 3px; }");
        expect(await entry.evaluate((root) => getComputedStyle(root.querySelector("[data-plan-ribbon-caption]")!).letterSpacing)).toBe("3px");
        await expect.poll(() => entry.evaluate(outsidePlot)).toEqual([]);
    });

    test("planTargetState: the focus band is 32 tall, its link and caption 20 in from its ends; each family row's Tag is 20 tall and the focused row has none; a lone unrelated row is an 11 rail and each run of hidden rows one 22 gap band", async ({ page }) => {
        const entry = await focusLinks(page, FOCUSES[0], 1280);
        const read = await entry.evaluate((root) => {
            const band = root.querySelector("[data-plan-focusbar]")!;
            const b = band.getBoundingClientRect();
            const back = root.querySelector("[data-plan-focusback]")!;
            const caption = band.lastElementChild!;
            return {
                h: b.height,
                backIn: back.getBoundingClientRect().left - b.left,
                captionIn: b.right - caption.getBoundingClientRect().right,
                back: back.textContent,
                caption: caption.textContent,
                capitals: getComputedStyle(caption).textTransform,
                tags: [...root.querySelectorAll("[data-plan-focustag]")].map((t) => ({
                    row: t.closest("[data-plan-row]")!.getAttribute("data-plan-row"),
                    word: t.textContent,
                    h: t.getBoundingClientRect().height,
                })),
                rails: [...root.querySelectorAll("[data-plan-rail]")].map((r) => r.getBoundingClientRect().height),
                gaps: [...root.querySelectorAll("[data-plan-gap]")].map((g) => {
                    const cell = g.querySelector("[role='gridcell']")!;
                    return {
                        h: g.getBoundingClientRect().height,
                        // The count beside the ⋯ icon (its svg is hidden too).
                        count: cell.querySelector("span[aria-hidden='true']")?.textContent,
                        heard: cell.lastElementChild?.textContent,
                    };
                }),
            };
        });
        expect(read).toEqual({
            h: 32, backIn: 20, captionIn: 20,
            back: "← All rows",
            caption: "Links · H1-P09 · 3 upstream · 3 downstream",
            capitals: "uppercase",
            tags: [
                { row: rowId("flavours", "H1-P07"), word: "Upstream", h: 20 },
                { row: rowId("rollup", "Contract A", "H1-P03"), word: "Linked", h: 20 },
                { row: rowId("rollup", "Contract A", "H2-P11"), word: "Linked", h: 20 },
                { row: rowId("delivery", "dlv"), word: "Downstream", h: 20 },
            ],
            // A lone unrelated row: the KPI, each van, Contract A between its two family presses, each crew, the
            // milestones and the delivered sheets.
            rails: [11, 11, 11, 11, 11, 11, 11, 11],
            // Each run of hidden rows, in order: the local and the regional vans' section headers, each alone and its
            // group counted; the halls' strips and their members; the contracts' section header; Contract B and its
            // press; the folded quality section; the relief pool's header; the finishers' three views of two
            // machines; and the planned works.
            gaps: [
                { h: 22, count: "1", heard: "1 hidden group" }, { h: 22, count: "1", heard: "1 hidden group" },
                { h: 22, count: "10", heard: "10 hidden rows" }, { h: 22, count: "1", heard: "1 hidden group" },
                { h: 22, count: "2", heard: "2 hidden rows" }, { h: 22, count: "1", heard: "1 hidden row" },
                { h: 22, count: "1", heard: "1 hidden group" }, { h: 22, count: "6", heard: "6 hidden rows" },
                { h: 22, count: "3", heard: "3 hidden rows" },
            ],
        });
    });

    test("planTargetState: a link takes the pointer along its band — lit, it is drawn over the others with its casing and haloes the two runs it joins 4 outside them, and its caption is the canvas's tooltip", async ({ page }) => {
        const entry = await focusLinks(page, FOCUSES[0], 1280);
        // A point ON the band's centerline (the hit area is its stroke and 5
        // either side), in page px.
        const at = await entry.locator('[data-link="2"]').evaluate((path: SVGPathElement) => {
            const p = path.getPointAtLength(path.getTotalLength() / 2);
            const svg = path.ownerSVGElement!.getBoundingClientRect();
            return { x: svg.left + p.x, y: svg.top + p.y };
        });
        await page.mouse.move(at.x, at.y);
        const g = entry.locator('[data-plan-link="2"]');
        await expect(g).toHaveAttribute("data-lit", "");
        await expect(page.locator('[data-plan-overlay="tooltip"]')).toHaveText("88 k sheets");
        const read = await entry.evaluate((root) => {
            const svg = root.querySelector("[data-plan-ribbons] svg")!;
            const s = svg.getBoundingClientRect();
            const order = [...svg.querySelectorAll("[data-plan-clip] > [data-plan-link]")].map((el) => el.getAttribute("data-plan-link"));
            const lit = svg.querySelector('[data-plan-link="2"]')!;
            const hit = lit.querySelector("[data-link]")!;
            const halos = (["from", "to"] as const).map((side) => {
                const halo = lit.querySelector(`[data-plan-linkend="${side}"]`)!;
                const [x, y, w, h] = ["x", "y", "width", "height"].map((k) => Number(halo.getAttribute(k)));
                const run = root.querySelector(`[data-plan-row=${JSON.stringify(hit.getAttribute(`data-link-${side}`))}] [data-run=${JSON.stringify(hit.getAttribute(`data-link-${side}-run`))}]`)!.getBoundingClientRect();
                // Where its 1px line runs, each side: its middle 4.5 out, so the line covers 4–5 out.
                const out = [run.left - (s.left + x!), run.top - (s.top + y!), s.left + x! + w! - run.right, s.top + y! + h! - run.bottom];
                return { out: out.map((v) => Math.round(v * 10) / 10), line: getComputedStyle(halo).strokeWidth };
            });
            return { last: order[order.length - 1], cased: lit.querySelector("[data-plan-ribbon-casing]") !== null, halos };
        });
        expect(read).toEqual({
            last: "2", cased: true,
            halos: [{ out: [4.5, 4.5, 4.5, 4.5], line: "1px" }, { out: [4.5, 4.5, 4.5, 4.5], line: "1px" }],
        });
        // Off the band: it is unlit again.
        await page.mouse.move(at.x, at.y + 40);
        await expect(g).not.toHaveAttribute("data-lit", "");
    });

    test("planTargetState: in H1-P03's transfer focus at the Plan's default gutter, every family row's controls end inside its gutter cell after its label, value and status, and its tag is whole, ellipsized after a whole letter or off its line — H1-P04's, with no room for a letter, off it, its word said on hover (#1277)", async ({ page }) => {
        const entry = await focusLinks(page, FOCUSES[1], 1280);
        await expect.poll(() => entry.evaluate(rowControlsLaidOut)).toEqual([]);
        const states = () => entry.evaluate(tagStates);
        await expect.poll(async () => (await states()).filter((t) => !TAG_DRAWN.includes(t.state))).toEqual([]);
        expect((await states()).find((t) => t.row === rowId("presses", "Hall 1", "H1-P04"))?.state).toBe("hidden");
        await entry.locator(`${rowSel("presses", "Hall 1", "H1-P04")} [data-plan-gutter='named']`).hover();
        await expect(page.locator('[data-plan-overlay="tooltip"]')).toHaveText("Downstream");
    });

    test("planTargetState: in H1-P09's links focus at the Plan's default gutter, H1-P07's controls end inside its line with its value shown and its label whole — its tag gives its room up first, whole, ellipsized after a whole letter or off its line (#1277)", async ({ page }) => {
        const entry = await focusLinks(page, FOCUSES[0], 1280);
        await expect.poll(() => entry.evaluate(rowControlsLaidOut)).toEqual([]);
        await expect.poll(async () => (await entry.evaluate(tagStates)).filter((t) => !TAG_DRAWN.includes(t.state))).toEqual([]);
        const row = entry.locator(rowSel("flavours", "H1-P07"));
        const read = () => row.evaluate((el) => {
            const line = el.querySelector("[data-plan-gutter='name']")!.getBoundingClientRect();
            const value = el.querySelector<HTMLElement>("[data-plan-gutter='value']")!;
            const v = value.getBoundingClientRect();
            const label = el.querySelector<HTMLElement>("[data-plan-gutter='label']")!;
            return {
                value: value.textContent,
                valueShown: getComputedStyle(value).display !== "none" && v.left >= line.left - 0.5 && v.right <= line.right + 0.5,
                labelWhole: label.scrollWidth <= label.clientWidth,
            };
        });
        await expect.poll(read).toEqual({ value: "8k/h", valueShown: true, labelWhole: true });
    });
});

/** Every Plan example — those drawing bars, chips, tiles or rollup bands, and those drawing marks, charts, heat values,
 *  table numerals and segments, whose numbers, marks' icons and rulers the sweep reads too (#1269) — and the flagship's
 *  narrow layout on a desktop page, its box 360px wide, on the tab its rows' cards are under: the layout lands on its
 *  groups' heat strips. */
const TEXT_EXAMPLES: readonly { name: string; file: string; box?: number; tab?: string }[] = [
    ...["planTargetState", "planVariants", "planRowDrop", "planNumberAxis", "planOrdinalAxis", "slicePlanChrome", "planMeasures",
    ].map((name) => ({ name, file: PLAN_EXAMPLES })),
    { name: "planTargetState", file: PLAN_EXAMPLES, box: 360, tab: "rows" },
    ...["planEvents", "planPrintWorks", "planLibrary", "planEventLinks"].map((name) => ({ name, file: PLAN_EVENT_EXAMPLES })),
];

/** One frame of a ruler as it painted: its track's width, and the labels it drew, by index. */
interface RulerPainted { width: number; sig: string }

/** What the ruler paint checks keep in the page ({@link startRulerPaint}). */
interface RulerPaintWindow {
    __rulerPainted: RulerPainted[];
    __rulerPaintStop: () => void;
}

/**
 * Samples what a ruler paints, until {@link stopRulerPaint}: every frame as it
 * paints, as {@link startCellPaint} samples a cell — read after the ruler's own
 * observer has answered the frame's width. Each sample is the track's width and
 * the labels drawn, by index.
 */
async function startRulerPaint(ruler: Locator): Promise<void> {
    await ruler.evaluate((el) => {
        const w = window as unknown as RulerPaintWindow;
        const ticks = [...el.querySelectorAll("[data-slot='rulerTick']")];
        const track = ticks[0]!.parentElement!;
        const sig = () => ticks.flatMap((t, i) => (getComputedStyle(t.querySelector("[data-tick-label]")!).visibility === "hidden" ? [] : [i])).join(" ");
        const strip = document.body.appendChild(document.createElement("div"));
        strip.style.cssText = "position: fixed; left: 0; top: 0; width: 1px; height: 0; pointer-events: none;";
        w.__rulerPainted = [];
        const observer = new ResizeObserver(() => {
            w.__rulerPainted.push({ width: Math.round(track.getBoundingClientRect().width * 100) / 100, sig: sig() });
        });
        observer.observe(strip);
        let frame = requestAnimationFrame(function tick() {
            strip.style.width = strip.style.width === "1px" ? "2px" : "1px";
            frame = requestAnimationFrame(tick);
        });
        w.__rulerPaintStop = () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
            strip.remove();
        };
    });
}

/** Stops {@link startRulerPaint}, returning what it sampled. */
async function stopRulerPaint(ruler: Locator): Promise<RulerPainted[]> {
    return ruler.evaluate(() => {
        const w = window as unknown as RulerPaintWindow;
        w.__rulerPaintStop();
        return w.__rulerPainted;
    });
}

/**
 * An element's text (#1258, #1264, #1266, #1269): no bar, chip, tile or rollup
 * band in a Plan example draws a partial glyph — its label whole, ellipsized
 * after a whole letter, or hidden; a bar's quantity whole beside a whole label
 * or not drawn; an icon whole or not drawn — no cell draws part of a number,
 * every mark's icon lies inside it, and the ruler draws its labels whole and
 * apart, every period's start among them: at a wide desktop's width, the
 * desktop's and a laptop's, in both themes, and the print works with its
 * inspector pinned. A label or a number too narrow to show is one hover away,
 * in the canvas's tooltip.
 */
test.describe("Plan element text (#1258, #1264, #1266, #1269)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured at the desktop project's widths");

    for (const { name, file, box, tab } of TEXT_EXAMPLES) {
        for (const width of [1440, 1280, 1024]) {
            for (const theme of ["light", "dark"] as const) {
                test(`${name}${box === undefined ? "" : ` in a ${box}px box`} at ${width}px (${theme}): no bar, chip, tile or rollup band draws a partial glyph — its label whole, ellipsized after a whole letter, or hidden; a bar's quantity whole beside a whole label or not drawn; an icon whole or not drawn; no number in a cell cut, every mark's icon inside it; the ruler's labels whole and apart, every period's start labelled (#1269)`, async ({ page }) => {
                    await page.setViewportSize({ width, height: 800 });
                    const entry = await openExample(page, name, file, theme);
                    if (box !== undefined) await sizeBox(page, planBox(entry), box);
                    if (tab !== undefined) await entry.locator(`[data-plan-narrow] [data-plan-tab=${JSON.stringify(tab)}]`).click();
                    // Something it measures is drawn: an element, an event's mark, a chart's, a heat value, a table's
                    // numerals or a segment.
                    await expect.poll(() => entry.locator("[data-run], [data-chip], [data-event], [data-plan-band], [data-mark], [data-plan-mark], [data-plan-heat-label], [data-table-parts], [data-fill]").count()).toBeGreaterThan(0);
                    await expect.poll(() => entry.evaluate(cutText)).toEqual([]);
                    await expect.poll(() => entry.evaluate(cutNumbers)).toEqual([]);
                    await expect.poll(() => entry.evaluate(rulerFaults)).toEqual([]);
                });
            }
        }
    }

    for (const width of [1440, 1280]) {
        for (const theme of ["light", "dark"] as const) {
            test(`planPrintWorks at ${width}px (${theme}), a job selected and the inspector pinned beside main, as the user saw it (#1269): the ruler's labels whole and apart, every period's start labelled; no number in a cell cut, every mark's icon inside it`, async ({ page }) => {
                await page.setViewportSize({ width, height: 900 });
                const entry = await openExample(page, "planPrintWorks", PLAN_EVENT_EXAMPLES, theme);
                // A box as wide as the window: both panes pinned beside main where it keeps its 480px, main the narrower for them.
                await entry.locator("[data-plan-frame]").first().locator("xpath=..").evaluate((el, w) => { (el as HTMLElement).style.width = `${w}px`; }, width);
                await settled(page);
                await entry.locator(`${rowSel("presses.span", "Hall A", "a1")} [data-run]`, { hasText: "Spring catalogue" }).click();
                await settled(page);
                await expect(entry.locator("[data-builder-frame] > [data-frame-slot='body'] > [data-frame-slot='end'] [data-plan-inspector='event']")).toBeVisible();
                await expect.poll(() => entry.evaluate(rulerFaults)).toEqual([]);
                await expect.poll(() => entry.evaluate(cutNumbers)).toEqual([]);
                await expect.poll(() => entry.evaluate(cutText)).toEqual([]);
            });
        }
    }

    test("planPrintWorks: its ruler never paints labels it does not rest on — its frame narrowed 3px at a time from 1440px to 1000px, every frame at one width draws the labels that width rests on, across the widths its labels thin at (#1269)", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const entry = await openExample(page, "planPrintWorks", PLAN_EVENT_EXAMPLES);
        const host = entry.locator("[data-plan-frame]").first().locator("xpath=..");
        const ruler = entry.locator("[data-slot='ruler']").first();
        await startRulerPaint(ruler);
        await host.evaluate(async (el: HTMLElement) => {
            const frames = (n: number) => new Promise<void>((resolve) => {
                const step = (k: number) => { if (k === 0) resolve(); else requestAnimationFrame(() => step(k - 1)); };
                step(n);
            });
            for (let width = 1440; width >= 1000; width -= 3) {
                el.style.width = `${width}px`;
                await frames(3);
            }
        });
        const painted = await stopRulerPaint(ruler);
        expect(painted.length, "the frames sampled").toBeGreaterThan(300);
        // Every frame at one width drew the same labels — what that width rests on, never the width before it's.
        const drawn = new Map<number, Set<string>>();
        for (const p of painted) drawn.set(p.width, (drawn.get(p.width) ?? new Set<string>()).add(p.sig));
        expect([...drawn].filter(([, sigs]) => sigs.size > 1).map(([width, sigs]) => `at ${width}px: ${[...sigs].map((sig) => `"${sig}"`).join(" then ")}`)).toEqual([]);
        // The sweep crossed widths its labels thin at.
        expect(new Set(painted.map((p) => p.sig)).size, "the label sets the sweep drew").toBeGreaterThan(1);
        await expect.poll(() => entry.evaluate(rulerFaults)).toEqual([]);
    });

    /** Each element set either side of a width its text turns at (#1264) — the examples draw few such widths. In
     *  the mono faces a letter and the ellipsis take 2ch: 11.4px at a band's 9.5px, which has no padding, and 12px
     *  at a chip's 10px, inside its 9px padding either side; a chip's icon takes 1.25em, 12.5px, and its gap 4px.
     *  So a plain chip's label turns at 30px, a chip's icon at 30.5px, and the label beside it at 46.5px. */
    const TURNS: readonly { name: string; file: string; sel: string; width: number; label: boolean; icon: boolean | null }[] = [
        { name: "planTargetState", file: PLAN_EXAMPLES, sel: "[data-plan-band]", width: 10, label: false, icon: null },
        { name: "planTargetState", file: PLAN_EXAMPLES, sel: "[data-plan-band]", width: 16, label: true, icon: null },
        { name: "planVariants", file: PLAN_EXAMPLES, sel: "[data-chip]:not([data-icon])", width: 28, label: false, icon: null },
        { name: "planVariants", file: PLAN_EXAMPLES, sel: "[data-chip]:not([data-icon])", width: 32, label: true, icon: null },
        { name: "planPrintWorks", file: PLAN_EVENT_EXAMPLES, sel: "[data-chip][data-icon]", width: 28, label: false, icon: false },
        { name: "planPrintWorks", file: PLAN_EVENT_EXAMPLES, sel: "[data-chip][data-icon]", width: 40, label: false, icon: true },
        { name: "planPrintWorks", file: PLAN_EVENT_EXAMPLES, sel: "[data-chip][data-icon]", width: 50, label: true, icon: true },
    ];

    for (const turn of TURNS) {
        const parts = `${turn.label ? "its label" : "no label"}${turn.icon === null ? "" : turn.icon ? " and its icon" : " and no icon"}`;
        test(`${turn.name}: ${turn.sel} at ${turn.width}px draws ${parts}, and no partial glyph`, async ({ page }) => {
            const entry = await openExample(page, turn.name, turn.file);
            const sel = `:is([data-plan-row], [data-plan-card]) ${turn.sel}:not([data-ctx])`;
            await page.addStyleTag({ content: `${sel} { width: ${turn.width}px !important; min-width: 0 !important; }` });
            const drawn = () => entry.evaluate((root, sel) => [...root.querySelectorAll(sel)].map((el) => {
                const shown = (part: Element | null) => (part === null ? null : getComputedStyle(part).display !== "none");
                return { label: shown(el.querySelector(":scope > [data-plan-label]")), icon: shown(el.querySelector(":scope > [data-plan-icon]")) };
            }), sel);
            await expect.poll(async () => (await drawn()).length, `no ${turn.sel} drawn`).toBeGreaterThan(0);
            await expect.poll(async () => (await drawn()).filter((d) => d.label !== turn.label || d.icon !== turn.icon)).toEqual([]);
            await expect.poll(() => entry.evaluate(cutText)).toEqual([]);
        });
    }

    /** Each planTargetState tile set either side of a room its parts turn at (#1266): the room its cell leaves it set,
     *  which the tile shrinks to. A tile sets its parts at 9.5px inside its 5px padding either side — a proposal's
     *  dashed ring a 1px border more — 4px apart, each icon 8px tall at its own width: a proposal's grip 5px, the
     *  truck 10px; a letter and the ellipsis take 2ch, 11.4px. So the MIXED tile, which fills its cell, draws its
     *  label from 21.4px of room and whole from 38.5px; a proposal's grip from 17px, and its "plan" beside it from
     *  32.4px — 28.4px were its parts not 4px apart; the regional van's truck from 22px. What a tile draws sits on its
     *  line, centred along it and on its height, and the tile is never wider than its room. */
    const TILE_TURNS: readonly { key: string; room: number; label: boolean | null; icon: boolean | null }[] = [
        { key: "m4", room: 20, label: false, icon: null },
        { key: "m4", room: 24, label: true, icon: null },
        { key: "m4", room: 46, label: true, icon: null },
        { key: "a5", room: 16, label: false, icon: false },
        { key: "a5", room: 20, label: false, icon: true },
        { key: "a5", room: 30, label: false, icon: true },
        { key: "a5", room: 36, label: true, icon: true },
        { key: "m5", room: 20, label: null, icon: false },
        { key: "m5", room: 24, label: null, icon: true },
    ];

    for (const turn of TILE_TURNS) {
        const parts = `${turn.label === null ? "" : turn.label ? "its label" : "no label"}${turn.label !== null && turn.icon !== null ? " and " : ""}${turn.icon === null ? "" : turn.icon ? "its icon" : "no icon"}`;
        test(`planTargetState: tile ${turn.key} in ${turn.room}px of room draws ${parts}, centred on its line, and no partial glyph`, async ({ page }) => {
            const entry = await openExample(page, "planTargetState");
            const tile = entry.locator(`[data-plan-row] [data-event=${JSON.stringify(turn.key)}]:not([data-ctx])`);
            await expect(tile).toHaveCount(1);
            // The cell as wide as its padding and caption, and the room asked for.
            await tile.evaluate((el, room) => {
                const cell = el.closest<HTMLElement>("[data-plan-cell]")!;
                const extra = cell.getBoundingClientRect().width - el.closest("[data-plan-cell-tiles]")!.getBoundingClientRect().width;
                cell.style.setProperty("width", `${room + extra}px`, "important");
                cell.style.setProperty("min-width", "0", "important");
            }, turn.room);
            const drawn = () => tile.evaluate((el, room) => {
                const b = el.getBoundingClientRect();
                const cs = getComputedStyle(el);
                // Inside its border, where it clips: a part on its line lies there; one moved off it lies below.
                const top = b.top + Number.parseFloat(cs.borderTopWidth);
                const bottom = b.bottom - Number.parseFloat(cs.borderBottomWidth);
                const on = (part: Element) => {
                    const r = part.getBoundingClientRect();
                    return getComputedStyle(part).display !== "none" && r.top < bottom - 0.5 && r.bottom > top + 0.5;
                };
                const label = el.querySelector(":scope > [data-plan-label]");
                const icon = el.querySelector(":scope > [data-plan-icon]");
                // What each part draws: an icon its box; a label its text, inside its box.
                const extents = [icon, label].filter((p): p is Element => p !== null && on(p)).map((p) => {
                    const box = p.getBoundingClientRect();
                    if (p === icon) return box;
                    const range = document.createRange();
                    range.selectNodeContents(p);
                    const text = range.getBoundingClientRect();
                    return { left: Math.max(text.left, box.left), right: Math.min(text.right, box.right), top: box.top, bottom: box.bottom };
                });
                const centred = extents.length === 0 || (
                    Math.abs((Math.min(...extents.map((x) => x.left)) + Math.max(...extents.map((x) => x.right))) / 2 - (b.left + b.right) / 2) <= 0.5
                    && extents.every((x) => Math.abs((x.top + x.bottom) / 2 - (top + bottom) / 2) <= 0.5));
                const tiles = el.closest("[data-plan-cell-tiles]")!.getBoundingClientRect();
                return {
                    room: Math.round(tiles.width * 10) / 10,
                    within: b.width <= room + 0.5,
                    label: label === null ? null : on(label),
                    icon: icon === null ? null : on(icon),
                    centred,
                };
            }, turn.room);
            await expect.poll(drawn).toEqual({ room: turn.room, within: true, label: turn.label, icon: turn.icon, centred: true });
            await expect.poll(() => entry.evaluate(cutText)).toEqual([]);
        });
    }

    test("planTargetState: a cell narrower inside than a tile's 20px floor holds the tile inside it, the tile its width (#1266)", async ({ page }) => {
        const entry = await openExample(page, "planTargetState");
        // Van 1's first week, its ✓: the cell 24px wide, 12px inside its padding.
        await page.addStyleTag({ content: "[data-plan-cell]:has([data-event='a0']) { width: 24px !important; min-width: 0 !important; }" });
        const held = () => entry.locator("[data-event='a0']").evaluate((el) => {
            const cell = el.closest("[data-plan-cell]")!;
            const cs = getComputedStyle(cell);
            const c = cell.getBoundingClientRect();
            const [left, right] = [c.left + Number.parseFloat(cs.paddingLeft), c.right - Number.parseFloat(cs.paddingRight)];
            const t = el.getBoundingClientRect();
            return { cell: Math.round(c.width), inside: t.left >= left - 0.5 && t.right <= right + 0.5, width: Math.round(t.width * 10) / 10 };
        });
        await expect.poll(held).toEqual({ cell: 24, inside: true, width: 12 });
        await expect.poll(() => entry.evaluate(cutText)).toEqual([]);
    });

    /** A room narrower than a tile's padding (#1276) — a phone's week cell may leave its tiles a few pixels: the
     *  padding gives way, so the tile, a ✓ (a0) or a proposal in its 1.5px dashed ring (a2), takes the room and stays
     *  in it. */
    for (const key of ["a0", "a2"] as const) {
        test(`planTargetState: a cell narrower inside than a tile's padding holds tile ${key} inside it, the tile its width (#1276)`, async ({ page }) => {
            const entry = await openExample(page, "planTargetState");
            // The cell 16px wide, 4px inside its padding.
            await page.addStyleTag({ content: `[data-plan-cell]:has([data-event=${JSON.stringify(key)}]) { width: 16px !important; min-width: 0 !important; }` });
            const held = () => entry.locator(`[data-plan-row] [data-event=${JSON.stringify(key)}]`).evaluate((el) => {
                const cell = el.closest("[data-plan-cell]")!;
                const cs = getComputedStyle(cell);
                const c = cell.getBoundingClientRect();
                const [left, right] = [c.left + Number.parseFloat(cs.paddingLeft), c.right - Number.parseFloat(cs.paddingRight)];
                const t = el.getBoundingClientRect();
                return { cell: Math.round(c.width), inside: t.left >= left - 0.5 && t.right <= right + 0.5, width: Math.round(t.width * 10) / 10 };
            });
            await expect.poll(held).toEqual({ cell: 16, inside: true, width: 4 });
            await expect.poll(() => entry.evaluate(cutText)).toEqual([]);
        });
    }

    test("planEventLinks: its narrowest bars draw no text, and a hover shows each one's label in the canvas's tooltip", async ({ page }) => {
        const entry = await openExample(page, "planEventLinks", PLAN_EVENT_EXAMPLES);
        for (const [job, label] of [["J-2015", "Night run"], ["J-2020", "Card stock"], ["J-2016", "Store flyers"]] as const) {
            const bar = entry.locator(`[data-plan-row] [data-run*=${JSON.stringify(job)}]`);
            await expect(bar).toHaveCount(1);
            // Too narrow for a letter and the ellipsis: its label is not drawn.
            expect(await bar.locator("[data-plan-label]").evaluate((el) => getComputedStyle(el).display), job).toBe("none");
            await bar.hover();
            await expect(page.locator('[data-plan-overlay="tooltip"]'), job).toHaveText(label);
            await page.mouse.move(0, 0);
            await expect(page.locator('[data-plan-overlay="tooltip"]')).toHaveCount(0);
        }
    });

    /** A number in a cell set either side of its own width (#1269): a heat value, a table cell's numerals and a
     *  segment's label, each in the measures example, which draws them all. Narrower than it, the cell draws none
     *  of it — wrapped off its line, below it, out of sight — and a heat or table cell's hover says it in the
     *  canvas's tooltip, a table cell's numerals one after another; two pixels wider, it draws whole, on its line.
     *  `pad` is the cell's padding across. */
    const NUMBERS: readonly { name: string; what: string; cell: string; label: string | null; pad: number; tip: boolean }[] = [
        { name: "planMeasures", what: "a heat value", cell: "[data-plan-row] [data-cell]:has(> [data-plan-heat-label])", label: ":scope > [data-plan-heat-label]", pad: 0, tip: true },
        { name: "planMeasures", what: "a table cell's numerals", cell: "[data-plan-row] [data-cell]:has(> [data-table-parts])", label: ":scope > [data-table-parts]", pad: 8, tip: true },
        { name: "planMeasures", what: "a segment's label", cell: "[data-plan-row] [data-fill]", label: null, pad: 0, tip: false },
    ];

    for (const n of NUMBERS) {
        test(`${n.name}: ${n.what} in a cell two pixels narrower than it draws none of it${n.tip ? ", its hover saying it," : ""} and two pixels wider draws it whole (#1269)`, async ({ page }) => {
            const entry = await openExample(page, n.name);
            const cell = entry.locator(n.cell).filter({ hasText: /\d/ }).first();
            await expect(cell).toHaveCount(1);
            /** The cell's number: its text's whole width, its words, and whether it lies on the cell's line, inside it. */
            const read = () => cell.evaluate((el, label) => {
                const holder = label === null ? el : el.querySelector(label)!;
                const range = document.createRange();
                range.selectNodeContents(holder);
                const r = range.getBoundingClientRect();
                const c = el.getBoundingClientRect();
                const parts = [...holder.children].map((p) => (p.textContent ?? "").trim()).filter((t) => t !== "");
                return {
                    width: r.width,
                    words: parts.length > 0 ? parts.join(" · ") : (holder.textContent ?? "").trim(),
                    onLine: r.top < c.bottom - 0.5,
                    inside: r.left >= c.left - 0.5 && r.right <= c.right + 0.5 && r.top >= c.top - 0.5 && r.bottom <= c.bottom + 0.5,
                };
            }, n.label);
            const whole = await read();
            const setWidth = (px: number) => cell.evaluate((el: HTMLElement, w) => {
                el.style.setProperty("width", `${w}px`, "important");
                el.style.setProperty("min-width", "0", "important");
                el.style.setProperty("flex", "none", "important");
            }, px);
            await setWidth(whole.width + n.pad - 2);
            await expect.poll(async () => (await read()).onLine, "a number narrower than its cell's line wraps off it").toBe(false);
            await expect.poll(() => entry.evaluate(cutNumbers)).toEqual([]);
            if (n.tip) {
                await cell.hover();
                await expect(page.locator('[data-plan-overlay="tooltip"]')).toHaveText(whole.words);
                await page.mouse.move(0, 0);
            }
            await setWidth(whole.width + n.pad + 2);
            await expect.poll(async () => { const at = await read(); return { onLine: at.onLine, inside: at.inside }; }).toEqual({ onLine: true, inside: true });
            await expect.poll(() => entry.evaluate(cutNumbers)).toEqual([]);
        });
    }
});

/**
 * An element's text on a phone (#1269): each tab of every Plan example's narrow
 * layout — its group strips, its rows' cards, its measures — draws no partial
 * glyph in a card and cuts no number in a strip's or a card's cell, every
 * mark's icon inside it, and its ruler draws its labels whole and apart, every
 * period's start among them, in both themes.
 */
test.describe("Plan element text on a phone (#1269)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) >= 1000, "read on the touch projects");

    // A phone is a narrow box already: each example once, at its own width.
    for (const { name, file } of TEXT_EXAMPLES.filter((e) => e.box === undefined)) {
        for (const theme of ["light", "dark"] as const) {
            test(`${name} on a phone (${theme}): each tab of its narrow layout draws no partial glyph and cuts no number in a cell, every mark's icon inside it; its ruler's labels whole and apart, every period's start labelled`, async ({ page }) => {
                const entry = await openExample(page, name, file, theme);
                const strips = entry.locator("[data-plan-narrow] [data-slot='narrowTabs']");
                await expect.poll(() => strips.count(), "a narrow layout").toBeGreaterThan(0);
                for (let k = 0; k < await strips.count(); k++) {
                    const tabs = await strips.nth(k).locator("[data-plan-tab]").evaluateAll((els) => els.map((el) => el.getAttribute("data-plan-tab")!));
                    for (const tab of tabs) {
                        await strips.nth(k).locator(`[data-plan-tab=${JSON.stringify(tab)}]`).tap();
                        await settled(page);
                        // The tab's list opens on its ruler, which the sweep reads.
                        await expect(strips.nth(k).locator("xpath=..").locator("[data-slot='narrowList'] > [data-slot='narrowRuler']"), tab).toBeVisible();
                        await expect.poll(() => entry.evaluate(cutText), tab).toEqual([]);
                        await expect.poll(() => entry.evaluate(cutNumbers), tab).toEqual([]);
                        await expect.poll(() => entry.evaluate(rulerFaults), tab).toEqual([]);
                    }
                }
            });
        }
    }
});

// ── A bucket cell's `+n` (#1267) ──

/** planTargetState's Van 1, a row on a desktop and a card on a phone. */
const VAN1 = rowId("vans", "van1");

/** Van 1's Aug 24 cell, which holds two tiles: a ✓ (a7) and a resting proposal (a8). */
const VAN1_CELL = `:is([data-plan-row=${JSON.stringify(VAN1)}], [data-plan-card=${JSON.stringify(VAN1)}]) [data-plan-cell]:has([data-event='a7'])`;

/** Sets a cell's tiles' room: the cell as wide as its padding and caption, and the room asked for. */
async function setCellRoom(cell: Locator, room: number): Promise<void> {
    await cell.evaluate((el: HTMLElement, r) => {
        const extra = el.getBoundingClientRect().width - el.querySelector("[data-plan-cell-tiles]")!.getBoundingClientRect().width;
        el.style.setProperty("width", `${r + extra}px`, "important");
        el.style.setProperty("min-width", "0", "important");
    }, room);
}

/** One frame of a cell as it painted: its tiles' room, and what it showed. */
interface CellPainted { room: number; sig: string }

/** What the cell paint checks keep in the page ({@link startCellPaint}). */
interface CellPaintWindow {
    __cellPainted: CellPainted[];
    __cellPaintStop: () => void;
}

/**
 * Samples what a cell paints, until {@link stopCellPaint}: every frame as it
 * paints — when a strip's resize is delivered, the strip a pixel wider or
 * narrower each frame and observed after the cell's own observer, so read once
 * the cell has answered the frame's room and after every animation-frame
 * callback, a pick's among them. Each sample is the room and what the cell
 * shows: its tiles that show, by key, then `|` and its chip's words, `!` when
 * the chip is cramped, and ` measuring` while it draws the stand-ins it
 * measures with.
 */
async function startCellPaint(cell: Locator): Promise<void> {
    await cell.evaluate((el) => {
        const w = window as unknown as CellPaintWindow;
        const box = el.querySelector("[data-plan-cell-tiles]")!;
        const sig = () => {
            const tiles = [...box.querySelectorAll(":scope > [data-event]")].filter((t) => getComputedStyle(t).display !== "none");
            const chip = box.querySelector(":scope > [data-tile-more]");
            const measuring = box.hasAttribute("data-tile-measure") || box.querySelector(":scope > [data-tile-more-measure]") !== null;
            return `${tiles.map((t) => t.getAttribute("data-event")).join(" ")}|${chip?.textContent ?? ""}${chip?.hasAttribute("data-cramped") === true ? "!" : ""}${measuring ? " measuring" : ""}`;
        };
        const strip = document.body.appendChild(document.createElement("div"));
        strip.style.cssText = "position: fixed; left: 0; top: 0; width: 1px; height: 0; pointer-events: none;";
        w.__cellPainted = [];
        const observer = new ResizeObserver(() => {
            w.__cellPainted.push({ room: Math.round(box.getBoundingClientRect().width * 100) / 100, sig: sig() });
        });
        observer.observe(strip);
        let frame = requestAnimationFrame(function tick() {
            strip.style.width = strip.style.width === "1px" ? "2px" : "1px";
            frame = requestAnimationFrame(tick);
        });
        w.__cellPaintStop = () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
            strip.remove();
        };
    });
}

/** Stops {@link startCellPaint}, returning what it sampled. */
async function stopCellPaint(cell: Locator): Promise<CellPainted[]> {
    return cell.evaluate(() => {
        const w = window as unknown as CellPaintWindow;
        w.__cellPaintStop();
        return w.__cellPainted;
    });
}

/**
 * Where a tap near a cell's `+n` chip lands that it should not, under a touch
 * pointer (#1267) — each a line saying where, empty when none does. The chip's
 * target is its halo, 44px across and down, held to its cell, less the tiles
 * in it: a tap at each of that area's corners, 1px in, the middle of each of
 * its edges and its middle lands on the chip, or on the tile there. A tap on
 * every tile its row or card shows — its middle, 1px inside each end — lands
 * on that tile. Evaluated on the chip; `onTile` counts the area's taps that a
 * tile took.
 */
const tapFaults = (chip: Element): { bad: string[]; onTile: number } => {
    const bad: string[] = [];
    const cell = chip.closest("[data-plan-cell]")!;
    cell.scrollIntoView({ block: "center", inline: "center" });
    const holder = chip.closest("[data-plan-row], [data-plan-card]")!;
    const tiles = [...holder.querySelectorAll("[data-event]:not([data-ctx])")].filter((t) => getComputedStyle(t).display !== "none");
    const named = (el: Element | null) => {
        if (el === null) return "nothing";
        if (chip.contains(el)) return "the chip";
        const tile = el.closest("[data-event]");
        return tile !== null ? `tile ${tile.getAttribute("data-event")}`
            : `${el.tagName.toLowerCase()}${[...el.attributes].filter((a) => a.name.startsWith("data-")).map((a) => `[${a.name}]`).join("")}`;
    };
    const tileAt = (x: number, y: number) => tiles.find((t) => {
        const r = t.getBoundingClientRect();
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    });
    const c = cell.getBoundingClientRect();
    const m = chip.getBoundingClientRect();
    const [cx, cy] = [(m.left + m.right) / 2, (m.top + m.bottom) / 2];
    const [left, right] = [Math.max(c.left, cx - 22) + 1, Math.min(c.right, cx + 22) - 1];
    const [top, bottom] = [Math.max(c.top, cy - 22) + 1, Math.min(c.bottom, cy + 22) - 1];
    let onTile = 0;
    for (const x of [left, (left + right) / 2, right]) {
        for (const y of [top, (top + bottom) / 2, bottom]) {
            const hit = document.elementFromPoint(x, y);
            const tile = tileAt(x, y);
            if (tile !== undefined) onTile += 1;
            const want = tile ?? chip;
            if (hit === null || !want.contains(hit)) bad.push(`a tap at (${(x - c.left).toFixed(1)}, ${(y - c.top).toFixed(1)}) in the cell lands on ${named(hit)}, not ${named(want)}`);
        }
    }
    for (const tile of tiles) {
        const r = tile.getBoundingClientRect();
        for (const [x, where] of [[r.left + 1, "start"], [(r.left + r.right) / 2, "middle"], [r.right - 1, "end"]] as const) {
            const hit = document.elementFromPoint(x, (r.top + r.bottom) / 2);
            if (hit === null || !tile.contains(hit)) bad.push(`a tap at tile ${tile.getAttribute("data-event")}'s ${where} lands on ${named(hit)}`);
        }
    }
    return { bad, onTile };
};

/**
 * A bucket cell with more tiles than it has room for (#1267): the tiles that
 * fit show, in their order and each drawn whole, then a `+n` chip counting the
 * rest, whose menu lists them by name; a pick does what the tile's click does.
 * planTargetState's Van 1 holds two tiles in its Aug 24 cell: a ✓ (a7), 20px
 * whole — its floor, its icon inside its padding — and a resting proposal
 * (a8), 45px — its grip and its `plan` — 5px apart; the chip is 20px, its two
 * letters inside its 4px padding either side, 5px after the tile before it.
 * So both tiles show from 70px of room, the ✓ beside `+1` from 45px, `+2`
 * alone from 20px, and narrower the chip cramps to the room, its count off its
 * line. The cell measures before it paints, so no frame shows a fold it does
 * not rest on, nor the stand-ins it measures with.
 */
test.describe("Plan bucket cells' +n (#1267)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured at the desktop project's width");

    /** What a room rests on — the turns above. */
    const rests = (room: number) => (room >= 70 ? "a7 a8|" : room >= 45 ? "a7|+1" : room >= 20 ? "|+2" : "|+2!");

    /** The room either side of each turn, and what the cell draws there: its tiles that show, each by key and its
     *  width, and its chip. */
    const FOLDS: readonly { room: number; shown: readonly (readonly [string, number])[]; chip: { words: string; cramped: boolean } | null }[] = [
        { room: 70.5, shown: [["a7", 20], ["a8", 45]], chip: null },
        { room: 69.5, shown: [["a7", 20]], chip: { words: "+1", cramped: false } },
        { room: 45.5, shown: [["a7", 20]], chip: { words: "+1", cramped: false } },
        { room: 44.5, shown: [], chip: { words: "+2", cramped: false } },
        { room: 20.5, shown: [], chip: { words: "+2", cramped: false } },
        { room: 19.5, shown: [], chip: { words: "+2", cramped: true } },
    ];

    for (const fold of FOLDS) {
        const what = fold.chip === null ? "both its tiles, whole, and no chip"
            : `${fold.shown.length === 0 ? "no tile" : "its ✓, whole,"} and ${fold.chip.cramped ? `its ${fold.chip.words} cramped to the room, its count off its line` : `its ${fold.chip.words}`}`;
        test(`planTargetState: Van 1's Aug 24 cell in ${fold.room}px of room draws ${what}, all inside the room, and no partial glyph`, async ({ page }) => {
            const entry = await openExample(page, "planTargetState");
            const cell = entry.locator(VAN1_CELL);
            await setCellRoom(cell, fold.room);
            const drawn = () => cell.evaluate((el) => {
                const box = el.querySelector("[data-plan-cell-tiles]")!;
                const room = box.getBoundingClientRect();
                const shown = [...box.querySelectorAll(":scope > [data-event]")].filter((t) => getComputedStyle(t).display !== "none");
                const chip = box.querySelector(":scope > [data-tile-more]");
                const parts = [...shown, ...(chip === null ? [] : [chip])].map((p) => p.getBoundingClientRect());
                return {
                    room: Math.round(room.width * 10) / 10,
                    shown: shown.map((t) => [t.getAttribute("data-event"), Math.round(t.getBoundingClientRect().width * 10) / 10]),
                    chip: chip === null ? null : {
                        words: chip.textContent,
                        cramped: chip.hasAttribute("data-cramped"),
                        count: getComputedStyle(chip.querySelector("[data-tile-more-count]")!).display !== "none",
                    },
                    inside: parts.every((r) => r.left >= room.left - 0.5 && r.right <= room.right + 0.5),
                    measuring: box.hasAttribute("data-tile-measure") || box.querySelector("[data-tile-more-measure]") !== null,
                };
            });
            await expect.poll(drawn).toEqual({
                room: fold.room,
                shown: fold.shown,
                chip: fold.chip === null ? null : { ...fold.chip, count: !fold.chip.cramped },
                inside: true,
                measuring: false,
            });
            await expect.poll(() => entry.evaluate(cutText)).toEqual([]);
        });
    }

    test("planTargetState: Van 1's Aug 24 cell never paints a fold it does not rest on — its room narrowed a pixel at a time across every turn, then widened back, each frame draws what that room rests on, and never the stand-ins it measures with", async ({ page }) => {
        const entry = await openExample(page, "planTargetState");
        const cell = entry.locator(VAN1_CELL);
        await startCellPaint(cell);
        await cell.evaluate(async (el: HTMLElement) => {
            const extra = el.getBoundingClientRect().width - el.querySelector("[data-plan-cell-tiles]")!.getBoundingClientRect().width;
            const frames = (n: number) => new Promise<void>((resolve) => {
                const step = (k: number) => { if (k === 0) resolve(); else requestAnimationFrame(() => step(k - 1)); };
                step(n);
            });
            const rooms = [...Array.from({ length: 66 }, (_x, i) => 75 - i), ...Array.from({ length: 66 }, (_x, i) => 10 + i)];
            for (const room of rooms) {
                el.style.setProperty("width", `${room + extra}px`, "important");
                el.style.setProperty("min-width", "0", "important");
                await frames(3);
            }
        });
        const painted = await stopCellPaint(cell);
        expect(painted.length, "the frames sampled").toBeGreaterThan(300);
        expect([...new Set(painted.filter((p) => p.sig !== rests(p.room)).map((p) => `at ${p.room}px: painted "${p.sig}", resting on "${rests(p.room)}"`))]).toEqual([]);
    });

    test("planTargetState: Van 1's Aug 24 cell's +2, named for what it holds and where, lists its tiles by their names; a pick does what the tile's click does — Van 1 selected — and no frame paints the tile alone: the cell folds it again, its chip taking the focus", async ({ page }) => {
        const entry = await openExample(page, "planTargetState");
        const cell = entry.locator(VAN1_CELL);
        const chip = cell.locator("[data-tile-more]");
        await expect(chip).toHaveText("+2");
        await expect(chip).toHaveAttribute("aria-label", "2 more events, Week of Aug 24, 2026");
        await chip.click();
        const items = page.locator("[data-tile-more-menu]").getByRole("menuitem");
        await expect(items).toHaveText(["Event, Week of Aug 24, 2026, confirmed", "Event, Week of Aug 24, 2026, recommended"]);
        await startCellPaint(cell);
        await items.first().click();
        await expect(entry.locator(rowSel("vans", "van1"))).toHaveAttribute("data-selected", "");
        await expect(chip).toBeFocused();
        await settled(page);
        expect([...new Set((await stopCellPaint(cell)).map((p) => p.sig))]).toEqual(["|+2"]);
    });
});

/** A cell at its floor — 12px, its padding — in planTargetState: Van 1's first week (its ✓, a0), or Van 2's PM lane in
 *  its fourth (the truck, m5, captioned "PM", which opens a popover). */
const floorCell = (key: string) => `[data-plan-row] [data-plan-cell]:has([data-event=${JSON.stringify(key)}])`;

/** Narrows a cell to its 12px floor. */
const toFloor = (page: Page, key: string) =>
    page.addStyleTag({ content: `${floorCell(key)} { width: 12px !important; min-width: 0 !important; }` });

/** A cell at its floor as it draws: the tiles that show, its chip's words, whether it says its count and spans the
 *  cell, and whether it lies inside the cell. */
const floorDrawn = (cell: Element) => {
    const c = cell.getBoundingClientRect();
    const chip = cell.querySelector("[data-tile-more]");
    const m = chip?.getBoundingClientRect();
    return {
        shown: [...cell.querySelectorAll("[data-event]")].filter((t) => getComputedStyle(t).display !== "none").map((t) => t.getAttribute("data-event")),
        chip: chip === null ? null : {
            words: chip.textContent,
            label: chip.getAttribute("aria-label"),
            count: getComputedStyle(chip.querySelector("[data-tile-more-count]")!).display !== "none",
            spans: m !== undefined && Math.abs(m.left - c.left) <= 0.5 && Math.abs(m.right - c.right) <= 0.5,
            inside: m !== undefined && m.left >= c.left - 0.5 && m.right <= c.right + 0.5 && m.top >= c.top - 0.5 && m.bottom <= c.bottom + 0.5,
        },
    };
};

/**
 * A cell with no room for one whole tile (#1276, the user's ruling "Fold into
 * +n"): at its 12px floor its padding leaves the tiles nothing, so it draws no
 * tile and shows its `+n` alone, across the whole cell — its padding and its
 * caption too — its menu listing every tile, a pick doing what the tile's
 * click does. A popover the pick opens hangs from the chip, the tile having no
 * box.
 */
test.describe("Plan bucket cells with no room for a tile (#1276)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured at the desktop project's width");

    test("planTargetState: a cell at its 12px floor draws no tile — its +1 alone, across the cell and inside it — and its menu lists the tile; a pick does what its click does, Van 1 selected", async ({ page }) => {
        const entry = await openExample(page, "planTargetState");
        await toFloor(page, "a0");
        const cell = entry.locator(floorCell("a0"));
        await expect.poll(() => cell.evaluate(floorDrawn)).toEqual({
            shown: [],
            chip: { words: "+1", label: "1 more event, Week of Jun 29, 2026", count: false, spans: true, inside: true },
        });
        await expect.poll(() => entry.evaluate(cutText)).toEqual([]);
        await cell.locator("[data-tile-more]").click();
        const items = page.locator("[data-tile-more-menu]").getByRole("menuitem");
        await expect(items).toHaveText(["Event, Week of Jun 29, 2026, confirmed"]);
        await items.first().click();
        await expect(entry.locator(rowSel("vans", "van1"))).toHaveAttribute("data-selected", "");
        // The tile, which cannot draw, stays in the chip.
        await expect.poll(() => cell.evaluate(floorDrawn)).toMatchObject({ shown: [] });
    });

    test("planTargetState: a captioned cell at its floor draws its +1 across the cell, over its caption; a pick opens the tile's popover, hung from the chip, and it stays open", async ({ page }) => {
        const entry = await openExample(page, "planTargetState");
        await toFloor(page, "m5");
        const cell = entry.locator(floorCell("m5"));
        await expect.poll(() => cell.evaluate(floorDrawn)).toEqual({
            shown: [],
            chip: { words: "+1", label: "1 more event, Week of Jul 20, 2026, PM", count: false, spans: true, inside: true },
        });
        const chip = cell.locator("[data-tile-more]");
        await chip.click();
        await page.locator("[data-tile-more-menu]").getByRole("menuitem").first().click();
        const pop = page.locator('[data-plan-overlay="popover"]');
        await expect(pop).toHaveText("Load 41 · 8 pallets");
        // Over the chip, which it hangs from, and still open once the page is at rest.
        await settled(page);
        await expect(pop).toBeVisible();
        const read = async () => {
            const [p, m] = [await pop.boundingBox(), await chip.boundingBox()];
            return p !== null && m !== null && p.y + p.height <= m.y + 0.5 && p.x <= m.x + m.width && p.x + p.width >= m.x;
        };
        await expect.poll(read).toBe(true);
    });
});

/**
 * A cell's `+n` under a touch pointer (#1267): its tap target is its 44px
 * halo, held to its cell, less the tiles in it — so a tile beside it, or in
 * another cell, keeps its own taps. On the phone planTargetState's Van 1 card
 * folds its Aug 24 cell's tiles into a `+2` cramped to the room, its target
 * the whole cell; on a touch screen 1280px wide, 60px of room draws the ✓
 * beside `+1`, the halo reaching over the ✓, which keeps its taps.
 */
test.describe("Plan bucket cells' +n on touch (#1267)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) >= 1000, "read on the touch projects");

    test("planTargetState at the phone's width: Van 1's Aug 24 cell is a +2 cramped to its room, a tile tall; a tap anywhere in the cell lands on it, every tile of the card keeps its own; a tap opens its menu, and a pick does what the tile's tap does", async ({ page }) => {
        const entry = await openExample(page, "planTargetState");
        // The narrow layout's Rows tab holds Van 1's card: its first rows drawn, a "more rows" button for the rest.
        await entry.locator("[data-plan-narrow] [data-plan-tab='rows']").tap();
        await settled(page);
        const card = entry.locator(`[data-plan-card=${JSON.stringify(VAN1)}]`);
        const more = entry.getByRole("button", { name: /^\d+ more rows?$/ });
        for (let i = 0; i < 10 && await card.count() === 0 && await more.count() > 0; i++) {
            await more.first().tap();
            await settled(page);
        }
        const cell = entry.locator(VAN1_CELL);
        const chip = cell.locator("[data-tile-more]");
        await expect(chip).toHaveAttribute("data-cramped", "");
        // A tile's height: the halo makes the target, never the chip's own box.
        expect(await chip.evaluate((el) => Math.abs(el.getBoundingClientRect().height - Number.parseFloat(getComputedStyle(el).getPropertyValue("--plan-tile-h"))) <= 0.5)).toBe(true);
        await expect.poll(() => chip.evaluate(tapFaults)).toEqual({ bad: [], onTile: 0 });
        await expect.poll(() => entry.evaluate(cutText)).toEqual([]);
        await chip.tap();
        const items = page.locator("[data-tile-more-menu]").getByRole("menuitem");
        await expect(items).toHaveText(["Event, Week of Aug 24, 2026, confirmed", "Event, Week of Aug 24, 2026, recommended"]);
        await items.first().tap();
        await expect(entry.locator(`[data-plan-card=${JSON.stringify(VAN1)}]`)).toHaveAttribute("data-selected", "");
        await expect(chip).toBeFocused();
    });

    test("planTargetState on a touch screen 1280px wide: Van 1's Aug 24 cell in 60px of room draws its ✓ beside +1, whose halo reaches over the ✓ — a tap there lands on the ✓, one beside it on the chip", async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        const entry = await openExample(page, "planTargetState");
        const cell = entry.locator(VAN1_CELL);
        await setCellRoom(cell, 60);
        await expect(cell.locator("[data-tile-more]")).toHaveText("+1");
        await expect(cell.locator("[data-event='a7']")).not.toHaveAttribute("data-folded", "");
        const read = await cell.locator("[data-tile-more]").evaluate(tapFaults);
        expect(read.bad).toEqual([]);
        expect(read.onTile, "the halo's taps on the ✓").toBeGreaterThan(0);
    });

    test("planTargetState on a touch screen 1920px wide: a cell at its 12px floor is its +1 alone, its 44px halo held inside the cell — a tap anywhere in it lands on the chip, one just outside it never does, and every tile of the row keeps its own (#1276)", async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 900 });
        const entry = await openExample(page, "planTargetState");
        await toFloor(page, "a0");
        const chip = entry.locator(`${floorCell("a0")} [data-tile-more]`);
        await expect(chip).toHaveAttribute("data-no-room", "");
        await expect.poll(() => chip.evaluate(tapFaults)).toEqual({ bad: [], onTile: 0 });
        const outside = () => chip.evaluate((el) => {
            const c = el.closest("[data-plan-cell]")!.getBoundingClientRect();
            const [mx, my] = [(c.left + c.right) / 2, (c.top + c.bottom) / 2];
            return ([[c.left - 2, my, "left"], [c.right + 2, my, "right"], [mx, c.top - 2, "above"], [mx, c.bottom + 2, "below"]] as const)
                .flatMap(([x, y, side]) => { const hit = document.elementFromPoint(x, y); return hit !== null && el.contains(hit) ? [`a tap 2px ${side} the cell lands on the chip`] : []; });
        });
        expect(await outside()).toEqual([]);
    });
});

/**
 * A row's controls (#1258): 24px sm ghost buttons at the end of its gutter
 * line, after its value, no ring — and always shown (the user's ruling over
 * `Plan links.html`'s hover reveal), a pressed one in the brand tint; never
 * under 480; the canvas's tooltip names each.
 */
test.describe("Plan row controls (#1258)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured at the desktop project's widths");

    test("planTargetState: a row's controls show at rest, at the end of its gutter line after its value; the canvas's tooltip names each; pressed, one wears the press and every row's controls stay shown", async ({ page }) => {
        const entry = await openExample(page, "planTargetState");
        const row = entry.locator(rowSel("detail", "H1-P09"));
        // Away from every row, nothing hovered or focused: every row's controls show.
        await page.mouse.move(0, 0);
        await expect.poll(() => entry.evaluate(rowControlsLaidOut)).toEqual([]);
        const control = row.locator("[data-plan-control='links']");
        await control.hover();
        await expect(page.locator('[data-plan-overlay="tooltip"]')).toHaveText("Focus linked rows");
        // Pressed: the press marks it, with the pointer gone and the focus elsewhere.
        await control.click();
        await expect(entry.locator("[data-plan-focusbar='links']")).toBeVisible();
        await expect(control).toHaveAttribute("aria-pressed", "true");
        await expect(control).toHaveAttribute("data-active", "");
        await control.evaluate((el) => (el as HTMLElement).blur());
        await page.mouse.move(0, 0);
        await expect.poll(() => entry.evaluate(rowControlsLaidOut)).toEqual([]);
        // Every row back: nothing pressed, every control still shown.
        await entry.locator("[data-plan-focusback]").click();
        await page.mouse.move(0, 0);
        await expect(entry.locator("[data-plan-control][aria-pressed='true']")).toHaveCount(0);
        await expect.poll(() => entry.evaluate(rowControlsLaidOut)).toEqual([]);
    });

    test("planTargetState: an expanded chart row's control stays on its gutter's first line, and the chart's ticks step left of it", async ({ page }) => {
        const entry = await openExample(page, "planTargetState");
        const chart = entry.locator(rowSel("ontime", "ontime"));
        const control = chart.locator('[data-plan-control="expand"]');
        await control.click();
        await expect(chart).toHaveAttribute("data-expanded", "");
        await control.evaluate((el) => (el as HTMLElement).blur());
        await page.mouse.move(0, 0);
        const read = () => chart.evaluate((row) => {
            const box = row.querySelector("[data-plan-control]")!.parentElement!;
            const p = box.getBoundingClientRect();
            const line = box.closest("[data-plan-gutter='name']")!.getBoundingClientRect();
            const ticks = [...row.querySelectorAll("[data-plan-tickpx]")].map((t) => t.getBoundingClientRect());
            return {
                opacity: getComputedStyle(box).opacity,
                onLine: Math.abs((p.top + p.bottom) / 2 - (line.top + line.bottom) / 2) <= 0.5,
                ticks: ticks.length,
                // Each tick ends 4 or more left of the controls.
                clear: ticks.every((t) => t.right <= p.left - 3.5),
            };
        });
        await expect.poll(read).toEqual({ opacity: "1", onLine: true, ticks: 2, clear: true });
        await expect.poll(() => entry.evaluate(rowControlsLaidOut)).toEqual([]);
    });
});

/** A row's controls where nothing hovers (#1258): shown at rest, as everywhere —
 *  and, below 480, where the narrow layout is in charge, none at all. */
test.describe("Plan row controls on touch (#1258)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) >= 1000, "read on the touch projects");

    test("planTargetState on a touch screen wide enough for rows: every row's controls show at rest", async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        const entry = await openExample(page, "planTargetState");
        expect(await page.evaluate(() => matchMedia("(hover: none)").matches), "the screen cannot hover").toBe(true);
        await expect.poll(() => entry.evaluate(rowControlsLaidOut)).toEqual([]);
    });

    test("planTargetState below 480: the narrow layout draws no row control", async ({ page }) => {
        const entry = await openExample(page, "planTargetState");
        await expect(entry.locator("[data-plan-body][data-plan-narrow]")).toHaveCount(1);
        await expect(entry.locator("[data-plan-control]")).toHaveCount(0);
    });
});

/**
 * planMeasures' resolution is its toolbar's (#1258): a bound slice over the
 * weeks it shows declares the `resolution` affordance, so the toolbar's
 * segment switches MONTH and WEEK — nothing outside the Plan chooses it.
 */
test.describe("planMeasures' resolution (#1258)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

    test("the toolbar's segment switches MONTH and WEEK, and nothing outside the frame chooses the resolution", async ({ page }) => {
        const entry = await openExample(page, "planMeasures");
        const seg = entry.locator("[data-builder-frame] [data-frame-slot='toolbar'] [data-plan-seg='resolution']");
        await expect(seg.getByRole("radio")).toHaveText(["MONTH", "WEEK"]);
        await expect(seg.getByRole("radio", { name: "MONTH" })).toBeChecked();
        const outside = () => entry.evaluate((root) => [...root.querySelectorAll("[role='radio']")]
            .filter((r) => /^(MONTH|WEEK)$/.test(r.textContent?.trim() ?? "") && r.closest("[data-builder-frame]") === null).length);
        expect(await outside()).toBe(0);
        const ticks = entry.locator("[data-slot='ruler'] [data-slot='rulerTick']");
        await expect(ticks).toHaveText(["JUN", "JUL", "AUG"]);
        await expect.poll(() => mismatches(entry), "MONTH").toEqual([]);
        await seg.getByRole("radio", { name: "WEEK" }).click();
        await expect(seg.getByRole("radio", { name: "WEEK" })).toBeChecked();
        await expect(ticks).toHaveText(["W23", "W24", "W25"]);
        await expect.poll(() => mismatches(entry), "WEEK").toEqual([]);
    });
});

/**
 * A bound ui state (#824), in a real layout: `planTargetState`'s host folds
 * and opens its halls and expands its KPI chart from outside, its picker
 * brings a press into view — opening the hall the press sits in, selecting it
 * and scrolling to it — and the host's readout follows what the user does on
 * the canvas.
 */
test.describe("Plan bound ui state (#824)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

    /** A hall's group band. */
    const band = (entry: Locator, hall: string) =>
        entry.locator(`[data-plan-group=${JSON.stringify(rowId("halls", hall))}]`);

    test("outside writes fold, open and expand; the picker brings a folded press into view; the user's own actions come back", async ({ page }) => {
        const entry = await openExample(page, "planTargetState");
        const readout = entry.getByText(/^SELECTED · /);
        // Hall 3 starts folded — the host's seed.
        await expect(band(entry, "Hall 3")).toHaveAttribute("aria-expanded", "false");
        await expect(entry.locator(rowSel("presses", "Hall 3", "H3-P21"))).toHaveCount(0);
        await expect(readout).toHaveText("SELECTED · nothing · 1 FOLDED · 0 OPENED");

        // The host opens every hall, then folds them all.
        await entry.getByRole("button", { name: "Open halls" }).click();
        await expect(band(entry, "Hall 3")).toHaveAttribute("aria-expanded", "true");
        await expect(readout).toHaveText("SELECTED · nothing · 0 FOLDED · 3 OPENED");
        await entry.getByRole("button", { name: "Fold halls" }).click();
        for (const hall of ["Hall 1", "Hall 2", "Hall 3"]) await expect(band(entry, hall), hall).toHaveAttribute("aria-expanded", "false");
        await expect(readout).toHaveText("SELECTED · nothing · 3 FOLDED · 0 OPENED");

        // The host expands the chart: the spark grows, at its model height.
        const chart = entry.locator(rowSel("ontime", "ontime"));
        const rest = await chart.getAttribute("data-plan-h") ?? "";
        await entry.getByRole("button", { name: "On-time chart" }).click();
        await expect(chart).not.toHaveAttribute("data-plan-h", rest);
        await expect.poll(() => mismatches(entry), "chart expanded").toEqual([]);

        // The user opens Hall 2 on the canvas: the host reads it back.
        await band(entry, "Hall 2").click();
        await expect(readout).toHaveText("SELECTED · nothing · 2 FOLDED · 1 OPENED");

        // The picker, beside the frame: Hall 3's press is selected, its hall opened, and it is in view.
        await entry.getByRole("combobox").click();
        await page.getByRole("option", { name: "Go to H3-P21" }).click();
        const target = entry.locator(rowSel("presses", "Hall 3", "H3-P21"));
        await expect(target).toHaveAttribute("data-selected", "");
        await expect(readout).toHaveText(/ · 1 FOLDED · 2 OPENED$/);
        const inView = () => entry.evaluate((root, sel) => {
            const frame = root.querySelector('[data-virtual-rows="bounded"]')!.getBoundingClientRect();
            const row = root.querySelector(sel)!.getBoundingClientRect();
            return row.top >= frame.top && row.bottom <= frame.bottom;
        }, rowSel("presses", "Hall 3", "H3-P21"));
        await expect.poll(inView).toBe(true);
        await expect.poll(() => mismatches(entry), "after the focus").toEqual([]);
    });
});

/**
 * A paged canvas pages block by block, each window holding its entries whole
 * (#823) — measured in a real layout. `dataBindPagedBlocks` is two series over
 * one bound source of 3,000 units, which an e3 task generates (#849): two
 * blocks of 3,000 32px rows, and every row sits at its unit's offset in its
 * block — its window's place in the ledger plus its place in the window. That
 * holds from the first landing, through a far jump that evicts the head of
 * the run into a band, and through a window landing above the rows in view:
 * nothing on screen moves.
 */
test.describe("Plan paged blocks (#823)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

    const ROW = 32;
    /** One block: 3,000 rows. */
    const BLOCK = 3_000 * ROW;

    /** Every mounted row that is not where its unit puts it: the jobs block
     *  first, the loads block after it. */
    async function misplaced(entry: Locator): Promise<string[]> {
        return entry.evaluate((root, { row, block }) => {
            const extent = root.querySelector("[data-virtual-extent]")!;
            const origin = extent.getBoundingClientRect().top;
            return [...extent.querySelectorAll("[data-plan-row]")].flatMap((el) => {
                const key = el.getAttribute("data-plan-row")!;
                const series = /series="([^"]*)"/.exec(key)![1]!;
                const unit = Number(/"U(\d+)"/.exec(key)![1]) - 10_000;
                const want = (series === "loads" ? block : 0) + unit * row;
                const got = el.getBoundingClientRect().top - origin;
                return Math.abs(got - want) <= 0.5 ? [] : [`${series} U${unit + 10_000}: ${got} ≠ ${want}`];
            });
        }, { row: ROW, block: BLOCK });
    }

    test("every row sits at its unit's offset in its block — through a far jump that evicts the run's head, and a window landing above the rows in view", async ({ page }) => {
        const entry = await openExample(page, "dataBindPagedBlocks", "e3/bind/data/data");
        const frame = entry.locator('[data-virtual-rows="bounded"]');
        const extent = entry.locator("[data-virtual-extent]");
        const transport = entry.locator('[data-slot="footerTransport"]');
        const scrollTo = (top: number) => frame.evaluate((el, at) => { el.scrollTop = at; }, top);
        await expect(transport).toHaveText("600 loaded of 3,000");
        // The document is both blocks whole from the first landing.
        await expect(extent).toHaveAttribute("data-virtual-extent", String(2 * BLOCK));
        await expect.poll(() => misplaced(entry), "first landing").toEqual([]);

        // Far into the jobs block's tail band, where the ledger puts unit
        // 2,000: its run rebases to window 10, and windows 0–2 leave it for
        // the head band.
        const far = 2_000 * ROW;
        await scrollTo(far);
        await expect(transport).toHaveText("elements 1,801–2,600 of 3,000");
        await expect(entry.locator(rowSel("jobs", "U10000"))).toHaveCount(0);
        await expect.poll(() => misplaced(entry), "after the jump").toEqual([]);
        await expect(extent).toHaveAttribute("data-virtual-extent", String(2 * BLOCK));
        expect(await frame.evaluate((el) => el.scrollTop)).toBe(far);

        // Up to the run's first row, 10px into it: once the scroll settles,
        // window 8 lands above it — and the rows in view stay where they are.
        const first = 1_800 * ROW + 10;
        await scrollTo(first);
        await expect(transport).toHaveText("elements 1,601–2,600 of 3,000");
        await expect.poll(() => misplaced(entry), "after the landing").toEqual([]);
        expect(await frame.evaluate((el) => el.scrollTop)).toBe(first);
    });
});
