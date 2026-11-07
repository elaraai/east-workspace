/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Record's grid (`Record - DX Proposal.md` GR2–GR4, HD1–HD4, SL1,
 * ST1–ST9, FT1, FT2), measured in the page in both themes and, where the rows'
 * density moves it, at each of the three. The looks example's rota (Example
 * 6), its density stepped through the example's own control: each column's
 * cells and header padded and set as its kind is, the column groups' row over
 * them, the select column and its ticks, and the footer; then each state a row
 * and a cell take — under the pointer, the ring's, drafted, and a new row's
 * empty cells. The read-only skills matrix (Example 5) takes no hover, cuts
 * its long header and sorts nothing; the skills matrix (Example 2) holds its
 * head as its rows scroll under it; and each legend is its register's. The
 * page's clock is held at the day the proposal walks, so the stale note counts
 * the same rows whenever the suite runs; a spec that holds the clock keeps
 * Playwright's own page.
 */

import { expect, test, type Locator, type Page } from "playwright/test";
import { visitBuilder } from "./builder-page";
import { CLEAR, RECORD_ROOT, RECORD_THEMES, cellOf, looks, openRecord, played, recordTheme, rowOf } from "./record-page";
import { settled } from "./settle";

/** Each density, as its control names it, and its rows' height. */
const DENSITIES = [
    { name: "COMFORTABLE", row: 36 },
    { name: "COMPACT", row: 32 },
    { name: "CONDENSED", row: 28 },
] as const;

/** How each of the rota's columns pads its cells and sits what they hold (GR2): its padding at the start and at the end, and where. */
const PLACES: Readonly<Record<string, readonly [number, number, "start" | "center" | "end"]>> = {
    name: [12, 12, "start"], supervisor: [12, 12, "start"],
    inducted: [4, 4, "center"], nights: [4, 4, "center"], weekends: [4, 4, "center"],
    forklift: [4, 4, "center"], scanner: [4, 4, "center"], days: [4, 4, "center"], evenings: [4, 4, "center"],
    days_since: [12, 12, "end"], updated: [12, 20, "start"],
};

/** The rota's column groups (HD1), each over its first and last column; the runs before and after them are no group's. */
const GROUPS = [
    { label: "Shifts", from: "nights", to: "weekends" },
    { label: "Skills", from: "forklift", to: "scanner" },
    { label: "Preferences", from: "days", to: "evenings" },
] as const;

/** To the half pixel the page lays out at. */
const half = (n: number) => Math.round(n * 2) / 2;

/**
 * Steps the rota's density through the example's own control, as a person
 * presses its segment, and waits for its rows at their height.
 */
async function density(page: Page, entry: Locator, d: (typeof DENSITIES)[number]): Promise<void> {
    await entry.getByText(d.name, { exact: true }).click();
    await expect(entry.getByRole("radio", { name: d.name, exact: true })).toBeChecked();
    await expect(entry.locator('[data-record] [data-slot="row"]').first()).toHaveCSS("height", `${d.row}px`);
    await settled(page);
}

/**
 * The rota's grid as the page draws it: each column's first cell and its
 * header — the padding, the box, and the box of what it holds — the type its
 * texts and values are set in, the column groups' segments, the select
 * column's cells and boxes, and the footer.
 *
 * @param entry - The example's entry
 * @returns What each part measures
 */
