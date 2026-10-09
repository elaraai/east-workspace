/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * What the eye checks, measured. The geometry specs hold every rendered box to
 * the MODEL, so a model that is itself wrong to look at — two bands painting
 * the same edge a pixel apart, a column a sliver wide, a label too small to
 * read — passes them. These invariants hold the page to how it must LOOK
 * (`app_design_system/guidelines/guidelines/component-rules.md`, the design review of
 * #949), across the examples, in both themes. Every visual bug found by eye
 * lands here first, as a failing invariant, and is fixed against it.
 *
 * A line painted by a gradient has no box to measure, so a line's place is
 * read from the page's own pixels: one pixel row is decoded in the browser and
 * only the x positions where the colour stands out come back. No image is
 * kept, and nothing is compared with a stored picture.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test visual-invariants --project desktop`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { PLAN_EXAMPLES, openExample, planBox, rowSel, sizeBox } from "./plan-page";
import { settled } from "./settle";

/** A box on the page, in CSS px. */
interface Box { x: number; y: number; width: number }

/**
 * Where lines are painted along ONE pixel row: every x (CSS px from the page's
 * left) whose colour stands out from that row's median — a separator, a
 * border, a rule.
 *
 * @param page - The page
 * @param at - The row to read: its left, its y, and how far it runs
 * @returns The painted columns, ascending
 */
async function paintedLines(page: Page, at: Box): Promise<number[]> {
    const clip = { x: Math.round(at.x), y: Math.round(at.y), width: Math.round(at.width), height: 1 };
    const png = await page.screenshot({ clip });
    return page.evaluate(async ({ b64, left, width }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        const px = ctx.getImageData(0, 0, img.width, 1).data;
        const lum = (i: number) => 0.299 * px[i * 4]! + 0.587 * px[i * 4 + 1]! + 0.114 * px[i * 4 + 2]!;
        const all = Array.from({ length: img.width }, (_u, i) => lum(i));
        const median = [...all].sort((a, b) => a - b)[Math.floor(all.length / 2)]!;
        const scale = img.width / width;
        const out: number[] = [];
        all.forEach((l, i) => { if (Math.abs(l - median) > 8) out.push(Math.round((left + i / scale) * 100) / 100); });
        return out;
    }, { b64: png.toString("base64"), left: clip.x, width: clip.width });
}

/** The Plan examples that draw a ruler over rows. */
const RULED = ["planTargetState", "planMeasures", "planRowDrop", "planNumberAxis", "planOrdinalAxis"];

/** The row kinds whose plot is bare along its bottom edge — nothing but the
 *  bucket lines, the now line and the gutter's edge crosses it there. */
const BARE_KINDS = ["span", "events", "table", "cards"];

/**
 * The ruler's scan line or a bare body row's, across the plot and the
 * gutter's edge — 3px above its band's bottom rule, clear of every label and
 * mark — brought into view first, as far as it needs: a pixel row is read off
 * the screen, and a tall Plan's first bare row can lie below it. The two read
 * one after the other, the plot's columns where they are whatever the scroll.
 */
async function scanLine(entry: Locator, line: "ruler" | "row"): Promise<Box | undefined> {
    return entry.evaluate((root, { kinds, line }) => {
        const body = root.querySelector("[data-plan-body]")!;
        const ruler = body.querySelector("[data-slot='ruler']")!;
        const rowEl = kinds.map((k) => body.querySelector(`[data-plan-row][data-plan-kind='${k}']`)).find((el) => el !== null);
        if (rowEl === undefined || rowEl === null) return undefined;
        (line === "ruler" ? ruler : rowEl).scrollIntoView({ block: "nearest" });
        const track = ruler.children[1]!.getBoundingClientRect();
        const plot = rowEl.querySelector("[data-plan-plot]")!.getBoundingClientRect();
        // From just inside the gutter, so the gutter's edge is read too.
        const x = plot.left - 3;
        const width = plot.right - x;
        return line === "ruler"
            ? { x, y: ruler.getBoundingClientRect().bottom - 3, width }
            : { x: Math.max(x, track.left - 3), y: rowEl.getBoundingClientRect().bottom - 3, width };
    }, { kinds: BARE_KINDS, line });
}

/**
 * Every violation of the canvas's visual rules in one example, read in the
 * page — each as a line saying what, where and by how much.
 */
async function violations(entry: Locator): Promise<string[]> {
    return entry.evaluate((root) => {
        const bad: string[] = [];
        const body = root.querySelector("[data-plan-body]")!;
        const cs = (el: Element) => getComputedStyle(el);
        const px = (v: string) => Number.parseFloat(v);
        /** A token's colour as the page resolves it now (its theme). */
        const token = (name: string): string => {
            const probe = document.createElement("div");
            probe.style.color = `var(${name})`;
            body.appendChild(probe);
            const c = getComputedStyle(probe).color;
            probe.remove();
            return c;
        };
        const T = {
            ink: token("--chakra-colors-fg-default"),
            ink4: token("--chakra-colors-fg-subtle"),
            committed: token("--chakra-colors-brand-emphasized"),
            series1: token("--chakra-colors-brand-solid"),
            tint: token("--chakra-colors-brand-tint"),
            strong: token("--chakra-colors-border-strong"),
        };
        /** Any colour the page computes — `rgb()`, `color(srgb …)`, the
         *  `oklch(…)` a mix in oklch (the heat ramp) computes to — as sRGB
         *  channels, 0–1: drawn over white on a one-pixel canvas and read back,
         *  so no format goes unread. */
        const pixel = document.createElement("canvas");
        pixel.width = 1;
        pixel.height = 1;
        const ink = pixel.getContext("2d", { willReadFrequently: true })!;
        /** Colours painted one over the next, the first at the bottom, over white. */
        const paint = (layers: readonly string[]): Uint8ClampedArray => {
            ink.clearRect(0, 0, 1, 1);
            ink.fillStyle = "#ffffff";
            ink.fillRect(0, 0, 1, 1);
            for (const c of layers) {
                ink.fillStyle = c;
                ink.fillRect(0, 0, 1, 1);
            }
            return ink.getImageData(0, 0, 1, 1).data;
        };
        const rgb = (c: string): [number, number, number] | undefined => {
            const d = paint([c]);
            return [d[0]! / 255, d[1]! / 255, d[2]! / 255];
        };
        /** A colour's opacity, 0–1, read the same way. */
        const alpha = (c: string): number => {
            ink.clearRect(0, 0, 1, 1);
            ink.fillStyle = c;
            ink.fillRect(0, 0, 1, 1);
            return ink.getImageData(0, 0, 1, 1).data[3]! / 255;
        };
        /** What a box's text is read on: its own background over its
         *  ancestors', down to the first opaque one — a cell with no fill of
         *  its own (a no-data heat cell) reads on the row behind it. */
        const ground = (el: Element): string => {
            const layers: string[] = [];
            for (let at: Element | null = el; at !== null; at = at.parentElement) {
                const bg = cs(at).backgroundColor;
                layers.unshift(bg);
                if (alpha(bg) >= 1) break;
            }
            const d = paint(layers);
            return `rgb(${d[0]}, ${d[1]}, ${d[2]})`;
        };
        const lum = (c: string): number | undefined => {
            const v = rgb(c);
            if (v === undefined) return undefined;
            const lin = v.map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)) as [number, number, number];
            return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
        };
        const contrast = (a: string, b: string): number | undefined => {
            const la = lum(a);
            const lb = lum(b);
            if (la === undefined || lb === undefined) return undefined;
            return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
        };
        const mono = (el: Element) => /mono/i.test(cs(el).fontFamily);
        const name = (el: Element) => (el.textContent ?? "").trim().slice(0, 24);
        const type = (el: Element, what: string, want: { size?: number; weight?: string; mono?: boolean; upper?: boolean; color?: string; tnum?: boolean; minSize?: number }) => {
            const s = cs(el);
            if (want.size !== undefined && Math.abs(px(s.fontSize) - want.size) > 0.05) bad.push(`${what} "${name(el)}": ${s.fontSize}, want ${want.size}px`);
            if (want.minSize !== undefined && px(s.fontSize) < want.minSize - 0.05) bad.push(`${what} "${name(el)}": ${s.fontSize}, want ≥ ${want.minSize}px`);
            if (want.weight !== undefined && s.fontWeight !== want.weight) bad.push(`${what} "${name(el)}": weight ${s.fontWeight}, want ${want.weight}`);
            if (want.mono === true && !mono(el)) bad.push(`${what} "${name(el)}": ${s.fontFamily.split(",")[0]}, want mono`);
            if (want.upper === true && s.textTransform !== "uppercase") bad.push(`${what} "${name(el)}": not uppercase`);
            if (want.upper === false && s.textTransform !== "none") bad.push(`${what} "${name(el)}": ${s.textTransform}, want none`);
            if (want.color !== undefined && s.color !== want.color) bad.push(`${what} "${name(el)}": ${s.color}, want ${want.color}`);
            if (want.tnum === true && !s.fontVariantNumeric.includes("tabular-nums")) bad.push(`${what} "${name(el)}": not tabular`);
        };

        // ── 1–3 · One gutter voice ──
        for (const el of body.querySelectorAll("[data-plan-row] [data-plan-gutter='name']")) {
            type(el, "row name", { size: 11.5, weight: "600", mono: true, upper: false, color: T.ink, tnum: true });
        }
        for (const el of body.querySelectorAll("[data-plan-gutter='value']")) {
            type(el, "gutter value", { size: 11.5, weight: "600", mono: true, tnum: true });
        }
        for (const el of body.querySelectorAll("[data-plan-gutter='sub'], [data-plan-gutter='meta']")) {
            type(el, "gutter unit", { size: 10, weight: "400", mono: true, color: T.ink4 });
            if (/\brs\b/.test(el.textContent ?? "")) bad.push(`gutter unit "${name(el)}": "rs" is not spelled out`);
        }
        // ── 4 · The header row ──
        const ruler = body.querySelector("[data-slot='ruler']");
        if (ruler !== null) {
            type(ruler.children[0]!, "ruler caption", { size: 10, weight: "600", mono: true, upper: true, color: T.ink4 });
            for (const el of ruler.querySelectorAll("[data-slot='rulerTick']")) {
                type(el, "ruler tick", { size: 10, weight: "600", mono: true, upper: true, color: T.ink4 });
            }
            // ── B · Whole periods: no column is a sliver ──
            const widths = [...ruler.querySelectorAll("[data-slot='rulerTick']")].map((el) => el.getBoundingClientRect().width);
            const widest = Math.max(...widths);
            widths.forEach((w, i) => { if (w < 0.85 * widest) bad.push(`period ${i}: ${w.toFixed(1)}px beside ${widest.toFixed(1)}px`); });
        }
        // ── 5 · Label order and the 9.5px floor ──
        for (const el of body.querySelectorAll("[data-plan-group] [role='rowheader']")) {
            const s = cs(el);
            type(el, "group label", { size: 9.5, weight: "600", mono: true, upper: true, color: T.ink4 });
            if (Math.abs(px(s.letterSpacing) - 1.52) > 0.05) bad.push(`group label "${name(el)}": tracking ${s.letterSpacing}, want 0.16em`);
        }
        for (const el of body.querySelectorAll("*")) {
            const own = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "");
            if (!own) continue;
            const r = el.getBoundingClientRect();
            const s = cs(el);
            if (r.width < 2 || r.height < 2 || s.visibility === "hidden" || s.display === "none" || s.clip.startsWith("rect(0")) continue;
            if (px(s.fontSize) < 9.45) bad.push(`text "${name(el)}": ${s.fontSize}, below the 9.5px floor`);
        }
        // ── 6 · Heat values ──
        for (const el of body.querySelectorAll("[data-plan-heat-label]")) {
            if ((el.textContent ?? "").trim() === "") continue;
            type(el, "heat value", { minSize: 10.5 });
            const cell = el.parentElement!;
            const k = contrast(cs(el).color, ground(cell));
            if (k !== undefined && k < 4.5) bad.push(`heat value "${name(el)}": contrast ${k.toFixed(2)}:1, want ≥ 4.5:1`);
        }
        // ── 7 · Span labels ──
        for (const el of body.querySelectorAll("[data-run]")) {
            type(el, "span label", { size: 11, weight: "600", mono: true });
            for (const part of el.querySelectorAll("span")) type(part, "span label part", { weight: "600" });
        }
        // ── 8 · Nothing pill-shaped in the toolbar — the Plan's frame's (#1193) ──
        const bar = root.querySelector("[data-builder-frame] [data-frame-slot='toolbar']");
        if (bar !== null) {
            for (const el of bar.querySelectorAll("*")) {
                const r = el.getBoundingClientRect();
                const s = cs(el);
                if (r.height <= 10 || r.width <= 10) continue;
                const framed = px(s.borderTopWidth) > 0 || (s.backgroundColor !== "rgba(0, 0, 0, 0)" && s.backgroundColor !== "transparent");
                if (framed && px(s.borderTopLeftRadius) >= r.height / 2 - 0.5) bad.push(`toolbar "${name(el)}": pill-shaped (radius ${s.borderTopLeftRadius} at ${r.height.toFixed(0)}px)`);
            }
            for (const el of bar.querySelectorAll("[data-slice-add='filter']")) {
                const s = cs(el);
                type(el, "add filter", { weight: "600", mono: true, upper: true });
                if (px(s.fontSize) < 10 || px(s.fontSize) > 11) bad.push(`add filter: ${s.fontSize}, want 10–11px`);
            }
        }
        // ── 10–11 · One committed fill; tint only for selected or dirty ──
        for (const el of body.querySelectorAll("[data-run][data-state='obs'], [data-chip][data-state='obs'], [data-event][data-state='obs']")) {
            if (cs(el).backgroundColor !== T.committed) bad.push(`committed "${name(el)}": ${cs(el).backgroundColor}, want ${T.committed}`);
        }
        for (const el of body.querySelectorAll("[data-plan-nowchip]")) {
            if (cs(el).backgroundColor !== T.committed) bad.push(`now chip: ${cs(el).backgroundColor}, want ${T.committed}`);
        }
        for (const el of body.querySelectorAll("[data-chip]:not([data-state='prop'])")) {
            if (cs(el).backgroundColor === T.tint) bad.push(`chip "${name(el)}": rests on the tint, which means selected or dirty`);
        }
        // ── 12–13 · Chart columns: series 1, forecast, a scale, the now boundary ──
        for (const row of body.querySelectorAll("[data-plan-row][data-plan-kind='chart']")) {
            const columns = [...row.querySelectorAll("[data-plan-mark='column']")];
            if (columns.length === 0) continue;
            for (const c of columns) {
                if (c.getAttribute("data-series") !== "0") continue;
                const fill = cs(c).fill;
                if (!c.hasAttribute("data-planned") && fill !== T.series1) bad.push(`column (actual): ${fill}, want ${T.series1}`);
                if (c.hasAttribute("data-planned") && fill === T.series1) bad.push("column (forecast): drawn as an actual");
            }
            if (row.querySelectorAll("[data-plan-tickpx]").length === 0) bad.push(`chart "${name(row.children[0]!)}": columns with no scale`);
            const now = row.querySelector("[data-plan-now]");
            if (now !== null) {
                const x = now.getBoundingClientRect().left;
                for (const c of columns) {
                    if (!c.hasAttribute("data-planned") && c.getBoundingClientRect().left >= x - 0.5) bad.push("column at or after now drawn as actual");
                }
            }
        }
        // ── 16 · Group hierarchy ──
        const rows = [...body.querySelectorAll("[role='row'][aria-level]")];
        rows.forEach((g, gi) => {
            if (!g.hasAttribute("data-plan-group") || g.getAttribute("aria-expanded") !== "true") return;
            const level = Number(g.getAttribute("aria-level"));
            let last: Element | undefined;
            let j = gi + 1;
            for (; j < rows.length && Number(rows[j]!.getAttribute("aria-level")) > level; j++) last = rows[j];
            if (last === undefined) return;
            // A member's first mark — its caret when it is a parent itself, else
            // its name — starts where the group's label text does: one level
            // of indent is the caret and its gap, so a tree steps in by it. A
            // caret turned to say its row is folded is read by its slot: its
            // centre, which the turn keeps, less half its laid-out width.
            const first = rows[gi + 1]!;
            const gl = g.querySelector("[data-plan-gutter='label']")?.getBoundingClientRect().left;
            const mark = first.querySelector("[data-plan-gutter='name'] > :first-child");
            const mr = mark?.getBoundingClientRect();
            const ml = !(mark instanceof HTMLElement) || mr === undefined ? undefined
                : cs(mark).transform === "none" ? mr.left : (mr.left + mr.right) / 2 - mark.offsetWidth / 2;
            if (gl !== undefined && ml !== undefined && Math.abs(gl - ml) > 0.5) bad.push(`group "${name(g)}": member starts at ${ml.toFixed(1)}, label at ${gl.toFixed(1)}`);
            // The group's end is marked — when its last member and what follows are both mounted.
            if (j < rows.length && cs(last).borderBottomColor !== T.strong) bad.push(`group "${name(g)}": its last member has no closing rule`);
        });
        // ── 17 · Values line up with their columns; one row height ──
        for (const cell of body.querySelectorAll("[data-plan-kind='table'] [data-plan-bucket]")) {
            const parts = [...cell.children].map((c) => c.getBoundingClientRect()).filter((r) => r.width > 0);
            if (parts.length === 0) continue;
            const cr = cell.getBoundingClientRect();
            const mid = (Math.min(...parts.map((p) => p.left)) + Math.max(...parts.map((p) => p.right))) / 2;
            if (Math.abs(mid - (cr.left + cr.right) / 2) > 1.5) bad.push(`table value "${name(cell)}": off its column's centre by ${(mid - (cr.left + cr.right) / 2).toFixed(1)}px`);
        }
        // A heat row draws as tall as a span row the model lays out at the
        // same height (`data-plan-h`): a gutter's second line makes a row of
        // either kind taller, so each heat row is held beside a span row of
        // its own model height, never merely the first span row.
        const spans = [...body.querySelectorAll("[data-plan-row][data-plan-kind='span']:not([data-expanded])")];
        for (const heat of body.querySelectorAll("[data-plan-row][data-plan-kind='heat']:not([data-expanded])")) {
            const h = heat.getAttribute("data-plan-h");
            const span = spans.find((s) => s.getAttribute("data-plan-h") === h);
            if (span === undefined) continue;
            const hh = heat.getBoundingClientRect().height;
            const sh = span.getBoundingClientRect().height;
            if (Math.abs(hh - sh) > 0.5) bad.push(`heat row "${name(heat)}" ${hh}px beside a ${sh}px span row, both laid out at ${h}px`);
        }
        return bad;
    });
}

