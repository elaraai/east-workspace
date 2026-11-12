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
 * A Save never stops the editing. A gesture is recorded while a request is on
 * its way, while its saved state is read back, while a write has no answer and
 * while the drafts are carried over: the request keeps the bytes it was sent
 * with, and once the source reads back as it left them, what was drafted since
 * is what is left to save, each change beginning from what the request left
 * ({@link EditSession.reconcile}). One request at a time: the next Save waits
 * for it.
 *
 * @packageDocumentation
 */
import { ArrayType, BlobType, ConflictError, DictType, East, EastTypeType, OptionType, StringType, StructType, applyFor, decodeBeast2For, diffFor, encodeBeast2For, equalFor, none, parseFor, pathFromString, printFor, some, toEastTypeValue, variant, type EastType, type PatchPath, type ValueTypeOf, type option } from "@elaraai/east";
import {
    applyEditing, EditingAppliedTypeFor, EditingApplyResultType, EditingBaseTypeFor, EditingChangeSetTypeFor,
    EditingChangeTypeFor, EditingPlacementType, EditingIssueType, EditingOriginType, EditingPatchEventTypeWith,
} from "@elaraai/east-ui/internal";
import { liftDraft, normalizeDraft, type BatchReadiness } from "./draft.js";
import type { EntryKeys, KnownKeys } from "./keys.js";
import { EntryMerger, type ConflictPoint } from "./merge.js";
import { SESSION_TEXT } from "./messages.js";
import type { AutosaveState } from "./autosave.js";

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
 * Two fields of an entry that read as one value: its start and its end — an
 * item's dates. The conflicts popover shows a conflict at either as one card,
 * the range whole, and settles the two together — and the fields that go with
 * them ({@link ConflictRange.with}).
 */
export interface ConflictRange {
    /** The field of its start. */
    readonly start: string;
    /** The field of its end. */
    readonly end: string;
    /**
     * The fields a move writes with its times, which place it with them — a
     * duty's shift and group, a bin's bay at its own minute. While a conflict
     * at the times waits, the draft's own values stand there too, and choosing
     * settles them with the times: Theirs takes theirs back, Yours keeps the
     * draft's. A change there with no conflict at the times combines as any
     * other. None by default.
     */
    readonly with?: readonly string[] | undefined;
}

/**
 * Fields of an entry that change together: a value, and the fields that
 * follow it — a quantity, and its split across resources. The conflicts
 * popover shows a conflict at any of them as one card, the value's, and
 * settles them together.
 */
export interface ConflictTogether {
    /** The field of the value the card shows. */
    readonly lead: string;
    /** The fields that change with it. */
    readonly with: readonly string[];
    /** What the card calls the value — `Quantity`; the lead's name in words by default. */
    readonly label?: string | undefined;
}

/**
 * The entry's field a conflict is in: its path's first field, past the cases
 * of the draft's own — an entry drafted whole is a case of its draft.
 *
 * @param point - The conflict
 * @returns The field's name; `undefined` for a conflict of the entry as a whole
 */
export function conflictFieldOf(point: ConflictPoint): string | undefined {
    for (const step of point.at) {
        if (step.kind === "field") return step.name;
        if (step.kind !== "variant") return undefined;
    }
    return undefined;
}

/** The card a conflict shares with others of its entry ({@link conflictPartOf}): its key within the entry, and why. */
export type ConflictPart =
    | { readonly key: string; readonly range: ConflictRange }
    | { readonly key: string; readonly together: ConflictTogether };

/**
 * The card a conflict shows on, where it shares one: its range's — an item's
 * start or end ({@link ConflictRange}) — or the fields' that change together
 * ({@link ConflictTogether}), by its first field; `undefined` for a conflict
 * on a card of its own.
 *
 * @param point - The conflict
 * @param ranges - The entry's ranges
 * @param together - The entry's fields that change together
 * @returns The shared card, or `undefined`
 */
export function conflictPartOf(point: ConflictPoint, ranges: readonly ConflictRange[], together: readonly ConflictTogether[]): ConflictPart | undefined {
    const first = conflictFieldOf(point);
    if (first === undefined) return undefined;
    const range = ranges.find((r) => stringEqual(r.start, first) || stringEqual(r.end, first));
    if (range !== undefined) return { key: `range\u0000${range.start}\u0000${range.end}`, range };
    const joined = together.find((t) => stringEqual(t.lead, first) || t.with.some((field) => stringEqual(field, first)));
    return joined === undefined ? undefined : { key: `together\u0000${joined.lead}`, together: joined };
}

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
 * A request whose outcome the session does not know, as a reload keeps it
 * (keep.ts) beside the drafts: enough to put the session back as it stood and
 * ask the source again ({@link EditSession.restoreRequest}).
 *
 * @typeParam W - The collection's projection of an entry
 */
