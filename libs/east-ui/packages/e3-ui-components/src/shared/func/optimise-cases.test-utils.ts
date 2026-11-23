/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What every builder does with an optimiser's answer, on e3
 * (east-workspace#1622, rules 7, 9, 10 and 11): one set of cases each
 * builder's test file runs over its own example — its page, its record and
 * rows of the period it shows. The app's function runs on e3 for every call,
 * the page's unsaved edits laid over the record as drafts; the answer each
 * case lands is the case's own, given in the function's place
 * (`FitCalls.answer`): what a function answers is its author's, and a builder
 * lands whatever it is.
 *
 * - **Inserts, updates and deletes**: one edit, counted; one Undo takes all
 *   of it back; nothing is written before Save, which commits it as one patch.
 * - **The whole Dict replaced**: lands key by key — its old rows removed, its
 *   new rows added — and never as the record replaced.
 * - **Outside the period**: an answer that moves a row out of the period it
 *   was asked of, or changes one standing outside it, is refused whole,
 *   naming the row, and records nothing.
 * - **Another page's save while the call is out**: before the function runs,
 *   so the answer is against a commit the page has not read; and after it,
 *   the answer late. Either way the page takes the save in, the answer lands
 *   over it, and Save keeps both.
 * - **A key the optimiser gave, taken by another page's row before Save**: a
 *   conflict to choose, as for any key an app's function makes.
 * - **A key the row's fields build** (east-workspace#1709, ruling 14): over a
 *   record whose rows' keys the app builds from them (`rowKey`), an answer is an
 *   edit like any other — a row whose key it changes moves under the key it
 *   then builds, the run's mark with it, and Save writes it there; one whose key
 *   would be another row's lands nothing, saying why in the words every refused
 *   key is said in.
 * - **The run's mark follows its row** (east-workspace#1709, ruling 16):
 *   whoever moves the row under another key — a person's edit of what its key
 *   reads, its Undo, its Redo — its mark goes with it; nothing is drawn under
 *   the key it left, and a row that comes to stand there wears none of it.
 *
 * @packageDocumentation
 */

import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import {
    DictType, decodeBeast2For, diffFor, encodeBeast2For, equalFor, variant, type EastType, type StringType, type ValueTypeOf,
} from "@elaraai/east";
import { editingMessages, optimiseMessages } from "@elaraai/east-ui-components";
import { act, conflictCards, settle, slot, type E3Harness } from "../../e3-web-mount.test-utils.js";
import { patchRecord, type E3Record } from "../../e3-web.test-utils.js";
import { isFitCall } from "./fit-calls.test-utils.js";

/** What a builder's test file gives the cases: its page, its record, and rows of the period its page shows. */
export interface OptimiseCases<R extends EastType> {
    /** The builder, as the cases' titles name it: `the Calendar`. */
    readonly builder: string;
    /** The file's harness. */
    readonly h: E3Harness;
    /** Mounts the builder's page with its optimiser, ready for a run, and answers what it rendered into. */
    readonly mounted: () => Promise<HTMLElement>;
    /** The record the page edits: what the optimiser answers a patch of. */
    readonly record: E3Record<DictType<StringType, R>>;
    /**
     * Has the optimiser answer a patch of the record from now on (`FitCalls.answer`, the builder's result over it).
     *
     * @param patch - The record's patch
     */
    readonly answer: (patch: unknown) => void;
    /** A new row of the period in view — or what makes it from the record's rows — and the key the optimiser gives it. */
    readonly add: readonly [key: string, row: ValueTypeOf<R> | ((rows: ReadonlyMap<string, ValueTypeOf<R>>) => ValueTypeOf<R>)];
    /** A row of the period in view, and a change of it that leaves it there. */
    readonly change: readonly [key: string, to: (row: ValueTypeOf<R>) => ValueTypeOf<R>];
    /** A row of the period in view that the answer removes. */
    readonly remove: string;
    /** Another row of the period in view, and the change another page saves of it. */
    readonly other: readonly [key: string, to: (row: ValueTypeOf<R>) => ValueTypeOf<R>];
    /**
     * The change of {@link change}'s row that puts it outside the period, and the row as a refusal names it — and as
     * one names it where it stands outside the period, when that differs. Left out by a builder with no period — the
     * Sheet.
     */
    readonly outside?: { readonly to: (row: ValueTypeOf<R>) => ValueTypeOf<R>; readonly named: string; readonly standing?: string };
    /**
     * The builder's page over the same record, its rows keyed by the key each builds from its fields (`rowKey`,
     * east-workspace#1709) — and the answers ruling 14's case lands on it. Left out, the case is not run.
     */
    readonly keyed?: {
        /** Mounts the page with its optimiser, ready for a run, and answers what it rendered into. */
        readonly mounted: () => Promise<HTMLElement>;
        /** A row of the period in view, a change of it whose key then reads another that no row stands under, and that key. */
        readonly move: readonly [key: string, to: (row: ValueTypeOf<R>) => ValueTypeOf<R>, moved: string];
        /** A change of the same row whose key then reads another row's, and why the run says it lands nothing. */
        readonly taken: readonly [to: (row: ValueTypeOf<R>) => ValueTypeOf<R>, why: string];
        /**
         * What the page draws a run did to a row, by its key — `chg` for a row the run changed.
         *
         * @param c - What the page rendered into
         * @param key - The row's key
         * @returns The operation drawn; `undefined` where none is, or no row stands under the key
         */
        readonly op: (c: HTMLElement, key: string) => string | undefined;
        /**
         * A row the page draws, and a change of it a run makes that leaves what its key reads as it is (ruling 16). Left
         * out, it is {@link OptimiseCases.change}'s: its row drawn here too, its change leaving the key as it was.
         */
        readonly mark?: readonly [key: string, to: (row: ValueTypeOf<R>) => ValueTypeOf<R>];
        /** Another row the page draws, which a person's edit then moves under the key the marked row left (ruling 16). */
        readonly another: string;
        /**
         * Whether the page draws a row under a key.
         *
         * @param c - What the page rendered into
         * @param key - The row's key
         */
        readonly drawn: (c: HTMLElement, key: string) => boolean;
        /**
         * A person's own edit of a row, by the builder's own gesture, that changes what its key reads (ruling 16): the row
         * then stands under `to`.
         *
         * @param c - What the page rendered into
         * @param key - The row's key
         * @param to - The key its row then builds
         */
        readonly rename: (c: HTMLElement, key: string, to: string) => Promise<void>;
    };
}

async function press(node: Element | null) { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(); }

/**
 * A person's own edit of a row in its builder's inspector, as ruling 16's case renames one: the row pressed — selected,
 * the inspector open on it — and a text field of its form typed into and left, which commits it.
 *
 * @param c - What the page rendered into
 * @param row - The row's element on the page, which a press selects
 * @param field - The field's key in the row's form
 * @param to - What is typed
 */
export async function typeInInspector(c: HTMLElement, row: Element | null, field: string, to: string): Promise<void> {
    await press(row);
    const box = within(slot(c, "end").querySelector<HTMLElement>(`[data-field="${field}"]`)!).getByRole("textbox");
    await act(async () => { fireEvent.change(box, { target: { value: to } }); fireEvent.blur(box); });
    await settle();
}
const eye = (c: HTMLElement) => c.querySelector<HTMLButtonElement>("[data-optimise-button]");
const history = (c: HTMLElement, name: string) => within(slot(c, "toolbar")).getByRole("button", { name });
const banner = (c: HTMLElement, kind: string) => c.querySelector<HTMLElement>(`[data-optimise-banner="${kind}"]`);
const words = (el: HTMLElement) => [el.querySelector("[data-banner-title]")!.textContent, el.querySelector("[data-banner-body]")!.textContent];
/** Waits for a banner of a kind — the answer's, once e3 has given it and the page has landed it. */
const said = (c: HTMLElement, kind: string) => waitFor(() => expect(banner(c, kind)).not.toBeNull(), { timeout: 15_000 });
/** The period, as the eye names it: `Optimise {period}`. */
const period = (c: HTMLElement) => eye(c)!.getAttribute("aria-label")!.replace(/^Optimise /, "");
/** The banner's line for what a run counted. */
function counted(added: number, changed: number, removed: number): string {
    const parts = [
        ...(added > 0 ? [optimiseMessages.added({ count: String(added) })] : []),
        ...(changed > 0 ? [optimiseMessages.changed({ count: String(changed) })] : []),
        ...(removed > 0 ? [optimiseMessages.removed({ count: String(removed) })] : []),
    ];
    const n = added + changed + removed;
    return optimiseMessages.doneDetail({ n, count: String(n), parts: parts.join(", ") });
}

/**
 * Runs the cases over a builder (see the module docs): called in the builder's test file, after its harness.
 *
 * @typeParam R - The record's row
 * @param cases - The builder's page, its record, and rows of the period it shows
 */
export function optimiseCases<R extends EastType>(cases: OptimiseCases<R>): void {
    const { builder, h, mounted, record, answer } = cases;
    type Rows = ValueTypeOf<DictType<StringType, R>>;
    const same = equalFor(record.type);
    const sameRow = equalFor(record.type.value as R);
    const diff = diffFor(record.type);
    const encode = encodeBeast2For(record.type), decode = decodeBeast2For(record.type);
    /** The record's rows, changed: a copy, the record's own left as read. */
    const edited = (rows: Rows, change: (copy: Rows) => void): Rows => { const copy = decode(encode(rows)); change(copy); return copy; };
    const commits = async () => (await h.history(record)).commits.map((commit) => commit.mutation);
    const save = (c: HTMLElement) => history(c, editingMessages.apply()) as HTMLButtonElement;
    const rowOf = (rows: Rows, key: string): ValueTypeOf<R> => {
        const row = rows.get(key);
        if (row === undefined) throw new Error(`${record.name} holds no row under ${key}: the cases name a row of the example's own`);
        return row;
    };
    const [addKey, adding] = cases.add;
    /** The row the optimiser adds, over the record's rows. */
    const addedTo = (rows: Rows): ValueTypeOf<R> => typeof adding === "function" ? (adding as (rows: Rows) => ValueTypeOf<R>)(rows) : adding;
    const [changeKey, changeTo] = cases.change;
    const [otherKey, otherTo] = cases.other;

    describe(`an optimiser's answer in ${builder} (east-workspace#1622)`, () => {
        test("rules 7 and 10 — an answer that inserts, updates and deletes lands as one edit, counted; one Undo takes all of it back and Redo brings it back; nothing is written before Save, which commits it as one patch", async () => {
            const c = await mounted();
            const before = await h.read(record);
            const after = edited(before, (rows) => { rows.set(addKey, addedTo(before)); rows.set(changeKey, changeTo(rowOf(rows, changeKey))); rows.delete(cases.remove); });
            const deployed = await commits();
            answer(diff(before, after));
            const at = period(c);
            await press(eye(c));
            await said(c, "done");
            expect(words(banner(c, "done")!)).toEqual([optimiseMessages.done({ period: at }), counted(1, 1, 1)]);
            await press(history(c, editingMessages.undo()));
            expect(save(c).disabled).toBe(true);
            await press(history(c, editingMessages.redo()));
            expect(save(c).disabled).toBe(false);
            expect(await commits()).toEqual(deployed);
            await press(save(c));
            await waitFor(async () => expect(await commits()).toEqual(["patch", ...deployed]), { timeout: 15_000 });
            expect(same(await h.read(record), after)).toBe(true);
        });

        test("rule 7 — an answer that replaces the whole Dict lands key by key, its old rows removed and its new rows added, never as the record replaced: every other row stands", async () => {
            const c = await mounted();
            const before = await h.read(record);
            const deployed = await commits();
            const old = edited(before, (rows) => { for (const key of [...rows.keys()]) if (key !== cases.remove) rows.delete(key); });
            const next = edited(old, (rows) => { rows.delete(cases.remove); rows.set(addKey, addedTo(before)); });
            answer(variant("replace", { before: old, after: next }));
            await press(eye(c));
            await said(c, "done");
            expect(words(banner(c, "done")!)[1]).toBe(counted(1, 0, 1));
            await press(save(c));
            await waitFor(async () => expect(await commits()).toEqual(["patch", ...deployed]), { timeout: 15_000 });
            expect(same(await h.read(record), edited(before, (rows) => { rows.delete(cases.remove); rows.set(addKey, addedTo(before)); }))).toBe(true);
        });

        const outside = cases.outside;
        if (outside !== undefined) {
            test("rule 11 — an answer that moves a row out of the period it was asked of is refused whole, naming the row: nothing lands, a change inside the period beside it among it, and nothing is recorded", async () => {
                const c = await mounted();
                const before = await h.read(record);
                const deployed = await commits();
                answer(diff(before, edited(before, (rows) => { rows.set(changeKey, outside.to(rowOf(rows, changeKey))); rows.set(otherKey, otherTo(rowOf(rows, otherKey))); })));
                const at = period(c);
                await press(eye(c));
                await said(c, "fail");
                expect(words(banner(c, "fail")!)).toEqual([
                    optimiseMessages.fail({ period: at }),
                    optimiseMessages.refusedDetail({ reason: optimiseMessages.refusedOutside({ row: outside.named, period: at }) }),
                ]);
                expect([save(c).disabled, c.querySelectorAll("[data-op]").length, await commits()]).toEqual([true, 0, deployed]);
            });

            test("rule 11 — an answer that changes a row standing outside the period it was asked of is refused whole, naming the row — read by its key first, where the page holds none of it — and nothing is recorded", async () => {
                const c = await mounted();
                const before = await h.read(record);
                // A row stands outside the period: the changed row's own, put there under a key of its own by another page.
                const far = `${changeKey}-far`;
                const theirs = edited(before, (rows) => { rows.set(far, outside.to(rowOf(rows, changeKey))); });
                await h.patch(record, theirs);
                const deployed = await commits();
                answer(diff(theirs, edited(theirs, (rows) => { rows.set(far, otherTo(rowOf(rows, far))); })));
                const at = period(c);
                await press(eye(c));
                await said(c, "fail");
                expect(words(banner(c, "fail")!)).toEqual([
                    optimiseMessages.fail({ period: at }),
                    optimiseMessages.refusedDetail({ reason: optimiseMessages.refusedOutside({ row: outside.standing ?? outside.named, period: at }) }),
                ]);
                expect([save(c).disabled, c.querySelectorAll("[data-op]").length, await commits()]).toEqual([true, 0, deployed]);
            });
        }

        test("rule 9 — another page's save before the function runs: the answer is against a commit the page has not read, which it reads before the answer lands; Save keeps the other page's change and the answer's", async () => {
            const c = await mounted();
            const before = await h.read(record);
            const deployed = await commits();
            const theirs = edited(before, (rows) => { rows.set(otherKey, otherTo(rowOf(rows, otherKey))); });
            answer(diff(theirs, edited(theirs, (rows) => { rows.set(changeKey, changeTo(rowOf(rows, changeKey))); })));
            const call = h.e3.hold(isFitCall());
            await press(eye(c));
            await call.holding;
            // The other page commits while the call is on its way to e3, and this page is told nothing of it.
            await patchRecord(h.e3, h.workspace, record, theirs);
            await act(async () => { call.release(); });
            await said(c, "done");
            expect(words(banner(c, "done")!)[1]).toBe(counted(0, 1, 0));
            await press(save(c));
            await waitFor(async () => expect(await commits()).toEqual(["patch", "patch", ...deployed]), { timeout: 15_000 });
            // The session stood on the other page's commit as it saved: e3 took its one Save, and refused none.
            expect(h.requests("mutate", record.name)).toHaveLength(1);
            const saved = await h.read(record);
            expect([sameRow(rowOf(saved, otherKey), rowOf(theirs, otherKey)), sameRow(rowOf(saved, changeKey), changeTo(rowOf(before, changeKey)))]).toEqual([true, true]);
        });

        test("rule 9 — another page's save after the function ran, the answer late: the page reads the save, the answer lands over it, and Save keeps both", async () => {
            const c = await mounted();
            const before = await h.read(record);
            const deployed = await commits();
            answer(diff(before, edited(before, (rows) => { rows.set(changeKey, changeTo(rowOf(rows, changeKey))); })));
            const late = h.e3.holdAnswers(isFitCall());
            await press(eye(c));
            await late.holding;
            const theirs = edited(before, (rows) => { rows.set(otherKey, otherTo(rowOf(rows, otherKey))); });
            await h.patch(record, theirs);
            await act(async () => { late.release(); });
            await said(c, "done");
            expect(words(banner(c, "done")!)[1]).toBe(counted(0, 1, 0));
            await press(save(c));
            await waitFor(async () => expect(await commits()).toEqual(["patch", "patch", ...deployed]), { timeout: 15_000 });
            // The session stood on the other page's commit as it saved: e3 took its one Save, and refused none.
            expect(h.requests("mutate", record.name)).toHaveLength(1);
            const saved = await h.read(record);
            expect([sameRow(rowOf(saved, otherKey), rowOf(theirs, otherKey)), sameRow(rowOf(saved, changeKey), changeTo(rowOf(before, changeKey)))]).toEqual([true, true]);
        });

        test("rule 7 — a row the optimiser added under a key another page's row then takes is a conflict to choose, as for any key an app's function makes: Save waits; chosen, it commits the row chosen", async () => {
            const c = await mounted();
            const before = await h.read(record);
            const added = addedTo(before);
            answer(diff(before, edited(before, (rows) => { rows.set(addKey, added); })));
            await press(eye(c));
            await said(c, "done");
            expect(words(banner(c, "done")!)[1]).toBe(counted(1, 0, 0));
            // Another page saves a row of its own under the key the optimiser gave.
            const taken = otherTo(added);
            await h.patch(record, edited(before, (rows) => { rows.set(addKey, taken); }));
            await waitFor(() => expect(c.querySelector('[data-session-banner="conflicts"]')).not.toBeNull(), { timeout: 15_000 });
            expect(save(c).getAttribute("aria-disabled")).toBe("true");
            const [conflict, ...more] = await conflictCards(c);
            expect(more).toEqual([]);
            // The optimiser's row is kept: Save commits it over the other page's.
            await act(async () => { fireEvent.click(conflict!.radio("draft")); });
            await settle();
            await press(save(c));
            await waitFor(async () => expect(sameRow(rowOf(await h.read(record), addKey), added)).toBe(true), { timeout: 15_000 });
        });

        const keyed = cases.keyed;
        if (keyed !== undefined) {
            const [movedKey, moveTo, movesTo] = keyed.move;
            test("ruling 14 of east-workspace#1709 — over rows keyed by the key each builds, an answer that changes what a row's key reads moves the row under the key it then builds, as an edit does, the run's mark with it; Save writes it there", async () => {
                const c = await keyed.mounted();
                const before = await h.read(record);
                const deployed = await commits();
                answer(diff(before, edited(before, (rows) => { rows.set(movedKey, moveTo(rowOf(rows, movedKey))); })));
                await press(eye(c));
                await said(c, "done");
                expect(words(banner(c, "done")!)[1]).toBe(counted(0, 1, 0));
                await waitFor(() => expect([keyed.op(c, movesTo), keyed.op(c, movedKey)]).toEqual(["chg", undefined]));
                await press(save(c));
                await waitFor(async () => expect(await commits()).toEqual(["patch", ...deployed]), { timeout: 15_000 });
                const saved = await h.read(record);
                expect([saved.has(movedKey), sameRow(rowOf(saved, movesTo), moveTo(rowOf(before, movedKey)))]).toEqual([false, true]);
            });

            test("ruling 14 of east-workspace#1709 — an answer whose row would build another row's key lands nothing, and the run says why in the words every refused key is said in, never only that the answer could not be used", async () => {
                const c = await keyed.mounted();
                const before = await h.read(record);
                const deployed = await commits();
                const [takeTo, why] = keyed.taken;
                answer(diff(before, edited(before, (rows) => { rows.set(movedKey, takeTo(rowOf(rows, movedKey))); })));
                const at = period(c);
                await press(eye(c));
                await said(c, "fail");
                expect(words(banner(c, "fail")!)).toEqual([optimiseMessages.fail({ period: at }), optimiseMessages.refusedDetail({ reason: why })]);
                expect([save(c).disabled, keyed.op(c, movedKey), await commits()]).toEqual([true, undefined, deployed]);
            });

            test("ruling 16 of east-workspace#1709 — what a run left on a row follows it to every key it moves under, whoever moves it: a person's edit of what its key reads, its Undo and its Redo; nothing is drawn under the key it left, and a row that comes to stand under that key wears none of the run's marks", async () => {
                const c = await keyed.mounted();
                const before = await h.read(record);
                const [markKey, markTo] = keyed.mark ?? cases.change;
                answer(diff(before, edited(before, (rows) => { rows.set(markKey, markTo(rowOf(rows, markKey))); })));
                await press(eye(c));
                await said(c, "done");
                await waitFor(() => expect(keyed.op(c, markKey)).toBe("chg"));
                // A person's own edit moves the row under the key it then builds: the run's mark goes with it.
                await keyed.rename(c, markKey, movesTo);
                await waitFor(() => expect([keyed.op(c, movesTo), keyed.drawn(c, markKey)]).toEqual(["chg", false]));
                // Undo takes the edit back, the row and its mark back under the key it had; Redo moves both on again.
                await press(history(c, editingMessages.undo()));
                await waitFor(() => expect([keyed.op(c, markKey), keyed.drawn(c, movesTo)]).toEqual(["chg", false]));
                await press(history(c, editingMessages.redo()));
                await waitFor(() => expect([keyed.op(c, movesTo), keyed.drawn(c, markKey)]).toEqual(["chg", false]));
                // Another row edited to build the key the marked row left stands under it, and wears none of the run's marks.
                await keyed.rename(c, keyed.another, markKey);
                await waitFor(() => expect(keyed.drawn(c, markKey)).toBe(true));
                expect([keyed.op(c, markKey), keyed.op(c, movesTo)]).toEqual([undefined, "chg"]);
            });
        }
    });
}
