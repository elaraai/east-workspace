/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * One person at a builder over two records (test use): a session a record
 * under one history (`EditHistory`), as the Roster's duties and weeks or the
 * Plan's event kinds are, each record with a source and a screen of its own —
 * and every operation that can meet there: a gesture in one record or across
 * both, an optimiser's result in either, Undo, Redo, Discard — the history's,
 * or one record's banner's — Save, an automatic Save, one asked for when the
 * history says it has nothing to send, each record's request delivered,
 * delivered with its answer lost, or lost, a write with no answer asked again
 * — by Save, by its record's banner or by the automatic Save — and each
 * record's reads landing late.
 *
 * No one else writes here, so what the person should see is known exactly:
 * each row as their steps leave it. What the desk holds, of every ordering:
 *
 * - **One step a gesture.** Undo takes back a gesture whole, in every record
 *   it changed, and Redo replays it; each is there exactly while a step is,
 *   and each session's own steps are the history's steps' parts in it, done
 *   and undone, no more. One record's drafts discarded take its parts out of
 *   the steps, and leave the other's.
 * - **The screen is the person's.** After every operation each record's rows
 *   read as their steps leave them: through a Save, its answer lost, its read
 *   back late.
 * - **A Save writes what its person saw**, each record's request its own; an
 *   automatic Save writes the screen as it stood before the first optimiser's
 *   result no person's Save has taken — in the order the gestures were made,
 *   whichever record it is in — and nothing from where Undo or Redo left the
 *   steps.
 * - **An automatic Save is there exactly when it has something to send.**
 *   Nothing on its way and everything read, the history says one may send
 *   exactly while the steps stand where the last change left them and a record
 *   holds another row than the one an automatic Save would write: a change it
 *   may send never waits unsaid, and it never offers what it may not. Asked
 *   for while it says it has nothing, it sends nothing.
 * - **One request a record at a time.** No record is sent a request while its
 *   last is unanswered.
 * - **It converges.** Everything answered and read, nothing is pending, every
 *   session is idle, and each record holds what its screen shows.
 *
 * @packageDocumentation
 */
import { IntegerType, StringType, decodeBeast2For, none, printFor, some, variant, type option } from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";
import { liftDraft, normalizeDraft } from "../draft.js";
import { EditHistory } from "../history.js";
import { readBeforeSave } from "../landed.js";
import { EditSession, type EntryVersion } from "../session.js";
import { Batch, FIELDS, ModelRecord, Row, sameValue, textEqual, type Answer, type BatchValue, type Field, type RowValue, type RowsValue } from "./record.test-utils.js";
import { fingerprint, type PrintRules } from "./explore.test-utils.js";
import { ModelFault, type DraftShape, type ModelOp } from "./world.test-utils.js";

const DRAFT_TYPES = { fields: Editing.Types.Draft(Row), whole: Editing.Types.DraftField(Row) } as const;
const decodeBatch = decodeBeast2For(Batch);
const printNumber = printFor(IntegerType);
const printRow = printFor(Row);
const KEY_ORDER = some(variant("keyOrder", null));
/** The records' names: the sessions' keys in the history. */
const RECORDS = ["A", "B"] as const;
type RecordName = (typeof RECORDS)[number];
/** The one row each record holds. */
const KEY = "k1";

async function settled(): Promise<void> {
    for (let i = 0; i < 12; i++) await Promise.resolve();
}

/** A field's value, in words. */
function say(value: bigint | undefined): string {
    return value === undefined ? "no row" : printNumber(value);
}

/** One record's side of the desk: its session, what its source reports, its screen and its request. */
interface Side {
    readonly record: ModelRecord;
    readonly session: EditSession<undefined>;
    known: { revision: string; readonly asked: Set<string>; readonly landed: Set<string> };
    screen: { revision: string; rows: RowsValue };
    out: { readonly batch: BatchValue; readonly resolve: (answer: Answer) => void; readonly reject: (error: Error) => void } | undefined;
    /** What its person's screen showed of the record as each request was first sent — or, for an automatic one, as an automatic Save may send it. */
    readonly sent: Map<string, RowValue>;
    /** The row as the person's steps leave it. */
    row: RowValue;
}

