/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE for details.
 */

/**
 * What a period builder keeps while a narrowing is read (#1398, CL5), on the
 * real in-page e3, in both themes: the Roster, the Calendar and the
 * Allocation each keep the period they show while a rail choice's read is
 * held through the showcase's e3 fault hook (`e3-faults.ts`). Main is marked
 * retained (CL8) — `aria-disabled`, never inert, its items readable and
 * focusable — while the toolbar stays live; the retained cells' rules are
 * dashed in the strong rule and the retained items' words are in the third
 * ink (the shared `retainedRow` and `retainedColumn`); and once the read lands
 * every rule is drawn solid again.
 */

import { expect, test, type Locator, type Page } from "playwright/test";
import { sizeBuilder, visitBuilder } from "./builder-page";
import { RECORD_READS, holdE3, installE3Faults, releaseE3 } from "./e3-faults";
import { recordField } from "./record-slice";
import { settled } from "./settle";
import { token } from "./tokens";

/** A builder's narrowing, and what of its main it keeps while the narrowing is read. */
interface Retaining {
    readonly name: string;
    readonly route: string;
    readonly root: string;
    /** Its own main, and the attribute that main carries while it keeps what it shows. */
    readonly main: string;
    readonly stale: string;
    /** The rail's field the spec chooses from, and the choice. */
    readonly source: string;
    readonly field: string;
    readonly choice: RegExp;
    /** The retained cells, and which of their rules each draws. */
    readonly rules: readonly { readonly selector: string; readonly side: "Left" | "Bottom" }[];
    /** The retained items whose words take the third ink. */
    readonly words: string;
    /** What the spec does before it narrows: the view it reads. */
    readonly prepare?: (frame: Locator) => Promise<void>;
}

const BUILDERS: readonly Retaining[] = [
    {
        name: "the Roster's shifts", route: "e3/roster/roster/rosterWarehouse", root: "[data-roster-frame]", main: "[data-roster-main]", stale: "data-roster-stale",
        source: "people", field: "team", choice: /^inbound/i,
        rules: [{ selector: "[data-roster-slot]", side: "Left" }], words: "[data-roster-assignment]",
    },
    {
        name: "the Calendar's week", route: "e3/calendar/calendar/calendarOperations", root: "[data-calendar-frame]", main: "[data-calendar-main]", stale: "data-calendar-stale",
        source: "job", field: "status", choice: /^active/i,
        rules: [{ selector: "[data-calendar-time-grid] [data-calendar-cell]", side: "Left" }], words: "[data-calendar-time-grid] [data-calendar-event]",
        prepare: async (frame) => {
            await frame.locator('[data-frame-slot="toolbar"]').getByRole("radio", { name: "Week", exact: true }).click();
        },
    },
    {
        name: "the Allocation's timeline", route: "e3/allocation/allocation/allocationKilnYard", root: "[data-allocation-frame]", main: "[data-allocation-main]", stale: "data-allocation-stale",
        source: "kilns", field: "group", choice: /^Hall A/,
        rules: [{ selector: "[data-allocation-grid] [data-allocation-cell]", side: "Left" }, { selector: "[data-allocation-grid] [data-allocation-band]", side: "Bottom" }],
        words: "[data-allocation-timeline] [data-allocation-card]",
    },
];

/**
 * How the retained parts draw: each rule's style and colour, the items' words' colour, whether main is aria-disabled or
 * inert, and whether the toolbar takes gestures.
 */
function drawn(frame: Locator, builder: Retaining) {
    return frame.evaluate((root, { main: own, rules, words }) => {
        const main = root.querySelector<HTMLElement>(own)!;
        const toolbar = root.querySelector<HTMLElement>('[data-frame-slot="toolbar"]')!;
        const sides = rules.flatMap(({ selector, side }) => [...root.querySelectorAll<HTMLElement>(selector)].slice(0, 12).map((cell) => {
            const s = getComputedStyle(cell);
            return { style: s.getPropertyValue(`border-${side.toLowerCase()}-style`), color: s.getPropertyValue(`border-${side.toLowerCase()}-color`) };
        }));
        const items = [...root.querySelectorAll<HTMLElement>(words)].slice(0, 6).map((item) => getComputedStyle(item).color);
        return {
            sides, items, disabled: main.getAttribute("aria-disabled") === "true", inert: main.closest("[inert]") !== null,
            toolbar: toolbar.closest("[inert]") === null,
        };
    }, { main: builder.main, rules: builder.rules, words: builder.words });
}

