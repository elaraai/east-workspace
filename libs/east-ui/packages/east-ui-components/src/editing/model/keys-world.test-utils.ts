/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The keys world of the editing core's proof harness (test use): editing
 * sessions that each make their new rows' keys by one rule (`keys.ts`,
 * `EditSession.mint`) over one record (`record.test-utils.ts`), beside
 * another session that saves rows of its own under the very keys that rule
 * makes — what `world.test-utils.ts`, whose rows stand under three fixed
 * keys, does not model: an entry given a new key.
 *
 * Every row a world makes carries a tag — its `a`, which nothing changes: who
 * made it, and which of theirs it is — so a row is followed whatever key it
 * comes to stand under. Its `b` is its value, which its maker changes.
 *
 * A session is driven as `useEditSession` drives one, as the world's are. Its
 * source is read a revision at a time — the session knows no key of the
 * record's but those it has met, as over a record read a window at a time,
 * and its rule is bound past the keys its page shows rows under (`pastKeys`),
 * as a board binds one — or whole (`inline`), the session handed the
 * collection. A new row is begun as a board begins one: from no row. Read a
 * revision at a time, another session's row may stand out of view
 * (`remote.addUnseen`): no page ever shows it, as a row out of the window a
 * board reads, so no rule is bound past its key — a row made under it is
 * refused at Save, and made another.
 *
 * What it holds, of every world:
 *
 * - **A key made is free.** A session never makes a key under which it holds
 *   a row — its drafts', or one its last Save landed — nor one the page shows
 *   a row under, nor, read whole, one the collection as last read holds: a
 *   new row begun there would hide that row, or begin from it and be saved
 *   over it. Nor does it move a new row to such a key.
 * - **No row is saved over one someone keeps.** A commit never puts a row
 *   where another row stood — but a row of its own person's that they had
 *   let go while the Save that added it was on its way.
 * - **No row is saved twice.** The record never holds a row under two keys.
 * - **A new row is no conflict.** A key the session made, its row not yet
 *   saved, is made again where another write takes it: nothing is asked of
 *   its person, and the two rows are both kept.
 * - **A row is followed under its new key.** Each row a person made is on
 *   their screen under one key, at the value they last put it at; what the
 *   session says it moved (`renumbered`) is the row's old key and its new
 *   one; and the keys the session calls its own (`ownKeys`) are those of the
 *   new rows its drafts add that no request holds.
 * - **It converges.** Answered, read, redrawn and saved, each session is idle
 *   with nothing pending and its screen the record; every row a person made
 *   and kept is in the record once, at their value; every row they removed is
 *   gone; and every row another session added is there as it was added.
 *
 * A person is asked to choose only over a key their session does not hold as
 * its own:
 *
 * - **A page reloaded while a Save's outcome is not known** — sent, or its
 *   answer lost. The key that request held is kept as the session's own no
 *   more, since the record may hold the row as the request left it, and
 *   nothing tells that from another write's.
 * - **A row saved, removed, and put back by Undo under its key**, which
 *   another session's new row took once the removal was saved: the key was
 *   the row's own in the record, never one made for a row still to save.
 *
 * A world where someone was so asked, or reloaded so (`unsure`), is held to
 * this alone: no row is saved twice, and it converges — a choice there may
 * let a row go, its own person's or another's.
 *
 * @packageDocumentation
 */
import {
    IntegerType, StringType, compareFor, decodeBeast2For, encodeBeast2For, none, parseFor, printFor, some, toEastTypeValue, variant, type EastType, type option,
} from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";
import { liftDraft, normalizeDraft } from "../draft.js";
import { madeFromKeys, nextIntegerKeys, pastKeys, randomKeys, type EntryKeys } from "../keys.js";
import { readBeforeSave } from "../landed.js";
import { EditSession, type ConflictChoice, type EntryVersion } from "../session.js";
import { fingerprint, type PrintRules } from "./explore.test-utils.js";
import { Batch, ModelRecord, Row, numberEqual, rowsEqual, textEqual, type Answer, type BatchValue, type RowValue, type RowsValue } from "./record.test-utils.js";
import { ModelFault, type DraftShape } from "./world.test-utils.js";

const DRAFT_TYPES: Readonly<Record<DraftShape, EastType>> = { fields: Editing.Types.Draft(Row), whole: Editing.Types.DraftField(Row) };
const decodeBatch = decodeBeast2For(Batch);
const printNumber = printFor(IntegerType);
const parseNumber = parseFor(IntegerType);
const compareNumber = compareFor(IntegerType);
const KEY_ORDER = some(variant("keyOrder", null));
/** A version of a row the session holds none of. */
const ABSENT: EntryVersion<undefined> = { draft: undefined, wire: undefined, place: none };
/** The row every new one is made from: its key is what a key made from another's begins with. */
const FROM = "j1";
/** The record's rows as every keys world begins: the one row the others are made from. */
const START: readonly (readonly [string, RowValue])[] = [[FROM, { a: 1n, b: 2n }]];

/** Lets what a promise's answer sets going run to its end. */
async function settled(): Promise<void> {
    for (let i = 0; i < 12; i++) await Promise.resolve();
}

/** A row's tag, as text: who made it, and which of theirs it is. */
function tagOf(row: RowValue): string {
    return printNumber(row.a);
}

/** How a world's new rows are keyed: from the row they are made from (`j1-2`, `j1-3`), or one past the largest Integer. */
export type KeyRule = "madeFrom" | "nextInteger";