/** What a desk may budget, so that it can be in finitely many states: the most gestures its person makes, and the most requests they start. */
export interface DeskBudgets {
    /** The most gestures: unbounded by default. */
    readonly acts?: number | undefined;
    /** The most requests, each counted once however often it is sent: unbounded by default. */
    readonly sends?: number | undefined;
}

/** What a print of a desk leaves out: what is no state — caches, counters that only count, what a session or the history is bound to. */
const SESSION_NO_STATE: ReadonlySet<string> = new Set([
    "binding", "listeners", "serial", "made", "conflictsCache", "draftsCache", "readinessCache", "draftedViews", "compiledTransform", "compileTransform", "merger",
]);
const HISTORY_NO_STATE: ReadonlySet<string> = new Set(["listeners", "serial", "unsubscribes"]);
const DESK_PRINT: PrintRules = {
    skip: (owner, key) => (owner instanceof EditSession ? SESSION_NO_STATE.has(key) : owner instanceof EditHistory && HISTORY_NO_STATE.has(key)),
    // A request's bytes hold the id it drew at random: read as the batch they are, the id is named by its order.
    read: (_owner, key, value) => (key === "payload" && value instanceof Uint8Array ? decodeBatch(value) : value),
};

/** One step: each record's row before and after it, and whether it is an optimiser's result. */
interface DeskStep {
    readonly parts: readonly { readonly at: RecordName; readonly before: RowValue; readonly after: RowValue }[];
    readonly optimise: boolean;
}

/** The desk — see the module docs. */
export class ModelDesk {
    readonly history = new EditHistory<undefined>();
    readonly sides: Record<RecordName, Side>;
    /** The operations run, in order. */
    readonly ran: ModelOp[] = [];
    private steps: DeskStep[] = [];
    private cursor = 0;
    /** How many done steps a person's Save has taken. */
    private taken = 0;
    /** How many steps were done as the last change was made, or a person's Save took them. */
    private left = 0;
    private sending: "person" | "automatic" = "person";
    private misfire: string | undefined;
    /** How many requests have been sent, each counted once however often it is sent again. */
    private firstSends = 0;
    private next = 100n;

    /** How many gestures its person has made: what a desk budgets (`acts`). */
    private acts = 0;

    /**
     * @param shape - How its sessions draft a row
     * @param budgets - What it budgets; nothing by default
     */
    constructor(private readonly shape: DraftShape, private readonly budgets: DeskBudgets = {}) {
        const side = (name: RecordName): Side => {
            const record = new ModelRecord([[KEY, { a: 1n, b: 2n }]]);
            const made: Side = {
                record, known: { revision: record.revision, asked: new Set(), landed: new Set() }, screen: { revision: record.revision, rows: record.now },
                out: undefined, sent: new Map(), row: { a: 1n, b: 2n },
                session: new EditSession<undefined>({
                    sourceId: `rows-${name}`, entryType: Row, draftType: DRAFT_TYPES[shape], keyType: StringType, patch: undefined, drawsLanded: true,
                    refresh: (revision) => { if (revision.type === "some" && !textEqual(revision.value, made.known.revision)) made.known = { revision: revision.value, asked: new Set(), landed: new Set() }; },
                    apply: (bytes) => new Promise<Answer>((resolve, reject) => {
                        const batch = decodeBatch(bytes);
                        if (made.out !== undefined) this.misfire = `Record ${name} was sent a request while its last is unanswered`;
                        if (!made.sent.has(batch.requestId)) {
                            this.firstSends++;
                            if (this.sending === "automatic" && this.left !== this.cursor) this.misfire = `An automatic Save sent record ${name} from where Undo or Redo left the steps`;
                            made.sent.set(batch.requestId, this.sending === "automatic" ? this.rowForAutomatic(name) : made.row);
                        }
                        made.out = { batch, resolve, reject };
                    }),
                }),
            };
            return made;
        };
        this.sides = { A: side("A"), B: side("B") };
        this.history.sync(RECORDS.map((name) => [name, this.sides[name].session] as const));
    }