function gridOf(entry: Locator) {
    return entry.locator(RECORD_ROOT).first().evaluate((frame) => {
        const half = (n: number) => Math.round(n * 2) / 2;
        const root = frame.querySelector("[data-record]")!;
        const box = (el: Element) => {
            const b = el.getBoundingClientRect();
            return { left: half(b.left), right: half(b.right), top: half(b.top), height: half(b.height), width: half(b.width), mid: half(b.left + b.width / 2) };
        };
        const type = (el: Element) => {
            const s = getComputedStyle(el);
            return {
                family: s.fontFamily, size: s.fontSize, weight: s.fontWeight, spacing: Math.round(parseFloat(s.letterSpacing) / parseFloat(s.fontSize) * 100) / 100,
                caps: s.textTransform, line: s.lineHeight, ink: s.color, tnum: s.fontFeatureSettings.includes("tnum"),
            };
        };
        // A cell's padding, its box, and what it holds — from its first part's start to its last part's end.
        const placed = (cell: Element) => {
            const s = getComputedStyle(cell);
            const parts = [...cell.children].map((child) => child.getBoundingClientRect());
            const left = Math.min(...parts.map((p) => p.left));
            const right = Math.max(...parts.map((p) => p.right));
            return { start: parseFloat(s.paddingLeft), end: parseFloat(s.paddingRight), ...box(cell), content: { left: half(left), right: half(right), mid: half((left + right) / 2) } };
        };
        const row = root.querySelector('[data-slot="row"]')!;
        const cells = Object.fromEntries([...row.querySelectorAll('[data-slot="cell"]')].map((cell) => [cell.getAttribute("data-key")!, placed(cell)]));
        const heads = Object.fromEntries([...root.querySelectorAll('[data-slot="headerCell"]')].map((head) =>
            [head.getAttribute("data-key")!, { ...placed(head), type: type(head.firstElementChild!) }]));
        const part = (key: string, slot: string) => row.querySelector(`[data-key="${key}"] [data-slot="${slot}"]`)!;
        const segments = [...root.querySelectorAll('[data-slot="groupSeg"]')].map((seg) => {
            const label = seg.children.length > 1 ? seg.firstElementChild! : null;
            const rule = seg.lastElementChild!;
            // The words' own box, which a label's centre is read from: the label's box spans its segment.
            const words = label === null ? null : (() => { const range = document.createRange(); range.selectNodeContents(label); return range.getBoundingClientRect(); })();
            return {
                label: label?.textContent ?? null, labelBox: label === null ? null : box(label), type: label === null ? null : type(label),
                words: words === null ? null : half(words.left + words.width / 2), rule: { ...box(rule), bg: getComputedStyle(rule).backgroundColor },
            };
        });
        const tickOf = (cell: Element) => {
            const button = cell.querySelector("button")!;
            const s = getComputedStyle(button);
            return { ...placed(cell), box: { ...box(button), radius: s.borderTopLeftRadius, bg: s.backgroundColor, edge: s.borderTopColor } };
        };
        const foot = frame.querySelector('[data-slot="footer"]')!;
        const fs = getComputedStyle(foot);
        const count = foot.querySelector('[data-slot="footerCount"]')!;
        const note = foot.querySelector('[data-slot="footerNote"]');
        return {
            cells, heads, segments,
            groupRow: half(root.querySelector('[data-slot="groupRow"]')!.getBoundingClientRect().height),
            headerRow: half(root.querySelector('[data-slot="headerRow"]')!.getBoundingClientRect().height),
            type: { title: type(part("name", "titleCell")), person: type(part("supervisor", "personLabel")), age: type(part("days_since", "age")), date: type(part("updated", "auditDate")) },
            pick: tickOf(row.querySelector("[data-pick]")!),
            tick: tickOf(root.querySelector("[data-tick]")!),
            footer: {
                height: half(foot.getBoundingClientRect().height), start: parseFloat(fs.paddingLeft), end: parseFloat(fs.paddingRight), gap: fs.columnGap,
                rule: fs.borderTopWidth, ruleInk: fs.borderTopColor, bg: fs.backgroundColor,
                count: { text: count.textContent ?? "", ...type(count) }, strong: { text: count.querySelector("b")?.textContent ?? "", ...type(count.querySelector("b")!) },
                note: note === null ? null : { text: note.textContent ?? "", ...type(note) },
                legend: foot.querySelector('[data-slot="legend"]') !== null,
            },
        };
    });
}

