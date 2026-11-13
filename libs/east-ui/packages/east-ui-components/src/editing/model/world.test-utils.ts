/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The world of the editing core's proof harness (test use): editing sessions
 * over one record (`record.test-utils.ts`), each with a screen of its own,
 * and every operation that can meet in one — a person's gestures, Undo, Redo
 * and Discard, a conflict's choice, a Save and its answer, an answer lost,
 * a Save prepared before it is sent and its preparation failing, an automatic
 * Save, an optimiser's result, the page reloaded with its drafts kept, another
 * session's write, a new revision heard of before its rows are read, a screen
 * redrawn late — with what must hold after each.
 *
 * A session is driven as `useEditSession` drives one. Whenever it moves, the
 * rows it asks for by their keys at the revision its source reads at
 * (`readIdsAt`) are read — those that have landed — and handed with that
 * revision to its `reconcile`, `nameConflicts`, `observeBase` and `merge`, in
 * that order, until it rests. What a client knows is its own: the revision
 * its source reads at — moved by a poll (`see`), or by the Save it sent —
 * which reads by key have landed there (`read`), and the rows its screen
 * shows, at the revision they were read at (`redraw`).
 *
 * A gesture begins from the row its person is looking at: the session's own
 * version of it; else what the session's last Save left of it, while the
 * screen has yet to show that Save; else the screen's row.
 *
 * A world's sessions read the record a revision at a time, as above — a
 * record read a window at a time — or whole (`inline`), as a record read
 * whole is: the session is handed the whole collection as its base, its
 * source has no revision to install and no refresh, and the screen draws the
 * very collection the session is handed, so a new one heard of (`see`) is
 * read and drawn at once.
 *
 * What the harness holds, of every world:
 *
 * - **A gesture is taken, and does what it says.** Each act changes the
 *   fields it names on its person's screen, and no other.
 * - **A Save writes what its person saw.** Each field a commit changes is set
 *   to what the screen showed there as the request was sent — as Save was
 *   pressed, where the Save is prepared first: nothing done while it is
 *   prepared goes with it. A Save whose preparation fails sends nothing, and
 *   keeps every draft.
 * - **An automatic Save sends only what one may.** Never an optimiser's
 *   result no person's Save has taken, nor a change made over one: it writes
 *   the screen as it stood before that result. And nothing from where Undo
 *   or Redo left the steps. And it is there exactly while it has something
 *   it may send: nothing on its way and nothing to read or choose, a change
 *   it may send never waits unsaid.
 * - **Nothing is overwritten unseen.** A commit changes a field only from a
 *   value its person had been shown: on their screen, or on the card of a
 *   conflict they chose at. A conflict that waits shows nothing by itself —
 *   its builder rings the row — so a gesture that leaves one with no choice
 *   made leaves nothing of the other side's to be written over.
 * - **No change is lost.** What a person put a field at stays on their screen
 *   until a Save of theirs writes it, the record comes to hold it by another's
 *   write, or they take it back: by Undo, by Discard, or by taking the other
 *   side of a conflict. Once everything is answered and every conflict chosen
 *   for the draft, nothing is left unwritten.
 * - **Nothing is sent twice.** One batch a request id, and the record never
 *   refuses a session's Save over that session's own earlier change.
 * - **A conflict holds its record's Save.** While a conflict of a session's
 *   waits to be chosen no Save is offered and no request is made — a
 *   person's, or an automatic one — of the row in conflict or any other.
 * - **A choice stands.** A conflict is asked only of a change still to save;
 *   one chosen for the draft is never asked again; and Undo of a choice no
 *   Save has taken brings its conflict back.
 * - **Undo then Redo is where it was.**
 * - **The counts are true.** Pending is how many rows are drafted away from
 *   what they began as.
 * - **A screen never goes back.** A field never shows a value the record held
 *   before the one the screen last showed there: what a session knows the
 *   source holds — what its Save landed, what it read as its drafts were
 *   carried over — is drawn until the screen's rows are read again.
 * - **It converges.** Answered, read, redrawn and chosen, each session is
 *   idle with nothing pending, and its screen is the record.
 *
 * A world may budget what its people do (`acts`, `sends`, beside `remotes`):
 * so many gestures and choices each, so many requests each. It can then be in
 * finitely many states, each told by its print ({@link ModelWorld.print}) —
 * everything the record, the sessions and their people's steps hold — and
 * every one of them can be met (`everyState`).
 *
 * What it counts, and holds nothing of yet:
 *
 * - how often a session's steps went under its person — Undo lost as the
 *   source moved ({@link ModelClient.stepsLost});
 * - how often a late answer stepped a screen back
 *   ({@link ModelClient.lateAnswer}), where its host cannot say when it read
 *   (`says` false): a Save's answer that came after its source had read at a
 *   newer revision put the source back at the revision the Save committed,
 *   and its rows were drawn there. A host that says — e3's record runtime, and
 *   every other world — has its source follow the record's state instead,
 *   the answer's revision never installed over one the source has moved to:
 *   a screen that goes back there is a fault. And an answer may come in the
 *   very turn its source is told of the record's state now
 *   ({@link ModelClient.deliverPast}): the revision the session asks for is
 *   installed no more, the session not told, and its host's word of when it
 *   read settles the Save all the same — one that waits then is a fault;
 * - how often a person was asked to choose where they had nothing to save,
 *   over a row of a request that had no answer, was sent again and was
 *   refused ({@link ModelClient.unansweredAsked}). A record answers a request
 *   again while it remembers it, as e3 does, and such a request is never
 *   refused: held, of every world whose sessions read the record a revision
 *   at a time. A request it refuses when sent again is one it never took — lost on
 *   its way — or has forgotten (`remembers` 0: what a record is to a request
 *   sixteen others have followed). The refusal says nothing of which, and a
 *   row another session wrote meanwhile reads the same whether the request
 *   landed and was written over, or never landed: the session asks, where
 *   taking the other write unasked would give up an unsaved change in one
 *   case or an Undo of a saved one in the other;
 * - how often a Save over a source read whole waited for good to be read back
 *   ({@link ModelClient.waitedForGood}), where its host cannot say what it
 *   read (`says` false): every part it wrote put back exactly as it was by
 *   another session before the source was read again, which nothing a
 *   collection holds tells from one read before the Save landed. The world
 *   reloads the page then, as its person would, and goes on. And how often such
 *   a session took a collection read before its Save landed for one read
 *   after ({@link ModelClient.readEarly}): another session's row stood under
 *   the key its Save adds, and was gone again by the time the Save landed —
 *   neither side of the Save's change, which is all a collection can show. Its
 *   screen then shows that row until its host reads the record again. A host that says
 *   what its source holds, read since the Save was answered — as e3's record
 *   runtime does, and every world read whole but those — has its Saves read
 *   back there: a Save that waits once its source has read the record since
 *   is a fault.
 *
 * @packageDocumentation
 */
import { IntegerType, StringType, decodeBeast2For, encodeBeast2For, none, printFor, some, toEastTypeValue, variant, type EastType, type option } from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";
import { liftDraft, normalizeDraft } from "../draft.js";
import { readBeforeSave } from "../landed.js";
import { conflictFieldOf, EditSession, type ConflictChoice, type EntryVersion } from "../session.js";
import { fingerprint, type PrintRules } from "./explore.test-utils.js";
import {
    Batch, FIELDS, ModelRecord, Row, rowsEqual, sameValue, textEqual,
    type Answer, type BatchValue, type Field, type RowValue, type RowsValue, type Value, type ModelCommit,
} from "./record.test-utils.js";

/** How a session drafts a row: a field at a time (the Sheet's drafts), or the row whole (the Plan's, and every builder's over `useScheduleEditing`). */
export type DraftShape = "fields" | "whole";

const DRAFT_TYPES: Readonly<Record<DraftShape, EastType>> = { fields: Editing.Types.Draft(Row), whole: Editing.Types.DraftField(Row) };
const decodeBatch = decodeBeast2For(Batch);
const printNumber = printFor(IntegerType);
const KEY_ORDER = some(variant("keyOrder", null));
/** A version of a row the session holds none of. */
const ABSENT: EntryVersion<undefined> = { draft: undefined, wire: undefined, place: none };
/** Every key a world's rows may stand under: two it begins with, and one a session may add. */
export const KEYS: readonly string[] = ["k1", "k2", "k3"];

/** Lets what a promise's answer sets going run to its end. */
async function settled(): Promise<void> {
    for (let i = 0; i < 12; i++) await Promise.resolve();
}

/** A field's value, in words. */
function say(value: Value): string {
    return value === undefined ? "no row" : printNumber(value);
}

/** Whether two conflicts are in the same part of a row: the same field, or each the row itself. */
function sameField(a: Field | undefined, b: Field | undefined): boolean {
    return a === undefined || b === undefined ? a === b : textEqual(a, b);
}

/** A fault the harness found: what failed, in words. The world adds the operations that led to it. */
export class ModelFault extends Error {}

/** One field of one row an act changes on its person's screen: from what to what. */
interface Shift {
    readonly key: string;
    readonly field: Field;
    readonly before: Value;
    readonly after: Value;
}

/** One step of a person's history, as they made it: what Undo takes back, and Redo replays. */
interface Step {
    /** A gesture, or a conflict's choice. */
    readonly kind: "edit" | "settle";
    /** Whether it is an optimiser's result, landed as a step: what no automatic Save sends until a person's Save takes it. */
    readonly optimise: boolean;
    /** For a choice: how many conflicts it left to choose. */
    readonly left: number;
    /** For a choice: how many waited as it was made — as many as it left, where it only settled the other way one settled before. */
    readonly waited?: number | undefined;
    /** Each field it changed on the screen. */
    readonly shifts: readonly Shift[];
    /** For a choice of the draft: each conflict it settled, by its field and the write it stood against. */
    readonly chosen: readonly Chosen[];
    /** How many of its person's Saves the record had taken as it was made: a choice a Save has taken since is no conflict to bring back. */
    readonly saves: number;
    /** Whether a Save of theirs was unresolved as it was made: a conflict read then — its choice undone under the Save that took it — goes as that Save is read back. */
    readonly unresolved: boolean;
    /** For a gesture: whether it left a conflict that waited — put at the other side's value by hand, or back at what both began from. */
    readonly moved?: boolean | undefined;
    /**
     * The changes it made theirs or theirs no more, by `key.field` — as they stood before it, and after: what Undo and
     * Redo put back, while no Save of theirs has taken the step.
     */
    readonly claims: { readonly at: readonly (readonly [string, Field])[]; readonly before: ReadonlyMap<string, Claim | undefined>; readonly after: ReadonlyMap<string, Claim | undefined> };
}