    private versionOf(row: RowValue): EntryVersion<undefined> {
        return { draft: liftDraft(DRAFT_TYPES[this.shape], row), wire: undefined, place: KEY_ORDER };
    }

    /** The version a gesture on a record's row begins from: the row its person is looking at. */
    private startOf(side: Side): EntryVersion<undefined> {
        // The session's own rule (`EditSession.startOf`), given the screen's row: every host asks it so.
        return side.session.startOf(KEY, () => this.versionOf(side.screen.rows.get(KEY)!))!;
    }

    /** The row its person sees of a record. */
    shown(name: RecordName): RowValue | undefined {
        const draft = this.startOf(this.sides[name]).draft;
        return draft === undefined ? undefined : normalizeDraft(DRAFT_TYPES[this.shape], draft, KEY).domain as RowValue | undefined;
    }

    /** A record's row as an automatic Save may send it: as it stood before the first done step that is an optimiser's result no person's Save has taken. */
    private rowForAutomatic(name: RecordName): RowValue {
        const stop = this.steps.findIndex((step, i) => i >= this.taken && i < this.cursor && step.optimise);
        let row = this.sides[name].row;
        for (let i = this.cursor - 1; stop >= 0 && i >= stop; i--) {
            const part = this.steps[i]!.parts.find((p) => p.at === name);
            if (part !== undefined) row = part.before;
        }
        return row;
    }

    /** Each session handed what its source reports, as `useEditSession` hands it, until it rests. */
    private async drive(): Promise<void> {
        for (const name of RECORDS) {
            const side = this.sides[name];
            for (let pass = 0; ; pass++) {
                if (pass === 24) throw new ModelFault(`Record ${name}'s session never rests`);
                const before = side.session.getSnapshot();
                const revision = side.known.revision;
                const base = variant("revision", revision);
                side.session.recheck(undefined, undefined);
                const reads = new Map<string, option<unknown>>();
                for (const id of side.session.readIdsAt(revision)) {
                    if (!side.known.landed.has(id)) { side.known.asked.add(id); continue; }
                    const row = side.record.at(revision).get(id);
                    reads.set(id, row === undefined ? none : some(row));
                }
                const read = (id: string): option<unknown> | undefined => reads.get(id);
                side.session.confirmFailed(undefined);
                side.session.reconcile(base, read);
                side.session.nameConflicts(base, read);
                side.session.observeBase(base);
                side.session.merge(base, read);
                const drawn = [...side.session.landed].filter(([, landed]) => !readBeforeSave(side.screen.revision, side.known.revision, landed.from)).map(([key]) => key);
                if (drawn.length > 0) side.session.shown(drawn);
                await settled();
                if (side.session.getSnapshot() === before && textEqual(side.known.revision, revision)) break;
            }
        }
    }

    /**
     * The desk's print: everything it holds that what it does next may turn on — each record and its every revision,
     * the history and each session's every field, its person's steps — and nothing that only counts. Two desks with
     * one print go on alike.
     *
     * @returns The print
     */
    print(): string {
        return fingerprint({
            history: this.history, sides: this.sides, steps: this.steps, cursor: this.cursor, taken: this.taken, left: this.left,
            sending: this.sending, misfire: this.misfire, firstSends: this.firstSends, acts: this.acts, next: this.next,
        }, DESK_PRINT);
    }

    /** The operations that can run now, by name. */
    enabled(): ModelOp[] { return this.open(true); }

