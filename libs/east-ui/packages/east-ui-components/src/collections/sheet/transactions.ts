/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Gesture history, checked batch composition and serial submission. @packageDocumentation */
import { ArrayType, BlobType, East, EastTypeType, OptionType, StringType, StructType, decodeBeast2For, diffFor, encodeBeast2For, equalFor, none, some, toEastTypeValue, variant, type EastType, type ValueTypeOf } from "@elaraai/east";
import { applySheet, SheetAppliedTypeFor, SheetApplyResultType, SheetBaseTypeFor, SheetChangeSetTypeFor, SheetChangeTypeFor, SheetEntryPlacementType, SheetIssueType, SheetOriginType, SheetPatchEventTypeFor } from "@elaraai/east-ui/internal";
import { normalizeDraft, type BatchReadiness } from "./draft-values.js";
import type { SheetRowValue } from "./values.js";
import { SESSION_TEXT } from "./words.js";

// The runtime schemas remain exact. The TS algorithm treats domain payloads
// opaquely instead of infinitely expanding PatchTypeOf<EastType>.
type Opaque = StructType<Record<never, never>>;
type Change = ValueTypeOf<ReturnType<typeof SheetChangeTypeFor<Opaque>>>;
type Base = ValueTypeOf<ReturnType<typeof SheetBaseTypeFor<Opaque>>>;
type Batch = ValueTypeOf<ReturnType<typeof SheetChangeSetTypeFor<Opaque>>>;
type Applied = ValueTypeOf<ReturnType<typeof SheetAppliedTypeFor<Opaque>>>;
type ApplyResult = ValueTypeOf<typeof SheetApplyResultType>;
type Issue = ValueTypeOf<typeof SheetIssueType>;
export type Placement = ValueTypeOf<OptionType<typeof SheetEntryPlacementType>>;
export type Origin = ValueTypeOf<typeof SheetOriginType>["type"];

/** One complete local entry state; undefined draft means the entry is absent. */
export interface EntryVersion {
    draft: unknown;
    wire: SheetRowValue | undefined;
    /** Actual position of this version, retained for inverse moves. */
    place: Placement;
}
/** A gesture may update several entries, but each entry appears only once. */
export interface EntryUpdate {
    id: string;
    before: EntryVersion;
    after: EntryVersion;
}
interface History {
    label: string;
    before: Map<string, EntryVersion>;
    after: Map<string, EntryVersion>;
}
export interface SheetTransactionBinding {
    sourceId: string;
    entryType: EastType;
    draftType: EastType;
    children?: string | undefined;
    idField?: string | undefined;
    apply: ((payload: Uint8Array) => ApplyResult | Promise<ApplyResult>) | undefined;
    patch: ((payload: Uint8Array) => unknown) | undefined;
    refresh: ((revision: ValueTypeOf<OptionType<import("@elaraai/east").StringType>>) => unknown) | undefined;
    auto: boolean;
    /** Additional domain requirements over the current draft collection. */
    ready?: ((entries: ReadonlyMap<string, EntryVersion>) => BatchReadiness) | undefined;
    /** One unresolved request across every Sheet bound to this source. */
    gate?: { available: () => boolean; acquire: () => void; release: () => void } | undefined;
}
interface Submission {
    payload: Uint8Array;
    apply: NonNullable<SheetTransactionBinding["apply"]>;
    refresh: SheetTransactionBinding["refresh"];
    after: Map<string, EntryVersion>;
    affected: Set<string>;
    base: Base;
    revision: string | undefined;
    expected: Uint8Array | undefined;
    release: (() => void) | undefined;
}

const placementEqual = equalFor(OptionType(SheetEntryPlacementType));
const stringEqual = equalFor(StringType);
const blobEqual = equalFor(BlobType);
const schemaEqual = equalFor(EastTypeType);
const ABSENT: EntryVersion = { draft: undefined, wire: undefined, place: none };

/** Opaque 128-bit IDs for cross-tab deduplication, including HTTP showcases.
 * getRandomValues is available outside secure contexts; randomUUID is not.
 */
function randomId(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
}


