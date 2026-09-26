/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The editing session (#879) — gesture history, checked batch composition and
 * serial submission, for every editable collection. A collection hands it
 * fully decoded draft versions at gesture boundaries, each carrying the
 * collection's own projection of the entry (`W` — the Sheet's wire row), and
 * East diff composes the public patches. A pending request owns its frozen
 * bytes and callback until resolved.
 *
 * @packageDocumentation
 */
import { ArrayType, BlobType, DictType, East, EastTypeType, OptionType, StringType, StructType, decodeBeast2For, diffFor, encodeBeast2For, equalFor, none, some, toEastTypeValue, variant, type EastType, type ValueTypeOf } from "@elaraai/east";
import {
    applyEditing, EditingAppliedTypeFor, EditingApplyResultType, EditingBaseTypeFor, EditingChangeSetTypeFor,
    EditingChangeTypeFor, EditingPlacementType, EditingIssueType, EditingOriginType, EditingPatchEventTypeWith,
} from "@elaraai/east-ui/internal";
import { normalizeDraft, type BatchReadiness } from "./draft.js";
import { SESSION_TEXT } from "./messages.js";

// The runtime schemas remain exact. The TS algorithm treats domain payloads
// opaquely instead of infinitely expanding PatchTypeOf<EastType>; a keyed
// source's collections are Maps where an Array source's are arrays, so the
// algorithm reads its base and results through these widened types.
type Opaque = StructType<Record<never, never>>;
type Change = ValueTypeOf<ReturnType<typeof EditingChangeTypeFor<Opaque>>>;
type Base = ValueTypeOf<ReturnType<typeof EditingBaseTypeFor<Opaque>>> | ValueTypeOf<ReturnType<typeof EditingBaseTypeFor<Opaque, EastType>>>;
type Batch = Omit<ValueTypeOf<ReturnType<typeof EditingChangeSetTypeFor<Opaque>>>, "base"> & { base: Base };
type Applied = ValueTypeOf<ReturnType<typeof EditingAppliedTypeFor<Opaque>>> | ValueTypeOf<ReturnType<typeof EditingAppliedTypeFor<Opaque, EastType>>>;
type ApplyResult = ValueTypeOf<typeof EditingApplyResultType>;
/** An issue addressed to an entry. */
export type EditIssue = ValueTypeOf<typeof EditingIssueType>;
/** Where an entry stands, if anywhere. */
export type Placement = ValueTypeOf<OptionType<typeof EditingPlacementType>>;
/** The gesture that made a transaction. */
export type Origin = ValueTypeOf<typeof EditingOriginType>["type"];

/**
 * One complete local entry state; an `undefined` draft means the entry is
 * absent.
 *
 * @typeParam W - The collection's projection of an entry
 */
export interface EntryVersion<W> {
    /** The draft. */
    draft: unknown;
    /** The collection's projection of it. */
    wire: W | undefined;
    /** Actual position of this version, retained for inverse moves. */
    place: Placement;
}

/**
 * A gesture may update several entries, but each entry appears only once.
 *
 * @typeParam W - The collection's projection of an entry
 */
export interface EntryUpdate<W> {
    /** The entry. */
    id: string;
    /** Its version before the gesture. */
    before: EntryVersion<W>;
    /** Its version after it. */
    after: EntryVersion<W>;
}

interface History<W> {
    label: string;
    before: Map<string, EntryVersion<W>>;
    after: Map<string, EntryVersion<W>>;
}

/**
 * What a session is bound to: its source and schemas, and the callbacks the
 * next request uses.
 *
 * @typeParam W - The collection's projection of an entry
 */