    /** The operations that can run now — within the desk's budgets, or, coming to rest, whatever they are. */
    private open(budgeted: boolean): ModelOp[] {
        const ops: ModelOp[] = [];
        const acts = !budgeted || this.acts < (this.budgets.acts ?? Number.POSITIVE_INFINITY);
        const sends = !budgeted || this.firstSends < (this.budgets.sends ?? Number.POSITIVE_INFINITY);
        const [a, b] = [acts && this.sides.A.session.writable, acts && this.sides.B.session.writable];
        if (a) ops.push("edit(A)", "optimise(A)");
        if (b) ops.push("edit(B)", "optimise(B)");
        if (a && b) ops.push("both");
        if (this.history.canUndo) ops.push("undo");
        if (this.history.canRedo) ops.push("redo");
        if (this.history.canDiscard && this.history.pending > 0) ops.push("discard");
        // One record's banner's Discard: its drafts alone.
        for (const name of RECORDS) if (this.sides[name].session.canDiscard && this.sides[name].session.pending > 0) ops.push(`discard(${name})`);
        // A write left with no answer is asked again once its request is no longer on its way.
        const unanswered = RECORDS.some((name) => this.sides[name].session.status === "unknown");
        if (unanswered ? RECORDS.every((name) => this.sides[name].out === undefined || this.sides[name].session.status !== "unknown") : sends && this.history.canApply) ops.push("save");
        if (sends && this.history.canAutosave) ops.push("autosave");
        else if (sends && this.history.pending > 0) ops.push("autosaveAnyway");
        if (RECORDS.some((name) => this.sides[name].session.status === "unknown" && this.sides[name].out === undefined)) ops.push("askAgain");
        for (const name of RECORDS) {
            const side = this.sides[name];
            // Its banner's Retry: a write left with no answer, sent again for this record alone.
            if (side.session.status === "unknown" && side.out === undefined) ops.push(`retry(${name})`);
            if (side.out !== undefined) ops.push(`deliver(${name})`, `deliverUnanswered(${name})`, `lose(${name})`);
            if ([...side.known.asked].some((id) => !side.known.landed.has(id))) ops.push(`read(${name})`);
            if (!textEqual(side.screen.revision, side.known.revision)) ops.push(`redraw(${name})`);
        }
        return ops;
    }

    /** Hands each session what its source reports to begin with, and checks what must hold. */
    async start(): Promise<void> {
        await this.drive();
        this.check();
    }

    /**
     * Runs one operation, then hands each session what it knows until it rests, and checks what must hold.
     *
     * @param op - The operation, by name
     * @throws {ModelFault} What failed, with the operations that led to it
     */
    async run(op: ModelOp): Promise<void> {
        this.ran.push(op);
        try {
            await this.act(op);
            await this.drive();
            this.check();
        } catch (error) {
            if (!(error instanceof ModelFault) || error.message.includes("\n  after: ")) throw error;
            throw new ModelFault(`${error.message}\n  after: ${this.ran.join(" → ")}\n  drafts: ${this.shape}`);
        }
    }

    /** A gesture: each record's row put at a new value in one step. */
    private gesture(names: readonly RecordName[], optimise: boolean): void {
        const parts = names.map((at) => {
            const side = this.sides[at];
            const before = side.row;
            const after = { ...before, a: this.next++ };
            return { at, before, after, update: { id: KEY, before: this.startOf(side), after: this.versionOf(after) } };
        });
        const took = this.history.record(parts.map((part) => ({ key: part.at, updates: [part.update] })), optimise ? "optimise" : "typed", `Set ${names.join(" and ")}`);
        if (!took) throw new ModelFault(`A gesture in ${names.join(" and ")} was not taken`);
        this.acts++;
        for (const part of parts) this.sides[part.at].row = part.after;
        if (this.taken > this.cursor) this.taken = this.cursor;
        this.steps.splice(this.cursor);
        this.steps.push({ parts: parts.map(({ at, before, after }) => ({ at, before, after })), optimise });
        this.cursor = this.steps.length;
        this.left = this.cursor;
    }

