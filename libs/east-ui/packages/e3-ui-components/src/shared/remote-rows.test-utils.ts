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
 *   and nothing is left to save. Over a record read a window at a time the
 *   check runs both ways round: the session's read of the row landing first,
 *   the builder's own rows held — and the builder's rows landing first, read
 *   again without the row while the session has yet to read it by its key.
 *   There the session still holds the row as one its record holds, and a
 *   builder that takes a drafted row its rows do not hold for one a narrowing
 *   hides drew nothing of it until the session's read landed.
 * - {@link removedThereAtSave}: the same row, removed by another session
 *   before the page has heard of it, and Save pressed over it. e3 takes no
 *   change of a row it holds no more: the Save is refused, and the row stands
 *   as drafted through the refusal, as the page hears why and reads its rows
 *   again — one conflict to choose, then as {@link removedThere} ends.
 * - {@link removedHere}: a row removed here that another session changes
 *   stays off the builder until a person chooses, Save waiting on the choice:
 *   kept, the next Save removes it; let go, the row is back as the other
 *   session left it and nothing is left to save.
 *
 * - {@link removedHereAtSave}: the same row, changed by another session before
 *   the page has heard of it, and Save pressed over the removal. e3 removes no
 *   row that is no longer as the session read it: the Save is refused, the
 *   row stays off the builder through the refusal and as the page hears why —
 *   one conflict to choose, then as {@link removedHere} ends.
 *
 * - {@link addedOnBothSides}: a row added here under a key the builder made,
 *   which another session saves a row of its own under, is a second new row,
 *   never the same one changed both ways — either choice between them would
 *   lose one. It goes on under another key the builder makes: both drawn,
 *   nothing to choose, and Save keeps both.
 *
 * - {@link addedOnBothSidesAtSave}: the same row, its key taken by another
 *   session's own new row before the page has heard of it, and Save pressed.
 *   e3 saves no row over the other session's: the Save is refused, the row
 *   added here goes on under another key the builder makes and is saved under
 *   it, sent again by itself — both kept, nothing to choose.
 *
 * - {@link putBackAfterSave}: a change saved here — a row changed, added or
 *   removed — that another session puts back exactly as it was before the
 *   builder reads the record again is read back with the row as the record
 *   holds it: the Save never left saving, nothing asked and nothing left to
 *   save. The record then reads as it did before the Save, which nothing it
 *   holds tells from a read made before the Save landed: only when it was
 *   read does.
 *
 * - {@link heardBeforeAnswer}: a Save whose answer comes after the builder
 *   has heard of a later write of another session's — and drawn it — never
 *   takes the builder back to the state the Save committed: the other
 *   session's change stays drawn, the Save is read back where the builder
 *   reads, and e3 refuses none of the builder's reads. Put back there, the
 *   builder asked e3 for a state the record had left: e3 refused each read of
 *   it, naming the state it holds, and the builder read every row it shows a
 *   second time — and until then what the Save landed was laid over rows read
 *   after it. And where a browser held those reads — the Save having put the
 *   record back at a state the builder read before — it answered them by
 *   itself, e3 refused nothing, and the builder drew that past state, the
 *   other session's change gone from it.
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
    /**
     * The reads the builder's session makes by key of the rows it drafted, where they are requests of their own — a
     * record read a window at a time: what {@link removedThere} holds where the builder's own rows are to land first.
     */
    readonly byKey?: E3Match;
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
 * @param first - Which reads land first: the session's by key, the builder's own held and let go one at a time; or the
 *   builder's own `"rows"`, the session's reads by key ({@link ChangedHere.byKey}) held until they have landed
 * @returns Once the choice is made, and — the draft kept — saved
 * @throws An assertion's error where the row leaves before a person chooses, no conflict is asked, or the choice ends otherwise than it says
 */