export interface EditSessionBinding<W> {
    /** The source's identity. */
    sourceId: string;
    /** The entry schema. */
    entryType: EastType;
    /** The entry's draft schema. */
    draftType: EastType;
    /** A group entry's child field. */
    children?: string | undefined;
    /** An Array source's identity field. */
    idField?: string | undefined;
    /**
     * A keyed source's key type (#880): its batches are `ChangeSet(E, K)`, and
     * an inline snapshot base is the source's `Dict<K, E>`, applied by key.
     */
    keyType?: EastType | undefined;
    /** The authoritative apply, over the batch's bytes. */
    apply: ((payload: Uint8Array) => ApplyResult | Promise<ApplyResult>) | undefined;
    /** The patch observer, over the event's bytes. */
    patch: ((payload: Uint8Array) => unknown) | undefined;
    /** Installs the revision an apply committed. */
    refresh: ((revision: ValueTypeOf<OptionType<StringType>>) => unknown) | undefined;
    /** Apply a ready batch as soon as it is ready. */
    auto: boolean;
    /** Additional domain requirements over the current draft collection. */
    ready?: ((entries: ReadonlyMap<string, EntryVersion<W>>) => BatchReadiness) | undefined;
    /** One unresolved request across every view bound to this source. */
    gate?: { available: () => boolean; acquire: () => void; release: () => void } | undefined;
}

interface Submission<W> {
    payload: Uint8Array;
    apply: NonNullable<EditSessionBinding<W>["apply"]>;
    refresh: EditSessionBinding<W>["refresh"];
    after: Map<string, EntryVersion<W>>;
    affected: Set<string>;
    base: Base;
    revision: string | undefined;
    expected: Uint8Array | undefined;
    release: (() => void) | undefined;
}

const placementEqual = equalFor(OptionType(EditingPlacementType));
const stringEqual = equalFor(StringType);
const blobEqual = equalFor(BlobType);
const schemaEqual = equalFor(EastTypeType);
/** An entry the session holds no version of: absent, nowhere — one value for every projection. */
const ABSENT: EntryVersion<never> = { draft: undefined, wire: undefined, place: none };

/** Opaque 128-bit IDs for cross-tab deduplication, including HTTP showcases.
 * getRandomValues is available outside secure contexts; randomUUID is not.
 */