/** The largest Integer among some keys; `undefined` where none is one. */
function largestOf(keys: Iterable<string>): bigint | undefined {
    let most: bigint | undefined;
    for (const key of keys) {
        const read = parseNumber(key);
        if (read.success && (most === undefined || compareNumber(read.value, most) > 0)) most = read.value;
    }
    return most;
}

/** One step of a person's history: a row of theirs, and its value before and after — `undefined` while they see none of it. */
interface Step {
    readonly tag: string;
    readonly before: bigint | undefined;
    readonly after: bigint | undefined;
}

/** One client of a keys world: a session bound to the world's rule, what it knows of the record, and what its screen shows. */
export class KeysClient {
    /** The session. */
    session: EditSession<undefined>;
    /** What its source reports: the revision it reads at, the rows the session asked for by key there, and those that have landed. */
    known: { revision: string; readonly asked: Set<string>; readonly landed: Set<string> };
    /** What its screen's rows are: read at a revision. */
    screen: { revision: string; rows: RowsValue };
    /** Its request on its way: the batch, and what answers it. */
    out: { readonly batch: BatchValue; readonly resolve: (answer: Answer) => void; readonly reject: (error: Error) => void } | undefined;
    /** Each row its person made, by its tag, in the order they made them: the value they last put it at — `undefined` while they removed it, or took its making back. */
    readonly made = new Map<string, bigint | undefined>();
    /** The page was reloaded while a Save's outcome was not known, or its person was asked to choose: a choice may let a row go. */
    unsure = false;
    /** The keys its session made for rows still to save, as the harness follows them: none of them is ever a conflict to choose. */
    private mine = new Set<string>();
    /** How many gestures its person has made: what a world budgets (`acts`). */
    acts = 0;
    /** How many requests its session has started, each counted once however often it is sent: what a world budgets (`sends`). */
    requests = 0;
    /** How often its session's steps went under its person: Undo lost as the source moved. */
    stepsLost = 0;
    /** How many of its new rows the session gave another key. */
    remade = 0;
    /** How often its person was asked to choose where no page had been reloaded with a Save unresolved. */
    asked = 0;
    /** What its person kept of their rows as each request was first sent, by the request's id: what the request is held to. */
    private readonly sent = new Map<string, ReadonlyMap<string, bigint | undefined>>();
    /** What the session last said it moved: said once, so each map is counted once. */
    private said: ReadonlyMap<string, string> | undefined;
    /** Its person's steps, as they made them. */
    private steps: Step[] = [];
    private cursor = 0;
    private next: bigint;

    /**
     * @param name - Its name, as the record's commits say who made them
     * @param index - Which client it is: its values are its own
     * @param record - The record
     * @param shape - How its session drafts a row
     * @param rule - How its new rows are keyed
     * @param inline - Whether its source is read whole: the session's base the whole collection, never a revision
     * @param unseen - The keys of the rows no page shows: out of the window it reads
     */
    constructor(readonly name: string, index: number, private readonly record: ModelRecord, private readonly shape: DraftShape,
        private readonly rule: KeyRule, private readonly inline: boolean, private readonly unseen: ReadonlySet<string>) {
        this.next = BigInt(100 * (index + 1));
        this.known = { revision: record.revision, asked: new Set(), landed: new Set() };
        this.screen = { revision: record.revision, rows: record.now };
        this.session = this.open();
    }

    /** The draft type of its session. */
    private get draftType(): EastType { return DRAFT_TYPES[this.shape]; }

    /**
     * The rule its session's keys are made by. Over a source read a revision at a time an Integer key is past the
     * record's largest as its host reads it — by its key order, at the revision its source reads at — which the session
     * itself cannot know.
     */
    private get keys(): EntryKeys {
        const rule = this.rule === "madeFrom" ? madeFromKeys(randomKeys())
            : this.inline ? nextIntegerKeys() : nextIntegerKeys(() => ({ key: largestOf(this.record.at(this.known.revision).keys()) }));
        // Read a revision at a time, a key is made past every key its host shows a row under, as a board binds its rule.
        return this.inline ? rule : pastKeys(rule, (id) => this.shows(id) !== undefined);
    }

    /** The row its page shows under a key, as it last read it: none for one out of view. */
    private shows(key: string): RowValue | undefined {
        return this.unseen.has(key) ? undefined : this.screen.rows.get(key);
    }

    /** A session over the record, bound to the rule. */
    private open(): EditSession<undefined> {
        return new EditSession<undefined>({
            sourceId: "rows", entryType: Row, draftType: this.draftType, keyType: StringType, patch: undefined, drawsLanded: !this.inline,
            keys: this.keys,
            refresh: this.inline ? undefined : (revision) => { if (revision.type === "some") this.readAt(revision.value); },
            apply: (bytes) => new Promise<Answer>((resolve, reject) => {
                const batch = decodeBatch(bytes);
                // A request sent again is the same request: what its person kept is what they kept as it first went.
                if (!this.sent.has(batch.requestId)) { this.sent.set(batch.requestId, new Map(this.made)); this.requests++; }
                this.out = { batch, resolve, reject };
            }),
        });
    }

    /** The source reads at a revision from now on: nothing read by key there yet. */
    private readAt(revision: string): void {
        if (textEqual(revision, this.known.revision)) return;
        this.known = { revision, asked: new Set(), landed: new Set() };
    }

    /** A value no other write uses: this client's own. */
    private fresh(): bigint { return this.next++; }

    /** A row as a version of the session's. */
    private versionOf(row: RowValue): EntryVersion<undefined> {
        return { draft: liftDraft(this.draftType, row), wire: undefined, place: KEY_ORDER };
    }

