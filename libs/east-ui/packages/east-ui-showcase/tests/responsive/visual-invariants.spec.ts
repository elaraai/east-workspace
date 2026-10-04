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
import { PLAN_EXAMPLES, openExample, rowSel } from "./plan-page";
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
const RULED = [
    "planTargetState", "planSpanRows", "planBucketRows", "planChartRows", "planHeatRows", "planTableRows",
    "planFold", "planCardRows", "planEventRows", "planGroupedRows", "planSeriesData", "planLiteralRows", "planPick",
    "planLibraryDnd", "planRowDrop", "planFill", "planReview", "planEditing", "planUiState", "planExpand",
    "planNumberAxis", "planOrdinalAxis",
];

/** The row kinds whose plot is bare along its bottom edge — nothing but the
 *  bucket lines, the now line and the gutter's edge crosses it there. */
const BARE_KINDS = ["span", "events", "table", "cards"];

/**
 * The ruler's scan line and a bare body row's, across the plot and the
 * gutter's edge — 3px above each band's bottom rule, clear of every label and
 * mark.
 */
async function scanLines(entry: Locator): Promise<{ ruler: Box; row: Box } | undefined> {
    return entry.evaluate((root, kinds) => {
        const body = root.querySelector("[data-plan-body]")!;
        const ruler = body.querySelector("[data-slot='ruler']")!;
        const track = ruler.children[1]!.getBoundingClientRect();
        const rowEl = kinds.map((k) => body.querySelector(`[data-plan-row][data-plan-kind='${k}']`)).find((el) => el !== null);
        if (rowEl === undefined || rowEl === null) return undefined;
        const plot = rowEl.querySelector("[data-plan-plot]")!.getBoundingClientRect();
        const r = ruler.getBoundingClientRect();
        const row = rowEl.getBoundingClientRect();
        // From just inside the gutter, so the gutter's edge is read too.
        const x = plot.left - 3;
        const width = plot.right - x;
        return { ruler: { x, y: r.bottom - 3, width }, row: { x: Math.max(x, track.left - 3), y: row.bottom - 3, width } };
    }, BARE_KINDS);
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
        // ── 8 · Nothing pill-shaped in the toolbar ──
        const bar = body.querySelector("[data-slot='toolbar']");
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
            // of indent is the caret and its gap, so a tree steps in by it.
            const first = rows[gi + 1]!;
            const gl = g.querySelector("[data-plan-gutter='label']")?.getBoundingClientRect().left;
            const ml = first.querySelector("[data-plan-gutter='name']")?.firstElementChild?.getBoundingClientRect().left;
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
        const heat = body.querySelector("[data-plan-row][data-plan-kind='heat']");
        const span = body.querySelector("[data-plan-row][data-plan-kind='span']");
        if (heat !== null && span !== null && !span.hasAttribute("data-expanded")) {
            const hh = heat.getBoundingClientRect().height;
            const sh = span.getBoundingClientRect().height;
            if (Math.abs(hh - sh) > 0.5 && Number(span.getAttribute("data-plan-h")) === 32) bad.push(`heat row ${hh}px beside a ${sh}px row`);
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
                const at = await scanLines(entry);
                test.skip(at === undefined, "no bare row to read against");
                const read = { ruler: await paintedLines(page, at!.ruler), row: await paintedLines(page, at!.row) };
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
                const range = body.querySelector("[data-slice-range-label]");
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
                        addFilter: count("[data-slot='toolbar'] [data-slice-add='filter']"),
                    },
                    lens: lr === undefined ? null : { left: Math.round(lr.left - plot.left), width: Math.round(lr.width - plot.width) },
                    barsEven: bars.length > 0 && bars.every((h) => h === bars[0]),
                    range: range?.textContent ?? null,
                    rangeType: rs === undefined ? null : { size: Number.parseFloat(rs.fontSize), mono: /mono/i.test(rs.fontFamily) },
                    footer: [...body.querySelectorAll("[data-slot='footer'] > :not([data-slot='footerTransport'])")].map((el) => (el as HTMLElement).innerText),
                    summary: (body.querySelector("[data-slot='toolbarSummary']") as HTMLElement | null)?.innerText ?? null,
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

        test(`planSpanRows (${theme}): a links focus paints in the theme's brand — its bands, their heads and the off-window fade`, async ({ page }) => {
            const entry = await openExample(page, "planSpanRows", PLAN_EXAMPLES, theme);
            await entry.locator(`${rowSel("detail", "H1-P09")} [data-plan-control="links"]`).click();
            await expect(entry.locator('[data-plan-linkfade="right"]')).toHaveCount(1);
            const read = await entry.evaluate((root) => {
                const probe = document.createElement("div");
                probe.style.color = "var(--chakra-colors-brand-solid)";
                root.appendChild(probe);
                const brand = getComputedStyle(probe).color;
                probe.remove();
                const fade = root.querySelector('[data-plan-linkfade="right"]')!;
                const id = /url\(#(.*)\)/u.exec(fade.getAttribute("fill") ?? "")?.[1] ?? "";
                const stops = [...root.querySelectorAll(`[id="${id}"] stop`)].map((s) => {
                    const cs = getComputedStyle(s);
                    return { color: cs.stopColor, opacity: cs.stopOpacity };
                });
                return {
                    brand,
                    band: getComputedStyle(root.querySelector("[data-plan-ribbon-band]")!).stroke,
                    head: getComputedStyle(root.querySelector("[data-plan-ribbon-head]")!).fill,
                    stops,
                };
            });
            expect(read.band).toBe(read.brand);
            expect(read.head).toBe(read.brand);
            // Clear inside the window, strongest at its edge — in the brand.
            expect(read.stops).toEqual([{ color: read.brand, opacity: "0" }, { color: read.brand, opacity: "0.3" }]);
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
 * host's own range: the Plan's wide layout holds down to 850px (below it the
 * showcase's column is under its narrow breakpoint), its resolution folding
 * into its menu under 900; its narrow layout is `planNarrow`'s phone-width box.
 */
const TOOLBAR_HOSTS: ReadonlyArray<{ name: string; route: string; widths: readonly number[]; nudge: readonly number[]; rail?: readonly string[]; ladder?: Ladder }> = [
    { name: "Plan", route: `${PLAN_EXAMPLES}/planTargetState`, widths: [1600, 1500, 1400, 1300, 1200, 1100, 1000, 900, 870], nudge: [1500, 1400, 1000], rail: ["cluster", "range"], ladder: () => PLAN_LADDER },
    { name: "Plan (narrow)", route: `${PLAN_EXAMPLES}/planNarrow`, widths: [1600, 1200, 900], nudge: [1200] },
    { name: "Sheet", route: "collections/sheet/sheetLens", widths: [1600, 1400, 1200, 1000, 900, 800, 700, 600], nudge: [1400, 1000, 800], rail: ["rail"], ladder: sheetLadder },
    { name: "Table", route: "slice/slice/sliceTableChrome", widths: [1600, 1200, 1000, 800, 700, 600], nudge: [1000, 700] },
    { name: "chart", route: "slice/slice/sliceChartChrome", widths: [1600, 1200, 900, 700, 600], nudge: [900] },
    { name: "Slice.Rail", route: "slice/slice/sliceRail", widths: [1600, 1200, 900, 700, 600], nudge: [900] },
    { name: "Deck", route: "collections/deck/deckSlice", widths: [1600, 1200, 900, 700, 600], nudge: [900] },
    { name: "Library", route: "collections/library/libraryLarge", widths: [1600, 1200, 900, 700, 600], nudge: [900], rail: ["rail"], ladder: () => LIBRARY_LADDER },
    { name: "Library (gallery)", route: "collections/library/libraryGalleryReports", widths: [1600, 1200, 900, 700, 600], nudge: [900], ladder: () => LIBRARY_LADDER },
    { name: "Flowchart", route: "collections/flowchart/flowchartPlant", widths: [1600, 1200, 900, 700, 600], nudge: [900] },
    { name: "Schematic", route: "collections/schematic/schematicSlice", widths: [1600, 1200, 900, 700, 600], nudge: [900] },
];

/** What the toolbar says it folded: each item's form of its forms (`data-toolbar-state`). */
type ToolbarState = ReadonlyMap<string, { form: number; forms: number }>;

/** A host's own fold steps after its rail, in order — `[item, form]`, applied once the item is at that form. */
type Ladder = (state: ToolbarState) => ReadonlyArray<readonly [string, number]>;

/** The Plan's own order (the user's decision, #952): the summary shortens to
 *  its count, the resolution then the grain segment fold into their menus,
 *  and last the summary hides. */
const PLAN_LADDER: ReadonlyArray<readonly [string, number]> = [["summary", 1], ["resolution", 1], ["grain", 1], ["summary", 2]];

/** The Library's own order: the caption goes, the secondary facts and the
 *  filter fold to their icons, then the grouping does, and last the search
 *  box narrows and drops its key cap. */
const LIBRARY_LADDER: ReadonlyArray<readonly [string, number]> = [["hint", 1], ["dims", 1], ["filter", 1], ["group", 1], ["search", 1], ["search", 2]];

/** The Sheet's own order (§6.3): the tabs fold into `+n` one by one, then the
 *  count goes, the context label, the strip's `+ TAB` label and whole-sheet
 *  count, its names cap, and last it closes up and the context switch goes. */
function sheetLadder(state: ToolbarState): ReadonlyArray<readonly [string, number]> {
    const tabs = state.get("tabs");
    const maxFold = tabs === undefined ? 0 : tabs.forms - 4;
    return [
        ...Array.from({ length: maxFold }, (_x, k) => ["tabs", k + 1] as const),
        ["count", 1], ["context", 1], ["tabs", maxFold + 1], ["tabs", maxFold + 2], ["tabs", maxFold + 3], ["context", 2],
    ];
}

/** The first toolbar in an example: the shared toolbar's row, or (before it) a host's own band. */
const TOOLBAR = "[data-toolbar], [data-slot='toolbar'], [data-slot='narrowChips'], [data-flowchart-eyebrow]";

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

/** A catalog example's entry, its toolbar in view. */
async function openToolbarHost(page: Page, route: string, width: number): Promise<Locator> {
    await installToolbarProbe(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/#${route}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${route}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator(TOOLBAR).first()).toBeVisible({ timeout: 20_000 });
    await settled(page);
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
 * that frame will paint, the toolbar having answered the width. A frame begun
 * while a resize is still to be delivered (its row not at the width last
 * delivered) paints only after the toolbar has answered, so that sample is
 * dropped.
 */
async function startPainting(entry: Locator): Promise<void> {
    await entry.evaluate((root) => {
        const w = window as unknown as ToolbarWindow;
        const take = (): Painted => ({ row: w.__toolbarRow(root), sig: w.__toolbarSig(root) });
        let delivered = Number.NaN;
        w.__painted = [];
        w.__paintObserver = new ResizeObserver(() => {
            const s = take();
            delivered = s.row;
            w.__painted.push(s);
        });
        const row = root.querySelector("[data-toolbar]");
        if (row !== null) w.__paintObserver.observe(row);
        const tick = () => {
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
            const entry = await openToolbarHost(page, host.route, host.nudge[0]!);
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
            const entry = await openToolbarHost(page, host.route, host.widths[0]!);
            const byWidth = new Map<number, string>();
            const bad = new Set<string>();
            const down = [...host.widths];
            const up = [...host.widths].reverse();
            // Down, up, and across — each width reached from both sides and from far away.
            const order = [...down, ...up, down[down.length - 1]!, down[0]!, down[Math.floor(down.length / 2)]!];
            const folds: { row: number; folds: number }[] = [];
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
                folds.push({ row: read.row, folds: read.folds });
                // What it folded is a prefix of its ladder: each item at the form
                // the ladder's first `folds` steps put it.
                const state = parseState(read.state);
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
            // Monotone: a narrower row never folds less than a wider one.
            const sorted = [...folds].sort((a, b) => b.row - a.row);
            sorted.forEach((f, i) => {
                const wider = sorted[i - 1];
                if (wider !== undefined && wider.row > f.row + 0.5 && f.folds < wider.folds) {
                    bad.add(`a ${f.row.toFixed(0)}px row folds ${f.folds} steps, fewer than the ${wider.row.toFixed(0)}px row's ${wider.folds}`);
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
