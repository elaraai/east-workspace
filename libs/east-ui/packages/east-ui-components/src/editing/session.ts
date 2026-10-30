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
 * A source moving under the drafts carries them over to it (merge.ts): each
 * drafted entry is read at the new base and merged three ways — what both began
 * from, the draft, and the source's new value. What combines is carried over at
 * once; a part both changed to different values is a conflict, the draft's value
 * standing there until someone settles it, and Save waits until none is left.
 * Settling one — the draft's value, or the source's — is a step of the history,
 * which Undo takes back.
 *
 * @packageDocumentation
 */
import { ArrayType, BlobType, ConflictError, DictType, East, EastTypeType, OptionType, StringType, StructType, applyFor, decodeBeast2For, diffFor, encodeBeast2For, equalFor, none, parseFor, some, toEastTypeValue, variant, type EastType, type PatchPath, type ValueTypeOf, type option } from "@elaraai/east";
import {
    applyEditing, EditingAppliedTypeFor, EditingApplyResultType, EditingBaseTypeFor, EditingChangeSetTypeFor,
    EditingChangeTypeFor, EditingPlacementType, EditingIssueType, EditingOriginType, EditingPatchEventTypeWith,
} from "@elaraai/east-ui/internal";
import { liftDraft, normalizeDraft, type BatchReadiness } from "./draft.js";
import { EntryMerger, type ConflictPoint } from "./merge.js";
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

/**
 * An entry drafted away from its original (#1437): both versions as the
 * session holds them — the same objects until a gesture, an Undo, a Redo, a
 * Discard or a confirmed Save replaces one — and each as the source holds an
 * entry.
 *
 * @typeParam W - The collection's projection of an entry
 */
export interface DraftedEntry<W> {
    /** The entry's id. */
    readonly id: string;
    /** A keyed source's key, read from the id; `undefined` for an Array source's entry. */
    readonly key: unknown;
    /** The entry as the source held it when its first change was drafted. */
    readonly original: EntryVersion<W>;
    /** The entry as drafted. */
    readonly draft: EntryVersion<W>;
    /** The original as the source holds an entry: `none` where it was absent. */
    readonly before: option<unknown>;
    /** The draft as the Save would leave the entry: `none` where the draft removes it. */
    readonly after: option<unknown>;
}

/**
 * A session's drafts, as a preview of its Save reads them (#1437).
 *
 * @typeParam W - The collection's projection of an entry
 */
export interface SessionDrafts<W> {
    /**
     * The source's revision the drafts began from, where the source names its
     * revisions; `undefined` for an inline source, and before a first gesture.
     */
    readonly revision: string | undefined;
    /**
     * Each entry drafted away from its original, by its id. A draft not yet
     * complete is no change a Save sends, so it is none of them.
     */
    readonly entries: ReadonlyMap<string, DraftedEntry<W>>;
}

/**
 * An entry whose draft conflicts with its source's newer value: the three
 * values, each as a draft — what both began from, the draft, and the
 * source's — and each conflict (merge.ts).
 */
export interface EntryConflicts {
    /** The entry's id. */
    readonly id: string;
    /** A keyed source's key, read from the id; `undefined` for an Array source's entry. */
    readonly key: unknown;
    /** What both began from: the source's value, rewound at each conflict. */
    readonly was: option<unknown>;
    /** The draft. */
    readonly draft: option<unknown>;
    /** The source's value. */
    readonly source: option<unknown>;
    /** Each conflict. */
    readonly points: readonly ConflictPoint[];
    /**
     * What the source said of the entry when it refused a Save for a
     * conflict, the drafts then carried over — who changed it last, where the
     * source says (#1199); `undefined` where no refused Save named it.
     */
    readonly said: string | undefined;
}

/** How a conflict is settled: the draft's value kept, or the source's taken. */
export type ConflictChoice = "draft" | "source";

/**
 * A drafted entry as a reload keeps it (keep.ts): what both began from, the
 * draft, the collection's projection of each, and where each stands — what
 * the session needs to carry the draft over to the source as a reload finds
 * it ({@link EditSession.restore}).
 *
 * @typeParam W - The collection's projection of an entry
 */
export interface KeptEntry<W> {
    /** The entry's id. */
    readonly id: string;
    /**
     * What both began from: the source's value as the edit began — or as a
     * carried-over conflict rewound it — as a draft; `none` for an entry new
     * to the source.
     */
    readonly was: option<unknown>;
    /** The draft; `none` for an entry the draft removes. */
    readonly draft: option<unknown>;
    /** The collection's projection of the draft. */
    readonly wire: W | undefined;
    /** Its projection of what both began from. */
    readonly beforeWire: W | undefined;
    /** Where the draft stands. */
    readonly place: Placement;
    /** Where the entry stood as its edit began. */
    readonly beforePlace: Placement;
}

/**
 * A conflict settled since the drafts were last carried over, until Save:
 * how, and what each side held, so it reads back as settled and can be
 * settled the other way.
 */