    /** A draft's row; `undefined` for one absent. */
    private rowOfDraft(key: string, draft: unknown): RowValue | undefined {
        return draft === undefined ? undefined : normalizeDraft(this.draftType, draft, key).domain as RowValue | undefined;
    }

    /** The version a gesture on a row begins from — the row its person is looking at (`EditSession.startOf`), given the screen's. */
    private startOf(key: string): EntryVersion<undefined> {
        return this.session.startOf(key, () => {
            const shown = this.shows(key);
            return shown === undefined ? ABSENT : this.versionOf(shown);
        })!;
    }

    /**
     * The row its person sees under a key.
     *
     * @param key - The key
     * @returns The row; `undefined` where they see none
     */
    shown(key: string): RowValue | undefined { return this.rowOfDraft(key, this.startOf(key).draft); }

    /** Every key its person may see a row under: the screen's, the session's, and those of what its Saves landed. */
    private shownKeys(): string[] {
        return [...new Set([...this.screen.rows.keys(), ...this.session.entries.keys(), ...this.session.landed.keys()])].sort();
    }

    /**
     * Where its person sees a row.
     *
     * @param tag - The row's tag
     * @returns Each key that shows it
     */
    where(tag: string): string[] {
        return this.shownKeys().filter((key) => {
            const row = this.shown(key);
            return row !== undefined && textEqual(tagOf(row), tag);
        });
    }

    /** The row of theirs its person would change or remove next: the last they made that they see still. */
    get last(): string | undefined {
        let last: string | undefined;
        for (const [tag, value] of this.made) if (value !== undefined) last = tag;
        return last;
    }

    // ── What the session is told, as `useEditSession` tells it ───────────────

    /**
     * Hands the session the revision its source reads at and the rows it asked for there that have landed, until it rests.
     *
     * @throws {ModelFault} Where it never rests
     */
    async drive(): Promise<void> {
        for (let pass = 0; pass < 24; pass++) {
            const before = this.session.getSnapshot();
            const revision = this.known.revision;
            const rows = this.record.at(revision);
            const base = this.inline ? variant("snapshot", rows) : variant("revision", revision);
            this.session.recheck(undefined, undefined);
            const reads = new Map<string, option<unknown>>();
            for (const id of this.inline ? [] : this.session.readIdsAt(revision)) {
                if (!this.known.landed.has(id)) { this.known.asked.add(id); continue; }
                const row = rows.get(id);
                reads.set(id, row === undefined ? none : some(row));
            }
            const read = (id: string): option<unknown> | undefined => reads.get(id);
            this.session.confirmFailed(undefined);
            this.session.reconcile(base, read);
            this.session.nameConflicts(base, read);
            this.session.observeBase(base);
            this.session.merge(base, read);
            // What the session says it moved, said once: each row it gave another key.
            const moved = this.session.renumbered;
            if (moved !== this.said) { this.said = moved; this.renumbered(moved); }
            // The screen, drawn again as the session moves: what a Save landed that its rows now show is let go.
            const drawn = [...this.session.landed].filter(([, landed]) => !readBeforeSave(this.screen.revision, this.known.revision, landed.from)).map(([key]) => key);
            if (drawn.length > 0) this.session.shown(drawn);
            await settled();
            if (this.session.getSnapshot() === before && textEqual(this.known.revision, revision)) return;
        }
        throw new ModelFault(`${this.name}'s session never rests`);
    }

    /** What the session says it moved, held to what it did: each row under its new key, a row of its person's own, and none of theirs left under the old one. */
    private renumbered(moved: ReadonlyMap<string, string>): void {
        for (const [was, now] of moved) {
            this.remade++;
            this.mine.delete(was);
            this.mine.add(now);
            const row = this.shown(now);
            if (row === undefined || !this.made.has(tagOf(row))) {
                throw new ModelFault(`${this.name}'s session says it moved a new row from ${was} to ${now}, and its person sees ${row === undefined ? "no row" : `the row ${tagOf(row)}, not theirs,`} there`);
            }
            const left = this.session.entries.get(was);
            if (left !== undefined) throw new ModelFault(`${this.name}'s session says it moved a new row from ${was} to ${now}, and holds a draft under ${was} still`);
            if (this.shows(now) !== undefined) throw new ModelFault(`${this.name}'s session moved a new row from ${was} to ${now}, under which the page shows a row: the new row hides it`);
        }
    }

    // ── Its person's acts ────────────────────────────────────────────────────

    /** A row made: its key the session's to make, and the row begun from none, as a board begins one. */
    make(): void {
        const id = this.session.mint(FROM);
        if (id === undefined) throw new ModelFault(`${this.name}'s session made no key`);
        // A board begins a new row from none — unless its session holds a row under the key, which the key must not be.
        const held = this.session.startOf(id, () => undefined);
        if (held !== undefined && held.draft !== undefined) {
            throw new ModelFault(`${this.name}'s session made the key ${id}, under which it holds a row: the new row would be saved over it`);
        }
        // Read whole, a gesture begins from the collection as it reads now: the key is none of its keys.
        if (this.inline && this.screen.rows.has(id)) {
            throw new ModelFault(`${this.name}'s session made the key ${id}, which the collection as last read holds: the new row would be saved over that one`);
        }
        // Nor, read a revision at a time, one the page shows a row under: the new row would be drawn over it.
        if (this.shows(id) !== undefined) throw new ModelFault(`${this.name}'s session made the key ${id}, under which the page shows a row: the new row would hide it`);
        const [a, b] = [this.fresh(), this.fresh()];
        const took = this.session.record([{ id, before: held ?? ABSENT, after: this.versionOf({ a, b }) }], "insert", `Make ${id}`);
        if (!took) throw new ModelFault(`${this.name}'s new row was not taken`);
        this.acts++;
        this.mine.add(id);
        const tag = printNumber(a);
        this.made.set(tag, b);
        this.push({ tag, before: undefined, after: b });
    }