function randomId(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * One source-bound editing session. The collection supplies fully decoded
 * draft versions at gesture boundaries; East diff composes the public
 * patches. A pending request owns its frozen bytes and callback until
 * resolved.
 *
 * @typeParam W - The collection's projection of an entry
 */
export class EditSession<W> {
    private binding: EditSessionBinding<W>;
    private baseline = new Map<string, EntryVersion<W>>();
    private current = new Map<string, EntryVersion<W>>();
    private history: History<W>[] = [];
    private cursor = 0;
    private base: Base | undefined;
    private submission: Submission<W> | undefined;
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
    private readonly transform: ((collection: unknown, batch: Batch, revision: ValueTypeOf<OptionType<StringType>>) => Applied) | undefined;
    private readonly cloneBase: (value: Base) => Base;
    private readonly baseEqual: (a: Base, b: Base) => boolean;
    /** The source's whole collection, encoded — what an inline request's target is compared by. */
    private readonly encodeCollection: (value: unknown) => Uint8Array;
    /** Where the latest request stands. */
    status: "idle" | "applying" | "unknown" | "reconciling" | "rejected" | "conflict" = "idle";
    /** The source's issues with the latest request. */
    issues: EditIssue[] = [];
    /** The latest error — the session's own (canonical), a host's or a source's. */
    error: string | undefined;
    /** The source moved under pending drafts. */
    stale = false;
    /** Why the confirmation read last failed, while it is the error shown (#853). */
    private confirmReason: string | undefined;
    /**
     * The readiness last derived, and by which author checks (#859). It is
     * read on every render and every gesture, and derived only when something
     * it depends on moves: every mutation of `current` drops it, new checks (a
     * new binding's — new resident rows) miss it, and a key the checks read
     * moving replaces it through {@link EditSession.recheck}.
     */
    private readinessCache: { ready: EditSessionBinding<W>["ready"]; value: BatchReadiness } | undefined;

    /**
     * @param binding - The source, its schemas and the first callbacks
     */
    constructor(binding: EditSessionBinding<W>) {
        this.binding = binding;
        const entry = binding.entryType as Opaque;
        const draft = binding.draftType as Opaque;
        const keyType = binding.keyType;
        // A keyed source is applied by key (#880); an Array source by its identity field.
        this.transform = keyType !== undefined
            ? East.compile(applyEditing(DictType(keyType, entry)), []) as unknown as EditSession<W>["transform"]
            : binding.idField === undefined ? undefined : East.compile(applyEditing(entry, binding.idField), []) as unknown as EditSession<W>["transform"];
        this.draftEqual = equalFor(toEastTypeValue(OptionType(draft)));
        this.domainEqual = equalFor(toEastTypeValue(OptionType(entry)));
        this.draftDiff = diffFor(toEastTypeValue(OptionType(draft)));
        this.domainDiff = diffFor(toEastTypeValue(OptionType(entry)));
        this.encodeBatch = encodeBeast2For(toEastTypeValue(EditingChangeSetTypeFor(entry, keyType)));
        // Events carry the collection's own drafts — field by field for the
        // Sheet, whole entries for the Plan — at the exact type its wire names.
        this.encodeEvent = encodeBeast2For(toEastTypeValue(EditingPatchEventTypeWith(entry, draft)));
        const encode = encodeBeast2For(toEastTypeValue(draft));
        const decode = decodeBeast2For(toEastTypeValue(draft));
        this.cloneDraft = value => value === undefined ? undefined : decode(encode(value));
        const baseType = EditingBaseTypeFor(entry, keyType);
        const encodeBase = encodeBeast2For(baseType) as (value: Base) => Uint8Array;
        const decodeBase = decodeBeast2For(baseType) as (bytes: Uint8Array) => Base;
        this.cloneBase = value => decodeBase(encodeBase(value));
        this.baseEqual = equalFor(baseType) as (a: Base, b: Base) => boolean;
        this.encodeCollection = encodeBeast2For(keyType !== undefined ? DictType(keyType, entry) : ArrayType(entry)) as (value: unknown) => Uint8Array;
    }

    /**
     * Rebind the callbacks; a replacement affects future requests only.
     *
     * @param binding - The source (unchanged), its schemas (unchanged) and the new callbacks
     * @throws {Error} When the source or a schema changes
     */
    bind(binding: EditSessionBinding<W>): void {
        const keysEqual = binding.keyType === undefined || this.binding.keyType === undefined
            ? binding.keyType === this.binding.keyType
            : schemaEqual(toEastTypeValue(binding.keyType), toEastTypeValue(this.binding.keyType));
        if (!stringEqual(binding.sourceId, this.binding.sourceId) || !schemaEqual(toEastTypeValue(binding.entryType), toEastTypeValue(this.binding.entryType)) || !schemaEqual(toEastTypeValue(binding.draftType), toEastTypeValue(this.binding.draftType)) || !keysEqual) throw new Error("An editing session cannot change its source or schema");
        this.binding = binding;
    }
    /** Subscribe to every change (`useSyncExternalStore`). */
    subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
    /** The change counter (`useSyncExternalStore`). */
    getSnapshot = (): number => this.serial;
    private changed(): void { this.serial++; for (const listener of this.listeners) listener(); }
    /** Another view of the source took or released the source's one request. */
    availabilityChanged(): void { this.changed(); }
    /** A request is unresolved. */
    get locked(): boolean { return this.submission !== undefined; }
    /** A gesture may be recorded now. */
    get writable(): boolean { return this.binding.apply !== undefined && !this.locked && !this.stale && (this.binding.gate?.available() ?? true); }
    /** The drafts may be discarded now. */
    get canDiscard(): boolean { return !this.locked && (this.binding.gate?.available() ?? true); }
    /** Undo is available. */
    get canUndo(): boolean { return this.writable && this.cursor > 0; }
    /** Redo is available. */
    get canRedo(): boolean { return this.writable && this.cursor < this.history.length; }
    /** How many entries' drafts differ from their originals. */
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
     * without a new collection value.
     *
     * @param ready - The checks that ran
     * @param author - What they returned for the current drafts
     */
    recheck(ready: EditSessionBinding<W>["ready"], author: BatchReadiness | undefined): void {
        this.readinessCache = { ready, value: this.composeReadiness(author) };
    }
    /** Every draft's schema check, then the author's — issues gathered in a loop: a spread of a large batch's issues into a call throws RangeError (#859). */
    private composeReadiness(author: BatchReadiness | undefined): BatchReadiness {
        const issues: EditIssue[] = [];
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
    /** Apply is available. */
    get canApply(): boolean { return this.writable && this.readiness.type === "ready" && this.status === "idle" && this.changes(this.baseline, this.current, false).length > 0; }
    /** Every entry the session holds a version of, as it stands. */
    get entries(): ReadonlyMap<string, EntryVersion<W>> { return this.current; }
    /** The same entries as the source last acknowledged them. */
    get originals(): ReadonlyMap<string, EntryVersion<W>> { return this.baseline; }

    /**
     * Capture the exact base on the first gesture; never silently rebase drafts.
     *
     * @param base - The base the source is at now
     */
    observeBase(base: Base): void {
        if (this.base === undefined) { this.base = this.cloneBase(base); return; }
        if (this.baseEqual(this.base, base)) return;
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

    private clone(version: EntryVersion<W>): EntryVersion<W> {
        return { ...version, draft: this.cloneDraft(version.draft) };
    }
    private domain(id: string, entry: EntryVersion<W>): unknown {
        return entry.draft === undefined ? undefined : normalizeDraft(this.binding.draftType, entry.draft, id).domain;
    }
    private changes(from: ReadonlyMap<string, EntryVersion<W>>, to: ReadonlyMap<string, EntryVersion<W>>, draft: boolean): Change[] {
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
    private emit(before: Map<string, EntryVersion<W>>, after: Map<string, EntryVersion<W>>, origin: Origin, label: string): void {
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
            queueMicrotask(() => { try { callback(bytes); } catch (error) { console.error("[Editing] onPatch failed", error); } });
        }
    }

    /**
     * Record one gesture — one call per gesture, irrespective of its cell or
     * entry count — as one undoable transaction.
     *
     * @param updates - Each entry the gesture changed, once
     * @param origin - The gesture
     * @param label - Its label in the history
     * @returns Whether anything changed
     * @throws {Error} When an entry appears twice
     */
    record(updates: readonly EntryUpdate<W>[], origin: Origin, label: string): boolean {
        if (!this.writable || this.base === undefined) return false;
        const before = new Map<string, EntryVersion<W>>();
        const after = new Map<string, EntryVersion<W>>();
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
    /** Undo the last transaction. */
    undo(): void {
        if (!this.canUndo) return;
        const step = this.history[--this.cursor]!;
        for (const [id, entry] of step.before) this.current.set(id, entry);
        this.draftsChanged();
        this.status = "idle"; this.issues = []; this.error = undefined;
        this.emit(step.after, step.before, "undo", `Undo ${step.label}`);
        this.changed(); this.maybeAutoApply();
    }
    /** Redo the next transaction. */
    redo(): void {
        if (!this.canRedo) return;
        const step = this.history[this.cursor++]!;
        for (const [id, entry] of step.after) this.current.set(id, entry);
        this.draftsChanged();
        this.status = "idle"; this.issues = []; this.error = undefined;
        this.emit(step.before, step.after, "redo", `Redo ${step.label}`);
        this.changed(); this.maybeAutoApply();
    }
    /** Discard every draft, and the history with them. */
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

    /** Apply the batch; a retry keeps the original immutable bytes and captured callback. */
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
                if (!this.transform) throw new Error("Inline editing requires its entry identity field or its key type");
                const result = this.transform(this.base.value, batch, none);
                if (result.type === "conflict") { this.status = "conflict"; this.issues = result.value; this.changed(); return; }
                expected = this.encodeCollection(result.value);
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

    /** Ask the source for the committed revision again; a retry never calls onApply again. */
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
     *
     * @param base - The base the source is at now
     * @param matches - Whether an entry reads back as the request left it
     * @returns Whether the request was acknowledged
     */
    reconcile(base: Base, matches: (id: string, domain: unknown) => boolean): boolean {
        const request = this.submission;
        if (!request || this.status !== "reconciling") return false;
        if (request.base.type === "revision" && (base.type !== "revision" || (request.revision === undefined || !stringEqual(base.value, request.revision)))) return false;
        if ([...request.affected].some(id => !matches(id, this.domain(id, request.after.get(id) ?? ABSENT)))) return false;
        if (request.expected !== undefined) {
            if (base.type !== "snapshot") return false;
            const actual = this.encodeCollection(base.value);
            if (!blobEqual(actual, request.expected)) return false;
        }
        this.base = this.cloneBase(base); this.baseline = new Map(request.after);
        this.submission = undefined; request.release?.(); this.status = "idle"; this.error = undefined; this.confirmReason = undefined; this.issues = []; this.stale = false;
        this.changed(); return true;
    }
}