/**
 * One source-bound editing session. The UI supplies fully decoded draft
 * versions at gesture boundaries; East diff composes the public patches.
 * A pending request owns its frozen bytes and callback until resolved.
 */
export class SheetTransactions {
    private binding: SheetTransactionBinding;
    private baseline = new Map<string, EntryVersion>();
    private current = new Map<string, EntryVersion>();
    private history: History[] = [];
    private cursor = 0;
    private base: Base | undefined;
    private submission: Submission | undefined;
    private listeners = new Set<() => void>();
    private serial = 0;
    private autoSequence = 0;
    private readonly draftEqual: (a: unknown, b: unknown) => boolean;
    private readonly domainEqual: (a: unknown, b: unknown) => boolean;
    private readonly draftDiff: (a: unknown, b: unknown) => Change["patch"];
    private readonly domainDiff: (a: unknown, b: unknown) => Change["patch"];
    private readonly encodeBatch: (value: unknown) => Uint8Array;
    private readonly encodeEvent: (value: unknown) => Uint8Array;
    private readonly cloneDraft: (value: unknown) => unknown;
    private readonly transform: ((rows: ValueTypeOf<ArrayType<Opaque>>, batch: Batch, revision: ValueTypeOf<OptionType<StringType>>) => Applied) | undefined;
    private readonly cloneBase: (value: Base) => Base;
    status: "idle" | "applying" | "unknown" | "reconciling" | "rejected" | "conflict" = "idle";
    issues: Issue[] = [];
    error: string | undefined;
    stale = false;
    /** Why the confirmation read last failed, while it is the error shown (#853). */
    private confirmReason: string | undefined;
    /**
     * The readiness last derived, and by which author checks (#859). It is
     * read on every render and every gesture, and derived only when something
     * it depends on moves: every mutation of `current` drops it, new checks (a
     * new binding's — new resident rows) miss it, and a key the checks read
     * moving replaces it through {@link SheetTransactions.recheck}.
     */
    private readinessCache: { ready: SheetTransactionBinding["ready"]; value: BatchReadiness } | undefined;

    constructor(binding: SheetTransactionBinding) {
        this.binding = binding;
        const entry = binding.entryType as Opaque;
        const draft = binding.draftType as Opaque;
        this.transform = binding.idField === undefined ? undefined : East.compile(applySheet(entry, binding.idField), []);
        this.draftEqual = equalFor(toEastTypeValue(OptionType(draft)));
        this.domainEqual = equalFor(toEastTypeValue(OptionType(entry)));
        this.draftDiff = diffFor(toEastTypeValue(OptionType(draft)));
        this.domainDiff = diffFor(toEastTypeValue(OptionType(entry)));
        this.encodeBatch = encodeBeast2For(toEastTypeValue(SheetChangeSetTypeFor(entry)));
        this.encodeEvent = encodeBeast2For(toEastTypeValue(SheetPatchEventTypeFor(entry, binding.children)));
        const encode = encodeBeast2For(toEastTypeValue(draft));
        const decode = decodeBeast2For(toEastTypeValue(draft));
        this.cloneDraft = value => value === undefined ? undefined : decode(encode(value));
        const baseType = SheetBaseTypeFor(entry);
        const encodeBase = encodeBeast2For(baseType);
        const decodeBase = decodeBeast2For(baseType);
        this.cloneBase = value => decodeBase(encodeBase(value));
    }

