/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Studio's visual tiles against their designed mocks, measured in a real
 * browser (#1671): each part as the spec draws it, on the showcase's page of
 * every form a visual draws — and, where a tile that cannot draw is read, two
 * such tiles the spec writes after the page's own (`./studio-visuals-page.ts`).
 *
 *  - T1 a tile's menu is a bare 24 × 24 icon button at the eyebrow's end: no
 *    border, no fill, its ellipsis 14px in the muted ink (TIL-2) — and it and
 *    the strip's words stand a whole number of pixels under the strip's top
 *    edge (#1638): the mock centres them in the 35px over the strip's rule, half
 *    a pixel off, which a page paints a row higher or lower by where it stands
 *    the tile;
 *  - T2 a list's row with the ranking bar is 63px with the rule under it —
 *    its name's line 16, its caption's 15 a pixel under, padded 10 — over a
 *    square 4px bar of its first value against the largest, and its words
 *    start a whole number of pixels under its top edge (LST-1, LST-2).
 *  - T3 a KPI is its mock (KPI-1, KPI-3): its number mono 26 / 600 at the
 *    body's top with its unit a small label 4px after it; its change a
 *    DeltaPill at the end of that row — 20 tall, no edge, on its valence's
 *    wash, a 10px caret; then its goal's square 6px bar with a 1 × 12 tick at
 *    its end, its trend 36 tall, and its annotation in mono 10 `--ink-4` —
 *    each 8px under the last. The annotation is one line where its tile
 *    holds it, and stands whole on a second where it does not (ruled 22
 *    November 2026): the page's revenue says what it is against, its goal
 *    and how far to it, with nothing cut.
 *  - T4 a chart is its mock (CHT-1 to CHT-7, TIL-5): a measure axis has three
 *    ticks — a scatter's x four — in short numbers with no sign of a currency,
 *    a gridline at each, and no title; a line draws no markers and a line or
 *    an area over dates runs the plot's whole width; a bar chart of one value
 *    says each at its bar's end, with no axis under them; a goal's label
 *    stands inside the plot over its rule; a scatter says what its axes are
 *    on a line over its plot; a pie's legend rows are 26 tall with 10 × 10
 *    swatches over a note, and a donut's total stands over its caption.
 *  - T5 a table is its mock (TBL-1 to TBL-5): its header has no fill and
 *    stands 36 over a `--rule`, each head its label alone — no pin, no sort
 *    button, no resize grip — and the sorted one in `--ink` beside a caret;
 *    its columns fill the tile and never scroll it sideways while they fit;
 *    its cells are padded 12, 20 at the tile's edges, its rows 36, its
 *    numerals mono 13 / 500; a summary's child rows start 44 in, its total
 *    row is on `--paper-2` in mono 13 / 600, and a value's goal is a small
 *    label after its header; the footer band is 37; a pivot's heads have
 *    no fill, its rows are 40 around 30px blocks of radius 4 — the mock's 39
 *    cannot centre a 30px block on whole pixels — its values mono 11 / 500
 *    and its row names mono 11 / 400, 20 from the tile's edge; its legend is
 *    padded 12 20 16 on no fill, a count's steps whole and its top closed.
 *  - T6 a tile that cannot draw says why, as its mock does (TIL-1, TIL-3):
 *    wells it needs — the view's icon at 28 in `--rule-strong`, "Add fields
 *    to draw it" in the heading face at 15 / 700, and a checklist of 16px
 *    lines 6 apart, what is chosen in `--ink` after a 14px `--pos` check and
 *    what is missing in `--ink-3` after a 10px `--ink-5` dot, under its
 *    source's name; a field its source lacks — a 14px `--neg` exclamation,
 *    the words, the field's name as code on `--paper-3` — under "needs a
 *    field"; and a drawn tile's meta says what it groups by, never its
 *    source's name.
 *
 * Every measurement is taken from the laid-out page, at rest.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test studio-tiles --project desktop`.
 */

import { expect } from "playwright/test";
import { boxWords } from "./box-words";
import { test } from "./kept-page";
import { openVisuals } from "./studio-visuals-page";

test.describe("Studio tiles, as designed (#1671)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "read once, at the desktop width");

    test("T1: a tile's menu is a bare 24 × 24 icon button — no border, no fill, a 14px ellipsis in the muted ink", async ({ page }) => {
        const grid = await openVisuals(page, "light", { cannotDraw: true });
        const menus = await grid.evaluate((root) => {
            const probe = document.createElement("span");
            probe.style.color = "var(--chakra-colors-fg-muted)";
            root.append(probe);
            const muted = getComputedStyle(probe).color;
            probe.remove();
            return [...root.querySelectorAll("[data-studio-visual-menu]")].map((menu) => {
                const look = getComputedStyle(menu);
                const box = menu.getBoundingClientRect();
                const icon = menu.querySelector("svg")!;
                const head = menu.closest("[data-studio-visual-head]")!.getBoundingClientRect();
                return JSON.stringify({
                    size: [box.width, box.height], border: look.borderTopWidth, fill: look.backgroundColor, radius: look.borderTopLeftRadius,
                    ink: look.color === muted, icon: [icon.getAttribute("data-icon"), Math.round(icon.getBoundingClientRect().height)],
                    // At the strip's end, 20 in; 6 under its top edge, to the 64th of a pixel the page lays out in.
                    end: Math.round(head.right - box.right), above: Math.round((box.top - head.top) * 64) / 64,
                });
            });
        });
        expect(menus.length).toBeGreaterThan(0);
        expect([...new Set(menus)]).toEqual([JSON.stringify({
            size: [24, 24], border: "0px", fill: "rgba(0, 0, 0, 0)", radius: "6px", ink: true, icon: ["ellipsis", 14], end: 20, above: 6,
        })]);
        // The strip's words — its name and its meta — by the rule the small boxes hold, read over the strip's own 36px.
        const heads = grid.locator("[data-studio-visual-head]");
        const count = await heads.count();
        expect(count).toBeGreaterThan(0);
        let held = 0;
        for (let i = 0; i < count; i++) {
            const found = await heads.nth(i).evaluate(boxWords, 36);
            held += found.held;
            expect(found.faults, "words that start at a fraction of a pixel under the strip's top edge").toEqual([]);
        }
        expect(held).toBeGreaterThan(0);
    });

    test("T2: a list row with the ranking bar is 63px — lines of 16 and 15, padded 10 — over a square 4px bar", async ({ page }) => {
        const grid = await openVisuals(page, "light");
        const rows = await grid.evaluate((root) => [...root.querySelectorAll("[data-studio-list-row][data-bar]")].slice(0, 2).map((row) => {
            const bar = row.querySelector("[data-studio-list-bar]")!;
            const fill = bar.firstElementChild!;
            const look = getComputedStyle(row);
            const top = row.getBoundingClientRect().top;
            const under = (part: string) => row.querySelector(part)!.getBoundingClientRect().top - top;
            return {
                // Each row with the rule under it; the last has none.
                height: Math.round(row.getBoundingClientRect().height),
                // How far under the row's top edge its name and its caption start: whole pixels, to the 64th the page lays out in.
                words: [under("[data-studio-list-name]"), under("[data-studio-list-caption]")],
                pad: [look.paddingTop, look.paddingInlineStart],
                name: Math.round(row.querySelector("[data-studio-list-name]")!.getBoundingClientRect().height),
                caption: Math.round(row.querySelector("[data-studio-list-caption]")!.getBoundingClientRect().height),
                bar: [Math.round(bar.getBoundingClientRect().height), getComputedStyle(bar).borderTopLeftRadius],
                fill: [Math.round(fill.getBoundingClientRect().height), getComputedStyle(fill).borderTopLeftRadius, fill.getBoundingClientRect().width > 0],
            };
        }));
        expect(rows.length).toBe(2);
        for (const row of rows) {
            expect(row).toEqual({ height: 63, words: [10, 27], pad: ["10px", "20px"], name: 16, caption: 15, bar: [4, "0px"], fill: [4, "0px", true] });
        }
    });

    test("T3: a KPI is its number and unit, its change a pill at the row's end, its goal bar, its trend and its annotation, 8 apart — the annotation whole, on a second line where one cannot hold it", async ({ page }) => {
        const grid = await openVisuals(page, "light");
        // The KPI that draws every part: a goal, a change and a trend.
        const kpi = grid.locator("[data-studio-kpi]", { has: page.locator("[data-studio-kpi-goal]") }).filter({ has: page.locator("[data-studio-kpi-change]") }).first();
        await expect(kpi.locator("[data-studio-kpi-trend] svg path").first()).toBeVisible();
        const read = await kpi.evaluate((root) => {
            const probe = (color: string) => { const el = document.createElement("span"); el.style.color = color; root.append(el); const out = getComputedStyle(el).color; el.remove(); return out; };
            const subtle = probe("var(--chakra-colors-fg-subtle)");
            const box = (el: Element) => el.getBoundingClientRect();
            const body = root.closest("[data-studio-visual-body]")!;
            const number = root.querySelector("[data-studio-kpi-value]")!;
            const unit = root.querySelector("[data-studio-kpi-unit]")!;
            const row = number.parentElement!.parentElement!;
            const pill = root.querySelector("[data-studio-kpi-change]")!.firstElementChild!;
            const goal = root.querySelector("[data-studio-kpi-goal]")!;
            const track = goal.querySelector("[data-part=track]") ?? goal.firstElementChild!.firstElementChild!;
            const tick = root.querySelector("[data-studio-kpi-goal-tick]")!;
            const trend = root.querySelector("[data-studio-kpi-trend]")!;
            const note = root.querySelector("[data-studio-kpi-note]")!;
            const type = (el: Element) => { const s = getComputedStyle(el); return [s.fontFamily.includes("Mono"), s.fontSize, s.fontWeight]; };
            const pillLook = getComputedStyle(pill);
            return {
                // At the body's top, inside its 20px of padding.
                top: Math.round((box(row).top - box(body).top) * 64) / 64,
                number: [...type(number), getComputedStyle(number).lineHeight],
                unit: [...type(unit), getComputedStyle(unit).color === subtle, Math.round(box(unit).left - box(number).right)],
                pill: {
                    atEnd: Math.round(box(row).right - box(pill).right), height: box(pill).height, type: type(pill),
                    edge: pillLook.borderTopColor, washed: pillLook.backgroundColor !== "rgba(0, 0, 0, 0)",
                    icon: Math.round(box(pill.querySelector("svg")!).height),
                },
                goal: { height: box(track).height, radius: getComputedStyle(track).borderTopLeftRadius, tick: [box(tick).width, box(tick).height, Math.round(box(track).right - box(tick).right), box(tick).top - box(track).top] },
                trend: box(trend).height,
                note: [...type(note), getComputedStyle(note).color === subtle],
                // Too long for one line of its tile, it stands on two, each 15: nothing of it past its box either way.
                noteWhole: [(note.textContent ?? "").split(" · ").length, Math.round(box(note).height), note.scrollWidth <= note.clientWidth, note.scrollHeight <= note.clientHeight],
                // Each part 8px under the last: the row, the bar, the trend, the annotation.
                gaps: [box(track).top - box(row).bottom, box(trend).top - box(track).bottom, box(note).top - box(trend).bottom].map((gap) => Math.round(gap * 64) / 64),
                // Nothing else says anything: the number, the unit, the pill and the one line.
                words: [...root.querySelectorAll("*")].filter((el) => el.children.length === 0 && (el.textContent ?? "").trim() !== "" && el.closest("svg") === null).length,
            };
        });
        expect(read).toEqual({
            top: 20,
            number: [true, "26px", "600", "26px"],
            unit: [true, "10.5px", "400", true, 4],
            pill: { atEnd: 0, height: 20, type: [true, "10.5px", "600"], edge: "rgba(0, 0, 0, 0)", washed: true, icon: 10 },
            goal: { height: 6, radius: "0px", tick: [1, 12, 0, -3] },
            trend: 36,
            note: [true, "10px", "400", true],
            // What its change is against, its trend's bucket, its goal and how far to it: four parts, on two lines.
            noteWhole: [4, 30, true, true],
            gaps: [8, 8, 8],
            words: 4,
        });
    });

    test("T4: a chart is its mock — three short ticks with a gridline each and no titles, lines edge to edge with no markers, values at bar ends, a pie's rows over its note", async ({ page }) => {
        const grid = await openVisuals(page, "light");
        const read = await grid.evaluate((root) => {
            const chart = (kind: string) => root.querySelector(`[data-studio-chart="${kind}"]`);
            const texts = (el: Element | null, selector: string) => (el === null ? [] : [...el.querySelectorAll(selector)].map((t) => (t.textContent ?? "").trim()));
            const out: Record<string, unknown> = {};
            // Every chart with a measure axis: how many ticks it labels, whether any carries a currency's sign or a
            // title is drawn, and whether a gridline stands at each tick.
            for (const kind of ["column", "line", "area", "combo", "scatter"]) {
                const el = chart(kind);
                if (el === null) { out[kind] = "missing"; continue; }
                const left = texts(el, ".visx-axis-left .visx-axis-tick text");
                const right = texts(el, ".visx-axis-right .visx-axis-tick text");
                const rows = el.querySelectorAll(".visx-rows line").length;
                // A title is a text of the plot that is no tick, no rule's label and no mark's label.
                const titles = [...el.querySelectorAll("svg > g > text")].filter((t) => !t.hasAttribute("data-chart-rule-label")).length;
                out[kind] = {
                    ticks: [left.length, right.length], rows, titles,
                    signed: [...left, ...right].some((label) => /[$€£¥]|A\$/.test(label)),
                    long: [...left, ...right].some((label) => label.length > 6),
                };
            }
            // A scatter's x has four ticks, and its axes are said on a line over its plot.
            const scatter = chart("scatter");
            out.scatterX = texts(scatter, ".visx-axis-bottom .visx-axis-tick text").length;
            out.scatterCaption = scatter?.querySelector("[data-studio-chart-caption]") !== null;
            // A line and an area: no markers, and the mark runs the plot's whole width.
            for (const kind of ["line", "area"]) {
                const el = chart(kind);
                const plot = el?.querySelector("clipPath rect");
                const path = el?.querySelector("path.visx-linepath") as SVGPathElement | null;
                if (el === null || plot === null || plot === undefined || path === null) { out[`${kind}Edge`] = "missing"; continue; }
                const box = path.getBBox();
                out[`${kind}Edge`] = { circles: el.querySelectorAll("circle").length, from: Math.round(box.x), to: Math.round(box.x + box.width) === Math.round(Number(plot.getAttribute("width"))) };
            }
            // A bar chart of one value: no axis under it, no grid, and a value after each bar's end.
            const bar = chart("bar");
            if (bar !== null) {
                const bars = [...bar.querySelectorAll("rect.visx-bar")].map((b) => b.getBoundingClientRect());
                const ends = [...bar.querySelectorAll("svg > g > text")].map((t) => t.getBoundingClientRect());
                out.bar = {
                    bottomAxis: bar.querySelectorAll(".visx-axis-bottom").length, grid: bar.querySelectorAll(".visx-columns line, .visx-rows line").length,
                    ends: ends.length === bars.length && ends.every((end, i) => Math.round(end.left - bars[i]!.right) === 6),
                    inside: ends.every((end) => end.right <= bar.getBoundingClientRect().right),
                };
            }
            // A goal's label rides its rule: inside the plot, over the line.
            const goal = root.querySelector("text[data-chart-rule-label]");
            out.goal = goal === null ? "missing" : /^goal /.test(goal.textContent ?? "");
            // A pie: rows 26 tall, 10 × 10 swatches, a note under them or a donut's caption under its total.
            const pie = chart("pie");
            if (pie !== null) {
                const rows = [...pie.querySelectorAll("[data-chart-slice-entry]")];
                const swatch = rows[0]?.firstElementChild?.getBoundingClientRect();
                out.pie = {
                    rows: [...new Set(rows.map((row) => row.getBoundingClientRect().height))],
                    swatch: swatch === undefined ? [] : [swatch.width, swatch.height],
                    said: pie.querySelector("[data-chart-pie-note], [data-chart-pie-caption]") !== null,
                };
            }
            return out;
        });
        const axis = (right: number, rows = 3) => ({ ticks: [3, right], rows, titles: 0, signed: false, long: false });
        expect(read).toEqual({
            column: axis(0), line: axis(0), area: axis(0), combo: axis(3), scatter: axis(0),
            scatterX: 4, scatterCaption: true,
            lineEdge: { circles: 0, from: 0, to: true }, areaEdge: { circles: 0, from: 0, to: true },
            bar: { bottomAxis: 0, grid: 0, ends: true, inside: true },
            goal: true,
            pie: { rows: [26], swatch: [10, 10], said: true },
        });
    });

    test("T5: a table is its mock — a plain header over a rule, columns that fill the tile, cells padded 12 and 20, rows 36, a summary's indent, total row and goal label, a 37 footer, a whole heat legend", async ({ page }) => {
        const grid = await openVisuals(page, "light");
        const read = await grid.evaluate((root) => {
            const themed = (property: "color" | "backgroundColor" | "fontFamily", token: string) => {
                const probe = document.createElement("span");
                probe.style[property] = `var(${token})`;
                root.append(probe);
                const value = getComputedStyle(probe)[property];
                probe.remove();
                return value;
            };
            const rule = themed("color", "--chakra-colors-border-subtle");
            const ink = themed("color", "--chakra-colors-fg");
            const paper2 = themed("backgroundColor", "--chakra-colors-bg-canvas");
            const mono = themed("fontFamily", "--chakra-fonts-mono");
            const px = (value: string) => Math.round(Number.parseFloat(value) * 10) / 10;
            const out: Record<string, unknown> = {};
            for (const kind of ["records", "summary"]) {
                const tile = root.querySelector(`[data-studio-${kind}]`);
                const scroller = tile?.querySelector("table")?.parentElement;
                if (tile === null || tile === undefined || scroller === null || scroller === undefined) { out[kind] = "missing"; continue; }
                const heads = [...tile.querySelectorAll("thead th")];
                const buttons = heads.map((th) => th.querySelector("button"));
                const rows = [...tile.querySelectorAll("tbody tr")];
                const numeral = tile.querySelector("tbody tr:not([data-row-head]) [data-numeric]");
                const numeralLook = numeral === null ? undefined : getComputedStyle(numeral);
                const edge = tile.getBoundingClientRect();
                out[kind] = {
                    // The header: no fill, 36 over a `--rule`, its label alone.
                    headFill: [...new Set(heads.map((th) => getComputedStyle(th).backgroundColor))],
                    headRule: [...new Set(heads.map((th) => `${getComputedStyle(th).borderBottomWidth} ${getComputedStyle(th).borderBottomColor}`))].map((r) => r === `1px ${rule}`),
                    headHeight: [...new Set(heads.map((th) => th.getBoundingClientRect().height))],
                    controls: tile.querySelectorAll("thead [data-control], thead [data-slot=columnResizer]").length,
                    // Padded 12, 20 at the tile's edges.
                    headPad: buttons.map((b) => (b === null ? "" : `${px(getComputedStyle(b).paddingLeft)} ${px(getComputedStyle(b).paddingRight)}`)),
                    cellPad: rows[1] === undefined ? [] : [...rows[1].querySelectorAll("td")].map((td) => `${px(getComputedStyle(td).paddingLeft)} ${px(getComputedStyle(td).paddingRight)}`),
                    rowHeights: [...new Set(rows.map((tr) => tr.getBoundingClientRect().height))],
                    numeral: numeralLook === undefined ? "missing" : [numeralLook.fontFamily === mono, numeralLook.fontSize, numeralLook.fontWeight],
                    // The columns fill the tile, and scroll it sideways only when they need more than it has.
                    fills: Math.round(heads.reduce((sum, th) => sum + th.getBoundingClientRect().width, 0)) === scroller.clientWidth,
                    sideways: scroller.scrollWidth > scroller.clientWidth,
                    reachesEdge: Math.round(scroller.getBoundingClientRect().left - edge.left) === 0,
                };
            }
            // The records' sorted column: its label in the ink, beside a caret.
            const sorted = root.querySelector("[data-studio-records] thead button[data-sorted]");
            out.sorted = sorted === null ? "missing" : [getComputedStyle(sorted).color === ink, sorted.querySelectorAll("svg").length];
            // The summary: a child row's label 44 from the tile's edge, the total row, and the goal's own label.
            const summary = root.querySelector("[data-studio-summary]");
            if (summary !== null) {
                const child = summary.querySelector("tbody tr[data-depth='1'] td [data-numeric], tbody tr[data-depth='1'] td p");
                const label = summary.querySelector("tbody tr[data-depth='1'] td p");
                const total = summary.querySelector("tfoot tr[data-table-total] td");
                const totalLook = total === null ? undefined : getComputedStyle(total);
                const toggle = summary.querySelector("tbody tr[data-row-head] [data-slot=treeToggle] svg");
                out.summary2 = {
                    childIndent: label === null || child === null ? "missing" : Math.round(label.getBoundingClientRect().left - summary.getBoundingClientRect().left),
                    total: totalLook === undefined ? "missing" : [totalLook.backgroundColor === paper2, totalLook.fontFamily === mono, totalLook.fontWeight, total!.getBoundingClientRect().height],
                    chevron: toggle === null ? "missing" : toggle.getAttribute("data-icon"),
                    note: /^goal /.test(summary.querySelector("thead [data-table-head-note]")?.textContent ?? ""),
                };
            }
            // The footer band, and the pivot's legend.
            const foot = root.querySelector("[data-studio-records]")?.lastElementChild;
            out.foot = foot === null || foot === undefined ? "missing" : foot.getBoundingClientRect().height;
            // The pivot's grid: heads on no fill over a `--rule`, unruled rows around their blocks.
            const pivot = root.querySelector("[data-studio-pivot]");
            if (pivot !== null) {
                const headCells = [...pivot.querySelectorAll("[data-slot=headerCell], [data-slot=colHeader]")];
                const bar = pivot.querySelector("[data-slot=bar]");
                const value = pivot.querySelector("[data-slot=seg]:not([data-fill=free])");
                const valueLook = value === null ? undefined : getComputedStyle(value);
                const name = pivot.querySelector("[data-slot=rowHeaderName]");
                const nameLook = name === null ? undefined : getComputedStyle(name);
                out.pivot = {
                    headFill: [...new Set(headCells.map((h) => getComputedStyle(h).backgroundColor))],
                    headRule: [...new Set(headCells.map((h) => `${getComputedStyle(h).borderBottomWidth} ${getComputedStyle(h).borderBottomColor}` === `1px ${rule}`))],
                    rows: [...new Set([...pivot.querySelectorAll("[data-row-key]")].map((r) => r.getBoundingClientRect().height))],
                    block: bar === null ? "missing" : [bar.getBoundingClientRect().height, getComputedStyle(bar).borderTopLeftRadius],
                    value: valueLook === undefined ? "missing" : [valueLook.fontFamily === mono, valueLook.fontSize, valueLook.fontWeight],
                    name: name === null || nameLook === undefined ? "missing" : [nameLook.fontSize, nameLook.fontWeight, Math.round(name.getBoundingClientRect().left - pivot.getBoundingClientRect().left)],
                };
            }
            const heat = root.querySelector("[data-studio-heat]");
            if (heat !== null) {
                const look = getComputedStyle(heat);
                const ticks = [...heat.querySelectorAll("[aria-hidden] span")].map((t) => t.textContent ?? "");
                out.heat = {
                    pad: look.padding, fill: look.backgroundColor, rule: `${look.borderTopWidth} ${look.borderTopColor}` === `1px ${rule}`,
                    whole: ticks.slice(0, -1).every((t) => /^[0-9]+$/.test(t)), closed: /^≥[0-9]+$/.test(ticks[ticks.length - 1] ?? ""), steps: ticks.length,
                    height: heat.getBoundingClientRect().height,
                };
            }
            return out;
        });
        const table = (pads: string[]) => ({
            headFill: ["rgba(0, 0, 0, 0)"], headRule: [true], headHeight: [36], controls: 0,
            headPad: pads, cellPad: pads, rowHeights: [36], numeral: [true, "13px", "500"],
            fills: true, sideways: false, reachesEdge: true,
        });
        expect(read).toEqual({
            records: table(["20 12", "12 12", "12 12", "12 12", "12 12", "12 20"]),
            summary: table(["20 12", "12 12", "12 20"]),
            sorted: [true, 1],
            summary2: { childIndent: 44, total: [true, true, "600", 36], chevron: "chevron-down", note: true },
            foot: 37,
            pivot: { headFill: ["rgba(0, 0, 0, 0)"], headRule: [true], rows: [40], block: [30, "4px"], value: [true, "11px", "500"], name: ["11px", "400", 20] },
            heat: { pad: "12px 20px 16px", fill: "rgba(0, 0, 0, 0)", rule: true, whole: true, closed: true, steps: 5, height: 58 },
        });
    });

    test("T6: a tile that cannot draw says why as its mock does — the checklist of the wells it needs, a field its source lacks — and a drawn tile's meta says what it groups by", async ({ page }) => {
        const grid = await openVisuals(page, "light", { cannotDraw: true });
        const read = await grid.evaluate((root) => {
            const themed = (property: "color" | "backgroundColor" | "fontFamily", token: string) => {
                const probe = document.createElement("span");
                probe.style[property] = `var(${token})`;
                root.append(probe);
                const value = getComputedStyle(probe)[property];
                probe.remove();
                return value;
            };
            const tone = (value: string) => ({
                [themed("color", "--chakra-colors-fg")]: "ink", [themed("color", "--chakra-colors-fg-muted")]: "ink-3", [themed("color", "--chakra-colors-fg-faint")]: "ink-5",
                [themed("color", "--chakra-colors-border-strong")]: "rule-strong", [themed("color", "--chakra-colors-status-pos")]: "pos", [themed("color", "--chakra-colors-status-neg")]: "neg",
                [themed("color", "--chakra-colors-bg-subtle")]: "paper-3",
            }[value] ?? value);
            const tileOf = (state: Element) => state.closest("[data-studio-visual-tile]")!;
            const metaOf = (state: Element) => tileOf(state).querySelector("[data-studio-visual-meta]")?.textContent;
            const box = (el: Element) => el.getBoundingClientRect();
            const out: Record<string, unknown> = {};
            const empty = root.querySelector("[data-studio-visual=empty]");
            if (empty !== null) {
                const head = tileOf(empty).querySelector("[data-studio-visual-head]")!;
                const icon = empty.querySelector("svg")!;
                const title = empty.querySelector("h4")!;
                const items = [...empty.querySelectorAll("li")];
                const titleLook = getComputedStyle(title);
                out.empty = {
                    meta: metaOf(empty),
                    // 32 under the eyebrow strip; its parts 12 apart, centred.
                    iconTop: Math.round(box(icon).top - box(head).bottom),
                    icon: [box(icon).width, box(icon).height, tone(getComputedStyle(icon.parentElement!).color)],
                    gaps: [Math.round(box(title).top - box(icon).bottom), Math.round(box(items[0]!).top - box(title).bottom)],
                    centred: Math.abs((box(icon).left + box(icon).right) / 2 - (box(empty).left + box(empty).right) / 2) <= 0.5,
                    title: [titleLook.fontFamily === themed("fontFamily", "--chakra-fonts-heading"), titleLook.fontSize, titleLook.fontWeight, box(title).height],
                    // The checklist: 16px lines, 6 apart; each mark in its own colour and size.
                    lines: items.map((li) => box(li).height),
                    pitch: items.slice(1).map((li, i) => Math.round(box(li).top - box(items[i]!).bottom)),
                    marks: items.map((li) => {
                        const mark = li.querySelector("svg")!;
                        return [li.hasAttribute("data-done"), mark.getAttribute("data-icon"), box(mark).height, tone(getComputedStyle(mark.parentElement!).color), tone(getComputedStyle(li).color), getComputedStyle(li).fontSize];
                    }),
                };
            }
            const missing = root.querySelector("[data-studio-visual=missing]");
            if (missing !== null) {
                const line = missing.querySelector("code")!.closest("div")!;
                const icon = missing.querySelector("svg")!;
                const code = missing.querySelector("code")!;
                const codeLook = getComputedStyle(code);
                out.missing = {
                    meta: metaOf(missing), text: missing.textContent,
                    line: [box(line).height, getComputedStyle(line).fontSize, tone(getComputedStyle(line).color)],
                    icon: [icon.getAttribute("data-icon"), box(icon).height, tone(getComputedStyle(icon.parentElement!).color)],
                    gap: Math.round(box(icon.parentElement!.nextElementSibling!).left - box(icon.parentElement!).right),
                    code: [codeLook.fontFamily === themed("fontFamily", "--chakra-fonts-mono"), tone(codeLook.backgroundColor), codeLook.borderTopLeftRadius, codeLook.padding],
                    link: missing.querySelectorAll("button, a").length,
                };
            }
            // A drawn tile's meta: what it groups by and its unit; a KPI's and a records table's say nothing.
            out.metas = [...root.querySelectorAll("[data-studio-visual-tile]")].map((tile) => tile.querySelector("[data-studio-visual-meta]")?.textContent);
            return out;
        });
        expect(read).toEqual({
            empty: {
                meta: "Orders", iconTop: 32, icon: [28, 28, "rule-strong"], gaps: [12, 12], centred: true, title: [true, "15px", "700", 20],
                lines: [16, 16], pitch: [6],
                marks: [[true, "circle-check", 14, "pos", "ink", "13px"], [false, "circle", 10, "ink-5", "ink-3", "13px"]],
            },
            missing: {
                meta: "needs a field", text: "Orders has no field net_revenue",
                line: [16, "13px", "ink"], icon: ["circle-exclamation", 14, "neg"], gap: 8, code: [true, "paper-3", "4px", "1px 5px"], link: 0,
            },
            metas: [
                "", "", "AUD", "by month · AUD", "by customer · AUD", "by week", "by month · AUD", "", "by region", "AUD",
                "", "by region · month", "", "Orders", "needs a field",
            ],
        });
    });
});
