/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The check every builder runs of a Save whose reads come back late (test
 * use): from the press of Save until the builder's own reads of what it saved
 * have landed, the builder never draws what the Save wrote as it stood before.
 *
 * A Save's commit is confirmed by reads of its own. The rows a builder draws
 * are read again apart from them — a round trip a deployed server makes long —
 * and each builder keeps what the Save left on screen meanwhile in its own
 * way: its session's drafts until its own read lands, its read taking the
 * edits, or its session's landed rows (east-ui-components' `readBeforeSave`).
 * The check holds them all to what a person sees. It holds the builder's
 * reads at the harness's fetch, presses Save, then lets them go one at a time
 * — as answers land apart on a deployed server, each read the page asks as
 * another lands held in its turn — and reads what the builder draws of the
 * edit at every change of the page, until the Save is confirmed and no read is
 * left: every look it read is the look the draft had.
 *
 * jsdom draws no frame, so the check sees every state a read's round trip
 * leaves on the page, and none that lasts less than a task: a frame drawn
 * between an effect and the commit after it is the browser suite's to hold.
 *
 * A second check holds a Save to never stopping the editing
 * ({@link editedThroughReload}): while the builder's reads of what it saved
 * are held — its rows standing in from before the Save — a gesture on a row
 * the Save did not hold is taken and drawn at once, stays drawn as the reads
 * land one at a time, and is the next Save's to send.
 *
 * A third holds the same through the page being evaluated again
 * ({@link redrawnThroughReload}). A page's host evaluates its body again
 * whenever something it reads moves — a State the app keeps, a dataset it
 * reads whole — and every handle the body binds is bound again, every function
 * a builder's tag makes over one made again. Nothing the builder reads has
 * moved, so nothing it draws may: while its reads of what it saved are held,
 * and as they land one at a time, the page is evaluated again at every step,
 * and every look is the look it had — no row leaves the board for a read on
 * its way — and the gesture made meanwhile is taken, stays drawn and is the
 * next Save's.
 *
 * @packageDocumentation
 */

import { expect } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { editingMessages } from "@elaraai/east-ui-components";
import type { E3Match, TestE3 } from "../e3-web.test-utils.js";
import { act, evaluateAgain, settle, slot } from "../e3-web-mount.test-utils.js";

/** What a builder gives the check. */
export interface SavedThroughReload {
    /** The file's e3 (`h.e3`). */
    readonly e3: TestE3;
    /** The builder's container. */
    readonly container: HTMLElement;
    /**
     * The builder's own reads of the record it saves — its window, its pages, its cells — which the check holds: never
     * the Save's request, nor the reads its confirmation makes by key where the builder draws from other reads.
     */
    readonly reads: E3Match;
    /**
     * What the builder draws of what the draft changed, as a person sees it — where a card stands, what a cell says —
     * and nothing a draft's look adds: read at every change of the page, so it answers for a state it does not expect
     * too (an element gone is a look, never a throw).
     */
    readonly look: () => unknown;
    /** Presses Save, where it is not the shared history item's Save in the builder's toolbar. */
    readonly save?: (() => void) | undefined;
    /** Whether the builder shows changes not yet saved, where the shared history item's Discard does not say so. */
    readonly unsaved?: (() => boolean) | undefined;
}

/** The most reads let go one at a time: past it, a builder that keeps asking is let go whole. */
const MOST_READS = 200;

/** The shared history item's control in a builder's toolbar, by its words. */
const historyButton = (container: HTMLElement, name: string): HTMLButtonElement =>
    within(slot(container, "toolbar")).getByRole<HTMLButtonElement>("button", { name });

/**
 * Saves a builder's draft with its own reads held, lets them go one at a time, and holds every look the builder drew
 * meanwhile to the look the draft had (see the module docs).
 *
 * @param check - The builder's e3, its container, its reads and its look
 * @returns Once the Save is confirmed and its reads have landed
 * @throws An assertion's error where a look differs: the looks read, in order, against the draft's
 */