    /** Callback replacement affects future requests only. */
    bind(binding: SheetTransactionBinding): void {
        if (!stringEqual(binding.sourceId, this.binding.sourceId) || !schemaEqual(toEastTypeValue(binding.entryType), toEastTypeValue(this.binding.entryType)) || !schemaEqual(toEastTypeValue(binding.draftType), toEastTypeValue(this.binding.draftType))) throw new Error("A Sheet session cannot change its source or schema");
        this.binding = binding;
    }
    subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
    getSnapshot = (): number => this.serial;
    private changed(): void { this.serial++; for (const listener of this.listeners) listener(); }
    availabilityChanged(): void { this.changed(); }
    get locked(): boolean { return this.submission !== undefined; }
    get writable(): boolean { return this.binding.apply !== undefined && !this.locked && !this.stale && (this.binding.gate?.available() ?? true); }
    get canDiscard(): boolean { return !this.locked && (this.binding.gate?.available() ?? true); }
    get canUndo(): boolean { return this.writable && this.cursor > 0; }
    get canRedo(): boolean { return this.writable && this.cursor < this.history.length; }
    get pending(): number { return this.changes(this.baseline, this.current, true).length; }
    /** The batch's readiness — derived once per change of what it depends on (#859), however often it is read. */
    get readiness(): BatchReadiness {
        const ready = this.binding.ready;
        const cached = this.readinessCache;
        if (cached !== undefined && cached.ready === ready) return cached.value;
        const value = this.composeReadiness(ready?.(this.current));
        this.readinessCache = { ready, value };
        return value;
    }
    /**
     * The author's checks ran where their reads are tracked — the editing
     * hook's tracked read (#859) — over the current drafts: their result
     * becomes the readiness. A key they read moving re-runs that read, so an
     * author check over outside state (a `State`, a dataset) is followed
     * without a new Sheet value.
     *
     * @param ready - The checks that ran
     * @param author - What they returned for the current drafts
     */
    recheck(ready: SheetTransactionBinding["ready"], author: BatchReadiness | undefined): void {
        this.readinessCache = { ready, value: this.composeReadiness(author) };
    }
    /** Every draft's schema check, then the author's — issues gathered in a loop: a spread of a large batch's issues into a call throws RangeError (#859). */
    private composeReadiness(author: BatchReadiness | undefined): BatchReadiness {
        const issues: Issue[] = [];
        let invalid = false;
        for (const [id, entry] of this.current) {
            if (entry.draft === undefined) continue;
            const checked = normalizeDraft(this.binding.draftType, entry.draft, id).readiness;
            if (checked.type === "ready") continue;
            invalid ||= checked.type === "invalid";
            for (const issue of checked.value) issues.push(issue);
        }
        if (author !== undefined && author.type !== "ready") {
            invalid ||= author.type === "invalid";
            for (const issue of author.value) issues.push(issue);
        }
        return issues.length ? variant(invalid ? "invalid" : "incomplete", issues) : variant("ready", null);
    }
    /** The drafts changed: the next read derives the readiness afresh. */
    private draftsChanged(): void { this.readinessCache = undefined; }
    get canApply(): boolean { return this.writable && this.readiness.type === "ready" && this.status === "idle" && this.changes(this.baseline, this.current, false).length > 0; }
    get entries(): ReadonlyMap<string, EntryVersion> { return this.current; }
    get originals(): ReadonlyMap<string, EntryVersion> { return this.baseline; }

    /** Capture the exact base on the first gesture; never silently rebase drafts. */
    observeBase(base: Base): void {
        if (this.base === undefined) { this.base = this.cloneBase(base); return; }
        const type = SheetBaseTypeFor(this.binding.entryType as Opaque);
        if (equalFor(type)(this.base, base)) return;
        if (this.locked) return; // Only reconcile() may acknowledge a submitted request.
        if (this.pending === 0) {
            this.base = this.cloneBase(base);
            this.baseline.clear(); this.current.clear(); this.history = []; this.cursor = 0;
            this.draftsChanged();
        } else {
            if (this.stale) return;
            this.stale = true;
        }
        this.changed();
    }