test.describe("Visual invariants — the Plan", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "read once, at the desktop width");

    for (const theme of ["light", "dark"] as const) {
        for (const name of RULED) {
            test(`${name} (${theme}): the ruler's lines are the rows' lines — every bucket edge, the now line and the gutter's edge on the same pixels`, async ({ page }) => {
                const entry = await openExample(page, name, PLAN_EXAMPLES, theme);
                const ruler = await scanLine(entry, "ruler");
                test.skip(ruler === undefined, "no bare row to read against");
                await settled(page);
                const rulerLines = await paintedLines(page, ruler!);
                const row = await scanLine(entry, "row");
                await settled(page);
                const read = { ruler: rulerLines, row: await paintedLines(page, row!) };
                // Something was read: a canvas's plot has at least its gutter edge.
                expect(read.row.length, "the row's lines").toBeGreaterThan(0);
                expect(read.ruler).toEqual(read.row);
            });

            test(`${name} (${theme}): what the eye checks — one gutter voice, legible labels, whole periods, token fills, aligned values`, async ({ page }) => {
                const entry = await openExample(page, name, PLAN_EXAMPLES, theme);
                expect(await violations(entry)).toEqual([]);
            });
        }

        test(`planNumberAxis (${theme}): the horizon is an overview with a lens, its steps counted once; the range reads inclusive; the footer says plain summaries`, async ({ page }) => {
            const entry = await openExample(page, "planNumberAxis", PLAN_EXAMPLES, theme);
            const read = await entry.evaluate((root) => {
                const body = root.querySelector("[data-plan-body]")!;
                const plot = body.querySelector("[data-plan-row] [data-plan-plot]")!.getBoundingClientRect();
                const lens = body.querySelector("[data-slot='horizon'] [data-plan-lens]");
                const lr = lens?.getBoundingClientRect();
                const bars = [...body.querySelectorAll("[data-slot='horizon'] [data-brush-bar]")].map((b) => Math.round(b.getBoundingClientRect().height));
                // The toolbar and the footer are the frame's, around the canvas (#1193).
                const range = root.querySelector("[data-frame-slot='toolbar'] [data-slice-range-label]");
                const rs = range !== null ? getComputedStyle(range) : undefined;
                const count = (sel: string) => body.querySelectorAll(sel).length;
                return {
                    // Every hook a rule reads, counted on the one example that
                    // holds every row kind — a rule whose hook is gone reads
                    // nothing and passes, so its absence fails here.
                    seen: {
                        names: count("[data-plan-row] [data-plan-gutter='name']"),
                        values: count("[data-plan-gutter='value']"),
                        units: count("[data-plan-gutter='sub'], [data-plan-gutter='meta']"),
                        groups: count("[data-plan-group][aria-expanded='true']"),
                        heatLabels: count("[data-plan-heat-label]"),
                        spans: count("[data-run]"),
                        committed: count("[data-run][data-state='obs']"),
                        columns: count("[data-plan-row][data-plan-kind='chart'] [data-plan-mark='column'][data-series='0']"),
                        scale: count("[data-plan-row][data-plan-kind='chart'] [data-plan-tickpx]"),
                        now: count("[data-plan-row] [data-plan-now]"),
                        nowChip: count("[data-plan-nowchip]"),
                        tableCells: count("[data-plan-kind='table'] [data-plan-bucket]"),
                        addFilter: root.querySelectorAll("[data-frame-slot='toolbar'] [data-slice-add='filter']").length,
                    },
                    lens: lr === undefined ? null : { left: Math.round(lr.left - plot.left), width: Math.round(lr.width - plot.width) },
                    barsEven: bars.length > 0 && bars.every((h) => h === bars[0]),
                    range: range?.textContent ?? null,
                    rangeType: rs === undefined ? null : { size: Number.parseFloat(rs.fontSize), mono: /mono/i.test(rs.fontFamily) },
                    footer: [...root.querySelectorAll("[data-frame-slot='footer'] [data-slot='footer'] > :not([data-slot='footerTransport'])")].map((el) => (el as HTMLElement).innerText),
                    summary: (root.querySelector("[data-frame-slot='toolbar'] [data-slot='toolbarSummary']") as HTMLElement | null)?.innerText ?? null,
                };
            });
            for (const [hook, n] of Object.entries(read.seen)) expect(n, `the ${hook} hook`).toBeGreaterThan(0);
            // The lens meets the plot's own edges: its connectors end where the grid does.
            expect(read.lens).toEqual({ left: 0, width: 0 });
            expect(read.barsEven).toBe(true);
            expect(read.range).toBe("1–8");
            // Mono 11–12px — no longer the loudest text in the toolbar.
            expect(read.rangeType?.mono).toBe(true);
            expect(read.rangeType?.size).toBeGreaterThanOrEqual(11);
            expect(read.rangeType?.size).toBeLessThanOrEqual(12);
            expect(read.footer).toEqual(["8 STEPS · NOW 5"]);
            expect(read.summary).toMatch(/^\d+ OF \d+ ROWS · \d+ FILTERS?$/);
        });

        test(`planTargetState (${theme}): a links focus inks as \`Plan links.html\` does — the muted ink over the paper casing, captions on paper knockouts, an end past the window in a slot dashed in the subtle ink; lit, the strong ink and its halo; its band, Tags, rails and pressed control in their tokens (#1258)`, async ({ page }) => {
            const entry = await openExample(page, "planTargetState", PLAN_EXAMPLES, theme);
            await entry.locator(`${rowSel("detail", "H1-P09")} [data-plan-control="links"]`).click();
            await expect(entry.locator('[data-plan-linkslot="right"]')).toHaveCount(1);
            await page.mouse.move(0, 0);
            const T = {
                muted: await tokenColour(page, "--chakra-colors-fg-muted"),
                strong: await tokenColour(page, "--chakra-colors-fg-strong"),
                subtle: await tokenColour(page, "--chakra-colors-fg-subtle"),
                paper: await tokenColour(page, "--chakra-colors-bg-surface"),
                paper2: await tokenColour(page, "--chakra-colors-bg-canvas"),
                paper3: await tokenColour(page, "--chakra-colors-bg-subtle"),
                rule: await tokenColour(page, "--chakra-colors-border-subtle"),
                link: await tokenColour(page, "--chakra-colors-link"),
                tint: await tokenColour(page, "--chakra-colors-brand-tint"),
                pressed: await tokenColour(page, "--chakra-colors-brand-pressed"),
            };
            /** Every distinct computed look among what a selector matches. */
            const looks = () => entry.evaluate((root) => {
                const all = (sel: string, look: (s: CSSStyleDeclaration) => string) =>
                    [...new Set([...root.querySelectorAll(sel)].map((el) => look(getComputedStyle(el))))].sort();
                const one = (sel: string, look: (s: CSSStyleDeclaration) => string) => all(sel, look)[0] ?? "absent";
                return {
                    band: all(":scope [data-plan-link]:not([data-lit]) [data-plan-ribbon-band]", (s) => s.stroke),
                    head: all(":scope [data-plan-link]:not([data-lit]) [data-plan-ribbon-head]", (s) => s.fill),
                    casing: all("[data-plan-casing='band']", (s) => `${s.stroke} ${s.fill}`),
                    casingHead: all("[data-plan-casing='head']", (s) => `${s.fill} ${s.stroke} ${s.strokeWidth}`),
                    knockout: all("[data-plan-ribbon-knockout]", (s) => s.fill),
                    caption: all("[data-plan-ribbon-caption]", (s) => `${s.fill} ${s.fontSize} ${s.fontWeight} ${/mono/i.test(s.fontFamily) ? "mono" : s.fontFamily}`),
                    slot: all("[data-plan-linkslot]", (s) => `${s.stroke} ${s.strokeWidth} ${s.strokeDasharray} ${s.fill}`),
                    litBand: all("[data-plan-link][data-lit] [data-plan-ribbon-band]", (s) => s.stroke),
                    litHead: all("[data-plan-link][data-lit] [data-plan-ribbon-head]", (s) => s.fill),
                    halo: all("[data-plan-linkend]", (s) => `${s.stroke} ${s.strokeWidth} ${s.fill}`),
                    focusBand: one("[data-plan-focusbar]", (s) => s.backgroundColor),
                    back: one("[data-plan-focusback]", (s) => `${s.color} ${s.fontSize} ${s.fontWeight}`),
                    focusCaption: one("[data-plan-focusbar] > :last-child", (s) => `${s.color} ${s.fontSize} ${s.fontWeight} ${s.textTransform} ${/mono/i.test(s.fontFamily) ? "mono" : s.fontFamily}`),
                    tag: all("[data-plan-focustag]", (s) => `${s.backgroundColor} ${s.color} ${s.borderTopWidth} ${s.borderTopColor} ${s.borderTopLeftRadius} ${s.fontSize} ${s.fontWeight}`),
                    pressed: one("[data-plan-control='links'][aria-pressed='true']", (s) => `${s.backgroundColor} ${s.color}`),
                };
            });
            const rest = await looks();
            expect(rest).toEqual({
                band: [T.muted],
                head: [T.muted],
                casing: [`${T.paper} none`],
                casingHead: [`${T.paper} ${T.paper} 2px`],
                knockout: [T.paper],
                caption: [`${T.muted} 10px 500 mono`],
                slot: [`${T.subtle} 1px 4px, 4px none`],
                litBand: [],
                litHead: [],
                halo: [],
                focusBand: T.paper2,
                back: `${T.link} 12.5px 500`,
                focusCaption: `${T.subtle} 10px 600 uppercase mono`,
                tag: [`${T.paper3} ${T.muted} 1px ${T.rule} 4px 10px 500`],
                pressed: `${T.tint} ${T.pressed}`,
            });
            // Lit: the pointer on a link's band.
            const at = await entry.locator('[data-link="2"]').evaluate((path: SVGPathElement) => {
                const p = path.getPointAtLength(path.getTotalLength() / 2);
                const svg = path.ownerSVGElement!.getBoundingClientRect();
                return { x: svg.left + p.x, y: svg.top + p.y };
            });
            await page.mouse.move(at.x, at.y);
            await expect(entry.locator('[data-plan-link="2"]')).toHaveAttribute("data-lit", "");
            const lit = await looks();
            expect({ band: lit.band, head: lit.head, litBand: lit.litBand, litHead: lit.litHead, halo: lit.halo }).toEqual({
                band: [T.muted], head: [T.muted],
                litBand: [T.strong], litHead: [T.strong],
                halo: [`${T.strong} 1px none`],
            });
            // A rail and a gap band, hovered, step to the third paper.
            for (const sel of ["[data-plan-rail]", "[data-plan-gap]"]) {
                const target = entry.locator(sel).first();
                await target.hover();
                await expect(target, sel).toHaveCSS("background-color", T.paper3);
            }
        });
    }
});

