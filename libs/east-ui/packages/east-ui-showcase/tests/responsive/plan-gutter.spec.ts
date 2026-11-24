/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The gutter's line on a Plan's rows (#1749), measured in the page at 100%
 * over planTargetState at the Plan's default 240px gutter:
 *
 * - the line — one grid of a caret's 14px cell where the row folds, its name,
 *   and a 56px value slot at the gutter's end, 6 apart: the same slot on every
 *   row, on each line of a laned row and on every group band; a level in by
 *   20, so a member's words start where the words of the row it is under do;
 * - a status — its tone's icon in a 12px box at the slot's start, on whole
 *   pixels with the odd one under it (9 above and 10 below in a 32px row), in
 *   its tone's ink from the tokens, named for a reader;
 * - a value — at the slot's end in the room its status leaves, 56 or 40,
 *   whole or not drawn: a band's value wider than its room is drawn nowhere,
 *   at the default gutter and at its widest, where its name's cell has the
 *   room and its count is whole again;
 * - a laned row's lines — one a lane, each caption at its slot's end in the
 *   label ink.
 *
 * The row's controls over the slot are `plan-geometry.spec.ts`'s; the voice of
 * each part the visual invariants'.
 */

import { expect, type Page } from "playwright/test";
import { variant } from "@elaraai/east";
import { test } from "./kept-page";
import { PLAN_EXAMPLES, openExample, printId, rowId, same } from "./plan-page";
import { PLAN_CARET_CELL, PLAN_INDENT } from "./plan-rows";
import { settled } from "./settle";
import { token } from "./tokens";

/** A section's band's id text: the series that made it, and no path of keys. */
const sectionId = (series: string): string => printId(variant("section", { series, path: [] }) as Parameters<typeof printId>[0]);

/** The gutter's padding, either side of its lines. */
const PAD = 12;
/** A caret's cell, on a line that folds. */
const CARET = 14;
/** What stands between two cells of a line. */
const GAP = 6;
/** The value slot, the last cell of every line. */
const SLOT = 56;
/** A status's icon, and what stands between it and the value. */
const ICON = 12;
const AFTER_ICON = 4;

/** Each tone's icon: its glyph, the colour its ink is by the theme's name for it, and its name. A neutral status draws none. */
const STATUS: Readonly<Record<string, { readonly glyph: string; readonly ink: string; readonly name: string }>> = {
    warning: { glyph: "triangle-exclamation", ink: "status-warn", name: "Status: warning" },
    danger: { glyph: "circle-exclamation", ink: "status-neg", name: "Status: danger" },
    success: { glyph: "check", ink: "status-pos", name: "Status: success" },
    info: { glyph: "circle-info", ink: "status-info", name: "Status: info" },
};

/** A box in a row's gutter: its left from the gutter cell's, its top from the row's, its width and its height. */
type Box = readonly [left: number, top: number, width: number, height: number];

/** One line of a row's gutter as the browser lays it out. */
interface LineRead {
    readonly box: Box;
    /** Its caret's middle, across — its cell's, whichever way the caret points — on a line that folds. */
    readonly caret: number | null;
    /** Its name's cell: a row's first line's, and a band's. */
    readonly title: Box | null;
    /** The count or the unit after its name: what it says, and whether its words stand whole in its box. */
    readonly meta: { readonly says: string; readonly whole: boolean } | null;
    /** Its value slot; none is a fault. */
    readonly slot: Box | null;
    readonly status: { readonly tone: string; readonly glyph: string; readonly box: Box; readonly ink: string; readonly name: string } | null;
    /** Its value: what it says, its words' width, where they end, and how much of them its box shows. */
    readonly value: { readonly says: string; readonly width: number; readonly right: number; readonly drawn: "whole" | "part" | "none" } | null;
    /** A lane's caption: what it says, where its words end, its face and its ink. */
    readonly caption: { readonly says: string; readonly right: number; readonly face: string; readonly ink: string } | null;
}

/** A row's gutter, or a group band's, as the browser lays it out. */
interface GutterRead {
    readonly id: string;
    readonly band: boolean;
    readonly level: number;
    readonly height: number;
    /** Its gutter cell's width, and where its lines end in it: inside its padding and the gutter's rule. */
    readonly width: number;
    readonly end: number;
    readonly lines: readonly LineRead[];
}

/** Reads the gutter of every row and every group band a canvas's body draws ({@link GutterRead}). */
const readGutter = (root: Element): GutterRead[] => {
    const n = (v: number) => Math.round(v * 100) / 100;
    const words = (el: Element) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return range.getBoundingClientRect();
    };
    return [...root.querySelector("[data-plan-body]")!.querySelectorAll("[data-plan-row], [data-plan-group]")].map((row) => {
        const r = row.getBoundingClientRect();
        const cell = row.querySelector("[role='rowheader']")!;
        const c = cell.getBoundingClientRect();
        const cs = getComputedStyle(cell);
        const box = (el: Element): Box => {
            const b = el.getBoundingClientRect();
            return [n(b.left - c.left), n(b.top - r.top), n(b.width), n(b.height)];
        };
        const band = row.hasAttribute("data-plan-group");
        // A band's name is its one line; a row's lines are its name's, then a laned row's others.
        const lines = band ? [cell] : [...cell.querySelectorAll(":scope > :is([data-plan-gutter='name'], [data-plan-gutter='lane'])")];
        return {
            id: (row.getAttribute("data-plan-row") ?? row.getAttribute("data-plan-group"))!,
            band,
            level: Number(row.getAttribute("aria-level")),
            height: n(r.height),
            width: n(c.width),
            end: n(c.width - Number.parseFloat(cs.borderRightWidth) - Number.parseFloat(cs.paddingRight)),
            lines: lines.map((line) => {
                const slot = line.querySelector(":scope > [data-plan-gutter='slot']");
                const caret = line.querySelector(":scope > span > svg[data-icon='caret-down']")?.parentElement?.getBoundingClientRect();
                const title = line.querySelector(":scope > [data-plan-gutter='title']");
                const meta = title?.querySelector(":scope > [data-plan-gutter='meta']") ?? null;
                const icon = slot?.querySelector(":scope > [role='img']") ?? null;
                const value = slot?.querySelector(":scope > [data-plan-gutter='value']") ?? null;
                const caption = slot?.querySelector(":scope > [data-plan-lane]") ?? null;
                const status = icon === null ? null : {
                    tone: icon.getAttribute("data-tone") ?? "",
                    glyph: icon.querySelector("svg")?.getAttribute("data-icon") ?? "",
                    box: box(icon),
                    ink: getComputedStyle(icon).color,
                    name: icon.getAttribute("aria-label") ?? "",
                };
                // A value's words: whole in its box, or wrapped off its line, which its box clips.
                const valued = value === null || (value.textContent ?? "") === "" ? null : (() => {
                    const [v, w] = [value.getBoundingClientRect(), words(value)];
                    const whole = w.left >= v.left - 0.5 && w.right <= v.right + 0.5 && w.top >= v.top - 0.5 && w.bottom <= v.bottom + 0.5;
                    const out = w.right <= v.left + 0.5 || w.left >= v.right - 0.5 || w.bottom <= v.top + 0.5 || w.top >= v.bottom - 0.5;
                    return { says: value.textContent ?? "", width: n(w.width), right: n(w.right - c.left), drawn: whole ? "whole" as const : out ? "none" as const : "part" as const };
                })();
                const said = meta === null ? null : (() => {
                    const [m, w] = [meta.getBoundingClientRect(), words(meta)];
                    return { says: meta.textContent ?? "", whole: w.width > 0 && w.left >= m.left - 0.5 && w.right <= m.right + 0.5 };
                })();
                const captioned = caption === null ? null : (() => {
                    const s = getComputedStyle(caption);
                    return {
                        says: caption.textContent ?? "", right: n(words(caption).right - c.left),
                        face: `${/mono/i.test(s.fontFamily) ? "mono" : s.fontFamily} ${s.fontSize} ${s.fontWeight}`, ink: s.color,
                    };
                })();
                return {
                    box: box(line),
                    caret: caret === undefined ? null : n((caret.left + caret.right) / 2 - c.left),
                    title: title === null ? null : box(title),
                    meta: said,
                    slot: slot === null ? null : box(slot),
                    status, value: valued, caption: captioned,
                };
            }),
        };
    });
};

