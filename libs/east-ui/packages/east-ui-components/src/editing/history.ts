/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * One history over several editing sessions (#1194) — for a builder whose
 * entries live in several sources, each edited in a session of its own: the
 * Plan's event kinds, a record each, beside the `data` it edits; the
 * Calendar's kinds (#1151). Every gesture is one step of the history, tagged
 * with the sessions it recorded in — one, or several for a gesture across
 * sources, as a bulk edit is — and the history steps through them in the
 * order they were made, whatever their sources:
 *
 * - **Undo and Redo** take back the last step in each of its sessions, and
 *   replay the next. A new gesture drops what Redo could replay in every
 *   session, as one history's would.
 * - **Discard** drops every session's drafts, and the steps with them.
 * - **Save** commits each session with a change it can send, each its own
 *   request with its own outcome: one session's conflict, refusal or
 *   unanswered write leaves the others' commits standing. It is on while one
 *   session has a change it can send: a session whose drafts fail their
 *   checks, or that holds a conflict still to settle, holds back its own
 *   changes alone, and the others' are sent past it. While a session's write
 *   has no answer, Save is Retry, which resends that session's request, its id
 *   unchanged.
 * - **Conflicts** — a part of a draft another write changed differently — are
 *   every session's, each settled in its session as one step of the history;
 *   settling all one way is one step across the sessions that hold them.
 * - **An automatic Save** (`autosave.ts`) stops before an optimiser's result
 *   no person's Save has taken, in the order the gestures were made: what was
 *   changed before it, in any session, is sent, and the result and every
 *   change made after it, in any session, wait for a person's Save, which
 *   takes every step done so far. And it sends only from where the last
 *   change left the steps: an Undo or a Redo, in any session, is a step of the
 *   history's, never saved by itself (ruled 11 Nov 2026).
 * - **A session's own history going** — its drafts discarded, its source
 *   moving under none, a commit read back with another write's field beside
 *   it — takes it out of the steps, and a step left with no session goes.
 *
 * It reads as one session does — its status, issues, readiness, pending
 * changes and what may be done now — so the history bar and its toolbar item
 * take it as they take a session. Each session's banners stay its own, and
 * act on it alone ({@link EditHistory.actOn}).
 *
 * @packageDocumentation
 */
import { StringType, equalFor, variant } from "@elaraai/east";
import type { AutosaveState } from "./autosave.js";
import type { BatchReadiness } from "./draft.js";
import type { HistoryAction } from "./HistoryBar.js";
import type { ConflictChoice, EditIssue, EditSession, EntryConflicts, EntryUpdate, Origin, SettledConflict } from "./session.js";

/** A session's state, as the history reads it. */
type Status = EditSession<unknown>["status"];

/**
 * One part of a gesture: the session it records in, by its key in the
 * history, and the entries it changed there, each once.
 *
 * @typeParam W - The sessions' projection of an entry
 */
export interface EditHistoryPart<W> {
    /** The session's key in the history. */
    readonly key: string;
    /** Each entry the gesture changed in it, once. */
    readonly updates: readonly EntryUpdate<W>[];
}

/** The states the history reads as, in order: the first one a session is in is the history's. */
const STATUS_ORDER: readonly Exclude<Status, "idle">[] = ["unknown", "applying", "reconciling", "conflict", "rejected"];
/** Where its requests stand as an automatic Save reads them, in order: the first one a session is in is the history's. */
const SAVING_ORDER: readonly Exclude<AutosaveState, "idle">[] = ["unanswered", "readBackFailed", "sending", "readingBack"];

const stringEqual = equalFor(StringType);

/** Whether a step holds a session's key. */
const holds = (step: readonly string[], key: string): boolean => step.some((k) => stringEqual(k, key));

/**
 * One history over several editing sessions — see the module docs.
 *
 * @typeParam W - The sessions' projection of an entry
 */
export class EditHistory<W> {
    /** The sessions, by key, in the order the history was given them. */
    private readonly sessions = new Map<string, EditSession<W>>();
    private readonly unsubscribes = new Map<string, () => void>();
    /** How many of a session's own transactions lie under its steps here: what it held when it joined, or when its history last moved without this one. */
    private readonly floors = new Map<string, number>();
    /** The steps, oldest first: each the keys of the sessions one gesture recorded in. */
    private steps: (readonly string[])[] = [];
    /** How many steps are done: Undo takes back the one before it, Redo replays the one at it. */
    private cursor = 0;
    /**
     * How many steps were done as the last change was made, in any session, or as a person's Save last took them: the
     * one place an automatic Save sends from ({@link EditHistory.stepped}).
     */
    private drafted = 0;
    private readonly listeners = new Set<() => void>();
    private serial = 0;
    /** Inside one of the history's own acts: what its sessions say waits for the act's end. */
    private acting = 0;
    /** Something moved since the history last said so. */
    private moved = false;

    /**
     * The sessions the history steps through, by key, in order: a session
     * new to it joins with no step, one it no longer holds — or holds another
     * session under its key — leaves with its steps.
     *
     * @param sessions - Each session, by its key; a key given twice takes its last session
     */
    sync(sessions: Iterable<readonly [string, EditSession<W>]>): void {
        const next = new Map(sessions);
        const before = [...this.sessions.keys()];
        // A session gone, or another under its key: it leaves, with its steps.
        for (const [key, session] of [...this.sessions]) {
            if (Object.is(next.get(key), session)) continue;
            this.unsubscribes.get(key)?.();
            this.unsubscribes.delete(key);
            this.sessions.delete(key);
            this.floors.delete(key);
            this.forget(key);
            this.moved = true;
        }
        // A session new to the history joins with no step, what it held already its floor.
        for (const [key, session] of next) {
            if (this.sessions.has(key)) continue;
            this.unsubscribes.set(key, session.subscribe(() => this.heard()));
            this.floors.set(key, session.depth.undo);
        }
        // Every session, in the order given.
        this.sessions.clear();
        for (const [key, session] of next) this.sessions.set(key, session);
        const after = [...this.sessions.keys()];
        if (before.length !== after.length || before.some((key, i) => !stringEqual(key, after[i]!))) this.moved = true;
        if (this.acting === 0) this.settle();
    }

    /**
     * A session the history steps through.
     *
     * @param key - Its key
     * @returns The session, if the history holds one under the key
     */
    session(key: string): EditSession<W> | undefined { return this.sessions.get(key); }

    /** The sessions' keys, in order. */
    get keys(): readonly string[] { return [...this.sessions.keys()]; }

    /** Subscribe to every change of the history and of its sessions (`useSyncExternalStore`). */
    subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
    /** The change counter (`useSyncExternalStore`). */
    getSnapshot = (): number => this.serial;

    // ── What it reads as ────────────────────────────────────────────────────

    /** Every session, in order. */
    private get all(): EditSession<W>[] { return [...this.sessions.values()]; }

    /**
     * Where its requests stand: a write with no answer first — Save is Retry
     * while one stands — then one in flight, one confirming, a conflict and a
     * refusal; idle while every session is.
     */
    get status(): Status {
        const all = this.all;
        return STATUS_ORDER.find((status) => all.some((session) => session.status === status)) ?? "idle";
    }
    /** A source moved under a session's pending drafts. */
    get stale(): boolean { return this.all.some((session) => session.stale); }
    /** A session's drafts are being carried over to the base its source moved to. */
    get carrying(): boolean { return this.all.some((session) => session.carrying); }
    /** The first session's error, in order. */
    get error(): string | undefined {
        for (const session of this.all) if (session.error !== undefined) return session.error;
        return undefined;
    }
    /**
     * Where its sessions' read backs stand (#1573): `"failed"` once one has
     * failed, else `"waiting"` while one reads its saved state back, else
     * `undefined` — read from the sessions that read back
     * ({@link EditSession.readBack}), never from another's error, as one whose
     * Save could not be prepared holds.
     */
    get readBack(): "waiting" | "failed" | undefined {
        let waiting = false;
        for (const session of this.all) {
            const readBack = session.readBack;
            if (readBack === "failed") return "failed";
            if (readBack === "waiting") waiting = true;
        }
        return waiting ? "waiting" : undefined;
    }
    /** Every session's issues with its latest request, in order. */
    get issues(): EditIssue[] { return this.all.flatMap((session) => session.issues); }
    /** Every session's drafts' readiness together: ready while each is; invalid when one is. */
    get readiness(): BatchReadiness {
        const issues: EditIssue[] = [];
        let held = false;
        let invalid = false;
        for (const session of this.all) {
            const readiness = session.readiness;
            if (readiness.type === "ready") continue;
            held = true;
            invalid ||= readiness.type === "invalid";
            for (const issue of readiness.value) issues.push(issue);
        }
        return held ? variant(invalid ? "invalid" : "incomplete", issues) : variant("ready", null);
    }
    /** How many entries' drafts differ from their originals, every session's. */
    get pending(): number { return this.all.reduce((n, session) => n + session.pending, 0); }
    /** Every session may record a gesture now. */
    get writable(): boolean { return this.all.every((session) => session.writable); }
    /** A Save could be sent for every session, had each a change to send: none has a request unresolved, nor drafts being carried over. */
    get canSend(): boolean { return this.all.every((session) => session.canSend); }
    /** Undo is available: the last step's every session can take its part back. */
    get canUndo(): boolean {
        const step = this.steps[this.cursor - 1];
        return step !== undefined && step.every((key) => this.sessions.get(key)?.canUndo === true);
    }
    /** Redo is available: the next step's every session can replay its part. */
    get canRedo(): boolean {
        const step = this.steps[this.cursor];
        return step !== undefined && step.every((key) => this.sessions.get(key)?.canRedo === true);
    }
    /**
     * The origin of the step Redo would replay next (#1409): one gesture's,
     * the same in each of its sessions — what a host that lands a step again
     * by its origin reads. `undefined` with nothing to replay.
     */
    get redoOrigin(): Origin | undefined {
        const step = this.steps[this.cursor];
        const first = step?.[0];
        return first === undefined ? undefined : this.sessions.get(first)?.nextRedo?.origin;
    }
    /** Discard is available: no session's request is unresolved. */
    get canDiscard(): boolean { return this.all.every((session) => session.canDiscard); }
    /**
     * Save is available: one session has a change it can send — its drafts
     * pass their checks, it holds no conflict to settle, and no request of its
     * source's is unresolved. A session that cannot send holds back its own
     * changes alone ({@link EditHistory.readiness} and
     * {@link EditHistory.unsettled} still say what holds it).
     */
    get canApply(): boolean { return this.all.some((session) => session.canApply); }
    /** Every session's entries in conflict, each with the session it is in, in the sessions' order. */
    get conflicts(): readonly { readonly key: string; readonly entry: EntryConflicts }[] {
        const out: { key: string; entry: EntryConflicts }[] = [];
        for (const [key, session] of this.sessions) for (const entry of session.conflicts.values()) out.push({ key, entry });
        return out;
    }
    /** Every session's conflicts settled since its drafts were last carried over, each with its session. */
    get settled(): readonly { readonly key: string; readonly conflict: SettledConflict }[] {
        const out: { key: string; conflict: SettledConflict }[] = [];
        for (const [key, session] of this.sessions) for (const conflict of session.settled) out.push({ key, conflict });
        return out;
    }
    /** How many conflicts are still to settle, every session's: each holds back its own session's Save until it is. */
    get unsettled(): number { return this.all.reduce((n, session) => n + session.unsettled, 0); }
    /** How many settled conflicts the conflicts popover shows, across the sessions: a range's in one entry counting once. */
    get chosen(): number { return this.all.reduce((n, session) => n + session.chosen, 0); }

    // ── What an automatic Save reads, and does ──────────────────────────────

    /** How many gestures, Undos, Redos and conflict choices its sessions have taken: it moves with each (`autosave.ts`). */
    get edits(): number { return this.all.reduce((n, session) => n + session.edits, 0); }
    /**
     * Where its requests stand, as an automatic Save reads them: a write left
     * with no answer first, then a read back that failed — each asked again —
     * then one on its way and one read back; idle while every session is.
     */
    get saving(): AutosaveState {
        const all = this.all;
        return SAVING_ORDER.find((state) => all.some((session) => session.saving === state)) ?? "idle";
    }
    /** Whether an optimiser's result waits for a person's Save in a session: a change still to save that an automatic Save sends none of. */
    get autosaveHeld(): boolean { return this.all.some((session) => session.autosaveHeld); }
    /**
     * Where an automatic Save stops in each session, by its key: the session's
     * own stop ({@link EditSession.heldFrom}), or sooner — before the first
     * step it took after the earliest optimiser's result that waits in any
     * session, in the order the gestures were made. A change made after a
     * result, in a record the result never touched, was still made over it.
     */
    private stops(): Map<string, number | "all" | undefined> {
        // The earliest step, among those done, that a session holds as an optimiser's result that waits.
        let held: number | undefined;
        for (const [key, session] of this.sessions) {
            const from = session.heldFrom;
            const under = this.floors.get(key) ?? 0;
            // One it made before it joined the history, or whose history went, is its own alone.
            if (typeof from !== "number" || from < under) continue;
            let done = under;
            for (let i = 0; i < this.cursor; i++) {
                if (!holds(this.steps[i]!, key)) continue;
                if (done === from) {
                    if (held === undefined || i < held) held = i;
                    break;
                }
                done++;
            }
        }
        const stops = new Map<string, number | "all" | undefined>();
        for (const [key, session] of this.sessions) {
            let stop = session.heldFrom;
            if (held !== undefined && stop !== "all") {
                // What the session had done before that step: what lies under its steps here, and each earlier step it is in.
                let before = this.floors.get(key) ?? 0;
                for (let i = 0; i < held; i++) if (holds(this.steps[i]!, key)) before++;
                if (before < session.depth.undo && (stop === undefined || before < stop)) stop = before;
            }
            stops.set(key, stop);
        }
        return stops;
    }
    /**
     * Whether the done steps stand where Undo or Redo left them, away from where the last change did (ruled 11 Nov
     * 2026): an automatic Save sends nothing from there, in any session — a step back in one record is a step back of
     * the history, whatever the others' own steps say ({@link EditSession.stepped}). A person's Save takes where the
     * steps stand as theirs; a change made anywhere is saved with what stands in every session.
     */
    get stepped(): boolean { return this.cursor !== this.drafted; }
    /** Whether a change waits for a person's Save because Undo or Redo left it: in the history's steps, or in a session's own. */
    get autosaveStepped(): boolean {
        return (this.stepped && this.pending > 0) || this.all.some((session) => session.autosaveStepped);
    }
    /**
     * Whether an automatic Save has a change it may send now, in some session: one made before any optimiser's result
     * that waits, the steps standing where the last change left them.
     */
    get canAutosave(): boolean {
        if (this.stepped) return false;
        for (const [key, stop] of this.stops()) if (this.sessions.get(key)!.canAutosaveTo(stop)) return true;
        return false;
    }
    /**
     * An automatic Save: each session with a change one may send sends it,
     * each its own request, and nothing is taken as a person's Save takes it.
     *
     * @returns Whether the source took every one it was sent: `false` where it refused one, gave one no answer, or none was sent
     */
    async autosave(): Promise<boolean> {
        if (this.stepped) return false;
        const sends: Promise<boolean>[] = [];
        for (const [key, stop] of this.stops()) {
            const session = this.sessions.get(key)!;
            if (session.canAutosaveTo(stop)) sends.push(session.autosaveTo(stop));
        }
        if (sends.length === 0) return false;
        return (await Promise.all(sends)).every((took) => took);
    }
    /** Ask again, in each session: a write left with no answer is sent again, its id unchanged; a read back is asked for again. */
    retry(): void {
        for (const session of this.all) session.retry();
    }

    /**
     * The session an issue is of, by the issue itself — the very object a
     * session's issues, its readiness or its conflicts hold ({@link EditSession.holds}).
     *
     * @param issue - One of the history's issues
     * @returns The session's key, or `undefined` for an issue none of them holds
     */
    sourceOf(issue: EditIssue): string | undefined {
        for (const [key, session] of this.sessions) if (session.holds(issue)) return key;
        return undefined;
    }

    // ── Its acts ────────────────────────────────────────────────────────────

    /**
     * Record one gesture — one call per gesture, however many sources and
     * entries it touches — as one step: a transaction in each session it
     * changed. Nothing is recorded unless every session it names takes a
     * gesture now.
     *
     * @param parts - Each session's part of the gesture, one per session
     * @param origin - The gesture
     * @param label - Its label in the history
     * @returns Whether anything changed
     * @throws {Error} When a session is named twice
     */
    record(parts: readonly EditHistoryPart<W>[], origin: Origin, label: string): boolean {
        const sessions = parts.map((part) => this.sessions.get(part.key));
        if (parts.length === 0 || sessions.some((session) => session === undefined || !session.writable)) return false;
        parts.forEach((part, i) => {
            if (parts.slice(0, i).some((earlier) => stringEqual(earlier.key, part.key))) {
                throw new Error("Compose a session's entries into one part before recording its gesture");
            }
        });
        return this.run(() => {
            const recorded: string[] = [];
            try {
                parts.forEach((part, i) => {
                    if (part.updates.length > 0 && sessions[i]!.record(part.updates, origin, label)) recorded.push(part.key);
                });
            } finally {
                if (recorded.length > 0) this.push(recorded);
            }
            return recorded.length > 0;
        });
    }

    /**
     * Settle one conflict in its session, as one step of the history.
     *
     * @param key - The session's key
     * @param id - The entry
     * @param path - The conflict's patch path
     * @param choice - Which value stands
     * @returns Whether anything moved
     */
    settleConflict(key: string, id: string, path: string, choice: ConflictChoice): boolean {
        return this.settleConflicts(key, id, [path], choice);
    }

    /**
     * Settle several conflicts of an entry in its session one way — a range's
     * start and end — as one step of the history.
     *
     * @param key - The session's key
     * @param id - The entry
     * @param paths - The conflicts' patch paths
     * @param choice - Which value stands
     * @returns Whether anything moved
     */
    settleConflicts(key: string, id: string, paths: readonly string[], choice: ConflictChoice): boolean {
        const session = this.sessions.get(key);
        if (session === undefined) return false;
        return this.run(() => {
            const moved = session.settleTogether(id, paths, choice);
            if (moved) this.push([key]);
            return moved;
        });
    }

    /**
     * Settle every conflict one way, in every session that holds one: one
     * step of the history across them.
     *
     * @param choice - Which value stands
     * @returns Whether anything moved
     */
    settleAll(choice: ConflictChoice): boolean {
        return this.run(() => {
            const recorded: string[] = [];
            try {
                for (const [key, session] of this.sessions) if (session.settleAll(choice)) recorded.push(key);
            } finally {
                if (recorded.length > 0) this.push(recorded);
            }
            return recorded.length > 0;
        });
    }

    /** Undo the last step, in each of its sessions. */
    undo(): void {
        if (!this.canUndo) return;
        this.run(() => {
            const step = this.steps[--this.cursor]!;
            this.moved = true;
            for (const key of [...step].reverse()) this.sessions.get(key)!.undo();
        });
    }

    /** Redo the next step, in each of its sessions. */
    redo(): void {
        if (!this.canRedo) return;
        this.run(() => {
            const step = this.steps[this.cursor++]!;
            this.moved = true;
            for (const key of step) this.sessions.get(key)!.redo();
        });
    }

    /** Discard every session's drafts, and the steps with them. */
    discard(): void {
        if (!this.canDiscard) return;
        this.run(() => {
            for (const session of this.sessions.values()) session.discard();
            this.steps = [];
            this.cursor = 0;
            this.drafted = 0;
            this.moved = true;
        });
    }

    /**
     * Save: every session whose write has no answer sends its request again,
     * its id unchanged — only those, while one stands; otherwise each session
     * with a change it can send sends it, each its own request. A person's
     * Save takes every step done so far, in every session, one it cannot send
     * yet among them: an optimiser's result waits for one no more, and where
     * the steps stand — stepped to or not — is the person's.
     */
    async apply(): Promise<void> {
        const all = this.all;
        const unanswered = all.filter((session) => session.status === "unknown");
        if (unanswered.length > 0) {
            await Promise.all(unanswered.map((session) => session.apply()));
            return;
        }
        this.run(() => {
            for (const session of all) session.accept();
            if (this.stepped) { this.drafted = this.cursor; this.moved = true; }
        });
        if (!this.canApply) return;
        await Promise.all(all.filter((session) => session.canApply).map((session) => session.apply()));
    }

    /** Ask each confirming session's source for the revision its request committed again. */
    refresh(): void {
        for (const session of this.all) if (session.status === "reconciling") session.refresh();
    }

    /**
     * A history bar action — its buttons' and its keys'.
     *
     * @param action - The action
     */
    act(action: HistoryAction): void {
        switch (action) {
            case "undo": this.undo(); break;
            case "redo": this.redo(); break;
            case "discard": this.discard(); break;
            case "apply": void this.apply(); break;
            case "refresh": this.refresh(); break;
        }
    }

    /**
     * One session's banner's action, on that session alone: its Retry sends
     * its request again (`apply`) or reads its result again (`refresh`), and
     * its Discard drops its drafts — its steps going with them. Undo and Redo
     * are the history's.
     *
     * @param key - The session's key
     * @param action - The action
     */
    actOn(key: string, action: HistoryAction): void {
        const session = this.sessions.get(key);
        if (session === undefined) return;
        switch (action) {
            case "apply": void session.apply(); break;
            case "refresh": session.refresh(); break;
            case "discard": this.run(() => session.discard()); break;
            default: this.act(action);
        }
    }

    // ── Keeping the steps true to the sessions ──────────────────────────────

    /**
     * A new step, after the done ones: what Redo could replay goes, in every session — and the steps stand where this
     * change left them, in every session: what stands in each is an automatic Save's with it.
     */
    private push(keys: readonly string[]): void {
        for (const step of this.steps.slice(this.cursor)) {
            for (const key of step) if (!holds(keys, key)) this.sessions.get(key)?.dropRedo();
        }
        this.steps.splice(this.cursor);
        this.steps.push(keys);
        this.cursor = this.steps.length;
        this.drafted = this.cursor;
        for (const session of this.sessions.values()) session.changedElsewhere();
        this.moved = true;
    }

    /** A session's key out of every step; a step left with none goes, and what counts the steps counts one fewer. */
    private forget(key: string): void {
        let cursor = this.cursor;
        let drafted = this.drafted;
        const kept: (readonly string[])[] = [];
        this.steps.forEach((step, i) => {
            if (!holds(step, key)) { kept.push(step); return; }
            this.moved = true;
            const left = step.filter((k) => !stringEqual(k, key));
            if (left.length > 0) { kept.push(left); return; }
            if (i < this.cursor) cursor--;
            if (i < this.drafted) drafted--;
        });
        this.steps = kept;
        this.cursor = cursor;
        this.drafted = drafted;
    }

    /**
     * Each session's steps as its own history holds them: the steps' done
     * parts the transactions over its floor, its undone ones no more than
     * Redo can replay. A session whose history moved without this one —
     * discarded, rebased onto a source that moved under no draft, cleared by a
     * commit read back with another write's field — leaves the steps, its
     * floor where its history stands now.
     */
    private align(): void {
        for (const [key, session] of this.sessions) {
            let done = 0;
            let undone = 0;
            this.steps.forEach((step, i) => {
                if (!holds(step, key)) return;
                if (i < this.cursor) done++;
                else undone++;
            });
            const depth = session.depth;
            if (depth.undo === (this.floors.get(key) ?? 0) + done && depth.redo >= undone) continue;
            this.forget(key);
            this.floors.set(key, depth.undo);
        }
    }

    /** A session moved: said at once, or at the end of the history's own act. */
    private heard(): void {
        this.moved = true;
        if (this.acting === 0) this.settle();
    }

    /** The steps put true to the sessions, and a move said. */
    private settle(): void {
        this.align();
        if (!this.moved) return;
        this.moved = false;
        this.serial++;
        for (const listener of this.listeners) listener();
    }

    /** One of the history's own acts: what its sessions say while it runs is said once, at its end. */
    private run<T>(act: () => T): T {
        this.acting++;
        try {
            return act();
        } finally {
            this.acting--;
            if (this.acting === 0) this.settle();
        }
    }
}