/** Every Table example — each draws its headers' pin / sort controls. */
const TABLES = [
    "tableBasic", "tableRichColumns", "tableFrozen", "tableGroupedColumns", "tablePnl",
    "tableNumberFormats", "tableTree", "dataBindPagedTable", "tableVariants", "tablePaginated",
    "tableExpandable", "tableReview",
];

/** The Table examples whose rows nest (#954) — each with parents and subtotals. */
const NESTED_TABLES = ["tablePnl", "tableNumberFormats", "tableTree", "dataBindPagedTable"];

/** The examples file a Table example lives in, when it is not the Table's own:
 *  the paged tree is bound, so it is e3-ui's (#849). */
const TABLE_FILES: Readonly<Record<string, string>> = { dataBindPagedTable: "e3/bind/data/data" };

/** One nesting level's indent (#954): the Plan's gutter step (#949) — a 14px caret and its 6px gap. */
const TREE_STEP = 20;

/** A Table example's entry, at rest with its first header cell in view. */
async function openTable(page: Page, name: string): Promise<Locator> {
    const file = TABLE_FILES[name] ?? "collections/table";
    await page.goto(`/#${file}/${name}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${file}/${name}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("th").first()).toBeVisible({ timeout: 20_000 });
    await settled(page);
    return entry;
}

test.describe("Visual invariants — the Table", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "read once, at the desktop width");

    for (const name of TABLES) {
        test(`${name}: a header's pin and sort sit side by side on one line, inside it`, async ({ page }) => {
            const entry = await openTable(page, name);
            // The controls hide by opacity, never by layout, so their boxes
            // are real at rest — a pinned or sorted column shows them anyway.
            const bad = await entry.evaluate((root) => {
                const out: string[] = [];
                let seen = 0;
                for (const th of root.querySelectorAll("th")) {
                    const controls = [...th.querySelectorAll("button[aria-label^='Pin'], button[aria-label^='Unpin'], button[aria-label^='Sort']")];
                    if (controls.length === 0) continue;
                    seen += 1;
                    const head = th.getBoundingClientRect();
                    const label = (th.textContent ?? "").trim().slice(0, 24);
                    const boxes = controls.map((c) => c.getBoundingClientRect());
                    boxes.forEach((b, i) => {
                        if (b.top < head.top - 0.5 || b.bottom > head.bottom + 0.5) {
                            out.push(`"${label}": control ${i} spills out of its header (${b.top.toFixed(1)}–${b.bottom.toFixed(1)} in ${head.top.toFixed(1)}–${head.bottom.toFixed(1)})`);
                        }
                        if (i > 0 && (Math.abs(b.top - boxes[0]!.top) > 0.5 || b.left < boxes[i - 1]!.right - 0.5)) {
                            out.push(`"${label}": control ${i} is not beside control ${i - 1} on one line (${b.left.toFixed(1)},${b.top.toFixed(1)} after ${boxes[i - 1]!.right.toFixed(1)},${boxes[0]!.top.toFixed(1)})`);
                        }
                    });
                }
                if (seen === 0) out.push("no header carries a pin or sort control");
                return out;
            });
            expect(bad).toEqual([]);
        });
    }

    test("tableBasic: a header's controls and resize grip rest hidden, and show while it is hovered or holds focus", async ({ page }) => {
        const entry = await openTable(page, "tableBasic");
        const th = entry.locator("th", { has: page.locator("[data-slot='columnControls']:not([data-active])") })
            .filter({ has: page.locator("[data-slot='columnResizer']") }).first();
        await expect(th).toHaveCount(1);
        const controls = th.locator("[data-slot='columnControls']");
        const grip = () => th.locator("[data-slot='columnResizer']").evaluate((el) => getComputedStyle(el, "::before").opacity);
        await page.mouse.move(0, 0);
        await expect(controls).toHaveCSS("opacity", "0");
        await expect.poll(grip).toBe("0");
        await th.hover();
        await expect(controls).toHaveCSS("opacity", "1");
        await expect.poll(grip).toBe("1");
        await page.mouse.move(0, 0);
        await expect(controls).toHaveCSS("opacity", "0");
        // Keyboard focus inside the header shows them too.
        await th.getByRole("button", { name: /^Pin / }).focus();
        await expect(controls).toHaveCSS("opacity", "1");
    });

    for (const name of NESTED_TABLES) {
        test(`${name}: a nested row steps in one indent from its parent — carets aligned at each depth, a leaf's label under its parent's — and a subtotal sits in its column like the cells above it, semibold`, async ({ page }) => {
            const entry = await openTable(page, name);
            // Open every parent, so every depth is on the page.
            const closed = entry.locator("[data-slot='treeToggle'][aria-expanded='false']");
            for (let i = 0; i < 20 && await closed.count() > 0; i++) await closed.first().click();
            await expect(closed).toHaveCount(0);
            await settled(page);
            const read = await entry.evaluate((root, step) => {
                const out: string[] = [];
                const trs = [...root.querySelectorAll<HTMLElement>("tbody tr[data-depth]")];
                const rows = trs.map((tr) => {
                    const indent = tr.querySelector("[data-slot='treeIndent']")!;
                    const cell = indent.closest("td")!.getBoundingClientRect();
                    const toggle = tr.querySelector("[data-slot='treeToggle']")?.getBoundingClientRect();
                    const label = indent.nextElementSibling!.getBoundingClientRect().left;
                    return {
                        depth: Number(tr.getAttribute("data-depth")),
                        name: (tr.textContent ?? "").trim().slice(0, 24),
                        cell, toggle, label,
                        // Where the row's first cell starts: its caret, or a leaf's label.
                        start: toggle?.left ?? label,
                    };
                });
                rows.forEach((r, i) => {
                    if (r.toggle !== undefined && (r.toggle.left < r.cell.left - 0.5 || r.toggle.right > r.cell.right + 0.5)) out.push(`"${r.name}": its caret spills out of its cell`);
                    if (r.depth === 0) return;
                    let p = i - 1;
                    while (p >= 0 && rows[p]!.depth !== r.depth - 1) p--;
                    const parent = rows[p];
                    if (parent === undefined) { out.push(`"${r.name}": depth ${r.depth} with no parent above it`); return; }
                    const stepped = r.start - parent.start;
                    if (Math.abs(stepped - step) > 0.5) out.push(`"${r.name}": starts ${stepped.toFixed(1)}px right of its parent "${parent.name}", want ${step}px`);
                    if (r.toggle === undefined && Math.abs(r.label - parent.label) > 0.5) out.push(`"${r.name}": its label at ${r.label.toFixed(1)}, its parent's at ${parent.label.toFixed(1)}`);
                });
                // Every caret at one depth sits at one x.
                const carets = new Map<number, number[]>();
                for (const r of rows) if (r.toggle !== undefined) carets.set(r.depth, [...(carets.get(r.depth) ?? []), r.toggle.left]);
                for (const [depth, xs] of carets) if (Math.max(...xs) - Math.min(...xs) > 0.5) out.push(`depth ${depth}: carets at ${xs.map((x) => x.toFixed(1)).join(", ")}`);
                // A subtotal sits in its column exactly as the cells above it do:
                // the same cell box, its content on the same edge — the right one
                // in a number column, whose figures sit right-aligned.
                const subtotals = [...root.querySelectorAll<HTMLElement>("tbody td[data-subtotal]")];
                for (const td of subtotals) {
                    const tr = td.closest("tr")!;
                    const col = [...tr.children].indexOf(td);
                    const leaf = [...root.querySelectorAll<HTMLElement>("tbody tr[data-depth]:not([data-parent])")]
                        .map((l) => l.children[col] as HTMLElement | undefined).find((c) => c !== undefined);
                    const what = `"${(tr.textContent ?? "").trim().slice(0, 16)}" column ${col}`;
                    if (leaf === undefined) { out.push(`${what}: no leaf cell to compare`); continue; }
                    const a = td.getBoundingClientRect();
                    const b = leaf.getBoundingClientRect();
                    if (Math.abs(a.left - b.left) > 0.5 || Math.abs(a.width - b.width) > 0.5) out.push(`${what}: cell ${a.left.toFixed(1)}+${a.width.toFixed(1)}, the leaf's ${b.left.toFixed(1)}+${b.width.toFixed(1)}`);
                    const ca = td.firstElementChild?.getBoundingClientRect();
                    const cb = leaf.firstElementChild?.getBoundingClientRect();
                    const right = getComputedStyle(td).justifyContent === "flex-end";
                    const edge = (r: DOMRect) => (right ? r.right : r.left);
                    if (ca !== undefined && cb !== undefined && Math.abs(edge(ca) - edge(cb)) > 0.5) out.push(`${what}: content ${right ? "ends" : "starts"} at ${edge(ca).toFixed(1)}, the leaf's at ${edge(cb).toFixed(1)}`);
                    // The text it shows reads semibold — an accounting subtotal.
                    const texts = [...td.querySelectorAll("*")].filter((el) => [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== ""));
                    for (const el of texts) if (Number(getComputedStyle(el).fontWeight) < 600) out.push(`${what}: "${(el.textContent ?? "").trim()}" at weight ${getComputedStyle(el).fontWeight}, want semibold`);
                }
                return { bad: out, rows: rows.length, parents: rows.filter((r) => r.toggle !== undefined).length, deepest: Math.max(...rows.map((r) => r.depth)), subtotals: subtotals.length };
            }, TREE_STEP);
            // Every hook the rules read is there — a rule over nothing passes.
            expect(read.parents, "parent rows").toBeGreaterThan(0);
            expect(read.deepest, "nesting depth").toBeGreaterThan(0);
            expect(read.subtotals, "subtotal cells").toBeGreaterThan(0);
            expect(read.bad).toEqual([]);
        });
    }

    test("tableFrozen: a pinned column's controls show at rest, its pin upright; an unpinned pin tilts", async ({ page }) => {
        const entry = await openTable(page, "tableFrozen");
        await page.mouse.move(0, 0);
        const pinned = entry.locator("th", { has: page.getByRole("button", { name: /^Unpin / }) }).first();
        await expect(pinned).toHaveCount(1);
        await expect(pinned.locator("[data-slot='columnControls']")).toHaveCSS("opacity", "1");
        await expect(pinned.getByRole("button", { name: /^Unpin / }).locator("svg")).toHaveCSS("transform", "none");
        const loose = entry.getByRole("button", { name: /^Pin / }).first().locator("svg");
        await expect(loose).toHaveCSS("transform", /^matrix\(0\.7071\d*, 0\.7071\d*, -0\.7071\d*, 0\.7071\d*, 0, 0\)$/);
    });
});