    private clone(version: EntryVersion): EntryVersion {
        return { ...version, draft: this.cloneDraft(version.draft) };
    }
    private domain(id: string, entry: EntryVersion): unknown {
        return entry.draft === undefined ? undefined : normalizeDraft(this.binding.draftType, entry.draft, id).domain;
    }
    private changes(from: ReadonlyMap<string, EntryVersion>, to: ReadonlyMap<string, EntryVersion>, draft: boolean): Change[] {
        const changes: Change[] = [];
        const equal = draft ? this.draftEqual : this.domainEqual;
        const diff = draft ? this.draftDiff : this.domainDiff;
        for (const id of new Set([...from.keys(), ...to.keys()])) {
            const before = from.get(id) ?? ABSENT;
            const after = to.get(id) ?? ABSENT;
            const a = draft ? before.draft : this.domain(id, before);
            const b = draft ? after.draft : this.domain(id, after);
            const av = a === undefined ? none : some(a);
            const bv = b === undefined ? none : some(b);
            const place = b === undefined || placementEqual(before.place, after.place) ? none : after.place;
            if (equal(av, bv) && place.type === "none") continue;
            changes.push({ id, patch: diff(av, bv), place });
        }
        return changes;
    }
    private emit(before: Map<string, EntryVersion>, after: Map<string, EntryVersion>, origin: Origin, label: string): void {
        const draftChanges = this.changes(before, after, true);
        if (!draftChanges.length) return;
        const complete = [...before, ...after].every(([id, entry]) => entry.draft === undefined || this.domain(id, entry) !== undefined);
        const event = {
            transactionId: randomId(), origin: variant(origin, null), label, draftChanges,
            domainChanges: complete ? some(this.changes(before, after, false)) : none, readiness: this.readiness,
        };
        const callback = this.binding.patch;
        if (callback) {
            const bytes = this.encodeEvent(event);
            queueMicrotask(() => { try { callback(bytes); } catch (error) { console.error("[Sheet] onPatch failed", error); } });
        }
    }

    /** One call per planner gesture, irrespective of its cell or entry count. */
    record(updates: readonly EntryUpdate[], origin: Origin, label: string): boolean {
        if (!this.writable || this.base === undefined) return false;
        const before = new Map<string, EntryVersion>();
        const after = new Map<string, EntryVersion>();
        for (const update of updates) {
            if (after.has(update.id)) throw new Error("Compose an entry's cell writes before recording its gesture");
            const old = this.current.get(update.id) ?? this.clone(update.before);
            before.set(update.id, old);
            after.set(update.id, this.clone(update.after));
        }
        if (this.changes(before, after, true).length === 0) return false;
        for (const [id, entry] of before) if (!this.baseline.has(id)) this.baseline.set(id, entry);
        for (const [id, entry] of after) this.current.set(id, entry);
        this.draftsChanged();
        this.history.splice(this.cursor); this.history.push({ label, before, after }); this.cursor++;
        this.status = "idle"; this.issues = []; this.error = undefined;
        this.emit(before, after, origin, label);
        this.changed(); this.maybeAutoApply(origin !== "discard");
        return true;
    }
    undo(): void {
        if (!this.canUndo) return;
        const step = this.history[--this.cursor]!;
        for (const [id, entry] of step.before) this.current.set(id, entry);
        this.draftsChanged();
        this.status = "idle"; this.issues = []; this.error = undefined;
        this.emit(step.after, step.before, "undo", `Undo ${step.label}`);
        this.changed(); this.maybeAutoApply();
    }
    redo(): void {
        if (!this.canRedo) return;
        const step = this.history[this.cursor++]!;
        for (const [id, entry] of step.after) this.current.set(id, entry);
        this.draftsChanged();
        this.status = "idle"; this.issues = []; this.error = undefined;
        this.emit(step.before, step.after, "redo", `Redo ${step.label}`);
        this.changed(); this.maybeAutoApply();
    }
    discard(): void {
        if (!this.canDiscard) return;
        const before = this.current;
        this.current = new Map(this.baseline);
        this.draftsChanged();
        this.emit(before, this.current, "discard", "Discard changes");
        this.history = []; this.cursor = 0; this.stale = false;
        this.status = "idle"; this.issues = []; this.error = undefined;
        this.changed(); this.maybeAutoApply(false);
    }
    private maybeAutoApply(enabled = true): void {
        // A discard cancels queued automatic submissions as well as avoiding a
        // new one: removing an incomplete draft may make another edit ready.
        const sequence = ++this.autoSequence;
        if (enabled && this.binding.auto) queueMicrotask(() => {
            if (sequence === this.autoSequence && this.canApply) void this.apply();
        });
    }