    /** The key its person sees a row of theirs under: the one key. */
    private keyOf(tag: string): string {
        const at = this.where(tag);
        if (at.length !== 1) throw new ModelFault(`${this.name}'s person sees their row ${tag} under ${at.length === 0 ? "no key" : at.join(" and ")}`);
        return at[0]!;
    }

    /** The last row its person made changed: one gesture, wherever the row stands now. */
    edit(): void {
        const tag = this.last;
        if (tag === undefined) throw new Error(`${this.name} has no row to change`);
        const key = this.keyOf(tag);
        const row = this.shown(key)!;
        const b = this.fresh();
        const took = this.session.record([{ id: key, before: this.startOf(key), after: this.versionOf({ ...row, b }) }], "typed", `Set ${key}`);
        if (!took) throw new ModelFault(`${this.name}'s change of ${key} was not taken`);
        this.acts++;
        this.made.set(tag, b);
        this.push({ tag, before: row.b, after: b });
    }

    /** The last row its person made removed: one gesture. */
    remove(): void {
        const tag = this.last;
        if (tag === undefined) throw new Error(`${this.name} has no row to remove`);
        const key = this.keyOf(tag);
        const row = this.shown(key)!;
        const took = this.session.record([{ id: key, before: this.startOf(key), after: ABSENT }], "remove", `Remove ${key}`);
        if (!took) throw new ModelFault(`${this.name}'s removal of ${key} was not taken`);
        this.acts++;
        this.made.set(tag, undefined);
        this.push({ tag, before: row.b, after: undefined });
    }

    /** Undo: the last step taken back. */
    undo(): void {
        // Reloaded with a Save unresolved, a step may be a conflict's choice: what its person sees is read from the screen.
        if (this.unsure) { this.session.undo(); this.resee(); return; }
        const step = this.steps[this.cursor - 1];
        if (step === undefined) throw new Error(`${this.name} has no step to undo`);
        this.session.undo();
        this.cursor--;
        this.made.set(step.tag, step.before);
    }

    /** Redo: the next step replayed. */
    redo(): void {
        if (this.unsure) { this.session.redo(); this.resee(); return; }
        const step = this.steps[this.cursor];
        if (step === undefined) throw new Error(`${this.name} has no step to redo`);
        this.session.redo();
        this.cursor++;
        this.made.set(step.tag, step.after);
    }

    /** What its person sees of each row of theirs, taken as what they have: for a world whose choices may let a row go. */
    private resee(): void {
        for (const tag of [...this.made.keys()]) {
            const at = this.where(tag);
            this.made.set(tag, at.length === 0 ? undefined : this.shown(at[0]!)!.b);
        }
    }

    /** A step made: what Redo could replay goes. */
    private push(step: Step): void {
        this.steps.splice(this.cursor);
        this.steps.push(step);
        this.cursor = this.steps.length;
    }

    /**
     * Its person's steps, held to the session's: where the session's went — the source moved under them — the person's
     * go too, and it is counted.
     *
     * @throws {ModelFault} Where the session holds steps that are not its person's
     */
    syncSteps(): void {
        // Reloaded with a Save unresolved, its steps hold a conflict's choices too: not followed.
        if (this.unsure) return;
        const { undo, redo } = this.session.depth;
        if (undo === this.cursor && redo === this.steps.length - this.cursor) return;
        if (undo !== 0 || redo !== 0) throw new ModelFault(`${this.name}'s session holds ${undo} steps to undo and ${redo} to redo, and its person made ${this.cursor} and ${this.steps.length - this.cursor}`);
        this.stepsLost++;
        this.steps = [];
        this.cursor = 0;
    }

    /** A conflict chosen one way: every open one. A choice may let a row go: its world is held to less from here on. */
    settle(choice: ConflictChoice): void {
        if (!this.session.settleAll(choice)) throw new ModelFault(`${this.name}'s choice was not taken`);
        this.acts++;
        if (!this.unsure) this.asked++;
        this.unsure = true;
        // What its person sees of each row of theirs is what the choice left: a row let go is theirs no more.
        this.resee();
    }

    /**
     * The page reloaded: its drafts kept as the tab keeps them (`keep.ts`: each one's draft and what both began from,
     * beast2 at the draft's type, and beside them the keys the session made that are its own still) and restored into
     * a session made anew, over a page that reads the record as it now is. A request on its way is no one's to hear
     * any more. The history is not kept.
     */
    reload(): void {
        const type = toEastTypeValue(this.draftType);
        const [encode, decode] = [encodeBeast2For(type) as (value: unknown) => Uint8Array, decodeBeast2For(type) as (bytes: Uint8Array) => unknown];
        const again = (value: option<unknown>): option<unknown> => (value.type === "some" ? some(decode(encode(value.value))) : none);
        const entries = this.session.keptEntries.map((entry) => ({ ...entry, was: again(entry.was), draft: again(entry.draft) }));
        // Kept with the drafts, and gone with them (`keep.ts`).
        const own = entries.length === 0 ? new Map<string, string | undefined>() : new Map(this.session.ownKeys);
        // A Save whose outcome the session does not know — sent, or its answer lost — is kept as drafts, which the record
        // may hold already; and a row put back as it began since — made, sent, then removed — is no draft, and is not
        // kept: where that Save lands, its removal is lost with the page (what `world.test-utils.ts` counts).
        if (this.session.locked && this.session.status !== "reconciling") this.unsure = true;
        this.out = undefined;
        this.session = this.open();
        this.session.restore(entries, false, false);
        if (own.size > 0) this.session.restoreOwnKeys(own);
        this.mine = new Set(own.keys());
        this.said = this.session.renumbered;
        this.known = { revision: this.record.revision, asked: new Set(), landed: new Set() };
        this.screen = { revision: this.record.revision, rows: this.record.now };
        this.steps = [];
        this.cursor = 0;
    }

