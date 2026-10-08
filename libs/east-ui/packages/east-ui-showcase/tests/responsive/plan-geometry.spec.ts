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
import { PLAN_EVENT_EXAMPLES, PLAN_EXAMPLES, openExample, rowId, rowSel } from "./plan-page";

/** The Plan examples, between them every row kind, group strips, pinned
 *  rows, number and ordinal axes, rows folded to a coarser resolution and a
 *  bound ui state (#824). */
const EXAMPLES = [
    "planTargetState", "planSpanRows", "planBucketRows", "planChartRows", "planHeatRows", "planTableRows",
    "planCardRows", "planEventRows", "planGroupedRows", "planSeriesData", "planLiteralRows", "planExpand",
    "planNumberAxis", "planOrdinalAxis", "planFold", "planUiState",
];

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
 * Each bar, chip or rollup band whose text is partly drawn (#1258, #1264). A
 * label shows whole, ellipsized after at least one whole letter — what shows of
 * it at least as wide as its first letter and the ellipsis in its own font — or
 * not at all: never a partial glyph. A bar's quantity is drawn whole beside a
 * whole label, or not at all — never cut, and never squeezing the label. A
 * chip's icon is drawn whole or not at all. What an element draws is what lies
 * inside its border: it clips there. Measured in a bar under a row or a narrow
 * card, a chip, and a rollup band; a label is the element's `data-plan-label`,
 * or its first span where it has none.
 */
const cutText = (root: Element): string[] => {
    const out: string[] = [];
    const ctx = document.createElement("canvas").getContext("2d")!;
    /** Whether an element is drawn at all: displayed, visible and of some width. */
    const drawnAt = (el: Element) => {
        const cs = getComputedStyle(el);
        return cs.display !== "none" && cs.visibility !== "hidden" && el.getBoundingClientRect().width > 0.5;
    };
    const holder = "[data-plan-row], [data-plan-card]";
    const elements = root.querySelectorAll<HTMLElement>(
        `:is(${holder}) [data-run]:not([data-ctx]), :is(${holder}) [data-chip]:not([data-ctx]), :is(${holder}) [data-plan-band]:not([data-ctx])`);
    for (const el of elements) {
        const box = el.getBoundingClientRect();
        const es = getComputedStyle(el);
        const bw = (side: string) => Number.parseFloat(es.getPropertyValue(`border-${side}-width`));
        const b = { left: box.left + bw("left"), right: box.right - bw("right"), top: box.top + bw("top"), bottom: box.bottom - bw("bottom") };
        const row = el.closest(holder)!;
        const noun = el.hasAttribute("data-run") ? "bar" : el.hasAttribute("data-chip") ? "chip" : "band";
        const what = noun === "band" ? "rollup band" : `${noun} ${el.getAttribute(`data-${noun === "bar" ? "run" : "chip"}`)}`;
        const name = `${row.getAttribute("data-plan-row") ?? row.getAttribute("data-plan-card")} ${what}`;
        const spans = [...el.children].filter((c): c is HTMLElement => c.tagName === "SPAN" && !c.hasAttribute("data-plan-icon"));
        const label = el.querySelector<HTMLElement>(":scope > [data-plan-label]") ?? spans[0];
        const inside = (r: DOMRect) => r.left >= b.left - 0.5 && r.right <= b.right + 0.5 && r.top >= b.top - 0.5 && r.bottom <= b.bottom + 0.5;
        // A chip's icon: whole inside the chip, or not drawn.
        for (const icon of el.querySelectorAll("svg")) {
            if (drawnAt(icon) && !inside(icon.getBoundingClientRect())) out.push(`${name}: its icon is cut`);
        }
        if (label === undefined) continue;
        const qty = el.hasAttribute("data-run") ? spans.find((s) => s !== label) : undefined;
        const ls = getComputedStyle(label);
        const lr = label.getBoundingClientRect();
        // What shows of the label: its box, inside the element's clip.
        const shows = Math.min(lr.right, b.right) - Math.max(lr.left, b.left);
        const text = (label.textContent ?? "").trim();
        if (drawnAt(label) && shows > 0.5 && text !== "") {
            // The element clips at its border, where no ellipsis is drawn: the label's box keeps inside it.
            const whole = label.scrollWidth <= label.clientWidth;
            const ellipsized = ls.textOverflow === "ellipsis" && ls.overflowX === "hidden" && ls.whiteSpace === "nowrap";
            // The label's font from its parts: its `font` shorthand reads empty
            // under tabular numerals, which the shorthand cannot say, and a
            // canvas given nothing keeps its own 10px sans-serif.
            ctx.font = `${ls.fontStyle} ${ls.fontWeight} ${ls.fontSize} ${ls.fontFamily}`;
            if (!ctx.font.includes(ls.fontSize)) { out.push(`${name}: its label's font (${ctx.font}) cannot be measured`); continue; }
            const spacing = Number.parseFloat(ls.letterSpacing) || 0;
            const oneLetter = ctx.measureText(`${[...text][0]}…`).width + 2 * spacing;
            if (!inside(lr)) out.push(`${name}: its label "${text}" runs past the ${noun}'s edge`);
            else if (!whole && !ellipsized) out.push(`${name}: its label "${text}" is cut`);
            else if (!whole && shows < oneLetter - 0.5) out.push(`${name}: its label "${text}" shows ${shows.toFixed(1)}px, under one letter and the ellipsis (${oneLetter.toFixed(1)}px)`);
            if (qty !== undefined) {
                const q = qty.getBoundingClientRect();
                const drawn = Math.min(q.right, b.right) - Math.max(q.left, b.left) > 0.5
                    && Math.min(q.bottom, b.bottom) - Math.max(q.top, b.top) > 0.5;
                if (drawn && !(inside(q) && qty.scrollWidth <= qty.clientWidth)) out.push(`${name}: its quantity "${qty.textContent}" is cut`);
                if (drawn && !whole) out.push(`${name}: its quantity squeezes its label "${text}" to ${label.clientWidth}px of ${label.scrollWidth}px`);
            }
        }
    }
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
        const entry = await openExample(page, "planChartRows");
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
     *  window. planSpanRows' family is the spec's own: 24, 40, 88, 32, 18 and 91
     *  k sheets, the largest 91 — an S, a same-row runoff between abutting runs,
     *  loopbacks, one dropping onto its destination at the window's start, a
     *  rising loop, and a landing past the window (dlv's run starts where the
     *  window ends). planTargetState's one link, its family's largest, leaves a
     *  run that abuts the next and enters one that abuts the last.
     *  planEventLinks is every case at once (`EVENT_ROUTES` below), on a
     *  bounded canvas: at rest the two links between rows below its view draw
     *  nothing. */
    const FOCUSES = [
        { name: "planSpanRows", file: PLAN_EXAMPLES, row: rowSel("detail", "H1-P09"), weights: [2, 4, 8, 4, 2, 8], slots: 1 },
        { name: "planTargetState", file: PLAN_EXAMPLES, row: rowSel("presses", "H1-P03"), weights: [8], slots: 0 },
        {
            name: "planEventLinks", file: PLAN_EVENT_EXAMPLES, row: rowSel("presses.span", "Hall A", "a1"),
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
            test(`${focus.name} at ${width}px: each link leaves its source's end and enters its destination's start as they draw, and nothing of it leaves the plot`, async ({ page }) => {
                const entry = await focusLinks(page, focus, width);
                await expect.poll(() => entry.evaluate(ribbonEnds)).toEqual([]);
                await expect.poll(() => entry.evaluate(outsidePlot)).toEqual([]);
            });

            test(`${focus.name} at ${width}px: each link at its quantity's weight, its head 8 × max(8, 2 × weight), cased in the paper under every link's ink; each caption on its knockout, none within 60 × 12 of another; an end past the window in its 40px slot; the links under the row controls and the now line`, async ({ page }) => {
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
    /** …and scrolled to the end: the plates draw nothing, and three leave a row above the view in a stub. */
    const EVENT_ROUTES_AT_THE_END = {
        covers: "stub", card: "s", inserts: "stub", "report-covers": "loop", "seed-prints": "loop", tags: "feed",
        pads: "runoff", proofs: "loop", "proof-sheets": "s", tickets: "s", sections: "s", "sections-more": "s",
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

    test("planSpanRows: the focus band is 32 tall, its link and caption 20 in from its ends; each family row's Tag is 20 tall and the focused row has none; a lone unrelated row is an 11 rail and each run of hidden rows one 22 gap band", async ({ page }) => {
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
            rails: [11],
            // Hall 2's band alone, its group counted; Contract B and its press.
            gaps: [{ h: 22, count: "1", heard: "1 hidden group" }, { h: 22, count: "2", heard: "2 hidden rows" }],
        });
    });

    test("planSpanRows: a link takes the pointer along its band — lit, it is drawn over the others with its casing and haloes the two runs it joins 4 outside them, and its caption is the canvas's tooltip", async ({ page }) => {
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
});

/**
 * An element's text (#1258, #1264): no bar, chip or rollup band in a Plan
 * example draws a partial glyph — its label whole, ellipsized after a whole
 * letter, or hidden; a bar's quantity whole beside a whole label or not drawn;
 * a chip's icon whole or not drawn — at the desktop's width and a laptop's, in
 * both themes. A label too narrow to show is one hover away, in the canvas's
 * tooltip.
 */
test.describe("Plan element text (#1258, #1264)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured at the desktop project's widths");

    /** Every Plan example that draws bars, chips or rollup bands, and the narrow layout's tab its rows' cards are
     *  under where it lands on another: planNarrow lands on its groups' heat strips, which draw no text. */
    const TEXT_EXAMPLES: readonly { name: string; file: string; tab?: string }[] = [
        ...["planTargetState", "planVariants", "planSpanRows", "planCardRows", "planGroupedRows", "planSeriesData",
            "planLiteralRows", "planPick", "planLibraryDnd", "planRowDrop", "planFill", "planEditing", "planUiState",
            "planExpand", "planNumberAxis", "planOrdinalAxis", "slicePlanChrome",
        ].map((name) => ({ name, file: PLAN_EXAMPLES })),
        { name: "planNarrow", file: PLAN_EXAMPLES, tab: "rows" },
        ...["planEvents", "planPrintWorks", "planLibrary", "planEventRefs", "planEventLinks"].map((name) => ({ name, file: PLAN_EVENT_EXAMPLES })),
    ];

    for (const { name, file, tab } of TEXT_EXAMPLES) {
        for (const width of [1280, 1024]) {
            for (const theme of ["light", "dark"] as const) {
                test(`${name} at ${width}px (${theme}): no bar, chip or rollup band draws a partial glyph — its label whole, ellipsized after a whole letter, or hidden; a bar's quantity whole beside a whole label or not drawn; a chip's icon whole or not drawn`, async ({ page }) => {
                    await page.setViewportSize({ width, height: 800 });
                    const entry = await openExample(page, name, file, theme);
                    if (tab !== undefined) await entry.locator(`[data-plan-narrow] [data-plan-tab=${JSON.stringify(tab)}]`).click();
                    await expect.poll(() => entry.locator("[data-run], [data-chip], [data-plan-band]").count()).toBeGreaterThan(0);
                    await expect.poll(() => entry.evaluate(cutText)).toEqual([]);
                });
            }
        }
    }

    /** Each element set either side of a width its text turns at (#1264) — the examples draw few such widths. In
     *  the mono faces a letter and the ellipsis take 2ch: 11.4px at a band's 9.5px, which has no padding, and 12px
     *  at a chip's 10px, inside its 9px padding either side; a chip's icon takes 1.25em, 12.5px, and its gap 4px.
     *  So a plain chip's label turns at 30px, a chip's icon at 30.5px, and the label beside it at 46.5px. */
    const TURNS: readonly { name: string; file: string; sel: string; width: number; label: boolean; icon: boolean | null }[] = [
        { name: "planSpanRows", file: PLAN_EXAMPLES, sel: "[data-plan-band]", width: 10, label: false, icon: null },
        { name: "planSpanRows", file: PLAN_EXAMPLES, sel: "[data-plan-band]", width: 16, label: true, icon: null },
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
});

/**
 * A row's controls (#1258): 24px sm ghost buttons at the end of its gutter
 * line, after its value, no ring — and always shown (the user's ruling over
 * `Plan links.html`'s hover reveal), a pressed one in the brand tint; never
 * under 480; the canvas's tooltip names each.
 */
test.describe("Plan row controls (#1258)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured at the desktop project's widths");

    test("planSpanRows: a row's controls show at rest, at the end of its gutter line after its value; the canvas's tooltip names each; pressed, one wears the press and every row's controls stay shown", async ({ page }) => {
        const entry = await openExample(page, "planSpanRows");
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

    test("planExpand: an expanded chart row's control stays on its gutter's first line, and the chart's ticks step left of it", async ({ page }) => {
        const entry = await openExample(page, "planExpand");
        const chart = entry.locator(rowSel("ontime", "ON-TIME"));
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

    test("planSpanRows on a touch screen wide enough for rows: every row's controls show at rest", async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        const entry = await openExample(page, "planSpanRows");
        expect(await page.evaluate(() => matchMedia("(hover: none)").matches), "the screen cannot hover").toBe(true);
        await expect.poll(() => entry.evaluate(rowControlsLaidOut)).toEqual([]);
    });

    test("planSpanRows below 480: the narrow layout draws no row control", async ({ page }) => {
        const entry = await openExample(page, "planSpanRows");
        await expect(entry.locator("[data-plan-body][data-plan-narrow]")).toHaveCount(1);
        await expect(entry.locator("[data-plan-control]")).toHaveCount(0);
    });
});

/**
 * planFold's resolution is its toolbar's (#1258): a bound slice over the
 * weeks it shows declares the `resolution` affordance, so the toolbar's
 * segment switches MONTH and WEEK — nothing outside the Plan chooses it.
 */
test.describe("planFold's resolution (#1258)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

    test("the toolbar's segment switches MONTH and WEEK, and nothing outside the frame chooses the resolution", async ({ page }) => {
        const entry = await openExample(page, "planFold");
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
 * A bound ui state (#824), in a real layout: `planUiState`'s host folds and
 * opens its halls and expands its chart from outside, its picker brings a
 * press into view — opening the hall the press sits in, selecting it and
 * scrolling to it — and the host's readout follows what the user does on the
 * canvas.
 */
test.describe("Plan bound ui state (#824)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

    /** A hall's group band. */
    const band = (entry: Locator, hall: string) =>
        entry.locator(`[data-plan-group=${JSON.stringify(rowId("halls", hall))}]`);

    test("outside writes fold, open and expand; the picker brings a folded press into view; the user's own actions come back", async ({ page }) => {
        const entry = await openExample(page, "planUiState");
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
        await expect(entry.locator("[data-plan-group][aria-expanded='true']")).toHaveCount(0);
        await expect(readout).toHaveText("SELECTED · nothing · 3 FOLDED · 0 OPENED");

        // The host expands the chart: the spark grows, at its model height.
        const chart = entry.locator(rowSel("kpi", "ontime"));
        const rest = await chart.getAttribute("data-plan-h") ?? "";
        await entry.getByRole("button", { name: "On-time chart" }).click();
        await expect(chart).not.toHaveAttribute("data-plan-h", rest);
        await expect.poll(() => mismatches(entry), "chart expanded").toEqual([]);

        // The user opens Hall 2 on the canvas: the host reads it back.
        await band(entry, "Hall 2").click();
        await expect(readout).toHaveText("SELECTED · nothing · 2 FOLDED · 1 OPENED");

        // The picker: Hall 3's press is selected, its hall opened, and it is in view.
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