export async function savedThroughReload(check: SavedThroughReload): Promise<void> {
    const save = check.save ?? ((): void => { fireEvent.click(historyButton(check.container, editingMessages.apply())); });
    // Changes wait on Save while the history's Discard, which drops them, is on.
    const unsaved = check.unsaved ?? ((): boolean => !historyButton(check.container, editingMessages.discard()).disabled);
    expect(unsaved(), "the builder holds a draft to save").toBe(true);
    const print = (): string => JSON.stringify(check.look());
    const drafted = print();
    // Every look the page takes from here on, each once as it changes.
    const looks: string[] = [drafted];
    const read = (): void => {
        const now = print();
        if (looks[looks.length - 1] !== now) looks.push(now);
    };
    const observer = new MutationObserver(read);
    observer.observe(check.container, { subtree: true, childList: true, attributes: true, characterData: true });
    const held = check.e3.hold(check.reads);
    try {
        await act(async () => { save(); });
        // The Save is on its way: the builder asks for its rows again, and the read is held.
        await waitFor(() => expect(held.held, "the builder reads what it saved again").toBeGreaterThan(0), { timeout: 5_000 });
        await settle();
        read();
        expect(looks, "while the builder's reads of what it saved are held").toEqual([drafted]);
        // Let go one at a time: a read the page asks as another lands is held in its turn, so no two land together.
        for (let n = 1; held.held > 0 && n <= MOST_READS; n++) {
            await act(async () => { held.releaseOne(); });
            await settle();
            read();
            expect(looks, `once ${n} of the builder's reads of what it saved landed, the rest held`).toEqual([drafted]);
        }
    } finally {
        await act(async () => { held.release(); });
    }
    try {
        await settle();
        await waitFor(() => expect(unsaved()).toBe(false), { timeout: 5_000 });
        await settle();
        read();
        expect(looks, "once the builder's reads of what it saved have landed").toEqual([drafted]);
    } finally {
        observer.disconnect();
    }
}

/** What a builder gives the check of an edit made while its rows are read again. */
export interface EditedThroughReload extends SavedThroughReload {
    /**
     * A second gesture, made while the builder's reads of what it saved are held: on a row the Save did not hold — one
     * whose original the builder reads from its own rows — as a person makes it on what the page shows. Given as its
     * steps where it takes more than one act of the person's — a row picked, then a button of its form pressed — the
     * page settling between them, as it does between a person's acts: what one step leaves the page to draw a moment
     * later (a pane's body, drawn after what selected it) is there for the next.
     */
    readonly again: (() => void | Promise<void>) | readonly (() => void | Promise<void>)[];
}

/**
 * Saves a builder's draft with its own reads held and, while they are, makes a second gesture: it is drawn at once,
 * every look the builder draws from then on is the look it left — as the held reads land one at a time, and once the
 * first Save is confirmed — and it waits to be saved, a second Save writing it (see the module docs).
 *
 * @param check - The builder's e3, its container, its reads, its look and the second gesture
 * @returns Once both Saves are confirmed and their reads have landed
 * @throws An assertion's error where the gesture is not taken, or a look differs from the one it left
 */
export function editedThroughReload(check: EditedThroughReload): Promise<void> {
    return editedThrough(check, undefined);
}

/**
 * {@link editedThroughReload}, with the page evaluated again at every step (see the module docs): once the builder's
 * reads of what it saved are held, before the second gesture — every look from the press of Save on the look the
 * draft had — and after it, as each held read lands, once all have and once the second Save is confirmed — every
 * look the look the gesture left.
 *
 * @param check - The builder's e3, its container, its reads, its look and the second gesture
 * @returns Once both Saves are confirmed and their reads have landed
 * @throws An assertion's error where the page evaluated again takes a row off the builder, the gesture is not taken, or
 *   a look differs from the one it left
 */