    // ── Its request, and what the record does with it ────────────────────────

    /** Save, as its person presses it. */
    async save(): Promise<void> {
        void this.session.apply();
        await settled();
    }

    /** A write left with no answer, asked again. */
    async retry(): Promise<void> {
        this.session.retry();
        await settled();
    }

    /**
     * The request reaches the record, and — unless the answer is lost — its answer comes back.
     *
     * @param answered - Whether the answer comes back; lost, the session is left with a write of unknown outcome
     * @returns Where the record took it — a commit of its own — what its person kept of their rows as it was first sent
     */
    async deliver(answered: boolean): Promise<ReadonlyMap<string, bigint | undefined> | undefined> {
        const out = this.out;
        if (out === undefined) return undefined;
        this.out = undefined;
        const before = this.record.commits.length;
        const answer = this.record.commit(out.batch, this.name);
        if (answered) out.resolve(answer);
        else out.reject(new Error("No answer"));
        await settled();
        return this.record.commits.length > before ? this.sent.get(out.batch.requestId) : undefined;
    }

    /** The request is lost before the record hears of it. */
    async lose(): Promise<void> {
        const out = this.out;
        if (out === undefined) return;
        this.out = undefined;
        out.reject(new Error("No answer"));
        await settled();
    }

    // ── What it learns of the record ─────────────────────────────────────────

    /** Its source hears of the record's revision now — and, read whole, its screen draws the collection it then holds. */
    see(): void {
        this.readAt(this.record.revision);
        if (this.inline) this.redraw();
    }

    /** Whether rows the session asked for by key are still to land. */
    get reading(): boolean { return [...this.known.asked].some((id) => !this.known.landed.has(id)); }

    /** The rows the session asked for by key land. */
    read(): void {
        for (const id of this.known.asked) this.known.landed.add(id);
    }

    /** The screen's rows are read again, at the revision its source reads at. */
    redraw(): void { this.screen = { revision: this.known.revision, rows: this.record.at(this.known.revision) }; }

    // ── What must hold of it ─────────────────────────────────────────────────

    /**
     * What must hold of it after every operation.
     *
     * @param unsure - Whether a page of its world — its own, or another's — was reloaded while a Save's outcome was not
     *   known: a choice made there may let a row go, its own person's or another's
     * @throws {ModelFault} What failed
     */
    observe(unsure: boolean): void {
        const { session } = this;
        // A new row is no conflict: a key the session made, its row still to save, is made again where another write takes it.
        for (const key of session.conflicts.keys()) {
            if (this.mine.has(key)) throw new ModelFault(`${this.name} is asked to choose over ${key}, a key its session made for a row still to save`);
        }
        // A key is the session's own until its row is saved, the session lets go of it, or a request that holds it is
        // left with no answer: the record may hold the row as that request left it, from then on.
        for (const key of [...this.mine]) {
            const was = session.originals.get(key);
            if (!session.entries.has(key) || (was !== undefined && was.draft !== undefined) || (session.status === "unknown" && session.sends(key))) this.mine.delete(key);
        }
        // The keys it calls its own: those of the new rows its drafts add, that no request holds.
        for (const [id] of session.ownKeys) {
            const [mine, was] = [session.entries.get(id), session.originals.get(id)];
            if (mine === undefined || mine.draft === undefined || (was !== undefined && was.draft !== undefined)) {
                throw new ModelFault(`${this.name}'s session calls the key ${id} its own, and its drafts add no row under it`);
            }
            if (session.sends(id)) throw new ModelFault(`${this.name}'s session calls the key ${id} its own while a request holds it`);
        }
        // While a conflict waits, what its person sees of a row is the draft's side of it: held to once it is chosen.
        if (session.unsettled > 0) return;
        // Each row its person made is on their screen under one key, at the value they last put it at; one they removed, under none.
        for (const [tag, value] of this.made) {
            const at = this.where(tag);
            // A page reloaded with a Save unresolved: a change made meanwhile may be lost with it, and a choice made there
            // may let a row go — never a row shown twice.
            if (unsure) {
                if (at.length > 1) throw new ModelFault(`${this.name}'s person sees their row ${tag} under ${at.join(" and ")}`);
                continue;
            }
            if (value === undefined) {
                if (at.length > 0) throw new ModelFault(`${this.name}'s person removed their row ${tag}, and sees it under ${at.join(" and ")}`);
                continue;
            }
            if (at.length !== 1) throw new ModelFault(`${this.name}'s person sees their row ${tag} under ${at.length === 0 ? "no key" : at.join(" and ")}`);
            const row = this.shown(at[0]!)!;
            if (!numberEqual(row.b, value)) {
                throw new ModelFault(`${this.name}'s person put their row ${tag} at ${printNumber(value)}, and sees it at ${printNumber(row.b)} under ${at[0]}`);
            }
        }
    }

