/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * What the eye checks, measured. The geometry specs hold every rendered box to
 * the MODEL, so a model that is itself wrong to look at — two bands painting
 * the same edge a pixel apart, a column a sliver wide, a label too small to
 * read — passes them. These invariants hold the page to how it must LOOK
 * (`app_design_system/guidelines/component-rules.md`, the design review of
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
import { openExample, rowSel } from "./plan-page";
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
        /** An rgb / color(srgb) string's channels, 0–1. */
        const rgb = (c: string): [number, number, number] | undefined => {
            const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(c);
            if (m !== null) return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255];
            const s = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(c);
            return s !== null ? [Number(s[1]), Number(s[2]), Number(s[3])] : undefined;
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
            const k = contrast(cs(el).color, cs(cell).backgroundColor);
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
                const entry = await openExample(page, name, "collections/plan", theme);
                const at = await scanLines(entry);
                test.skip(at === undefined, "no bare row to read against");
                const read = { ruler: await paintedLines(page, at!.ruler), row: await paintedLines(page, at!.row) };
                // Something was read: a canvas's plot has at least its gutter edge.
                expect(read.row.length, "the row's lines").toBeGreaterThan(0);
                expect(read.ruler).toEqual(read.row);
            });

            test(`${name} (${theme}): what the eye checks — one gutter voice, legible labels, whole periods, token fills, aligned values`, async ({ page }) => {
                const entry = await openExample(page, name, "collections/plan", theme);
                expect(await violations(entry)).toEqual([]);
            });
        }

        test(`planNumberAxis (${theme}): the horizon is an overview with a lens, its steps counted once; the range reads inclusive; the footer says plain summaries`, async ({ page }) => {
            const entry = await openExample(page, "planNumberAxis", "collections/plan", theme);
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
            const entry = await openExample(page, "planSpanRows", "collections/plan", theme);
            await entry.locator(`${rowSel("detail", "L1-M09")} [data-plan-control="links"]`).click();
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
    "tableNumberFormats", "tableVariants", "tablePaginated", "tableExpandable", "tableReview",
];

/** A Table example's entry, at rest with its first header cell in view. */
async function openTable(page: Page, name: string): Promise<Locator> {
    await page.goto(`/#collections/table/${name}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#collections/table/${name}"]`) });
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