/** The inks a gutter's parts wear, as the page resolves their tokens: each tone's, and the label ink. */
async function inksOf(page: Page): Promise<Readonly<Record<string, string>>> {
    const tones = await Promise.all(Object.entries(STATUS).map(async ([tone, look]) => [tone, await token(page, look.ink)] as const));
    return { ...Object.fromEntries(tones), label: await token(page, "fg-subtle") };
}

/**
 * What is wrong with some rows' gutters, each a line saying what and of which row: every line's value slot is the
 * canvas's one, 56px ending where the line ends; a line starts at its level's indent — its caret's cell there where it
 * folds, its name after that, else its name — and its name's cell ends a gap before its slot; a status is its tone's
 * icon, 12px at the slot's start, on its line's whole pixels with the odd one under it, in its tone's ink, named; a
 * value is whole at the slot's end where its words fit the room its status leaves, and not drawn where they do not;
 * a lane's caption ends at the slot's end, mono 10/600 in the label ink.
 *
 * @param rows - The rows' gutters
 * @param inks - The inks the page resolves ({@link inksOf})
 * @returns The faults; none where the gutters hold
 */
function gutterFaults(rows: readonly GutterRead[], inks: Readonly<Record<string, string>>): string[] {
    const bad: string[] = [];
    for (const row of rows) {
        const start = PAD + PLAN_INDENT * (row.level - 1);
        row.lines.forEach((line, i) => {
            const at = i === 0 ? row.id : `${row.id}, line ${i + 1}`;
            if (line.slot === null) { bad.push(`${at}: no value slot`); return; }
            const [slotLeft, slotTop, slotWidth, slotHeight] = line.slot;
            const slotEnd = slotLeft + slotWidth;
            if (!same(slotWidth, SLOT) || !same(slotEnd, row.end)) bad.push(`${at}: its value slot spans ${slotLeft}–${slotEnd}px, want ${SLOT} ending at ${row.end}`);
            if (line.caret !== null && !same(line.caret, start + CARET / 2)) bad.push(`${at}: its caret's cell is centred at ${line.caret}px, want ${start + CARET / 2}`);
            if (line.title !== null) {
                const [left, , width] = line.title;
                const want = start + (line.caret === null ? 0 : PLAN_CARET_CELL);
                if (!same(left, want)) bad.push(`${at}: its name starts at ${left}px, want ${want}`);
                if (!same(left + width, slotLeft - GAP)) bad.push(`${at}: its name's cell ends at ${left + width}px, want ${slotLeft - GAP}`);
            }
            if (line.status !== null) {
                const look = STATUS[line.status.tone];
                const [left, top, width, height] = line.status.box;
                if (look === undefined) bad.push(`${at}: a ${line.status.tone} status draws an icon`);
                else {
                    if (line.status.glyph !== look.glyph) bad.push(`${at}: its ${line.status.tone} status is a ${line.status.glyph}, want a ${look.glyph}`);
                    if (line.status.ink !== inks[line.status.tone]) bad.push(`${at}: its ${line.status.tone} status is in ${line.status.ink}, want ${inks[line.status.tone]}`);
                    if (line.status.name !== look.name) bad.push(`${at}: its status is named "${line.status.name}", want "${look.name}"`);
                }
                if (!same(width, ICON) || !same(height, ICON) || !same(left, slotLeft)) bad.push(`${at}: its status is ${width}×${height} at ${left}px, want ${ICON}×${ICON} at ${slotLeft}`);
                const over = Math.floor((slotHeight - ICON) / 2);
                if (!same(top - slotTop, over)) bad.push(`${at}: its status stands ${top - slotTop}px under its line's top, want ${over}`);
            }
            if (line.value !== null) {
                const room = SLOT - (line.status === null ? 0 : ICON + AFTER_ICON);
                const fits = line.value.width <= room + 0.5;
                if (line.value.drawn === "part") bad.push(`${at}: its value "${line.value.says}" is drawn in part`);
                else if ((line.value.drawn === "whole") !== fits) bad.push(`${at}: its value "${line.value.says}", ${line.value.width}px in ${room}px of room, is ${line.value.drawn === "whole" ? "drawn" : "not drawn"}`);
                if (line.value.drawn === "whole" && !same(line.value.right, slotEnd)) bad.push(`${at}: its value ends at ${line.value.right}px, want ${slotEnd}`);
            }
            if (line.caption !== null) {
                if (!same(line.caption.right, slotEnd)) bad.push(`${at}: its caption "${line.caption.says}" ends at ${line.caption.right}px, want ${slotEnd}`);
                if (line.caption.face !== "mono 10px 600" || line.caption.ink !== inks.label) bad.push(`${at}: its caption is ${line.caption.face} in ${line.caption.ink}, want mono 10px 600 in ${inks.label}`);
            }
        });
    }
    return bad;
}