/** A change of its person's still to save: what they put a field at, and what that is a change from. */
interface Claim {
    readonly value: Value;
    readonly from: Value;
}

/**
 * A conflict chosen for the draft: its row, the field it is in — none for a conflict of the row itself — and which of
 * the record's writes there it stood against. A row written again is another conflict.
 */
interface Chosen {
    readonly key: string;
    readonly field: Field | undefined;
    readonly stamp: string;
}

/** What a client's person sees: each row, by its key; `undefined` for one absent. */
type Screen = ReadonlyMap<string, RowValue | undefined>;

/** One client of the world: a session, what it knows of the record, and what its screen shows. */
export class ModelClient {
    /** The session. */
    session: EditSession<undefined>;
    /** What its source reports: the revision it reads at, the rows the session asked for by key there, and those that have landed. */
    known: { revision: string; readonly asked: Set<string>; readonly landed: Set<string> };
    /** What its screen's rows are: read at a revision. */
    screen: { revision: string; rows: RowsValue };
    /**
     * Its request on its way: the batch, what answers it — and, once the record has heard it ({@link ModelClient.land}),
     * the record's answer on its way back.
     */
    out: { readonly batch: BatchValue; readonly resolve: (answer: Answer) => void; readonly reject: (error: Error) => void; readonly answer?: Answer | undefined } | undefined;
    /** Its Save being prepared, before its request is sent: what ends the preparation, either way. */
    preparing: { readonly done: () => void; readonly fail: (error: Error) => void } | undefined;
    /**
     * What its person has changed that no Save of theirs has written yet, by row and field: what they put the field
     * at, and what that is a change from — what the source holds there, as their session knows it; while the row's
     * conflict waits, what the field stood at before they changed it; the other side of a conflict they chose their
     * own over; or what their own Save last wrote there, until the session reads that Save back. A field put back at
     * what it is a change from is no change.
     */
    readonly claims = new Map<string, Map<Field, Claim>>();
    /** How often its session's steps went under its person: Undo lost as the source moved. */
    stepsLost = 0;
    /**
     * How often its person was asked to choose where they had nothing to save, over a row of a request that had no
     * answer, was sent again and was refused: another session wrote the row meanwhile, and nothing the record holds
     * tells whether the request landed first.
     */
    unansweredAsked = 0;
    /** How often a Save of its, over a source read whole, waited for good to be read back: every part it wrote put back since, exactly as it was. */
    waitedForGood = 0;
    /**
     * How often its session, its host unable to say when a collection was read, took one read before its Save landed
     * for one read after, and its screen showed an older row for it until its host read the record again.
     */
    readEarly = 0;
    /** How many gestures and choices its person has made: what a world budgets (`acts`). */
    acts = 0;
    /** How many requests its session has started, each counted once however often it is sent: what a world budgets (`sends`). */
    requests = 0;
    /** The last commit the record made of a Save of its. */
    private lastCommit: ModelCommit | undefined;
    /** How many commits the record had made once it took this client's last Save: what the client knows of, whatever its source has heard. */
    private wrote = 0;
    /**
     * The most commits the record had made at any revision this client's source has read at. A Save's answer that
     * arrives late names the revision it committed, and the source reads there again though it has read at a newer one
     * since: it reads at fewer then.
     */
    private heardMost = 0;
    /**
     * How often a late answer stepped its screen back, its host unable to say when it read: its source read at a newer
     * revision — a poll heard of another session's write — before its Save's answer came, and the answer put it back at
     * the revision the Save committed, where its rows were then drawn.
     */
    lateAnswer = 0;
    /** The rows of a request that had no answer, was sent again, and was refused — or, read whole, was judged unasked as the page loaded — each with its request's id. */
    private readonly reasked = new Map<string, string>();
    /** The requests sent again after no answer came: lost on its way, its answer lost, or the page gone with it unresolved. */
    private readonly unanswered = new Set<string>();
    /** Those of them a conflict has since asked of: asked again where its choice is taken back, until the drafts are discarded. */
    private readonly asked = new Set<string>();
    /**
     * Which of the record's writes each field of the screen last showed, where it showed the record's own value: the
     * earliest write it may have been. A value the record held more than once is one of several writes.
     */
    private readonly freshest = new Map<string, Map<Field, number>>();
    /** What its screen showed as each request was first sent, by the request's id. */
    private readonly sent = new Map<string, Screen>();
    /** What its screen showed as the Save being prepared was pressed: what its request, sent once prepared, is held to. */
    private shot: Screen | undefined;
    /** For a source read whole: the revision of the collection its session reads at — the last it was handed while no request of its own was unresolved. */
    private based: string | undefined;
    /**
     * Where its host says when it read (`says`): whether its source has read the record since the record last answered
     * a Save of this page's — `"none"` while the page has heard no answer, which a page that reloads has not. What
     * e3's record runtime knows of a record: it marks its reads as each write is answered, and says what the page holds
     * of it — the collection of one read whole, the revision of one read a revision at a time — once a read started
     * since has landed.
     */
    private heard: "none" | "unread" | "read" = "none";
    /**
     * Read a revision at a time: its source was asked to follow the record's state, never to read at the revision a
     * Save's answer named — it had moved since that Save was drafted. The read its host makes since the answer is an
     * operation of its own ({@link ModelClient.awaitsRead}).
     */
    private follows = false;
    /**
     * While an answer arrives in the very turn its source is told of the record's state now
     * ({@link ModelClient.deliverPast}): the revision its session asks installed is installed no more.
     */
    private declines = false;
    /**
     * What its own Saves last wrote of a field that its session has still to read back: the value, and how many commits
     * the record had made by then. Until then the session holds the field as it stood before that Save, and what its
     * person puts the field at is a change from what the Save wrote.
     */
    private readonly unread = new Map<string, Map<Field, { readonly value: Value; readonly at: number }>>();
    /** Every value its person has been shown of each field: on the screen, or on the card of a conflict they chose at. */
    private readonly shownValues = new Map<string, Map<Field, Value[]>>();
    /** Each conflict its person chose the draft at. */
    private chosen: Chosen[] = [];
    /** Its person's steps, as they made them. */
    private steps: Step[] = [];
    private cursor = 0;
    /** How many of its Saves the record has taken. */
    private saves = 0;
    /** Who sent the request on its way, or the last one: its person, or an automatic Save. */
    private sending: "person" | "automatic" = "person";
    /** How many of its done steps a person's Save has taken: an optimiser's result among them waits for one no more. */
    private taken = 0;
    /**
     * How many steps were done as the last change was made, or as a person's Save last took them: the one place an
     * automatic Save sends from. `undefined` where the steps went while they stood away from it.
     */
    private left: number | undefined = 0;
    /** Every draft waits for a person's Save: the steps that held an optimiser's result no Save had taken went. */
    private allWait = false;
    /** An automatic Save that sent what it may not, in words: said at the next check. */
    private misfire: string | undefined;
    private next: bigint;

    /**
     * @param name - Its name, as the record's commits say who made them
     * @param index - Which client it is: its values are its own
     * @param record - The record
     * @param shape - How its session drafts a row
     * @param prepares - Whether its Saves are prepared before they are sent
     * @param inline - Whether its source is read whole: the session's base the whole collection, never a revision
     * @param says - Read whole, whether its host says what its source holds once it has read it since a Save was answered
     */
    constructor(
        readonly name: string, index: number, private readonly record: ModelRecord, private readonly shape: DraftShape,
        private readonly prepares = false, private readonly inline = false, private readonly says = true,
    ) {
        this.next = BigInt(100 * (index + 1));
        this.known = { revision: record.revision, asked: new Set(), landed: new Set() };
        this.screen = { revision: record.revision, rows: record.now };
        this.session = this.open();
    }

    /** The draft type of its session. */
    private get draftType(): EastType { return DRAFT_TYPES[this.shape]; }

    /** A session over the record. */
    private open(): EditSession<undefined> {
        return new EditSession<undefined>({
            sourceId: "rows", entryType: Row, draftType: this.draftType, keyType: StringType, patch: undefined, drawsLanded: !this.inline,
            // The Save installs the revision it committed: the source reads there from then on, its reads still to land.
            // A source read whole installs none: its next collection comes as its host reads it again.
            refresh: this.inline ? undefined : (revision) => {
                if (revision.type === "some" && !this.declines) { this.readAt(revision.value); return; }
                // Asked to follow the record — or asked for a revision in the very turn its source moved on, which the
                // paging layer installs no more: the source reads where it was told the record is, and its host has
                // still to read since the answer.
                if (this.declines) this.readAt(this.record.revision);
                this.follows = true;
            },
            // Where its source reads now, where its host says when it has read since an answer: what an answer's
            // revision is installed over, or not.
            reads: this.inline || !this.says ? undefined : () => some(this.known.revision),
            // A record slice's Save is prepared first (`prepareRecordSliceSave`): called as the request is made, in the
            // press itself, and the request sent once it is done — or never, where it fails.
            prepare: !this.prepares ? undefined : () => new Promise((resolve, reject) => {
                this.shot = this.shoot();
                this.preparing = { done: () => resolve(() => undefined), fail: reject };
            }),
            apply: (bytes) => new Promise<Answer>((resolve, reject) => {
                const batch = decodeBatch(bytes);
                // A request sent again is the same request: what its person saw is what they saw as it first went.
                if (!this.sent.has(batch.requestId)) this.sent.set(batch.requestId, this.shot ?? this.shoot());
                this.shot = undefined;
                this.out = { batch, resolve, reject };
            }),
        });
    }

    /** What its screen shows as a request is made: what the request is held to. */
    private shoot(): Screen {
        this.requests++;
        // An automatic Save — the session's own again after a refusal among them — sends only from where the last change
        // left the steps, and nothing while every draft waits for a person's.
        if (this.sending === "automatic" && (this.allWait || this.left !== this.cursor)) {
            this.misfire = `${this.name}'s automatic Save sent ${this.allWait ? "drafts that wait for a person's Save" : "what Undo or Redo stepped to"}`;
        }
        // Nor is any request made of a record while one of its conflicts waits to be chosen: a person's, or an automatic one.
        if (this.session.unsettled > 0) {
            this.misfire = `${this.name}'s ${this.sending === "automatic" ? "automatic Save" : "Save"} was sent while ${this.session.unsettled} of its conflicts waited to be chosen`;
        }
        return this.sending === "automatic" ? this.screenForAutomatic() : this.shownRows();
    }