/** The Matrix examples whose rows nest (#955). */
const NESTED_MATRICES = ["matrixHeatGrid", "matrixVariants"];

/** A Matrix example's entry, at rest with its first row in view. */
async function openMatrix(page: Page, name: string): Promise<Locator> {
    await page.goto(`/#collections/matrix/${name}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#collections/matrix/${name}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-row-key]").first()).toBeVisible({ timeout: 20_000 });
    await settled(page);
    return entry;
}

test.describe("Visual invariants — the Matrix", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "read once, at the desktop width");

    for (const name of NESTED_MATRICES) {
        test(`${name}: a nested row's header steps in one indent from its parent's — carets aligned at each depth, a leaf's name under its parent's — and every row's cells sit on the column grid`, async ({ page }) => {
            const entry = await openMatrix(page, name);
            const closed = entry.locator("[data-slot='treeToggle'][aria-expanded='false']");
            for (let i = 0; i < 20 && await closed.count() > 0; i++) await closed.first().click();
            await expect(closed).toHaveCount(0);
            await settled(page);
            const read = await entry.evaluate((root, step) => {
                const out: string[] = [];
                const rows = [...root.querySelectorAll<HTMLElement>("[data-row-key][data-depth]")].map((el) => {
                    const toggle = el.querySelector("[data-slot='treeToggle']")?.getBoundingClientRect();
                    const text = el.querySelector("[data-slot='rowHeaderText']")!.getBoundingClientRect().left;
                    const header = el.querySelector("[data-slot='rowHeader']")!.getBoundingClientRect();
                    return {
                        el, header, toggle, text,
                        depth: Number(el.getAttribute("data-depth")),
                        name: el.getAttribute("data-row-key") ?? "",
                        start: toggle?.left ?? text,
                    };
                });
                rows.forEach((r, i) => {
                    if (r.toggle !== undefined && (r.toggle.left < r.header.left - 0.5 || r.toggle.right > r.header.right + 0.5)) out.push(`"${r.name}": its caret spills out of its header`);
                    if (r.depth === 0) return;
                    let p = i - 1;
                    while (p >= 0 && rows[p]!.depth !== r.depth - 1) p--;
                    const parent = rows[p];
                    if (parent === undefined) { out.push(`"${r.name}": depth ${r.depth} with no parent above it`); return; }
                    const stepped = r.start - parent.start;
                    if (Math.abs(stepped - step) > 0.5) out.push(`"${r.name}": starts ${stepped.toFixed(1)}px right of its parent "${parent.name}", want ${step}px`);
                    if (r.toggle === undefined && Math.abs(r.text - parent.text) > 0.5) out.push(`"${r.name}": its name at ${r.text.toFixed(1)}, its parent's at ${parent.text.toFixed(1)}`);
                });
                const carets = new Map<number, number[]>();
                for (const r of rows) if (r.toggle !== undefined) carets.set(r.depth, [...(carets.get(r.depth) ?? []), r.toggle.left]);
                for (const [depth, xs] of carets) if (Math.max(...xs) - Math.min(...xs) > 0.5) out.push(`depth ${depth}: carets at ${xs.map((x) => x.toFixed(1)).join(", ")}`);
                // Every row's cells on the column grid: a cell starts where its column's header does.
                const heads = [...root.querySelectorAll("[data-slot='headerCell']")].map((h) => h.getBoundingClientRect());
                for (const r of rows) {
                    const cells = [...r.el.querySelectorAll("[data-slot='cell']")].map((c) => c.getBoundingClientRect());
                    if (cells.length !== heads.length) { out.push(`"${r.name}": ${cells.length} cells under ${heads.length} columns`); continue; }
                    cells.forEach((c, ci) => {
                        if (Math.abs(c.left - heads[ci]!.left) > 0.5 || Math.abs(c.width - heads[ci]!.width) > 0.5) out.push(`"${r.name}" column ${ci}: cell ${c.left.toFixed(1)}+${c.width.toFixed(1)}, header ${heads[ci]!.left.toFixed(1)}+${heads[ci]!.width.toFixed(1)}`);
                    });
                }
                return { bad: out, parents: rows.filter((r) => r.toggle !== undefined).length, deepest: Math.max(...rows.map((r) => r.depth)) };
            }, TREE_STEP);
            expect(read.parents, "parent rows").toBeGreaterThan(0);
            expect(read.deepest, "nesting depth").toBeGreaterThan(0);
            expect(read.bad).toEqual([]);
        });
    }
});

