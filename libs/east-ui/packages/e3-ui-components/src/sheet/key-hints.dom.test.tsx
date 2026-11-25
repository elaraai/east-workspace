/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The key hints (east-workspace#1743), over the Sheet's workshop and the
 * Record's crew deployed to e3 itself: on a fine pointer the footer and the
 * strip name only the keys nobody would guess — the footer at rest its
 * `⌘C / ⌘V`, a link editor's strip its `⇥ take` — and a coarse pointer, which
 * has no keys to press, names none: not the Sheet's footer, not its strip in a
 * frame wide enough to edit in place — its label included, which on a fine
 * pointer leads with `⌥]`, the key that steps the armed candidate — and not
 * the Record's strip, a cycle's own keys included. What a hint says that is no key stays: with whole rows
 * selected, a coarse pointer's footer still says how many.
 */

import { describe, expect, test } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import * as exRecord from "@elaraai/e3-ui/examples/record/record";
import * as exSheet from "@elaraai/e3-ui/examples/sheet/sheet";
import { settle, sheetHarness } from "./frame/harness.test-utils.js";
import { touchFrame } from "./frame.test-utils.js";
// The Record is an extension: its renderer registers as it loads.
import "../record/index.js";

const h = sheetHarness({ modules: { "sheet/sheet": exSheet, "record/record": exRecord }, frame: 2000 });

/** The footer's key hint, as it reads: its hints, each whole. */
const footerHints = (container: HTMLElement) =>
    [...container.querySelectorAll('[data-slot="footerHint"] [data-footer-unit]')].map((unit) => unit.textContent);
/** The strip's keys, or `undefined` where it names none. */
const stripKeys = (container: HTMLElement) => container.querySelector('[data-slot="strip"] [data-slot="stripKeys"]')?.textContent;
/** The strip's label, as it reads. */
const stripLabel = (container: HTMLElement) => container.querySelector('[data-slot="strip"] [data-slot="stripLabel"]')?.textContent;

/** The workshop's first Machines cell with its editor open, and a member's first letters typed: the strip offers candidates. */
async function typedInMachines(container: HTMLElement) {
    const cell = container.querySelector<HTMLElement>('[data-slot="row"] [data-slot="cell"][data-key="machines"]')!;
    fireEvent.doubleClick(cell);
    await settle();
    const input = await waitFor(() => {
        const open = cell.querySelector<HTMLInputElement>('[data-slot="editorInput"]');
        expect(open).not.toBeNull();
        return open!;
    });
    fireEvent.input(input, { target: { value: "S1" } });
    await settle();
    await waitFor(() => expect(container.querySelectorAll('[data-slot="strip"] [data-slot="stripChip"]').length).toBeGreaterThan(0));
}

/** Ticks the first row's checkbox: whole rows selected. */
async function tickFirstRow(container: HTMLElement) {
    fireEvent.click(container.querySelector<HTMLElement>('[data-slot="row"] [data-slot="checkbox"]')!);
    await settle();
}

describe("the Sheet's key hints (east-workspace#1743)", () => {
    test("on a fine pointer the footer at rest names ⌘C / ⌘V alone, and a link editor's strip its ⇥ take", async () => {
        const { container } = await h.mount(exSheet.sheetWorkshop, { storageKey: "key-hints-fine" });
        expect(footerHints(container)).toEqual(["⌘C / ⌘V round-trips with Excel"]);
        await typedInMachines(container);
        expect(stripKeys(container)).toContain("⇥ take");
        // Several candidates: the label leads with the key that steps the armed one.
        expect(stripLabel(container)).toBe("⌥] WORK CENTRES · to");
    });

    test("on a coarse pointer, in a frame wide enough to edit in place, neither the footer nor the strip names a key", async () => {
        const restore = touchFrame(1024);
        try {
            const { container } = await h.mount(exSheet.sheetWorkshop, { storageKey: "key-hints-coarse" });
            expect(container.querySelector("[data-builder-frame][data-phone]")).toBeNull();
            expect(footerHints(container)).toEqual([]);
            await typedInMachines(container);
            expect(stripKeys(container)).toBeUndefined();
            expect(stripLabel(container)).toBe("WORK CENTRES · to");
        } finally {
            restore();
        }
    });
});

describe("whole rows selected: how many is no key (east-workspace#1743)", () => {
    test("on a fine pointer the footer says how many, then the keys that act on them", async () => {
        const { container } = await h.mount(exSheet.sheetWorkshop, { storageKey: "key-hints-rows-fine" });
        await tickFirstRow(container);
        const hints = footerHints(container);
        expect(hints[0]).toMatch(/^\d+ rows? selected$/);
        expect(hints.slice(1)).toEqual([" · ⌫ deletes them", " · ⌘C copies"]);
    });

    test("on a coarse pointer the footer says how many, and names no key", async () => {
        const restore = touchFrame(1024);
        try {
            const { container } = await h.mount(exSheet.sheetWorkshop, { storageKey: "key-hints-rows-coarse" });
            await tickFirstRow(container);
            const hints = footerHints(container);
            expect(hints).toHaveLength(1);
            expect(hints[0]).toMatch(/^\d+ rows? selected$/);
        } finally {
            restore();
        }
    });
});

describe("the Record's key hints (east-workspace#1743)", () => {
    test("on a coarse pointer its strip names no key, a cycle's own included", async () => {
        const restore = touchFrame(390);
        try {
            const { container } = await h.mount(exRecord.recordBasic, { storageKey: "key-hints-record-coarse" });
            const forklift = container.querySelector<HTMLElement>('[data-record] [data-slot="row"] [data-slot="cell"][data-key="forklift"]')!;
            fireEvent.mouseDown(forklift, { button: 0 });
            fireEvent.click(forklift);
            await settle();
            const strip = await waitFor(() => {
                const shown = container.querySelector<HTMLElement>("[data-record] [data-record-strip]");
                expect(shown).not.toBeNull();
                return shown!;
            });
            expect(strip.querySelector('[data-slot="stripLabel"]')!.textContent).toBe("Forklift · 0");
            expect(strip.querySelector('[data-slot="stripKeys"]')).toBeNull();
        } finally {
            restore();
        }
    });
});