    private async act(op: ModelOp): Promise<void> {
        const open = op.indexOf("(");
        const [name, at] = open < 0 ? [op, undefined] : [op.slice(0, open), op.slice(open + 1, -1) as RecordName];
        const side = at === undefined ? undefined : this.sides[at];
        switch (name) {
            case "edit": this.gesture([at!], false); break;
            case "optimise": this.gesture([at!], true); break;
            case "both": this.gesture(RECORDS, false); break;
            case "undo": {
                const step = this.steps[--this.cursor]!;
                this.history.undo();
                for (const part of step.parts) this.sides[part.at].row = part.before;
                break;
            }
            case "redo": {
                const step = this.steps[this.cursor++]!;
                this.history.redo();
                for (const part of step.parts) this.sides[part.at].row = part.after;
                break;
            }
            case "discard":
                if (at !== undefined) { this.discardOne(at); break; }
                this.history.discard();
                // Every draft dropped: each record's row is the record's.
                for (const each of RECORDS) this.sides[each].row = this.sides[each].record.now.get(KEY)!;
                this.steps = []; this.cursor = 0; this.taken = 0; this.left = 0;
                break;
            case "save":
                this.sending = "person";
                // A person's Save takes every step done so far — unless it is the Retry of a write left with no answer.
                if (this.history.status !== "unknown") { this.taken = this.cursor; this.left = this.cursor; }
                void this.history.apply();
                await settled();
                break;
            case "autosave":
                this.sending = "automatic";
                void this.history.autosave();
                await settled();
                break;
            case "autosaveAnyway": {
                // Asked for while the history says it has nothing an automatic Save may send: nothing goes.
                this.sending = "automatic";
                const sends = this.firstSends;
                void this.history.autosave();
                await settled();
                if (this.firstSends !== sends) throw new ModelFault("An automatic Save sent a request while the history said it had nothing to send");
                break;
            }
            // A write left with no answer, asked again: the same request, whoever asks.
            case "askAgain": this.history.retry(); await settled(); break;
            case "retry": this.history.actOn(at!, "apply"); await settled(); break;
            case "deliver": case "deliverUnanswered": case "lose": {
                const out = side!.out!;
                side!.out = undefined;
                if (name !== "lose") {
                    const before = side!.record.commits.length;
                    const answer = side!.record.commit(out.batch, "desk");
                    if (side!.record.commits.length > before) this.committed(at!, out.batch);
                    else if (answer.type !== "applied") throw new ModelFault(`Record ${at!} refused a Save, with no one else writing`);
                    if (name === "deliver") out.resolve(answer);
                    else out.reject(new Error("No answer"));
                } else out.reject(new Error("No answer"));
                await settled();
                break;
            }
            case "read": for (const id of side!.known.asked) side!.known.landed.add(id); break;
            case "redraw": side!.screen = { revision: side!.known.revision, rows: side!.record.at(side!.known.revision) }; break;
            default: throw new Error(`No operation ${op}`);
        }
    }

    /** One record's drafts discarded, by its banner: its row is the record's, and its parts leave the steps — a step left with none goes. */
    private discardOne(at: RecordName): void {
        this.history.actOn(at, "discard");
        this.sides[at].row = this.sides[at].record.now.get(KEY)!;
        const kept: DeskStep[] = [];
        let [cursor, taken, left] = [this.cursor, this.taken, this.left];
        this.steps.forEach((step, i) => {
            const parts = step.parts.filter((part) => part.at !== at);
            if (parts.length > 0) { kept.push({ parts, optimise: step.optimise }); return; }
            if (i < this.cursor) cursor--;
            if (i < this.taken) taken--;
            if (i < this.left) left--;
        });
        this.steps = kept;
        [this.cursor, this.taken, this.left] = [cursor, taken, left];
    }

    /** A record took its batch: each field it changed is set to what the screen showed as the request was sent. */
    private committed(at: RecordName, batch: BatchValue): void {
        const side = this.sides[at];
        const commit = side.record.commits[side.record.commits.length - 1]!;
        const meant = side.sent.get(batch.requestId);
        for (const { field, after } of commit.changed) {
            if (!sameValue(meant?.[field], after)) {
                throw new ModelFault(`Record ${at}'s Save set ${field} to ${say(after)}, and its screen showed ${say(meant?.[field])} as it was sent`);
            }
        }
    }

    /** Whether nothing is on its way: every request answered, every session idle, every read landed. */
    private quiet(): boolean {
        return RECORDS.every((name) => {
            const side = this.sides[name];
            return side.out === undefined && side.session.status === "idle" && !side.session.locked && [...side.known.asked].every((id) => side.known.landed.has(id));
        });
    }

