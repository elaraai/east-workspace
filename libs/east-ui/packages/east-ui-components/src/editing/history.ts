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
 *   unanswered write leaves the others' commits standing. It is on while every
 *   session's drafts pass their checks and one has a change to send. While a
 *   session's write has no answer, Save is Retry, which resends that
 *   session's request, its id unchanged.
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
import type { BatchReadiness } from "./draft.js";
import type { HistoryAction } from "./HistoryBar.js";
import type { EditIssue, EditSession, EntryUpdate, Origin } from "./session.js";

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
    /** The first session's error, in order. */
    get error(): string | undefined {
        for (const session of this.all) if (session.error !== undefined) return session.error;
        return undefined;
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
    /** Discard is available: no session's request is unresolved. */
    get canDiscard(): boolean { return this.all.every((session) => session.canDiscard); }
    /** Save is available: every session's drafts pass their checks, and one has a change it can send. */
    get canApply(): boolean {
        const all = this.all;
        return all.some((session) => session.canApply) && all.every((session) => session.readiness.type === "ready");
    }

    /**
     * The session an issue is of, by the issue itself — the very object a
     * session's issues or readiness hold.
     *
     * @param issue - One of the history's issues
     * @returns The session's key, or `undefined` for an issue none of them holds
     */
    sourceOf(issue: EditIssue): string | undefined {
        for (const [key, session] of this.sessions) {
            if (session.issues.some((held) => Object.is(held, issue))) return key;
            const readiness = session.readiness;
            if (readiness.type !== "ready" && readiness.value.some((held) => Object.is(held, issue))) return key;
        }
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
            this.moved = true;
        });
    }

    /**
     * Save: every session whose write has no answer sends its request again,
     * its id unchanged — only those, while one stands; otherwise each session
     * with a change it can send sends it, each its own request.
     */
    async apply(): Promise<void> {
        const all = this.all;
        const unanswered = all.filter((session) => session.status === "unknown");
        if (unanswered.length > 0) {
            await Promise.all(unanswered.map((session) => session.apply()));
            return;
        }
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

    /** A new step, after the done ones: what Redo could replay goes, in every session. */
    private push(keys: readonly string[]): void {
        for (const step of this.steps.slice(this.cursor)) {
            for (const key of step) if (!holds(keys, key)) this.sessions.get(key)?.dropRedo();
        }
        this.steps.splice(this.cursor);
        this.steps.push(keys);
        this.cursor = this.steps.length;
        this.moved = true;
    }

    /** A session's key out of every step; a step left with none goes. */
    private forget(key: string): void {
        let cursor = this.cursor;
        const kept: (readonly string[])[] = [];
        this.steps.forEach((step, i) => {
            if (!holds(step, key)) { kept.push(step); return; }
            this.moved = true;
            const left = step.filter((k) => !stringEqual(k, key));
            if (left.length > 0) kept.push(left);
            else if (i < this.cursor) cursor--;
        });
        this.steps = kept;
        this.cursor = cursor;
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