    /** How many rows its drafts hold away from what they began as, counted from the versions themselves. */
    drafted(): number {
        let n = 0;
        for (const [key, version] of this.session.entries) {
            const [is, was] = [this.rowOfDraft(key, version.draft), this.rowOfDraft(key, this.session.originals.get(key)?.draft)];
            if ((is === undefined) !== (was === undefined) || (is !== undefined && was !== undefined && !(numberEqual(is.a, was.a) && numberEqual(is.b, was.b)))) n++;
        }
        return n;
    }
}

/** One operation of a keys world, by name: `c0.make`, `remote.add`, `c0.deliver`. */
export type KeysOp = string;

/** What a keys world is made of. */
export interface KeysOptions {
    /** How its sessions draft a row. */
    readonly shape: DraftShape;
    /** How its new rows are keyed. */
    readonly rule: KeyRule;
    /** How many sessions edit the record: one by default. */
    readonly clients?: number | undefined;
    /** The most rows another session adds, beside the harness's own clients: two by default. */
    readonly remotes?: number | undefined;
    /** Whether each session reads the record whole — its base the collection — never a revision at a time. */
    readonly inline?: boolean | undefined;
    /** The most gestures each person makes: unbounded by default. With `sends`, what makes the world's states finite. */
    readonly acts?: number | undefined;
    /** The most requests each session's person starts: unbounded by default. */
    readonly sends?: number | undefined;
}

/** What a print of a keys world leaves out: what is no state — caches, counters that only count, what a session is bound to. */
const SESSION_NO_STATE: ReadonlySet<string> = new Set([
    "binding", "listeners", "serial", "made", "conflictsCache", "draftsCache", "readinessCache", "draftedViews", "compiledTransform", "compileTransform", "merger",
]);
const CLIENT_NO_STATE: ReadonlySet<string> = new Set(["stepsLost", "remade", "asked", "record", "unseen"]);
const KEYS_PRINT: PrintRules = {
    skip: (owner, key) => (owner instanceof EditSession ? SESSION_NO_STATE.has(key) : owner instanceof KeysClient && CLIENT_NO_STATE.has(key)),
    // A request's bytes hold the id it drew at random: read as the batch they are, the id is named by its order.
    read: (_owner, key, value) => (key === "payload" && value instanceof Uint8Array ? decodeBatch(value) : value),
};

/** An operation's parts: who does it, what, and to what. */
function partsOf(op: KeysOp): { readonly who: string; readonly name: string; readonly args: readonly string[] } {
    const dot = op.indexOf(".");
    const [who, rest] = [op.slice(0, dot), op.slice(dot + 1)];
    const open = rest.indexOf("(");
    return open < 0 ? { who, name: rest, args: [] } : { who, name: rest.slice(0, open), args: rest.slice(open + 1, -1).split(",") };
}

/** The operations that read or write the record itself: what one actor's must be ordered against another's. */
const TOUCHES_RECORD: ReadonlySet<string> = new Set(["deliver", "deliverUnanswered", "see", "reload"]);

/**
 * Whether two operations may run in either order to the same end: those of different actors, unless each reads or
 * writes the record itself. What an exploration of every ordering leaves out one order of.
 *
 * @param a - One operation
 * @param b - Another
 * @returns Whether their order is no matter
 */
export function keysIndependent(a: KeysOp, b: KeysOp): boolean {
    const [x, y] = [partsOf(a), partsOf(b)];
    if (x.who === y.who) return false;
    const touches = (op: { readonly who: string; readonly name: string }) => op.who === "remote" || TOUCHES_RECORD.has(op.name);
    return !(touches(x) && touches(y));
}

/**
 * A keys world: the record, its clients, and the operations run in it so far.
 */
export class KeysWorld {
    /** The record. */
    readonly record = new ModelRecord(START);
    /** The clients. */
    readonly clients: KeysClient[];
    /** The operations run, in order. */
    readonly ran: KeysOp[] = [];
    /** Each row another session added, by its tag: the value it was added at. */
    readonly theirs = new Map<string, bigint>();
    /** The keys of the rows no page shows: another session's, out of the window the pages read. */
    private readonly unseen = new Set<string>();
    private remotes: number;
    private remoteNext = 900n;

    /**
     * @param options - What it is made of
     */
    constructor(private readonly options: KeysOptions) {
        this.clients = Array.from({ length: options.clients ?? 1 }, (_, i) => new KeysClient(`c${i}`, i, this.record, options.shape, options.rule, options.inline === true, this.unseen));
        this.remotes = options.remotes ?? 2;
    }

    /**
     * Each session's first read of its source.
     *
     * @throws {ModelFault} What failed
     */
    async start(): Promise<void> {
        for (const client of this.clients) await client.drive();
        this.check();
    }

    /** Whether a page of this world was reloaded while a Save's outcome was not known. */
    get unsure(): boolean { return this.clients.some((client) => client.unsure); }

    /** How many new rows this world's sessions gave another key. */
    get remade(): number { return this.clients.reduce((n, client) => n + client.remade, 0); }

    /** How often a session's steps went under its person, in this world. */
    get stepsLost(): number { return this.clients.reduce((n, client) => n + client.stepsLost, 0); }

    /** How often a person was asked to choose where no page had been reloaded with a Save unresolved, in this world. */
    get asked(): number { return this.clients.reduce((n, client) => n + client.asked, 0); }