    /** The revision its session reads at: its drafts' own, or — read whole — the collection's it was last handed with no request unresolved. */
    private get sessionRevision(): string {
        return this.session.drafts.revision ?? this.based ?? this.known.revision;
    }

    /** The source reads at a revision from now on: nothing read by key there yet. */
    private readAt(revision: string): void {
        if (textEqual(revision, this.known.revision)) return;
        this.known = { revision, asked: new Set(), landed: new Set() };
        this.heardMost = Math.max(this.heardMost, this.record.commitsAt(revision));
    }

    /** A value no other write uses: this client's own. */
    fresh(): bigint { return this.next++; }

    /** A row as a version of the session's. */
    private versionOf(row: RowValue): EntryVersion<undefined> {
        return { draft: liftDraft(this.draftType, row), wire: undefined, place: KEY_ORDER };
    }

    /** A draft's row; `undefined` for one absent. */
    private rowOfDraft(key: string, draft: unknown): RowValue | undefined {
        return draft === undefined ? undefined : normalizeDraft(this.draftType, draft, key).domain as RowValue | undefined;
    }

    /**
     * The version a gesture on a row begins from — the row its person is looking at: the session's own; else what its
     * last Save left of it, while the screen has yet to show that Save; else the screen's.
     */
    private startOf(key: string): EntryVersion<undefined> {
        // The session's own rule (`EditSession.startOf`), given the screen's row: every host asks it so.
        return this.session.startOf(key, () => {
            const shown = this.screen.rows.get(key);
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

    /** Every row its person sees, by its key. */
    shownRows(): Screen { return new Map(KEYS.map((key) => [key, this.shown(key)])); }

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
            // Read whole, its base is the collection itself, and nothing is read by key.
            const base = this.inline ? variant("snapshot", rows) : variant("revision", revision);
            this.session.recheck(undefined, undefined);
            // What it asks for by key at this revision: asked of the source, and handed over where it has landed.
            const reads = new Map<string, option<unknown>>();
            for (const id of this.inline ? [] : this.session.readIdsAt(revision)) {
                if (!this.known.landed.has(id)) { this.known.asked.add(id); continue; }
                const row = rows.get(id);
                reads.set(id, row === undefined ? none : some(row));
            }
            const read = (id: string): option<unknown> | undefined => reads.get(id);
            // What its host says the source holds now, once read since the Save was answered: the collection of one read
            // whole, the revision of one read a revision at a time.
            const holds = this.says && this.heard !== "none" ? { value: this.heard !== "read" ? undefined : this.inline ? rows : revision } : undefined;
            this.session.confirmFailed(undefined);
            this.session.reconcile(base, read, holds);
            this.session.nameConflicts(base, read);
            this.session.observeBase(base);
            this.session.merge(base, read);
            // Read whole, the session reads at the collection it is handed, but while a request of its own is unresolved.
            if (this.inline && !this.session.locked) this.based = revision;
            // The screen, drawn again as the session moves: what a Save landed that its rows now show is let go.
            const drawn = [...this.session.landed].filter(([, landed]) => !readBeforeSave(this.screen.revision, this.known.revision, landed.from)).map(([key]) => key);
            if (drawn.length > 0) this.session.shown(drawn);
            await settled();
            if (this.session.getSnapshot() === before && textEqual(this.known.revision, revision)) return;
        }
        throw new ModelFault(`${this.name}'s session never rests`);
    }

    // ── Its person's acts ────────────────────────────────────────────────────

    /** Whether its person sees a row under a key, and may change it. */
    canEdit(key: string): boolean { return this.session.writable && this.shown(key) !== undefined; }

    /** Whether its person sees no row under a key, and may add one. */
    canAdd(key: string): boolean { return this.session.writable && this.shown(key) === undefined; }

    /** One field of a row changed: one gesture. */
    edit(key: string, field: Field): void {
        const row = this.shown(key);
        if (row === undefined) throw new Error(`${this.name} sees no ${key} to edit`);
        this.gesture(key, { ...row, [field]: this.fresh() }, `Set ${key}.${field}`);
    }

    /** One field of a row changed by a run of the optimiser: its result, landed as one step. */
    optimise(key: string, field: Field): void {
        const row = this.shown(key);
        if (row === undefined) throw new Error(`${this.name} sees no ${key} to optimise`);
        this.gesture(key, { ...row, [field]: this.fresh() }, `Optimise ${key}.${field}`, true);
    }

    /** A row added: one gesture. */
    add(key: string): void { this.gesture(key, { a: this.fresh(), b: this.fresh() }, `Add ${key}`); }

    /** A row removed: one gesture. */
    remove(key: string): void { this.gesture(key, undefined, `Remove ${key}`); }

    /** What both sides of a row's conflict began from, while one waits: the row, or none of it — `undefined` where no conflict of the row waits. */
    private beganAt(key: string): { readonly row: RowValue | undefined } | undefined {
        const entry = this.session.conflicts.get(key);
        if (entry === undefined) return undefined;
        return { row: entry.was.type === "some" ? this.rowOfDraft(key, entry.was.value) : undefined };
    }

    /**
     * Whether a field of a row its person sees is in a conflict that waits — its own, or its row's — and stands
     * otherwise than both sides began it: what {@link ModelClient.revert} takes back.
     */
    canRevert(key: string, field: Field): boolean {
        const row = this.shown(key);
        const began = this.beganAt(key)?.row;
        if (!this.session.writable || row === undefined || began === undefined) return false;
        return this.fieldsAt(this.session.conflicts.get(key)!.points).includes(field) && !sameValue(row[field], began[field]);
    }

    /** A field typed back to what both sides began from, while its conflict waits: one gesture, and no choice made. */
    revert(key: string, field: Field): void {
        const row = this.shown(key);
        const began = this.beganAt(key)?.row;
        if (row === undefined || began === undefined) throw new Error(`${this.name} has no change at ${key}.${field} to take back`);
        this.gesture(key, { ...row, [field]: began[field] }, `Take back ${key}.${field}`);
    }

    /** Whether its person removed a row another session changed, the conflict waiting: what {@link ModelClient.restore} puts back. */
    canRestore(key: string): boolean {
        return this.session.writable && this.shown(key) === undefined && this.beganAt(key)?.row !== undefined;
    }

    /** A removed row put back as both sides began it, while its conflict waits: one gesture, and no choice made. */
    restore(key: string): void {
        const began = this.beganAt(key)?.row;
        if (began === undefined) throw new Error(`${this.name} has no removal of ${key} to take back`);
        this.gesture(key, began, `Put back ${key}`);
    }

    /**
     * A row as a gesture leaves it on its person's screen. A gesture that puts a row back, at a conflict that waits,
     * to what both sides began from — a field typed back, a new row removed again, a removed one put back as it was —
     * leaves its person no change there, and makes no choice: the other side's value stands there, as it would once
     * the drafts were next carried over. Left as the gesture had it, the next Save wrote it over the other side's.
     */
    private leftAs(key: string, next: RowValue | undefined): RowValue | undefined {
        const entry = this.session.conflicts.get(key);
        const conflict = this.beganAt(key);
        if (entry === undefined || conflict === undefined) return next;
        const began = conflict.row;
        const theirs = entry.source.type === "some" ? this.rowOfDraft(key, entry.source.value) : undefined;
        // Whether two rows are the same: neither there, or both, with every field the same.
        const same = (a: RowValue | undefined, b: RowValue | undefined): boolean =>
            (a === undefined || b === undefined ? a === undefined && b === undefined : FIELDS.every((field) => sameValue(a[field], b[field])));
        // A conflict of the row itself — one side removed it, or both added it — reads no more once the row is as both began it.
        if (entry.points.some((point) => conflictFieldOf(point) === undefined)) return same(next, began) ? theirs : next;
        // Each field in conflict that is put back at what both began from takes the other side's.
        if (next === undefined || theirs === undefined || began === undefined) return next;
        const row = { ...next };
        for (const field of this.fieldsAt(entry.points)) if (sameValue(next[field], began[field])) row[field] = theirs[field];
        return row;
    }

    /** A gesture that leaves a row as given, from the row its person sees. */
    private gesture(key: string, next: RowValue | undefined, label: string, optimise = false): void {
        const start = this.startOf(key);
        const was = this.rowOfDraft(key, start.draft);
        const before = this.shownRows();
        // What their screen shows of the row once the gesture is made, and how many conflicts waited as it was.
        const shows = this.leftAs(key, next);
        const waited = this.session.unsettled;
        // Nothing drafted any more of what waited for a person's Save: this change waits for none.
        if (this.allWait && this.session.pending === 0) this.allWait = false;
        const took = this.session.record([{ id: key, before: start, after: next === undefined ? ABSENT : this.versionOf(next) }], optimise ? "optimise" : "typed", label);
        if (!took) throw new ModelFault(`${this.name}'s gesture was not taken: ${label}`);
        this.acts++;
        const shifts = FIELDS.filter((field) => !sameValue(was?.[field], shows?.[field])).map((field): Shift => ({ key, field, before: was?.[field], after: shows?.[field] }));
        // Every field the gesture named, and every one its screen moved.
        const at = FIELDS.filter((field) => !sameValue(was?.[field], next?.[field]) || !sameValue(was?.[field], shows?.[field])).map((field) => [key, field] as const);
        const claimsBefore = this.claimsAt(at);
        this.acted(shifts, before, label);
        // Put back where its conflict waited, a field is no change of theirs any more: the other side's stands there.
        for (const field of FIELDS) if (!sameValue(shows?.[field], next?.[field])) this.claims.get(key)?.delete(field);
        // A gesture that left a conflict made no choice of the draft: a step over which no automatic Save sends, as over a choice.
        const left = this.session.unsettled < waited;
        this.push({ kind: "edit", optimise, left: 0, shifts, chosen: [], saves: this.saves, unresolved: this.session.locked, moved: left, claims: { at, before: claimsBefore, after: this.claimsAt(at) } });
    }

    /** Undo: the last step taken back. */
    undo(): void {
        const step = this.steps[this.cursor - 1];
        if (step === undefined) throw new Error(`${this.name} has no step to undo`);
        const before = this.shownRows();
        this.session.undo();
        this.cursor--;
        this.acted(step.shifts.map((shift): Shift => ({ ...shift, before: shift.after, after: shift.before })), before, "Undo");
        // A step no Save of theirs has taken, taken back: what it made theirs is as it stood before it.
        if (step.saves === this.saves) this.putClaims(step.claims.at, step.claims.before);
        if (step.kind !== "settle") return;
        this.chosen = this.chosen.filter((choice) => !step.chosen.includes(choice));
        // As many wait again as waited when it was made: each it settled — none, where it only settled one the other way.
        if (step.saves === this.saves && !step.unresolved && this.session.unsettled < (step.waited ?? step.left + 1)) {
            throw new ModelFault(`${this.name}'s Undo of a conflict's choice did not bring the conflict back`);
        }
    }

    /** Redo: the next step replayed. */
    redo(): void {
        const step = this.steps[this.cursor];
        if (step === undefined) throw new Error(`${this.name} has no step to redo`);
        const before = this.shownRows();
        this.session.redo();
        this.cursor++;
        this.acted(step.shifts, before, "Redo");
        if (step.saves === this.saves) this.putClaims(step.claims.at, step.claims.after);
        if (step.kind !== "settle") return;
        this.chosen.push(...step.chosen);
        if (step.saves === this.saves && !step.unresolved && this.session.unsettled !== step.left) {
            throw new ModelFault(`${this.name}'s Redo of a conflict's choice left ${this.session.unsettled} to choose, where the choice left ${step.left}`);
        }
    }

    /** Discard: every draft dropped, by its person's own choice. */
    discard(): void {
        this.session.discard();
        this.taken = 0;
        this.left = 0;
        this.allWait = false;
        // Every draft, and every choice made over one: a conflict met again is a new one to choose.
        this.claims.clear();
        this.unread.clear();
        this.reasked.clear();
        this.asked.clear();
        this.chosen = [];
        this.freshest.clear();
        this.steps = [];
        this.cursor = 0;
        if (this.session.pending !== 0 || this.session.unsettled !== 0) throw new ModelFault(`${this.name}'s Discard left ${this.session.pending} pending and ${this.session.unsettled} conflicts`);
    }

    /**
     * A conflict chosen one way: every open one, as one step — or, `one` given, the first open conflict of the first
     * row that has one, alone.
     */
    settle(choice: ConflictChoice, one = false): void {
        const before = this.shownRows();
        const base = this.sessionRevision;
        const shifts: Shift[] = [];
        const chosen: Chosen[] = [];
        const open = [...this.session.conflicts].slice(0, one ? 1 : undefined).map(([key, entry]) => [key, entry, one ? entry.points.slice(0, 1) : entry.points] as const);
        const theirs = new Map<string, { row: RowValue | undefined; fields: Field[] }>();
        for (const [key, entry, points] of open) {
            const row = entry.source.type === "some" ? this.rowOfDraft(key, entry.source.value) : undefined;
            const mine = before.get(key);
            const fields = this.fieldsAt(points);
            theirs.set(key, { row, fields });
            if (choice === "draft") chosen.push(...this.partsAt(key, points, base));
            else for (const field of fields) if (!sameValue(mine?.[field], row?.[field])) shifts.push({ key, field, before: mine?.[field], after: row?.[field] });
        }
        // Every conflict one way is those chosen the other way too: the other side taken where the draft was kept, and
        // the draft put back as it stood before its choice where the other side was taken.
        const unchosen: Chosen[] = [];
        for (const flip of one ? [] : this.session.settled.filter((settled) => settled.choice !== choice)) {
            const key = flip.id;
            const fields = this.fieldsAt([flip.point]);
            const row = flip.source.type === "some" ? this.rowOfDraft(key, flip.source.value) : undefined;
            const to = choice === "source" ? row : flip.draft.type === "some" ? this.rowOfDraft(key, flip.draft.value) : undefined;
            const mine = before.get(key);
            // The draft put back only while it holds the other side there, as its choice left it: changed since by a
            // gesture, it is its person's as it stands.
            if (choice === "draft" && !fields.every((field) => sameValue(mine?.[field], row?.[field]))) continue;
            // And the other side taken at a part of a row only while the row is there: removed since, it stays removed.
            if (choice === "source" && mine === undefined && flip.point.at.length > 0) continue;
            for (const field of fields) if (!sameValue(mine?.[field], to?.[field])) shifts.push({ key, field, before: mine?.[field], after: to?.[field] });
            if (choice === "draft") chosen.push(...this.partsAt(key, [flip.point], base));
            else unchosen.push(...this.partsAt(key, [flip.point], base));
            const held = theirs.get(key);
            theirs.set(key, { row, fields: [...new Set([...(held?.fields ?? []), ...fields])] });
        }
        const unresolved = this.session.locked;
        const at = [...theirs].flatMap(([key, { fields }]) => fields.map((field) => [key, field] as const));
        const claimsBefore = this.claimsAt(at);
        const unsettled = this.session.unsettled;
        const took = one ? this.session.settle(open[0]![0], open[0]![2][0]!.path, choice) : this.session.settleAll(choice);
        if (!took) throw new ModelFault(`${this.name}'s choice was not taken`);
        this.acts++;
        if (one ? this.session.unsettled >= unsettled : this.session.unsettled !== 0) {
            throw new ModelFault(`${this.name} chose ${one ? "a conflict" : "every conflict"}, and ${this.session.unsettled} of ${unsettled} are left to choose`);
        }
        this.acted(shifts, before, `Choose ${choice}`);
        for (const [key, { row, fields }] of theirs) {
            for (const field of fields) {
                // Chosen at: the conflict's card showed its person both sides.
                this.show(key, field, row?.[field]);
                // The other side taken: no change of theirs there. Their own kept: a change from the other side's value —
                // or from what their own Save wrote there, where the session has still to read that Save back.
                const wrote = this.unread.get(key)?.get(field);
                if (wrote !== undefined) this.claim(key, field, this.shown(key)?.[field], wrote.value);
                else if (choice === "source") this.claims.get(key)?.delete(field);
                else this.claim(key, field, this.shown(key)?.[field], row?.[field]);
            }
        }
        this.chosen = this.chosen.filter((choice) => !unchosen.some((part) => textEqual(part.key, choice.key) && sameField(part.field, choice.field)));
        this.chosen.push(...chosen);
        this.push({ kind: "settle", optimise: false, left: this.session.unsettled, waited: unsettled, shifts, chosen, saves: this.saves, unresolved, claims: { at, before: claimsBefore, after: this.claimsAt(at) } });
    }

    /**
     * Whether a conflict settled before may be settled the other way now, with none left to choose: the draft put back
     * only while it holds the other side there, as its choice left it — changed since by a gesture, it is its person's
     * as it stands — and the other side taken at a part of a row only while the row is there.
     *
     * @param choice - Which side would stand
     * @returns Whether some settled conflict takes it
     */
    canFlip(choice: ConflictChoice): boolean {
        if (!this.session.writable || this.session.carrying || this.session.unsettled > 0) return false;
        const rows = this.shownRows();
        return this.session.settled.some((flip) => {
            if (flip.choice === choice) return false;
            const mine = rows.get(flip.id);
            if (choice === "source") return !(mine === undefined && flip.point.at.length > 0);
            const theirs = flip.source.type === "some" ? this.rowOfDraft(flip.id, flip.source.value) : undefined;
            return this.fieldsAt([flip.point]).every((field) => sameValue(mine?.[field], theirs?.[field]));
        });
    }

    /** A step made: what Redo could replay goes, with what a person's Save had taken of it, and the steps stand where it leaves them. */
    private push(step: Step): void {
        if (this.taken > this.cursor) this.taken = this.cursor;
        this.steps.splice(this.cursor);
        this.steps.push(step);
        this.cursor = this.steps.length;
        this.left = this.cursor;
    }

    /**
     * The screen as an automatic Save may send it: as it stands — or, where a done step is an optimiser's result no
     * person's Save has taken, as it stood before the first such step.
     */
    private screenForAutomatic(): Screen {
        const rows = new Map<string, { [F in Field]: Value }>(KEYS.map((key) => { const row = this.shown(key); return [key, { a: row?.a, b: row?.b }]; }));
        const stop = this.steps.findIndex((step, i) => i >= this.taken && i < this.cursor && step.optimise);
        for (let i = this.cursor - 1; stop >= 0 && i >= stop; i--) {
            for (const shift of this.steps[i]!.shifts) rows.get(shift.key)![shift.field] = shift.before;
        }
        return new Map([...rows].map(([key, { a, b }]) => [key, a === undefined || b === undefined ? undefined : { a, b }]));
    }

    /** The fields some conflicts of a row are in: a conflict of the row itself is one of its every field. */
    private fieldsAt(points: Iterable<Parameters<typeof conflictFieldOf>[0]>): Field[] {
        const fields = new Set<Field>();
        for (const point of points) {
            const at = conflictFieldOf(point);
            for (const field of FIELDS) if (at === undefined || textEqual(at, field)) fields.add(field);
        }
        return [...fields];
    }

    /** Some conflicts of a row, each as what a choice of the draft settles: its field — none for the row itself — and the write it stands against. */
    private partsAt(key: string, points: Iterable<Parameters<typeof conflictFieldOf>[0]>, base: string): Chosen[] {
        const parts: Chosen[] = [];
        for (const point of points) {
            const at = conflictFieldOf(point);
            const field = at === undefined ? undefined : FIELDS.find((name) => textEqual(at, name));
            if (!parts.some((part) => sameField(part.field, field))) parts.push({ key, field, stamp: this.record.stampOf(key, field, base) });
        }
        return parts;
    }

    /**
     * An act did what it says: each field it names shows what the act put it at, and no other field of the screen moved.
     * What it put a field at is its person's change until a Save of theirs writes it — unless it puts the field at what
     * the source holds there, as the session knows it, or back at what it stood at before they changed it.
     */
    private acted(shifts: readonly Shift[], before: Screen, label: string): void {
        const after = this.shownRows();
        for (const key of KEYS) {
            for (const field of FIELDS) {
                const shift = shifts.find((s) => textEqual(s.key, key) && textEqual(s.field, field));
                const [was, is] = [before.get(key)?.[field], after.get(key)?.[field]];
                if (shift !== undefined && !sameValue(is, shift.after)) {
                    throw new ModelFault(`${this.name}'s ${label} put ${key}.${field} at ${say(shift.after)}, and its screen shows ${say(is)}`);
                }
                if (shift === undefined && !sameValue(was, is)) {
                    throw new ModelFault(`${this.name}'s ${label} moved ${key}.${field} from ${say(was)} to ${say(is)}, which it never named`);
                }
            }
        }
        for (const shift of shifts) {
            const wrote = this.unread.get(shift.key)?.get(shift.field);
            const held = this.claims.get(shift.key)?.get(shift.field);
            // A change from what their own Save wrote, where the session has still to read that Save back.
            if (wrote !== undefined) this.claim(shift.key, shift.field, shift.after, wrote.value);
            // While the row's conflict waits, a change from what the field stood at before they changed it: what both
            // sides began from.
            else if (this.session.conflicts.has(shift.key)) this.claim(shift.key, shift.field, shift.after, held === undefined ? shift.before : held.from);
            // Else a change from what the source holds there, as the session knows it — or none, put at that.
            else this.claim(shift.key, shift.field, shift.after, this.rowOfDraft(shift.key, this.session.originals.get(shift.key)?.draft)?.[shift.field]);
            // What the act put there is its person's own doing: no value the screen went back to.
            this.freshest.get(shift.key)?.delete(shift.field);
        }
    }


    /** The changes of its person's at some fields, by `key.field`: none where the field is no change of theirs. */
    private claimsAt(at: readonly (readonly [string, Field])[]): Map<string, Claim | undefined> {
        return new Map(at.map(([key, field]) => [`${key}.${field}`, this.claims.get(key)?.get(field)] as const));
    }

    /** Some changes, put as a step found or left them. */
    private putClaims(at: readonly (readonly [string, Field])[], claims: ReadonlyMap<string, Claim | undefined>): void {
        for (const [key, field] of at) {
            const claim = claims.get(`${key}.${field}`);
            if (claim === undefined) this.claims.get(key)?.delete(field);
            else this.claim(key, field, claim.value, claim.from);
        }
    }

    /** A field its person put at a value, from what it stood at: their change to save — or none, put back there. */
    private claim(key: string, field: Field, value: Value, from: Value): void {
        let fields = this.claims.get(key);
        if (fields === undefined) { fields = new Map(); this.claims.set(key, fields); }
        if (sameValue(value, from)) fields.delete(field);
        else fields.set(field, { value, from });
    }

    /**
     * Its person's steps, held to the session's: where the session's went — the source moved under them — the person's
     * go too, and it is counted.
     *
     * @throws {ModelFault} Where the session holds steps that are not its person's
     */
    syncSteps(): void {
        const { undo, redo } = this.session.depth;
        if (undo === this.cursor && redo === this.steps.length - this.cursor) return;
        if (undo !== 0 || redo !== 0) throw new ModelFault(`${this.name}'s session holds ${undo} steps to undo and ${redo} to redo, and its person made ${this.cursor} and ${this.steps.length - this.cursor}`);
        this.stepsLost++;
        // An optimiser's result no person's Save had taken goes on waiting, with every draft left: the steps that told it
        // apart went. And so does what Undo or Redo had left, away from where the last change did.
        const waited = this.allWait || this.steps.some((step, i) => i >= this.taken && i < this.cursor && step.optimise);
        const held = this.session.entries.size > 0;
        this.allWait = waited && held;
        this.left = this.left !== this.cursor && held ? undefined : 0;
        this.taken = 0;
        this.steps = [];
        this.cursor = 0;
    }

    /**
     * The page reloaded: its drafts kept as the tab keeps them (`keep.ts`: each one's draft and what both began from,
     * beast2 at the draft's type; whether an optimiser's result among them waited, and whether they stood where Undo or
     * Redo left them) and restored into a session made anew, over a page that reads the record as it now is. A request
     * on its way is no one's to hear any more. The history is not kept.
     */
    reload(): void {
        const type = toEastTypeValue(this.draftType);
        const [encode, decode] = [encodeBeast2For(type) as (value: unknown) => Uint8Array, decodeBeast2For(type) as (bytes: Uint8Array) => unknown];
        const again = (value: option<unknown>): option<unknown> => (value.type === "some" ? some(decode(encode(value.value))) : none);
        const entries = this.session.keptEntries.map((entry) => ({ ...entry, was: again(entry.was), draft: again(entry.draft) }));
        const held = entries.length > 0 && this.session.autosaveHeld;
        const stepped = entries.length > 0 && this.session.autosaveStepped;
        // A Save whose outcome the session does not know — on its way, or its answer lost — is kept with the drafts, and
        // sent again by the page as it loads: what was drafted since it was sent stands as it did, a row put back as its
        // edit began among them, and what it saved is no draft the record's next change could ask of.
        const request = this.session.keptRequest;
        const version = <T extends { readonly draft: unknown }>(held: T): T => (held.draft === undefined ? held : { ...held, draft: decode(encode(held.draft)) });
        // Made and not yet sent — its preparation still running as the page went: what its person saw as it was made is
        // what it is held to once the page sends it.
        if (request !== undefined) {
            const id = decodeBatch(request.payload).requestId;
            if (this.shot !== undefined && !this.sent.has(id)) this.sent.set(id, this.shot);
            this.unanswered.add(id);
            // Read whole, the request is not sent again: the page judges each of its rows by the collection it has read
            // afresh, and may ask of one another session has written ({@link ModelClient.unansweredAsked}).
            if (this.inline) for (const target of request.targets) this.reasked.set(target.id, id);
        }
        this.out = undefined;
        this.preparing = undefined;
        this.shot = undefined;
        this.based = undefined;
        // The page that loads has heard no answer: its host says nothing of when it read, until a Save of its is answered.
        this.heard = "none";
        this.follows = false;
        this.session = this.open();
        this.session.restore(entries, held, stepped);
        if (request !== undefined) {
            this.session.restoreRequest({
                ...request, payload: request.payload.slice(), minted: new Map(request.minted),
                targets: request.targets.map((target) => ({ id: target.id, before: version(target.before), after: version(target.after) })),
            });
        }
        this.known = { revision: this.record.revision, asked: new Set(), landed: new Set() };
        this.heardMost = Math.max(this.heardMost, this.record.commits.length);
        this.screen = { revision: this.record.revision, rows: this.record.now };
        this.steps = [];
        this.cursor = 0;
        this.taken = 0;
        this.allWait = held;
        this.left = stepped ? undefined : 0;
        // What its Saves wrote, the page reads with the record — but what a Save it holds unresolved wrote, the record
        // having taken it: the page puts that request back as it stood, its rows still to be read back, and what its
        // person puts such a field at is a change from what the Save wrote there. A choice made is made again where its
        // conflict reads again.
        // (Told by the commit that wrote each: whatever another session has written there since, the session holds that
        // write as its request's still.)
        const kept = request === undefined ? undefined : decodeBatch(request.payload).requestId;
        const keptAt = kept === undefined ? 0 : this.record.commits.findIndex((commit) => commit.requestId !== undefined && textEqual(commit.requestId, kept)) + 1;
        for (const fields of this.unread.values()) {
            for (const [field, wrote] of [...fields]) if (keptAt === 0 || wrote.at !== keptAt) fields.delete(field);
        }
        this.chosen = [];
    }

    // ── Its request, and what the record does with it ────────────────────────

    /** Save, as its person presses it: it takes every step done so far, and where the steps stand as theirs. */
    async save(): Promise<void> {
        this.sending = "person";
        this.taken = this.cursor;
        this.left = this.cursor;
        this.allWait = false;
        void this.session.apply();
        await settled();
    }

    /** An automatic Save, as its pause runs out: it sends what one may, and takes nothing. */
    async autosave(): Promise<void> {
        this.sending = "automatic";
        // Sent as the drafts stood before steps a person's Save had taken — after an Undo — it holds those no more.
        if (this.taken > this.cursor) this.taken = this.cursor;
        void this.session.autosave();
        await settled();
    }

    /**
     * The Save's preparation ends: done, its request is sent; failed, nothing is sent and every draft is kept.
     *
     * @param done - Whether it is done; failed, otherwise
     */
    async prepared(done: boolean): Promise<void> {
        const preparing = this.preparing;
        if (preparing === undefined) return;
        this.preparing = undefined;
        if (done) preparing.done();
        else { this.shot = undefined; preparing.fail(new Error("Not prepared")); }
        await settled();
        if (!done && (this.out !== undefined || this.session.locked || this.session.status !== "idle")) {
            throw new ModelFault(`${this.name}'s Save could not be prepared, and its session is ${this.session.status}${this.out === undefined ? "" : ", its request sent"}`);
        }
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
     */
    async deliver(answered: boolean): Promise<void> {
        if (this.out !== undefined && this.out.answer === undefined) this.land();
        const out = this.out;
        if (out === undefined || out.answer === undefined) return;
        this.out = undefined;
        const answer = out.answer;
        // Answered as applied — a request the record remembers, answered again, among them: its host has yet to read
        // the record since.
        if (answered && answer.type === "applied" && this.says) this.heard = "unread";
        if (answered) out.resolve(answer);
        else { this.unanswered.add(out.batch.requestId); out.reject(new Error("No answer")); }
        await settled();
    }

    /**
     * The request's answer comes back in the very turn its source is told of the record's state now — a read pinned
     * where the request was drafted, refused, names it. The revision the session then asks its source for is installed
     * no more: its paging layer installs one only while the source still reads where it read as it was asked, and
     * follows the record otherwise (e3's does: `PagedRuntime`'s `refresh`). The session is not told.
     */
    async deliverPast(): Promise<void> {
        this.declines = true;
        try { await this.deliver(true); } finally { this.declines = false; }
    }

    /**
     * Whether its request's answer is on its way back, applied, and the record has been written again since: an answer
     * whose revision its source may be moved past in the very turn it arrives ({@link ModelClient.deliverPast}).
     */
    get passed(): boolean {
        const answer = this.out?.answer;
        return !this.inline && this.says && answer !== undefined && answer.type === "applied" && answer.value.revision.type === "some"
            && !textEqual(answer.value.revision.value, this.record.revision);
    }

    /**
     * The request reaches the record, which takes or refuses it; its answer is still on its way back. What the record
     * holds from here is what the answer names, whenever it arrives — after another session's write, and after the
     * page has heard of that write, among them.
     */
    land(): void {
        const out = this.out;
        if (out === undefined || out.answer !== undefined) return;
        const before = this.record.commits.length;
        const answer = this.record.commit(out.batch, this.name);
        if (this.record.commits.length > before) this.committed(out.batch);
        else if (answer.type === "conflict") this.refused(out.batch);
        this.out = { ...out, answer };
    }

    /** Whether its request is on its way and the record has not heard it yet. */
    get unheard(): boolean { return this.out !== undefined && this.out.answer === undefined; }

    /** The request is lost before the record hears of it. */
    async lose(): Promise<void> {
        const out = this.out;
        if (out === undefined || out.answer !== undefined) return;
        this.out = undefined;
        this.unanswered.add(out.batch.requestId);
        out.reject(new Error("No answer"));
        await settled();
    }

    /**
     * The record took the client's batch. Each field it changed is set to what its person's screen showed as the
     * request was sent, from a value they had been shown; and what they put the field at is written — unless they have
     * changed it again since, which is theirs still.
     */
    private committed(batch: BatchValue): void {
        this.saves++;
        const commit = this.record.commits[this.record.commits.length - 1]!;
        this.lastCommit = commit;
        this.wrote = this.record.commits.length;
        const sent = this.sent.get(batch.requestId);
        for (const { key, field, before, after } of commit.changed) {
            const meant = sent?.get(key)?.[field];
            if (!sameValue(meant, after)) {
                throw new ModelFault(`${this.name}'s Save set ${key}.${field} to ${say(after)}, and its screen showed ${say(meant)} as it was sent`);
            }
            if (!this.wasShown(key, field, before)) {
                throw new ModelFault(`${this.name}'s Save overwrote ${key}.${field}: the record held ${say(before)}, which its person was never shown`);
            }
            // Written: no change of theirs any more — but where they have changed it again since, from what the Save wrote.
            this.claim(key, field, this.shown(key)?.[field], after);
            if (this.claims.get(key)?.has(field) !== true) this.showsWrite(key, field, this.record.commits.length);
            let wrote = this.unread.get(key);
            if (wrote === undefined) { wrote = new Map(); this.unread.set(key, wrote); }
            wrote.set(field, { value: after, at: this.record.commits.length });
        }
    }

    /**
     * The record refused the client's batch: never over a change the client itself wrote there last — but for the
     * same request, sent again after no answer came, where the record has forgotten it. A record answers a request
     * again only while it remembers it, as e3 does: one it has forgotten is checked afresh, and refused over what
     * its own first sending wrote. The session cannot have known, and judges each row by what the record holds of it.
     */
    private refused(batch: BatchValue): void {
        for (const { key, field } of this.record.mismatched(batch)) {
            // Nor for a Save built before the session could know its own earlier one had landed: that one's answer never
            // came, and until the page reads the record on, its rows stand as they did before it.
            const wrote = this.record.requestOf(key, field);
            if (this.record.writerOf(key, field) === this.name && wrote !== batch.requestId && !(wrote !== undefined && this.unanswered.has(wrote))) {
                throw new ModelFault(`The record refused ${this.name}'s Save over ${key}.${field}, which ${this.name}'s own Save wrote last`);
            }
        }
        // Sent again after no answer: the session cannot tell whether its first sending landed, and may ask of each
        // row of it another session has written ({@link ModelClient.unansweredAsked}).
        if (this.unanswered.has(batch.requestId)) for (const change of batch.changes) this.reasked.set(change.id, batch.requestId);
    }

    // ── What it learns of the record ─────────────────────────────────────────

    /** Its source hears of the record's revision now — and, read whole, its screen draws the collection it then holds. */
    see(): void {
        this.readAt(this.record.revision);
        if (this.heard === "unread") this.heard = "read";
        this.follows = false;
        if (this.inline) this.redraw();
    }

    /**
     * Whether its source is still to read the record since a Save of its was answered, and the session waits on that
     * read: a read its host makes whatever the record's revision — a request answered again leaves it where it was. A
     * source read a revision at a time waits on it only where it was asked to follow the record's state; put at the
     * revision the answer named, it has read there.
     */
    get awaitsRead(): boolean { return this.heard === "unread" && (this.inline || this.follows); }

    /** Whether rows the session asked for by key are still to land. */
    get reading(): boolean { return [...this.known.asked].some((id) => !this.known.landed.has(id)); }

    /** The rows the session asked for by key land — or, `one` given, the first of them alone. */
    read(one = false): void {
        for (const id of [...this.known.asked].sort()) {
            if (this.known.landed.has(id)) continue;
            this.known.landed.add(id);
            if (one) return;
        }
    }

    /** How many rows the session asked for by key are still to land. */
    get readsOut(): number { return [...this.known.asked].filter((id) => !this.known.landed.has(id)).length; }

    /** The screen's rows are read again, at the revision its source reads at. */
    redraw(): void { this.screen = { revision: this.known.revision, rows: this.record.at(this.known.revision) }; }

    // ── What must hold of it ─────────────────────────────────────────────────

    private wasShown(key: string, field: Field, value: Value): boolean {
        return this.shownValues.get(key)?.get(field)?.some((shown) => sameValue(shown, value)) === true;
    }

    private show(key: string, field: Field, value: Value): void {
        let fields = this.shownValues.get(key);
        if (fields === undefined) { fields = new Map(); this.shownValues.set(key, fields); }
        const values = fields.get(field);
        if (values === undefined) fields.set(field, [value]);
        else if (!values.some((shown) => sameValue(shown, value))) values.push(value);
    }

    /**
     * What its person is shown now, noted: each row of the screen, and each conflict's other side. And what must hold of
     * it: a conflict chosen for the draft is not asked again, and what its person put a field at is on their screen still.
     *
     * @throws {ModelFault} What failed
     */
    observe(): void {
        if (this.misfire !== undefined) throw new ModelFault(this.misfire);
        const base = this.sessionRevision;
        const rows = this.shownRows();
        for (const [key, row] of rows) for (const field of FIELDS) this.show(key, field, row?.[field]);
        // (A conflict that waits shows its person nothing by itself: the builder rings the row, and the other side's value
        // is on the conflict's card, which they see as they choose at it.)
        for (const [key, entry] of this.session.conflicts) {
            for (const part of this.partsAt(key, entry.points, base)) {
                // Asked only of a change still to save: in the conflict's field, or — for one of the row itself — in the row.
                // (A choice undone while the Save that took it is unresolved reads until that Save is read back.)
                if (!this.session.locked && !FIELDS.some((field) => (part.field === undefined || textEqual(part.field, field)) && this.claims.get(key)?.has(field) === true)) {
                    // A row of a request with no answer, sent again and refused: counted, once — and never of a request
                    // the record took and remembers, which it answers when asked again. (Read whole, a page that
                    // reloads judges such a request unasked: counted there.)
                    const reasked = this.reasked.get(key);
                    if (reasked !== undefined) {
                        this.reasked.delete(key);
                        if (!this.inline && this.record.remembersRequest(reasked)) {
                            throw new ModelFault(`${this.name} is asked to choose at ${key}${part.field === undefined ? "" : `.${part.field}`}, where its person has no change to save, over a request the record took and remembers`);
                        }
                        this.unansweredAsked++;
                        this.asked.add(key);
                    }
                    if (this.asked.has(key)) continue;
                    throw new ModelFault(`${this.name} is asked to choose at ${key}${part.field === undefined ? "" : `.${part.field}`}, where its person has no change to save`);
                }
                if (this.chosen.some((choice) => textEqual(choice.key, key) && sameField(choice.field, part.field) && textEqual(choice.stamp, part.stamp))) {
                    throw new ModelFault(`${this.name} chose its own change of ${key}${part.field === undefined ? "" : `.${part.field}`} over the write at ${part.stamp}, and is asked again`);
                }
            }
        }
        // The newest of the record's writes a value its person is shown can be: one its source has read at, or its own
        // Save's — never another session's past where its source has read. (Counted in with its own Saves, another
        // session's later write that happens to leave a field as the page first showed it — a row added and removed
        // again while the page still shows none — read as the write the page showed, and the row's first reading as a
        // step back from it.)
        const heard = this.heardMost;
        const saved = { by: this.name, until: this.wrote };
        // Whether its source reads at a revision older than one it had read at — a late answer's doing — and the screen's
        // rows were drawn there.
        const steppedBack = this.record.commitsAt(this.known.revision) < this.heardMost && textEqual(this.screen.revision, this.known.revision);
        // What its own Saves wrote that the session has read back is the session's to hold now.
        const commits = this.record.commitsAt(base);
        for (const fields of this.unread.values()) for (const [field, wrote] of fields) if (commits >= wrote.at) fields.delete(field);
        for (const [key, fields] of this.claims) {
            const own = this.session.entries.get(key);
            const was = this.session.originals.get(key);
            for (const [field, { value }] of fields) {
                // Theirs while the session holds the row so: on their screen, and its to save. Held as the row began, with
                // no request unresolved, it is no change the session has left to save: the record's, at the session's
                // base — a row removed, saved so, then put back and removed again — or it is lost. But while the session
                // carries its drafts over, what a row began from is still to be judged where the record is: what it was
                // carried from — the row at the revision before, or what a page that reloaded kept it beside — says
                // nothing yet of what the record holds, so a value held is its person's still.
                if (own !== undefined && sameValue(this.rowOfDraft(key, own.draft)?.[field], value)
                    && (this.session.locked || this.session.carrying || was === undefined || !sameValue(this.rowOfDraft(key, was.draft)?.[field], value))) continue;
                // Let go of: the record's, by another's write — theirs no more to save — or it is lost.
                const held = this.record.at(base).get(key)?.[field];
                if (!sameValue(held, value)) {
                    throw new ModelFault(`${this.name}'s person put ${key}.${field} at ${say(value)}; its session holds ${own === undefined ? "no draft of the row" : say(this.rowOfDraft(key, own.draft)?.[field])}, and the record at ${base} holds ${say(held)}`);
                }
                fields.delete(field);
                // The record's value now, as their screen showed it: the write that put it there.
                this.showsWrite(key, field, this.record.writtenBetween(key, field, value, heard, saved)?.first);
            }
        }
        // What the record held there, as the screen shows it: never a write older than the one it last showed. A row the
        // session holds no version of is the screen's own, read at the screen's revision: the write that last changed the
        // field by then, exactly. One the session holds — as its edit began, as a Save landed it, as it was carried
        // over — is one of the writes that put the field at that value, among those its source has read or its own
        // Saves made: went back only where the latest of them is older than the earliest the screen last showed.
        for (const [key, row] of rows) {
            for (const field of FIELDS) {
                if (this.claims.get(key)?.has(field) === true) continue;
                const exact = this.session.entries.has(key) || this.session.landed.has(key) ? undefined
                    : this.record.commitsAt(this.record.stampOf(key, field, this.screen.revision));
                const between = exact !== undefined ? { first: exact, last: exact } : this.record.writtenBetween(key, field, row?.[field], heard, saved);
                if (between === undefined) continue;
                const written = between.last;
                const last = this.freshest.get(key)?.get(field);
                if (last !== undefined && written < last) {
                    // Counted, where a late answer stepped the source back and its rows were drawn there, its host
                    // unable to say when it read: one that says never has an answer's revision installed over a newer one.
                    if (steppedBack && !this.says) this.lateAnswer++;
                    // And where its host cannot say when its collection was read: its session took one read before its
                    // Save landed for one read after — what a host that says never lets it do.
                    else if (this.inline && !this.says) this.readEarly++;
                    else throw new ModelFault(`${this.name}'s screen went back: ${key}.${field} shows ${say(row?.[field])}, which the record held before the value the screen last showed there`);
                }
                this.showsWrite(key, field, between.first);
            }
        }
    }

    /** Which of the record's writes a field of the screen shows now. */
    private showsWrite(key: string, field: Field, written: number | undefined): void {
        if (written === undefined) return;
        let fields = this.freshest.get(key);
        if (fields === undefined) { fields = new Map(); this.freshest.set(key, fields); }
        fields.set(field, written);
    }

    /**
     * Whether an automatic Save has a change it may send now, as its person's steps say: one made before any
     * optimiser's result that waits, the steps standing where the last change left them — and none where a conflict
     * was chosen over such a result, whose drafts before it held one still to choose.
     *
     * @returns Whether it has; `undefined` while something is on its way, or waits to be read or chosen
     */
    autosaveMay(): boolean | undefined {
        const { session } = this;
        if (this.out !== undefined || this.preparing !== undefined || session.status !== "idle" || session.locked || session.carrying || session.unsettled !== 0 || this.reading) return undefined;
        if (this.allWait || this.left !== this.cursor) return false;
        const stop = this.steps.findIndex((step, i) => i >= this.taken && i < this.cursor && step.optimise);
        if (stop >= 0 && this.steps.slice(stop, this.cursor).some((step) => step.kind === "settle" || step.moved === true)) return false;
        const send = this.screenForAutomatic();
        return KEYS.some((key) => {
            if (!session.entries.has(key)) return false;
            const [is, was] = [send.get(key), this.rowOfDraft(key, session.originals.get(key)?.draft)];
            return FIELDS.some((field) => !sameValue(is?.[field], was?.[field]));
        });
    }

    /**
     * Whether its Save, over a source read whole, waits for good to be read back: the source has read the record as it
     * now is, and the session waits still. Never, where its host says what its source holds: read since the Save was
     * answered, that collection is where the Save is read back, whatever it holds. Counted, where its host cannot
     * say and every part the Save wrote was put back since exactly as it was — the one collection that reads the same
     * as one from before the Save.
     *
     * @returns Whether it waits for good
     * @throws {ModelFault} Where it waits though its host has read the record since the Save was answered, or — its
     *   host unable to say — though the record holds a part otherwise than its edit began
     */
    waitsForGood(): boolean {
        if (!this.inline || this.session.status !== "reconciling" || this.out !== undefined || !textEqual(this.known.revision, this.record.revision)) return false;
        if (this.says) {
            // Still to read the record since the answer: the read is on its way.
            if (this.heard === "unread") return false;
            throw new ModelFault(`${this.name}'s Save waits to be read back, and its source has read the record since the Save was answered`);
        }
        const commit = this.lastCommit;
        if (commit === undefined) throw new ModelFault(`${this.name}'s session waits to read back a Save the record never took`);
        for (const { key, field, before } of commit.changed) {
            const held = this.record.now.get(key)?.[field];
            if (!sameValue(held, before)) {
                throw new ModelFault(`${this.name}'s Save waits to be read back, and the record holds ${key}.${field} at ${say(held)}: neither put back at ${say(before)}, nor waited on`);
            }
        }
        this.waitedForGood++;
        return true;
    }

    /** How many rows its drafts hold away from what they began as, counted from the versions themselves. */
    drafted(): number {
        let n = 0;
        for (const [key, version] of this.session.entries) {
            const [is, was] = [this.rowOfDraft(key, version.draft), this.rowOfDraft(key, this.session.originals.get(key)?.draft)];
            if (FIELDS.some((field) => !sameValue(is?.[field], was?.[field]))) n++;
        }
        return n;
    }
}

/** One operation of a world, by name: `c0.edit(k1,a)`, `remote.edit(k1,b)`, `c0.deliver`. */
export type ModelOp = string;

/** What a world is made of. */
export interface WorldOptions {
    /** How its sessions draft a row. */
    readonly shape: DraftShape;
    /** How many sessions edit the record: one by default. */
    readonly clients?: number | undefined;
    /** The most writes other sessions make, beside the harness's own clients: two by default. */
    readonly remotes?: number | undefined;
    /** Whether each Save is prepared before it is sent, as a record slice's is: a step of its own, which may fail. */
    readonly prepares?: boolean | undefined;
    /** Whether each session reads the record whole — its base the collection, as a record read whole is — never a revision at a time. */
    readonly inline?: boolean | undefined;
    /**
     * Read whole, whether each session's host says what its source holds once it has read it since a Save was
     * answered, as e3's record runtime does of a record: `true` by default. `false` for a host that cannot — a
     * collection of the page's own — whose sessions read a Save back by what the collection's entries show.
     */
    readonly says?: boolean | undefined;
    /** Whether a person settles the other way a conflict settled before while none is left to choose, as the conflicts popover lets them: off by default. */
    readonly flips?: boolean | undefined;
    /** The most gestures and choices each person makes: unbounded by default. With `sends`, what makes the world's states finite. */
    readonly acts?: number | undefined;
    /** The most requests each session's person starts — a Save, an automatic Save: unbounded by default. */
    readonly sends?: number | undefined;
    /**
     * How many of the requests it took the record remembers: as many as e3 does, by default. 0 for a record that has
     * forgotten every one — what a record is to a request sixteen others have followed, and what e3 was to any
     * request but a record's last before records remembered more.
     */
    readonly remembers?: number | undefined;
}

/** What a print of a world leaves out: what is no state — caches, counters that only count, what a session is bound to. */
const SESSION_NO_STATE: ReadonlySet<string> = new Set([
    "binding", "listeners", "serial", "made", "conflictsCache", "draftsCache", "readinessCache", "draftedViews", "compiledTransform", "compileTransform", "merger",
]);
const CLIENT_NO_STATE: ReadonlySet<string> = new Set(["stepsLost", "unansweredAsked", "waitedForGood", "readEarly", "lateAnswer"]);
const WORLD_PRINT: PrintRules = {
    skip: (owner, key) => (owner instanceof EditSession ? SESSION_NO_STATE.has(key) : owner instanceof ModelClient && CLIENT_NO_STATE.has(key)),
    // A request's bytes hold the id it drew at random: read as the batch they are, the id is named by its order.
    read: (_owner, key, value) => (key === "payload" && value instanceof Uint8Array ? decodeBatch(value) : value),
};

/** The record's rows as every world begins: two rows of two numbers. */
const START: readonly (readonly [string, RowValue])[] = [["k1", { a: 1n, b: 2n }], ["k2", { a: 3n, b: 4n }]];

/** An operation's parts: who does it, what, and to what. */
function partsOf(op: ModelOp): { readonly who: string; readonly name: string; readonly args: readonly string[] } {
    const dot = op.indexOf(".");
    const [who, rest] = [op.slice(0, dot), op.slice(dot + 1)];
    const open = rest.indexOf("(");
    return open < 0 ? { who, name: rest, args: [] } : { who, name: rest.slice(0, open), args: rest.slice(open + 1, -1).split(",") };
}

/** The operations that read or write the record itself: what one actor's must be ordered against another's. */
const TOUCHES_RECORD: ReadonlySet<string> = new Set(["deliver", "deliverUnanswered", "deliverPast", "land", "see"]);

/**
 * Whether two operations may run in either order to the same end: those of different actors, unless each reads or
 * writes the record itself. What an exploration of every ordering leaves out one order of.
 *
 * @param a - One operation
 * @param b - Another
 * @returns Whether their order is no matter
 */
export function independent(a: ModelOp, b: ModelOp): boolean {
    const [x, y] = [partsOf(a), partsOf(b)];
    if (x.who === y.who) return false;
    const touches = (op: { readonly who: string; readonly name: string }) => op.who === "remote" || TOUCHES_RECORD.has(op.name);
    return !(touches(x) && touches(y));
}

/**
 * A world: the record, its clients, and the operations run in it so far.
 */
export class ModelWorld {
    /** The record. */
    readonly record: ModelRecord;
    /** The clients. */
    readonly clients: ModelClient[];
    /** The operations run, in order. */
    readonly ran: ModelOp[] = [];
    private remotes: number;
    private remoteNext = 900n;
    /** What a client's screen showed and held pending before its Undo, while that Undo is the operation last run. */
    private undone: { readonly client: ModelClient; readonly rows: Screen; readonly pending: number } | undefined;

    /**
     * @param options - What it is made of
     */
    constructor(private readonly options: WorldOptions) {
        this.record = new ModelRecord(START, options.remembers);
        this.clients = Array.from({ length: options.clients ?? 1 }, (_, i) =>
            new ModelClient(`c${i}`, i, this.record, options.shape, options.prepares === true, options.inline === true, options.says !== false));
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

    /** How often a session's steps went under its person, in this world. */
    get stepsLost(): number { return this.clients.reduce((n, client) => n + client.stepsLost, 0); }

    /** How often a late answer stepped a screen back, in this world. */
    get lateAnswer(): number { return this.clients.reduce((n, client) => n + client.lateAnswer, 0); }

    /** How often a person was asked to choose, with nothing to save, over a row of a request with no answer that was sent again and refused, in this world. */
    get unansweredAsked(): number { return this.clients.reduce((n, client) => n + client.unansweredAsked, 0); }

    /** How often a Save over a source read whole waited for good to be read back, in this world. */
    get waitedForGood(): number { return this.clients.reduce((n, client) => n + client.waitedForGood, 0); }

    /** How often a session whose host cannot say when it read took a collection read before its Save landed for one read after, in this world. */
    get readEarly(): number { return this.clients.reduce((n, client) => n + client.readEarly, 0); }

    /**
     * The world's print: everything it holds that what it does next may turn on — the record and its every revision,
     * each session's every field, each person's steps and what they have been shown — and nothing that only counts.
     * Two worlds with one print go on alike.
     *
     * @returns The print
     */
    print(): string {
        return fingerprint({ record: this.record, clients: this.clients, remotes: this.remotes, remoteNext: this.remoteNext, undone: this.undone }, WORLD_PRINT);
    }

    /**
     * The operations that can run now, by name.
     *
     * @returns Each one
     */
    enabled(): ModelOp[] {
        const ops: ModelOp[] = [];
        this.clients.forEach((client, i) => {
            const c = `c${i}`;
            const { session } = client;
            const acts = client.acts < (this.options.acts ?? Number.POSITIVE_INFINITY);
            const sends = client.requests < (this.options.sends ?? Number.POSITIVE_INFINITY);
            if (acts && client.canEdit("k1")) ops.push(`${c}.edit(k1,a)`, `${c}.edit(k1,b)`, `${c}.remove(k1)`, `${c}.optimise(k1,a)`);
            // A row removed — by its person, or by another session — added again under its key.
            if (acts && client.canAdd("k1")) ops.push(`${c}.add(k1)`);
            if (acts && client.canEdit("k2")) ops.push(`${c}.edit(k2,a)`);
            if (acts && client.canAdd("k3")) ops.push(`${c}.add(k3)`);
            // A row added — here, or by another session — changed and removed as any is.
            if (acts && client.canEdit("k3")) ops.push(`${c}.edit(k3,a)`, `${c}.remove(k3)`);
            // A change taken back by hand while its conflict waits: a field typed back to what both sides began from, a
            // removed row put back as it was. (A new row removed again is `remove`.)
            for (const [key, field] of [["k1", "a"], ["k1", "b"], ["k3", "a"]] as const) if (acts && client.canRevert(key, field)) ops.push(`${c}.revert(${key},${field})`);
            for (const key of ["k1", "k3"] as const) if (acts && client.canRestore(key)) ops.push(`${c}.restore(${key})`);
            if (session.canUndo) ops.push(`${c}.undo`);
            if (session.canRedo) ops.push(`${c}.redo`);
            if (session.canDiscard && session.pending > 0) ops.push(`${c}.discard`);
            if (sends && session.canApply && client.out === undefined) ops.push(`${c}.save`);
            if (sends && session.canAutosave && client.out === undefined) ops.push(`${c}.autosave`);
            if (client.preparing !== undefined) ops.push(`${c}.prepared`, `${c}.prepareFails`);
            if (client.out !== undefined) ops.push(`${c}.deliver`, `${c}.deliverUnanswered`);
            // Its answer on its way back, the record written again since: the answer arriving as its source moves on.
            if (client.passed) ops.push(`${c}.deliverPast`);
            // Lost before the record hears it — or heard, its answer still to come.
            if (client.unheard) ops.push(`${c}.lose`, `${c}.land`);
            if (session.status === "unknown" && client.out === undefined) ops.push(`${c}.retry`);
            if (!textEqual(client.known.revision, this.record.revision) || client.awaitsRead) ops.push(`${c}.see`);
            if (client.reading) ops.push(`${c}.read`);
            if (client.readsOut > 1) ops.push(`${c}.read1`);
            if (!textEqual(client.screen.revision, client.known.revision)) ops.push(`${c}.redraw`);
            if (acts && session.unsettled > 0 && !session.carrying) ops.push(`${c}.settle(draft)`, `${c}.settle(source)`);
            // With none left to choose, one settled before may still be settled the other way.
            else if (acts && this.options.flips === true) {
                if (client.canFlip("draft")) ops.push(`${c}.settle(draft)`);
                if (client.canFlip("source")) ops.push(`${c}.settle(source)`);
            }
            if (acts && session.unsettled > 1 && !session.carrying) ops.push(`${c}.settle1(draft)`, `${c}.settle1(source)`);
            if (session.pending > 0 || session.locked) ops.push(`${c}.reload`);
        });
        if (this.remotes > 0) {
            // Every key's row, as another session may leave it: changed or removed where the record holds it, added where
            // it does not — a removed key added again, and an added row changed and removed, among them.
            if (this.record.now.has("k1")) ops.push("remote.edit(k1,a)", "remote.edit(k1,b)", "remote.remove(k1)");
            else ops.push("remote.add(k1)");
            if (this.record.now.has("k2")) ops.push("remote.edit(k2,a)");
            if (this.record.now.has("k3")) ops.push("remote.edit(k3,a)", "remote.remove(k3)");
            else ops.push("remote.add(k3)");
        }
        return ops;
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
            const undone = this.undone;
            this.undone = undefined;
            const { who, name, args } = partsOf(op);
            if (who === "remote") this.remote(name, args);
            else {
                const client = this.clients[Number(who.slice(1))];
                if (client === undefined) throw new Error(`No client ${who}`);
                if (name === "undo") this.undone = { client, rows: client.shownRows(), pending: client.session.pending };
                await this.act(client, name, args);
                // Undo then Redo is where it was: the screen, and how much is pending.
                if (name === "redo" && undone?.client === client) {
                    const rows = client.shownRows();
                    const same = KEYS.every((key) => FIELDS.every((field) => sameValue(rows.get(key)?.[field], undone.rows.get(key)?.[field])));
                    if (!same || client.session.pending !== undone.pending) throw new ModelFault(`${client.name}'s Undo then Redo is not where it was`);
                }
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

    /** Another session's write: a commit of its own. */
    private remote(name: string, args: readonly string[]): void {
        this.remotes--;
        const key = args[0]!;
        const fresh = () => this.remoteNext++;
        switch (name) {
            case "edit": {
                const field = args[1] as Field;
                const value = fresh();
                this.record.write((rows) => { const row = rows.get(key); if (row !== undefined) rows.set(key, { ...row, [field]: value }); });
                break;
            }
            case "remove": this.record.write((rows) => { rows.delete(key); }); break;
            case "add": { const row = { a: fresh(), b: fresh() }; this.record.write((rows) => { rows.set(key, row); }); break; }
            default: throw new Error(`No remote operation ${name}`);
        }
    }

    private async act(client: ModelClient, name: string, args: readonly string[]): Promise<void> {
        switch (name) {
            case "edit": client.edit(args[0]!, args[1] as Field); break;
            case "optimise": client.optimise(args[0]!, args[1] as Field); break;
            case "autosave": await client.autosave(); break;
            case "add": client.add(args[0]!); break;
            case "remove": client.remove(args[0]!); break;
            case "revert": client.revert(args[0]!, args[1] as Field); break;
            case "restore": client.restore(args[0]!); break;
            case "undo": client.undo(); break;
            case "redo": client.redo(); break;
            case "discard": client.discard(); break;
            case "save": await client.save(); break;
            case "prepared": await client.prepared(true); break;
            case "prepareFails": await client.prepared(false); break;
            case "deliver": await client.deliver(true); break;
            case "deliverUnanswered": await client.deliver(false); break;
            case "deliverPast": await client.deliverPast(); break;
            case "lose": await client.lose(); break;
            case "land": client.land(); break;
            case "retry": await client.retry(); break;
            case "see": client.see(); break;
            case "read": client.read(); break;
            case "read1": client.read(true); break;
            case "settle1": client.settle(args[0] as ConflictChoice, true); break;
            case "redraw": client.redraw(); break;
            case "settle": client.settle(args[0] as ConflictChoice); break;
            case "reload": client.reload(); break;
            default: throw new Error(`No operation ${name}`);
        }
    }

    /** What holds after every operation. */
    private check(): void {
        for (const client of this.clients) {
            const { session } = client;
            client.observe();
            if (session.pending !== client.drafted()) {
                throw new ModelFault(`${client.name} says ${session.pending} pending, and holds ${client.drafted()} rows drafted away from what they began as`);
            }
            if ((client.out !== undefined || client.preparing !== undefined) !== (session.status === "applying")) {
                throw new ModelFault(`${client.name} ${client.out === undefined && client.preparing === undefined ? "has no request" : "has a request"} on its way, and says it is ${session.status}`);
            }
            if (client.out !== undefined && client.preparing !== undefined) throw new ModelFault(`${client.name} has a request on its way while one is prepared`);
            // A conflict holds its record's Save: neither a person's nor an automatic one is offered while one waits to be chosen.
            if (session.unsettled > 0 && (session.canApply || session.canAutosave)) {
                throw new ModelFault(`${client.name} holds ${session.unsettled} conflicts to choose, and its session offers ${session.canApply ? "a Save" : "an automatic Save"}`);
            }
            // An automatic Save is there exactly while it has something it may send: a change it may send never waits unsaid.
            const may = client.autosaveMay();
            if (may !== undefined && session.canAutosave !== may) {
                throw new ModelFault(may ? `${client.name} has a change an automatic Save may send, and its session says it has none` : `${client.name}'s session says an automatic Save may send, and it has nothing it may`);
            }
        }
        if (this.record.applied !== this.record.commits.filter((commit) => commit.by !== "remote").length) {
            throw new ModelFault("The record applied a batch more than once");
        }
    }

    /**
     * Brings the world to rest — every request answered, every revision heard of, read and drawn, every conflict chosen
     * for the draft, every change saved — and checks what must hold of a world at rest.
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
                    await step(client.preparing !== undefined, "prepared");
                    await step(client.out !== undefined, "deliver");
                    await step(!textEqual(client.known.revision, this.record.revision) || client.awaitsRead, "see");
                    await step(client.reading, "read");
                    await step(!textEqual(client.screen.revision, client.known.revision), "redraw");
                    await step(session.unsettled > 0 && !session.carrying, "settle", ["draft"]);
                    await step(session.status === "unknown" && client.out === undefined, "retry");
                    await step(session.canApply && client.out === undefined, "save");
                    // A Save that waits for good to be read back: its person reloads the page.
                    await step(client.waitsForGood(), "reload");
                }
                if (!moved) break;
            }
            for (const client of this.clients) {
                const { session } = client;
                if (session.status !== "idle" || session.pending !== 0 || session.unsettled !== 0 || session.locked || session.carrying || session.landed.size !== 0) {
                    throw new ModelFault(`${client.name} is not at rest: ${session.status}, ${session.pending} pending, ${session.unsettled} conflicts, ${session.landed.size} landed${session.error === undefined ? "" : `, "${session.error}"`}`);
                }
                if (!rowsEqual(client.screen.rows, this.record.now)) throw new ModelFault(`${client.name}'s screen is not the record`);
                // What its person put a field at, a Save of theirs wrote — or the record holds it anyway.
                for (const [key, fields] of client.claims) {
                    for (const [field, { value }] of fields) {
                        const held = this.record.now.get(key)?.[field];
                        if (!sameValue(held, value)) throw new ModelFault(`${client.name}'s person put ${key}.${field} at ${say(value)}; no Save of theirs wrote it, and the record holds ${say(held)}`);
                    }
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
        return new ModelFault(`${error.message}\n  after: ${ran}\n  drafts: ${this.options.shape}`);
    }
}

/**
 * A world with some operations run in it.
 *
 * @param options - What the world is made of
 * @param ops - The operations, in order
 * @returns The world
 * @throws {ModelFault} What failed, with the operations that led to it
 */
export async function worldAfter(options: WorldOptions, ops: readonly ModelOp[]): Promise<ModelWorld> {
    const world = new ModelWorld(options);
    await world.start();
    for (const op of ops) await world.run(op);
    return world;
}