test.describe("Visual invariants — the Table, on touch", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) >= 1000, "read on the touch viewport");

    test("tableBasic: where nothing hovers, a header's controls rest at reduced emphasis", async ({ page }) => {
        const entry = await openTable(page, "tableBasic");
        expect(await page.evaluate(() => matchMedia("(hover: none)").matches), "the viewport cannot hover").toBe(true);
        const controls = entry.locator("[data-slot='columnControls']:not([data-active])").first();
        await expect(controls).toHaveCount(1);
        await expect(controls).toHaveCSS("opacity", "0.6");
    });
});

/**
 * Every host with a slice rail (#952) or a toolbar row of its own, by an
 * example that mounts it, and the viewport widths it is swept across — each
 * host's own range: the flagship's wide layout holds down to 886px, its
 * resolution folding into its menu by 900 — narrower, its library's 44px rail
 * leaves main under the 480px the narrow layout takes over at, whose toolbar
 * draws no grain segment and so has room to unfold the resolution again, so
 * the sweep stops at 900; its narrow layout is `planTargetState`'s in a 360px
 * box, as a phone's;
 * a Plan with editing over a keyed paged source, its palette its library
 * (#1193, #1259), is swept through its narrow layout, which its library's rail
 * brings on at 800px: there its grain segment goes, and the items that stay
 * fold no less than they did wider, its history last. The SnapGrid editor and Studio's
 * builder fold their zoom into the View chip as their widths hide, and Studio
 * its Save as template, Preview and Publish into the ⋯ chip, each one move
 * (#1229).
 */
const TOOLBAR_HOSTS: ReadonlyArray<{ name: string; route: string; widths: readonly number[]; nudge: readonly number[]; box?: number; rail?: readonly string[]; ladder?: Ladder }> = [
    { name: "Plan", route: `${PLAN_EXAMPLES}/planTargetState`, widths: [1600, 1500, 1400, 1300, 1200, 1100, 1000, 900], nudge: [1500, 1400, 1000], rail: ["cluster", "range"], ladder: planLadder },
    { name: "Plan (editing)", route: `${PLAN_EXAMPLES}/planRowDrop`, widths: [1600, 1400, 1200, 1000, 900, 800, 700], nudge: [1200, 900], rail: ["cluster", "range"], ladder: planLadder },
    { name: "Plan (narrow)", route: `${PLAN_EXAMPLES}/planTargetState`, widths: [1600, 1200, 900], nudge: [1200], box: 360 },
    { name: "Sheet", route: "e3/sheet/sheet/sheetStress", widths: [1600, 1400, 1200, 1000, 900, 800, 700, 600], nudge: [1400, 1000, 800], rail: ["rail"], ladder: sheetLadder },
    { name: "Table", route: "slice/slice/sliceTableChrome", widths: [1600, 1200, 1000, 800, 700, 600], nudge: [1000, 700] },
    { name: "chart", route: "slice/slice/sliceChartChrome", widths: [1600, 1200, 900, 700, 600], nudge: [900] },
    { name: "Slice.Rail", route: "slice/slice/sliceRail", widths: [1600, 1200, 900, 700, 600], nudge: [900] },
    { name: "Deck", route: "collections/deck/deckSlice", widths: [1600, 1200, 900, 700, 600], nudge: [900] },
    { name: "Library", route: "collections/library/libraryLarge", widths: [1600, 1200, 900, 700, 600], nudge: [900], rail: ["rail"], ladder: () => LIBRARY_LADDER },
    { name: "Library (gallery)", route: "collections/library/libraryGalleryReports", widths: [1600, 1200, 900, 700, 600], nudge: [900], ladder: () => LIBRARY_LADDER },
    { name: "Flowchart", route: "collections/flowchart/flowchartPlant", widths: [1600, 1200, 900, 700, 600], nudge: [900] },
    { name: "Schematic", route: "collections/schematic/schematicSlice", widths: [1600, 1200, 900, 700, 600], nudge: [900] },
    { name: "SnapGrid editor", route: "layout/snap-grid/snapGridEditor", widths: [1600, 1200, 1000, 900, 800, 700, 600], nudge: [1000, 800], ladder: () => SNAP_GRID_LADDER },
    { name: "Studio builder", route: "e3/studio/studio/studioBuilder", widths: [1600, 1400, 1200, 1000, 900, 800, 700, 600], nudge: [1200, 900], ladder: () => STUDIO_LADDER },
];

/** What the toolbar says it folded: each item's form of its forms (`data-toolbar-state`). */
type ToolbarState = ReadonlyMap<string, { form: number; forms: number }>;