for (const theme of RECORD_THEMES) {
    test(`the rota at each density: each column's cells and header padded and set as its kind is, the column groups over their columns, the select column and its ticks, the footer (${theme}) @desktop`, async ({ page }) => {
        const entry = await openRecord(page, "recordLooks", theme, 2160);
        const t = await recordTheme(page);
        for (const d of DENSITIES) {
            await density(page, entry, d);
            const at = `${d.name.toLowerCase()}, ${theme}`;
            const m = await gridOf(entry);

            // GR2: each cell padded as its kind is, and its header as its column's — what it holds at its start, its centre or its end.
            for (const [key, [start, end, how]] of Object.entries(PLACES)) {
                for (const [part, placed] of [["cell", m.cells[key]!], ["header", m.heads[key]!]] as const) {
                    expect([placed.start, placed.end], `${key}'s ${part} padded, ${at}`).toEqual([start, end]);
                    const off = how === "start" ? placed.content.left - (placed.left + start)
                        : how === "end" ? placed.right - end - placed.content.right : placed.content.mid - placed.mid;
                    expect(Math.abs(off), `${key}'s ${part} at its ${how}, ${at}`).toBeLessThanOrEqual(1);
                }
                expect([m.heads[key]!.left, m.heads[key]!.right], `${key}'s header over its cells, ${at}`).toEqual([m.cells[key]!.left, m.cells[key]!.right]);
            }
            // GR3: a text in the body face at the body's size; a value in the mono face at that size, 500, its figures tabular.
            for (const text of [m.type.title, m.type.person]) expect([text.family, text.size], at).toEqual([t.body, t.size.body]);
            for (const value of [m.type.age, m.type.date]) expect([value.family, value.size, value.weight, value.tnum], at).toEqual([t.mono, t.size.body, "500", true]);

            // HD1: the group row 24 tall; each group's label centred over its columns on one line, its rule under them inset 6 at each end.
            expect(m.groupRow, at).toBe(24);
            expect(m.segments.map((s) => s.label), at).toEqual([null, "Shifts", "Skills", "Preferences", null]);
            for (const group of GROUPS) {
                const s = m.segments.find((seg) => seg.label === group.label)!;
                const from = m.cells[group.from]!.left;
                const to = m.cells[group.to]!.right;
                expect(Math.abs(s.words! - (from + to) / 2), `${group.label} centred, ${at}`).toBeLessThanOrEqual(1);
                expect([s.type!.family, s.type!.size, s.type!.weight, s.type!.spacing, s.type!.caps, s.type!.line, s.type!.ink, s.labelBox!.height], `${group.label}, ${at}`)
                    .toEqual([t.mono, t.size["label-xs"], "600", 0.14, "uppercase", "18px", t.c["fg-subtle"], 18]);
                expect([half(s.rule.left - from), half(to - s.rule.right), s.rule.height, s.rule.bg], `${group.label}'s rule, ${at}`).toEqual([6, 6, 1, t.c["border-strong"]]);
            }
            // …and a run no group holds draws neither.
            for (const s of m.segments.filter((seg) => seg.label === null)) expect(s.rule.bg, at).toBe(CLEAR);

            // HD2: the header row a row's height, each label mono at the label size, 600, 0.1em, in capitals on a 14 line, in the subtle ink.
            expect(m.headerRow, at).toBe(d.row);
            for (const [key, head] of Object.entries(m.heads)) {
                expect([head.type.family, head.type.size, head.type.weight, head.type.spacing, head.type.caps, head.type.line, head.type.ink], `${key}'s header, ${at}`)
                    .toEqual([t.mono, t.size["label-sm"], "600", 0.1, "uppercase", "14px", t.c["fg-subtle"]]);
            }

            // SL1: the select column 46 wide, its box 20 in, 14 square at radius 3, the strong rule's edge on the paper — a row's and the header's.
            for (const [part, pick] of [["row", m.pick], ["header", m.tick]] as const) {
                expect([pick.width, pick.start, half(pick.box.left - pick.left), pick.box.width, pick.box.height, pick.box.radius, pick.box.bg, pick.box.edge], `${part}'s, ${at}`)
                    .toEqual([46, 20, 20, 14, 14, "3px", t.c["bg-surface"], t.c["border-strong"]]);
            }

            // FT1: the footer 36 tall, padded 0 20, 16 between its parts, a rule over it, on the paper: the rows shown of the record's, the
            // first strong, then the stale note of the first age with a threshold.
            const f = m.footer;
            expect([f.height, f.start, f.end, f.gap, f.rule, f.ruleInk, f.bg], `the footer, ${at}`).toEqual([36, 20, 20, "16px", "1px", t.c["border-subtle"], t.c["bg-surface"]]);
            expect([f.count.text, f.count.family, f.count.size, f.count.ink, f.count.tnum], at).toEqual([expect.stringMatching(/^3 of 3 people/), t.mono, t.size["label-md"], t.c["fg-muted"], true]);
            expect([f.strong.text, f.strong.weight, f.strong.ink], at).toEqual(["3", "600", t.c.fg]);
            expect([f.note?.text, f.note?.family, f.note?.size, f.note?.ink], at).toEqual(["1 stale · no update in 90 days", t.mono, t.size["label-md"], t.c["fg-muted"]]);
            // FT2: its cycle columns name two registers — no legend.
            expect(f.legend, at).toBe(false);
        }

        // SL1, P5: a tick fills its box in the brand, its tick the paper's; the header's box says some, then all, then none — and no tick moves the ring.
        await cellOf(entry, "R-02", "name").click();
        const box = rowOf(entry, "R-01").locator("[data-pick] button");
        const all = entry.locator("[data-record] [data-tick] button");
        await box.click();
        await expect(box).toHaveAttribute("aria-checked", "true");
        await expect(box).toHaveCSS("background-color", t.c["brand-solid"]);
        await expect(box).toHaveCSS("border-top-color", t.c["brand-solid"]);
        await expect(box.locator("svg")).toHaveCSS("color", t.c["bg-surface"]);
        expect((await box.locator("svg").boundingBox())!.height).toBeCloseTo(9, 0);
        await expect(all).toHaveAttribute("aria-checked", "mixed");
        await expect(all).toHaveAttribute("aria-label", "Select all shown");
        await expect(all.locator('svg[data-icon="minus"]')).toHaveCSS("color", t.c["fg-subtle"]);
        await expect(cellOf(entry, "R-02", "name")).toHaveAttribute("data-active", "");
        // ST4: a ticked row is selected.
        await expect(rowOf(entry, "R-01")).toHaveCSS("background-color", t.c["bg-subtle"]);
        await all.click();
        await expect(all).toHaveAttribute("aria-checked", "true");
        await expect(all).toHaveAttribute("aria-label", "Deselect all");
        await expect(all).toHaveCSS("background-color", t.c["brand-solid"]);
        await expect(entry.locator('[data-record] [data-slot="row"][data-ticked]')).toHaveCount(3);
        await all.click();
        await expect(all).toHaveAttribute("aria-checked", "false");
        await expect(entry.locator('[data-record] [data-slot="row"][data-ticked]')).toHaveCount(0);
        await expect(cellOf(entry, "R-02", "name")).toHaveAttribute("data-active", "");
    });

    test(`the rota's rows and cells in each state at each density: at rest, under the pointer, the ring's, a drafted cell, a draft row and a new row's empty cells (${theme}) @desktop`, async ({ page }) => {
        const entry = await openRecord(page, "recordLooks", theme, 2160);
        const t = await recordTheme(page);
        const papers = [t.c["bg-surface"], t.c["bg-canvas"], t.c["bg-subtle"], t.c["brand-tint"], t.draftWash, t.requiredWash];
        expect(new Set(papers).size, "each state's paper, told apart").toBe(papers.length);
        const away = () => page.mouse.move(1, 1);
        for (const d of DENSITIES) {
            await density(page, entry, d);
            const at = `${d.name.toLowerCase()}, ${theme}`;
            await away();
            // ST1: at rest, each row on the paper, each cell clear.
            for (const id of ["R-01", "R-02"]) {
                await expect(rowOf(entry, id), `${id}, ${at}`).toHaveCSS("background-color", t.c["bg-surface"]);
                await expect(cellOf(entry, id, "forklift"), `${id}, ${at}`).toHaveCSS("background-color", CLEAR);
            }
            // ST2: the row under the pointer on the canvas, a cell that steps nothing clear in it.
            await cellOf(entry, "R-02", "name").hover();
            await expect(rowOf(entry, "R-02"), at).toHaveCSS("background-color", t.c["bg-canvas"]);
            await expect(cellOf(entry, "R-02", "name"), at).toHaveCSS("background-color", CLEAR);
            // ST3: a cell that steps, the subtle paper under the pointer.
            await cellOf(entry, "R-02", "forklift").hover();
            await expect(cellOf(entry, "R-02", "forklift"), at).toHaveCSS("background-color", t.c["bg-subtle"]);
            // ST4, ST5: the ring's row on the subtle paper, and its cell, ringed inside.
            await cellOf(entry, "R-03", "name").click();
            await away();
            await expect(rowOf(entry, "R-03"), at).toHaveCSS("background-color", t.c["bg-subtle"]);
            await expect(cellOf(entry, "R-03", "name"), at).toHaveCSS("background-color", t.c["bg-subtle"]);
            await expect(cellOf(entry, "R-03", "name"), at).toHaveCSS("box-shadow", t.focusInset);
        }

        // ST6: a stepped cell under the ring keeps the ring's paper; the ring gone, it wears the brand's tint.
        const forklift = cellOf(entry, "R-01", "forklift");
        await forklift.click();
        await expect(forklift).toHaveAttribute("data-dirty", "");
        await away();
        await expect(forklift).toHaveCSS("background-color", t.c["bg-subtle"]);
        // A new row (AD1), and the ring off it.
        await entry.locator('[data-frame-slot="toolbar"] [data-record-action="add"]').click();
        const added = entry.locator('[data-record] [data-slot="row"]:has([data-required])');
        await expect(added).toHaveCount(1);
        await cellOf(entry, "R-03", "name").click();
        const required = await added.locator("[data-required]").evaluateAll((cells) => cells.map((cell) => cell.getAttribute("data-key")!));
        expect(required, "the title a person must fill").toContain("name");
        for (const d of DENSITIES) {
            await density(page, entry, d);
            const at = `${d.name.toLowerCase()}, ${theme}`;
            await away();
            await expect(forklift, at).toHaveCSS("background-color", t.c["brand-tint"]);
            await forklift.hover();
            await expect(forklift, at).toHaveCSS("background-color", t.c["brand-tint"]);
            // ST7: a row holding drafts, and a new row, in the warn wash — under the pointer too.
            for (const row of [rowOf(entry, "R-01"), added]) await expect(row, at).toHaveCSS("background-color", t.draftWash);
            // ST8: each of a new row's empty cells a person must fill in the stronger wash, empty, saying so on hover.
            for (const key of required) {
                const cell = added.locator(`[data-slot="cell"][data-key="${key}"]`);
                const header = await entry.locator(`[data-record] [data-slot="headerCell"][data-key="${key}"]`).getAttribute("title");
                await expect(cell, `${key}, ${at}`).toHaveCSS("background-color", t.requiredWash);
                await expect(cell, `${key}, ${at}`).toHaveText("");
                await expect(cell, `${key}, ${at}`).toHaveAttribute("title", `${header} · required`);
            }
        }
    });

    test(`a read-only Record: no select column, no row or cell changes under the pointer, each chip its state's look; a long header cut, its whole label its tooltip; a header sorts nothing (${theme}) @desktop`, async ({ page }) => {
        const entry = await openRecord(page, "recordSkillsReadOnly", theme, 1600);
        const t = await recordTheme(page);
        // ST9
        await expect(entry.locator("[data-record] [data-pick], [data-record] [data-tick]")).toHaveCount(0);
        const row = rowOf(entry, "P-0401");
        const intake = cellOf(entry, "P-0401", "intake");
        await intake.hover();
        await played(row);
        expect(await row.evaluate((el) => getComputedStyle(el).backgroundColor), theme).toBe(t.c["bg-surface"]);
        expect(await intake.evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).cursor]), theme).toEqual([CLEAR, "default"]);
        // A. Morgan's intake, the top of three members, at the ramp's top.
        await expect(intake.locator('[data-slot="chip"]')).toHaveText("2");
        await expect(intake.locator('[data-slot="chip"]')).toHaveCSS("background-color", t.c["heat-4"]);

        // HD3: a header too long for its column on one line, cut with an ellipsis, its whole label its tooltip.
        const handover = entry.locator('[data-record] [data-slot="headerCell"][data-key="handover"]');
        await expect(handover).toHaveAttribute("title", "Handover to next shift");
        const label = (await looks(handover, { label: "span" })).label!;
        expect([label.text, label.cut, label.height]).toEqual(["Handover to next shift", true, 14]);
        expect(await handover.locator("span").first().evaluate((el) => [getComputedStyle(el).textOverflow, getComputedStyle(el).whiteSpace])).toEqual(["ellipsis", "nowrap"]);

        // HD4: a header sorts nothing — the rows keep the record's order.
        const order = () => entry.locator('[data-record] [data-slot="row"]').evaluateAll((rows) => rows.map((r) => r.getAttribute("data-row-id")));
        expect(await order()).toEqual(["P-0401", "P-0408", "P-0415", "P-0450", "P-0520"]);
        await entry.locator('[data-record] [data-slot="headerCell"][data-key="intake"]').click();
        await settled(page);
        expect(await order()).toEqual(["P-0401", "P-0408", "P-0415", "P-0450", "P-0520"]);
        await expect(entry.locator("[data-record] [aria-sort]")).toHaveCount(0);
    });

    test(`each legend its register's: every member's chip at the legend's height in its look, each of a column one width, then its name (${theme}) @desktop`, async ({ page }) => {
        // FT2, over a register of tones and over a scale.
        const preferences = await openRecord(page, "recordShiftPreferences", theme, 1600);
        const t = await recordTheme(page);
        const legendOf = (entry: Locator) => entry.locator('[data-slot="footer"] [data-slot="legendItem"]').evaluateAll((items) => items.map((item) => {
            const chip = item.querySelector('[data-slot="legendChip"]')!;
            const name = item.querySelector('[data-slot="legendName"]')!;
            const c = getComputedStyle(chip);
            const n = getComputedStyle(name);
            return {
                chip: [chip.textContent, c.backgroundColor, c.color, c.borderTopColor], name: [name.textContent, n.fontFamily, n.fontSize, n.color],
                type: [chip.getBoundingClientRect().height, c.fontFamily, c.fontSize, c.fontWeight], width: chip.getBoundingClientRect().width,
            };
        }));
        const tones = await legendOf(preferences);
        expect(tones.map((item) => item.chip), theme).toEqual([
            ["can", t.c["bg-surface"], t.c["fg-subtle"], t.c["border-strong"]],
            ["prefer", t.c["status-pos-subtle"], t.c["fg-success"], t.c["status-pos"]],
            ["can't", t.c["status-neg-subtle"], t.c["fg-danger"], t.c["status-neg"]],
        ]);
        expect(tones.map((item) => item.name), theme).toEqual(["Can work", "Prefers", "Can't work"].map((name) => [name, t.mono, t.size["label-md"], t.c["fg-muted"]]));
        const matrix = await visitBuilder(page, "e3/record/record/recordSkillsMatrix", RECORD_ROOT, undefined);
        const scale = await legendOf(matrix);
        expect(scale.map((item) => item.chip), theme).toEqual([
            ["0", t.c["bg-surface"], t.c["fg-subtle"], t.c["border-strong"]],
            ["1", t.c["heat-2"], t.c.fg, t.c["heat-2"]],
            ["2", t.c["heat-4"], t.c["bg-surface"], t.c["heat-4"]],
        ]);
        expect(scale.map((item) => item.name[0]), theme).toEqual(["Not trained", "Supervised", "Competent"]);
        for (const legend of [tones, scale]) {
            for (const item of legend) expect(item.type, `${item.chip[0]}, ${theme}`).toEqual([15, t.mono, t.size["label-xs"], "600"]);
            expect(new Set(legend.map((item) => item.width)).size, theme).toBe(1);
        }
    });
}