export interface SettledConflict {
    /** The entry's id. */
    readonly id: string;
    /** A keyed source's key, read from the id; `undefined` for an Array source's entry. */
    readonly key: unknown;
    /** The conflict, as it read before it was settled. */
    readonly point: ConflictPoint;
    /** How it is settled now. */
    readonly choice: ConflictChoice;
    /** The draft as it stood before it was first settled: what settling it for the draft's value restores. */
    readonly draft: option<unknown>;
    /** The source's value. */
    readonly source: option<unknown>;
    /** What both began from, before it was first settled. */
    readonly was: option<unknown>;
    /** What the source said of the entry when it refused a Save for a conflict ({@link EntryConflicts.said}). */
    readonly said: string | undefined;
}

interface History<W> {
    label: string;
    /** The gesture that made the transaction (#1409): what a host that replays a step by its origin reads. */
    origin: Origin;
    before: Map<string, EntryVersion<W>>;
    after: Map<string, EntryVersion<W>>;
    /** What both began from, for each entry a settling moved it for: before and after the step, `undefined` for none. */
    ancestors?: { readonly before: ReadonlyMap<string, option<unknown> | undefined>; readonly after: ReadonlyMap<string, option<unknown> | undefined> } | undefined;
    /** The conflicts a settling settled, by entry and path: before and after the step, `undefined` for none. */
    settled?: { readonly before: ReadonlyMap<string, SettledConflict | undefined>; readonly after: ReadonlyMap<string, SettledConflict | undefined> } | undefined;
}

/** A settled conflict's key: its entry and its path. */
const settledKey = (id: string, path: string): string => `${id}\u0000${path}`;

/**
 * Rows of the entries a request changes as the source holds them at one
 * revision, each its entry's beast2 bytes: what the request began from, at its
 * base, and what its confirmation read back exactly as the request left it, at
 * the revision it committed. A Save's view confirmation checks their
 * membership by these rows, never reading them again.
 */
export interface HeldRows {
    /** The revision the source holds them at. */
    readonly revision: string;
    /** Each entry's row, by its id; an entry absent there is not among them. */
    readonly rows: ReadonlyMap<string, Uint8Array>;
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
    /** Prepare view-specific confirmation, before submitting any mutation: given each entry
     * the request changes and, over a source that names its revisions, the rows they began
     * from at the request's base. The returned observer runs once after the primary entries
     * confirm, given the rows the confirmation read back exactly, at the revision committed.
     * Preparation failures leave the drafts editable and the Save unsent. */
    prepare?: ((targets: ReadonlyMap<string, Target>, began: HeldRows | undefined) => Promise<(confirmed: HeldRows | undefined) => void>) | undefined;
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
    /**
     * Whether the drafts are carried over to a base the source moves to (the
     * default), or go out of date instead (`false`): for a source whose
     * entries' identities do not survive its being read again — a query's
     * steps, parsed afresh — where a draft could not be paired with what it
     * changed.
     */
    carryOver?: boolean | undefined;
    /**
     * The collection's projection of a draft the session made itself — one
     * carried over to a newer base, or settled — where it draws drafts from
     * their projection (the Sheet's rows). `undefined` keeps the projection
     * the entry had.
     */
    wireOf?: ((id: string, draft: unknown, prior: W | undefined) => W | undefined) | undefined;
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
    /** Membership facts at one immutable revision, independent of page eviction. */
    checked?: { revision: string; matches: Map<string, boolean> };
}

interface Submission<W> {
    prepare: EditSessionBinding<W>["prepare"];
    confirmed?: ((confirmed: HeldRows | undefined) => void) | undefined;
    payload: Uint8Array;
    apply: NonNullable<EditSessionBinding<W>["apply"]>;
    refresh: EditSessionBinding<W>["refresh"];
    after: Map<string, EntryVersion<W>>;
    /** Each entry the request changes. */
    targets: Map<string, Target>;
    /** Confirmed identities and whether their saved value is exact; no source rows. */
    checked: Map<string, boolean>;
    base: Base;
    revision: string | undefined;
    /** A positional snapshot's whole collection as the request leaves it — its target, order included. */
    expected: Uint8Array | undefined;
    release: (() => void) | undefined;
}

const placementEqual = equalFor(OptionType(EditingPlacementType));
/**
 * How many times in a row a Save the source refused because another write got
 * there first is sent again by the session itself, once its drafts carry over
 * with nothing to choose: past it, the person's Save sends it.
 */
const RESENDS = 3;
const stringEqual = equalFor(StringType);
const blobEqual = equalFor(BlobType);
const schemaEqual = equalFor(EastTypeType);
/** An entry the session holds no version of: absent, nowhere — one value for every projection. */
const ABSENT: EntryVersion<never> = { draft: undefined, wire: undefined, place: none };

/** A version's draft, as the merge reads it: `none` for an entry absent. */
function draftOf(version: EntryVersion<unknown> | undefined): option<unknown> {
    return version === undefined || version.draft === undefined ? none : some(version.draft);
}

/**
 * A conflict's place, as an issue's: its entry, the group's child row it is
 * in, and the field it is in — the first of its steps there.
 *
 * @param id - The entry
 * @param at - The conflict's steps from the entry
 * @param children - A group entry's child field
 * @returns The issue, saying the entry's part changed both ways
 */