/** A row's gutter among those read, by its id. */
function by(rows: readonly GutterRead[], id: string): GutterRead {
    const row = rows.find((r) => r.id === id);
    if (row === undefined) throw new Error(`no row ${id} is drawn, of ${rows.map((r) => r.id).join(" · ")}`);
    return row;
}

/** A row's first line: its name's. */
const lineOf = (rows: readonly GutterRead[], id: string): LineRead => by(rows, id).lines[0]!;

test.describe("Plan gutter line (#1749) @desktop", () => {
    test("planTargetState at the default gutter: every line is one grid — a caret's cell where the row folds, its name, and a 56px value slot at 171–227 on every row, lane and band; a level in by 20, a member's words under those of the row it is under", async ({ page }) => {
        const entry = await openExample(page, "planTargetState");
        const rows = await entry.evaluate(readGutter);
        expect(gutterFaults(rows, await inksOf(page))).toEqual([]);
        // The Plan's default gutter, and one slot down the canvas.
        expect([...new Set(rows.map((row) => row.width))]).toEqual([240]);
        expect([...new Set(rows.flatMap((row) => row.lines.map((line) => (line.slot === null ? "none" : `${line.slot[0]}–${line.slot[0] + line.slot[2]}`))))]).toEqual(["171–227"]);
        // Where each line starts, a level at a time: its caret's cell where it folds, then its name.
        const starts = (id: string) => {
            const line = lineOf(rows, id);
            return [line.caret === null ? null : line.caret - CARET / 2, line.title![0]];
        };
        expect({
            row: starts(rowId("ontime", "ontime")),
            band: starts(sectionId("vans-local")),
            member: starts(rowId("vans", "van1")),
            group: starts(rowId("halls", "Hall 1")),
            press: starts(rowId("presses", "Hall 1", "H1-P03")),
            folding: starts(rowId("rollup", "Contract A")),
            under: starts(rowId("rollup", "Contract A", "H1-P03")),
            foldingMember: starts(rowId("contracts", "Contract B")),
            underMember: starts(rowId("contracts", "Contract B", "H2-P12")),
        }).toEqual({
            row: [null, 12],
            band: [12, 32],
            member: [null, 32],
            group: [12, 32],
            press: [null, 32],
            folding: [12, 32],
            under: [null, 32],
            foldingMember: [32, 52],
            underMember: [null, 52],
        });
    });

    for (const theme of ["light", "dark"] as const) {
        test(`planTargetState (${theme}): a status is its tone's icon in a 12px box at the slot's start — 9 above and 10 below in a 32px row, 6 and 7 in a band's 25 — in its tone's ink, named by its status; a row with none draws none; each tone's ink is its own token`, async ({ page }) => {
            const entry = await openExample(page, "planTargetState", PLAN_EXAMPLES, theme);
            const inks = await inksOf(page);
            const rows = await entry.evaluate(readGutter);
            expect(gutterFaults(rows, inks)).toEqual([]);
            const status = (id: string) => ({ height: by(rows, id).height, ...lineOf(rows, id).status });
            const icon = (tone: string, top: number) => ({ tone, glyph: STATUS[tone]!.glyph, box: [171, top, 12, 12], ink: inks[tone], name: STATUS[tone]!.name });
            expect(status(rowId("presses", "Hall 1", "H1-P03"))).toEqual({ height: 32, ...icon("success", 9) });
            expect(status(rowId("presses", "Hall 1", "H1-P05"))).toEqual({ height: 32, ...icon("warning", 9) });
            expect(status(sectionId("vans-local"))).toEqual({ height: 26, ...icon("warning", 6) });
            expect(lineOf(rows, rowId("presses", "Hall 1", "H1-P04")).status).toBeNull();
            // Each tone's ink, worn by one icon in turn: four tokens, four colours.
            const worn = await entry.locator(`[data-plan-row=${JSON.stringify(rowId("presses", "Hall 1", "H1-P03"))}] [role='rowheader'] [role='img'][data-tone]`).evaluate((el, tones) => {
                const was = el.getAttribute("data-tone")!;
                const out = tones.map((tone) => {
                    el.setAttribute("data-tone", tone);
                    return [tone, getComputedStyle(el).color] as const;
                });
                el.setAttribute("data-tone", was);
                return Object.fromEntries(out);
            }, Object.keys(STATUS));
            expect(worn).toEqual(Object.fromEntries(Object.keys(STATUS).map((tone) => [tone, inks[tone]])));
            expect(new Set(Object.values(worn)).size).toBe(4);
        });
    }

    test("planTargetState: a value is whole at its slot's end — in the 40px its status leaves it, or its slot's 56 — or not drawn: the local deliveries' \"9 drops\", wider than the room its status leaves, is drawn nowhere at the default gutter nor at its widest, where its name's cell has the room and its count is whole again", async ({ page }) => {
        const entry = await openExample(page, "planTargetState");
        const inks = await inksOf(page);
        let rows = await entry.evaluate(readGutter);
        expect(gutterFaults(rows, inks)).toEqual([]);
        const value = (id: string) => {
            const drawn = lineOf(rows, id).value!;
            return [drawn.says, drawn.drawn, drawn.right];
        };
        expect(value(rowId("presses", "Hall 1", "H1-P03"))).toEqual(["12k/h", "whole", 227]);
        expect(value(rowId("presses", "Hall 1", "H1-P04"))).toEqual(["12k/h", "whole", 227]);
        const band = () => {
            const line = lineOf(rows, sectionId("vans-local"));
            return { width: by(rows, sectionId("vans-local")).width, value: [line.value!.says, line.value!.drawn], count: [line.meta!.says, line.meta!.whole] };
        };
        expect(band()).toEqual({ width: 240, value: ["9 drops", "none"], count: ["1 row", false] });
        // The gutter at its widest: the slot is the slot, whatever the gutter's width.
        await entry.getByRole("separator", { name: "Width of the row names" }).press("End");
        await settled(page);
        rows = await entry.evaluate(readGutter);
        expect(gutterFaults(rows, inks)).toEqual([]);
        expect(band()).toEqual({ width: 360, value: ["9 drops", "none"], count: ["1 row", true] });
    });

    test("planTargetState: a laned row's gutter is a line a lane, on the whole pixels its lanes stand on — its name on the first — each lane's caption at its line's slot's end, mono 10/600 in the label ink", async ({ page }) => {
        const entry = await openExample(page, "planTargetState");
        const inks = await inksOf(page);
        const rows = await entry.evaluate(readGutter);
        expect(gutterFaults(rows, inks)).toEqual([]);
        const van = by(rows, rowId("regional", "van2"));
        expect(van.height).toBe(50);
        expect(van.lines.map((line) => [line.box[1], line.box[3]])).toEqual([[0, 24], [25, 24]]);
        expect(van.lines.map((line) => line.title !== null)).toEqual([true, false]);
        const caption = (says: string) => ({ says, right: 227, face: "mono 10px 600", ink: inks.label });
        expect(van.lines.map((line) => line.caption)).toEqual([caption("AM"), caption("PM")]);
    });
});