export async function removedThere(check: ChangedHere, choice: "draft" | "source", first: "session" | "rows" = "session"): Promise<void> {
    expect(check.drawn(), "the builder draws the row to begin with").toBe(true);
    await made(check.change);
    const drafted = JSON.stringify(check.look());
    expect(unsaved(check.container), "the change waits to be saved").toBe(true);
    const { looks, read, stop } = watched(check.container, () => [check.drawn(), JSON.stringify(check.look())] as const);
    const stood = [[true, drafted]];
    const conflict = (): Element | null => check.container.querySelector("[data-conflicts]");
    if (first === "rows") {
        if (check.byKey === undefined) throw new Error("removedThere: the builder's rows are to land first, and its session's reads by key (byKey) are not said");
        const held = check.e3.hold(check.byKey);
        try {
            await check.theirRemoval();
            // The builder's own reads of the record land, the row gone from them; its session's read of the row is held.
            await check.e3.idle();
            await settle();
            read();
            expect(held.held, "the session's reads of its drafted rows by key are held").toBeGreaterThan(0);
            expect(conflict(), "the session has yet to read the row: nothing to choose yet").toBeNull();
            expect(looks, "while the session's reads by key are held, the builder's own rows read again, the row stands as drafted").toEqual(stood);
        } finally {
            await act(async () => { held.release(); });
        }
        await waitFor(() => expect(conflict(), "the removal of a row changed here is a conflict to choose").not.toBeNull(), { timeout: 5_000 });
    } else {
        const held = check.e3.hold(check.reads);
        try {
            await check.theirRemoval();
            await waitFor(() => expect(conflict(), "the removal of a row changed here is a conflict to choose").not.toBeNull(), { timeout: 5_000 });
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
    }
    await settle();
    read();
    stop();
    expect(looks, "once the builder's reads of the record have landed, the row stands as drafted still").toEqual(stood);
    await chosenOverRemoval(check, choice, drafted);
}

/**
 * The choice over a row changed here that another session removed, its conflict waiting: Save waits on it, its card
 * names the row and reads the other side removed; let go, the row leaves and nothing is left to save; kept, Save puts
 * the row back as drafted.
 *
 * @param check - The builder's container, the row and what it draws of the change
 * @param choice - Which side is taken
 * @param drafted - The look the draft has, printed
 * @returns Once the choice is made, and — the draft kept — saved
 */
async function chosenOverRemoval(check: ChangedHere, choice: "draft" | "source", drafted: string): Promise<void> {
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

/** What a builder gives the check of a Save pressed over a row another session removed, the page not having heard. */
export interface SavedOverRemoval extends ChangedHere {
    /**
     * Save pressed, and — its request held on its way to e3 — the other session's removal of the row committed first:
     * the harness's `race`, given the record without the row. What is mounted hears of the removal only from the Save's
     * answer.
     */
    readonly savedOver: (save: () => void) => Promise<void>;
}

/**
 * A row changed here that another session removes before the page has heard of it, and Save pressed over it (see the
 * module docs): e3 refuses the Save, and the row stands as drafted — through the refusal, and as the page then hears of
 * the removal and reads its rows again — with one conflict to choose and Save waiting on it; then the choice.
 *
 * @param check - The builder's e3, its container, the row, the change and the Save the other session's removal overtakes
 * @param choice - Which side is taken: the draft kept, and saved; or the other session's removal
 * @returns Once the choice is made, and — the draft kept — saved
 * @throws An assertion's error where e3 takes the Save, the row leaves before a person chooses, no conflict is asked, or the choice ends otherwise than it says
 */
export async function removedThereAtSave(check: SavedOverRemoval, choice: "draft" | "source"): Promise<void> {
    expect(check.drawn(), "the builder draws the row to begin with").toBe(true);
    await made(check.change);
    const drafted = JSON.stringify(check.look());
    expect(unsaved(check.container), "the change waits to be saved").toBe(true);
    const { looks, read, stop } = watched(check.container, () => [check.drawn(), JSON.stringify(check.look())] as const);
    const stood = [[true, drafted]];
    try {
        await check.savedOver(() => { fireEvent.click(historyButton(check.container, editingMessages.apply())); });
        expect(await check.held(), "e3 took nothing of the Save: the record holds the row no more").toBe(false);
        await waitFor(() => expect(check.container.querySelector("[data-conflicts]"), "the removal of a row changed here is a conflict to choose").not.toBeNull(), { timeout: 5_000 });
        await settle();
        read();
    } finally {
        stop();
    }
    expect(looks, "from the press of Save on — refused, the page hearing why and reading its rows again — the row stands as drafted").toEqual(stood);
    await chosenOverRemoval(check, choice, drafted);
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
    await chosenOverChange(check, choice);
}

/**
 * The choice over a row removed here that another session changed, its conflict waiting: Save waits on it, its card
 * names the row and reads this side removed; let go, the row is back as the other session left it and nothing is left
 * to save; kept, Save removes the row.
 *
 * @param check - The builder's container and the row
 * @param choice - Which side is taken
 * @returns Once the choice is made, and — the removal kept — saved
 */
async function chosenOverChange(check: RemovedHere, choice: "draft" | "source"): Promise<void> {
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

/** What a builder gives the check of a Save pressed over the removal of a row another session changed, the page not having heard. */
export interface SavedOverChange extends RemovedHere {
    /**
     * Save pressed, and — its request held on its way to e3 — the other session's change of the row committed first:
     * the harness's `race`, given the record with the row changed. What is mounted hears of the change only from the
     * Save's answer.
     */
    readonly savedOver: (save: () => void) => Promise<void>;
}

/**
 * A row removed here that another session changes before the page has heard of it, and Save pressed over the removal
 * (see the module docs): e3 refuses the Save, the row stays off the builder — through the refusal, and as the page then
 * hears of the change and reads its rows again — with one conflict to choose and Save waiting on it; then the choice.
 *
 * @param check - The builder's e3, its container, the row, the removal and the Save the other session's change overtakes
 * @param choice - Which side is taken: the removal kept, and saved; or the other session's row
 * @returns Once the choice is made, and — the removal kept — saved
 * @throws An assertion's error where e3 takes the Save, the row is drawn before a person chooses, no conflict is asked, or the choice ends otherwise than it says
 */
export async function removedHereAtSave(check: SavedOverChange, choice: "draft" | "source"): Promise<void> {
    expect(check.drawn(), "the builder draws the row to begin with").toBe(true);
    await made(check.remove);
    expect(check.drawn(), "removed here, the row is off the builder").toBe(false);
    const { looks, read, stop } = watched(check.container, check.drawn);
    try {
        await check.savedOver(() => { fireEvent.click(historyButton(check.container, editingMessages.apply())); });
        expect(await check.held(), "e3 took nothing of the Save: the record holds the row still, as the other session left it").toBe(true);
        await waitFor(() => expect(check.container.querySelector("[data-conflicts]"), "the change of a row removed here is a conflict to choose").not.toBeNull(), { timeout: 5_000 });
        await settle();
        read();
    } finally {
        stop();
    }
    expect(looks, "from the press of Save on — refused, the page hearing why and reading its rows again — the removal stands").toEqual([false]);
    await chosenOverChange(check, choice);
}

/** What a builder gives the check of a row added here under a key it makes, which another session saves a row under. */
export interface AddedHere {
    /** The file's e3 (`h.e3`). */
    readonly e3: TestE3;
    /** The builder's container. */
    readonly container: HTMLElement;
    /** The builder's own reads of the record the row is added to, which the check holds ({@link RemoteRow.reads}). */
    readonly reads: E3Match;
    /** A row added here under a key the builder makes: a gesture, as a person makes it — its steps, where it takes more than one act. */
    readonly add: (() => void | Promise<void>) | readonly (() => void | Promise<void>)[];
    /** The keys of the rows the builder draws that its drafts add, in the order it draws them. */
    readonly added: () => readonly string[];
    /** Whether the builder draws a row under a key — one the record holds, or one its drafts add. */
    readonly drawn: (key: string) => boolean;
    /** Another session's own new row, saved under a key: a commit of the record, the page then settled. */
    readonly theirAddition: (key: string) => Promise<void>;
    /** The keys the record holds now. */
    readonly heldKeys: () => Promise<readonly string[]>;
}

/**
 * A row added here under a key the builder made, which another session saves a row of its own under (see the module
 * docs): the row added here goes on under another key — while the builder's own reads are held, as they land one at a
 * time, and once they have all landed — with nothing to choose; both are drawn, and Save keeps both.
 *
 * @param check - The builder's e3, its container, its reads, the addition here and the other session's
 * @returns Once the row added here stands under its new key, and is saved beside the other session's
 * @throws An assertion's error where a conflict is asked, the row added here leaves, or the record ends without either row
 */
export async function addedOnBothSides(check: AddedHere): Promise<void> {
    await made(check.add);
    const [mine, ...others] = check.added();
    expect([mine === undefined, others], "one row is added here, and drawn").toEqual([false, []]);
    expect(unsaved(check.container), "the addition waits to be saved").toBe(true);
    const held = check.e3.hold(check.reads);
    let moved: string | undefined;
    try {
        await check.theirAddition(mine!);
        // The row added here is a second new row: it goes on under another key the builder makes, and nothing is asked.
        await waitFor(() => {
            const now = check.added();
            expect([now.length, now[0] !== mine, check.container.querySelector("[data-conflicts]")], "the row added here goes on under another key, nothing to choose").toEqual([1, true, null]);
        }, { timeout: 5_000 });
        moved = check.added()[0]!;
        for (let n = 1; held.held > 0 && n <= MOST_READS; n++) {
            await act(async () => { held.releaseOne(); });
            await settle();
            expect([check.added(), check.container.querySelector("[data-conflicts]")], `once ${n} of the builder's reads of the record landed, the rest held`).toEqual([[moved], null]);
        }
    } finally {
        await act(async () => { held.release(); });
    }
    await settle();
    await waitFor(() => expect(check.drawn(mine!), "the other session's row is drawn under the key it took").toBe(true), { timeout: 5_000 });
    expect([check.added(), check.container.querySelector("[data-conflicts]")], "once the builder's reads of the record have landed").toEqual([[moved], null]);
    // Save keeps both.
    expect(off(historyButton(check.container, editingMessages.apply())), "Save is on").toBe(false);
    await act(async () => { fireEvent.click(historyButton(check.container, editingMessages.apply())); });
    await settle();
    await waitFor(() => expect(unsaved(check.container), "the row added here is saved").toBe(false), { timeout: 5_000 });
    await settle();
    const keys = await check.heldKeys();
    expect([keys.includes(mine!), keys.includes(moved)], "the record holds both rows").toEqual([true, true]);
    expect([check.drawn(mine!), check.drawn(moved), check.added()], "saved, both are drawn, neither a draft").toEqual([true, true, []]);
}

/** What a builder gives the check of a Save pressed over a new row whose key another session took, the page not having heard. */
export interface SavedOverAddition {
    /** The builder's container. */
    readonly container: HTMLElement;
    /** A row added here under a key the builder makes ({@link AddedHere.add}). */
    readonly add: (() => void | Promise<void>) | readonly (() => void | Promise<void>)[];
    /** The keys of the rows the builder draws that its drafts add, in the order it draws them. */
    readonly added: () => readonly string[];
    /** Whether the builder draws a row under a key — one the record holds, or one its drafts add. */
    readonly drawn: (key: string) => boolean;
    /** The keys the record holds now. */
    readonly heldKeys: () => Promise<readonly string[]>;
    /**
     * Save pressed, and — its request held on its way to e3 — another session's own new row committed first under the
     * key given: the harness's `race`. What is mounted hears of that row only from the Save's answer.
     */
    readonly savedOver: (key: string, save: () => void) => Promise<void>;
}

/**
 * A row added here under a key the builder made, which another session saves a row of its own under before the page has
 * heard of it, and Save pressed (see the module docs): e3 refuses the Save, the row added here goes on under another key
 * and is saved under it with no second press — both rows kept, both drawn, nothing to choose.
 *
 * @param check - The builder's container, the addition here, and the Save the other session's addition overtakes
 * @returns Once the row added here is saved under its new key, beside the other session's
 * @throws An assertion's error where a conflict is asked, the row added here is lost or saved over the other session's, or it waits on a second Save
 */
export async function addedOnBothSidesAtSave(check: SavedOverAddition): Promise<void> {
    const before = await check.heldKeys();
    await made(check.add);
    const [mine, ...others] = check.added();
    expect([mine === undefined, others], "one row is added here, and drawn").toEqual([false, []]);
    expect(unsaved(check.container), "the addition waits to be saved").toBe(true);
    await check.savedOver(mine!, () => { fireEvent.click(historyButton(check.container, editingMessages.apply())); });
    // e3 saved no row over the other session's: the one added here goes on under another key, and its Save is sent again.
    await waitFor(() => expect([unsaved(check.container), check.container.querySelector("[data-conflicts]")], "the row added here is saved under another key by the Save sent again, nothing to choose")
        .toEqual([false, null]), { timeout: 10_000 });
    await settle();
    const added = (await check.heldKeys()).filter((key) => !before.includes(key));
    const moved = added.filter((key) => key !== mine);
    expect([added.includes(mine!), moved.length], "the record holds both rows: the other session's under the key it took, and the one added here under another").toEqual([true, 1]);
    expect([check.drawn(mine!), check.drawn(moved[0]!), check.added()], "saved, both are drawn, neither a draft").toEqual([true, true, []]);
}

/** What a builder gives the check of a Save another session's write puts back. */
export interface PutBack {
    /** The builder's container. */
    readonly container: HTMLElement;
    /** The change made here and saved — a row changed, added or removed: a gesture, as a person makes it — its steps, where it takes more than one act. */
    readonly change: (() => void | Promise<void>) | readonly (() => void | Promise<void>)[];
    /** What the builder draws of what the change touches — what a cell says, whether a row stands: read before the change, as drafted, and once the Save is read back. */
    readonly look: () => unknown;
    /** What the record holds of what the change touches, now. */
    readonly held: () => Promise<unknown>;
    /**
     * The Save pressed, its commit made, and then — before anything of the builder's reads the record again — another
     * session's write that leaves the record exactly as it stood before the Save: the harness's `followed`, given the
     * record as it stood.
     */
    readonly savedThenPutBack: (save: () => void) => Promise<void>;
}

/**
 * A change saved here that another session puts back exactly before the builder reads the record again (see the
 * module docs): the Save is read back where the record is — the row as it was — and the builder comes to rest.
 *
 * @param check - The builder's container, the change, what it draws and the record holds of it, and the Save followed by the other session's write
 * @returns Once the Save is read back
 * @throws An assertion's error where the Save is left saving, something is asked, a change is left to save, or the row is drawn otherwise than the record holds it
 */
export async function putBackAfterSave(check: PutBack): Promise<void> {
    const [began, stood] = [JSON.stringify(check.look()), await check.held()];
    await made(check.change);
    expect(JSON.stringify(check.look()), "the change is drawn").not.toBe(began);
    expect(unsaved(check.container), "the change waits to be saved").toBe(true);
    await check.savedThenPutBack(() => { fireEvent.click(historyButton(check.container, editingMessages.apply())); });
    expect(await check.held(), "the record holds the row as it did before the Save").toEqual(stood);
    // Read back where the record is now: Save at rest — off, none out and none still read back.
    await waitFor(() => expect(
        [unsaved(check.container), historyButton(check.container, editingMessages.apply()).getAttribute("aria-busy")],
        "the Save is read back: nothing is left to save, and no Save is out",
    ).toEqual([false, null]), { timeout: 10_000 });
    await settle();
    const toolbar = within(slot(check.container, "toolbar"));
    expect([
        toolbar.queryByRole("button", { name: editingMessages.retryRequest() }),
        toolbar.queryByRole("button", { name: editingMessages.retryRefresh() }),
        historyButton(check.container, editingMessages.apply()).getAttribute("aria-busy"),
        check.container.querySelector("[data-conflicts]"),
    ], "nothing to ask again, no Save out, nothing to choose").toEqual([null, null, null, null]);
    expect(JSON.stringify(check.look()), "the builder draws the row as the record holds it: as it was before the Save").toBe(began);
    expect(await check.held(), "nothing is saved again").toEqual(stood);
}

/** What a builder gives the check of a Save whose answer comes after it has heard of a later write. */
export interface HeardBeforeAnswer {
    /** The builder's container. */
    readonly container: HTMLElement;
    /** The change made here and saved: a gesture, as a person makes it — its steps, where it takes more than one act. */
    readonly change: (() => void | Promise<void>) | readonly (() => void | Promise<void>)[];
    /** What the builder draws of what the other session's write changes — another row than the Save's: read before the write, and once the Save is read back. */
    readonly theirs: () => unknown;
    /** What the builder draws of what the Save changes, once the change is made. */
    readonly mine: () => unknown;
    /**
     * How many of the builder's reads e3 has refused so far: the answers the harness's tap keeps of them
     * (`h.e3.answers`) that are no success. A read pinned to a state its record has left is refused.
     */
    readonly refused: () => number;
    /**
     * The Save pressed, its commit made; another session's write of another row; the builder hearing of that write and
     * reading it; and only then the Save's answer (the harness's `late`).
     */
    readonly savedThenHeard: (save: () => void) => Promise<void>;
}

/**
 * A Save whose answer comes after the builder has heard of another session's later write (see the module docs): the
 * other session's change stays drawn through the answer and after it, beside the Save's own, and the builder asks e3
 * for no state the record has left.
 *
 * @param check - The builder's container, the change, what it draws of each side's row, its refused reads, and the Save answered late
 * @returns Once the Save is read back
 * @throws An assertion's error where the other session's change leaves the builder, a read is refused, the Save is left saving, or something is asked
 */
export async function heardBeforeAnswer(check: HeardBeforeAnswer): Promise<void> {
    const refused = check.refused();
    const before = JSON.stringify(check.theirs());
    await made(check.change);
    const mine = JSON.stringify(check.mine());
    expect(unsaved(check.container), "the change waits to be saved").toBe(true);
    const { looks, read, stop } = watched(check.container, () => JSON.stringify(check.theirs()));
    let heard: string | undefined;
    try {
        await check.savedThenHeard(() => { fireEvent.click(historyButton(check.container, editingMessages.apply())); });
        await waitFor(() => expect(
            [unsaved(check.container), historyButton(check.container, editingMessages.apply()).getAttribute("aria-busy")],
            "the Save is read back: nothing is left to save, and no Save is out",
        ).toEqual([false, null]), { timeout: 10_000 });
        await settle();
        read();
        heard = looks[looks.length - 1];
        expect(heard, "the builder draws the other session's change").not.toBe(before);
        // Drawn once, it never leaves: every look from the first that shows it on is that one.
        const from = looks.indexOf(heard!);
        expect(looks.slice(from), "once drawn, the other session's change stays drawn through the Save's answer").toEqual(looks.slice(from).map(() => heard));
    } finally {
        stop();
    }
    expect(check.container.querySelector("[data-conflicts]"), "another row's change is nothing to choose").toBeNull();
    expect(JSON.stringify(check.mine()), "the builder draws the Save's own change").toBe(mine);
    await settle();
    expect(JSON.stringify(check.theirs()), "and still, once everything has settled").toBe(heard);
    expect(check.refused() - refused, "e3 refuses none of the builder's reads: it is never asked for a state the record has left").toBe(0);
}