/** A host's own fold steps after its rail, in order — `[item, form]`, applied once the item is at that form. */
type Ladder = (state: ToolbarState) => ReadonlyArray<readonly [string, number]>;

/** The Plan's own order (the user's decision, #952; its frame's toolbar,
 *  #1193, PB21): the summary shortens to its count, the resolution then the
 *  grain segment fold into their menus, the summary hides, the key search
 *  folds into its icon, and the history item folds last, to its buttons —
 *  each step where its item has it to take. */
function planLadder(state: ToolbarState): ReadonlyArray<readonly [string, number]> {
    const summary = state.get("summary")?.forms ?? 0;
    return [
        ...(summary === 3 ? [["summary", 1] as const] : []),
        ["resolution", 1], ["grain", 1],
        ...(summary > 1 ? [["summary", summary - 1] as const] : []),
        ["seek", 1],
        ["history", 1],
    ];
}

/** The Library's own order: the caption goes, the secondary facts and the
 *  filter fold to their icons, then the grouping does, and last the search
 *  box narrows and drops its key cap. */
const LIBRARY_LADDER: ReadonlyArray<readonly [string, number]> = [["hint", 1], ["dims", 1], ["filter", 1], ["group", 1], ["search", 1], ["search", 2]];

/** The SnapGrid editor's own order (#1229): the grid chip goes, then the width
 *  readout, the widths fold to their icons, then the zoom folds into the View
 *  chip as the widths hide into its menu — one move — then the example's start
 *  item goes, and the history item folds last. */
const SNAP_GRID_LADDER: ReadonlyArray<readonly [string, number]> = [
    ["grid", 1], ["readout", 1], ["widths", 1], ["zoom", 1], ["widths", 2], ["start-0", 1], ["history", 1],
];

/** Studio's builder's own order (#1229): its canvas's steps, then Save as
 *  template, Preview and Publish fold into the ⋯ chip — one move — then the
 *  page's status goes, and the history item folds last. */
const STUDIO_LADDER: ReadonlyArray<readonly [string, number]> = [
    ["grid", 1], ["readout", 1], ["widths", 1], ["zoom", 1], ["widths", 2],
    ["save-template", 1], ["preview", 1], ["publish", 1], ["more", 1], ["status", 1], ["history", 1],
];

/** The Sheet's own order (§6.3): the tabs fold into `+n` one by one, then the
 *  count goes, the context label, the strip's `+ TAB` label and whole-sheet
 *  count, its names cap, it closes up and the context switch goes; and last
 *  the strip folds into one chip, the open view's tab (#1221, SB20). */
function sheetLadder(state: ToolbarState): ReadonlyArray<readonly [string, number]> {
    const tabs = state.get("tabs");
    const maxFold = tabs === undefined ? 0 : tabs.forms - 5;
    return [
        ...Array.from({ length: maxFold }, (_x, k) => ["tabs", k + 1] as const),
        ["count", 1], ["context", 1], ["tabs", maxFold + 1], ["tabs", maxFold + 2], ["tabs", maxFold + 3], ["context", 2],
        ["tabs", maxFold + 4],
    ];
}

/** The first toolbar in an example: the shared toolbar's row, or (before it) a host's own band. */
const TOOLBAR = "[data-toolbar], [data-slot='toolbar'], [data-flowchart-eyebrow]";

/** One sample of what a toolbar painted: its row's width, and what it showed. */
interface Painted { row: number; sig: string }

/** What the toolbar checks keep in the page ({@link installToolbarProbe}, {@link startPainting}). */
interface ToolbarWindow {
    /** What an example's first toolbar shows, as one string: its text, and how
     *  many of its elements draw — a fold that only swaps an icon still changes it. */
    __toolbarSig: (root: Element) => string;
    /** The width of the example's shared toolbar row, or -1 when it has none. */
    __toolbarRow: (root: Element) => number;
    __painted: Painted[];
    /** The latest delivery in the frame under way: what that frame paints, unless a later one supersedes it. */
    __paintPending: Painted | null;
    __paintFrame: number;
    __paintObserver: ResizeObserver;
}

/** Installs the readers every toolbar check shares, before the page's own scripts run. */
async function installToolbarProbe(page: Page): Promise<void> {
    await page.addInitScript((sel: string) => {
        const w = window as unknown as ToolbarWindow;
        w.__toolbarSig = (root) => {
            const bar = root.querySelector(sel);
            if (bar === null) return "no toolbar";
            const drawn = [...bar.querySelectorAll("*")].filter((el) => el.getClientRects().length > 0).length;
            return `${(bar as HTMLElement).innerText.replace(/\s+/g, " ").trim()}|${drawn}`;
        };
        w.__toolbarRow = (root) => root.querySelector("[data-toolbar]")?.getBoundingClientRect().width ?? -1;
    }, TOOLBAR);
}