    /**
     * The world's print: everything it holds that what it does next may turn on, and nothing that only counts. Two
     * worlds with one print go on alike.
     *
     * @returns The print
     */
    print(): string {
        return fingerprint({ record: this.record, clients: this.clients, theirs: this.theirs, unseen: this.unseen, remotes: this.remotes, remoteNext: this.remoteNext }, KEYS_PRINT);
    }

    /**
     * The operations that can run now, by name.
     *
     * @returns Each one
     */
    enabled(): KeysOp[] {
        const ops: KeysOp[] = [];
        this.clients.forEach((client, i) => {
            const c = `c${i}`;
            const { session } = client;
            const acts = client.acts < (this.options.acts ?? Number.POSITIVE_INFINITY);
            const sends = client.requests < (this.options.sends ?? Number.POSITIVE_INFINITY);
            // While a conflict waits — a world reloaded with a Save unresolved — its person chooses before they go on.
            const free = session.writable && session.unsettled === 0;
            if (acts && free) ops.push(`${c}.make`);
            if (acts && free && client.last !== undefined) ops.push(`${c}.edit`, `${c}.remove`);
            if (session.canUndo) ops.push(`${c}.undo`);
            if (session.canRedo) ops.push(`${c}.redo`);
            if (sends && session.canApply && client.out === undefined) ops.push(`${c}.save`);
            if (client.out !== undefined) ops.push(`${c}.deliver`, `${c}.deliverUnanswered`, `${c}.lose`);
            if (session.status === "unknown" && client.out === undefined) ops.push(`${c}.retry`);
            if (!textEqual(client.known.revision, this.record.revision)) ops.push(`${c}.see`);
            if (client.reading) ops.push(`${c}.read`);
            if (!textEqual(client.screen.revision, client.known.revision)) ops.push(`${c}.redraw`);
            if (acts && session.unsettled > 0 && !session.carrying) ops.push(`${c}.settle(draft)`, `${c}.settle(source)`);
            if (session.pending > 0 || session.locked) ops.push(`${c}.reload`);
        });
        if (this.remotes > 0) ops.push("remote.add");
        // A row out of view: only where a page reads a window of the record, never the record whole.
        if (this.remotes > 0 && this.options.inline !== true) ops.push("remote.addUnseen");
        return ops;
    }

    /**
     * Runs one operation, then hands each session what it knows until it rests, and checks what must hold.
     *
     * @param op - The operation, by name
     * @throws {ModelFault} What failed, with the operations that led to it
     */
    async run(op: KeysOp): Promise<void> {
        this.ran.push(op);
        try {
            const { who, name, args } = partsOf(op);
            if (who === "remote") this.remote(name === "addUnseen");
            else {
                const client = this.clients[Number(who.slice(1))];
                if (client === undefined) throw new Error(`No client ${who}`);
                await this.act(client, name, args);
            }
            await this.settle();
        } catch (error) {
            throw this.fault(error);
        }
    }

    /** Each session handed what it knows until it rests, and what must hold checked. */
    private async settle(): Promise<void> {
        for (const client of this.clients) await client.drive();
        for (const client of this.clients) client.syncSteps();
        this.check();
    }

    /**
     * Another session's row, saved under the key the world's rule makes from the record as it stands — the very key a
     * session of the harness makes for its own next row.
     *
     * @param unseen - Whether it stands out of view: a row no page shows
     */
    private remote(unseen: boolean): void {
        this.remotes--;
        const keys = [...this.record.now.keys()];
        let key: string;
        if (this.options.rule === "madeFrom") {
            let n = 2;
            while (keys.some((held) => textEqual(held, `${FROM}-${n}`))) n++;
            key = `${FROM}-${n}`;
        } else {
            key = printNumber((largestOf(keys) ?? 0n) + 1n);
        }
        const row = { a: this.remoteNext++, b: this.remoteNext++ };
        this.theirs.set(tagOf(row), row.b);
        if (unseen) this.unseen.add(key);
        this.record.write((rows) => { rows.set(key, row); });
    }

    private async act(client: KeysClient, name: string, args: readonly string[]): Promise<void> {
        switch (name) {
            case "make": client.make(); break;
            case "edit": client.edit(); break;
            case "remove": client.remove(); break;
            case "undo": client.undo(); break;
            case "redo": client.redo(); break;
            case "save": await client.save(); break;
            case "deliver": this.committed(client, await client.deliver(true)); break;
            case "deliverUnanswered": this.committed(client, await client.deliver(false)); break;
            case "lose": await client.lose(); break;
            case "retry": await client.retry(); break;
            case "see": client.see(); break;
            case "read": client.read(); break;
            case "redraw": client.redraw(); break;
            case "settle": client.settle(args[0] as ConflictChoice); break;
            case "reload": client.reload(); break;
            default: throw new Error(`No operation ${name}`);
        }
    }

    /**
     * The record took a client's batch: no row of it is saved over a row someone keeps. A commit that puts a row where
     * another stood wrote over that one — which is its person's to do only to a row of their own they had let go as
     * the request was sent: one removed, or its making taken back, while the Save that added it was on its way, and a
     * new row made under its key.
     *
     * @param client - Whose batch it is
     * @param kept - What its person kept of their rows as the request was first sent; `undefined` where the record took none
     */
    private committed(client: KeysClient, kept: ReadonlyMap<string, bigint | undefined> | undefined): void {
        // A choice made after a reload with a Save unresolved may put one row over another, by its person's own word.
        if (kept === undefined || this.unsure) return;
        const commit = this.record.commits[this.record.commits.length - 1]!;
        for (const change of commit.changed) {
            if (!textEqual(change.field, "a") || change.before === undefined || change.after === undefined) continue;
            const over = printNumber(change.before);
            if (kept.has(over) && kept.get(over) === undefined) continue;
            throw new ModelFault(`${client.name}'s Save put the row ${printNumber(change.after)} under ${change.key}, over the row ${over} there, which ${kept.has(over) ? "its person kept as it was sent" : "is not its person's"}`);
        }
    }

