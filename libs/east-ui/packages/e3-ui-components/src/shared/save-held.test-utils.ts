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
 * @packageDocumentation
 */

import { expect } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { editingMessages } from "@elaraai/east-ui-components";
import type { E3Match, TestE3 } from "../e3-web.test-utils.js";
import { act, settle, slot } from "../e3-web-mount.test-utils.js";

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
