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
 * bytes and callback until resolved. A Save's conflict at a revision base — a
 * source read a window at a time — names its entries once the session has read
 * them at the source's new revision (#1199), so no source reads itself whole to
 * say which moved.
 *
 * @packageDocumentation
 */
import { ArrayType, BlobType, ConflictError, DictType, East, EastTypeType, OptionType, StringType, StructType, applyFor, decodeBeast2For, diffFor, encodeBeast2For, equalFor, none, parseFor, some, toEastTypeValue, variant, type EastType, type ValueTypeOf, type option } from "@elaraai/east";
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

/** An entry a request changes: as its edit began, and as the request leaves it — `none` while it is absent. */
interface Target {
    before: option<unknown>;
    after: option<unknown>;
}

/**
 * A Save's conflict at a revision base, while the session names its entries
 * (#1199): a source read a window at a time cannot say which entries moved
 * without reading itself whole, so the session reads them, at the revision the
 * source moves to.
 */
interface Conflicted {
    /** The revision the request was drafted at: its entries are read at another. */
    readonly revision: string;
    /** Each entry the request changed: as its edit began, and as the request leaves it. */
    readonly targets: ReadonlyMap<string, Target>;
    /** The source's issues: the source's own (`entry` empty), and its words for each entry it may name. */
    readonly issues: readonly EditIssue[];
}

interface Submission<W> {
    payload: Uint8Array;
    apply: NonNullable<EditSessionBinding<W>["apply"]>;
    refresh: EditSessionBinding<W>["refresh"];
    after: Map<string, EntryVersion<W>>;
    /** Each entry the request changes. */
    targets: Map<string, Target>;
    base: Base;
    revision: string | undefined;
    /** A positional snapshot's whole collection as the request leaves it — its target, order included. */
    expected: Uint8Array | undefined;
    release: (() => void) | undefined;
}

const placementEqual = equalFor(OptionType(EditingPlacementType));
const stringEqual = equalFor(StringType);
const blobEqual = equalFor(BlobType);
const schemaEqual = equalFor(EastTypeType);
/** An entry the session holds no version of: absent, nowhere — one value for every projection. */
const ABSENT: EntryVersion<never> = { draft: undefined, wire: undefined, place: none };

/**
 * How a keyed source's entry is named (#880): a String key is its own id, any
 * other key its `.east` printing, read back here.
 *
 * @param keyType - The source's key type
 * @returns An id's key, or `undefined` for an id that names no key of the type
 */
export function keyReader(keyType: EastType): (id: string) => unknown {
    if (keyType.type === "String") return id => id;
    const parse = parseFor(toEastTypeValue(keyType));
    return (id) => {
        const read = parse(id);
        return read.success ? read.value : undefined;
    };
}

/** Opaque 128-bit IDs for cross-tab deduplication, including HTTP showcases.
 * getRandomValues is available outside secure contexts; randomUUID is not.
 */