/** A catalog example's entry, its toolbar in view — a Plan's box `box` wide, when given. */
async function openToolbarHost(page: Page, route: string, width: number, box?: number): Promise<Locator> {
    await installToolbarProbe(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/#${route}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${route}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator(TOOLBAR).first()).toBeVisible({ timeout: 20_000 });
    await settled(page);
    if (box !== undefined) await sizeBox(page, planBox(entry), box);
    return entry;
}

/** Until the toolbar has shown the same thing for 20 frames in a row — longer
 *  than any ladder's wait before it relaxes, so a late relax is seen. */
async function toolbarAtRest(entry: Locator): Promise<string> {
    return entry.evaluate(async (root) => {
        const w = window as unknown as ToolbarWindow;
        const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        let last = w.__toolbarSig(root);
        let same = 0;
        for (let i = 0; i < 600 && same < 20; i++) {
            await frame();
            const now = w.__toolbarSig(root);
            same = now === last ? same + 1 : 0;
            last = now;
        }
        return last;
    });
}

/**
 * Samples what the toolbar paints, until {@link stopPainting}: as each frame
 * begins, and as its row's resize is delivered. The sampler's observer is
 * younger than the toolbar's own, so it is delivered after it — it reads what
 * that frame will paint, the toolbar having answered the width. A frame's
 * deliveries can come in more than one pass — a container's breakpoint
 * crossed in one observer's delivery moves the row, and the toolbar answers
 * its new width in the next pass (#1259) — and the frame paints once, after
 * the last: so a frame's sample is its last delivery, taken as the next frame
 * begins. A frame begun while a resize is still to be delivered (its row not
 * at the width last delivered) paints only after the toolbar has answered, so
 * that sample is dropped.
 */
async function startPainting(entry: Locator): Promise<void> {
    await entry.evaluate((root) => {
        const w = window as unknown as ToolbarWindow;
        const take = (): Painted => ({ row: w.__toolbarRow(root), sig: w.__toolbarSig(root) });
        let delivered = Number.NaN;
        w.__painted = [];
        w.__paintPending = null;
        w.__paintObserver = new ResizeObserver(() => {
            const s = take();
            delivered = s.row;
            w.__paintPending = s;
        });
        const row = root.querySelector("[data-toolbar]");
        if (row !== null) w.__paintObserver.observe(row);
        const tick = () => {
            // What the frame before painted: its last delivery.
            if (w.__paintPending !== null) w.__painted.push(w.__paintPending);
            w.__paintPending = null;
            const s = take();
            if (Math.abs(s.row - delivered) <= 0.5) w.__painted.push(s);
            w.__paintFrame = requestAnimationFrame(tick);
        };
        w.__paintFrame = requestAnimationFrame(tick);
    });
}

/** Stops {@link startPainting}, returning what it sampled. */
async function stopPainting(entry: Locator): Promise<Painted[]> {
    return entry.evaluate(() => {
        const w = window as unknown as ToolbarWindow;
        cancelAnimationFrame(w.__paintFrame);
        w.__paintObserver.disconnect();
        if (w.__paintPending !== null) w.__painted.push(w.__paintPending);
        w.__paintPending = null;
        return w.__painted;
    });
}

/** `data-toolbar-state` (`key=form/forms;…`), read. */
function parseState(text: string): ToolbarState {
    return new Map(text.split(";").filter((p) => p !== "").map((part) => {
        const [key, of] = part.split("=");
        const [form, forms] = of!.split("/").map(Number);
        return [key!, { form: form!, forms: forms! }] as const;
    }));
}

/** `data-toolbar-ladder` (`key>form …`, every step in the order it applies), read. */
function parseLadder(text: string): Array<readonly [string, number]> {
    return text.split(" ").filter((s) => s !== "").map((step) => {
        const [key, form] = step.split(">");
        return [key!, Number(form)] as const;
    });
}

test.describe("Visual invariants — toolbars", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "swept at the desktop project's widths");

    for (const host of TOOLBAR_HOSTS) {
        test(`${host.name}: a toolbar never paints a fold it does not rest on — a 3px resize shows the configuration before it or after it, nothing between`, async ({ page }) => {
            test.setTimeout(120_000);
            const entry = await openToolbarHost(page, host.route, host.nudge[0]!, host.box);
            const bad: string[] = [];
            for (const width of host.nudge) {
                await page.setViewportSize({ width, height: 900 });
                await toolbarAtRest(entry);
                // Sample the toolbar every frame while the width moves by 3px and back, three times.
                await startPainting(entry);
                for (let k = 0; k < 3; k++) {
                    await page.setViewportSize({ width: width + 3, height: 900 });
                    await toolbarAtRest(entry);
                    await page.setViewportSize({ width, height: 900 });
                    await toolbarAtRest(entry);
                }
                const distinct = [...new Set((await stopPainting(entry)).map((p) => p.sig))];
                if (distinct.length > 2) bad.push(`at ${width}px: ${distinct.length} configurations painted — ${distinct.map((d) => d.slice(0, 60)).join(" ⟶ ")}`);
            }
            expect(bad).toEqual([]);
        });

        test(`${host.name}: the toolbar's configuration is a function of its width — the first frame at a width paints what it rests on, the same however it got there, one row that fits, folding further as it narrows, on its host's ladder`, async ({ page }) => {
            test.setTimeout(120_000);
            const entry = await openToolbarHost(page, host.route, host.widths[0]!, host.box);
            const byWidth = new Map<number, string>();
            const bad = new Set<string>();
            const down = [...host.widths];
            const up = [...host.widths].reverse();
            // Down, up, and across — each width reached from both sides and from far away.
            const order = [...down, ...up, down[down.length - 1]!, down[0]!, down[Math.floor(down.length / 2)]!];
            const folds: { row: number; state: ToolbarState }[] = [];
            for (const width of order) {
                await startPainting(entry);
                await page.setViewportSize({ width, height: 900 });
                const sig = await toolbarAtRest(entry);
                const painted = await stopPainting(entry);
                const seen = byWidth.get(width);
                if (seen !== undefined && seen !== sig) bad.add(`at ${width}px: "${seen.slice(0, 70)}" one time, "${sig.slice(0, 70)}" another`);
                byWidth.set(width, sig);
                const read = await entry.evaluate((root) => {
                    const bar = root.querySelector("[data-toolbar]");
                    if (bar === null) return undefined;
                    const box = bar.getBoundingClientRect();
                    const clipped = [...bar.querySelectorAll("[data-toolbar-item] *")].filter((el) => {
                        const r = el.getBoundingClientRect();
                        return r.width > 0 && (r.right > box.right + 0.5 || r.left < box.left - 0.5);
                    }).map((el) => (el.textContent ?? "").trim().slice(0, 20));
                    return {
                        row: box.width,
                        folds: Number(bar.getAttribute("data-toolbar-folds")),
                        state: bar.getAttribute("data-toolbar-state") ?? "",
                        ladder: bar.getAttribute("data-toolbar-ladder") ?? "",
                        clipped: [...new Set(clipped)].slice(0, 4),
                    };
                });
                if (read === undefined) { bad.add(`at ${width}px: no shared toolbar`); continue; }
                // Every frame painted at this width — the first one too — shows what it rests on.
                const wrong = [...new Set(painted.filter((p) => Math.abs(p.row - read.row) <= 0.5 && p.sig !== sig).map((p) => p.sig))];
                if (wrong.length > 0) bad.add(`at ${width}px: painted ${wrong.map((s) => `"${s.slice(0, 60)}"`).join(", ")} before resting on "${sig.slice(0, 60)}"`);
                if (read.clipped.length > 0) bad.add(`at ${width}px: clipped at the row's edge — ${read.clipped.join(", ")}`);
                // What it folded is a prefix of its ladder: each item at the form
                // the ladder's first `folds` steps put it.
                const state = parseState(read.state);
                folds.push({ row: read.row, state });
                const ladder = parseLadder(read.ladder);
                const prefix = ladder.slice(0, read.folds);
                for (const [key, { form }] of state) {
                    const want = prefix.filter(([k]) => k === key).length;
                    if (form !== want) bad.add(`at ${width}px: ${key} at form ${form}, where the ladder's first ${read.folds} steps put it at ${want}`);
                }
                // The ladder itself: the host's own steps in their order, and
                // every step of its rail before them.
                if (host.ladder !== undefined) {
                    const at = host.ladder(state).filter(([key]) => state.has(key))
                        .map(([key, form]) => ({ step: `${key}→${form}`, i: ladder.findIndex(([k, f]) => k === key && f === form) }));
                    at.forEach((s, j) => {
                        const before = at[j - 1];
                        if (s.i < 0) bad.add(`the ladder has no ${s.step}`);
                        else if (before !== undefined && before.i >= 0 && s.i < before.i) bad.add(`the ladder folds ${s.step} before ${before.step}`);
                    });
                    const first = Math.min(...at.map((s) => s.i).filter((i) => i >= 0));
                    ladder.forEach(([key, form], i) => {
                        if ((host.rail ?? []).includes(key) && i > first) bad.add(`the ladder folds the rail's ${key}→${form} after the host's ${ladder[first]!.join("→")}`);
                    });
                }
            }
            // Monotone, item by item: a narrower row never shows an item less
            // folded than a wider row does, nor an item the wider row has not —
            // a Plan's narrow layout draws fewer items, never more (#1259). Over
            // one set of items, this is its fold count never falling.
            const sorted = [...folds].sort((a, b) => b.row - a.row);
            sorted.forEach((f, i) => {
                const wider = sorted[i - 1];
                if (wider === undefined || wider.row <= f.row + 0.5) return;
                for (const [key, { form }] of f.state) {
                    const was = wider.state.get(key);
                    if (was === undefined) bad.add(`a ${f.row.toFixed(0)}px row draws ${key}, which the ${wider.row.toFixed(0)}px row does not`);
                    else if (form < was.form) bad.add(`a ${f.row.toFixed(0)}px row has ${key} at form ${form}, less folded than the ${wider.row.toFixed(0)}px row's ${was.form}`);
                }
            });
            expect([...bad]).toEqual([]);
        });
    }
});

/**
 * The design system's Primary in each theme (#1091): `--brand-d` fill, a
 * `--paper` label at weight 600, and `--brand-dd` under the pointer — the
 * design system's `tokens/colors.css` and `guidelines/cards/parts-button.html`
 * (its current revision; dark `--brand-d` lifts one step).
 */
const PRIMARY = {
    light: { fill: "rgb(58, 119, 128)", label: "rgb(255, 255, 255)", weight: "600", hover: "rgb(43, 75, 85)" },
    dark: { fill: "rgb(101, 178, 189)", label: "rgb(26, 38, 38)", weight: "600", hover: "rgb(129, 204, 213)" },
} as const;

/** An opaque computed colour's channels, 0–255, as the page reports it (`rgb()` / `rgba()`). */
function channels(c: string): [number, number, number] {
    const m = /^rgba?\((\d+), (\d+), (\d+)/.exec(c);
    if (m === null) throw new Error(`not an rgb colour: ${c}`);
    return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** WCAG contrast of two opaque colours. */
function contrast(a: string, b: string): number {
    const lum = (c: string) => {
        const [r, g, bl] = channels(c).map((v) => {
            const x = v / 255;
            return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        }) as [number, number, number];
        return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const la = lum(a);
    const lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** What a button paints at rest — its fill, its label and the label's weight — and its fill under the pointer. */
async function paint(page: Page, part: Locator): Promise<{ fill: string; label: string; weight: string; hover: string }> {
    await page.mouse.move(0, 0);
    const rest = await part.evaluate((el) => {
        const s = getComputedStyle(el);
        return { fill: s.backgroundColor, label: s.color, weight: s.fontWeight };
    });
    await part.hover();
    const hover = await part.evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.mouse.move(0, 0);
    return { ...rest, hover };
}

/** A token's colour as the page resolves it in its theme. */
async function tokenColour(page: Page, name: string): Promise<string> {
    return page.evaluate((n) => {
        const probe = document.createElement("div");
        probe.style.color = `var(${n})`;
        document.body.appendChild(probe);
        const c = getComputedStyle(probe).color;
        probe.remove();
        return c;
    }, name);
}

/** The showcase's host parts (`?host=parts`): Chakra's own parts as a host app draws them. Motion is
 *  reduced, as the theme honours, so a hover is read at its end rather than part-way through. */
async function openHostParts(page: Page, theme: "light" | "dark"): Promise<void> {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/?host=parts&theme=${theme}`);
    await expect(page.locator("[data-host-part='button']")).toBeVisible({ timeout: 20_000 });
    await settled(page);
}

test.describe("Visual invariants — the palette", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "read once, at the desktop width, where the pointer hovers");

    for (const theme of ["light", "dark"] as const) {
        test(`host parts (${theme}): a Chakra <Button> and <IconButton> with no palette are the Primary — brand fill, paper label, the deeper brand under the pointer, the label at 4.5:1 or more`, async ({ page }) => {
            await openHostParts(page, theme);
            for (const name of ["button", "icon-button"]) {
                const read = await paint(page, page.locator(`[data-host-part='${name}']`));
                expect(read, name).toEqual(PRIMARY[theme]);
                expect(contrast(read.label, read.fill), `${name}: its label on its fill`).toBeGreaterThanOrEqual(4.5);
            }
        });

        test(`host parts (${theme}): a checked Chakra <Switch> with no palette has the brand track, its thumb in paper at 4.5:1 or more`, async ({ page }) => {
            await openHostParts(page, theme);
            const read = await page.locator("[data-host-part='switch']").evaluate((root) => ({
                track: getComputedStyle(root.querySelector("[data-part='control']")!).backgroundColor,
                thumb: getComputedStyle(root.querySelector("[data-part='thumb']")!).backgroundColor,
            }));
            expect(read).toEqual({ track: PRIMARY[theme].fill, thumb: PRIMARY[theme].label });
            expect(contrast(read.thumb, read.track), "the thumb on its track").toBeGreaterThanOrEqual(4.5);
        });

        test(`host parts (${theme}): colorPalette still selects another palette — a red and a danger <Button> fill with that palette's solid, label in its contrast, and never take the brand's hover`, async ({ page }) => {
            await openHostParts(page, theme);
            for (const palette of ["red", "danger"]) {
                const want = {
                    fill: await tokenColour(page, `--chakra-colors-${palette}-solid`),
                    label: await tokenColour(page, `--chakra-colors-${palette}-contrast`),
                };
                const read = await paint(page, page.locator(`[data-host-part='button-${palette}']`));
                expect({ fill: read.fill, label: read.label }, palette).toEqual(want);
                expect(read.hover, `${palette}: its hover`).not.toBe(PRIMARY[theme].hover);
                expect(contrast(read.label, read.fill), `${palette}: its label on its fill`).toBeGreaterThanOrEqual(4.5);
            }
        });

        test(`buttonBasic (${theme}): an East <Button> with no style is the Primary`, async ({ page }) => {
            await page.emulateMedia({ reducedMotion: "reduce" });
            await page.goto(`/?theme=${theme}#buttons/button/buttonBasic`);
            await page.waitForSelector("header", { timeout: 20_000 });
            const entry = page.locator("[data-index]", { has: page.locator(`a[href="#buttons/button/buttonBasic"]`) });
            await entry.scrollIntoViewIfNeeded();
            const button = entry.getByRole("button", { name: "Click me" });
            await expect(button).toBeVisible({ timeout: 20_000 });
            await settled(page);
            const read = await paint(page, button);
            expect(read).toEqual(PRIMARY[theme]);
            expect(contrast(read.label, read.fill), "its label on its fill").toBeGreaterThanOrEqual(4.5);
        });
    }
});

