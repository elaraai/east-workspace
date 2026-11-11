/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The checks every builder runs of a row another session removes or adds
 * under its drafts (test use, #1599): what the builder draws of the row from
 * the other session's write until its own reads have landed, and what is left
 * to choose and to save.
 *
 * A builder's session hears of another session's write and reads its drafted
 * rows by their keys. The rows the builder draws are read apart from that — a
 * page, a window, a period at a time — a round trip a deployed server makes
 * long, and each builder keeps the screen right meanwhile in its own way. The
 * checks hold them all to what a person sees: they hold the builder's reads
 * at the harness's fetch, commit the other session's write, let the reads go
 * one at a time, and read what the builder draws of the row at every change
 * of the page.
 *
 * - {@link removedOnBothSides}: a row removed here that another session
 *   removes too is nothing to choose and nothing to save, and is never drawn
 *   again — not while the builder's rows, read before the other session's
 *   write, are read again.
 * - {@link removedThere}: a row changed here that another session removes
 *   stands as drafted until a person chooses, Save waiting on the choice:
 *   kept, the next Save puts the row back as drafted; let go, the row leaves
 *   and nothing is left to save.
 * - {@link removedHere}: a row removed here that another session changes
 *   stays off the builder until a person chooses, Save waiting on the choice:
 *   kept, the next Save removes it; let go, the row is back as the other
 *   session left it and nothing is left to save.
 *
 * A conflict's card names its row as the builder names it — its name, never
 * its key — whether the builder draws the row or the draft removed it.
 *
 * jsdom draws no frame, so a check sees every state a read's round trip
 * leaves on the page, and none that lasts less than a task.
 *
 * @packageDocumentation
 */

import { expect } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { editingMessages } from "@elaraai/east-ui-components";
import type { E3Match, TestE3 } from "../e3-web.test-utils.js";
import { act, conflictCards, settle, slot } from "../e3-web-mount.test-utils.js";

/** What a builder gives each check. */
export interface RemoteRow {
    /** The file's e3 (`h.e3`). */
    readonly e3: TestE3;
    /** The builder's container. */
    readonly container: HTMLElement;
    /**
     * The builder's own reads of the record the row is of — its window, its pages, its cells — which the check holds:
     * never the reads its session makes by key of the rows it drafted.
     */
    readonly reads: E3Match;
    /**
     * Whether the builder draws the row as one the record holds — on its grid or its board, and not as removed: read at
     * every change of the page, so it answers for a state it does not expect too.
     */
    readonly drawn: () => boolean;
    /** Another session's removal of the row: a commit of the record, the page then settled. */
    readonly theirRemoval: () => Promise<void>;
    /** Whether the record holds the row now. */
    readonly held: () => Promise<boolean>;
    /**
     * The row as the builder names it — a member's name, an event's title — which a conflict's card names it by: on
     * the builder or removed from it, never its key where it has a name.
     */
    readonly name: string;
}

/** What a builder gives the checks of a row removed here. */
export interface RemovedHere extends RemoteRow {
    /** The row removed here: a gesture, as a person makes it — its steps, where it takes more than one act. */
    readonly remove: (() => void | Promise<void>) | readonly (() => void | Promise<void>)[];
}

/** What a builder gives the checks of a row changed here. */
export interface ChangedHere extends RemoteRow {
    /** A change made here to the row: a gesture, as a person makes it — its steps, where it takes more than one act. */
    readonly change: (() => void | Promise<void>) | readonly (() => void | Promise<void>)[];
    /** What the builder draws of the change — what a cell says, where a card stands: the look the draft has. */
    readonly look: () => unknown;
}

/** The most reads let go one at a time: past it, a builder that keeps asking is let go whole. */
const MOST_READS = 200;

/** The shared history item's control in a builder's toolbar, by its words. */
const historyButton = (container: HTMLElement, name: string): HTMLButtonElement =>
    within(slot(container, "toolbar")).getByRole<HTMLButtonElement>("button", { name });
/** Whether changes wait on Save: the history's Discard, which drops them, is on. */
const unsaved = (container: HTMLElement): boolean => !historyButton(container, editingMessages.discard()).disabled;
/** Whether a button of the history bar is off: disabled, or waiting with the focus kept. */
const off = (button: HTMLButtonElement): boolean => button.disabled || button.getAttribute("aria-disabled") === "true";

/** A gesture's steps, each an act of its own, the page settled between them as it is between a person's acts. */
async function made(gesture: (() => void | Promise<void>) | readonly (() => void | Promise<void>)[]): Promise<void> {
    for (const step of typeof gesture === "function" ? [gesture] : gesture) {
        await act(async () => { await step(); });
        await settle();
    }
}

/** Every look a builder takes from now on, each once as it changes: what reads it, and what stops the reading. */
function watched<T>(container: HTMLElement, look: () => T): { readonly looks: T[]; readonly read: () => void; readonly stop: () => void } {
    const print = (value: T): string => JSON.stringify(value);
    const looks: T[] = [look()];
    const read = (): void => {
        const now = look();
        if (print(looks[looks.length - 1]!) !== print(now)) looks.push(now);
    };
    const observer = new MutationObserver(read);
    observer.observe(container, { subtree: true, childList: true, attributes: true, characterData: true });
    return { looks, read, stop: () => { observer.disconnect(); } };
}

/**
 * A row removed here that another session removes too (see the module docs): nothing to choose, nothing left to
 * save, and the row never drawn again — while the builder's own reads are held, as they land one at a time, and once
 * they have all landed.
 *
 * @param check - The builder's e3, its container, its reads, the row and the two removals
 * @returns Once the other session's removal is heard and the builder's reads have landed
 * @throws An assertion's error where the row is drawn again, a conflict is asked, or a change is left to save
 */
export async function removedOnBothSides(check: RemovedHere): Promise<void> {
    expect(check.drawn(), "the builder draws the row to begin with").toBe(true);
    await made(check.remove);
    expect(check.drawn(), "removed here, the row is off the builder").toBe(false);
    expect(unsaved(check.container), "the removal waits to be saved").toBe(true);
    const { looks, read, stop } = watched(check.container, check.drawn);
    const held = check.e3.hold(check.reads);
    try {
        await check.theirRemoval();
        // The draft is the record's now: nothing is left to save, and nothing to choose.
        await waitFor(() => expect(unsaved(check.container), "removed on both sides, nothing is left to save").toBe(false), { timeout: 5_000 });
        await settle();
        read();
        expect(looks, "while the builder's reads of the record are held").toEqual([false]);
        for (let n = 1; held.held > 0 && n <= MOST_READS; n++) {
            await act(async () => { held.releaseOne(); });
            await settle();
            read();
            expect(looks, `once ${n} of the builder's reads of the record landed, the rest held`).toEqual([false]);
        }
    } finally {
        await act(async () => { held.release(); });
    }
    try {
        await settle();
        read();
        expect(looks, "once the builder's reads of the record have landed").toEqual([false]);
    } finally {
        stop();
    }
    expect(check.container.querySelector("[data-conflicts]"), "nothing to choose").toBeNull();
    expect(await check.held(), "the record holds the row no more").toBe(false);
}

/**
 * A row changed here that another session removes (see the module docs): the row stands as drafted — while the
 * builder's own reads are held, and as they land — with one conflict to choose and Save waiting on it; then the choice.
 *
 * @param check - The builder's e3, its container, its reads, the row, the change and the other session's removal
 * @param choice - Which side is taken: the draft kept, and saved; or the other session's removal
 * @returns Once the choice is made, and — the draft kept — saved
 * @throws An assertion's error where the row leaves before a person chooses, no conflict is asked, or the choice ends otherwise than it says
 */
export async function removedThere(check: ChangedHere, choice: "draft" | "source"): Promise<void> {
    expect(check.drawn(), "the builder draws the row to begin with").toBe(true);
    await made(check.change);
    const drafted = JSON.stringify(check.look());
    expect(unsaved(check.container), "the change waits to be saved").toBe(true);
    const { looks, read, stop } = watched(check.container, () => [check.drawn(), JSON.stringify(check.look())] as const);
    const stood = [[true, drafted]];
    const held = check.e3.hold(check.reads);
    try {
        await check.theirRemoval();
        await waitFor(() => expect(check.container.querySelector("[data-conflicts]"), "the removal of a row changed here is a conflict to choose").not.toBeNull(), { timeout: 5_000 });
        await settle();
        read();
        expect(looks, "while the builder's reads of the record are held, the row stands as drafted").toEqual(stood);
        for (let n = 1; held.held > 0 && n <= MOST_READS; n++) {
            await act(async () => { held.releaseOne(); });
            await settle();
            read();
            expect(looks, `once ${n} of the builder's reads of the record landed, the rest held`).toEqual(stood);
        }
    } finally {
        await act(async () => { held.release(); });
    }
    await settle();
    read();
    stop();
    expect(looks, "once the builder's reads of the record have landed, the row stands as drafted still").toEqual(stood);
    // Save waits on the choice.
    expect(off(historyButton(check.container, editingMessages.apply())), "Save waits on the conflict").toBe(true);
    const [card, ...more] = await conflictCards(check.container);
    expect(more, "one conflict, the row's").toEqual([]);
    expect(card!.item, "the card names the row as the builder names it").toBe(check.name);
    expect(card!.theirs, "the other side reads removed").toContain(`, ${editingMessages.conflictRemoved()}`);
    await act(async () => { fireEvent.click(card!.radio(choice)); });
    await settle();
    if (choice === "source") {
        await waitFor(() => expect(check.drawn(), "their removal taken, the row leaves").toBe(false), { timeout: 5_000 });
        await waitFor(() => expect(unsaved(check.container), "nothing is left to save").toBe(false), { timeout: 5_000 });
        expect(await check.held()).toBe(false);
        return;
    }
    // Kept: the row is the draft's to put back, and Save is on.
    expect(off(historyButton(check.container, editingMessages.apply())), "the draft kept, Save is on").toBe(false);
    expect([check.drawn(), JSON.stringify(check.look())], "the row stands as drafted").toEqual([true, drafted]);
    await act(async () => { fireEvent.click(historyButton(check.container, editingMessages.apply())); });
    await settle();
    await waitFor(() => expect(unsaved(check.container), "the row is saved").toBe(false), { timeout: 5_000 });
    await settle();
    expect(await check.held(), "the record holds the row again").toBe(true);
    expect([check.drawn(), JSON.stringify(check.look())], "saved, the row stands as drafted").toEqual([true, drafted]);
}

/** What a builder gives the check of a row removed here that another session changes. */
export interface RemovedHereChangedThere extends RemovedHere {
    /** Another session's change of the row: a commit of the record, the page then settled. */
    readonly theirChange: () => Promise<void>;
}

/**
 * A row removed here that another session changes (see the module docs): the row stays off the builder — while its
 * own reads are held, and as they land — with one conflict to choose and Save waiting on it; then the choice.
 *
 * @param check - The builder's e3, its container, its reads, the row, the removal and the other session's change
 * @param choice - Which side is taken: the removal kept, and saved; or the other session's row
 * @returns Once the choice is made, and — the removal kept — saved
 * @throws An assertion's error where the row is drawn before a person chooses, no conflict is asked, or the choice ends otherwise than it says
 */
export async function removedHere(check: RemovedHereChangedThere, choice: "draft" | "source"): Promise<void> {
    expect(check.drawn(), "the builder draws the row to begin with").toBe(true);
    await made(check.remove);
    expect(check.drawn(), "removed here, the row is off the builder").toBe(false);
    const { looks, read, stop } = watched(check.container, check.drawn);
    const held = check.e3.hold(check.reads);
    try {
        await check.theirChange();
        await waitFor(() => expect(check.container.querySelector("[data-conflicts]"), "the change of a row removed here is a conflict to choose").not.toBeNull(), { timeout: 5_000 });
        await settle();
        read();
        expect(looks, "while the builder's reads of the record are held, the removal stands").toEqual([false]);
        for (let n = 1; held.held > 0 && n <= MOST_READS; n++) {
            await act(async () => { held.releaseOne(); });
            await settle();
            read();
            expect(looks, `once ${n} of the builder's reads of the record landed, the rest held`).toEqual([false]);
        }
    } finally {
        await act(async () => { held.release(); });
    }
    await settle();
    read();
    stop();
    expect(looks, "once the builder's reads of the record have landed, the removal stands still").toEqual([false]);
    expect(off(historyButton(check.container, editingMessages.apply())), "Save waits on the conflict").toBe(true);
    const [card, ...more] = await conflictCards(check.container);
    expect(more, "one conflict, the row's").toEqual([]);
    expect(card!.item, "the card names the row removed here as the builder named it, never by its key").toBe(check.name);
    expect(card!.yours, "this side reads removed").toBe(`${editingMessages.conflictYours()}, ${editingMessages.conflictRemoved()}`);
    await act(async () => { fireEvent.click(card!.radio(choice)); });
    await settle();
    if (choice === "source") {
        await waitFor(() => expect(check.drawn(), "their row taken, it is back on the builder").toBe(true), { timeout: 5_000 });
        await waitFor(() => expect(unsaved(check.container), "nothing is left to save").toBe(false), { timeout: 5_000 });
        expect(await check.held()).toBe(true);
        return;
    }
    expect(off(historyButton(check.container, editingMessages.apply())), "the removal kept, Save is on").toBe(false);
    await act(async () => { fireEvent.click(historyButton(check.container, editingMessages.apply())); });
    await settle();
    await waitFor(() => expect(unsaved(check.container), "the removal is saved").toBe(false), { timeout: 5_000 });
    await settle();
    expect(await check.held(), "the record holds the row no more").toBe(false);
    expect(check.drawn(), "saved, the row is off the builder").toBe(false);
}
