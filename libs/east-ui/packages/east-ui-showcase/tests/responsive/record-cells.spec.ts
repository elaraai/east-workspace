/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Record's cells (`Record - DX Proposal.md` C1–C10), measured in the page
 * in both themes and at each of the three densities: the looks example's rota
 * (Example 6), its density stepped through the example's own control, each
 * kind's parts held to the record recipe's tokens and sizes — a chip's look and
 * its column's one width, a mark's pips and dot, the initials, the ring for no
 * one, the box, an age fresh and stale, an absent value, an audit's date and
 * who, and Pending while a draft changes the row. The page's clock is held at
 * the day the proposal walks, so each age is one count whenever the suite
 * runs; a spec that holds the clock keeps Playwright's own page.
 *
 * A chip's words and the initials stand a whole number of pixels under their
 * box's top edge (#1636). The page rounds an edge and a line of words to the
 * pixel each by itself: a fraction between them puts the words a row higher in
 * the box on one page than on another, by where the page stands the grid.
 */

import { expect, test, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";
import { token } from "./tokens";

const ROUTE = "e3/record/record/recordLooks";

/**
 * Each density, as its control names it: its rows' height, a chip's and the initials', the type each is set in, and how
 * far under its box's top edge each one's words start.
 */
const DENSITIES = [
    { name: "COMFORTABLE", row: 36, chip: 22, avatar: 24, chipType: "label-md", initialsType: "label-sm", chipWords: 4, initialsWords: 6 },
    { name: "COMPACT", row: 32, chip: 15, avatar: 20, chipType: "label-xs", initialsType: "label-xs", chipWords: 2, initialsWords: 4 },
    { name: "CONDENSED", row: 28, chip: 15, avatar: 20, chipType: "label-xs", initialsType: "label-xs", chipWords: 2, initialsWords: 4 },
] as const;

/** A colour that paints nothing. */
const CLEAR = "rgba(0, 0, 0, 0)";

/** The rota at rest, every column in view, on the day the proposal walks: A. Morgan's last change 49 days old, C. Patel's 177. */
async function openRota(page: Page, theme: "light" | "dark"): Promise<Locator> {
    await page.clock.setFixedTime(new Date("2026-11-06T12:00:00Z"));
    await page.setViewportSize({ width: 2160, height: 1200 });
    await page.goto(`/?theme=${theme}#${ROUTE}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${ROUTE}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator('[data-record] [data-slot="row"]').first()).toBeVisible({ timeout: 30_000 });
    await settled(page);
    return entry;
}

/**
 * A type token as the page resolves it: a size, or a family.
 *
 * @param page - The page
 * @param property - What it sets
 * @param name - The token's CSS variable name, after `--chakra-`
 * @returns Its computed value
 */
function typeToken(page: Page, property: "fontSize" | "fontFamily", name: string): Promise<string> {
    return page.evaluate(([p, n]) => {
        const probe = document.createElement("span");
        probe.style[p] = `var(--chakra-${n})`;
        document.body.appendChild(probe);
        const value = getComputedStyle(probe)[p];
        probe.remove();
        return value;
    }, [property, name] as const);
}

/**
 * The rota's parts as the page draws them: each one's box and its look, and
 * each cell's content box, by row (A. Morgan, B. Ellis, C. Patel) and column.
 *
 * @param entry - The example's entry
 * @returns What each part measures
 */
function measure(entry: Locator) {
    return entry.locator("[data-record]").evaluate((root) => {
        const rows = [...root.querySelectorAll<HTMLElement>('[data-slot="row"]')];
        const cell = (r: number, key: string) => rows[r]!.querySelector<HTMLElement>(`[data-slot="cell"][data-key="${key}"]`)!;
        const parts = (r: number, key: string, slot: string) => [...cell(r, key).querySelectorAll<HTMLElement>(`[data-slot="${slot}"]`)];
        const look = (el: HTMLElement) => {
            const s = getComputedStyle(el);
            const b = el.getBoundingClientRect();
            // Its words' own box, as the page lays their line out.
            const words = document.createRange();
            words.selectNodeContents(el);
            return {
                text: el.textContent, width: b.width, height: b.height, left: b.left, right: b.right, mid: b.left + b.width / 2,
                // How far under its top edge its words start, to the 64th of a pixel the page lays out in.
                words: Math.round((words.getBoundingClientRect().top - b.top) * 64) / 64,
                bg: s.backgroundColor, ink: s.color, edge: s.borderTopColor, edgeStyle: s.borderTopStyle, edgeWidth: s.borderTopWidth,
                radius: s.borderTopLeftRadius, size: s.fontSize, family: s.fontFamily, weight: s.fontWeight, italic: s.fontStyle === "italic",
            };
        };
        const part = (r: number, key: string, slot: string) => look(parts(r, key, slot)[0]!);
        // Where a cell's content may sit: inside its padding.
        const content = (r: number, key: string) => {
            const c = cell(r, key);
            const s = getComputedStyle(c);
            const b = c.getBoundingClientRect();
            return { left: b.left + parseFloat(s.paddingLeft), right: b.right - parseFloat(s.paddingRight), mid: b.left + b.width / 2 };
        };
        const header = root.querySelector<HTMLElement>('[data-slot="headerRow"]')!;
        return {
            rows: [...rows.map((row) => row.getBoundingClientRect().height), header.getBoundingClientRect().height],
            avatar: part(0, "name", "avatar"),
            title: part(0, "name", "titleCell"),
            nobody: part(1, "supervisor", "nobody"),
            nobodyWords: part(1, "supervisor", "personLabel"),
            boxes: [part(0, "inducted", "box"), part(1, "inducted", "box")],
            forklift: [0, 1, 2].map((r) => part(r, "forklift", "chip")),
            forkliftCells: [0, 1, 2].map((r) => content(r, "forklift")),
            nights: [0, 1, 2].map((r) => part(r, "nights", "chip")),
            days: [0, 1, 2].map((r) => part(r, "days", "chip")),
            scanner: parts(0, "scanner", "pip").map(look),
            weekends: parts(0, "weekends", "pip").map(look),
            dots: [0, 1].map((r) => part(r, "evenings", "markDot")),
            words: [0, 1].map((r) => part(r, "evenings", "markWord")),
            ages: [part(0, "days_since", "age"), part(2, "days_since", "age")],
            ageCell: content(0, "days_since"),
            stale: part(2, "days_since", "staleDot"),
            absent: part(1, "days_since", "absent"),
            absentCell: content(1, "days_since"),
            date: part(0, "updated", "auditDate"),
            who: part(0, "updated", "auditMeta"),
        };
    });
}

/** Whether two edges meet at a gap, to the half pixel the page rounds to. */
const gapOf = (left: { right: number }, right: { left: number }) => Math.round((right.left - left.right) * 2) / 2;

for (const theme of ["light", "dark"] as const) {
    test(`each kind's cell at each density: the chips' looks and one width a column, the marks' pips and dots, the initials and the ring for no one, the box, an age fresh and stale, an absent value, an audit's date and who — then Pending while a draft changes the row (${theme}) @desktop`, async ({ page }) => {
        const entry = await openRota(page, theme);
        const names = ["bg-surface", "bg-subtle", "fg", "fg-subtle", "fg-strong", "fg-muted", "fg-faint", "border-strong", "heat-2", "heat-4",
            "status-pos", "status-pos-subtle", "fg-success", "status-neg", "status-neg-subtle", "fg-danger", "status-warn", "fg-warning",
            "brand-solid", "brand-pressed", "brand-mark"] as const;
        const t = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await token(page, name)] as const))) as Record<(typeof names)[number], string>;
        const mono = await typeToken(page, "fontFamily", "fonts-mono");
        const type = Object.fromEntries(await Promise.all(["label-md", "label-sm", "label-xs", "body", "body-sm"].map(async (name) =>
            [name, await typeToken(page, "fontSize", `font-sizes-${name}`)] as const))) as Record<string, string>;
        expect(new Set([t["heat-2"], t["heat-4"], t["bg-surface"], t["status-pos-subtle"], t["status-neg-subtle"]]).size, "the chips' fills, told apart").toBe(5);

        for (const density of DENSITIES) {
            // The segment's own words, as a person presses it: its radio is the hidden input under them.
            await entry.getByText(density.name, { exact: true }).click();
            await expect(entry.getByRole("radio", { name: density.name, exact: true })).toBeChecked();
            await expect(entry.locator('[data-record] [data-slot="row"]').first()).toHaveCSS("height", `${density.row}px`);
            await settled(page);
            const at = `${density.name.toLowerCase()}, ${theme}`;
            const m = await measure(entry);
            // GR1: the rows and the header row the density's height, the rule included.
            expect(m.rows, at).toEqual([density.row, density.row, density.row, density.row]);

            // C1: neutral initials, round, 8 before the title.
            expect([m.avatar.text, m.avatar.width, m.avatar.height, m.avatar.radius, m.avatar.bg, m.avatar.edge, m.avatar.ink, m.avatar.size, m.avatar.weight, m.avatar.family], at)
                .toEqual(["AM", density.avatar, density.avatar, "9999px", t["bg-subtle"], t["border-strong"], t["fg-strong"], type[density.initialsType], "600", mono]);
            expect(gapOf(m.avatar, m.title), at).toBe(8);
            // …their words a whole number of pixels under the ring's top edge, so the two land on the page's pixels together (#1636).
            expect(m.avatar.words, `the initials under their ring's edge, ${at}`).toBe(density.initialsWords);
            expect([m.title.text, m.title.size, m.title.weight, m.title.ink], at).toEqual(["A. Morgan", type.body, "500", t.fg]);
            // C2: no one is a dashed ring the initials' size, and the words beside it.
            expect([m.nobody.width, m.nobody.height, m.nobody.edgeStyle, m.nobody.edge], at).toEqual([density.avatar, density.avatar, "dashed", t["border-strong"]]);
            expect([m.nobodyWords.text, m.nobodyWords.ink], at).toEqual(["Unassigned", t["fg-subtle"]]);
            // C3: the box, 14 at every density — ticked in the brand, else the paper in a strong edge.
            expect(m.boxes.map((box) => [box.width, box.height, box.bg, box.edge]), at)
                .toEqual([[14, 14, t["brand-solid"], t["brand-solid"]], [14, 14, t["bg-surface"], t["border-strong"]]]);

            // C4: a chip the density's height and type, centred in its cell, every chip of a column one width.
            for (const chip of [...m.forklift, ...m.nights, ...m.days]) {
                expect([chip.height, chip.size, chip.weight, chip.family, chip.edgeWidth], `${chip.text}, ${at}`).toEqual([density.chip, type[density.chipType], "600", mono, "1px"]);
            }
            for (const column of [m.forklift, m.nights, m.days]) expect(new Set(column.map((chip) => chip.width)).size, `${column.map((chip) => chip.text).join("/")}, ${at}`).toBe(1);
            // Its words a whole number of pixels under its top edge: at a fraction the edge and the words round apart, and the
            // words stand a row higher in the chip wherever the page puts the grid on a whole pixel (#1636).
            for (const chip of [...m.forklift, ...m.nights, ...m.days]) expect(chip.words, `${chip.text}'s words under its edge, ${at}`).toBe(density.chipWords);
            m.forklift.forEach((chip, r) => expect(Math.abs(chip.mid - m.forkliftCells[r]!.mid), `${chip.text} centred, ${at}`).toBeLessThanOrEqual(1));
            // C5: a scale's first empty, then up the heat ramp; a toggle's on at its top; a valence's wash, edge and text step.
            const looks = (chips: typeof m.forklift) => chips.map((chip) => [chip.text, chip.bg, chip.ink, chip.edge]);
            expect(looks(m.forklift), at).toEqual([
                ["2", t["heat-4"], t["bg-surface"], t["heat-4"]],
                ["0", t["bg-surface"], t["fg-subtle"], t["border-strong"]],
                ["1", t["heat-2"], t.fg, t["heat-2"]],
            ]);
            expect(looks(m.nights), at).toEqual([
                ["no", t["bg-surface"], t["fg-subtle"], t["border-strong"]],
                ["yes", t["heat-4"], t["bg-surface"], t["heat-4"]],
                ["yes", t["heat-4"], t["bg-surface"], t["heat-4"]],
            ]);
            expect(looks(m.days), at).toEqual([
                ["prefer", t["status-pos-subtle"], t["fg-success"], t["status-pos"]],
                ["can", t["bg-surface"], t["fg-subtle"], t["border-strong"]],
                ["can't", t["status-neg-subtle"], t["fg-danger"], t["status-neg"]],
            ]);

            // C6: a scale's pips 8 round, 4 apart, filled up to its member; a toggle's one; a valence's dot, then its word 8 on.
            expect(m.scanner.map((pip) => [pip.width, pip.height, pip.bg, pip.edge]), at)
                .toEqual([[8, 8, t["brand-solid"], t["brand-solid"]], [8, 8, CLEAR, t["fg-faint"]]]);
            expect(gapOf(m.scanner[0]!, m.scanner[1]!), at).toBe(4);
            expect(m.weekends.map((pip) => [pip.width, pip.bg]), at).toEqual([[8, t["brand-solid"]]]);
            expect(m.dots.map((dot) => [dot.width, dot.height, dot.bg, dot.edge]), at)
                .toEqual([[8, 8, CLEAR, t["fg-subtle"]], [8, 8, t["status-neg"], t["status-neg"]]]);
            expect(m.words.map((word) => [word.text, word.ink, word.size, word.weight, word.family]), at)
                .toEqual([["can", t["fg-muted"], type["label-md"], "600", mono], ["can't", t["fg-danger"], type["label-md"], "600", mono]]);
            m.dots.forEach((dot, r) => expect(gapOf(dot, m.words[r]!), at).toBe(8));

            // C7: an age mono at the value's size, at its cell's end; past its threshold in the warn step after an 8 warn dot.
            expect(m.ages.map((age) => [age.text, age.ink, age.size, age.weight, age.family]), at)
                .toEqual([["49", t.fg, type.body, "500", mono], ["177", t["fg-warning"], type.body, "500", mono]]);
            expect(Math.abs(m.ages[0]!.right - m.ageCell.right), at).toBeLessThanOrEqual(1);
            expect([m.stale.width, m.stale.height, m.stale.bg], at).toEqual([8, 8, t["status-warn"]]);
            expect(gapOf(m.stale, m.ages[1]!), at).toBe(8);
            // C10: an absent value in the column's words, mono italic 400 in the subtle ink.
            expect([m.absent.text, m.absent.italic, m.absent.weight, m.absent.family, m.absent.ink], at).toEqual(["not confirmed", true, "400", mono, t["fg-subtle"]]);
            // Within its cell's padding: an end-aligned value too wide for its column is never cut off at its start.
            expect(m.absent.left >= m.absentCell.left - 0.5 && m.absent.right <= m.absentCell.right + 0.5, `${JSON.stringify([m.absent.left, m.absent.right, m.absentCell])}, ${at}`).toBe(true);
            // C8: the date mono 500 in ink, then 8 on, in blame mode, the verb and who in the muted ink.
            expect([m.date.text, m.date.ink, m.date.size, m.date.weight, m.date.family], at).toEqual(["2026-09-18", t.fg, type.body, "500", mono]);
            expect([m.who.text, m.who.ink, m.who.size], at).toEqual(["confirmed · M. Hale", t["fg-muted"], type["body-sm"]]);
            expect(gapOf(m.date, m.who), at).toBe(8);
        }

        // C9: a draft changes A. Morgan's Forklift, and the audit reads Pending, its dot and its count in the brand.
        await entry.locator('[data-record] [data-slot="row"]').first().locator('[data-slot="cell"][data-key="forklift"]').click();
        const audit = entry.locator('[data-record] [data-slot="row"]').first().locator('[data-slot="cell"][data-key="updated"]');
        await expect(audit.locator('[data-slot="pending"]')).toBeVisible();
        expect(await audit.evaluate((cell) => {
            const look = (slot: string) => {
                const el = cell.querySelector<HTMLElement>(`[data-slot="${slot}"]`)!;
                const s = getComputedStyle(el);
                const b = el.getBoundingClientRect();
                return { text: el.innerText, width: b.width, height: b.height, bg: s.backgroundColor, ink: s.color, size: s.fontSize, weight: s.fontWeight };
            };
            return { pending: look("pending"), dot: look("pendingDot"), count: look("pendingMeta") };
        })).toEqual({
            pending: expect.objectContaining({ text: "PENDING", ink: t["brand-pressed"], size: type["label-md"], weight: "600" }),
            dot: expect.objectContaining({ width: 8, height: 8, bg: t["brand-mark"] }),
            count: expect.objectContaining({ text: "1 change", ink: t["brand-pressed"], size: type["body-sm"] }),
        });
    });
}