/** Whether the first retained item takes the focus: retained content stays focusable (CL8), as inert content never is. */
function focusable(frame: Locator, builder: Retaining) {
    return frame.evaluate((root, words) => {
        const item = root.querySelector<HTMLElement>(words);
        item?.focus({ preventScroll: true });
        return item !== null && item.ownerDocument.activeElement === item;
    }, builder.words);
}

/** Chooses the builder's narrowing through its rail, the read already held. */
async function narrow(page: Page, frame: Locator, builder: Retaining): Promise<number> {
    const editor = await recordField(page, frame, builder.field, builder.source);
    const choice = editor.getByRole("button", { name: builder.choice }).first();
    await expect(choice).toBeVisible();
    const held = await holdE3(page, { kinds: [...RECORD_READS] });
    await choice.click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    return held;
}

for (const theme of ["light", "dark"] as const) {
    for (const builder of BUILDERS) {
        test(`${builder.name}: while a narrowing is read the period stands in, retained — its rules dashed in the strong rule, its items' words in the third ink, main aria-disabled and never inert, its items focusable, the toolbar live — then drawn as before (#1398, CL5, CL8) (${theme}) @desktop`, async ({ page }) => {
            test.setTimeout(240_000);
            await installE3Faults(page);
            await page.setViewportSize({ width: 2560, height: 1200 });
            const entry = await visitBuilder(page, builder.route, builder.root, theme);
            await sizeBuilder(page, entry, builder.root, 1440);
            const frame = entry.locator(builder.root).first();
            if (builder.prepare !== undefined) {
                await builder.prepare(frame);
                await settled(page);
            }
            const [subtle, strong, muted] = await Promise.all([token(page, "border-subtle"), token(page, "border-strong"), token(page, "fg-muted")]);
            const before = await drawn(frame, builder);
            expect(before.sides.length, "retained cells to measure").toBeGreaterThan(0);
            expect(before.items.length, "retained items to measure").toBeGreaterThan(0);
            expect(before.sides.every((side) => side.style === "solid" && side.color === subtle), JSON.stringify(before.sides)).toBe(true);
            expect(before.items.every((color) => color !== muted), JSON.stringify(before.items)).toBe(true);

            const held = await narrow(page, frame, builder);
            await settled(page, { holding: true });
            await expect(frame.locator(`[${builder.stale}]`)).toHaveCount(1);
            const kept = await drawn(frame, builder);
            expect(kept.sides.length).toBe(before.sides.length);
            expect(kept.sides.every((side) => side.style === "dashed" && side.color === strong), JSON.stringify(kept.sides)).toBe(true);
            expect(kept.items.length).toBe(before.items.length);
            expect(kept.items.every((color) => color === muted), JSON.stringify(kept.items)).toBe(true);
            expect([kept.disabled, kept.inert, kept.toolbar]).toEqual([true, false, true]);
            expect(await focusable(frame, builder), "a retained item takes the focus").toBe(true);

            await releaseE3(page, held);
            await expect(frame.locator(`[${builder.stale}]`)).toHaveCount(0, { timeout: 30_000 });
            await settled(page);
            const after = await drawn(frame, builder);
            expect(after.sides.length).toBeGreaterThan(0);
            expect(after.sides.every((side) => side.style === "solid" && side.color === subtle), JSON.stringify(after.sides)).toBe(true);
            expect([after.disabled, after.inert, after.toolbar]).toEqual([false, false, true]);
        });
    }
}