function randomId(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** The entry an ordered placement is anchored on — `before` / `after` it — if any. */
function anchorOf(change: Change): string | undefined {
    if (change.place.type !== "some" || change.place.value.type !== "ordered") return undefined;
    const position = change.place.value.value;
    return position.type === "before" || position.type === "after" ? position.value : undefined;
}

/**
 * Changes in an order `Editing.apply` places them faithfully (#990): an entry
 * anchored on another change's entry comes after that change, so the anchor
 * already stands where the batch leaves it when the entry is placed beside it.
 * Placements stated against the drafted order then leave exactly that order,
 * whichever entry was touched first. Otherwise the order is kept.
 *
 * @param changes - The changes, in the order the session met their entries
 * @returns The same changes, anchors first
 */
function inPlacementOrder(changes: Change[]): Change[] {
    // Only a change that places its entry moves it: an anchor without one stays put.
    const placed = new Map<string, Change>();
    for (const change of changes) if (change.place.type === "some") placed.set(change.id, change);
    if (placed.size < 2) return changes;
    const out: Change[] = [];
    const done = new Set<string>();
    const visiting = new Set<string>();
    const visit = (change: Change): void => {
        // A cycle cannot be honoured whole — it keeps the order it came in.
        if (done.has(change.id) || visiting.has(change.id)) return;
        visiting.add(change.id);
        const anchor = anchorOf(change);
        const first = anchor !== undefined ? placed.get(anchor) : undefined;
        if (first !== undefined) visit(first);
        visiting.delete(change.id);
        done.add(change.id);
        out.push(change);
    };
    for (const change of changes) visit(change);
    return out;
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
    /** An entry's change applied to it: a value, or the `ConflictError` of one that does not hold what the change began from. */
    private readonly domainApply: (base: unknown, patch: Change["patch"]) => unknown;
    /** A keyed source's key by an entry's id; `undefined` for an Array source. */
    private readonly keyOf: ((id: string) => unknown) | undefined;
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
    /** A Save's conflict at a revision base whose entries the session has still to name (#1199). */
    private conflicted: Conflicted | undefined;
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
        this.domainApply = applyFor(toEastTypeValue(OptionType(entry)));
        this.keyOf = keyType === undefined ? undefined : keyReader(keyType);
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
    /**
     * How many transactions Undo can take back, and how many Redo can replay
     * (#1194): what a history over several sessions (`EditHistory`) keeps its
     * order of, and what tells it this session's own history went.
     */
    get depth(): { readonly undo: number; readonly redo: number } { return { undo: this.cursor, redo: this.history.length - this.cursor }; }
    /**
     * Forget the transactions Redo would replay (#1194): in a history over
     * several sessions, a gesture recorded in another took their place.
     */
    dropRedo(): void {
        if (this.cursor === this.history.length) return;
        this.history.splice(this.cursor);
        this.changed();
    }
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
     * The inline source with every draft applied — the collection Apply would
     * leave, by the same `Editing.apply` it runs (#990), so a collection that
     * draws its drafts from this draws exactly what Apply leaves, placements
     * included.
     *
     * @returns The drafted collection; `undefined` where the base is not an
     *   inline snapshot, a draft is not complete, or the batch would not apply
     */
    applied(): unknown {
        if (this.base?.type !== "snapshot" || this.transform === undefined) return undefined;
        for (const [id, entry] of this.current) {
            if (entry.draft !== undefined && this.domain(id, entry) === undefined) return undefined;
        }
        const changes = this.changes(this.baseline, this.current, false);
        if (changes.length === 0) return this.base.value;
        const result = this.transform(this.base.value, { requestId: "", base: this.base, label: "", changes }, none);
        return result.type === "applied" ? result.value : undefined;
    }

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
        return inPlacementOrder(changes);
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
        this.status = "idle"; this.issues = []; this.error = undefined; this.conflicted = undefined;
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
        this.status = "idle"; this.issues = []; this.error = undefined; this.conflicted = undefined;
        this.emit(step.after, step.before, "undo", `Undo ${step.label}`);
        this.changed(); this.maybeAutoApply();
    }
    /** Redo the next transaction. */
    redo(): void {
        if (!this.canRedo) return;
        const step = this.history[this.cursor++]!;
        for (const [id, entry] of step.after) this.current.set(id, entry);
        this.draftsChanged();
        this.status = "idle"; this.issues = []; this.error = undefined; this.conflicted = undefined;
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
        this.status = "idle"; this.issues = []; this.error = undefined; this.conflicted = undefined;
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
                // A positional source's target is its whole collection, its order
                // included; a keyed source's order is its keys', so its target is
                // the batch's own entries (#1185).
                if (this.keyOf === undefined) expected = this.encodeCollection(result.value);
            }
            const targets = new Map(batch.changes.map(change => [change.id, {
                before: this.optionOf(change.id, this.baseline.get(change.id)),
                after: this.optionOf(change.id, this.current.get(change.id)),
            }]));
            const payload = this.encodeBatch(batch);
            this.binding.gate?.acquire();
            this.submission = { release: this.binding.gate?.release, expected, payload, apply: this.binding.apply, refresh: this.binding.refresh, after: new Map(this.current), targets, base: this.cloneBase(this.base), revision: undefined };
        }
        const request = this.submission;
        this.status = "applying"; this.error = undefined; this.conflicted = undefined; this.changed();
        let result: ApplyResult;
        try { result = await request.apply(request.payload.slice()); }
        catch (error) {
            this.status = "unknown"; this.error = error instanceof Error ? error.message : String(error); this.changed(); return;
        }
        if (result.type !== "applied") {
            this.submission = undefined; request.release?.(); this.status = result.type; this.issues = result.value;
            // At a revision base the source names no entry it would have to
            // read itself whole for (#1199): the session reads them at the
            // revision the source moves to (`nameConflicts`), and says the
            // source's own words for itself meanwhile.
            if (result.type === "conflict" && request.base.type === "revision") {
                this.conflicted = { revision: request.base.value, targets: request.targets, issues: result.value };
                const own = result.value.filter((issue) => issue.entry === "");
                if (own.length > 0) this.issues = own;
            }
            this.changed(); return;
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
     * Retire the drafts once the source reads back as the acknowledged request
     * left it: an inline positional source's whole collection, its order
     * included; an inline keyed source's own entries, whatever another write
     * did to the others (#1185); a source that names its revisions, the
     * request's entries read at the revision it committed.
     *
     * An entry reads back as the request left it when the source holds it
     * otherwise than its edit began, with what the request set — the change,
     * undone, applies to it — so a field another write set beside the
     * request's is the source's. The session's versions of such an entry are
     * behind the source then: they go, with the history over them, as when the
     * source moves under no drafts.
     *
     * @param base - The base the source is at now
     * @param read - An entry the request changed, as a source at a revision holds it: its value, `none` for one it does not hold, or `undefined` while it is not read
     * @returns Whether the request was acknowledged
     */
    reconcile(base: Base, read: (id: string) => option<unknown> | undefined): boolean {
        const request = this.submission;
        if (!request || this.status !== "reconciling") return false;
        if (request.base.type === "revision" && (base.type !== "revision" || (request.revision === undefined || !stringEqual(base.value, request.revision)))) return false;
        if (request.base.type === "snapshot" && base.type !== "snapshot") return false;
        // Whether every entry reads back as the session's versions hold it.
        let exact = true;
        if (request.expected !== undefined) {
            if (!blobEqual(this.encodeCollection(base.value), request.expected)) return false;
        } else {
            for (const [id, target] of request.targets) {
                const now = base.type === "snapshot" ? this.heldIn(base.value, id) : read(id);
                if (now === undefined || !this.leftAs(now, target)) return false;
                exact &&= this.domainEqual(now, target.after);
            }
        }
        this.base = this.cloneBase(base); this.baseline = new Map(request.after);
        this.submission = undefined; request.release?.(); this.status = "idle"; this.error = undefined; this.confirmReason = undefined; this.issues = []; this.stale = false;
        this.conflicted = undefined;
        if (!exact) {
            this.baseline.clear(); this.current.clear(); this.history = []; this.cursor = 0;
            this.draftsChanged();
        }
        this.changed(); return true;
    }

    /**
     * A Save's conflict at a revision base whose entries the session has still
     * to name (#1199): the revision its request was drafted at, and the entries
     * it changed — what the session's source reads, at another revision, for
     * {@link EditSession.nameConflicts}. `undefined` otherwise.
     */
    get naming(): { readonly revision: string; readonly ids: readonly string[] } | undefined {
        const conflict = this.conflicted;
        return conflict === undefined || this.status !== "conflict" ? undefined : { revision: conflict.revision, ids: [...conflict.targets.keys()] };
    }

    /**
     * Name a Save's conflicting entries at a revision base (#1199). A source
     * read a window at a time answers a conflict without reading itself whole
     * — its own issue, and its words for each entry it may name — so once it
     * reads at a revision other than the one the request was drafted at, each
     * entry the request changed is read there, and every one its change no
     * longer applies to is named: a part the change began from no longer holds
     * (East's own patch apply, as the source checks a write by). Each is named
     * in the source's words for it, else the session's; the source's own issue
     * stays only when no entry is named.
     *
     * @param base - The base the source is at now
     * @param read - An entry the request changed, as the source holds it at that base: its value, `none` for one it does not hold, or `undefined` while it is not read
     * @returns Whether the conflict's entries were named
     */
    nameConflicts(base: Base, read: (id: string) => option<unknown> | undefined): boolean {
        const conflict = this.conflicted;
        if (conflict === undefined || this.status !== "conflict" || base.type !== "revision" || stringEqual(base.value, conflict.revision)) return false;
        const named: string[] = [];
        for (const [id, target] of conflict.targets) {
            const now = read(id);
            if (now === undefined) return false;
            if (!this.applies(now, target)) named.push(id);
        }
        this.conflicted = undefined;
        const said = new Map(conflict.issues.filter((issue) => issue.entry !== "").map((issue) => [issue.entry, issue] as const));
        const own = conflict.issues.filter((issue) => issue.entry === "");
        this.issues = named.length > 0
            ? named.map((id): EditIssue => said.get(id) ?? { entry: id, row: none, field: none, message: SESSION_TEXT.changed })
            : own.length > 0 ? own : [{ entry: "", row: none, field: none, message: SESSION_TEXT.sourceChanged }];
        this.changed();
        return true;
    }

    /** Whether a request's change of an entry still applies to the entry as the source holds it now. */
    private applies(now: option<unknown>, target: Target): boolean {
        try {
            this.domainApply(now, this.domainDiff(target.before, target.after));
            return true;
        } catch (error) {
            if (error instanceof ConflictError) return false;
            throw error;
        }
    }

    /** An entry's version as its domain value: `none` for one absent, or one never touched. */
    private optionOf(id: string, version: EntryVersion<W> | undefined): option<unknown> {
        const domain = version === undefined ? undefined : this.domain(id, version);
        return domain === undefined ? none : some(domain);
    }

    /** An entry of an inline keyed source's whole collection, by its id: `none` while the collection does not hold it. */
    private heldIn(collection: unknown, id: string): option<unknown> {
        const key = this.keyOf?.(id);
        const held = key === undefined ? undefined : (collection as ReadonlyMap<unknown, unknown>).get(key);
        return held === undefined ? none : some(held);
    }

    /**
     * Whether a source holds an entry as a request left it: a change of its
     * place alone, at once; otherwise once the source holds it otherwise than
     * its edit began, with what the request set — the change, undone, applies.
     *
     * @param now - The entry as the source holds it
     * @param target - The entry as its edit began, and as the request leaves it
     * @returns Whether it reads back as the request left it
     */
    private leftAs(now: option<unknown>, target: Target): boolean {
        if (this.domainEqual(target.before, target.after)) return true;
        if (this.domainEqual(now, target.before)) return false;
        try {
            this.domainApply(now, this.domainDiff(target.after, target.before));
            return true;
        } catch (error) {
            if (error instanceof ConflictError) return false;
            throw error;
        }
    }
}