    /** Retry keeps the original immutable bytes and captured callback. */
    async apply(): Promise<void> {
        if (this.status === "applying" || this.status === "reconciling") return;
        if (!this.submission) {
            if (!this.canApply || !this.base || !this.binding.apply) return;
            const batch: Batch = {
                requestId: randomId(), base: this.base,
                label: this.history[this.cursor - 1]?.label ?? "Apply changes",
                changes: this.changes(this.baseline, this.current, false),
            };
            if (!batch.changes.length) return;
            let expected: Uint8Array | undefined;
            if (this.base.type === "snapshot") {
                if (!this.transform) throw new Error("Inline Sheet editing requires its entry identity field");
                const result = this.transform(this.base.value, batch, none);
                if (result.type === "conflict") { this.status = "conflict"; this.issues = result.value; this.changed(); return; }
                expected = encodeBeast2For(ArrayType(this.binding.entryType as Opaque))(result.value);
            }
            const payload = this.encodeBatch(batch);
            this.binding.gate?.acquire();
            this.submission = { release: this.binding.gate?.release, expected, payload, apply: this.binding.apply, refresh: this.binding.refresh, after: new Map(this.current), affected: new Set(batch.changes.map(change => change.id)), base: this.cloneBase(this.base), revision: undefined };
        }
        const request = this.submission;
        this.status = "applying"; this.error = undefined; this.changed();
        let result: ApplyResult;
        try { result = await request.apply(request.payload.slice()); }
        catch (error) {
            this.status = "unknown"; this.error = error instanceof Error ? error.message : String(error); this.changed(); return;
        }
        if (result.type !== "applied") {
            this.submission = undefined; request.release?.(); this.status = result.type; this.issues = result.value; this.changed(); return;
        }
        if (request.base.type === "revision" && result.value.revision.type !== "some") {
            // The session's own text, canonical; the history bar words it (#861).
            this.status = "unknown"; this.error = SESSION_TEXT.noRevision; this.changed(); return;
        }
        request.revision = result.value.revision.type === "some" ? result.value.revision.value : undefined;
        this.status = "reconciling"; this.changed();
        this.refresh();
    }

    /** Retrying a failed refresh never calls onApply again. */
    refresh(): void {
        const request = this.submission;
        if (!request || this.status !== "reconciling" || !request.refresh) return;
        try { request.refresh(request.revision === undefined ? none : some(request.revision)); this.error = undefined; }
        catch (error) { this.error = error instanceof Error ? error.message : String(error); }
        this.changed();
    }

    /**
     * The confirmation read after an Apply could not read the source back
     * (#853): the session stays reconciling and the history bar says why —
     * its Retry refresh asks again, and a read that fails again says so
     * again. `undefined` once a read gets through, which clears the reason
     * (never a refresh's own error, which shows instead while it stands).
     *
     * @param reason - Why the read failed, or `undefined` when it got through
     */
    confirmFailed(reason: string | undefined): void {
        if (reason !== undefined && this.status !== "reconciling") return;
        const error = this.error === undefined || this.error === this.confirmReason ? reason : this.error;
        // Only a change is announced: the read runs again on every announcement.
        if (reason === this.confirmReason && error === this.error) return;
        this.error = error;
        this.confirmReason = reason;
        this.changed();
    }

    /**
     * Retire overlays only at the acknowledged revision, after affected entries
     * have been read. Inline callers supply the exact authoritative snapshot.
     * `matches` checks decoded domain values against each requested result.
     */
    reconcile(base: Base, matches: (id: string, domain: unknown) => boolean): boolean {
        const request = this.submission;
        if (!request || this.status !== "reconciling") return false;
        if (request.base.type === "revision" && (base.type !== "revision" || (request.revision === undefined || !stringEqual(base.value, request.revision)))) return false;
        if ([...request.affected].some(id => !matches(id, this.domain(id, request.after.get(id) ?? ABSENT)))) return false;
        if (request.expected !== undefined) {
            if (base.type !== "snapshot") return false;
            const actual = encodeBeast2For(ArrayType(this.binding.entryType as Opaque))(base.value);
            if (!blobEqual(actual, request.expected)) return false;
        }
        this.base = this.cloneBase(base); this.baseline = new Map(request.after);
        this.submission = undefined; request.release?.(); this.status = "idle"; this.error = undefined; this.confirmReason = undefined; this.issues = []; this.stale = false;
        this.changed(); return true;
    }
}