    /** What holds after every operation. */
    private check(): void {
        if (this.misfire !== undefined) throw new ModelFault(this.misfire);
        for (const name of RECORDS) {
            const [is, want] = [this.shown(name), this.sides[name].row];
            if (is === undefined || FIELDS.some((field: Field) => !sameValue(is[field], want[field]))) {
                throw new ModelFault(`Record ${name} shows ${is === undefined ? "no row" : printRow(is)}, and its person's steps leave ${printRow(want)}`);
            }
        }
        if (this.quiet()) {
            const may = this.left === this.cursor && RECORDS.some((name) => {
                const [send, held] = [this.rowForAutomatic(name), this.sides[name].record.now.get(KEY)!];
                return FIELDS.some((field: Field) => !sameValue(send[field], held[field]));
            });
            if (this.history.canAutosave !== may) {
                throw new ModelFault(may ? "An automatic Save has a change it may send, and the history says it has none" : "The history says an automatic Save may send, and it has nothing it may");
            }
        }
        for (const name of RECORDS) {
            const mine = this.steps.map((step) => step.parts.some((part) => part.at === name));
            const [done, undone] = [mine.slice(0, this.cursor).filter(Boolean).length, mine.slice(this.cursor).filter(Boolean).length];
            const depth = this.sides[name].session.depth;
            if (depth.undo !== done || depth.redo !== undone) {
                throw new ModelFault(`Record ${name}'s session holds ${depth.undo} steps done and ${depth.redo} to replay, and the history's steps hold ${done} and ${undone} of it`);
            }
        }
        if (this.history.canUndo !== (this.cursor > 0)) throw new ModelFault(`Undo is ${this.history.canUndo ? "on" : "off"} with ${this.cursor} steps done`);
        if (this.history.canRedo !== (this.cursor < this.steps.length)) throw new ModelFault(`Redo is ${this.history.canRedo ? "on" : "off"} with ${this.steps.length - this.cursor} steps to replay`);
    }

    /**
     * Brings the desk to rest — every request answered, every read landed and drawn, every change saved — and checks
     * what must hold of it at rest.
     *
     * @throws {ModelFault} What failed, with the operations that led to it
     */
    async rest(): Promise<void> {
        const from = this.ran.length;
        try {
            for (let round = 0; ; round++) {
                if (round === 60) throw new ModelFault("The desk never comes to rest");
                const todo = this.open(false).find((op) => /^(deliver\(|read|redraw|save)/.test(op));
                if (todo === undefined) break;
                this.ran.push(todo);
                await this.act(todo);
                await this.drive();
                this.check();
            }
            if (this.history.status !== "idle" || this.history.pending !== 0) throw new ModelFault(`The desk is not at rest: ${this.history.status}, ${this.history.pending} pending`);
            for (const name of RECORDS) {
                const [held, want] = [this.sides[name].record.now.get(KEY)!, this.sides[name].row];
                if (FIELDS.some((field: Field) => !sameValue(held[field], want[field]))) throw new ModelFault(`Record ${name} holds another row than its person's steps leave`);
            }
        } catch (error) {
            if (!(error instanceof ModelFault) || error.message.includes("\n  after: ")) throw error;
            throw new ModelFault(`${error.message}\n  after: ${this.ran.slice(0, from).join(" → ")}\n  then, coming to rest: ${this.ran.slice(from).join(" → ")}\n  drafts: ${this.shape}`);
        }
    }
}

/**
 * Whether two of a desk's operations' order is no matter: each a record's screen drawn again, of different records.
 * Everything else meets in the one history, so every order of it is run.
 *
 * @param a - One operation
 * @param b - Another
 * @returns Whether running them either way round leaves the same desk
 */
export function deskIndependent(a: ModelOp, b: ModelOp): boolean {
    return a.startsWith("redraw(") && b.startsWith("redraw(") && !textEqual(a, b);
}

/**
 * A desk with some operations run at it.
 *
 * @param shape - How its sessions draft a row
 * @param ops - The operations, in order
 * @param budgets - What the desk budgets; nothing by default
 * @returns The desk
 * @throws {ModelFault} What failed, with the operations that led to it
 */
export async function deskAfter(shape: DraftShape, ops: readonly ModelOp[], budgets: DeskBudgets = {}): Promise<ModelDesk> {
    const desk = new ModelDesk(shape, budgets);
    await desk.start();
    for (const op of ops) await desk.run(op);
    return desk;
}