export interface KeptRequest<W> {
    /** The batch as it was sent: sent again, it is the same request, under the same id. */
    readonly payload: Uint8Array;
    /** Whether an automatic Save sent it. */
    readonly automatic: boolean;
    /** Each entry it changes: as its edit began, and as the request leaves it. */
    readonly targets: readonly { readonly id: string; readonly before: EntryVersion<W>; readonly after: EntryVersion<W> }[];
    /** The keys the session made among the entries it adds, each with the id it was made from ({@link EditSession.mint}). */
    readonly minted: ReadonlyMap<string, string | undefined>;
    /**
     * Where it stands. `"unanswered"`: sent, or about to be, with no answer — it is sent again. `"refused"`: sent
     * again after no answer and refused, its entries still to be read for what its first sending left
     * ({@link EditSession.merge}) — it is not sent again.
     */
    readonly asked: "unanswered" | "refused";
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
    /** What a gesture recorded with the same key joins, while it is the last step and nothing is redone past it ({@link EditSession.record}). */
    joins?: string | undefined;
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
 * An entry the session knows the source holds otherwise than its host's rows
 * may, read from before: one a confirmed Save changed, or one drafted here
 * that the session read at a revision the source moved to
 * ({@link EditSession.landed}).
 *
 * @typeParam W - The collection's projection of an entry
 */
export interface LandedEntry<W> {
    /** The entry as the source held it before: absent for one the Save added, or another write did. */
    readonly before: EntryVersion<W>;
    /**
     * The entry as the source holds it now: the request's version — or, read
     * back otherwise (another write beside it), the source's — or the
     * source's as the drafts were carried over to it; absent for one the
     * source no longer holds.
     */
    readonly after: EntryVersion<W>;
    /**
     * The revision the request was drafted at, or the drafts were carried over
     * from: rows read there hold nothing of it. `undefined` where the drafts
     * were carried over at the revision the session was at already — a Save
     * refused there, its entries read there: only rows read at another
     * revision than the one their source reads at now are from before it.
     */
    readonly from: string | undefined;
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
    /** The entry's fields that read as one, each an item's start and end ({@link ConflictRange}); none by default. */
    ranges?: readonly ConflictRange[] | undefined;
    /** The entry's fields that change together, each a value and those that follow it ({@link ConflictTogether}); none by default. */
    together?: readonly ConflictTogether[] | undefined;
    /**
     * The collection's projection of a draft the session made itself — one
     * carried over to a newer base, or settled — where it draws drafts from
     * their projection (the Sheet's rows). `undefined` keeps the projection
     * the entry had.
     */
    wireOf?: ((id: string, draft: unknown, prior: W | undefined) => W | undefined) | undefined;
    /**
     * Whether the host draws what a confirmed Save landed over rows read
     * before its commit, until they are read again ({@link EditSession.landed}):
     * a host whose rows are read apart from the confirmation — a paged
     * source's pages, read again at the revision the Save committed. `false`
     * by default, and nothing is held.
     */
    drawsLanded?: boolean | undefined;
    /**
     * How the collection's new entries are keyed (keys.ts): the session makes
     * each new entry's key by it ({@link EditSession.mint}), holds the key as
     * its own until the entry is saved ({@link EditSession.ownKeys}), and
     * makes it another by the same rule where the source comes to hold it as
     * another's — added meanwhile by another write (#1583): the entry goes on
     * under the new key, a new entry still ({@link EditSession.renumbered}).
     * A key the session did not make — one a person typed, one an app built
     * from the entry itself — keeps the two a conflict to choose between.
     * None by default: the session makes no key.
     */
    keys?: EntryKeys | undefined;
    /**
     * A new entry's version as it stands under another id, where the session
     * makes it another key ({@link EditSessionBinding.keys}): what of it names
     * the entry moved with it — its projection's own id, an identity field its
     * draft carries. The version as it is, by default.
     */
    underKey?: ((id: string, version: EntryVersion<W>, was: string) => EntryVersion<W>) | undefined;
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
    /**
     * Each confirmed entry read back otherwise than the request left it, as the
     * source holds it: what a host that draws a landed Save draws it as
     * ({@link EditSession.landed}), and what a draft made since the request
     * was sent is merged over ({@link EditSession.behind}) — never an entry
     * read back exactly.
     */
    otherwise: Map<string, option<unknown>>;
    base: Base;
    revision: string | undefined;
    /**
     * The source has read at the revision it answered the request with — the one the request committed, or, answered
     * again by a source that remembers the request, the one the source was at as it answered. That revision and any
     * other it reads at from then on is at or after the request's commit, so an entry read there as its edit began
     * was put back by another write since, never read before the request landed ({@link EditSession.reconcile}).
     */
    reached?: boolean | undefined;
    /**
     * The request was sent and no answer came — the write threw, or answered with no revision — so it may have landed
     * all the same. Sent again, an answer that it was applied is the source's word on it; one that it was refused is
     * not ({@link EditSession.unconfirmed}).
     */
    unanswered?: boolean | undefined;
    /** A positional snapshot's whole collection as the request leaves it — its target, order included. */
    expected: Uint8Array | undefined;
    /** Each entry the request places, and where: what a positional snapshot holds once the request lands. */
    placed: readonly Pick<Change, "id" | "place">[];
    release: (() => void) | undefined;
}

/** The source's own apply over an inline snapshot: the collection, a batch and the revision it makes, to the collection applied or its conflict. */
type Transform = (collection: unknown, batch: Batch, revision: ValueTypeOf<OptionType<StringType>>) => Applied;

const placementEqual = equalFor(OptionType(EditingPlacementType));
/**
 * How many keys a session has made that no gesture has recorded an entry under are still the session's to make its
 * own ({@link EditSession.mint}): past them the oldest is forgotten — a key no one's, as one a gesture gave up.
 */
const OFFERED_KEYS = 64;
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
/** Where a keyed source's entry stands: in its key's order, wherever it is. */
const KEY_ORDER: Placement = some(variant("keyOrder", null));

/** A snapshot apply compiled, with what it applies over: its entry type, and a keyed source's key type or an Array source's identity field. */
interface KeptTransform {
    readonly entry: ValueTypeOf<typeof EastTypeType>;
    readonly key: ValueTypeOf<typeof EastTypeType> | undefined;
    readonly idField: string | undefined;
    readonly transform: Transform;
}

/** How many compiled snapshot applies are kept: past it the oldest goes, and is compiled again where it is next asked for. */
const TRANSFORMS_KEPT = 64;
/**
 * The snapshot applies compiled so far, oldest first. A page makes a session a source and a view — many of them over
 * one entry type — and compiling an apply takes a millisecond and a half, so each is compiled once and found again
 * by East's own equality of the types it applies over.
 */
const keptTransforms: KeptTransform[] = [];

/**
 * The source's own apply over an inline snapshot (`Editing.apply`), compiled once for the types it applies over.
 *
 * @param entry - The source's entry type
 * @param keyType - A keyed source's key type
 * @param idField - An Array source's identity field
 * @returns The compiled apply
 */
function transformOver(entry: Opaque, keyType: EastType | undefined, idField: string | undefined): Transform {
    const [of, by] = [toEastTypeValue(entry), keyType === undefined ? undefined : toEastTypeValue(keyType)];
    /** Whether two of them are both absent, or both there and equal. */
    const alike = <T>(a: T | undefined, b: T | undefined, equal: (x: T, y: T) => boolean): boolean =>
        (a === undefined || b === undefined ? a === undefined && b === undefined : equal(a, b));
    const kept = keptTransforms.find((held) => schemaEqual(held.entry, of) && alike(held.key, by, schemaEqual) && alike(held.idField, idField, stringEqual));
    if (kept !== undefined) return kept.transform;
    const transform = (keyType !== undefined ? East.compile(applyEditing(DictType(keyType, entry)), []) : East.compile(applyEditing(entry, idField!), [])) as unknown as Transform;
    keptTransforms.push({ entry: of, key: by, idField, transform });
    if (keptTransforms.length > TRANSFORMS_KEPT) keptTransforms.shift();
    return transform;
}

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

/**
 * How a keyed source's key is named (#880): a String key is its own id, any
 * other key its `.east` printing — what {@link keyReader} reads back.
 *
 * @param keyType - The source's key type
 * @returns A key's id
 */
export function keyPrinter(keyType: EastType): (key: unknown) => string {
    if (keyType.type === "String") return key => key as string;
    return printFor(toEastTypeValue(keyType)) as (key: unknown) => string;
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
    private readonly draftEqual: (a: unknown, b: unknown) => boolean;
    private readonly domainEqual: (a: unknown, b: unknown) => boolean;
    private readonly draftDiff: (a: unknown, b: unknown) => Change["patch"];
    private readonly domainDiff: (a: unknown, b: unknown) => Change["patch"];
    /** An entry's change applied to it: a value, or the `ConflictError` of one that does not hold what the change began from. */
    private readonly domainApply: (base: unknown, patch: Change["patch"]) => unknown;
    /** A keyed source's key by an entry's id; `undefined` for an Array source. */
    private readonly keyOf: ((id: string) => unknown) | undefined;
    private readonly encodeBatch: (value: unknown) => Uint8Array;
    /** A batch read back from its bytes: what a request kept through a reload was drafted at, and what it places. */
    private readonly decodeBatch: (bytes: Uint8Array) => Batch;
    private readonly encodeEvent: (value: unknown) => Uint8Array;
    private readonly cloneDraft: (value: unknown) => unknown;
    /** Compiles the source's own apply over an inline snapshot; `undefined` for an Array source with no identity field. */
    private readonly compileTransform: (() => Transform) | undefined;
    private compiledTransform: Transform | undefined;
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
    /** A request a reload kept, waiting for the session's first base ({@link EditSession.restoreRequest}). */
    private resuming: KeptRequest<W> | undefined;
    /**
     * A request sent again after no answer, and refused: its bytes, what it changes and what it leaves. The refusal
     * says nothing of its first sending. A source answers a request again only while that request is its last write —
     * e3 names the key of a record's last mutation alone — so once another write has landed, the same request is
     * checked afresh, and one that had landed is refused: its entries no longer hold what its changes began from.
     * Taken at its word, the refusal would have the session carry its drafts over from what they began as: a new
     * entry the first sending saved would read as another write's under the session's key, be made another key and
     * saved twice; an entry it removed, put back by Undo since, would read as removed by another and go.
     *
     * So each entry is judged by what the source holds of it, as the drafts are carried over ({@link EditSession.merge}),
     * a part at a time ({@link EntryMerger.eitherBegan}): one the source holds as the request left it began from what
     * the request sent — a draft made since is a change from that, as after a Save the source acknowledged; one it
     * holds as the edit began, from that, as after any refusal; and one it holds as neither, from whichever makes the
     * draft's difference a conflict to choose — never given up for the source's value with nothing asked. A new entry
     * of the request's is made no other key: the entry under its key may be the request's own.
     */
    private unconfirmed: { readonly payload: Uint8Array; readonly after: ReadonlyMap<string, EntryVersion<W>>; readonly targets: ReadonlyMap<string, Target> } | undefined;
    /** The kept request as last read, and what it was read from: the same object while neither moves (keep.ts writes on a change). */
    private keptRequestCache: { readonly of: object; readonly asked: "unanswered" | "refused"; readonly value: KeptRequest<W> } | undefined;
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
    /** The Save in hand, or the one last refused, was an automatic Save's: sent again by the session itself, it is one still. */
    private automatic = false;
    /** How many gestures, Undos, Redos and conflict choices the session has taken ({@link EditSession.edits}). */
    private made = 0;
    /** How many of the done steps a person's Save has taken, an optimiser's result among them ({@link EditSession.heldFrom}). */
    private accepted = 0;
    /** The history went while it held an optimiser's result no person's Save had taken: every draft waits for one. */
    private unaccepted = false;
    /**
     * How many steps were done as the last change was made — a gesture recorded, a conflict chosen, an optimiser's
     * result landed — or as a person's Save last took them: the one place an automatic Save sends from
     * ({@link EditSession.stepped}). `undefined` where the history went while the steps stood away from it: nothing is
     * left to step back with, so the drafts wait for a person's Save, or for the next change.
     */
    private drafted: number | undefined = 0;
    /** The conflicts as last read, at the session's version: the same object while it does not move. */
    private conflictsCache: { readonly serial: number; readonly value: ReadonlyMap<string, EntryConflicts> } | undefined;
    /** A Save's conflict at a revision base whose entries the session has still to name (#1199). */
    private conflicted: Conflicted | undefined;
    /** Why the confirmation read last failed, while it is the error shown (#853). */
    private confirmReason: string | undefined;
    /** What a Save landed that the host's rows may not show yet ({@link EditSession.landed}). */
    private landedEntries = new Map<string, LandedEntry<W>>();
    /** Each new entry the last carry-over gave a new id, by the id it had ({@link EditSession.renumbered}). */
    private renumberedIds: ReadonlyMap<string, string> = new Map();
    /**
     * The keys the session made for new entries ({@link EditSession.mint}), each with the id it was made from: its own
     * while its drafts add their entries ({@link EditSession.ownKeys}).
     */
    private minted = new Map<string, string | undefined>();
    /**
     * The keys the session made that no gesture has recorded an entry under yet, each with the id it was made from: a
     * gesture given up — a drop refused, a check of whether a copy can be made — leaves its key no one's. The newest
     * few alone ({@link OFFERED_KEYS}): a builder that asks for a key as it draws asks for many it never uses.
     */
    private readonly offered = new Map<string, string | undefined>();
    /**
     * The keys the session has learned its source holds as another write's: each one a new entry of its own was made
     * another key for ({@link EditSession.merge}). No key is made under one again: over a source the session does not
     * hold whole, a rule that makes each key from the same start would come back to the first once the entry had left
     * it, the source refuse it again, and the entry go between the two for good, never saved.
     */
    private readonly taken = new Set<string>();
    /**
     * A source held whole, as it was last observed ({@link EditSession.observeBase}): the session's own base, or a
     * later collection its drafts have still to move to while a request of their own is unresolved. A new entry's key
     * is made past its keys ({@link EditSession.mint}): its host begins a gesture from the collection as it reads now,
     * so a key made past the session's own base alone could be one another write has added since, and the new entry
     * would begin from that write's and be saved over it. `undefined` for a source at a revision, which holds none.
     */
    private seen: Extract<Base, { type: "snapshot" }> | undefined;
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
        // A keyed source is applied by key (#880); an Array source by its identity field. Compiled when a snapshot is
        // first applied: a session over a source at a revision, as every record's is, applies none.
        const idField = binding.idField;
        this.compileTransform = keyType !== undefined ? () => transformOver(entry, keyType, undefined)
            : idField === undefined ? undefined : () => transformOver(entry, undefined, idField);
        this.draftEqual = equalFor(toEastTypeValue(OptionType(draft)));
        this.domainEqual = equalFor(toEastTypeValue(OptionType(entry)));
        this.draftDiff = diffFor(toEastTypeValue(OptionType(draft)));
        this.domainDiff = diffFor(toEastTypeValue(OptionType(entry)));
        this.domainApply = applyFor(toEastTypeValue(OptionType(entry)));
        this.keyOf = keyType === undefined ? undefined : keyReader(keyType);
        this.encodeBatch = encodeBeast2For(toEastTypeValue(EditingChangeSetTypeFor(entry, keyType)));
        this.decodeBatch = decodeBeast2For(toEastTypeValue(EditingChangeSetTypeFor(entry, keyType))) as (bytes: Uint8Array) => Batch;
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
    /**
     * The source's own apply over an inline snapshot (`Editing.apply`): what a snapshot's Save is checked by, and what
     * draws its drafts ({@link EditSession.applied}). `undefined` for an Array source with no identity field.
     */
    private get transform(): Transform | undefined {
        if (this.compileTransform === undefined) return undefined;
        return this.compiledTransform ??= this.compileTransform();
    }
    /** Subscribe to every change (`useSyncExternalStore`). */
    subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
    /** The change counter (`useSyncExternalStore`). */
    getSnapshot = (): number => this.serial;
    private changed(): void { this.serial++; for (const listener of this.listeners) listener(); }
    /** Another view of the source took or released the source's one request. */
    availabilityChanged(): void { this.changed(); }
    /** A request is unresolved: on its way, its saved state read back, or its answer unknown. The next Save waits for it; a gesture does not. */
    get locked(): boolean { return this.submission !== undefined; }
    /**
     * A gesture may be recorded now. A request that is unresolved, drafts being
     * carried over to a source that moved, and another view's request for the
     * source take gestures as an idle session does: what is drafted meanwhile
     * is what the next Save sends ({@link EditSession.canSend}). Only a session
     * with no Save to send to, or out of date, takes none.
     */
    get writable(): boolean { return this.binding.apply !== undefined && !this.stale; }
    /**
     * Whether the unresolved request changes an entry: what tells a Save's own
     * entries from those drafted since it was sent, for a host that counts
     * what a Save wrote before its rows read it. An entry the request changes
     * and a draft made since stands over is the request's still.
     *
     * @param id - The entry
     * @returns Whether the request on its way, read back or unanswered changes it
     */
    sends(id: string): boolean { return this.submission?.targets.has(id) === true; }
    /** The drafts are being carried over to the base the source moved to: each drafted entry is still being read there. */
    get carrying(): boolean { return this.moving !== undefined; }
    /** The drafts may be discarded now. */
    get canDiscard(): boolean { return !this.locked && (this.binding.gate?.available() ?? true); }
    /** Undo is available. */
    get canUndo(): boolean { return this.writable && this.cursor > 0; }
    /** Redo is available. */
    get canRedo(): boolean { return this.writable && this.cursor < this.history.length; }
    /**
     * How many gestures, Undos, Redos and conflict choices the session has
     * taken: it moves with each, whatever a request is doing — what an
     * automatic Save counts its pause from (`autosave.ts`).
     */
    get edits(): number { return this.made; }
    /** Where its requests stand, as an automatic Save reads them (`autosave.ts`). */
    get saving(): AutosaveState {
        switch (this.status) {
            case "applying": return "sending";
            // A source that saved without naming its revision is asked nothing again by itself: the same answer would come.
            case "unknown": return this.error === SESSION_TEXT.noRevision ? "idle" : "unanswered";
            case "reconciling": return this.error === undefined ? "readingBack" : "readBackFailed";
            default: return "idle";
        }
    }
    /**
     * How many transactions Undo can take back, and how many Redo can replay
     * (#1194): what a history over several sessions (`EditHistory`) keeps its
     * order of, and what tells it this session's own history went.
     */
    get depth(): { readonly undo: number; readonly redo: number } { return { undo: this.cursor, redo: this.history.length - this.cursor }; }
    /**
     * The transaction Redo would replay next (#1409): its origin, its label
     * and how many entries it changed — what a host that lands a step again
     * by its origin reads, as a run of the app's optimiser is replayed
     * without its banner.
     */
    get nextRedo(): { readonly origin: Origin; readonly label: string; readonly entries: number } | undefined {
        const step = this.history[this.cursor];
        return step === undefined ? undefined : { origin: step.origin, label: step.label, entries: step.after.size };
    }
    /**
     * The transaction Undo would take back next: its origin, its label and
     * how many entries it changed — what a host words a step by before it is
     * taken back, as a Record says `Restored 2 people` of a removal.
     */
    get nextUndo(): { readonly origin: Origin; readonly label: string; readonly entries: number } | undefined {
        const step = this.history[this.cursor - 1];
        return step === undefined ? undefined : { origin: step.origin, label: step.label, entries: step.after.size };
    }
    /**
     * Forget the transactions Redo would replay (#1194): in a history over
     * several sessions, a gesture recorded in another took their place.
     */
    dropRedo(): void {
        if (this.cursor === this.history.length) return;
        if (this.accepted > this.cursor) this.accepted = this.cursor;
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
    /**
     * Every draft's schema check, then the author's — issues gathered in a loop: a spread of a large batch's issues into a
     * call throws RangeError (#859). Over the drafts as they stand, or over some as they stood ({@link EditSession.draftsBefore}).
     */
    private composeReadiness(author: BatchReadiness | undefined, drafts: ReadonlyMap<string, EntryVersion<W>> = this.current): BatchReadiness {
        const issues: EditIssue[] = [];
        let invalid = false;
        for (const [id, entry] of drafts) {
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
    /**
     * A Save could be sent now, had the session a change that passes its
     * checks: no request of this session's or of another view's is unresolved,
     * and the drafts are not being carried over. What a Save waits on, where a
     * gesture waits on none of it ({@link EditSession.writable}).
     */
    get canSend(): boolean {
        return this.writable && !this.locked && this.moving === undefined && (this.binding.gate?.available() ?? true);
    }
    /**
     * Apply is available: a Save can be sent ({@link EditSession.canSend}), no
     * conflict waits, the drafts pass their checks, and one of them is a
     * change to send.
     */
    get canApply(): boolean {
        return this.canSend && this.unsettled === 0 && this.status === "idle" && this.sendable(this.current);
    }
    /** Whether some drafts — as they stand, or as they stood — pass their checks and hold a change to send. */
    private sendable(drafts: Map<string, EntryVersion<W>>): boolean {
        const readiness = drafts === this.current ? this.readiness : this.composeReadiness(this.binding.ready?.(drafts), drafts);
        return readiness.type === "ready" && this.changes(this.baseline, drafts, false).length > 0;
    }
    /**
     * Where an automatic Save stops (`autosave.ts`): the depth of the first
     * done step that is an optimiser's result no person's Save has taken.
     * What was changed before it is saved by itself; the result, and every
     * change made over it, wait for a person's Save — a change made over a
     * proposal, saved without it, would store what nobody saw. `"all"` where
     * the history that held such a result went — the drafts carried over, a
     * Save read back beside another write, a reload — so every draft waits;
     * `undefined` with none held.
     */
    get heldFrom(): number | "all" | undefined {
        if (this.unaccepted) return "all";
        for (let i = this.accepted; i < this.cursor; i++) if (this.history[i]!.origin === "optimise") return i;
        return undefined;
    }
    /** Whether an optimiser's result waits for a person's Save: a change still to save that an automatic Save sends none of. */
    get autosaveHeld(): boolean {
        const stop = this.heldFrom;
        if (stop === undefined) return false;
        const before = stop === "all" ? undefined : this.draftsBefore(stop);
        return before === undefined ? this.pending > 0 : this.changes(before, this.current, true).length > 0;
    }
    /**
     * The drafts as they stood before the done step at a depth: what an
     * automatic Save that stops there sends — the drafts as they stand, where
     * no done step is at it or past it. `undefined` where a step from there on
     * settled a conflict: the drafts before it held one still to choose.
     */
    private draftsBefore(depth: number | undefined): Map<string, EntryVersion<W>> | undefined {
        if (depth === undefined || depth >= this.cursor) return this.current;
        const drafts = new Map(this.current);
        for (let i = this.cursor - 1; i >= depth; i--) {
            const step = this.history[i]!;
            if (step.settled !== undefined || step.ancestors !== undefined) return undefined;
            for (const [id, entry] of step.before) drafts.set(id, entry);
        }
        return drafts;
    }
    /**
     * Whether an automatic Save that stops at a depth has a change it may
     * send now: a Save can be sent, no conflict waits, and what was drafted
     * before that depth is a change that passes its checks. One history over
     * several sessions stops each where its own order of the gestures says
     * (`EditHistory`).
     *
     * @param stop - Where it stops ({@link EditSession.heldFrom}); `undefined` for nowhere
     * @returns Whether it has
     */
    canAutosaveTo(stop: number | "all" | undefined): boolean {
        if (stop === "all" || this.stepped || !this.canSend || this.unsettled !== 0 || this.status !== "idle") return false;
        const drafts = this.draftsBefore(stop);
        return drafts !== undefined && this.sendable(drafts);
    }
    /**
     * Whether an automatic Save has a change it may send now: one made before any optimiser's result that waits, the
     * steps standing where the last change left them.
     */
    get canAutosave(): boolean { return this.canAutosaveTo(this.heldFrom); }
    /**
     * Whether the done steps stand where Undo or Redo left them, away from where the last change did (ruled 11 Nov
     * 2026): an automatic Save sends nothing from there (`autosave.ts`). A person who steps back to look at a change
     * has changed nothing, and one who wants an earlier state saved presses Save, which takes where the steps stand as
     * theirs. Back where the last change left them, or once a new change is made — saved with what stands under it —
     * the steps are an automatic Save's again.
     */
    get stepped(): boolean { return this.drafted !== this.cursor; }
    /** Whether a change waits for a person's Save because Undo or Redo left it: one still to save that an automatic Save sends none of. */
    get autosaveStepped(): boolean { return this.stepped && this.pending > 0; }
    /**
     * A change was made in another session of the one history that steps through this one (`EditHistory`): where this
     * one's steps stand is part of where that change left the history, so an automatic Save sends them with it.
     */
    changedElsewhere(): void {
        if (!this.stepped) return;
        this.drafted = this.cursor;
        this.changed();
    }
    /**
     * A gesture ends what the last request left to say — a refusal, its
     * issues, an error — as it always has. While a request is unresolved, or
     * the drafts are carried over, what the session says is that request's, or
     * the refused Save's the carry-over sends again: it stands until then.
     */
    private gestured(): void {
        this.made++;
        if (this.locked || this.moving !== undefined) return;
        this.status = "idle"; this.issues = []; this.error = undefined; this.conflicted = undefined;
    }

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

    /**
     * How many conflicts are still to settle — a range's start and end in one
     * entry counting once, as the conflicts popover shows them on one card
     * ({@link ConflictRange}): Save waits until none is.
     */
    get unsettled(): number {
        let n = 0;
        for (const entry of this.conflicts.values()) n += this.cardsOf(entry.points);
        return n;
    }

    /**
     * How many settled conflicts the conflicts popover shows: a range's in
     * one entry counting once.
     */
    get chosen(): number {
        const byEntry = new Map<string, ConflictPoint[]>();
        for (const settled of this.settledPoints.values()) {
            const points = byEntry.get(settled.id);
            if (points === undefined) byEntry.set(settled.id, [settled.point]);
            else points.push(settled.point);
        }
        let n = 0;
        for (const points of byEntry.values()) n += this.cardsOf(points);
        return n;
    }

    /**
     * How many cards one entry's conflicts make: each on its own, but those at
     * one range's start and end, or at fields that change together, one.
     */
    private cardsOf(points: readonly ConflictPoint[]): number {
        const ranges = this.binding.ranges ?? [];
        const together = this.binding.together ?? [];
        if (ranges.length === 0 && together.length === 0) return points.length;
        const hit = new Set<string>();
        let n = 0;
        for (const point of points) {
            const part = conflictPartOf(point, ranges, together);
            if (part === undefined) n++;
            else if (!hit.has(part.key)) { hit.add(part.key); n++; }
        }
        return n;
    }
    /** Every entry the session holds a version of, as it stands. */
    get entries(): ReadonlyMap<string, EntryVersion<W>> { return this.current; }
    /** The same entries as the source last acknowledged them. */
    get originals(): ReadonlyMap<string, EntryVersion<W>> { return this.baseline; }
    /**
     * The version a gesture on an entry begins from (ruled 11 Nov 2026): the row its person is looking at, captured at
     * the entry's first change. In order: the session's own version of it; else what its last Save left of it, while
     * its host has yet to show that Save ({@link EditSession.landed}) — the host's rows are from before the commit
     * then, and a gesture begun from them would change a row as it stood before the session's own Save; else the row
     * its host shows. One rule, here: a host says only where its rows are.
     *
     * A start newer than the screen would let an edit overwrite a change its author never saw; begun from the row
     * shown, another write's change of another part merges at Save, and of the same part is a conflict to choose.
     *
     * @param id - The entry
     * @param shown - The entry as the host shows it now: its version, or `undefined` where the host shows none of it
     * @returns The version; `undefined` where the session holds none and the host shows none
     */
    startOf(id: string, shown: () => EntryVersion<W> | undefined): EntryVersion<W> | undefined {
        return this.current.get(id) ?? this.landedEntries.get(id)?.after ?? shown();
    }

    /**
     * What a Save landed that the host's rows may not show yet, by entry: each
     * entry the request changed, as the source held it before and holds it
     * now, and the revision the request was drafted at. A host whose rows are
     * read apart from the confirmation — a paged source's pages, read again at
     * the revision the Save committed — draws these over rows read before the
     * commit, so a saved row never shows its old value meanwhile, and lets each
     * go once its rows read it again ({@link EditSession.shown}). Held only for
     * a host that draws them ({@link EditSessionBinding.drawsLanded}).
     *
     * And what the session read as it carried its drafts over to a revision
     * the source moved to ({@link EditSession.merge}): each drafted entry as
     * the source holds it there, from the revision they were carried from. A
     * draft the source came to hold whole — a row removed here and by another
     * write — is the session's no more, and one whose draft stands may be
     * taken back: drawn from rows read before, either would show as it stood
     * before the other write, a removed row back on the grid.
     */
    get landed(): ReadonlyMap<string, LandedEntry<W>> { return this.landedEntries; }
    /**
     * Each new entry the last carry-over gave a new id, by the id it had
     * (#1583): the source had come to hold that one as another's, and the
     * session made the entry another by its collection's rule
     * ({@link EditSessionBinding.keys}). A new map at each carry-over — empty
     * where none was — so a host says so once, and moves on what it holds by
     * the id the entry had: its selection.
     */
    get renumbered(): ReadonlyMap<string, string> { return this.renumberedIds; }

    /**
     * A key for a new entry, by the collection's rule
     * ({@link EditSessionBinding.keys}): past every key the drafts hold — one
     * they remove among them, which the source holds until the removal is
     * saved — every key a Save landed that its host has yet to show, every
     * key the session has learned is another write's, every key of a source
     * held whole, as it was last observed, and `also`. The key is the
     * session's own once a gesture records its entry
     * ({@link EditSession.ownKeys}); a gesture given up leaves it no one's.
     *
     * @param from - The id the entry is made from — a template's, a copied entry's — where it is made from one
     * @param also - Keys taken beside those the session knows of: those a gesture has made already
     * @returns The key's id; `undefined` where the collection has no rule, or its rule makes none now
     * @throws Whatever the collection's rule throws to refuse the gesture
     */
    mint(from?: string, also?: ReadonlySet<string>): string | undefined {
        const keys = this.binding.keys;
        if (keys === undefined) return undefined;
        const id = keys.make(this.knownKeys(this.seen ?? this.base, also), from, undefined);
        if (id === undefined) return undefined;
        // Its own once a gesture records its entry: until then, the newest of the keys it has made and not used.
        this.offered.delete(id);
        this.offered.set(id, from);
        for (const oldest of this.offered.keys()) {
            if (this.offered.size <= OFFERED_KEYS) break;
            this.offered.delete(oldest);
        }
        return id;
    }

    /**
     * The keys the session made that are its own still, each with the id it
     * was made from: those of the new entries its drafts add. A key whose
     * entry is saved is the source's, and one whose entry the drafts no
     * longer add — undone, discarded — is no one's. What a reload keeps with
     * the drafts (keep.ts), so a new entry whose key another write takes is
     * given another after it as before it.
     *
     * A key a request not yet resolved holds is none of them: where the page
     * reloads before the request's answer, the source may hold the entry as
     * the request left it, which nothing tells from another write's — made
     * another key then, an entry whose Save landed would be saved twice.
     * Restored as a key the session did not make, its entry is no draft
     * where the source holds it whole, and a conflict to choose where it
     * holds it otherwise, as an entry under a key a person typed is.
     */
    get ownKeys(): ReadonlyMap<string, string | undefined> {
        const out = new Map<string, string | undefined>();
        // Nor one of a request sent again after no answer and refused: the entry under it may be that request's own.
        const [sent, unconfirmed] = [this.submission?.targets, this.unconfirmed?.targets];
        for (const [id, from] of this.minted) if (this.adds(id) && sent?.has(id) !== true && unconfirmed?.has(id) !== true) out.set(id, from);
        return out;
    }

    /**
     * Restore the keys the session made, kept through a reload with its
     * drafts ({@link EditSession.restore}), before the session's first base.
     *
     * @param keys - Each key it made, with the id it was made from
     * @returns Whether they are restored: `false` once the session has a base
     */
    restoreOwnKeys(keys: ReadonlyMap<string, string | undefined>): boolean {
        if (this.base !== undefined) return false;
        this.minted = new Map(keys);
        return true;
    }

    /** Whether the drafts add an entry: one they hold that the source, as the session began from it, does not. */
    private adds(id: string): boolean {
        return this.current.get(id)?.draft !== undefined && this.baseline.get(id)?.draft === undefined;
    }

    /** Forgets the keys the session made whose entries its drafts no longer add, once nothing is left to step back to them with. */
    private forgetMade(): void {
        for (const id of [...this.minted.keys()]) if (!this.adds(id)) this.minted.delete(id);
    }

    /**
     * The keys a new one must not be, as far as the session knows: those its drafts hold and those they began from —
     * an entry the drafts remove among them, the source's until that is saved — those a Save landed that its host has
     * yet to show ({@link EditSession.landed}), the source's by then and no draft's any more; those it has learned the
     * source holds as another write's, a new entry of its own made another key for each; those of a base the session
     * holds whole; and `also`. A new entry made under a key a Save just landed would begin from that Save's entry
     * ({@link EditSession.startOf}) and be saved over it.
     */
    private knownKeys(base: Base | undefined, also: { has(id: string): boolean; [Symbol.iterator](): Iterator<string> } | undefined): KnownKeys {
        const { current, baseline, landedEntries, taken } = this;
        // What a request leaves an entry under — one unresolved, or one sent again after no answer and refused, whose
        // first sending may have landed: the source's by then, whatever the drafts have done with the entry since.
        const [out, unconfirmed] = [this.submission?.after, this.unconfirmed?.after];
        const sent = (id: string): boolean => out?.get(id)?.draft !== undefined || unconfirmed?.get(id)?.draft !== undefined;
        const holds = (id: string): boolean => current.get(id)?.draft !== undefined || baseline.get(id)?.draft !== undefined
            || landedEntries.get(id)?.after.draft !== undefined || taken.has(id) || sent(id);
        const snapshot = base?.type === "snapshot" ? base.value : undefined;
        const printKey = this.binding.keyType === undefined ? undefined : keyPrinter(this.binding.keyType);
        const idField = this.binding.idField;
        return {
            has: (id) => also?.has(id) === true || holds(id) || (snapshot !== undefined && this.inSnapshot(snapshot, id).type === "some"),
            ids: function* () {
                if (also !== undefined) yield* also;
                for (const id of current.keys()) if (holds(id)) yield id;
                for (const id of baseline.keys()) if (holds(id)) yield id;
                for (const id of landedEntries.keys()) if (holds(id)) yield id;
                for (const id of out?.keys() ?? []) if (sent(id)) yield id;
                for (const id of unconfirmed?.keys() ?? []) if (sent(id)) yield id;
                yield* taken;
                if (snapshot === undefined) return;
                if (printKey !== undefined) for (const key of (snapshot as ReadonlyMap<unknown, unknown>).keys()) yield printKey(key);
                else if (idField !== undefined) for (const entry of snapshot as readonly Record<string, unknown>[]) yield entry[idField] as string;
            },
        };
    }

    /**
     * Another key for a new entry whose own the source has come to hold as another's (#1583), and the entry's version
     * under it: made by the collection's rule from the id the first was made from, past every key known taken and
     * every one this carry-over has given already. None for a key the session did not make, or where its rule makes no
     * other — it throws, or answers none: the two entries are a conflict then.
     */
    private remade(id: string, version: EntryVersion<W>, base: Base, given: ReadonlyMap<string, unknown>): { readonly id: string; readonly version: EntryVersion<W> } | undefined {
        const keys = this.binding.keys;
        if (keys === undefined || !this.minted.has(id)) return undefined;
        const from = this.minted.get(id);
        const known = this.knownKeys(base, undefined);
        let next: string | undefined;
        try {
            next = keys.make({ has: (other) => stringEqual(other, id) || given.has(other) || known.has(other), ids: function* () { yield id; yield* given.keys(); yield* known.ids(); } }, from, id);
        } catch {
            next = undefined;
        }
        if (next === undefined || stringEqual(next, id) || given.has(next) || known.has(next)) return undefined;
        this.minted.set(next, from);
        // The source's, as another write's: no key is made under it again.
        this.taken.add(id);
        return { id: next, version: this.binding.underKey?.(next, version, id) ?? version };
    }

    /**
     * The host's rows show these entries as the source holds them now — read
     * again since their Save landed — so what the Save left of them is drawn
     * over the rows no longer ({@link EditSession.landed}).
     *
     * @param ids - The entries
     */
    shown(ids: Iterable<string>): void {
        let moved = false;
        for (const id of ids) if (this.landedEntries.delete(id)) moved = true;
        if (moved) this.changed();
    }
    /** The source's entry schema. */
    get entryType(): EastType { return this.binding.entryType; }
    /** A keyed source's key type; `undefined` for an Array source. */
    get keyType(): EastType | undefined { return this.binding.keyType; }
    /** The entry's draft schema: what a conflict's values are read with. */
    get draftType(): EastType { return this.binding.draftType; }
    /** The entry's fields that read as one ({@link ConflictRange}). */
    get ranges(): readonly ConflictRange[] { return this.binding.ranges ?? []; }
    /** The entry's fields that change together ({@link ConflictTogether}). */
    get together(): readonly ConflictTogether[] { return this.binding.together ?? []; }

    /**
     * The places that go with a conflict's place: where it is at a range's
     * start or end, the fields the range names to go with it ({@link
     * ConflictRange.with}), under the same cases of the draft's own; none
     * elsewhere.
     *
     * @param at - The conflict's place
     * @returns The places
     */
    private readonly joined = (at: PatchPath): PatchPath[] => {
        // Its first field, past the cases of the draft's own, as {@link conflictFieldOf} reads it.
        const first = at.findIndex((step) => step.kind !== "variant");
        const step = first < 0 ? undefined : at[first];
        if (step === undefined || step.kind !== "field") return [];
        const range = this.ranges.find((r) => r.with !== undefined && (stringEqual(r.start, step.name) || stringEqual(r.end, step.name)));
        return (range?.with ?? []).map((name): PatchPath => [...at.slice(0, first), { kind: "field", name }]);
    };

    /**
     * The drafts as a reload keeps them (keep.ts): each entry drafted away
     * from what it began as, with what both began from — its original, or
     * what a carried-over conflict rewound it to. An entry back as it began —
     * undone, or discarded — is no draft to keep.
     */
    get keptEntries(): readonly KeptEntry<W>[] {
        const out: KeptEntry<W>[] = [];
        // A request the source has acknowledged is saved, whatever of it is still to be read back: what it left is what
        // each entry it held began from. One unchanged since is no draft to keep, and one changed since — put back by
        // Undo among them — is kept as a change from it. Kept from its original, a saved entry another write then
        // changed would be restored as a conflict over a change already saved, and one put back would not be kept.
        const saved = this.submission !== undefined && this.status === "reconciling" ? this.submission.after : undefined;
        for (const [id, version] of this.current) {
            const left = saved?.get(id);
            const original = left ?? this.baseline.get(id) ?? ABSENT;
            const was = left === undefined ? this.beganOf(id, version, original) : draftOf(left);
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
     * history starts at them: where an optimiser's result among them waited
     * for a person's Save ({@link EditSession.autosaveHeld}), nothing is left
     * to tell it from the rest, so every one of them waits.
     *
     * @param entries - The kept drafts
     * @param held - Whether an optimiser's result among them waited for a person's Save; `false` by default
     * @param stepped - Whether they stood where Undo or Redo had left them ({@link EditSession.autosaveStepped}), and so
     *   wait as they did, for a person's Save or the next change; `false` by default
     * @returns Whether they will be restored: `false` once the session has a base
     */
    restore(entries: readonly KeptEntry<W>[], held = false, stepped = false): boolean {
        if (this.base !== undefined) return false;
        this.restoring = entries;
        this.unaccepted = held && entries.length > 0;
        this.drafted = stepped && entries.length > 0 ? undefined : 0;
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
     * The request whose outcome the session does not know, as a reload keeps
     * it (keep.ts): one on its way or left with no answer, to send again; or
     * one sent again after no answer and refused, whose entries are still to
     * be read for what its first sending left ({@link EditSession.merge}).
     * `undefined` for any other: a request the source acknowledged is saved,
     * and what it left is what {@link EditSession.keptEntries} are kept from.
     * The same object while the request and where it stands hold.
     */
    get keptRequest(): KeptRequest<W> | undefined {
        const out = this.submission !== undefined && (this.status === "applying" || this.status === "unknown") ? this.submission : undefined;
        const held = out ?? this.unconfirmed;
        if (held === undefined) { this.keptRequestCache = undefined; return undefined; }
        const asked = out !== undefined ? "unanswered" : "refused";
        const cached = this.keptRequestCache;
        if (cached !== undefined && Object.is(cached.of, held) && cached.asked === asked) return cached.value;
        const minted = new Map<string, string | undefined>();
        for (const [id, from] of this.minted) if (held.targets.has(id)) minted.set(id, from);
        const value: KeptRequest<W> = {
            payload: held.payload, automatic: this.automatic, asked, minted,
            targets: [...held.targets.keys()].map((id) => ({ id, before: this.baseline.get(id) ?? ABSENT, after: held.after.get(id) ?? ABSENT })),
        };
        this.keptRequestCache = { of: held, asked, value };
        return value;
    }

    /**
     * Restore a request a reload kept (keep.ts), before the session's first
     * base, with the drafts kept beside it ({@link EditSession.restore}): at
     * that base the session is put back as it stood when the page went — its
     * drafts at the base the request was drafted at, the request unresolved —
     * and the request is sent again, under the same id. The source's answer is
     * then the request's own, and what was drafted since it was sent is a
     * change from what it leaves, as if the page had never gone. Over a source
     * held whole the request is not sent again: the page has read the
     * collection afresh, and each of the request's entries is judged by what
     * it holds ({@link EditSession.merge}), what did not land a draft still.
     *
     * Without it the reload forgot the request. A draft made since that put an
     * entry back as its edit began — an Undo of a removal the request saved —
     * was no draft to keep, and the entry was gone; one the request had saved
     * was carried over as unsaved, and could come back as a conflict to choose.
     *
     * @param request - The kept request
     * @returns Whether it will be restored: `false` once the session has a base
     */
    restoreRequest(request: KeptRequest<W>): boolean {
        if (this.base !== undefined) return false;
        this.resuming = request;
        return true;
    }

    /** A kept request and the drafts kept beside it, put back at the session's first base as they stood when the page went. */
    private resume(observed: Base, request: KeptRequest<W>, entries: readonly KeptEntry<W>[]): void {
        const batch = this.decodeBatch(request.payload);
        // The drafts stand at the base the request was drafted at, as they did: where the source is now is taken up once
        // the request is resolved, as it is for a session whose page never went.
        this.base = this.cloneBase(batch.base);
        const after = new Map(request.targets.map((target) => [target.id, target.after] as const));
        for (const { id, before } of request.targets) { this.baseline.set(id, before); this.current.set(id, before); }
        for (const entry of entries) {
            if (!this.baseline.has(entry.id)) this.baseline.set(entry.id, entry.was.type === "some" ? { draft: entry.was.value, wire: entry.beforeWire, place: entry.beforePlace } : ABSENT);
            // An entry as the request sent it is the request's own version of it: nothing drafted since.
            const sent = after.get(entry.id);
            this.current.set(entry.id, sent !== undefined && this.draftEqual(draftOf(sent), entry.draft) && placementEqual(sent.place, entry.place) ? sent
                : entry.draft.type === "some" ? { draft: entry.draft.value, wire: entry.wire, place: entry.place } : ABSENT);
        }
        const targets = new Map(request.targets.map((target) => [target.id, { before: this.optionOf(target.id, target.before), after: this.optionOf(target.id, target.after) }] as const));
        for (const [id, from] of request.minted) this.minted.set(id, from);
        this.automatic = request.automatic;
        this.draftsChanged();
        const apply = this.binding.apply;
        if (request.asked === "refused" || apply === undefined || batch.base.type === "snapshot") {
            // Sent again and refused before the page went, or no way to send it again here — or a source held whole,
            // which the page has read afresh: put back at the collection the request was drafted at, the session would
            // draw rows older than the page shows. Its entries are read where the source is now, and each judged by
            // what the source holds of it, as the drafts are carried over; what the request did not land is a draft
            // still, and the next Save's.
            this.unconfirmed = { payload: request.payload, after, targets };
            this.moving = { base: this.cloneBase(observed), read: new Map() };
            if (observed.type === "snapshot") { this.merge(observed, (id) => this.inSnapshot(observed.value, id)); return; }
            this.changed();
            return;
        }
        const placed = batch.changes.filter((change) => change.place.type === "some").map(({ id, place }) => ({ id, place }));
        this.binding.gate?.acquire();
        this.submission = {
            prepare: undefined, release: this.binding.gate?.release, expected: undefined, placed, payload: request.payload, apply, refresh: this.binding.refresh,
            after, targets, checked: new Map(), otherwise: new Map(), base: this.cloneBase(batch.base), revision: undefined, unanswered: true,
        };
        this.status = "unknown";
        this.changed();
        void this.send();
    }

    /**
     * What a request sent again after no answer, and refused, sent of an entry it changed ({@link EditSession.unconfirmed});
     * `undefined` for any other entry, and for one the request only placed, which says nothing of whether it landed.
     */
    private sentOf(id: string): EntryVersion<W> | undefined {
        const request = this.unconfirmed;
        const target = request?.targets.get(id);
        if (request === undefined || target === undefined || this.domainEqual(target.before, target.after)) return undefined;
        return request.after.get(id) ?? ABSENT;
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
        // Held whole, the collection as it reads now: what a new entry's key is made past, whatever base the drafts stand at.
        this.seen = base.type === "snapshot" ? base : undefined;
        if (this.base === undefined) {
            this.base = this.cloneBase(base);
            const kept = this.restoring;
            const request = this.resuming;
            this.restoring = undefined; this.resuming = undefined;
            if (request !== undefined) { this.resume(base, request, kept ?? []); return; }
            if (kept !== undefined && kept.length > 0) this.restoreAt(base, kept);
            return;
        }
        if (this.baseEqual(this.base, base)) return;
        if (this.locked) return; // Only reconcile() may acknowledge a submitted request.
        // With nothing drafted the source's rows are simply the session's — unless a request sent again after no answer
        // was refused: what its first sending left is still to be read, entry by entry ({@link EditSession.unconfirmed}).
        if (this.pending === 0 && this.unconfirmed === undefined) {
            this.base = this.cloneBase(base);
            this.baseline.clear(); this.current.clear(); this.ancestors.clear(); this.forgetConflicts(); this.history = []; this.cursor = 0;
            this.minted.clear();
            this.moving = undefined; this.stale = false; this.accepted = 0; this.unaccepted = false; this.drafted = 0;
            // What the last request left to say — a refusal, its issues — was of drafts taken back since, while they were
            // being carried over: with none left to carry, no merge ends it, and it would stand over no draft.
            this.status = "idle"; this.issues = []; this.error = undefined; this.conflicted = undefined; this.again = false;
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
     * its version at the old base. A new entry whose id the source has come to
     * hold as another's goes on under a new id, where the session made the
     * first ({@link EditSession.mint}), and is no conflict. A Save the
     * source refused because another write got there first is sent again,
     * once its drafts carry over with nothing to choose — a few times in a row
     * at most ({@link RESENDS}).
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
        const renumbered = new Map<string, string>();
        // For a host that draws what the session knows over rows read before ({@link EditSession.landed}): the revision the
        // drafts are carried from, whose rows hold nothing of the write that moved the source on — or none, carried over
        // at the revision the session is at already, where only rows read at another revision are from before.
        const lands = this.binding.drawsLanded === true && this.base?.type === "revision" && base.type === "revision";
        const from = lands && this.base?.type === "revision" && base.type === "revision" && !stringEqual(this.base.value, base.value) ? this.base.value : undefined;
        for (const [id, mine] of this.current) {
            const now = carrying.read.get(id)!;
            const source: option<unknown> = now.type === "some" ? some(liftDraft(this.binding.draftType, now.value)) : none;
            const began = this.baseline.get(id) ?? ABSENT;
            // An entry of a request sent again after no answer and refused: its first sending may have landed, and what
            // both began from is judged by what the source holds, a part at a time ({@link EditSession.unconfirmed}).
            // Held whole as the request left it, what the request sent is the entry's original.
            const sent = this.sentOf(id);
            const either = sent === undefined ? undefined : this.merger.eitherBegan(draftOf(began), draftOf(sent), draftOf(mine), source);
            const original = sent !== undefined && either !== undefined && this.merger.equal(either, draftOf(sent)) ? sent : began;
            // A new entry whose id another write added meanwhile is a second new entry, not the same one changed both
            // ways: either choice between them would lose one. Where the session made the id, it makes another — but
            // never for an entry of such a request, which the entry under its key may be.
            const moved = sent === undefined && original.draft === undefined && mine.draft !== undefined && now.type === "some" ? this.remade(id, mine, base, current) : undefined;
            if (moved !== undefined) {
                baseline.set(moved.id, ABSENT);
                current.set(moved.id, moved.version);
                renumbered.set(id, moved.id);
                continue;
            }
            const held = this.versionOf(id, source, original);
            // The entry as the source holds it now, read here by its key, while its host's rows are from before: the host
            // draws it over them until they are read again. Left to those rows, an entry the session lets go of here —
            // its draft the source's now — would show as they last held it: a row removed on both sides, back on the
            // grid; and so would one whose draft is taken back later.
            if (lands) this.landedEntries.set(id, { before: original, after: held, from });
            const merged = this.merger.merge(either ?? this.beganOf(id, mine, original), draftOf(mine), source, this.joined);
            // A draft the source's value holds whole is a draft no more.
            if (this.merger.equal(merged.draft, source)) continue;
            baseline.set(id, held);
            current.set(id, this.versionOf(id, merged.draft, mine));
            if (merged.ancestor !== undefined) ancestors.set(id, merged.ancestor);
        }
        // What the source said of each entry, where it refused a Save for a conflict: kept for the conflicts carried over.
        const said = this.refusalWords();
        const refused = this.status === "conflict";
        // An optimiser's result no person's Save had taken goes on waiting, with every draft: the steps that told it apart go.
        const waits = this.heldFrom !== undefined;
        // And so does what Undo or Redo had left, away from where the last change did: nothing is left to step back with.
        const stepped = this.stepped;
        this.base = this.cloneBase(base);
        this.baseline = baseline; this.current = current; this.ancestors = ancestors; this.forgetConflicts(); this.said = said;
        this.renumberedIds = renumbered;
        this.forgetMade();
        this.moving = undefined; this.unconfirmed = undefined;
        this.history = []; this.cursor = 0; this.accepted = 0; this.unaccepted = waits && current.size > 0;
        this.drafted = stepped && current.size > 0 ? undefined : 0;
        this.status = "idle"; this.issues = []; this.error = undefined; this.conflicted = undefined;
        this.draftsChanged();
        // A refused Save goes again with nothing to choose; with a conflict, the person's Save sends it once it is chosen.
        this.again = (refused || this.again) && this.unsettled === 0 && this.resent < RESENDS;
        this.changed();
        if (this.again) queueMicrotask(() => this.resend());
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
        return this.settleTogether(id, [path], choice);
    }

    /**
     * Settle several conflicts of an entry one way — a range's start and end
     * ({@link ConflictRange}) — as one step of the history, which Undo takes
     * back.
     *
     * @param id - The entry
     * @param paths - The conflicts' patch paths
     * @param choice - Which value stands
     * @returns Whether anything moved
     */
    settleTogether(id: string, paths: readonly string[], choice: ConflictChoice): boolean {
        return this.settleEach(new Map([[id, paths]]), choice);
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
        // One that reads again is among the open ones already.
        for (const settled of this.settledPoints.values()) {
            if (settled.choice !== choice && targets.get(settled.id)?.some((path) => stringEqual(path, settled.point.path)) !== true) add(settled.id, settled.point.path);
        }
        return this.settleEach(targets, choice);
    }

    private settleEach(targets: ReadonlyMap<string, readonly string[]>, choice: ConflictChoice): boolean {
        // Not while the drafts are carried over again: the conflicts are read afresh once they are.
        if (!this.writable || this.moving !== undefined) return false;
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
                // The conflict's place, and those that go with it: a range's, settled with its times.
                const at = pathFromString(path);
                const places = [at, ...this.joined(at)];
                const point = open.get(id)?.points.find((candidate) => stringEqual(candidate.path, path));
                // Settled before, and still so. One that reads again — the other side taken, then the part changed again
                // by a gesture — is chosen as an open one is, over the draft as it stands: put back as it stood before
                // its first choice, the draft would lose the change made since.
                if (prior !== undefined && point === undefined) {
                    // Settled the other way before: settled this way now.
                    if (prior.choice === choice) continue;
                    if (choice === "source") {
                        // A part of an entry removed since its choice is no part to take: the other side's value
                        // there would bring the whole entry back, its person's removal undone.
                        if (draft.type === "none" && prior.point.at.length > 0) continue;
                        draft = this.merger.takeSourceAt(draft, source, places);
                    } else {
                        // Only while the draft holds the other side there, as its choice left it. Changed since by a
                        // gesture that leaves no conflict — the entry removed, as the other side has it or not — the
                        // draft is its person's as it stands: put back as it stood before the choice, a row removed
                        // since would be back.
                        if (!this.merger.equal(this.merger.takeSourceAt(draft, source, places), draft)) continue;
                        draft = this.merger.takeSourceAt(draft, prior.draft, places);
                        if (next !== undefined) next = this.merger.keepDraftAt(next, source, places);
                    }
                    settledBefore.set(key, prior);
                    settledAfter.set(key, { ...prior, choice });
                    continue;
                }
                if (point === undefined || was === undefined || next === undefined) continue;
                settledBefore.set(key, prior);
                settledAfter.set(key, { id, key: this.keyOf?.(id), point, choice, draft: draftOf(mine), source, was, said: this.said.get(id) });
                if (choice === "source") draft = this.merger.takeSourceAt(draft, source, places);
                else next = this.merger.keepDraftAt(next, source, places);
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
        if (this.accepted > this.cursor) this.accepted = this.cursor;
        this.history.splice(this.cursor);
        this.history.push({
            label, origin: "settle", before, after,
            ancestors: { before: ancestorsBefore, after: ancestorsAfter },
            settled: { before: settledBefore, after: settledAfter },
        });
        this.cursor++;
        // A choice is a change as any is: the steps stand where it left them.
        this.drafted = this.cursor;
        this.gestured();
        if (before.size > 0) this.emit(before, after, "settle", label);
        this.changed();
        return true;
    }

    /**
     * What an entry's draft and its original — the source's value, as the session holds it — both began from, as they
     * read now: the original, or, where a carry-over left a conflict, the original put back to what both began from at
     * each conflict the draft still reads ({@link EntryMerger.began}). What a carry-over kept of a conflict the draft
     * has since left by a gesture — its part changed by hand to the source's value — is no longer what both began from.
     */
    private beganOf(id: string, mine: EntryVersion<W>, original: EntryVersion<W>): option<unknown> {
        const kept = this.ancestors.get(id);
        return kept === undefined ? draftOf(original) : this.merger.began(kept, draftOf(mine), draftOf(original), this.joined);
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

    /**
     * An entry's version holding a draft the session made: the collection's projection of it, else the one it had. A
     * keyed source's entry stands in its key's order, whatever the version it is made from: one made from an entry
     * that was absent — the source's, where both sides added it; the draft's, where the other side of its removal is
     * taken — would stand nowhere, and count as a change of its place still to save.
     */
    private versionOf(id: string, draft: option<unknown>, as: EntryVersion<W>): EntryVersion<W> {
        if (draft.type === "none") return ABSENT;
        const wire = this.binding.wireOf === undefined ? as.wire : this.binding.wireOf(id, draft.value, as.wire);
        return { draft: draft.value, wire, place: this.keyOf === undefined ? as.place : KEY_ORDER };
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
     * A gesture that `joins` the last step — recorded with the same key, that
     * step the last and nothing redone past it — is that step: one Undo takes
     * both back (a phone's cell editor, its edits to one cell while it stays
     * open, `Mobile Sheet Spec.md` SH10.1). A step the joins bring back to
     * where it began goes.
     *
     * @param updates - Each entry the gesture changed, once
     * @param origin - The gesture
     * @param label - Its label in the history
     * @param joins - The key of the run of gestures it is one step with; none by default
     * @returns Whether anything changed
     * @throws {Error} When an entry appears twice
     */
    record(updates: readonly EntryUpdate<W>[], origin: Origin, label: string, joins?: string): boolean {
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
        // Nothing drafted any more of what waited for a person's Save — saved, or the source's now: this gesture waits for none.
        if (this.unaccepted && this.pending === 0) this.unaccepted = false;
        for (const [id, entry] of before) if (!this.baseline.has(id)) this.baseline.set(id, entry);
        for (const [id, entry] of after) this.current.set(id, entry);
        // A key the session made, its entry recorded: its own from here ({@link EditSession.ownKeys}).
        for (const id of after.keys()) {
            if (!this.offered.has(id)) continue;
            this.minted.set(id, this.offered.get(id));
            this.offered.delete(id);
        }
        this.draftsChanged();
        const last = this.cursor > 0 && this.cursor === this.history.length ? this.history[this.cursor - 1] : undefined;
        if (joins !== undefined && last?.joins !== undefined && stringEqual(last.joins, joins) && last.ancestors === undefined && last.settled === undefined) {
            // One step with the last: it begins where that one began, and ends here.
            for (const [id, entry] of before) if (!last.before.has(id)) last.before.set(id, entry);
            for (const [id, entry] of after) last.after.set(id, entry);
            if (this.changes(last.before, last.after, true).length === 0) { this.history.pop(); this.cursor--; }
        } else {
            // What Redo could replay goes, and with it what a person's Save had taken of it.
            if (this.accepted > this.cursor) this.accepted = this.cursor;
            this.history.splice(this.cursor); this.history.push({ label, origin, before, after, joins }); this.cursor++;
        }
        // The newest change: the steps stand where it left them, an automatic Save's from here ({@link EditSession.stepped}).
        this.drafted = this.cursor;
        this.gestured();
        this.emit(before, after, origin, label);
        this.changed();
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
        this.gestured();
        this.emit(step.after, step.before, "undo", `Undo ${step.label}`);
        this.changed();
    }
    /** Redo the next transaction. */
    redo(): void {
        if (!this.canRedo) return;
        const step = this.history[this.cursor++]!;
        for (const [id, entry] of step.after) this.current.set(id, entry);
        if (step.ancestors !== undefined) this.setAncestors(step.ancestors.after);
        if (step.settled !== undefined) this.setSettled(step.settled.after);
        this.draftsChanged();
        this.gestured();
        this.emit(step.before, step.after, "redo", `Redo ${step.label}`);
        this.changed();
    }
    /** Discard every draft, and the history with them. */
    discard(): void {
        if (!this.canDiscard) return;
        const before = this.current;
        // Drafts being carried over began from another base than the one they are carried to: kept drafts restored as
        // a page loads began from the page before. Put back as they began they would be no rows of this base's, held as
        // the session's own with nothing left to read them again — a row saved since shown as it stood before.
        const carried = this.moving !== undefined;
        this.current = new Map(this.baseline);
        this.draftsChanged();
        this.emit(before, this.current, "discard", "Discard changes");
        if (carried) { this.baseline.clear(); this.current.clear(); this.draftsChanged(); }
        this.ancestors.clear(); this.forgetConflicts(); this.moving = undefined; this.again = false; this.unconfirmed = undefined;
        this.history = []; this.cursor = 0; this.stale = false; this.accepted = 0; this.unaccepted = false; this.automatic = false;
        this.minted.clear();
        this.drafted = 0;
        this.status = "idle"; this.issues = []; this.error = undefined; this.conflicted = undefined;
        this.changed();
    }

    /**
     * Send again a Save the source refused because another write got there
     * first, its drafts carried over with nothing to choose ({@link RESENDS}):
     * unless the person's Save or Discard came first.
     */
    private resend(): void {
        // Carried over again meanwhile: that carry-over sends it.
        if (!this.again || this.moving !== undefined) return;
        this.again = false;
        // An automatic Save's own, sent again, is one still: what an automatic Save may send as the drafts stand now.
        const stop = this.automatic ? this.heldFrom : undefined;
        if (stop === "all" || (this.automatic ? !this.canAutosaveTo(stop) : !this.canApply)) return;
        this.resent++; void this.send(stop);
    }

    /** Apply the batch, as the person's Save does; a retry keeps the original immutable bytes and captured callback. */
    async apply(): Promise<void> {
        this.again = false; this.resent = 0;
        // A person's Save takes every step done so far, an optimiser's result among them. Their Retry of a write left with
        // no answer sends that request again as it was, and takes nothing more.
        let took = false;
        if (this.status !== "unknown") { this.automatic = false; took = this.take(); }
        // What it took is said with the Save itself: whoever hears the session finds the request out, never the drafts
        // idle after the press — a screen that asked for the Save would read that as one that cannot land.
        const said = this.serial;
        const sending = this.send();
        if (took && this.serial === said) this.changed();
        await sending;
    }

    /**
     * A person's Save takes every step done so far — this session's own Save,
     * or one history's over several, for each of its sessions: an optimiser's
     * result among them waits for one no more ({@link EditSession.heldFrom}),
     * and where the steps stand — stepped to or not — is the person's
     * ({@link EditSession.stepped}).
     */
    accept(): void {
        if (this.take()) this.changed();
    }

    /** Takes every step done so far for a person's Save, saying nothing of it: whether anything was left to take. */
    private take(): boolean {
        if (this.accepted === this.cursor && !this.unaccepted && !this.stepped) return false;
        this.accepted = this.cursor; this.unaccepted = false; this.drafted = this.cursor;
        return true;
    }

    /**
     * An automatic Save (`autosave.ts`): sends what one may — every change
     * made before an optimiser's result that waits — and takes nothing, as a
     * person's Save does.
     *
     * @returns Whether the source took it: `false` where it refused it, gave no answer, or was asked nothing
     */
    autosave(): Promise<boolean> { return this.autosaveTo(this.heldFrom); }

    /**
     * An automatic Save that stops at a depth: this session's own
     * ({@link EditSession.autosave}), or one history's over several, which
     * stops each of its sessions where its order of the gestures says.
     *
     * @param stop - Where it stops ({@link EditSession.heldFrom}); `undefined` for nowhere
     * @returns Whether the source took it
     */
    async autosaveTo(stop: number | "all" | undefined): Promise<boolean> {
        if (stop === "all" || !this.canAutosaveTo(stop)) return false;
        this.again = false; this.resent = 0; this.automatic = true;
        return this.send(stop);
    }

    /**
     * Ask again (`autosave.ts`): a write left with no answer is sent again,
     * its id unchanged; a read back is asked for again.
     */
    retry(): void {
        if (this.status === "unknown") void this.send();
        else if (this.status === "reconciling") this.refresh();
    }

    /**
     * Send the batch: the person's Save, an automatic one, or the session's
     * own again after a refusal ({@link RESENDS}).
     *
     * @param upTo - For an automatic Save that stops before an optimiser's result, the depth it stops at
     * @returns Whether the source took it
     */
    private async send(upTo?: number): Promise<boolean> {
        if (this.status === "applying" || this.status === "reconciling") return false;
        if (!this.submission) {
            // What it sends: the drafts as they stand, or as they stood before the step it stops at.
            const drafts = this.draftsBefore(upTo);
            if (drafts === undefined || !this.canSend || this.unsettled !== 0 || this.status !== "idle" || !this.sendable(drafts)) return false;
            if (!this.base || !this.binding.apply) return false;
            const depth = upTo === undefined ? this.cursor : Math.min(upTo, this.cursor);
            // Sent as they stood before steps a person's Save had taken — after an Undo — it holds those no more.
            if (this.accepted > depth) this.accepted = depth;
            const batch: Batch = {
                requestId: randomId(), base: this.base,
                label: this.history[depth - 1]?.label ?? "Apply changes",
                changes: this.changes(this.baseline, drafts, false),
            };
            if (!batch.changes.length) return false;
            let expected: Uint8Array | undefined;
            if (this.base.type === "snapshot") {
                if (!this.transform) throw new Error("Inline editing requires its entry identity field or its key type");
                const result = this.transform(this.base.value, batch, none);
                if (result.type === "conflict") { this.status = "conflict"; this.issues = result.value; this.changed(); return false; }
                // A positional source's target is its whole collection, its order
                // included — beside another write's, the batch's own entries where
                // it placed them; a keyed source's order is its keys', so its
                // target is the batch's own entries (#1185).
                if (this.keyOf === undefined) expected = this.encodeCollection(result.value);
            }
            const targets = new Map(batch.changes.map(change => [change.id, {
                before: this.optionOf(change.id, this.baseline.get(change.id)),
                after: this.optionOf(change.id, drafts.get(change.id)),
            }]));
            const payload = this.encodeBatch(batch);
            this.binding.gate?.acquire();
            const placed = batch.changes.filter((change) => change.place.type === "some").map(({ id, place }) => ({ id, place }));
            this.submission = { prepare: this.binding.prepare, release: this.binding.gate?.release, expected, placed, payload, apply: this.binding.apply, refresh: this.binding.refresh, after: new Map(drafts), targets, checked: new Map(), otherwise: new Map(), base: this.cloneBase(this.base), revision: undefined };
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
                this.changed(); return false;
            }
        }
        let result: ApplyResult;
        try { result = await request.apply(request.payload.slice()); }
        catch (error) {
            request.unanswered = true;
            this.status = "unknown"; this.error = error instanceof Error ? error.message : String(error); this.changed(); return false;
        }
        if (result.type !== "applied") {
            this.submission = undefined; request.release?.();
            // Sent again after no answer: the refusal is of this sending alone, and the first may have landed. Each of
            // its entries is judged by what the source holds of it, as the drafts are carried over.
            if (request.unanswered === true) this.unconfirmed = { payload: request.payload, after: request.after, targets: request.targets };
            // Refused, with nothing of it left to save — every draft taken back while the request was out: the session
            // has nothing to say of it. Its refusal said, it would stand over no draft, Save off, until the person's next
            // gesture. (What a request sent again after no answer may have left is judged all the same, once the source
            // is seen to have moved.)
            if (this.pending === 0) { this.status = "idle"; this.issues = []; this.changed(); return false; }
            this.status = result.type; this.issues = result.value;
            // At a revision base the source names no entry it would have to
            // read itself whole for (#1199): the session reads them at the
            // revision the source moves to (`nameConflicts`), and says the
            // source's own words for itself meanwhile.
            if (result.type === "conflict" && request.base.type === "revision") {
                this.conflicted = { revision: request.base.value, targets: request.targets, issues: result.value };
                const own = result.value.filter((issue) => issue.entry === "");
                if (own.length > 0) this.issues = own;
            }
            this.changed(); return false;
        }
        if (request.base.type === "revision" && result.value.revision.type !== "some") {
            // The session's own text, canonical; the history bar words it (#861).
            request.unanswered = true;
            this.status = "unknown"; this.error = SESSION_TEXT.noRevision; this.changed(); return false;
        }
        request.revision = result.value.revision.type === "some" ? result.value.revision.value : undefined;
        this.status = "reconciling"; this.changed();
        this.refresh();
        return true;
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
     * Where the read back of a Save the source acknowledged stands (#1573):
     * `"waiting"` while the session reads its saved state back, `"failed"`
     * once a read back failed — a refresh that threw, or a confirmation read
     * that could not read the source ({@link EditSession.confirmFailed}) — and
     * `undefined` while it reads none back. The history bar shows a waiting
     * one on Save, and a failed one is its Retry refresh's to ask again.
     */
    get readBack(): "waiting" | "failed" | undefined {
        if (this.status !== "reconciling") return undefined;
        return this.error === undefined ? "waiting" : "failed";
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
            // At the revision it committed, or a later one: never the one it was drafted at, which holds nothing of it —
            // but where the source holds that content again, each change put back ({@link EditSession.putBack}).
            if (request.revision === undefined || request.base.type !== "revision" || (stringEqual(revision, request.base.value) && !this.putBack(request))) return [];
            return [...request.targets.keys()].filter(id => !request.checked.has(id)).slice(0, limit);
        }
        const conflict = this.conflicted;
        if (conflict === undefined || this.status !== "conflict") return [];
        // At the revision it was drafted at too, each entry once: one whose change no longer applies there began from a
        // version read before that revision (`nameConflicts`).
        const checked = conflict.checked !== undefined && stringEqual(revision, conflict.checked.revision) ? conflict.checked.matches : undefined;
        return [...conflict.targets.keys()].filter(id => !checked?.has(id)).slice(0, limit);
    }

    /**
     * Retire the drafts once the source reads back as the acknowledged request
     * left it: an inline positional source's whole collection, its order
     * included — or, where another write landed beside the request first, its
     * own entries, each where it placed them; an inline keyed source's own
     * entries, whatever another write did to the others (#1185) — either one
     * once any entry of the request's shows the request landed, an entry
     * another write changed again since acknowledged with its newer value
     * ({@link EditSession.landedIn}); a source that
     * names its revisions, the request's entries read at the revision it
     * committed or a later one — an entry another write changed since,
     * acknowledged with its newer value, and one still as its edit began, read
     * before the commit landed, judged by a later read.
     *
     * An entry reads back as the request left it when the source holds it
     * otherwise than its edit began, with what the request set — the change,
     * undone, applies to it — so a field another write set beside the
     * request's is the source's. The session's versions of such an entry are
     * behind the source then: what was not drafted since the request was sent
     * goes, with the history, as when the source moves under no drafts, and
     * what was is kept, merged over the source's value
     * ({@link EditSession.behind}).
     *
     * What was drafted while the request was unresolved stands through it: an
     * entry the request held has what it left for its original, so a draft
     * made since is a change from that, and the next Save's to send.
     *
     * @param base - The base the source is at now
     * @param read - An entry the request changed, as a source at a revision holds it: its value, `none` for one it does not hold, or `undefined` while it is not read
     * @returns Whether the request was acknowledged
     */
    reconcile(base: Base, read: (id: string) => option<unknown> | undefined): boolean {
        const request = this.submission;
        if (!request || this.status !== "reconciling") return false;
        // At a revision: the one the request committed, or a later one — another write may land before the session reads
        // its own (two Saves at once) — never the one it was drafted at, but where the source holds that content again.
        if (request.base.type === "revision" && (base.type !== "revision" || request.revision === undefined || (stringEqual(base.value, request.base.value) && !this.putBack(request)))) return false;
        if (request.base.type === "snapshot" && base.type !== "snapshot") return false;
        // Whether every entry reads back as the session's versions hold it.
        let exact = true;
        if (request.expected !== undefined) {
            // Another write may land beside the request before the session reads it back (two Saves at once): then
            // the collection is not the request's, but holds the request's entries as it left them — or, where another
            // write changed one of them again since, shows by its entries that the request landed.
            if (!blobEqual(this.encodeCollection(base.value), request.expected)) {
                if (!this.leftIn(base, request) && !this.landedIn(request, (id) => this.inSnapshot(base.value, id))) return false;
                exact = false;
                // Each of its entries the collection holds otherwise than the request left it, as it holds it.
                request.otherwise.clear();
                for (const [id, target] of request.targets) {
                    const now = this.inSnapshot(base.value, id);
                    if (!this.domainEqual(now, target.after)) request.otherwise.set(id, now);
                }
            }
        } else if (base.type === "snapshot") {
            const held = (id: string): option<unknown> => this.heldIn(base.value, id);
            if (!this.landedIn(request, held)) return false;
            // Read whole at each pass: what an earlier pass read otherwise is read again here.
            request.otherwise.clear();
            for (const [id, target] of request.targets) {
                const now = held(id);
                if (this.domainEqual(now, target.after)) continue;
                exact = false;
                request.otherwise.set(id, now);
            }
        } else {
            // At the revision the source answered the request with, it holds the request: that revision is the one the
            // request committed, or — for a request the source took before and answers again, as e3 answers one it
            // remembers — the one it was at as it answered, a later one. Every revision it reads at from here is later still.
            if (stringEqual(base.value, request.revision!)) request.reached = true;
            const before = request.checked.size;
            for (const [id, target] of request.targets) {
                if (request.checked.has(id)) continue;
                const now = read(id);
                if (now === undefined) continue;
                if (this.leftAs(now, target)) {
                    const exact = this.domainEqual(now, target.after);
                    request.checked.set(id, exact);
                    if (!exact) request.otherwise.set(id, now);
                }
                // Another write changed it since the request landed: acknowledged, the newer value the source's. One the
                // change still applies to was read before the request landed, and a later read judges it — unless the
                // source has read at the revision it answered the request with: then another write put the entry back as
                // it was, and no later read would ever tell it from one the request has yet to reach. At that very
                // revision too: answered again, the source names the revision it is at, where a row the request
                // added may be gone again, or one it changed be as it was.
                else if (!this.applies(now, target) || request.reached === true) {
                    request.checked.set(id, false);
                    request.otherwise.set(id, now);
                }
            }
            if (request.checked.size !== request.targets.size) {
                // Advancing schedules the next bounded batch, even when the
                // pages just read are the reader's last tracked dependencies.
                if (request.checked.size !== before) this.changed();
                return false;
            }
            for (const match of request.checked.values()) exact &&= match;
        }
        // What the Save landed, for a host whose rows are read apart from this confirmation to draw until they read it
        // again: each entry as it began, and as the source holds it now — the request's version, or the one read back.
        // (None where the source reads at the very revision the request was drafted at: its rows there are as its host
        // read them before the Save, which is what the source holds again.)
        if (this.binding.drawsLanded === true && request.base.type === "revision" && !(base.type === "revision" && stringEqual(base.value, request.base.value))) {
            for (const id of request.targets.keys()) {
                const saved = request.after.get(id) ?? ABSENT;
                const otherwise = request.otherwise.get(id);
                const after = otherwise === undefined ? saved
                    : this.versionOf(id, otherwise.type === "some" ? some(liftDraft(this.binding.draftType, otherwise.value)) : none, saved);
                this.landedEntries.set(id, { before: this.baseline.get(id) ?? ABSENT, after, from: request.base.value });
            }
        }
        this.base = this.cloneBase(base); this.ancestors.clear(); this.forgetConflicts(); this.moving = undefined;
        this.submission = undefined; request.release?.(); this.status = "idle"; this.error = undefined; this.confirmReason = undefined; this.issues = []; this.stale = false;
        this.conflicted = undefined;
        // What the request left is the original of each entry it held; one first drafted since it was sent keeps its own.
        // The drafts stand, so what was drafted since is what is left to save.
        if (exact) {
            for (const [id, version] of request.after) this.baseline.set(id, version);
            // A choice the Save has taken is no conflict to bring back: a step that settled one keeps the versions it
            // moved, and Undo of it puts back nothing of the conflict — what both began from, put back, would read
            // against what the Save left, and ask again at the source's next change of a part no draft changes.
            for (const step of this.history) { step.ancestors = undefined; step.settled = undefined; }
        } else this.behind(request);
        // Read whole, the collection the request is acknowledged at may hold an entry otherwise than a draft made since
        // the request was sent began from: drafted from rows read before another write's, the base moving on under the
        // request unseen. Those drafts are carried over to the collection, as to any the source moves to — a part both
        // changed a conflict to choose. Left as they began, their Save would be refused over the session's own base,
        // with nothing newer for the source to move to and nothing to choose.
        if (base.type === "snapshot" && this.draftedBehind(base.value)) {
            this.moving = { base: this.cloneBase(base), read: new Map() };
            this.merge(base, (id) => this.inSnapshot(base.value, id));
        }
        // An earlier request, sent again after no answer and refused, is still to be judged: this one's landing says
        // nothing of it — a source checks an entry's change against that entry alone, so a Save of other entries lands
        // whether the earlier one did or not. Its entries are read where the source is now, as for any carry-over.
        if (this.unconfirmed !== undefined && this.moving === undefined) {
            this.moving = { base: this.cloneBase(base), read: new Map() };
            if (base.type === "snapshot") this.merge(base, (id) => this.inSnapshot(base.value, id));
        }
        this.changed();
        if (request.confirmed !== undefined) {
            const confirmed = request.base.type === "revision" && base.type === "revision"
                ? this.heldAt(base.value, request.targets, "after", request.checked) : undefined;
            queueMicrotask(() => request.confirmed!(confirmed));
        }
        return true;
    }

    /** Whether a collection read whole holds some drafted entry otherwise than its draft began from. */
    private draftedBehind(collection: unknown): boolean {
        for (const id of this.current.keys()) {
            if (!this.domainEqual(this.optionOf(id, this.baseline.get(id)), this.inSnapshot(collection, id))) return true;
        }
        return false;
    }

    /**
     * Whether a source that reads at the revision a request was drafted at holds that content again, after the
     * request's commit — each of its changes put back by another write — and so is read there as at any later
     * revision. A revision names content, as an e3 record's state hash does: a record whose rows are put back exactly
     * as they were is at the revision it was at before. That is so where the source answered the request with that
     * very revision — a source that took the request before answers with the one it is at — or has since read at the
     * one it answered with. Else a source at that revision is one that has yet to move: it holds nothing of the
     * request.
     *
     * @param request - The request, acknowledged by the source
     * @returns Whether a read at the revision it was drafted at is one after its commit
     */
    private putBack(request: Submission<W>): boolean {
        return request.base.type === "revision" && request.revision !== undefined
            && (request.reached === true || stringEqual(request.revision, request.base.value));
    }

    /**
     * A request read back otherwise than it was sent — another write beside
     * it, or since: the session's versions are behind the source. What was not
     * drafted since the request was sent is the source's now, and goes. What
     * was is kept as drafts are carried over ({@link EditSession.merge}): an
     * entry read back as it was sent, a change from what the request left; one
     * read back otherwise, merged three ways from the version the request
     * sent — the draft, and the source's value — a part both changed a
     * conflict to choose. The history starts over at what is left: an undo
     * would take an entry back to a version from before the other write.
     *
     * @param request - The request, each entry read back otherwise as the source holds it
     */
    private behind(request: Submission<W>): void {
        const baseline = new Map<string, EntryVersion<W>>();
        const current = new Map<string, EntryVersion<W>>();
        const ancestors = new Map<string, option<unknown>>();
        for (const [id, mine] of this.current) {
            const sent = request.after.get(id);
            // First drafted since the request was sent: no part of it.
            if (sent === undefined) {
                baseline.set(id, this.baseline.get(id) ?? ABSENT);
                current.set(id, mine);
                continue;
            }
            // As the request sent it: the source's now — but for an entry of an earlier request, sent again after no
            // answer and refused, which this one sent as it stood and changed nothing of: it is still to be judged by
            // what the source holds ({@link EditSession.unconfirmed}), and stays as its person has it until then.
            if (Object.is(mine, sent) && this.unconfirmed?.targets.has(id) !== true) continue;
            const otherwise = request.otherwise.get(id);
            if (otherwise === undefined) {
                baseline.set(id, sent);
                current.set(id, mine);
                continue;
            }
            const source: option<unknown> = otherwise.type === "some" ? some(liftDraft(this.binding.draftType, otherwise.value)) : none;
            const merged = this.merger.merge(draftOf(sent), draftOf(mine), source, this.joined);
            // A draft the source's value holds whole is a draft no more.
            if (this.merger.equal(merged.draft, source)) continue;
            baseline.set(id, this.versionOf(id, source, sent));
            current.set(id, this.versionOf(id, merged.draft, mine));
            if (merged.ancestor !== undefined) ancestors.set(id, merged.ancestor);
        }
        // An optimiser's result no person's Save had taken goes on waiting, with every draft: the steps that told it apart go.
        const waits = this.heldFrom !== undefined;
        // And so does what Undo or Redo had left, away from where the last change did.
        const stepped = this.stepped;
        this.baseline = baseline; this.current = current; this.ancestors = ancestors;
        this.history = []; this.cursor = 0; this.accepted = 0; this.unaccepted = waits && current.size > 0;
        this.drafted = stepped && current.size > 0 ? undefined : 0;
        this.forgetMade();
        this.draftsChanged();
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
     * At the revision the request was drafted at — the session's own — each
     * entry is read once too. Every change applies there while the write that
     * refused it is at a revision the session has yet to read, and the session
     * waits for it. One that does not began from a version read before that
     * revision: an entry first drafted while an earlier Save was out, or from
     * rows standing in while the revision was read, which another write
     * changed meanwhile. The source has nothing newer to move to, so the
     * drafts are carried over where it is ({@link EditSession.merge}), as to a
     * revision it moves to.
     *
     * @param base - The base the source is at now
     * @param read - An entry the request changed, as the source holds it at that base: its value, `none` for one it does not hold, or `undefined` while it is not read
     * @returns Whether the conflict's entries were named
     */
    nameConflicts(base: Base, read: (id: string) => option<unknown> | undefined): boolean {
        const conflict = this.conflicted;
        if (conflict === undefined || this.status !== "conflict" || base.type !== "revision") return false;
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
        if (stringEqual(base.value, conflict.revision)) {
            // Read at the revision the request was drafted at: named at none, and carried over there where a change no
            // longer applies — once, the carry-over then reading every draft there for itself.
            const behind = [...checked.values()].some((applies) => !applies);
            if (behind && this.moving === undefined && this.binding.carryOver !== false && this.base !== undefined && this.baseEqual(this.base, base)) {
                this.moving = { base: this.cloneBase(base), read: new Map() };
                this.changed();
            } else if (checked.size !== before) this.changed();
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
     * Whether an inline positional source holds a request's entries as it left
     * them, whatever another write did beside them: each, found by its identity
     * field, as the request left it ({@link EditSession.leftAs}), and each it
     * placed where it placed it — placed again by the same `Editing.apply` that
     * landed it, the collection stays as it is.
     *
     * @param base - The base the source is at now: its whole collection
     * @param request - The request
     * @returns Whether the collection holds the request's entries as it left them
     */
    private leftIn(base: Base, request: Submission<W>): boolean {
        if (base.type !== "snapshot" || this.transform === undefined) return false;
        const collection = base.value;
        for (const [id, target] of request.targets) {
            if (!this.leftAs(this.inSnapshot(collection, id), target)) return false;
        }
        if (request.placed.length === 0) return true;
        const changes: Change[] = [];
        for (const { id, place } of request.placed) {
            const now = this.inSnapshot(collection, id);
            if (now.type === "none") return false;
            changes.push({ id, patch: this.domainDiff(now, now), place });
        }
        const again = this.transform(collection, { requestId: "", base, label: "", changes }, none);
        return again.type === "applied" && blobEqual(this.encodeCollection(again.value), this.encodeCollection(collection));
    }

    /**
     * Whether a collection read whole was read after a request landed, by the
     * request's own entries. One commit lands whole, so one entry says it for
     * them all: an entry that reads as the request left it
     * ({@link EditSession.leftAs}), or as neither side of its change — the
     * part the request set, changed again by another write since, or the
     * entry removed. An entry still as its edit began beside one of those was
     * put back by another write, and is the source's.
     *
     * `false` while every entry reads as its edit began: the collection was
     * read before the request landed, and a later one judges it. Waited on,
     * a collection read after another write changed the same part would never
     * read as the request left it, and the Save would wait for good. (Every
     * entry put back exactly as it began, before the source was read again,
     * reads the same as a collection from before the request: nothing a
     * collection holds tells the two apart.)
     *
     * @param request - The request
     * @param held - An entry as the collection holds it: `none` for one it does not hold
     * @returns Whether an entry of the request's shows the request landed
     */
    private landedIn(request: Submission<W>, held: (id: string) => option<unknown>): boolean {
        for (const [id, target] of request.targets) {
            // A change of an entry's place alone says nothing of when the collection was read.
            if (this.domainEqual(target.before, target.after)) continue;
            const now = held(id);
            if (this.leftAs(now, target) || !this.applies(now, target)) return true;
        }
        return false;
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