test("the rows scroll under the head, the group row and the header row held together over them @desktop", async ({ page }) => {
    // GR4: the skills matrix in a box too short for its rows.
    const entry = await openRecord(page, "recordSkillsMatrix", "light", 1600);
    await entry.locator(RECORD_ROOT).first().locator("xpath=..").evaluate((box) => { (box as HTMLElement).style.height = "300px"; });
    await settled(page);
    const scroller = entry.locator("[data-record] [data-virtual-rows]").first();
    const at = () => entry.locator("[data-record]").evaluate((root) => {
        const top = (selector: string) => root.querySelector(selector)!.getBoundingClientRect();
        const rows = root.querySelector("[data-virtual-rows]")!;
        return {
            head: top('[data-slot="head"]').top, headBottom: top('[data-slot="head"]').bottom, group: top('[data-slot="groupRow"]').bottom,
            header: top('[data-slot="headerRow"]').top, first: top('[data-slot="row"]').top, scroll: rows.scrollTop, room: rows.scrollHeight - rows.clientHeight,
        };
    });
    const rest = await at();
    expect(rest.room, "rows to scroll").toBeGreaterThan(40);
    await scroller.evaluate((el) => { el.scrollTop = 40; });
    await expect.poll(async () => (await at()).scroll).toBe(40);
    const scrolled = await at();
    expect(Math.abs(scrolled.head - rest.head), "the head held").toBeLessThanOrEqual(0.5);
    expect(Math.abs(scrolled.group - scrolled.header), "the group row on the header row").toBeLessThanOrEqual(0.5);
    expect(scrolled.first - rest.first, "the rows scrolled").toBeCloseTo(-40, 0);
    expect(scrolled.first, "under the head").toBeLessThan(scrolled.headBottom);
});