    /** What holds after every operation. */
    private check(): void {
        for (const client of this.clients) {
            client.observe(this.unsure);
            const { session } = client;
            if (session.pending !== client.drafted()) {
                throw new ModelFault(`${client.name} says ${session.pending} pending, and holds ${client.drafted()} rows drafted away from what they began as`);
            }
            if ((client.out !== undefined) !== (session.status === "applying")) {
                throw new ModelFault(`${client.name} ${client.out === undefined ? "has no request" : "has a request"} on its way, and says it is ${session.status}`);
            }
        }
        // No row is saved twice: the record never holds a row under two keys.
        const under = new Map<string, string>();
        for (const [key, row] of this.record.now) {
            const tag = tagOf(row);
            const other = under.get(tag);
            if (other !== undefined) throw new ModelFault(`The record holds the row ${tag} twice: under ${other} and under ${key}`);
            under.set(tag, key);
        }
        if (this.record.applied !== this.record.commits.filter((commit) => commit.by !== "remote").length) {
            throw new ModelFault("The record applied a batch more than once");
        }
    }

    /**
     * Brings the world to rest — every request answered, every revision heard of, read and drawn, every change saved —
     * and checks what must hold of a world at rest.
     *
     * @throws {ModelFault} What failed, with the operations that led to it
     */
    async rest(): Promise<void> {
        const from = this.ran.length;
        try {
            for (let round = 0; ; round++) {
                if (round === 60) throw new ModelFault("The world never comes to rest");
                let moved = false;
                for (const [i, client] of this.clients.entries()) {
                    const { session } = client;
                    const step = async (ready: boolean, name: string, args: readonly string[] = []) => {
                        if (!ready) return;
                        moved = true;
                        this.ran.push(`c${i}.${name}${args.length > 0 ? `(${args.join(",")})` : ""}`);
                        await this.act(client, name, args);
                        await this.settle();
                    };
                    await step(client.out !== undefined, "deliver");
                    await step(!textEqual(client.known.revision, this.record.revision), "see");
                    await step(client.reading, "read");
                    await step(!textEqual(client.screen.revision, client.known.revision), "redraw");
                    await step(session.unsettled > 0 && !session.carrying, "settle", ["draft"]);
                    await step(session.status === "unknown" && client.out === undefined, "retry");
                    await step(session.canApply && client.out === undefined, "save");
                }
                if (!moved) break;
            }
            const held = new Map([...this.record.now.values()].map((row) => [tagOf(row), row.b] as const));
            for (const client of this.clients) {
                const { session } = client;
                if (session.status !== "idle" || session.pending !== 0 || session.unsettled !== 0 || session.locked || session.carrying || session.landed.size !== 0) {
                    throw new ModelFault(`${client.name} is not at rest: ${session.status}, ${session.pending} pending, ${session.unsettled} conflicts, ${session.landed.size} landed${session.error === undefined ? "" : `, "${session.error}"`}`);
                }
                if (!rowsEqual(client.screen.rows, this.record.now)) throw new ModelFault(`${client.name}'s screen is not the record`);
                if (this.unsure) continue;
                // Every row its person made and kept is in the record, at their value; every one they removed is gone.
                for (const [tag, value] of client.made) {
                    const saved = held.get(tag);
                    if (value === undefined ? saved !== undefined : saved === undefined || !numberEqual(saved, value)) {
                        throw new ModelFault(`${client.name}'s person ${value === undefined ? "removed" : `put at ${printNumber(value)}`} their row ${tag}, and the record holds ${saved === undefined ? "none of it" : `it at ${printNumber(saved)}`}`);
                    }
                }
            }
            // And every row another session added is there as it was added.
            for (const [tag, value] of this.unsure ? [] : this.theirs) {
                const saved = held.get(tag);
                if (saved === undefined || !numberEqual(saved, value)) {
                    throw new ModelFault(`Another session's row ${tag} is ${saved === undefined ? "gone from the record" : `at ${printNumber(saved)} in the record, not ${printNumber(value)}`}`);
                }
            }
        } catch (error) {
            throw this.fault(error, from);
        }
    }

    /** A fault, with the operations that led to it: those run, and those the world ran itself as it came to rest. */
    private fault(error: unknown, restFrom?: number): Error {
        if (!(error instanceof ModelFault)) return error instanceof Error ? error : new Error(String(error));
        if (error.message.includes("\n  after: ")) return error;
        const ran = restFrom === undefined ? this.ran.join(" → ") : `${this.ran.slice(0, restFrom).join(" → ")}\n  then, coming to rest: ${this.ran.slice(restFrom).join(" → ")}`;
        return new ModelFault(`${error.message}\n  after: ${ran}\n  drafts: ${this.options.shape}, keys: ${this.options.rule}${this.options.inline === true ? ", read whole" : ""}`);
    }
}

/**
 * A keys world with some operations run in it.
 *
 * @param options - What the world is made of
 * @param ops - The operations, in order
 * @returns The world
 * @throws {ModelFault} What failed, with the operations that led to it
 */
export async function keysWorldAfter(options: KeysOptions, ops: readonly KeysOp[]): Promise<KeysWorld> {
    const world = new KeysWorld(options);
    await world.start();
    for (const op of ops) await world.run(op);
    return world;
}