/**
 * Where a catalog Pagination's parts sit, in CSS px from the content box of
 * the element that holds it — the room it is given — and what it draws
 * between prev and next.
 */
interface PagerRead {
    /** The holder's content-box width: the room. */
    room: number;
    /** The root (its `nav`): its x and its width. */
    root: [number, number];
    /** The bar — prev, the strip or the readout, next: its x and y. */
    bar: [number, number];
    /** How far the bar's centre sits from the room's, across. */
    barOffCentre: number;
    /** Prev's and next's boxes: x, y, width, height. */
    prev: [number, number, number, number];
    next: [number, number, number, number];
    /** What it draws between them: the page strip (its items and ellipses), or the readout and its text. */
    form: "strip" | "readout" | "neither";
    readout: string | null;
    /** The space after prev and before next, and the bar's gap they should each be. */
    spaces: [number, number];
    gap: number;
    /** How far any part's centre sits from the bar's, up or down. */
    offLine: number;
}

/** A Pagination example's entry in the catalog, at rest, its pagination drawn. */
async function openPagination(page: Page, name: string, theme: "light" | "dark"): Promise<Locator> {
    const route = `collections/pagination/${name}`;
    await page.goto(`/?theme=${theme}#${route}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${route}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("nav[data-scope='pagination']")).toBeVisible({ timeout: 20_000 });
    await settled(page);
    return entry;
}

/** Reads a catalog Pagination ({@link PagerRead}). */
async function readPager(entry: Locator): Promise<PagerRead> {
    return entry.evaluate((root): PagerRead => {
        const r = (n: number) => Math.round(n * 100) / 100;
        const px = (v: string) => Number.parseFloat(v);
        const nav = root.querySelector("nav[data-scope='pagination']")!;
        const holder = nav.parentElement!;
        const hs = getComputedStyle(holder);
        const h = holder.getBoundingClientRect();
        const left = h.left + px(hs.borderLeftWidth) + px(hs.paddingLeft);
        const top = h.top + px(hs.borderTopWidth) + px(hs.paddingTop);
        const room = holder.clientWidth - px(hs.paddingLeft) - px(hs.paddingRight);
        const bar = nav.firstElementChild!;
        const b = bar.getBoundingClientRect();
        const prev = nav.querySelector("[data-part='prev-trigger']")!.getBoundingClientRect();
        const next = nav.querySelector("[data-part='next-trigger']")!.getBoundingClientRect();
        const strip = [...nav.querySelectorAll("[data-part='item'], [data-part='ellipsis']")].map((el) => el.getBoundingClientRect());
        const readout = nav.querySelector("[aria-live='polite']");
        const between = readout !== null ? [readout.getBoundingClientRect()] : strip;
        const start = Math.min(...between.map((p) => p.left));
        const end = Math.max(...between.map((p) => p.right));
        const centre = (p: DOMRect) => p.top + p.height / 2;
        const box = (p: DOMRect): [number, number, number, number] => [r(p.left - left), r(p.top - top), r(p.width), r(p.height)];
        return {
            room: r(room),
            root: [r(nav.getBoundingClientRect().left - left), r(nav.getBoundingClientRect().width)],
            bar: [r(b.left - left), r(b.top - top)],
            barOffCentre: r(b.left + b.width / 2 - (left + room / 2)),
            prev: box(prev),
            next: box(next),
            form: readout !== null ? (strip.length > 0 ? "neither" : "readout") : (strip.length > 0 ? "strip" : "neither"),
            readout: readout?.textContent ?? null,
            spaces: [r(start - prev.right), r(next.left - end)],
            gap: px(getComputedStyle(bar).columnGap),
            offLine: r(Math.max(...[prev, ...between, next].map((p) => Math.abs(centre(p) - centre(b))))),
        };
    });
}

/** Sets what holds an example's pagination: each style given — its width, its display, its justification — `""` giving back its own. */
async function holdIn(page: Page, entry: Locator, style: { width?: string; display?: string; justifyContent?: string }): Promise<void> {
    await entry.evaluate((root, s) => {
        const holder = root.querySelector("nav[data-scope='pagination']")!.parentElement as HTMLElement;
        if (s.width !== undefined) holder.style.width = s.width;
        if (s.display !== undefined) holder.style.display = s.display;
        if (s.justifyContent !== undefined) holder.style.justifyContent = s.justifyContent;
    }, style);
    await settled(page);
}

test.describe("Visual invariants — the Pagination", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "read once, at the desktop width");

    for (const theme of ["light", "dark"] as const) {
        test(`paginationBasic (${theme}): its form follows the room it is given, never what it draws — at the desktop width the page strip, in a container narrowed under 360px the readout, widened again the strip; prev and next keep their places, the bar where the root sat (#1268)`, async ({ page }) => {
            const entry = await openPagination(page, "paginationBasic", theme);
            /** Every place a part keeps, whatever the form: the root across the room, the bar at its start, the parts on one line, 4px apart as the root's were. */
            const placed = (read: PagerRead) => ({ root: read.root, bar: read.bar, prev: read.prev.slice(0, 2), spaces: read.spaces, offLine: read.offLine <= 0.5 });
            const wide = await readPager(entry);
            expect(wide.room, "the room at the desktop width").toBeGreaterThanOrEqual(360);
            expect({ form: wide.form, readout: wide.readout }).toEqual({ form: "strip", readout: null });
            expect(placed(wide)).toEqual({ root: [0, wide.room], bar: [0, 0], prev: [0, 0], spaces: [4, 4], offLine: true });

            await holdIn(page, entry, { width: "320px" });
            const narrow = await readPager(entry);
            expect(narrow.room, "the room narrowed").toBeLessThan(360);
            expect({ form: narrow.form, readout: narrow.readout }).toEqual({ form: "readout", readout: "1 / 25" });
            expect(placed(narrow)).toEqual({ root: [0, narrow.room], bar: [0, 0], prev: [0, 0], spaces: [4, 4], offLine: true });
            expect(narrow.prev, "prev keeps its place").toEqual(wide.prev);

            await holdIn(page, entry, { width: "" });
            expect(await readPager(entry), "widened again: as it was").toEqual(wide);
        });

        test(`paginationVariants (${theme}): in the configurator's stage — a flex box that centres it — its root takes the stage's room and its bar sits centred, where the stage centred the root; a strip wider than 360px never holds the root open, so a stage narrowed under 360px draws the readout, as a grid's track does (#1268)`, async ({ page }) => {
            const entry = await openPagination(page, "paginationVariants", theme);
            /** The root across the stage's room, the bar centred in it, the parts on one line, 4px apart. */
            const placed = (read: PagerRead) => ({ root: read.root, centred: Math.abs(read.barOffCentre) <= 0.5, spaces: read.spaces, offLine: read.offLine <= 0.5 });
            const rest = await readPager(entry);
            expect(rest.room, "the stage's room").toBeLessThan(360);
            expect({ form: rest.form, readout: rest.readout }).toEqual({ form: "readout", readout: "6 / 50" });
            expect(placed(rest)).toEqual({ root: [0, rest.room], centred: true, spaces: [4, 4], offLine: true });

            // Four siblings either side of the page: a strip wider than 360px.
            const more = entry.locator("[data-scope='number-input'][data-part='increment-trigger']").first();
            for (let i = 0; i < 3; i++) await more.click();
            await holdIn(page, entry, { width: "640px" });
            const wide = await readPager(entry);
            expect(wide.room, "the stage widened").toBeGreaterThanOrEqual(360);
            expect(wide.form).toBe("strip");
            expect(wide.next[0] + wide.next[2] - wide.prev[0], "the strip, prev to next").toBeGreaterThan(360);
            expect(placed(wide)).toEqual({ root: [0, wide.room], centred: true, spaces: [4, 4], offLine: true });

            await holdIn(page, entry, { width: "320px" });
            const narrow = await readPager(entry);
            expect(narrow.room, "the stage narrowed").toBeLessThan(360);
            expect({ form: narrow.form, readout: narrow.readout }).toEqual({ form: "readout", readout: "6 / 50" });
            expect(placed(narrow)).toEqual({ root: [0, narrow.room], centred: true, spaces: [4, 4], offLine: true });

            // A grid's track is as narrow as its item lets it be: there, too, the strip drawn never holds the root open.
            await holdIn(page, entry, { width: "640px", display: "grid", justifyContent: "normal" });
            const track = await readPager(entry);
            expect({ form: track.form, root: track.root }, "in a grid, widened").toEqual({ form: "strip", root: [0, track.room] });
            await holdIn(page, entry, { width: "320px" });
            const tight = await readPager(entry);
            expect({ form: tight.form, readout: tight.readout, root: tight.root }, "in a grid, narrowed")
                .toEqual({ form: "readout", readout: "6 / 50", root: [0, tight.room] });

            await holdIn(page, entry, { width: "", display: "", justifyContent: "" });
            const back = await readPager(entry);
            expect({ room: back.room, form: back.form }).toEqual({ room: rest.room, form: "readout" });
        });
    }
});