export function redrawnThroughReload(check: EditedThroughReload): Promise<void> {
    return editedThrough(check, evaluateAgain);
}

/**
 * The run {@link editedThroughReload} and {@link redrawnThroughReload} make.
 *
 * @param check - The builder's e3, its container, its reads, its look and the second gesture
 * @param redraw - What evaluates the page again, for the check that does; `undefined` for the one that does not
 */
async function editedThrough(check: EditedThroughReload, redraw: (() => Promise<void>) | undefined): Promise<void> {
    const save = check.save ?? ((): void => { fireEvent.click(historyButton(check.container, editingMessages.apply())); });
    const unsaved = check.unsaved ?? ((): boolean => !historyButton(check.container, editingMessages.discard()).disabled);
    expect(unsaved(), "the builder holds a draft to save").toBe(true);
    const print = (): string => JSON.stringify(check.look());
    const drafted = print();
    // Every look the page takes, each once as it changes, from the look it is held to.
    let looks: string[] = [drafted];
    const read = (): void => {
        const now = print();
        if (looks[looks.length - 1] !== now) looks.push(now);
    };
    let observer: MutationObserver | undefined;
    const observe = (): void => {
        observer = new MutationObserver(read);
        observer.observe(check.container, { subtree: true, childList: true, attributes: true, characterData: true });
    };
    const held = check.e3.hold(check.reads);
    try {
        // The page evaluated again is held to the look the draft had from the press of Save on.
        if (redraw !== undefined) observe();
        await act(async () => { save(); });
        await waitFor(() => expect(held.held, "the builder reads what it saved again").toBeGreaterThan(0), { timeout: 5_000 });
        await settle();
        expect(print(), "while the builder's reads of what it saved are held").toBe(drafted);
        if (redraw !== undefined) {
            await redraw();
            read();
            expect(looks, "once the page is evaluated again while the builder's reads of what it saved are held").toEqual([drafted]);
        }
        // The second gesture, on what the page shows while its rows are read again: taken, and drawn at once. Each step
        // is an act of its own: what a step leaves React to draw later is drawn only once its act is over.
        for (const step of typeof check.again === "function" ? [check.again] : check.again) {
            await act(async () => { await step(); });
            await settle();
        }
        const edited = print();
        expect(edited, "a gesture made while the builder's rows are read again is drawn at once").not.toBe(drafted);
        // Every look from here on is the look it left.
        looks = [edited];
        if (observer === undefined) observe();
        const again = async (when: string): Promise<void> => {
            if (redraw === undefined) return;
            await redraw();
            read();
            expect(looks, `once the page is evaluated again ${when}`).toEqual([edited]);
        };
        await again("after the gesture, the builder's reads of what it saved still held");
        for (let n = 1; held.held > 0 && n <= MOST_READS; n++) {
            await act(async () => { held.releaseOne(); });
            await settle();
            read();
            expect(looks, `once ${n} of the builder's reads of what it saved landed, the rest held`).toEqual([edited]);
            await again(`with ${n} of the builder's reads of what it saved landed, the rest held`);
        }
        await act(async () => { held.release(); });
        await settle();
        read();
        expect(looks, "once the builder's reads of what it saved have landed").toEqual([edited]);
        await again("with the builder's reads of what it saved landed");
        // The first Save confirmed, the second gesture is what is left to save: a press writes it.
        await waitFor(() => expect(historyButton(check.container, editingMessages.apply()).disabled, "the second gesture waits to be saved").toBe(false), { timeout: 5_000 });
        expect(unsaved(), "the second gesture is a draft still").toBe(true);
        await act(async () => { save(); });
        await settle();
        await waitFor(() => expect(unsaved()).toBe(false), { timeout: 5_000 });
        await settle();
        read();
        expect(looks, "once the second Save is confirmed").toEqual([edited]);
        await again("once the second Save is confirmed");
    } finally {
        observer?.disconnect();
        await act(async () => { held.release(); });
    }
}
