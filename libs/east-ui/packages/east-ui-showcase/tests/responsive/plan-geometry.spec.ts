/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Plan's geometry, measured in a real browser (#817): every body item —
 * row, group band, a links focus's band — renders at exactly the height the
 * model laid it out at (`rowHeight`, which each item carries as `data-plan-h`),
 * for every row kind the Plan examples draw, at each density, with chart rows
 * at rest and expanded, and under both row focuses (R1 the role bands, the
 * rows they gather, the band every other row folds into, open and folded, and
 * the pinned rows' strips, #1680's review; R2 context strips and the grown
 * focal row).
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

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { settled } from "./settle";
import { PLAN_EVENT_EXAMPLES, PLAN_EXAMPLES, clickRowControl, linkKey, openExample, planBox, rowId, rowSel, sizeBox } from "./plan-page";
import { cutNumbers, cutText, rulerFaults } from "./plan-text";
import { printWorksBars } from "./plan-builder-page";

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
            ?? el.getAttribute("data-plan-item") ?? el.tagName;
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
 * cell a tile sits in — at its port (#1680's review, ruled 17 Nov 2026). Its
 * band leaves the source's right edge level, or — no room before the plot's
 * end — lifts off its top or bottom edge within its last 7px; its head's tip
 * meets the destination's left edge level, or — no room after the plot's start
 * — drops onto its top or bottom edge within its first 10px; each on the plot's
 * edge where the element lies past the window. A level end meets its element at
 * its port: a lone link on its centre line, and links sharing an end each at
 * their own, stacked about the centre line 2px clear of one another — a link
 * taking its weight where it leaves, its head's width where it enters — ordered
 * by where their other ends lie, topmost first; a lifted or dropped link keeps
 * its place in the stack. An end out of view meets the view's edge in a stub
 * instead, which takes no port and is left to the view's checks. A link names
 * its ends on its hit path, each a row's id and an element's key.
 */
const ribbonEnds = (root: Element): string[] => {
    const svg = root.querySelector("[data-plan-ribbons] svg")!.getBoundingClientRect();
    const nums = (d: string) => d.split(/[\sMLAZ]+/).filter((t) => t !== "").map(Number);
    const near = (a: number, b: number) => Math.abs(a - b) <= 0.6;
    const within = (v: number, lo: number, hi: number) => v >= lo - 0.6 && v <= hi + 0.6;
    const middle = (r: DOMRect) => (r.top + r.bottom) / 2;
    const out: string[] = [];
    /** The element an end names, as it draws. */
    const elementOf = (rowKey: string | null, key: string | null): Element | null => {
        const row = root.querySelector(`[data-plan-row=${JSON.stringify(rowKey)}]`);
        if (row === null) return null;
        const keyed = (sel: string, attr: string) => [...row.querySelectorAll(sel)].find((e) => e.getAttribute(attr) === key);
        return keyed("[data-run]", "data-run") ?? keyed("[data-chip]", "data-chip")
            ?? keyed("[data-mark][role='button']", "data-mark") ?? keyed("[data-event]", "data-event")?.closest("[data-plan-cell]") ?? null;
    };
    const plot = root.querySelector("[data-plan-row] [data-plan-plot]")!.getBoundingClientRect();
    const onPlot = (x: number) => Math.min(plot.right, Math.max(plot.left, x));
    /** A link's end at an element: where it meets it down the page when level, what it takes of the end, and where its
     *  other end lies — none out of view. */
    interface Port { name: string; order: number; level: boolean; y: number; size: number; other: number | undefined }
    /** The ends in view at each element's end and start. */
    const ends = { exit: new Map<Element, Port[]>(), entry: new Map<Element, Port[]>() };
    const add = (side: keyof typeof ends, el: Element, port: Port) => ends[side].set(el, [...(ends[side].get(el) ?? []), port]);
    for (const g of root.querySelectorAll("[data-plan-link]")) {
        const hit = g.querySelector("[data-link]")!;
        const name = `link ${hit.getAttribute("data-link-key")}`;
        const order = Number(g.getAttribute("data-plan-link"));
        const weight = Number(g.querySelector("[data-plan-ribbon-band]")!.getAttribute("stroke-width"));
        const heads = g.querySelectorAll("[data-plan-ribbon-head]");
        const toOff = heads[0]!.hasAttribute("data-plan-stub");
        const fromOff = heads[1]?.hasAttribute("data-plan-stub") ?? false;
        const srcEl = elementOf(hit.getAttribute("data-link-from"), hit.getAttribute("data-link-from-run"));
        const dstEl = elementOf(hit.getAttribute("data-link-to"), hit.getAttribute("data-link-to-run"));
        if ((!fromOff && srcEl === null) || (!toOff && dstEl === null)) { out.push(`${name}: an element it joins is not drawn`); continue; }
        if (!fromOff) {
            const src = srcEl!.getBoundingClientRect();
            const band = g.querySelector<SVGPathElement>("[data-plan-ribbon-band]")!;
            const p0 = band.getPointAtLength(0);
            const [x0, y0] = [svg.left + p0.x, svg.top + p0.y];
            const end = onPlot(src.right);
            // Its first run: across, leaving the end level; up or down, lifting off an edge.
            const first = nums(band.getAttribute("d")!);
            const lifts = Math.abs(first[2]! - first[0]!) < 0.05;
            const lifted = lifts && within(x0, Math.max(onPlot(src.left), end - 7), end) && (near(y0, src.top) || near(y0, src.bottom));
            if (lifts ? !lifted : !near(x0, end)) out.push(`${name} leaves at (${x0.toFixed(1)}, ${y0.toFixed(1)}), not its source's end (${end.toFixed(1)}, ${middle(src).toFixed(1)})`);
            else add("exit", srcEl!, { name, order, level: !lifts, y: y0, size: weight, other: toOff ? undefined : middle(dstEl!.getBoundingClientRect()) });
        }
        if (!toOff) {
            const dst = dstEl!.getBoundingClientRect();
            const head = nums(heads[0]!.getAttribute("d")!);
            const [tx, ty] = [svg.left + head[2]!, svg.top + head[3]!];
            const start = onPlot(dst.left);
            // Its head: pointing across, entering level; pointing up or down, dropping onto an edge.
            const drops = Math.abs(head[1]! - head[5]!) < 0.05;
            const dropped = drops && within(tx, start, Math.min(start + 10, onPlot(dst.right))) && (near(ty, dst.top) || near(ty, dst.bottom));
            if (drops ? !dropped : !near(tx, start)) out.push(`${name} enters at (${tx.toFixed(1)}, ${ty.toFixed(1)}), not its destination's start (${start.toFixed(1)}, ${middle(dst).toFixed(1)})`);
            else add("entry", dstEl!, { name, order, level: !drops, y: ty, size: Math.max(8, 2 * weight), other: fromOff ? undefined : middle(srcEl!.getBoundingClientRect()) });
        }
    }
    // Each level end at its port: the stack its end's links make, about the element's centre line.
    for (const [side, at] of Object.entries(ends)) {
        for (const [el, ports] of at) {
            const centre = middle(el.getBoundingClientRect());
            const tall = ports.reduce((sum, p) => sum + p.size, 0) + 2 * (ports.length - 1);
            // Their order where every other end is in view: topmost first, the drawing order where two lie level.
            const known = ports.every((p) => p.other !== undefined);
            const ordered = known ? [...ports].sort((a, b) => Math.round((a.other! - b.other!) * 10) || a.order - b.order) : ports;
            let y = centre - tall / 2;
            for (const p of ordered) {
                const want = y + p.size / 2;
                y += p.size + 2;
                if (!p.level) continue;
                if (known ? !near(p.y, want) : Math.abs(p.y - centre) > (tall - p.size) / 2 + 0.6) {
                    out.push(`${p.name} meets its ${side === "exit" ? "source's end" : "destination's start"} at ${p.y.toFixed(1)}, `
                        + `not its port${known ? ` ${want.toFixed(1)}` : ""} of ${ports.length} about ${centre.toFixed(1)}`);
                }
            }
            // Where an end's other ends are not all in view, its ports at least lie apart.
            if (!known) {
                const level = ports.filter((p) => p.level).sort((a, b) => a.y - b.y);
                for (let i = 1; i < level.length; i++) {
                    const [a, b] = [level[i - 1]!, level[i]!];
                    if (b.y - a.y < (a.size + b.size) / 2 + 2 - 0.6) out.push(`${a.name} and ${b.name} share their port at ${a.y.toFixed(1)}`);
                }
            }
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
 * Every bar label in view under a links focus, and whether the links stand back from it (#1680's review): each lies
 * inside a box the layer's mask cuts out of the links — the model's box, its glyphs and its bar's padding, held against
 * the text as drawn. Returns how many labels there are, and each one left uncut.
 */
const labelsUncut = (root: Element): { labels: number; uncut: string[] } => {
    const svg = root.querySelector<SVGSVGElement>("[data-plan-ribbons] svg");
    if (svg === null) return { labels: 0, uncut: ["no links layer"] };
    const origin = svg.getBoundingClientRect();
    const cuts = [...svg.querySelectorAll("[data-plan-standback] > rect")].map((r) => ({
        x: Number(r.getAttribute("x")), y: Number(r.getAttribute("y")), w: Number(r.getAttribute("width")), h: Number(r.getAttribute("height")),
    }));
    const uncut: string[] = [];
    let labels = 0;
    for (const label of root.querySelectorAll<HTMLElement>("[data-virtual-extent] [data-run] > [data-plan-label]")) {
        const b = label.getBoundingClientRect();
        // What of it its plot cell shows: a run past the window mounts at its true place for a pan, clipped from view.
        const cell = label.closest("[data-plan-plot]")!.getBoundingClientRect();
        const [left, right] = [Math.max(b.left, cell.left), Math.min(b.right, cell.right)];
        if (right - left <= 0.5 || b.height <= 0) continue;
        labels += 1;
        const [x0, x1, y0, y1] = [left - origin.left, right - origin.left, b.top - origin.top, b.bottom - origin.top];
        if (!cuts.some((c) => c.x - 0.5 <= x0 && x1 <= c.x + c.w + 0.5 && c.y - 0.5 <= y0 && y1 <= c.y + c.h + 0.5)) {
            uncut.push(`${label.closest("[data-plan-row]")?.getAttribute("data-plan-row")} ${label.textContent}`);
        }
    }
    return { labels, uncut };
};

/**
 * Every loopback's lane, and each bar it runs across (#1680's review): a lane runs on a rule or in a band of tracks,
 * never across a row's bar. A lane is its stroke's longest level run at neither end's height, read along the drawn
 * path; a crossing is a bar of a row, the link's own ends' or another's, whose box the lane's line passes through.
 */
const lanesOnBars = (root: Element): { loops: number; crossings: string[] } => {
    const bars = [...root.querySelectorAll("[data-plan-row] [data-run]")].map((el) => ({
        what: `${el.closest("[data-plan-row]")!.getAttribute("data-plan-row")} ${el.getAttribute("data-run")}`, box: el.getBoundingClientRect(),
    }));
    const crossings: string[] = [];
    let loops = 0;
    for (const g of root.querySelectorAll('[data-plan-link][data-plan-route="loop"]')) {
        const path = g.querySelector<SVGPathElement>("[data-plan-ribbon-band]");
        const ctm = path?.getScreenCTM();
        if (path === null || path === undefined || ctm === null || ctm === undefined) continue;
        loops += 1;
        const total = path.getTotalLength();
        const points: DOMPoint[] = [];
        for (let s = 0; s <= total; s += 0.5) points.push(new DOMPoint(path.getPointAtLength(s).x, path.getPointAtLength(s).y).matrixTransform(ctm));
        const first = points[0]!.y;
        const last = points[points.length - 1]!.y;
        let lane: { y: number; x0: number; x1: number } | undefined;
        for (let i = 0; i < points.length;) {
            let j = i;
            while (j + 1 < points.length && Math.abs(points[j + 1]!.y - points[i]!.y) < 0.05) j += 1;
            const [x0, x1] = [Math.min(points[i]!.x, points[j]!.x), Math.max(points[i]!.x, points[j]!.x)];
            const y = points[i]!.y;
            if (Math.abs(y - first) > 1 && Math.abs(y - last) > 1 && (lane === undefined || x1 - x0 > lane.x1 - lane.x0)) lane = { y, x0, x1 };
            i = j + 1;
        }
        if (lane === undefined) continue;
        const key = g.querySelector("[data-link]")?.getAttribute("data-link-key") ?? "?";
        for (const bar of bars) {
            if (bar.box.top < lane.y && lane.y < bar.box.bottom && bar.box.left < lane.x1 && bar.box.right > lane.x0) crossings.push(`${key} over ${bar.what}`);
        }
    }
    return { loops, crossings };
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
    const zs = { links: z(layer), controls: z(root.querySelector("[data-plan-controls]")), now: z(root.querySelector("[data-plan-row] [data-plan-now]")) };
    if (zs.links !== "5" || zs.controls !== "6" || zs.now !== "7") out.push(`layers ${JSON.stringify(zs)}, want links 5, controls 6, now 7`);
    return out;
};

/**
 * The rows' controls as they are laid out (#1258, #1749), and the rows that show theirs. A row's controls take no
 * column of its gutter line: their box lies over the line's value slot — the slot's width, a control's 24px tall, 4
 * over the slot's line, inside the row and the gutter cell — on the row's own ground, so it covers the status and
 * the value under it and nothing of the row's name. It holds two places at its end, links then expand, each a 24px sm
 * ghost button with no ring, or empty where the row has no such control. `faults` says each box laid out otherwise;
 * `shown` names the rows whose box is visible.
 */
const rowControls = (root: Element): { faults: string[]; shown: string[] } => {
    const faults: string[] = [];
    const shown: string[] = [];
    const near = (a: number, b: number) => Math.abs(a - b) <= 0.5;
    const boxes = [...root.querySelectorAll("[data-plan-controls]")].filter((box) => getComputedStyle(box).display !== "none");
    if (boxes.length === 0) faults.push("no row control");
    for (const box of boxes) {
        const rowEl = box.closest("[data-plan-row]")!;
        const row = rowEl.getAttribute("data-plan-row")!;
        if (getComputedStyle(box).visibility === "visible") shown.push(row);
        const slot = box.parentElement!;
        if (slot.getAttribute("data-plan-gutter") !== "slot") { faults.push(`${row}: its controls are not in its line's value slot`); continue; }
        const b = box.getBoundingClientRect();
        const s = slot.getBoundingClientRect();
        const r = rowEl.getBoundingClientRect();
        if (!near(b.left, s.left) || !near(b.right, s.right)) faults.push(`${row}: its controls span ${b.left}–${b.right}px, its value slot ${s.left}–${s.right}px`);
        if (!near(b.height, 24) || !near(s.top - b.top, 4)) faults.push(`${row}: its controls are ${b.height}px tall, ${s.top - b.top}px over its slot's line, want 24 and 4`);
        if (b.top < r.top - 0.5 || b.bottom > r.bottom + 0.5) faults.push(`${row}: its controls leave the row`);
        const cell = box.closest("[role='rowheader']")!;
        const cs = getComputedStyle(cell);
        const end = cell.getBoundingClientRect().right - Number.parseFloat(cs.borderRightWidth) - Number.parseFloat(cs.paddingRight);
        if (!near(end, b.right)) faults.push(`${row}: its controls end ${(end - b.right).toFixed(1)}px short of its gutter line's end`);
        // On the row's own ground, whatever the row wears.
        const [ground, rowGround] = [getComputedStyle(box).backgroundColor, getComputedStyle(rowEl).backgroundColor];
        if (ground !== rowGround) faults.push(`${row}: its controls are on ${ground}, the row on ${rowGround}`);
        // Its name — its label and meta — ends before them.
        const title = slot.parentElement!.querySelector("[data-plan-gutter='title']");
        if (title !== null && title.getBoundingClientRect().right > b.left + 0.5) faults.push(`${row}: its name runs under its controls`);
        // Two places at the box's end: links, then expand.
        const places = [...box.children];
        if (places.length !== 2) { faults.push(`${row}: ${places.length} places for its controls, want 2`); continue; }
        places.forEach((place, i) => {
            const kind = ["links", "expand"][i]!;
            const p = place.getBoundingClientRect();
            if (!near(p.width, 24) || !near(p.height, 24) || !near(b.right - p.right, 24 * (1 - i))) faults.push(`${row}: its ${kind} place is ${p.width}×${p.height}, ending ${b.right - p.right}px before the box's end`);
            const held = place.getAttribute("data-plan-control");
            if (held !== null && held !== kind) faults.push(`${row}: its ${held} control in the ${kind} place`);
            if (held !== null && getComputedStyle(place).boxShadow !== "none") faults.push(`${row}: a ring round its ${kind} control`);
        });
    }
    return { faults, shown };
};

/**
 * A links focus as its body draws it (#1680's review), top to bottom: each
 * band by its role, its height and what it says — its caption, then its count
 * or the word for none — and each row by its id, its height and its second
 * line, which a row the focus gathers from inside a section begins with the
 * section's name; then the pinned rows the focus does not gather, each a strip
 * by its id and height, with the value and the status it keeps.
 */
const focusBody = (root: Element) => {
    const top = (el: Element) => el.getBoundingClientRect().top;
    const text = (el: Element | null) => (el === null ? null : (el.textContent ?? "").trim());
    const h = (el: Element) => el.getBoundingClientRect().height;
    return {
        body: [...root.querySelectorAll("[data-virtual-extent] [data-plan-item]")].sort((x, y) => top(x) - top(y)).map((el) => {
            const band = el.getAttribute("data-plan-focusband");
            if (band !== null) {
                const said = [text(el.querySelector("[data-plan-gutter='label']")), text(el.querySelector("[data-plan-gutter='meta'], [data-plan-focusnone]"))];
                return `${band} ${h(el)} · ${said.filter((s) => s !== null).join(" ")}`;
            }
            return `${el.getAttribute("data-plan-row") ?? el.getAttribute("data-plan-item")} ${h(el)} · ${text(el.querySelector("[data-plan-gutter='sub']")) ?? "—"}`;
        }),
        strips: [...root.querySelectorAll("[data-plan-row][data-ctx]")].map((el) => {
            const value = el.querySelector("[data-plan-gutter='value']");
            // Its gutter's status icon: a plot's tone cells carry a tone too.
            const status = el.querySelector("[role='rowheader'] [role='img'][data-tone]");
            return {
                row: el.getAttribute("data-plan-row"),
                h: h(el),
                value: value === null || getComputedStyle(value).display === "none" ? null : text(value),
                status: status === null || getComputedStyle(status).display === "none" ? null : `${status.getBoundingClientRect().width}px`,
            };
        }),
    };
};

/** The row kinds among the entry's measured rows. */
async function kindsMeasured(entry: Locator): Promise<string[]> {
    return entry.evaluate((root) => [...new Set(
        [...root.querySelectorAll("[data-plan-h][data-plan-kind]")].map((el) => el.getAttribute("data-plan-kind") ?? ""),
    )].sort());
}

test.describe("Plan geometry (#817)", { tag: "@desktop" }, () => {

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
        // The expandable spark's expand control is its toggle: a caret only folds (#1680's review).
        await clickRowControl(spark, "expand");
        await expect(spark).not.toHaveAttribute("data-plan-h", String(rest));
        await expect.poll(() => mismatches(entry), "expanded").toEqual([]);
        await clickRowControl(spark, "expand");
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
        // controls beside it — the click is dispatched to the chart's expand
        // control itself, its toggle (#1680's review). (Layout boxes, which is
        // all this measures, are not clipped.)
        const toggleChart = () => chart.locator('[data-plan-control="expand"]').dispatchEvent("click");
        // A one-line span row — the shared row, which density sets.
        const spanRow = entry.locator(rowSel("press", "p04"));
        const rowAt: Record<string, number> = {};
        for (const density of ["COMFORTABLE", "CONDENSED", "COMPACT"]) {
            await entry.getByText(density, { exact: true }).click();
            await expect(entry.getByRole("radio", { name: density })).toBeChecked();
            await expect.poll(() => kindsMeasured(entry), density).toEqual(KINDS);
            await expect.poll(() => mismatches(entry), density).toEqual([]);
            rowAt[density] = Number(await spanRow.getAttribute("data-plan-h"));
            // The spark's expand control is its toggle: the chart expanded, then back.
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

    test("row focus holds — the role bands, the rows they gather, the band the others fold into, open and folded, and the pinned rows' strips (R1), context strips and the grown focal row (R2)", async ({ page }) => {
        // Wide enough that a strip's week holds its marks apart beside the 240px gutter (#1680's review, #1735).
        await page.setViewportSize({ width: 1920, height: 900 });
        const entry = await openExample(page, "planTargetState");
        await clickRowControl(entry.locator("[data-plan-row]:has([data-plan-control='links'])").first(), "links");
        // A links focus's bands are measured items too — they carry the model's height (#1680's review).
        await expect(entry.locator("[data-plan-focusband][data-plan-h]").first()).toBeVisible();
        await expect.poll(() => mismatches(entry), "R1").toEqual([]);
        // Opened, the band the others fold into holds them as the canvas lays them out, each at its model height.
        const others = entry.locator('[data-plan-focusband="others"]');
        await others.click();
        await expect(others).toHaveAttribute("aria-expanded", "true");
        await expect.poll(() => mismatches(entry), "R1, the others open").toEqual([]);
        await entry.locator("[data-plan-focusback]").click();
        await clickRowControl(entry.locator("[data-plan-row]:has([data-plan-control='expand'])").first(), "expand");
        await expect(entry.locator("[data-plan-row][data-ctx][data-plan-h]").first()).toBeVisible();
        await expect(entry.locator("[data-plan-row][data-expanded][data-plan-h]")).toHaveCount(1);
        await expect.poll(() => mismatches(entry), "R2").toEqual([]);
        // A strip's tiles are marks (#591), each its share of its day (#1735): side by side, 5 apart, inside the day's
        // room, at a strip mark's height — once they have shrunk to it, over the motion's 380ms.
        const stripMarks = () => entry.evaluate((root) => {
            const faults = [...root.querySelectorAll("[data-plan-row][data-ctx] [data-plan-cell]")].flatMap((cell) => {
                const c = cell.getBoundingClientRect();
                const marks = [...cell.querySelectorAll("[data-event][data-ctx]")].map((el) => el.getBoundingClientRect()).sort((x, y) => x.left - y.left);
                return marks.flatMap((m, i) => {
                    const at = `${cell.getAttribute("data-plan-cell")} mark ${i}`;
                    const out: string[] = [];
                    if (m.left < c.left - 0.5 || m.right > c.right + 0.5) out.push(`${at}: outside its day`);
                    if (Math.abs(m.height - 7) > 0.5) out.push(`${at}: ${m.height}px tall`);
                    if (i > 0 && Math.abs(m.left - marks[i - 1]!.right - 5) > 0.5) out.push(`${at}: ${(m.left - marks[i - 1]!.right).toFixed(1)} after the one before`);
                    return out;
                });
            });
            return { marks: root.querySelectorAll("[data-plan-row][data-ctx] [data-event][data-ctx]").length, faults };
        });
        await expect.poll(async () => (await stripMarks()).marks, "no strip marks").toBeGreaterThan(0);
        await expect.poll(async () => (await stripMarks()).faults, "the strip's marks").toEqual([]);
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
test.describe("Plan links focus (#818, #1258)", { tag: "@desktop" }, () => {

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
     *  below), on a bounded canvas: its focus gathers ten rows under its role
     *  bands (#1680's review), 484px in a 271px view, so at rest the six links
     *  between rows below its view draw nothing. */
    const FOCUSES = [
        // The heaviest weighs 6 (ruled 17 Nov 2026, over §15's 8).
        { label: "planTargetState (H1-P09's family)", name: "planTargetState", file: PLAN_EXAMPLES, row: rowSel("detail", "H1-P09"), weights: [2, 4, 6, 4, 2, 6], slots: 1 },
        { label: "planTargetState (H1-P03's transfer)", name: "planTargetState", file: PLAN_EXAMPLES, row: rowSel("presses", "Hall 1", "H1-P03"), weights: [6], slots: 0 },
        {
            label: "planEventLinks", name: "planEventLinks", file: PLAN_EVENT_EXAMPLES, row: rowSel("presses", "a1"),
            // Its flows draw in their record's order, by key (#1541, U10): those in view at rest, the card first, the
            // plates' — which carry no quantity — fifth.
            weights: [2, 2, 6, 4, 1.5, 2, 2, 2, 4, 6, 2], slots: 1,
        },
    ] as const;

    /** H1-P09's links focus as its body draws it ({@link focusBody}): its one upstream row; itself, its hall on its sub
     *  line; the two contract presses both ways, each saying Contract A, which tells Contract A's H1-P03 from Hall 1's;
     *  the delivery; and the 29 other data rows folded. The pinned on-time KPI is a 16 strip that keeps its value and its
     *  status icon, at the size a row draws it. */
    const FOCUS_BODY: ReturnType<typeof focusBody> = {
        body: [
            "upstream 26 · Upstream 1", `${rowId("flavours", "H1-P07")} 32 · —`,
            "focused 26 · Focused", `${rowId("detail", "H1-P09")} 42 · Hall 1`,
            "linked 26 · Linked 2", `${rowId("rollup", "Contract A", "H1-P03")} 42 · Contract A`, `${rowId("rollup", "Contract A", "H2-P11")} 42 · Contract A`,
            "downstream 26 · Downstream 1", `${rowId("delivery", "dlv")} 32 · —`,
            "others 26 · Other rows 29",
        ],
        strips: [{ row: rowId("ontime", "ontime"), h: 16, value: "94.2%", status: "12px" }],
    };
    /** The desktop project's width, and a laptop's. */
    const WIDTHS = [1280, 1024] as const;

    /** Open a family's links focus at a width — the page taking `css` first, when given — and let the focused
     *  canvas come to rest. */
    async function focusLinks(page: Page, focus: (typeof FOCUSES)[number], width: number, css?: string): Promise<Locator> {
        await page.setViewportSize({ width, height: 800 });
        const entry = await openExample(page, focus.name, focus.file);
        if (focus.name === "planEventLinks") {
            // Give this routing fixture a 360px viewport, plus the 44px
            // toolbar and 28px footer. The two-row ruler and group bands
            // leave all six presses visible with room for an 8px stub head,
            // while the bindery stays below the fold.
            await entry.locator("[data-plan-frame]").first().evaluate((el) => {
                (el as HTMLElement).style.height = "432px";
            });
        }
        if (css !== undefined) await page.addStyleTag({ content: css });
        await clickRowControl(entry.locator(focus.row), "links");
        await expect(entry.locator("[data-plan-ribbons] [data-plan-link]")).toHaveCount(focus.weights.length);
        // Away from every link and row: nothing lit, no control hovered.
        await page.mouse.move(0, 0);
        await settled(page);
        return entry;
    }

    for (const focus of FOCUSES) {
        test(`${focus.label}: links meet their elements, stay in the plot and keep their figures at desktop widths`, async ({ page }) => {
            const entry = await focusLinks(page, focus, WIDTHS[0]);
            for (const width of WIDTHS) await test.step(`${width}px`, async () => {
                await page.setViewportSize({ width, height: 800 });
                await settled(page);
                await expect.poll(() => entry.evaluate(ribbonEnds)).toEqual([]);
                await expect.poll(() => entry.evaluate(outsidePlot)).toEqual([]);
                await expect.poll(() => entry.evaluate(linkFigures, { weights: [...focus.weights], slots: focus.slots, bar: 20 })).toEqual([]);
            });
        });
    }

    test("a loopback's lane runs on a rule or in a band of tracks, never across a row's bar (#1680's review)", async ({ page }) => {
        for (const focus of FOCUSES) await test.step(focus.label, async () => {
            const entry = await focusLinks(page, focus, WIDTHS[0]);
            const { loops, crossings } = await entry.evaluate(lanesOnBars);
            expect(crossings).toEqual([]);
            // H1-P09's family holds the loopback from H2-P11 back to H1-P09, past Contract A's H1-P03.
            if (focus === FOCUSES[0]) expect(loops).toBeGreaterThan(0);
        });
    });

    test("the links stand back from every bar label in view: each lies inside a box the layer cuts out of the links (#1680's review)", async ({ page }) => {
        for (const focus of FOCUSES) await test.step(focus.label, async () => {
            const entry = await focusLinks(page, focus, WIDTHS[0]);
            const { labels, uncut } = await entry.evaluate(labelsUncut);
            expect(uncut).toEqual([]);
            expect(labels).toBeGreaterThan(0);
        });
    });

    /** A flow's link on the canvas: planEventLinks' links are rows of one link kind, `flow` (#1541, U10). */
    const flow = (key: string): string => linkKey("flow", key);
    /** Each flow's figure, by its link's key on the canvas. */
    const flows = (routes: Readonly<Record<string, string>>): Record<string, string> =>
        Object.fromEntries(Object.entries(routes).map(([key, route]) => [flow(key), route]));

    /** planEventLinks' flows by their rows' keys, and the figure each draws at rest, its focus's ten rows gathered under
     *  their role bands (#1680's review): the six links between rows below the view draw nothing, and seven reach a
     *  row below it in a stub. */
    const EVENT_ROUTES_AT_REST = {
        card: "stub", covers: "s", inserts: "stub", pads: "runoff", plates: "s", posters: "stub", "proof-sheets": "s",
        proofs: "stub", "report-covers": "stub", "seed-prints": "stub", tags: "feed",
    };
    /** …and scrolled to the end, the band the other rows fold into under them, the rules its loopbacks and its pads'
     *  caption take opened into bands of their tracks (#1680's review): the plates, the tags, the covers, the pads and
     *  the proof sheets draw nothing — both ends above the view — and six leave a row above it in a stub. */
    const EVENT_ROUTES_AT_THE_END = {
        "book-blocks": "loop", books: "s", card: "stub", folded: "loop", inserts: "stub", posters: "stub", proofs: "stub",
        "report-covers": "stub", sections: "s", "sections-more": "s", "seed-prints": "stub", tickets: "s",
    };

    test("planEventLinks: every case its own link — each draws its figure at rest and scrolled to the end, meeting its elements as they draw; scrolled between, the posters' link crosses the view as a band; the night run is entered from above; the layer lies in the rows' own stacking context", async ({ page }) => {
        const entry = await focusLinks(page, FOCUSES[2], 1280);
        const routes = () => entry.evaluate((root) => Object.fromEntries([...root.querySelectorAll("[data-plan-link]")].map((g) =>
            [g.querySelector("[data-link]")!.getAttribute("data-link-key"), g.getAttribute("data-plan-route")])));
        await expect.poll(routes).toEqual(flows(EVENT_ROUTES_AT_REST));
        const frame = entry.locator('[data-virtual-rows="bounded"]');
        await frame.evaluate((el) => { el.scrollTop = el.scrollHeight; });
        await expect.poll(routes).toEqual(flows(EVENT_ROUTES_AT_THE_END));
        await expect.poll(() => entry.evaluate(ribbonEnds)).toEqual([]);
        await expect.poll(() => entry.evaluate(outsidePlot)).toEqual([]);
        // The night run starts at the window's start: its link drops onto it, its head pointing down onto the bar.
        const proofsHead = () => entry.evaluate((root, key) => {
            const g = [...root.querySelectorAll("[data-link-key]")].find((el) => el.getAttribute("data-link-key") === key)!.closest("[data-plan-link]")!;
            const n = g.querySelector("[data-plan-ribbon-head]")!.getAttribute("d")!.split(/[\sMLZ]+/).filter((t) => t !== "").map(Number);
            return n[1] === n[5] && n[3]! > n[1]! ? "down" : "level";
        }, flow("proofs"));
        expect(await proofsHead()).toBe("down");
        // Between: a1, the focused press, above the view and the dispatch bay below it — the shop posters' link between them.
        await frame.evaluate((el) => { el.scrollTop = 140; });
        await expect.poll(async () => (await routes())[flow("posters")]).toBe("band");
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

    test("planEventLinks: a flow clicked is selected — in the ink, its heads with it, its caption outlined, its × a 16px target whole inside the plot; the × removes it, and Undo brings it back (#1541, U10)", async ({ page }) => {
        const entry = await focusLinks(page, FOCUSES[2], 1280);
        const drawn = FOCUSES[2].weights.length;
        // A link takes the pointer along its line alone: the click is given to its hit path, not to its box's middle.
        const hit = (key: string) => entry.locator(`[data-link][data-link-key=${JSON.stringify(flow(key))}]`);
        await hit("covers").dispatchEvent("click");
        const look = () => entry.evaluate((root, key) => {
            const group = [...root.querySelectorAll("[data-link]")].find((el) => el.getAttribute("data-link-key") === key)?.closest("[data-plan-link]");
            if (group === null || group === undefined) return "not drawn";
            const other = [...root.querySelectorAll("[data-plan-link]")].find((g) => g !== group)!;
            const band = (g: Element) => getComputedStyle(g.querySelector("[data-plan-ribbon-band]")!).stroke;
            // Its caption is drawn over every link, in a group of its own, by the link's place in the layer.
            const label = root.querySelector(`[data-plan-ribbon-label="${group.getAttribute("data-plan-link")}"]`);
            if (label === null) return "no caption";
            const knockout = getComputedStyle(label.querySelector("[data-plan-ribbon-knockout]")!);
            const plot = root.querySelector("[data-plan-row] [data-plan-plot]")!.getBoundingClientRect();
            const button = root.querySelector("[data-plan-ribbon-unlink] button");
            const box = button?.getBoundingClientRect();
            return {
                selected: group.hasAttribute("data-selected") && label.hasAttribute("data-selected"),
                links: root.querySelectorAll("[data-plan-link][data-selected]").length,
                // The ink: another colour than a link at rest, its heads and its caption's outline the same.
                ink: band(group) !== band(other),
                heads: getComputedStyle(group.querySelector("[data-plan-ribbon-head]")!).fill === band(group),
                outline: [knockout.stroke === band(group), knockout.strokeWidth],
                remove: button === null || box === undefined ? null
                    : { width: box.width, height: box.height, inside: box.left >= plot.left - 0.5 && box.right <= plot.right + 0.5, says: button.getAttribute("aria-label") },
            };
        }, flow("covers"));
        await expect.poll(look).toEqual({
            selected: true, links: 1, ink: true, heads: true, outline: [true, "1px"],
            remove: { width: 16, height: 16, inside: true, says: "Remove flow" },
        });
        await expect.poll(() => entry.evaluate(outsidePlot)).toEqual([]);
        // Its × removes it: a draft, which the toolbar's Undo takes back.
        await entry.locator("[data-plan-ribbon-unlink] button").click();
        await expect(hit("covers")).toHaveCount(0);
        await expect(entry.locator("[data-plan-link][data-selected]")).toHaveCount(0);
        await entry.locator("[data-builder-frame]").first().getByRole("button", { name: "Undo", exact: true }).click();
        await expect(entry.locator("[data-plan-ribbons] [data-plan-link]")).toHaveCount(drawn);
        await expect(hit("covers")).toHaveCount(1);
    });

    test("planEventLinks: with Connect held, a drag from a job to another draws its line out of the job's end and into the other's start, inside the plot; the drop draws the flow, which Undo takes back (#1541, U10)", async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        const entry = await openExample(page, "planEventLinks", PLAN_EVENT_EXAMPLES);
        const frame = entry.locator("[data-builder-frame]").first();
        // The tools show while the flows are bound with their patch door: Select until the viewer picks.
        const tools = frame.getByRole("radiogroup", { name: "Tools" });
        await expect(tools.getByRole("radio", { name: "Select" })).toHaveAttribute("aria-checked", "true");
        await tools.getByRole("radio", { name: "Connect" }).click();
        await expect(tools.getByRole("radio", { name: "Connect" })).toHaveAttribute("aria-checked", "true");
        const keys = { from: linkKey("job", "J-2001"), onto: linkKey("job", "J-2005") };
        const bar = (row: string, key: string) => entry.locator(`${row} [data-run=${JSON.stringify(key)}]`);
        const from = (await bar(rowSel("presses", "a1"), keys.from).boundingBox())!;
        const onto = (await bar(rowSel("presses", "a2"), keys.onto).boundingBox())!;
        // A press on Catalogue covers, carried past the drag's threshold and onto Menu cards, a row below and later.
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
        await page.mouse.down();
        await page.mouse.move(from.x + from.width / 2 + 8, from.y + from.height / 2, { steps: 2 });
        await page.mouse.move(onto.x + onto.width / 2, onto.y + onto.height / 2, { steps: 6 });
        const line = () => entry.evaluate((root, { from, onto }) => {
            const layer = root.querySelector("[data-plan-connect]");
            const band = layer?.querySelector<SVGPathElement>("[data-plan-link-preview] [data-plan-ribbon-band]");
            const head = layer?.querySelector<SVGGraphicsElement>("[data-plan-link-preview] [data-plan-ribbon-head]");
            if (layer === null || layer === undefined || band === null || band === undefined || head === null || head === undefined) return "no line";
            const boxOf = (key: string) => root.querySelector(`[data-run=${JSON.stringify(key)}]`)!.getBoundingClientRect();
            const source = boxOf(from), target = boxOf(onto);
            const plot = root.querySelector("[data-plan-row] [data-plan-plot]")!.getBoundingClientRect();
            const start = band.getPointAtLength(0).matrixTransform(band.getScreenCTM()!);
            const tip = head.getBoundingClientRect();
            const box = band.getBoundingClientRect();
            const near = (a: number, b: number) => Math.abs(a - b) <= 1.5;
            return {
                snapped: layer.getAttribute("data-plan-connect"),
                // Out of the job's end, within its height; into the other's start, within its height.
                leaves: near(start.x, source.right) && start.y >= source.top && start.y <= source.bottom,
                arrives: near(tip.right, target.left) && tip.top >= target.top - 0.5 && tip.bottom <= target.bottom + 0.5,
                inside: box.left >= plot.left - 0.5 && box.right <= plot.right + 0.5,
                inked: getComputedStyle(band).stroke !== "none" && Number.parseFloat(getComputedStyle(band).strokeWidth) === 3,
            };
        }, keys);
        await expect.poll(line).toEqual({ snapped: "snapped", leaves: true, arrives: true, inside: true, inked: true });
        // The ghost names the link it would draw.
        await expect(page.locator("[data-drag-caption]")).toHaveText("Flow · Catalogue covers → Menu cards");
        await page.mouse.up();
        await expect(entry.locator("[data-plan-connect] [data-plan-link-preview]")).toHaveCount(0);
        // The flow is a draft, and the job is where it was: Undo takes the flow back, and nothing else stands to undo.
        await expect(bar(rowSel("presses", "a1"), keys.from)).toHaveCount(1);
        const undo = frame.getByRole("button", { name: "Undo", exact: true });
        await expect(undo).toBeEnabled();
        await undo.click();
        await expect(undo).toBeDisabled();
    });

    test("planTargetState: the focus band is 32 tall, its link and caption 20 in from its ends, its caption counting each role's rows; the family stands under its role bands, 26 tall — upstream, the focused row, the rows linked both ways, downstream — a row from inside a section saying the section on its second line, two lines tall; every other row folds into one band, which counts them, and a pinned row the focus does not gather is a 16 strip keeping its value and its status (#1680's review)", async ({ page }) => {
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
            };
        });
        expect(read).toEqual({
            h: 32, backIn: 20, captionIn: 20,
            back: "← All rows",
            // H1-P03 and H2-P11 are both upstream and downstream of H1-P09: linked.
            caption: "Links · H1-P09 · 1 upstream · 2 linked · 1 downstream",
            capitals: "uppercase",
        });
        expect(await entry.evaluate(focusBody)).toEqual(FOCUS_BODY);
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

    test("planTargetState: in H1-P03's transfer focus at the Plan's default gutter, every gathered row's controls lie over its line's value slot, at its end, inside its gutter cell, and each press says its hall first on its second line, whole (#1277, #1680's review, #1749)", async ({ page }) => {
        const entry = await focusLinks(page, FOCUSES[1], 1280);
        await expect.poll(async () => (await entry.evaluate(rowControls)).faults).toEqual([]);
        for (const press of ["H1-P03", "H1-P04"]) {
            const sub = entry.locator(`${rowSel("presses", "Hall 1", press)} [data-plan-gutter='sub']`);
            await expect(sub, press).toHaveText(/^Hall 1( · |$)/);
            expect(await sub.evaluate((el) => el.scrollWidth <= el.clientWidth), `${press}'s second line whole`).toBe(true);
        }
    });

    test("planTargetState: in H1-P09's links focus at the Plan's default gutter, H1-P07's value stands whole in its line's value slot, its label whole, and its controls lie over the slot (#1277, #1749)", async ({ page }) => {
        const entry = await focusLinks(page, FOCUSES[0], 1280);
        await expect.poll(async () => (await entry.evaluate(rowControls)).faults).toEqual([]);
        const row = entry.locator(rowSel("flavours", "H1-P07"));
        const read = () => row.evaluate((el) => {
            const line = el.querySelector("[data-plan-gutter='name']")!.getBoundingClientRect();
            const value = el.querySelector<HTMLElement>("[data-plan-gutter='value']")!;
            const v = value.getBoundingClientRect();
            const words = document.createRange();
            words.selectNodeContents(value);
            const w = words.getBoundingClientRect();
            const label = el.querySelector<HTMLElement>("[data-plan-gutter='label']")!;
            return {
                value: value.textContent,
                // Whole, on its line: a value wider than its room is wrapped off the line, out of sight (#1749).
                valueShown: getComputedStyle(value).display !== "none" && v.left >= line.left - 0.5 && v.right <= line.right + 0.5
                    && w.left >= v.left - 0.5 && w.right <= v.right + 0.5 && w.top >= v.top - 0.5 && w.bottom <= v.bottom + 0.5,
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
    ...["planEvents", "planPrintWorks", "planEventLinks"].map((name) => ({ name, file: PLAN_EVENT_EXAMPLES })),
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
 * paints, as `plan-bucket-tiles.spec.ts` samples a bucket cell — read after the ruler's own
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
test.describe("Plan element text (#1258, #1264, #1266, #1269)", { tag: "@desktop" }, () => {

    for (const { name, file, box, tab } of TEXT_EXAMPLES) {
        for (const theme of ["light", "dark"] as const) {
            test(`${name}${box === undefined ? "" : ` in a ${box}px box`} (${theme}): text, numbers and ruler at desktop widths`, async ({ page }) => {
                await page.setViewportSize({ width: 1440, height: 800 });
                const entry = await openExample(page, name, file, theme);
                if (box !== undefined) await sizeBox(page, planBox(entry), box);
                if (tab !== undefined) await entry.locator(`[data-plan-narrow] [data-plan-tab=${JSON.stringify(tab)}]`).click();
                for (const width of [1440, 1280, 1024]) await test.step(`${width}px`, async () => {
                    await page.setViewportSize({ width, height: 800 });
                    await settled(page);
                    await expect.poll(() => entry.locator("[data-run], [data-chip], [data-event], [data-plan-band], [data-mark], [data-plan-mark], [data-plan-heat-label], [data-table-parts], [data-fill]").count()).toBeGreaterThan(0);
                    await expect.poll(() => entry.evaluate(cutText)).toEqual([]);
                    await expect.poll(() => entry.evaluate(cutNumbers)).toEqual([]);
                    await expect.poll(() => entry.evaluate(rulerFaults)).toEqual([]);
                });
            });
        }
    }

    for (const theme of ["light", "dark"] as const) {
        test(`planPrintWorks (${theme}): text, numbers and ruler with a selected job and pinned inspector`, async ({ page }) => {
            await page.setViewportSize({ width: 1440, height: 900 });
            const entry = await openExample(page, "planPrintWorks", PLAN_EVENT_EXAMPLES, theme);
            const host = entry.locator("[data-plan-frame]").first().locator("xpath=..");
            await host.evaluate(el => { (el as HTMLElement).style.width = "1440px"; });
            await settled(page);
            await printWorksBars(entry, "a1", "Spring catalogue").click();
            for (const width of [1440, 1280]) await test.step(`${width}px`, async () => {
                await page.setViewportSize({ width, height: 900 });
                await host.evaluate((el, w) => { (el as HTMLElement).style.width = `${w}px`; }, width);
                await settled(page);
                await expect(entry.locator("[data-builder-frame] > [data-frame-slot='body'] > [data-frame-slot='end'] [data-plan-inspector='event']")).toBeVisible();
                await expect.poll(() => entry.evaluate(rulerFaults)).toEqual([]);
                await expect.poll(() => entry.evaluate(cutNumbers)).toEqual([]);
                await expect.poll(() => entry.evaluate(cutText)).toEqual([]);
            });
        });
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

    test("planPrintWorks: a mark's label runs no further than the next mark on its row, and a mark before the window shows none of its words in it (#1680's review)", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 1400 });
        const entry = await openExample(page, "planPrintWorks", PLAN_EVENT_EXAMPLES);
        /** Each events row's labels its plot shows, and those that run over the next mark or stand for a mark before the window. */
        const markLabelFaults = (root: Element): { labels: number; faults: string[] } => {
            const faults: string[] = [];
            let labels = 0;
            for (const plot of root.querySelectorAll<HTMLElement>("[data-plan-plot]")) {
                const cell = plot.getBoundingClientRect();
                const centres = [...plot.querySelectorAll<HTMLElement>("[data-mark][role='button']")].map((g) => {
                    const b = g.getBoundingClientRect();
                    return { left: b.left, centre: (b.left + b.right) / 2 };
                });
                for (const label of plot.querySelectorAll<HTMLElement>("[data-mark]:not([role='button'])")) {
                    const b = label.getBoundingClientRect();
                    // What of it the plot cell shows: a mark past the window mounts at its true place for a pan, clipped from view.
                    if (Math.min(b.right, cell.right) - Math.max(b.left, cell.left) <= 0.5 || b.height <= 0) continue;
                    labels += 1;
                    const glyph = plot.querySelector<HTMLElement>(`[role='button'][data-mark="${CSS.escape(label.getAttribute("data-mark") ?? "")}"]`);
                    if (glyph === null) { faults.push(`${label.textContent}: no mark`); continue; }
                    const g = glyph.getBoundingClientRect();
                    const centre = (g.left + g.right) / 2;
                    if (centre < cell.left - 0.5) faults.push(`${label.textContent}: shown in the window, its mark ${Math.round(cell.left - centre)}px before it`);
                    const next = centres.filter((c) => c.centre > centre + 0.5).sort((a, c) => a.centre - c.centre)[0];
                    if (next !== undefined && b.right > next.left + 0.5) faults.push(`${label.textContent}: runs ${Math.round(b.right - next.left)}px over the next mark`);
                }
            }
            return { labels, faults };
        };
        // As it opens: the platesetter's plates three days apart, the presses' stops.
        const opened = await entry.evaluate(markLabelFaults);
        expect(opened.labels, "the labels in view").toBeGreaterThan(5);
        expect.soft(opened.faults, "as it opens").toEqual([]);
        // Thirteen days on, a day a press: the Handbook plates' mark two days before the window, where a pan would slide
        // it in from — mounted, out of view.
        await entry.locator("[data-plan-row]").first().click();
        for (let step = 0; step < 13; step++) await page.keyboard.press("]");
        await settled(page);
        await expect(entry.locator("[data-frame-slot='toolbar'] [data-time-trigger]").first()).toHaveAttribute("title", /^Oct 18\s–\sNov 14, 2026$/);
        expect.soft((await entry.evaluate(markLabelFaults)).faults, "thirteen days on").toEqual([]);
    });

    /** The elements a state's border is drawn on, each where it is laid out at a width its cell sets: a bar, a tile, a chip. */
    const STATE_EDGES: readonly { name: string; file: string; sel: string; narrow: boolean }[] = [
        { name: "planPrintWorks", file: PLAN_EVENT_EXAMPLES, sel: "[data-plan-plot] [data-run]", narrow: false },
        // At four weeks its tiles are a few pixels across: five days give each its day's slot.
        { name: "planPressTasks", file: PLAN_EVENT_EXAMPLES, sel: "[data-plan-plot] [data-event]", narrow: true },
        { name: "planPrintWorks", file: PLAN_EVENT_EXAMPLES, sel: "[data-plan-plot] [data-chip]", narrow: false },
    ];
    for (const { name, file, sel, narrow } of STATE_EDGES) {
        test(`${name}: a drafted or proposed ${sel} leaves its words the room a resting one of its width does — the border its state draws stands in its padding (#1680's review)`, async ({ page }) => {
            await page.setViewportSize({ width: 1440, height: 1200 });
            const entry = await openExample(page, name, file);
            if (narrow) {
                await entry.locator("[data-slot='horizon'] [data-brush-handle='hi']").focus();
                for (let i = 0; i < 2; i++) await page.keyboard.press("Shift+ArrowLeft");
                for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
                await settled(page);
            }
            const { checked, shrunk } = await entry.evaluate((root, sel) => {
                /** The room inside an element's padding: what its words have. */
                const room = (el: HTMLElement) => {
                    const cs = getComputedStyle(el);
                    return el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
                };
                const resting = [...root.querySelectorAll<HTMLElement>(sel)].filter((el) => el.getBoundingClientRect().width > 0
                    && !el.hasAttribute("data-draft") && ["obs", "appr"].includes(el.getAttribute("data-state") ?? "")).slice(0, 12);
                const out: string[] = [];
                for (const el of resting) {
                    const rest = room(el);
                    const state = el.getAttribute("data-state")!;
                    el.setAttribute("data-draft", "");
                    if (room(el) < rest - 0.01) out.push(`drafted: ${rest.toFixed(1)} → ${room(el).toFixed(1)}`);
                    el.removeAttribute("data-draft");
                    el.setAttribute("data-state", "prop");
                    if (room(el) < rest - 0.01) out.push(`proposed: ${rest.toFixed(1)} → ${room(el).toFixed(1)}`);
                    el.setAttribute("data-state", state);
                }
                return { checked: resting.length, shrunk: out };
            }, sel);
            expect(checked, "the resting elements measured").toBeGreaterThan(0);
            expect(shrunk).toEqual([]);
        });
    }

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

    /** A table cell whose column cannot hold its numerals (#1438): at WEEK the measures example's weeks are narrower
     *  than a month's sums, and each cell holding one draws a dot in their place, so a value narrower than its
     *  numerals is still seen. Its numerals are kept, hidden, and its hover says them. The dot is drawn whole and
     *  centred in its cell at any width down to its own: in a 9px column, a 42-week window's, the cell's padding
     *  leaves its line less room than the dot, and it must not wrap off it. */
    test("planMeasures: a table cell whose column cannot hold its numerals draws a dot in their place, its hover saying them, whole and centred in the cell down to the dot's own width (#1438)", async ({ page }) => {
        const entry = await openExample(page, "planMeasures");
        await entry.locator('[data-plan-seg="resolution"]').getByRole("radio", { name: "WEEK", exact: true }).click();
        await settled(page);
        const cell = entry.locator("[data-plan-row] [data-cell]:has(> [data-plan-cell-dot])").first();
        await expect(cell).toHaveCount(1);
        /** The dot's box against its cell's: drawn, inside it, and at its centre. */
        const read = () => cell.evaluate((el) => {
            const d = el.querySelector("[data-plan-cell-dot]")!.getBoundingClientRect();
            const c = el.getBoundingClientRect();
            return {
                drawn: d.width > 0 && d.height > 0,
                inside: d.left >= c.left - 0.5 && d.right <= c.right + 0.5 && d.top >= c.top - 0.5 && d.bottom <= c.bottom + 0.5,
                centred: Math.abs(d.left + d.right - c.left - c.right) <= 2 && Math.abs(d.top + d.bottom - c.top - c.bottom) <= 2,
            };
        });
        await expect.poll(read).toEqual({ drawn: true, inside: true, centred: true });
        const numerals = cell.locator(":scope > [data-table-parts]");
        await expect(numerals).toHaveCount(1);
        const said = await numerals.evaluate((g) => [...g.children].map((p) => (p.textContent ?? "").trim()).filter((t) => t !== "").join(" · "));
        expect(said).toMatch(/\d/);
        await cell.hover();
        await expect(page.locator('[data-plan-overlay="tooltip"]')).toHaveText(said);
        await page.mouse.move(0, 0);
        await expect(page.locator('[data-plan-overlay="tooltip"]')).toHaveCount(0);
        for (const px of [9, 4]) {
            await cell.evaluate((el: HTMLElement, w) => {
                el.style.setProperty("width", `${w}px`, "important");
            }, px);
            await expect.poll(read, `a ${px}px column`).toEqual({ drawn: true, inside: true, centred: true });
        }
        await expect.poll(() => entry.evaluate(cutNumbers)).toEqual([]);
    });
});

/**
 * An element's text on a phone (#1269): each tab of every Plan example's narrow
 * layout — its group strips, its rows' cards, its measures — draws no partial
 * glyph in a card and cuts no number in a strip's or a card's cell, every
 * mark's icon inside it, and its ruler draws its labels whole and apart, every
 * period's start among them, in both themes.
 */
test.describe("Plan element text on a phone (#1269)", { tag: "@mobile" }, () => {

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

/**
 * A row's controls (#1258, #1749): sm ghost buttons that take no column of its
 * gutter line. They lie over its value slot, at its end — links, then expand —
 * on the row's own ground, while the row is hovered, holds the focus or is
 * selected, and on the focal row of an open focus, where the pressed one wears
 * the brand tint; hidden otherwise, so a row at rest shows its status and its
 * value. Never under 480; the canvas's tooltip names each.
 */
test.describe("Plan row controls (#1258, #1749)", { tag: "@desktop" }, () => {

    test("planTargetState: no row shows its controls at rest; hovered, a row shows its own over its value slot, 24 tall and 3 under the top of a 32 row; the canvas's tooltip names each; pressed, one wears the press and its row keeps its controls with the pointer and the focus gone; every row back, none shows", async ({ page }) => {
        const entry = await openExample(page, "planTargetState");
        const row = entry.locator(rowSel("detail", "H1-P09"));
        const id = rowId("detail", "H1-P09");
        // Away from every row, nothing hovered, focused or selected: no row shows its controls, each laid out over its slot.
        await page.mouse.move(0, 0);
        await expect.poll(() => entry.evaluate(rowControls)).toEqual({ faults: [], shown: [] });
        // In a 32 row they are a control tall, in the middle of the row's room over its rule, the odd pixel under them.
        expect(await entry.locator(rowSel("flavours", "H1-P07")).evaluate((el) => {
            const box = el.querySelector("[data-plan-controls]")!.getBoundingClientRect();
            const r = el.getBoundingClientRect();
            return { row: r.height, top: box.top - r.top, height: box.height };
        })).toEqual({ row: 32, top: 3, height: 24 });
        // The pointer on the row: its controls, and no other row's.
        await row.locator("[role='rowheader']").hover();
        await expect.poll(() => entry.evaluate(rowControls)).toEqual({ faults: [], shown: [id] });
        const control = row.locator("[data-plan-control='links']");
        await control.hover();
        await expect(page.locator('[data-plan-overlay="tooltip"]')).toHaveText("Focus linked rows");
        // Pressed: the press marks it, and its row keeps its controls with the pointer gone and the focus elsewhere.
        await control.click();
        await expect(entry.locator("[data-plan-focusbar='links']")).toBeVisible();
        await expect(control).toHaveAttribute("aria-pressed", "true");
        await expect(control).toHaveAttribute("data-active", "");
        await control.evaluate((el) => (el as HTMLElement).blur());
        await page.mouse.move(0, 0);
        await expect.poll(() => entry.evaluate(rowControls)).toEqual({ faults: [], shown: [id] });
        // Every row back: nothing pressed, and no row shows its controls.
        await entry.locator("[data-plan-focusback]").click();
        await page.mouse.move(0, 0);
        await expect(entry.locator("[data-plan-control][aria-pressed='true']")).toHaveCount(0);
        await expect.poll(() => entry.evaluate(rowControls)).toEqual({ faults: [], shown: [] });
    });

    test("planTargetState: a row the keyboard is on shows its controls, and a row selected keeps them with the pointer gone", async ({ page }) => {
        const entry = await openExample(page, "planTargetState");
        await page.mouse.move(0, 0);
        const row = entry.locator(rowSel("detail", "H1-P09"));
        await row.focus();
        await expect.poll(() => entry.evaluate(rowControls)).toEqual({ faults: [], shown: [rowId("detail", "H1-P09")] });
        // A click on another row's plot, clear of its bars, selects it: the focus and the controls go with it.
        const other = entry.locator(rowSel("flavours", "H1-P07"));
        const plot = (await other.locator("[data-plan-plot]").boundingBox())!;
        await page.mouse.click(plot.x + plot.width - 6, plot.y + plot.height / 2);
        await page.mouse.move(0, 0);
        await expect(other).toHaveAttribute("data-selected", "");
        await expect.poll(() => entry.evaluate(rowControls)).toEqual({ faults: [], shown: [rowId("flavours", "H1-P07")] });
    });

    test("planTargetState: an expanded chart row keeps its control over its gutter's first line with the pointer and the focus gone, and the chart's scale reads down its gutter's value slot, clear of its value", async ({ page }) => {
        const entry = await openExample(page, "planTargetState");
        const chart = entry.locator(rowSel("ontime", "ontime"));
        await clickRowControl(chart, "expand");
        await expect(chart).toHaveAttribute("data-expanded", "");
        await chart.locator('[data-plan-control="expand"]').evaluate((el) => (el as HTMLElement).blur());
        await page.mouse.move(0, 0);
        const read = () => chart.evaluate((row) => {
            const slot = row.querySelector("[data-plan-gutter='slot']")!.getBoundingClientRect();
            const value = row.querySelector("[data-plan-gutter='value']")!.getBoundingClientRect();
            const ticks = [...row.querySelectorAll("[data-plan-tickpx]")].map((t) => ({ says: t.textContent, box: t.getBoundingClientRect() }));
            return {
                // Its ticks at 80 and 100, a gridline each; the label at 100 would stand on the row's first line, which
                // its value, its status and its pressed control hold, so its gridline alone marks it (#1750).
                ticks: ticks.map((t) => t.says),
                gridlines: row.querySelectorAll("[data-plan-gridline]").length,
                inSlot: ticks.every(({ box }) => box.left >= slot.left - 0.5 && box.right <= slot.right + 0.5 && box.top >= value.bottom - 0.5),
            };
        });
        await expect.poll(read).toEqual({ ticks: ["80"], gridlines: 2, inSlot: true });
        // The focal row of the open focus: its box over its first line's slot, shown; every other row is a strip, with none.
        await expect.poll(() => entry.evaluate(rowControls)).toEqual({ faults: [], shown: [rowId("ontime", "ontime")] });
    });
});

/** A row's controls where nothing hovers (#1258, #1749): none at rest, as everywhere, and a tap on a row — which selects
 *  it — brings its own; below 480, where the narrow layout is in charge, none at all. */
test.describe("Plan row controls on touch (#1258, #1749)", { tag: "@mobile" }, () => {

    test("planTargetState on a touch screen wide enough for rows: no row shows its controls at rest, a tap on a row brings its own, and a tap on one opens its focus", async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        const entry = await openExample(page, "planTargetState");
        expect(await page.evaluate(() => matchMedia("(hover: none)").matches), "the screen cannot hover").toBe(true);
        await expect.poll(() => entry.evaluate(rowControls)).toEqual({ faults: [], shown: [] });
        const row = entry.locator(rowSel("detail", "H1-P09"));
        await row.locator("[role='rowheader']").tap();
        await expect.poll(() => entry.evaluate(rowControls)).toEqual({ faults: [], shown: [rowId("detail", "H1-P09")] });
        await row.locator("[data-plan-control='links']").tap();
        await expect(entry.locator("[data-plan-focusbar='links']")).toBeVisible();
    });

    test("planTargetState below 480: the narrow layout draws no row control", async ({ page }) => {
        const entry = await openExample(page, "planTargetState");
        await expect(entry.locator("[data-plan-body][data-plan-narrow]")).toHaveCount(1);
        await expect(entry.locator("[data-plan-control]")).toHaveCount(0);
    });
});

/**
 * planMeasures' resolution is its toolbar's (#1258): its rail's `weeks` source
 * holds the window and the resolution (#1344), so the toolbar's segment
 * switches MONTH and WEEK — nothing outside the Plan chooses it — and a
 * record's resolution re-buckets the window it holds: the twelve weeks.
 */
test.describe("planMeasures' resolution (#1258)", { tag: "@desktop" }, () => {

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
        // The window stands, W23 to W35, and is drawn by the week.
        await expect(ticks).toHaveText(Array.from({ length: 12 }, (_x, i) => `W${23 + i}`));
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
test.describe("Plan bound ui state (#824)", { tag: "@desktop" }, () => {

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
test.describe("Plan paged blocks (#823)", { tag: "@desktop" }, () => {

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
        const scrollTo = (top: number) => frame.evaluate((el, at) => { el.scrollTop = at; }, top);
        // The first landing: nothing in flight, main not busy.
        await expect(entry.locator('[data-frame-slot="main"]')).toHaveAttribute("aria-busy", "false");
        // The document is both blocks whole from the first landing.
        await expect(extent).toHaveAttribute("data-virtual-extent", String(2 * BLOCK));
        await expect.poll(() => misplaced(entry), "first landing").toEqual([]);

        // Far into the jobs block's tail band, where the ledger puts unit
        // 2,000: its run rebases to window 10, its rows land there, and
        // windows 0–2 leave it for the head band.
        const far = 2_000 * ROW;
        await scrollTo(far);
        await expect(entry.locator(rowSel("jobs", "U12000"))).toHaveCount(1);
        await expect(entry.locator(rowSel("jobs", "U10000"))).toHaveCount(0);
        await expect.poll(() => misplaced(entry), "after the jump").toEqual([]);
        await expect(extent).toHaveAttribute("data-virtual-extent", String(2 * BLOCK));
        expect(await frame.evaluate((el) => el.scrollTop)).toBe(far);

        // Up to the run's first row, 10px into it: once the scroll settles,
        // window 8 lands above it — its last row just above the view — and
        // the rows in view stay where they are.
        const first = 1_800 * ROW + 10;
        await scrollTo(first);
        await expect(entry.locator(rowSel("jobs", "U11799"))).toHaveCount(1);
        await expect.poll(() => misplaced(entry), "after the landing").toEqual([]);
        expect(await frame.evaluate((el) => el.scrollTop)).toBe(first);
    });
});

/** The nested Plans' examples file (#1438). */
const NESTED_EXAMPLES = "e3/plan/plan-nested";

/**
 * Shows only the named series of planNestedAll, from its library's Series tab:
 * each series is a block of every works' rows, so the one shown is at the top.
 * At the desktop's 1280px the library rests as a rail: opened over the rows,
 * then closed by a click on the scrim it lays over them.
 */
async function showOnly(entry: Locator, shown: readonly string[]): Promise<void> {
    await entry.getByRole("button", { name: "Expand Library", exact: true }).click();
    await entry.locator('[role="tab"]', { hasText: /^Series/ }).first().click();
    for (const title of ["Jobs", "Load", "Crew hours", "Parts"]) {
        const toggle = entry.getByRole("button", { name: `Toggle ${title}`, exact: true });
        const on = String(shown.includes(title));
        if ((await toggle.getAttribute("aria-pressed")) !== on) await toggle.click();
        await expect(toggle).toHaveAttribute("aria-pressed", on);
    }
    await entry.locator("[data-scrim]").click();
    await expect(entry.locator("[data-scrim]")).toHaveCount(0);
}

/**
 * The nested Plan's rows as they draw (#1438): a part's own jobs at the bar's
 * height whatever its fold; a crew's cell taking a typed number marked so, and
 * keeping its ring whole once a number typed into it is written.
 */
test.describe("planNestedAll's rows (#1438)", { tag: "@desktop" }, () => {
    test("a part's own jobs draw at the bar's height folded and open, its bands at the rollup's, its row at the row's", async ({ page }) => {
        const entry = await openExample(page, "planNestedAll", NESTED_EXAMPLES);
        await showOnly(entry, ["Parts"]);
        await entry.locator(`[data-plan-group=${JSON.stringify(rowId("assembly", "W-10001"))}]`).click();
        const part = entry.locator(rowSel("parts", "W-10001", "P10001.1"));
        await expect(part.locator("[data-run]").first()).toBeVisible();
        /** The part's row, its jobs' bars and its bands, each height as drawn. */
        const drawn = () => part.evaluate((row) => {
            const heights = (sel: string) => [...new Set([...row.querySelectorAll(sel)].map((el) => el.getBoundingClientRect().height))];
            return { row: row.getBoundingClientRect().height, bars: heights("[data-run]"), bands: heights("[data-plan-band]") };
        });
        // The geometry's row, bar and rollup band.
        const geometry = { row: 32, bars: [20], bands: [12] };
        await expect(part).toHaveAttribute("aria-expanded", "false");
        await expect.poll(drawn, "folded").toEqual(geometry);
        await part.locator('[role="rowheader"]').click();
        await expect(part).toHaveAttribute("aria-expanded", "true");
        await expect.poll(drawn, "open").toEqual(geometry);
    });

    test("a crew's cell taking a typed number wears a faint well inside its edges, and an input's edge on hover; the works row's subtotal, a summary, stays plain", async ({ page }) => {
        const entry = await openExample(page, "planNestedAll", NESTED_EXAMPLES);
        await showOnly(entry, ["Crew hours"]);
        const works = entry.locator(rowSel("crews", "W-10001"));
        await works.locator('[role="rowheader"]').click();
        const cell = entry.locator(`[data-plan-row*='series="crew"'] [data-typed]`).first();
        await expect(cell).toBeVisible();
        /** A cell's well (its `::after`), whether it is painted, and its edge, as drawn. */
        const look = (el: Locator) => el.evaluate((c) => {
            const well = getComputedStyle(c, "::after");
            const painted = well.content !== "none" && well.backgroundColor !== "rgba(0, 0, 0, 0)";
            const inside = painted && [well.top, well.right, well.bottom, well.left].every((side) => side === "1px");
            return { well: painted && inside, edge: getComputedStyle(c).boxShadow };
        });
        await expect.poll(() => look(cell)).toEqual({ well: true, edge: "none" });
        await expect.poll(() => look(works.locator("[data-cell]").first())).toEqual({ well: false, edge: "none" });
        await cell.hover();
        await expect.poll(async () => (await look(cell)).edge).toMatch(/ 0px 0px 0px 1px inset$/);
    });

    test("a crew's cell keeps its ring whole once Enter writes the number typed into it: the field's ring, inside the cell", async ({ page }) => {
        const entry = await openExample(page, "planNestedAll", NESTED_EXAMPLES);
        await showOnly(entry, ["Crew hours"]);
        await entry.locator(rowSel("crews", "W-10001")).locator('[role="rowheader"]').click();
        const cell = entry.locator(`[data-plan-row*='series="crew"'] [data-typed]`).first();
        await cell.dblclick();
        const field = entry.locator("[data-plan-typing]");
        const input = field.locator("input");
        await expect(input).toBeFocused();
        const ring = await field.evaluate((el) => getComputedStyle(el).boxShadow);
        await input.fill("7");
        await input.press("Enter");
        await expect(field).toHaveCount(0);
        await expect(cell).toBeFocused();
        // The field's ring, drawn inside the cell, nothing outside it; and the cell lies inside its row, so the row
        // cuts none of it.
        const drawn = () => cell.evaluate((el) => {
            const style = getComputedStyle(el);
            const box = el.getBoundingClientRect();
            const row = el.closest("[data-plan-row]")!.getBoundingClientRect();
            return { ring: style.boxShadow, outline: style.outlineStyle, inside: box.top >= row.top - 0.5 && box.bottom <= row.bottom + 0.5 };
        });
        await expect.poll(drawn).toEqual({ ring, outline: "none", inside: true });
    });

    test("with every series switched off, the strip keeps spanning the decade, says it has nothing to count, and a drag moves the window along it", async ({ page }) => {
        const entry = await openExample(page, "planNestedAll", NESTED_EXAMPLES);
        const caption = entry.locator("[data-plan-horizon-caption]");
        const spanned = (await caption.textContent())!;
        await showOnly(entry, []);
        await settled(page);
        const track = entry.locator("[data-plan-horizon-track] [data-brush-track]");
        await expect(entry.locator("[data-plan-horizon-meta][data-empty]")).toHaveCount(1);
        await expect(track.locator("[data-brush-bar]")).toHaveCount(0);
        await expect(caption).toHaveText(spanned);
        // The window's body dragged along: it moves on the decade, which stays put.
        const window = track.locator("[data-brush-window]");
        const before = await window.getAttribute("aria-valuetext");
        const box = (await window.boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        for (let step = 1; step <= 10; step++) await page.mouse.move(box.x + box.width / 2 + step * 10, box.y + box.height / 2);
        await page.mouse.up();
        await expect(window).not.toHaveAttribute("aria-valuetext", before!);
        await settled(page);
        await expect(caption).toHaveText(spanned);
    });

    test("a window of the strip's first week, narrower than a tab, draws its two tabs side by side, neither over the other", async ({ page }) => {
        const entry = await openExample(page, "planNestedAll", NESTED_EXAMPLES);
        const track = entry.locator("[data-plan-horizon-track] [data-brush-track]");
        const window = track.locator("[data-brush-window]");
        // Home on the start's tab, then on the end's: the strip's first week, a pixel or so of a decade.
        for (const edge of ["lo", "hi"]) {
            const before = await window.getAttribute("aria-valuetext");
            await track.locator(`[data-brush-handle="${edge}"]`).focus();
            await page.keyboard.press("Home");
            await expect(window).not.toHaveAttribute("aria-valuetext", before!);
            await settled(page);
        }
        const tabs = await track.evaluate((t) => {
            const box = t.getBoundingClientRect();
            const of = (edge: string) => {
                const r = t.querySelector(`[data-brush-handle="${edge}"]`)!.getBoundingClientRect();
                return { left: r.left - box.left, right: r.right - box.left };
            };
            return { lo: of("lo"), hi: of("hi"), narrow: t.hasAttribute("data-narrow") };
        });
        expect(tabs.narrow).toBe(true);
        expect(tabs.lo.left, "the start's tab inside the track").toBeGreaterThanOrEqual(0);
        expect(tabs.lo.right, "the start's tab ends before the end's begins").toBeLessThanOrEqual(tabs.hi.left);
    });

    test("zooming, panning and moving the window add no style rules once each has been drawn: a place is written inline, never into a class", async ({ page }) => {
        // Wide enough that the toolbar shows every zoom, rather than folding them into a menu, at every zoom: the date
        // navigator names the window's first month to its last at a month or a quarter, which takes more of the row than
        // its first alone (#1680's review).
        await page.setViewportSize({ width: 1680, height: 900 });
        const entry = await openExample(page, "planNestedAll", NESTED_EXAMPLES);
        /** Every style rule the page's emotion sheet holds, those nested in its layers counted. */
        const rules = () => page.evaluate(() => {
            const count = (list: CSSRuleList): number => {
                let n = 0;
                for (const rule of list) n += 1 + ("cssRules" in rule ? count((rule as CSSGroupingRule).cssRules) : 0);
                return n;
            };
            const sheet = [...document.styleSheets].find((s) => s.ownerNode instanceof Element && s.ownerNode.getAttribute("data-emotion") === "css");
            return sheet === undefined ? 0 : count(sheet.cssRules);
        });
        const toolbar = entry.locator('[data-frame-slot="toolbar"]').first();
        const track = entry.locator("[data-plan-horizon-track] [data-brush-track]");
        /** A drag on the strip from one place on it to another, in steps. */
        const drag = async (from: number, to: number) => {
            const box = (await track.boundingBox())!;
            const y = box.y + box.height / 2;
            await page.mouse.move(box.x + from, y);
            await page.mouse.down();
            for (let step = 1; step <= 10; step++) await page.mouse.move(box.x + from + ((to - from) * step) / 10, y);
            await page.mouse.up();
            await settled(page);
        };
        /** Every zoom, two pans, and a window drawn on the strip and moved along it: the canvas at places it has not drawn. */
        const round = async (at: number) => {
            for (const zoom of ["Month", "Quarter", "Year", "Week"]) {
                await toolbar.getByRole("radio", { name: new RegExp(`^${zoom}$`, "i") }).click();
                await settled(page);
            }
            await entry.locator("[data-plan-row]").first().click();
            for (let pan = 0; pan < 2; pan++) {
                await page.keyboard.press("]");
                await settled(page);
            }
            await drag(at, at + 60);
            const window = (await entry.locator("[data-plan-horizon-track] [data-brush-window]").boundingBox())!;
            const start = window.x - (await track.boundingBox())!.x + window.width / 2;
            await drag(start, start + 40);
        };
        await round(40);
        const drawn = await rules();
        // The same gestures again, every place on the canvas and the strip a new one.
        await round(160);
        expect(await rules(), "style rules after a second round at new places").toBe(drawn);
    });
});