function issueAt(id: string, at: PatchPath, children: string | undefined): EditIssue {
    const [first, second] = at;
    const inRow = children !== undefined && first?.kind === "field" && stringEqual(first.name, children) && second?.kind === "index";
    const row: option<bigint> = inRow ? some(second.index) : none;
    const step = at[inRow ? 2 : 0];
    return { entry: id, row, field: step?.kind === "field" ? some(step.name) : none, message: SESSION_TEXT.conflict };
}

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
    /** An entry, encoded — the rows a request's view confirmation is handed. */
    private readonly encodeEntry: (value: unknown) => Uint8Array;
    /** Where the latest request stands. */
    status: "idle" | "applying" | "unknown" | "reconciling" | "rejected" | "conflict" = "idle";
    /** The source's issues with the latest request. */
    issues: EditIssue[] = [];
    /** The latest error — the session's own (canonical), a host's or a source's. */
    error: string | undefined;
    /**
     * Out of date: the source moved under pending drafts a session that does
     * not carry its drafts over holds (`carryOver: false`) — Save off, and the
     * drafts discarded to begin again from the source.
     */
    stale = false;
    /** What both began from, for each entry whose draft conflicts with its source's newer value (merge.ts). */
    private ancestors = new Map<string, option<unknown>>();
    /** Drafts being carried over to a newer base: the base, and each drafted entry as read there. */
    private moving: { readonly base: Base; readonly read: Map<string, option<unknown>> } | undefined;
    /** Drafts a reload kept, waiting for the session's first base ({@link EditSession.restore}). */
    private restoring: readonly KeptEntry<W>[] | undefined;
    private readonly merger: EntryMerger;
    /** Each conflict settled since the drafts were last carried over, by entry and path. */
    private settledPoints = new Map<string, SettledConflict>();
    /** Each conflict's issue, by entry and path ({@link EditSession.conflictIssue}). */
    private readonly conflictIssues = new Map<string, EditIssue>();
    /** What the source said of each entry a Save it refused for a conflict named, kept for the conflicts carried over from it. */
    private said = new Map<string, string>();
    /** A Save the source refused because another write got there first, to send again once its drafts carry over with nothing to choose. */
    private again = false;
    /** How many times in a row the session has sent a Save again itself, since the person's last ({@link RESENDS}). */
    private resent = 0;
    /** The conflicts as last read, at the session's version: the same object while it does not move. */
    private conflictsCache: { readonly serial: number; readonly value: ReadonlyMap<string, EntryConflicts> } | undefined;
    /** A Save's conflict at a revision base whose entries the session has still to name (#1199). */
    private conflicted: Conflicted | undefined;
    /** Why the confirmation read last failed, while it is the error shown (#853). */
    private confirmReason: string | undefined;
    /** Each drafted entry's view, by its original and its draft: the same object while both hold (#1437). */
    private draftedViews = new WeakMap<EntryVersion<W>, WeakMap<EntryVersion<W>, DraftedEntry<W>>>();
    /** The drafts as last read, at the session's version and base: the same object while neither moves (#1437). */
    private draftsCache: { readonly serial: number; readonly base: Base | undefined; readonly value: SessionDrafts<W> } | undefined;
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
        this.encodeEntry = encodeBeast2For(entry) as (value: unknown) => Uint8Array;
        this.merger = new EntryMerger(binding.draftType);
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
    get writable(): boolean { return this.binding.apply !== undefined && !this.locked && !this.stale && this.moving === undefined && (this.binding.gate?.available() ?? true); }
    /** The drafts are being carried over to the base the source moved to: each drafted entry is still being read there. */
    get carrying(): boolean { return this.moving !== undefined; }
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
     * The transaction Redo would replay next (#1409): its origin and its
     * label — what a host that lands a step again by its origin reads, as a
     * run of the app's optimiser is replayed without its banner.
     */
    get nextRedo(): { readonly origin: Origin; readonly label: string } | undefined {
        const step = this.history[this.cursor];
        return step === undefined ? undefined : { origin: step.origin, label: step.label };
    }
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
    get canApply(): boolean { return this.writable && this.unsettled === 0 && this.readiness.type === "ready" && this.status === "idle" && this.changes(this.baseline, this.current, false).length > 0; }

    /**
     * Each entry whose draft conflicts with its source's newer value, and its
     * conflicts — read from the three values, the same object while the
     * session does not move.
     */
    get conflicts(): ReadonlyMap<string, EntryConflicts> {
        const cached = this.conflictsCache;
        if (cached !== undefined && cached.serial === this.serial) return cached.value;
        const value = new Map<string, EntryConflicts>();
        for (const [id, was] of this.ancestors) {
            const draft = draftOf(this.current.get(id));
            const source = draftOf(this.baseline.get(id));
            const points = this.merger.conflicts(was, draft, source);
            if (points.length > 0) value.set(id, { id, key: this.keyOf?.(id), was, draft, source, points, said: this.said.get(id) });
        }
        this.conflictsCache = { serial: this.serial, value };
        return value;
    }

    /**
     * Each conflict settled since the drafts were last carried over, until
     * Save: how, and both sides' values — each can be settled the other way.
     */
    get settled(): readonly SettledConflict[] { return [...this.settledPoints.values()]; }

    /** How many conflicts are still to settle: Save waits until none is. */
    get unsettled(): number {
        let n = 0;
        for (const entry of this.conflicts.values()) n += entry.points.length;
        return n;
    }
    /** Every entry the session holds a version of, as it stands. */
    get entries(): ReadonlyMap<string, EntryVersion<W>> { return this.current; }
    /** The same entries as the source last acknowledged them. */
    get originals(): ReadonlyMap<string, EntryVersion<W>> { return this.baseline; }
    /** The source's entry schema. */
    get entryType(): EastType { return this.binding.entryType; }
    /** A keyed source's key type; `undefined` for an Array source. */
    get keyType(): EastType | undefined { return this.binding.keyType; }
    /** The entry's draft schema: what a conflict's values are read with. */
    get draftType(): EastType { return this.binding.draftType; }

    /**
     * The drafts as a reload keeps them (keep.ts): each entry drafted away
     * from what it began as, with what both began from — its original, or
     * what a carried-over conflict rewound it to. An entry back as it began —
     * undone, or discarded — is no draft to keep.
     */
    get keptEntries(): readonly KeptEntry<W>[] {
        const out: KeptEntry<W>[] = [];
        for (const [id, version] of this.current) {
            const original = this.baseline.get(id) ?? ABSENT;
            const was = this.ancestors.get(id) ?? draftOf(original);
            const draft = draftOf(version);
            if (Object.is(version, original) || (this.draftEqual(draft, was) && placementEqual(version.place, original.place))) continue;
            out.push({ id, was, draft, wire: version.wire, beforeWire: original.wire, place: version.place, beforePlace: original.place });
        }
        return out;
    }

    /**
     * Restore drafts a reload kept (keep.ts), before the session's first base:
     * once the source's base is observed, they are carried over to the
     * entries the source holds there, as drafts are when it moves
     * ({@link EditSession.merge}) — each combined with what changed since,
     * a part both changed a conflict to choose, and a draft the source holds
     * already (a Save that landed before the reload) no draft any more. The
     * history starts at them.
     *
     * @param entries - The kept drafts
     * @returns Whether they will be restored: `false` once the session has a base
     */
    restore(entries: readonly KeptEntry<W>[]): boolean {
        if (this.base !== undefined) return false;
        this.restoring = entries;
        return true;
    }

    /** Kept drafts, put back at the session's first base and carried over to it. */
    private restoreAt(base: Base, entries: readonly KeptEntry<W>[]): void {
        for (const entry of entries) {
            this.baseline.set(entry.id, entry.was.type === "some" ? { draft: entry.was.value, wire: entry.beforeWire, place: entry.beforePlace } : ABSENT);
            this.current.set(entry.id, entry.draft.type === "some" ? { draft: entry.draft.value, wire: entry.wire, place: entry.place } : ABSENT);
        }
        this.draftsChanged();
        this.moving = { base: this.cloneBase(base), read: new Map() };
        if (base.type === "snapshot") {
            this.merge(base, (id) => this.inSnapshot(base.value, id));
            return;
        }
        this.changed();
    }

    /**
     * A conflict — open, or settled since the drafts were last carried over —
     * as an issue of its entry, at the child row and the field it is in: what
     * a collection goes to and names as it does its own issues. The same
     * object for the same conflict until the drafts are carried over again,
     * so a history finds the session it is of by it ({@link EditSession.holds}).
     *
     * @param id - The entry
     * @param point - The conflict
     * @returns Its issue
     */
    conflictIssue(id: string, point: ConflictPoint): EditIssue {
        const key = settledKey(id, point.path);
        const held = this.conflictIssues.get(key);
        if (held !== undefined) return held;
        const issue = issueAt(id, point.at, this.binding.children);
        this.conflictIssues.set(key, issue);
        return issue;
    }

    /**
     * Whether an issue is this session's — one of its issues, of its drafts'
     * readiness, or a conflict's — by the issue itself, the very object the
     * session holds.
     *
     * @param issue - The issue
     * @returns Whether the session holds it
     */
    holds(issue: EditIssue): boolean {
        if (this.issues.some((held) => Object.is(held, issue))) return true;
        const readiness = this.readiness;
        if (readiness.type !== "ready" && readiness.value.some((held) => Object.is(held, issue))) return true;
        for (const held of this.conflictIssues.values()) if (Object.is(held, issue)) return true;
        return false;
    }

    /**
     * The drafts, as a preview of the Save reads them (#1437): the revision of
     * the source they began from, and each entry drafted away from its
     * original — its original and its draft, the same objects while they
     * hold, and each as the source holds an entry. What a page previews a
     * drafted entry's Save from, applying the entry's change to the entry as
     * the source holds it at the revision it reads.
     *
     * @returns The drafts: the same object while the session and its base do not move
     */
    get drafts(): SessionDrafts<W> {
        const cached = this.draftsCache;
        // The base the session holds, the same object until it observes or confirms another.
        if (cached !== undefined && cached.serial === this.serial && Object.is(cached.base, this.base)) return cached.value;
        const entries = new Map<string, DraftedEntry<W>>();
        for (const [id, draft] of this.current) {
            const original = this.baseline.get(id) ?? ABSENT;
            const after = this.domain(id, draft);
            // A draft not yet complete sends nothing, and neither does one its original equals.
            if (draft.draft !== undefined && after === undefined) continue;
            const before = this.domain(id, original);
            const [was, is] = [before === undefined ? none : some(before), after === undefined ? none : some(after)];
            if (this.domainEqual(was, is)) continue;
            let byDraft = this.draftedViews.get(original);
            if (byDraft === undefined) { byDraft = new WeakMap(); this.draftedViews.set(original, byDraft); }
            let view = byDraft.get(draft);
            if (view === undefined) {
                view = { id, key: this.keyOf?.(id), original, draft, before: was, after: is };
                byDraft.set(draft, view);
            }
            entries.set(id, view);
        }
        const value: SessionDrafts<W> = { revision: this.base?.type === "revision" ? this.base.value : undefined, entries };
        this.draftsCache = { serial: this.serial, base: this.base, value };
        return value;
    }

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
     * Capture the exact base on the first gesture. A base the source moved to
     * under pending drafts carries them over to it ({@link EditSession.merge}):
     * at once for an inline snapshot, which holds every entry; once each is
     * read there for a source at a revision, which reads them by
     * {@link EditSession.readIdsAt}. A session that does not carry its drafts
     * over (`carryOver: false`) goes out of date instead ({@link EditSession.stale}).
     *
     * @param base - The base the source is at now
     */
    observeBase(base: Base): void {
        if (this.base === undefined) {
            this.base = this.cloneBase(base);
            const kept = this.restoring;
            this.restoring = undefined;
            if (kept !== undefined && kept.length > 0) this.restoreAt(base, kept);
            return;
        }
        if (this.baseEqual(this.base, base)) return;
        if (this.locked) return; // Only reconcile() may acknowledge a submitted request.
        if (this.pending === 0) {
            this.base = this.cloneBase(base);
            this.baseline.clear(); this.current.clear(); this.ancestors.clear(); this.forgetConflicts(); this.history = []; this.cursor = 0;
            this.moving = undefined; this.stale = false;
            this.draftsChanged();
            this.changed();
            return;
        }
        if (this.binding.carryOver === false) {
            if (this.stale) return;
            this.stale = true;
            this.changed();
            return;
        }
        if (this.moving !== undefined && this.baseEqual(this.moving.base, base)) return;
        this.moving = { base: this.cloneBase(base), read: new Map() };
        if (base.type === "snapshot") {
            this.merge(base, (id) => this.inSnapshot(base.value, id));
            return;
        }
        this.changed();
    }

    /**
     * Carries the drafts over to the base the source moved to (merge.ts): each
     * drafted entry, read there, merged three ways — what both began from, the
     * draft, and the source's value there. What combines is carried over: a
     * change of the source's to another part stands beside the draft's, and a
     * Save sends only what the drafts changed. A part both changed to
     * different values is a conflict: the draft's value stands there until it
     * is settled ({@link EditSession.settle}), and Save waits. An entry whose
     * draft the source's value now holds whole is no draft any more. The
     * history starts over at the drafts: an undo would take an entry back to
     * its version at the old base. A Save the source refused because another
     * write got there first is sent again, once its drafts carry over with
     * nothing to choose — a few times in a row at most ({@link RESENDS}).
     *
     * @param base - The base the source moved to
     * @param read - Each drafted entry, as the source holds it at that base: `none` for one it does not hold, `undefined`
     *   while it is read. Entries are read across calls, as they come.
     * @returns `"merged"` once every drafted entry is read and carried over; `"waiting"` while one is still read;
     *   `"unmoved"` where the drafts are not being carried over to this base
     */
    merge(base: Base, read: (id: string) => option<unknown> | undefined): "merged" | "waiting" | "unmoved" {
        const carrying = this.moving;
        if (carrying === undefined || this.locked || !this.baseEqual(carrying.base, base)) return "unmoved";
        const before = carrying.read.size;
        let missing = 0;
        for (const id of this.current.keys()) {
            if (carrying.read.has(id)) continue;
            const now = read(id);
            if (now === undefined) { missing++; continue; }
            carrying.read.set(id, now);
        }
        if (missing > 0) {
            // Advancing schedules the next bounded read, as a confirmation's does.
            if (carrying.read.size !== before) this.changed();
            return "waiting";
        }
        const baseline = new Map<string, EntryVersion<W>>();
        const current = new Map<string, EntryVersion<W>>();
        const ancestors = new Map<string, option<unknown>>();
        for (const [id, mine] of this.current) {
            const original = this.baseline.get(id) ?? ABSENT;
            const now = carrying.read.get(id)!;
            const source: option<unknown> = now.type === "some" ? some(liftDraft(this.binding.draftType, now.value)) : none;
            const merged = this.merger.merge(this.ancestors.get(id) ?? draftOf(original), draftOf(mine), source);
            // A draft the source's value holds whole is a draft no more.
            if (this.merger.equal(merged.draft, source)) continue;
            baseline.set(id, this.versionOf(id, source, original));
            current.set(id, this.versionOf(id, merged.draft, mine));
            if (merged.ancestor !== undefined) ancestors.set(id, merged.ancestor);
        }
        // What the source said of each entry, where it refused a Save for a conflict: kept for the conflicts carried over.
        const said = this.refusalWords();
        const refused = this.status === "conflict";
        this.base = this.cloneBase(base);
        this.baseline = baseline; this.current = current; this.ancestors = ancestors; this.forgetConflicts(); this.said = said;
        this.moving = undefined;
        this.history = []; this.cursor = 0;
        this.status = "idle"; this.issues = []; this.error = undefined; this.conflicted = undefined;
        this.draftsChanged();
        // A refused Save goes again with nothing to choose; with a conflict, the person's Save sends it once it is chosen.
        this.again = (refused || this.again) && this.unsettled === 0 && this.resent < RESENDS;
        this.changed(); this.maybeAutoApply();
        return "merged";
    }

    /**
     * What the source said of each entry while a Save it refused for a
     * conflict stands: its words for each entry it named, and those the
     * session named it by at the source's newer revision (#1199) — the
     * session's own words left out.
     *
     * @returns Each entry's words, by its id
     */
    private refusalWords(): Map<string, string> {
        const said = new Map<string, string>();
        if (this.status !== "conflict") return said;
        for (const issue of [...(this.conflicted?.issues ?? []), ...this.issues]) {
            if (issue.entry === "" || stringEqual(issue.message, SESSION_TEXT.changed)) continue;
            said.set(issue.entry, issue.message);
        }
        return said;
    }

    /**
     * Settle one conflict of an entry — keep the draft's value there, or take
     * the source's — or settle one settled before the other way. One step of
     * the history, which Undo takes back.
     *
     * @param id - The entry
     * @param path - The conflict's patch path ({@link ConflictPoint.path})
     * @param choice - Which value stands
     * @returns Whether anything moved
     */
    settle(id: string, path: string, choice: ConflictChoice): boolean {
        return this.settleEach(new Map([[id, [path]]]), choice);
    }

    /**
     * Settle every conflict one way — those still open, and those settled the
     * other way — in one step of the history.
     *
     * @param choice - Which value stands
     * @returns Whether anything moved
     */
    settleAll(choice: ConflictChoice): boolean {
        const targets = new Map<string, string[]>();
        const add = (id: string, path: string) => { const paths = targets.get(id); if (paths === undefined) targets.set(id, [path]); else paths.push(path); };
        for (const [id, entry] of this.conflicts) for (const point of entry.points) add(id, point.path);
        for (const settled of this.settledPoints.values()) if (settled.choice !== choice) add(settled.id, settled.point.path);
        return this.settleEach(targets, choice);
    }

    private settleEach(targets: ReadonlyMap<string, readonly string[]>, choice: ConflictChoice): boolean {
        if (!this.writable) return false;
        const open = this.conflicts;
        const before = new Map<string, EntryVersion<W>>();
        const after = new Map<string, EntryVersion<W>>();
        const ancestorsBefore = new Map<string, option<unknown> | undefined>();
        const ancestorsAfter = new Map<string, option<unknown> | undefined>();
        const settledBefore = new Map<string, SettledConflict | undefined>();
        const settledAfter = new Map<string, SettledConflict | undefined>();
        for (const [id, paths] of targets) {
            const mine = this.current.get(id) ?? ABSENT;
            const source = draftOf(this.baseline.get(id));
            const was = this.ancestors.get(id);
            let draft = draftOf(mine);
            let next = was;
            for (const path of paths) {
                const key = settledKey(id, path);
                const prior = this.settledPoints.get(key);
                if (prior !== undefined) {
                    // Settled the other way before: settled this way now.
                    if (prior.choice === choice) continue;
                    if (choice === "source") draft = this.merger.takeSource(draft, source, path);
                    else {
                        draft = this.merger.takeSource(draft, prior.draft, path);
                        if (next !== undefined) next = this.merger.keepDraft(next, source, path);
                    }
                    settledBefore.set(key, prior);
                    settledAfter.set(key, { ...prior, choice });
                    continue;
                }
                const point = open.get(id)?.points.find((candidate) => stringEqual(candidate.path, path));
                if (point === undefined || was === undefined || next === undefined) continue;
                settledBefore.set(key, undefined);
                settledAfter.set(key, { id, key: this.keyOf?.(id), point, choice, draft: draftOf(mine), source, was, said: this.said.get(id) });
                if (choice === "source") draft = this.merger.takeSource(draft, source, path);
                else next = this.merger.keepDraft(next, source, path);
            }
            if (!this.merger.equal(draft, draftOf(mine))) {
                before.set(id, mine);
                after.set(id, this.versionOf(id, draft, mine));
            }
            // What both began from goes with the entry's last open conflict.
            if (was !== undefined) {
                const kept = next !== undefined && this.merger.conflicts(next, draft, source).length > 0 ? next : undefined;
                if (kept === undefined || !this.merger.equal(kept, was)) {
                    ancestorsBefore.set(id, was);
                    ancestorsAfter.set(id, kept);
                }
            }
        }
        if (settledAfter.size === 0) return false;
        for (const [id, version] of after) this.current.set(id, version);
        this.setAncestors(ancestorsAfter);
        this.setSettled(settledAfter);
        this.draftsChanged();
        const label = choice === "source" ? "Use the newer change" : "Keep my change";
        this.history.splice(this.cursor);
        this.history.push({
            label, origin: "settle", before, after,
            ancestors: { before: ancestorsBefore, after: ancestorsAfter },
            settled: { before: settledBefore, after: settledAfter },
        });
        this.cursor++;
        this.status = "idle"; this.issues = []; this.error = undefined; this.conflicted = undefined;
        if (before.size > 0) this.emit(before, after, "settle", label);
        this.changed(); this.maybeAutoApply();
        return true;
    }

    /** The conflicts settled, what the source said of them, and their issues, forgotten: the drafts are carried over afresh, or gone. */
    private forgetConflicts(): void { this.settledPoints.clear(); this.said = new Map(); this.conflictIssues.clear(); }

    /** Settled conflicts, set or dropped for each key given. */
    private setSettled(settled: ReadonlyMap<string, SettledConflict | undefined>): void {
        for (const [key, conflict] of settled) {
            if (conflict === undefined) this.settledPoints.delete(key);
            else this.settledPoints.set(key, conflict);
        }
    }

    /** What both began from, set or dropped for each entry given. */
    private setAncestors(ancestors: ReadonlyMap<string, option<unknown> | undefined>): void {
        for (const [id, was] of ancestors) {
            if (was === undefined) this.ancestors.delete(id);
            else this.ancestors.set(id, was);
        }
    }

    /** An entry's version holding a draft the session made: the collection's projection of it, else the one it had. */
    private versionOf(id: string, draft: option<unknown>, as: EntryVersion<W>): EntryVersion<W> {
        if (draft.type === "none") return ABSENT;
        const wire = this.binding.wireOf === undefined ? as.wire : this.binding.wireOf(id, draft.value, as.wire);
        return { draft: draft.value, wire, place: as.place };
    }

    /** An entry of an inline snapshot, by its id: `none` while the collection does not hold it. */
    private inSnapshot(collection: unknown, id: string): option<unknown> {
        if (this.keyOf !== undefined) return this.heldIn(collection, id);
        const field = this.binding.idField;
        if (field === undefined) return none;
        for (const entry of collection as readonly Record<string, unknown>[]) {
            if (stringEqual(entry[field] as string, id)) return some(entry);
        }
        return none;
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
        this.history.splice(this.cursor); this.history.push({ label, origin, before, after }); this.cursor++;
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
        if (step.ancestors !== undefined) this.setAncestors(step.ancestors.before);
        if (step.settled !== undefined) this.setSettled(step.settled.before);
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
        if (step.ancestors !== undefined) this.setAncestors(step.ancestors.after);
        if (step.settled !== undefined) this.setSettled(step.settled.after);
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
        this.ancestors.clear(); this.forgetConflicts(); this.moving = undefined; this.again = false;
        this.history = []; this.cursor = 0; this.stale = false;
        this.status = "idle"; this.issues = []; this.error = undefined; this.conflicted = undefined;
        this.changed(); this.maybeAutoApply(false);
    }
    private maybeAutoApply(enabled = true): void {
        // A discard cancels queued automatic submissions as well as avoiding a
        // new one: removing an incomplete draft may make another edit ready.
        const sequence = ++this.autoSequence;
        if (enabled && (this.binding.auto || this.again)) queueMicrotask(() => {
            if (sequence !== this.autoSequence) return;
            const again = this.again;
            // Carried over again meanwhile: that carry-over sends it.
            if (this.moving === undefined) this.again = false;
            if (!this.canApply) return;
            if (again) { this.resent++; void this.send(); } else void this.apply();
        });
    }

    /** Apply the batch, as the person's Save does; a retry keeps the original immutable bytes and captured callback. */
    async apply(): Promise<void> {
        this.again = false; this.resent = 0;
        await this.send();
    }

    /** Send the batch: the person's Save, or the session's own again after a refusal ({@link RESENDS}). */
    private async send(): Promise<void> {
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
            this.submission = { prepare: this.binding.prepare, release: this.binding.gate?.release, expected, payload, apply: this.binding.apply, refresh: this.binding.refresh, after: new Map(this.current), targets, checked: new Map(), base: this.cloneBase(this.base), revision: undefined };
        }
        const request = this.submission;
        this.status = "applying"; this.error = undefined; this.conflicted = undefined; this.changed();
        if (request.prepare !== undefined) {
            try {
                request.confirmed = await request.prepare(request.targets,
                    request.base.type === "revision" ? this.heldAt(request.base.value, request.targets, "before") : undefined);
                request.prepare = undefined;
            } catch (error) {
                // No mutation was sent. Release the write gate and keep all
                // drafts, so Retry can prepare a fresh request safely.
                this.submission = undefined; request.release?.(); this.status = "idle";
                this.error = error instanceof Error ? error.message : String(error);
                this.changed(); return;
            }
        }
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
     * Request only unresolved primary identities at this revision. Page caches
     * remain bounded; confirmed facts belong to the retained session instead.
     * @param revision - The source revision currently available to the reader
     * @returns The next small batch needing confirmation or conflict naming
     */
    readIdsAt(revision: string): readonly string[] {
        return this.idsAt(revision, 8);
    }

    /**
     * Every identity still to confirm or name at this revision: what a reader
     * whose own reads hold entries at the revision judges at once, with no
     * request — {@link EditSession.readIdsAt} bounds those it reads by their
     * keys.
     * @param revision - The source revision currently available to the reader
     * @returns Every identity needing confirmation or conflict naming there
     */
    unresolvedIdsAt(revision: string): readonly string[] {
        return this.idsAt(revision, Infinity);
    }

    /** The identities still to confirm or name at a revision, at most `limit` of them. */
    private idsAt(revision: string, limit: number): readonly string[] {
        const carrying = this.moving;
        if (carrying !== undefined && carrying.base.type === "revision" && stringEqual(revision, carrying.base.value)) {
            return [...this.current.keys()].filter((id) => !carrying.read.has(id)).slice(0, limit);
        }
        const request = this.submission;
        if (request !== undefined && this.status === "reconciling") {
            if (request.revision === undefined || !stringEqual(revision, request.revision)) return [];
            return [...request.targets.keys()].filter(id => !request.checked.has(id)).slice(0, limit);
        }
        const conflict = this.conflicted;
        if (conflict === undefined || this.status !== "conflict" || stringEqual(revision, conflict.revision)) return [];
        const checked = conflict.checked !== undefined && stringEqual(revision, conflict.checked.revision) ? conflict.checked.matches : undefined;
        return [...conflict.targets.keys()].filter(id => !checked?.has(id)).slice(0, limit);
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
        } else if (base.type === "snapshot") {
            for (const [id, target] of request.targets) {
                const now = this.heldIn(base.value, id);
                if (!this.leftAs(now, target)) return false;
                exact &&= this.domainEqual(now, target.after);
            }
        } else {
            const before = request.checked.size;
            for (const [id, target] of request.targets) {
                if (request.checked.has(id)) continue;
                const now = read(id);
                if (now !== undefined && this.leftAs(now, target)) request.checked.set(id, this.domainEqual(now, target.after));
            }
            if (request.checked.size !== request.targets.size) {
                // Advancing schedules the next bounded batch, even when the
                // pages just read are the reader's last tracked dependencies.
                if (request.checked.size !== before) this.changed();
                return false;
            }
            for (const match of request.checked.values()) exact &&= match;
        }
        this.base = this.cloneBase(base); this.baseline = new Map(request.after); this.ancestors.clear(); this.forgetConflicts(); this.moving = undefined;
        this.submission = undefined; request.release?.(); this.status = "idle"; this.error = undefined; this.confirmReason = undefined; this.issues = []; this.stale = false;
        this.conflicted = undefined;
        if (!exact) {
            this.baseline.clear(); this.current.clear(); this.history = []; this.cursor = 0;
            this.draftsChanged();
        }
        this.changed();
        if (request.confirmed !== undefined) {
            const confirmed = request.base.type === "revision" && request.revision !== undefined
                ? this.heldAt(request.revision, request.targets, "after", request.checked) : undefined;
            queueMicrotask(() => request.confirmed!(confirmed));
        }
        return true;
    }

    /**
     * A request's entries as one side of their change holds them, at a
     * revision: each present there, encoded — every one, or only those a
     * confirmation read back exactly (`exact`).
     *
     * @param revision - The revision they are held at
     * @param targets - The request's entries
     * @param side - Before the change (its base) or after it (its commit)
     * @param exact - Each entry the confirmation read, and whether exactly as the request left it
     * @returns The rows
     */
    private heldAt(revision: string, targets: ReadonlyMap<string, Target>, side: "before" | "after", exact?: ReadonlyMap<string, boolean>): HeldRows {
        const rows = new Map<string, Uint8Array>();
        for (const [id, target] of targets) {
            if (exact !== undefined && exact.get(id) !== true) continue;
            const value = target[side];
            if (value.type === "some") rows.set(id, this.encodeEntry(value.value));
        }
        return { revision, rows };
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
        if (conflict.checked === undefined || !stringEqual(conflict.checked.revision, base.value)) {
            conflict.checked = { revision: base.value, matches: new Map() };
        }
        const checked = conflict.checked.matches;
        const before = checked.size;
        for (const [id, target] of conflict.targets) {
            if (checked.has(id)) continue;
            const now = read(id);
            if (now !== undefined) checked.set(id, this.applies(now, target));
        }
        if (checked.size !== conflict.targets.size) {
            if (checked.size !== before) this.changed();
            return false;
        }
        const named = [...conflict.targets.keys()].filter(id => !checked.get(id));
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
