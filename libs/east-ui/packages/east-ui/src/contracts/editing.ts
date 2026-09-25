/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The editing contract (#879) — one transaction session for every editable
 * collection. A gesture edits DRAFTS (every field missing, a value, or text
 * that could not be read); each gesture is one undoable transaction, reported
 * to the host as a {@link EditingPatchEventTypeFor patch event}; and Apply
 * sends one checked, idempotent batch ({@link EditingChangeSetTypeFor}) against
 * the base the drafts began from, which {@link applyEditing} applies to a
 * collection atomically.
 *
 * The Sheet was first to speak it, and keeps its names for it —
 * `Sheet.Types.ChangeSet` is `Editing.Types.ChangeSet`, `Sheet.apply` is
 * `Editing.apply`. What only a sheet has (a new row's destination among a
 * group's children, the `newRow` / `newGroup` contexts) stays the Sheet's.
 *
 * @packageDocumentation
 */

import {
    ArrayType, AsyncFunctionType, BlobType, DictType, East, EastTypeType,
    FunctionType, IntegerType, NullType, OptionType, PatchType, SetType, StringType,
    StructType, VariantType, none, some, variant,
    type EastType, type ExprType, type PatchTypeOf,
} from "@elaraai/east";

// ============================================================================
// Placement, readiness, origins, results
// ============================================================================

/**
 * A position in an explicitly ordered collection.
 *
 * @property start - First
 * @property end - Last
 * @property before - Just before the entry with this id
 * @property after - Just after the entry with this id
 */
export const EditingPositionType = VariantType({ start: NullType, end: NullType, before: StringType, after: StringType });

/**
 * Where an entry stands: a position in an ordered collection, or the key order
 * of a keyed one.
 *
 * @property ordered - A position in an Array source
 * @property keyOrder - A keyed source's own order — its entries sort by key
 */
export const EditingPlacementType = VariantType({ ordered: EditingPositionType, keyOrder: NullType });

/**
 * One issue on a field, as an author check reports it.
 *
 * @property field - The field
 * @property message - What is wrong, in the author's words
 */
export const EditingFieldIssueType = StructType({ field: StringType, message: StringType });

/**
 * One entry's readiness, after the structural checks and the author's.
 *
 * @property ready - Nothing stands in the way
 * @property incomplete - Fields still missing
 * @property invalid - Fields whose text could not be read, or that a check refused
 */
export const EditingReadinessType = VariantType({
    ready: NullType, incomplete: ArrayType(EditingFieldIssueType), invalid: ArrayType(EditingFieldIssueType),
});

/**
 * An issue addressed to an entry, and optionally to a child row and a field.
 *
 * @property entry - The entry's id
 * @property row - The child row's index in a group's children, when it is one
 * @property field - The field, when the issue has one
 * @property message - What is wrong
 */
export const EditingIssueType = StructType({
    entry: StringType, row: OptionType(IntegerType), field: OptionType(StringType), message: StringType,
});

/**
 * The readiness of a whole batch — every draft's issues together.
 *
 * @property ready - The batch may be applied
 * @property incomplete - Fields still missing
 * @property invalid - Fields whose text could not be read, or that a check refused
 */
export const EditingBatchReadinessType = VariantType({
    ready: NullType, incomplete: ArrayType(EditingIssueType), invalid: ArrayType(EditingIssueType),
});

/**
 * The gesture that made one transaction — how a host tells typing from a
 * paste, a copilot's fill from a planner's drag, and a history step from both.
 *
 * @property typed - Typed into a cell
 * @property pasted - Pasted
 * @property fill - A copilot's fill taken
 * @property row - A copilot's row fill taken
 * @property pattern - A proposed row taken
 * @property insert - An entry inserted
 * @property move - An entry moved
 * @property remove - An entry removed
 * @property resize - An element's extent changed (#879 — a Plan run's start or end)
 * @property drop - Something dropped onto the collection from elsewhere (#879)
 * @property verdict - A review verdict (#879 — Approve, Reject, and their "all" forms)
 * @property undo - Undo
 * @property redo - Redo
 * @property discard - Drafts discarded
 */
export const EditingOriginType = VariantType({
    typed: NullType, pasted: NullType, fill: NullType, row: NullType, pattern: NullType,
    insert: NullType, move: NullType, remove: NullType, resize: NullType, drop: NullType, verdict: NullType,
    undo: NullType, redo: NullType, discard: NullType,
});

/**
 * The source's authoritative answer to one idempotent request.
 *
 * @property applied - Applied; a mutable source names the revision it committed
 * @property rejected - Refused as asked — revise the drafts before applying again
 * @property conflict - The source moved on — review or discard the drafts
 */
export const EditingApplyResultType = VariantType({
    applied: StructType({ revision: OptionType(StringType) }),
    rejected: ArrayType(EditingIssueType), conflict: ArrayType(EditingIssueType),
});

// ============================================================================
// Drafts
// ============================================================================

/**
 * One field of a draft — missing, a value of the field's type, or the text a
 * planner typed that could not be read, kept as typed.
 *
 * @typeParam T - The field's type
 * @param type - The field's type
 * @returns The field's draft variant
 */
export function EditingDraftFieldType<T extends EastType>(type: T) {
    return VariantType({ missing: NullType, value: type, invalid: StringType });
}

/** The field-by-field draft type of a domain struct. */
export type EditingDraftOf<R extends StructType> = StructType<{
    [K in keyof R["fields"]]: ReturnType<typeof EditingDraftFieldType<R["fields"][K]>>;
}>;

/**
 * Constructs the field-by-field draft type of a struct, including the fields
 * no column shows.
 *
 * @typeParam R - The domain row type
 * @param rowType - The complete domain struct
 * @returns The draft struct; an optional domain field still starts missing
 */
export function EditingDraftTypeFor<R extends StructType>(rowType: R): EditingDraftOf<R> {
    return StructType(Object.fromEntries(Object.entries(rowType.fields).map(([k, t]) => [k, EditingDraftFieldType(t)]))) as EditingDraftOf<R>;
}

/** Fields that can hold a group's child rows. */
export type EditingChildrenField<G extends StructType> = {
    [K in keyof G["fields"] & string]: G["fields"][K] extends ArrayType<StructType> ? K : never;
}[keyof G["fields"] & string];

/** The row type a group's child array holds. */
export type EditingChildOf<G extends StructType, F extends EditingChildrenField<G>> =
    G["fields"][F] extends ArrayType<infer R extends StructType> ? R : never;

/** A group's draft — its own fields drafted, its child array kept ordered, each child a draft. */
export type EditingDraftGroupOf<G extends StructType, F extends EditingChildrenField<G>> = StructType<{
    [K in keyof G["fields"]]: K extends F ? ArrayType<EditingDraftOf<EditingChildOf<G, F>>> : ReturnType<typeof EditingDraftFieldType<G["fields"][K]>>;
}>;

/** The declared child field of a group-or-row entry type (never inferred from arbitrary row fields). */
const children = new WeakMap<EastType, string>();

/**
 * Constructs a group's draft type, with drafts in its child array.
 *
 * @typeParam G - The complete group struct
 * @typeParam F - Its Array-of-structs child field
 * @param groupType - The group type
 * @param field - The child array field
 * @returns The group's draft struct
 * @throws {Error} When the named field is not an Array of structs
 */
export function EditingDraftGroupTypeFor<G extends StructType, F extends EditingChildrenField<G>>(groupType: G, field: F): EditingDraftGroupOf<G, F> {
    const t = groupType.fields[field];
    if (t?.type !== "Array" || t.value.type !== "Struct") throw new Error(`Editing: "${field}" must hold an Array of row structs`);
    const rowDraft = EditingDraftTypeFor(t.value);
    return StructType(Object.fromEntries(Object.entries(groupType.fields).map(([key, type]) => [key,
        key === field ? ArrayType(rowDraft) : EditingDraftFieldType(type),
    ]))) as EditingDraftGroupOf<G, F>;
}

/**
 * Constructs the union of groups carrying child rows and ungrouped rows. The
 * child field is recorded with the type, so {@link EditingDraftEntryTypeFor}
 * and {@link EditingPatchEventTypeFor} find it without being told again.
 *
 * @remarks
 * The Sheet names it `Sheet.Types.Entry`; the example below uses that name.
 *
 * @typeParam G - The group struct
 * @typeParam F - Its Array-of-structs child field
 * @param groupType - The group type
 * @param field - The child array field
 * @returns The group-or-row entry type
 * @throws {Error} When the child field is not an Array of structs
 * @example
 * ```ts
 * import { ArrayType, East, OptionType, StringType, StructType, none, some, variant } from "@elaraai/east";
 * import { Sheet } from "@elaraai/east-ui";
 *
 * const reordered = East.function([], ArrayType(StringType), ($) => {
 *     const TaskType = StructType({ id: StringType, task: StringType });
 *     const PackageType = StructType({ id: StringType, name: StringType, tasks: ArrayType(TaskType) });
 *     const Entry = Sheet.Types.Entry(PackageType, "tasks");
 *     const before = $.const(variant("group", { id: "p1", name: "P-40 roughing", tasks: [
 *         { id: "t1", task: "Machine blanks" }, { id: "t2", task: "Inspect lots" },
 *     ] }), Entry);
 *     const after = $.const(variant("group", { id: "p1", name: "P-40 roughing", tasks: [
 *         { id: "t2", task: "Inspect lots" }, { id: "t1", task: "Machine blanks" },
 *     ] }), Entry);
 *     const loose = $.const(variant("row", { id: "t9", task: "Pack for shipping" }), Entry);
 *     const entries = $.const([before, loose], ArrayType(Entry));
 *     const oldEntry = $.const(some(before), OptionType(Entry));
 *     const newEntry = $.const(some(after), OptionType(Entry));
 *     const batch = $.const({
 *         requestId: "reorder-roughing", base: variant("snapshot", entries), label: "Move a task",
 *         changes: [{ id: "p1", patch: East.diff(oldEntry, newEntry), place: none }],
 *     }, Sheet.Types.ChangeSet(Entry));
 *     const apply = $.const(Sheet.apply(Entry, "id"));
 *     const applied = $.const(apply(entries, batch, none).unwrap("applied"));
 *     return applied.map((_$, entry) => entry.match({
 *         group: (_$2, p) => East.str`${p.name}: ${p.tasks.map((_$3, t) => t.task).stringJoin(" → ")}`,
 *         row:   (_$2, t) => t.task,
 *     }));
 * });
 * ```
 */
export function EditingEntryTypeFor<G extends StructType, F extends EditingChildrenField<G>>(groupType: G, field: F): VariantType<{ group: G; row: EditingChildOf<G, F> }> {
    EditingDraftGroupTypeFor(groupType, field);
    const row = groupType.fields[field].value as EditingChildOf<G, F>;
    const entry = VariantType({ group: groupType, row });
    children.set(entry, field);
    return entry;
}

/** Child fields whose row type matches an entry union's ungrouped arm. */
type MatchingChildren<G extends StructType, R extends StructType> = {
    [K in EditingChildrenField<G>]: G["fields"][K] extends ArrayType<R> ? K : never;
}[EditingChildrenField<G>];

/** The draft type of a flat, grouped-only, or group-or-row entry. */
export type EditingDraftEntryOf<E extends EastType, F extends string = never> =
    E extends VariantType<{ group: infer G extends StructType; row: infer R extends StructType }>
        ? VariantType<{ group: EditingDraftGroupOf<G, MatchingChildren<G, R>>; row: EditingDraftOf<R> }>
        : E extends StructType ? [F] extends [never] ? EditingDraftOf<E> : EditingDraftGroupOf<E, F & EditingChildrenField<E>> : never;

/**
 * Constructs the draft equivalent of a source entry.
 *
 * @typeParam E - The entry schema
 * @typeParam F - A groups-only source's child field
 * @param entryType - A flat struct or a group-or-row union
 * @param field - The child field for a groups-only source
 * @returns The draft entry schema
 * @throws {Error} When a group union has no unambiguous child field
 */
export function EditingDraftEntryTypeFor<E extends EastType, F extends string = never>(entryType: E, field?: F): EditingDraftEntryOf<E, F> {
    if (entryType.type === "Struct") {
        return (field === undefined ? EditingDraftTypeFor(entryType) : EditingDraftGroupTypeFor(entryType, field)) as EditingDraftEntryOf<E, F>;
    }
    if (entryType.type === "Variant" && entryType.cases.group?.type === "Struct" && entryType.cases.row?.type === "Struct") {
        const group = entryType.cases.group as StructType;
        const row = entryType.cases.row as StructType;
        const candidates = Object.entries(group.fields).filter(([, t]) => t.type === "Array" && t.value === row);
        const childField = field ?? children.get(entryType) ?? (candidates.length === 1 ? candidates[0]![0] : undefined);
        if (childField === undefined) throw new Error("Editing: declare the child field with Entry(GroupType, field) — Sheet.Types.Entry / Editing.Types.Entry");
        return VariantType({ group: EditingDraftGroupTypeFor(group, childField), row: EditingDraftTypeFor(row) }) as EditingDraftEntryOf<E, F>;
    }
    throw new Error("Editing: entries must be row structs or a group/row variant of structs");
}

// ============================================================================
// Changes, batches and their base
// ============================================================================

/** The collection a source of entries `E` holds: an Array, or a Dict keyed by `K`. */
export type EditingCollectionOf<E extends EastType, K extends EastType | undefined> =
    [K] extends [EastType] ? DictType<K, E> : ArrayType<E>;

/**
 * Constructs the checked base of a batch — the revision a mutable source
 * committed, or the whole inline collection the drafts began from.
 *
 * @typeParam E - The source entry type
 * @typeParam K - A keyed source's key type; omitted for an Array
 * @param entryType - The source entry type
 * @param keyType - A keyed source's key type
 * @returns A revision token or the complete collection snapshot
 */
export function EditingBaseTypeFor<E extends EastType, K extends EastType | undefined = undefined>(entryType: E, keyType?: K): VariantType<{
    revision: StringType; snapshot: EditingCollectionOf<E, K>;
}> {
    const snapshot = keyType === undefined ? ArrayType(entryType) : DictType(keyType, entryType);
    return VariantType({ revision: StringType, snapshot }) as unknown as VariantType<{ revision: StringType; snapshot: EditingCollectionOf<E, K> }>;
}

/**
 * Constructs one composed entry patch and its placement.
 *
 * @typeParam E - The source entry type
 * @param entryType - The source entry type
 * @returns An entry-addressed East patch; `none` stands for an absent entry
 */
export function EditingChangeTypeFor<E extends EastType>(entryType: E) {
    return StructType({ id: StringType, patch: PatchType(OptionType(entryType)) as PatchTypeOf<OptionType<E>>, place: OptionType(EditingPlacementType) });
}

/**
 * Constructs an atomic request against a checked base — what `onApply`
 * receives.
 *
 * @typeParam E - The source entry type
 * @typeParam K - A keyed source's key type; omitted for an Array
 * @param entryType - The source entry type
 * @param keyType - A keyed source's key type
 * @returns The batch type
 */
export function EditingChangeSetTypeFor<E extends EastType, K extends EastType | undefined = undefined>(entryType: E, keyType?: K) {
    return StructType({
        requestId: StringType, base: EditingBaseTypeFor(entryType, keyType), label: StringType,
        changes: ArrayType(EditingChangeTypeFor(entryType)),
    });
}

/**
 * Constructs the result of {@link applyEditing}.
 *
 * @typeParam E - The source entry type
 * @typeParam K - A keyed source's key type; omitted for an Array
 * @param entryType - The source entry type
 * @param keyType - A keyed source's key type
 * @returns The complete applied collection, or the conflict's issues
 */
export function EditingAppliedTypeFor<E extends EastType, K extends EastType | undefined = undefined>(entryType: E, keyType?: K): VariantType<{
    applied: EditingCollectionOf<E, K>; conflict: ArrayType<typeof EditingIssueType>;
}> {
    const applied = keyType === undefined ? ArrayType(entryType) : DictType(keyType, entryType);
    return VariantType({ applied, conflict: ArrayType(EditingIssueType) }) as unknown as VariantType<{
        applied: EditingCollectionOf<E, K>; conflict: ArrayType<typeof EditingIssueType>;
    }>;
}

/**
 * Constructs one gesture's typed, draft-aware patch event — what `onPatch`
 * receives, incomplete drafts included.
 *
 * @typeParam E - The source entry type
 * @typeParam F - A groups-only source's child field
 * @param entryType - The domain entry schema
 * @param field - The child field for a groups-only source
 * @returns The event: its gesture, the draft changes, the domain changes once every draft is complete, and the batch's readiness
 */
export function EditingPatchEventTypeFor<E extends EastType, F extends string = never>(entryType: E, field?: F) {
    return EditingPatchEventTypeWith(entryType, EditingDraftEntryTypeFor(entryType, field));
}

/**
 * Constructs the patch event of a collection whose drafts take another shape
 * than a field-by-field one — the Plan drafts a whole entry at once
 * (`DraftField(E)`, #880), since every gesture on it writes a complete entry.
 * {@link EditingPatchEventTypeFor} is this over the field-by-field draft.
 *
 * @typeParam E - The source entry type
 * @typeParam D - The entry's draft type
 * @param entryType - The domain entry schema
 * @param draftType - The entry's draft schema
 * @returns The event: its gesture, the draft changes, the domain changes once every draft is complete, and the batch's readiness
 */
export function EditingPatchEventTypeWith<E extends EastType, D extends EastType>(entryType: E, draftType: D) {
    return StructType({
        transactionId: StringType, origin: EditingOriginType, label: StringType,
        draftChanges: ArrayType(EditingChangeTypeFor(draftType)),
        domainChanges: OptionType(ArrayType(EditingChangeTypeFor(entryType))),
        readiness: EditingBatchReadinessType,
    });
}

/**
 * Constructs an entry-addressed draft patch, placement included.
 *
 * @typeParam E - The source entry schema
 * @typeParam F - A groups-only source's child field
 * @param entryType - The source entry type
 * @param field - The child field for a groups-only source
 * @returns One change to the local draft collection
 */
export function EditingDraftChangeTypeFor<E extends EastType, F extends string = never>(entryType: E, field?: F) {
    return EditingChangeTypeFor(EditingDraftEntryTypeFor(entryType, field));
}

// ============================================================================
// Editing.apply
// ============================================================================

/** The batch the Array form of {@link applyEditing} takes. */
type OrderedBatchOf<E extends EastType> = ReturnType<typeof EditingChangeSetTypeFor<E>>;
/** The batch the keyed form of {@link applyEditing} takes. */
type KeyedBatchOf<E extends EastType, K extends EastType> = ReturnType<typeof EditingChangeSetTypeFor<E, K>>;

/**
 * Creates a reified East function that applies a complete batch to a
 * collection atomically: every change, or none.
 *
 * Checks the whole snapshot or the authoritative revision before inspecting any
 * patch; no positional rebasing takes place. The function does not own request
 * deduplication — the live binding or the application's `onApply` does.
 *
 * - **An Array** (`Editing.apply(E, idField)`) addresses its entries by a
 *   String identity field every entry arm carries, and places a new entry by
 *   an ordered position.
 * - **A keyed Dict** (`Editing.apply(DictType(K, E))`) addresses its entries
 *   by key: a String key is its own id, any other key its `.east` text
 *   (`East.print(key)`), parsed back. Its entries sort by key, so a new one's
 *   placement is `keyOrder`, and an ordered placement is refused.
 *
 * @typeParam E - The source entry type
 * @param entryType - A row struct or a variant of entry structs
 * @param idField - The String identity field shared by every entry arm
 * @returns An East function taking the latest collection, the batch and the authoritative revision
 * @throws {Error} When the identity field is not String on every entry arm
 * @example
 * ```ts
 * import { ArrayType, East, IntegerType, OptionType, StringType, StructType, none, some, variant } from "@elaraai/east";
 * import { Editing } from "@elaraai/east-ui";
 *
 * const Job = StructType({ id: StringType, task: StringType, qty: IntegerType });
 *
 * const applied = East.function([], ArrayType(Job), ($) => {
 *     const before = $.const({ id: "a", task: "Cut", qty: 2n }, Job);
 *     const after = $.const({ id: "a", task: "Cut", qty: 3n }, Job);
 *     const rows = $.const([before], ArrayType(Job));
 *     const oldEntry = $.const(some(before), OptionType(Job));
 *     const newEntry = $.const(some(after), OptionType(Job));
 *     const batch = $.const({
 *         requestId: "example-request", base: variant("snapshot", rows), label: "Set quantity",
 *         changes: [{ id: "a", patch: East.diff(oldEntry, newEntry), place: none }],
 *     }, Editing.Types.ChangeSet(Job));
 *     const apply = $.const(Editing.apply(Job, "id"));
 *     return apply(rows, batch, none).unwrap("applied");
 * });
 * ```
 * @example
 * ```ts
 * import { DictType, East, IntegerType, OptionType, StringType, StructType, none, some, variant } from "@elaraai/east";
 * import { Editing } from "@elaraai/east-ui";
 *
 * const KeyedJob = StructType({ task: StringType, qty: IntegerType });
 *
 * const applied = East.function([], DictType(StringType, KeyedJob), ($) => {
 *     const jobs = $.const(new Map([
 *         ["a", { task: "Cut", qty: 2n }],
 *         ["c", { task: "Weld", qty: 1n }],
 *     ]), DictType(StringType, KeyedJob));
 *     const cut = $.const(some({ task: "Cut", qty: 2n }), OptionType(KeyedJob));
 *     const cutMore = $.const(some({ task: "Cut", qty: 3n }), OptionType(KeyedJob));
 *     const weld = $.const(some({ task: "Weld", qty: 1n }), OptionType(KeyedJob));
 *     const paint = $.const(some({ task: "Paint", qty: 4n }), OptionType(KeyedJob));
 *     const absent = $.const(none, OptionType(KeyedJob));
 *     const batch = $.const({
 *         requestId: "keyed-request", base: variant("snapshot", jobs), label: "Edit jobs",
 *         changes: [
 *             { id: "a", patch: East.diff(cut, cutMore), place: none },
 *             { id: "b", patch: East.diff(absent, paint), place: some(variant("keyOrder", null)) },
 *             { id: "c", patch: East.diff(weld, absent), place: none },
 *         ],
 *     }, Editing.Types.ChangeSet(KeyedJob, StringType));
 *     const apply = $.const(Editing.apply(DictType(StringType, KeyedJob)));
 *     return apply(jobs, batch, none).unwrap("applied");
 * });
 * ```
 */
export function applyEditing<E extends EastType>(entryType: E, idField: string): ExprType<FunctionType<[
    ArrayType<E>, OrderedBatchOf<E>, OptionType<StringType>,
], ReturnType<typeof EditingAppliedTypeFor<E>>>>;
/**
 * The keyed form: applies a batch to a Dict source, its entries addressed by key.
 *
 * @typeParam K - The source's key type
 * @typeParam E - The source entry type
 * @param sourceType - The source's Dict type
 * @returns An East function taking the latest collection, the batch and the authoritative revision
 */
export function applyEditing<K extends EastType, E extends EastType>(sourceType: DictType<K, E>): ExprType<FunctionType<[
    DictType<K, E>, KeyedBatchOf<E, K>, OptionType<StringType>,
], ReturnType<typeof EditingAppliedTypeFor<E, K>>>>;
export function applyEditing(type: EastType, idField?: string): ExprType<FunctionType> {
    if (idField !== undefined) return applyOrdered(type, idField);
    if (type.type !== "Dict") {
        throw new Error("Editing.apply: an Array source names its entries' identity field — Editing.apply(E, \"id\"); a keyed source passes its Dict type — Editing.apply(DictType(K, E))");
    }
    return applyKeyed(type);
}

/** {@link applyEditing} over an Array, its entries addressed by their identity field. */
function applyOrdered(entryType: EastType, idField: string): ExprType<FunctionType> {
    const identity = (type: EastType): ExprType<FunctionType<[EastType], StringType>> => {
        if (type.type === "Struct" && type.fields[idField] === StringType) {
            return East.function([type], StringType, (_$, row) => row[idField] as ExprType<StringType>) as ExprType<FunctionType<[EastType], StringType>>;
        }
        if (type.type === "Variant") {
            const arms = Object.fromEntries(Object.entries(type.cases).map(([tag, t]) => [tag, identity(t)]));
            return East.function([type], StringType, ($, entry) => {
                const fns = Object.fromEntries(Object.entries(arms).map(([tag, fn]) => [tag, $.const(fn)]));
                return entry.match(Object.fromEntries(Object.entries(fns).map(([tag, fn]) => [tag, (_$: unknown, row: ExprType<EastType>) => fn(row)])) as never) as ExprType<StringType>;
            }) as ExprType<FunctionType<[EastType], StringType>>;
        }
        throw new Error(`Editing.apply: "${idField}" must be a String field on every entry — pass the source identity field`);
    };
    const idOf = identity(entryType);
    // The algorithm treats entries opaquely. Erase their TS fields here to
    // avoid expanding recursive PatchTypeOf<EastType>; the runtime East type
    // remains the exact author type, including every nested field and arm.
    const opaqueEntry = entryType as StructType<Record<never, never>>;
    const rowsType = ArrayType(opaqueEntry);
    const batchType = EditingChangeSetTypeFor(opaqueEntry);
    const resultType = EditingAppliedTypeFor(opaqueEntry);
    return East.function([rowsType, batchType, OptionType(StringType)], resultType, ($, current, batch, revision) => {
        const id = $.const(idOf);
        const issues = $.let([], ArrayType(EditingIssueType));
        const result = $.let(variant("conflict", issues), resultType);
        const activeId = $.let("");
        $.try(($) => {
            const valid = $.const(batch.base.match({
                snapshot: (_$, snapshot) => East.equal(current, snapshot),
                revision: (_$, expected) => East.equal(revision, some(expected)),
            }));
            $.if(valid.not(), ($) => { $.error("The source changed since this batch began — discard or review against the new source"); });
            const seen = $.let(new Set<string>(), SetType(StringType));
            $.for(current, ($, row) => {
                const key = $.const(id(row));
                $.if(seen.has(key), ($) => { $.error("The source contains duplicate entry identities"); });
                $(seen.insert(key));
            });
            // Detach nested mutable values: even a conflict after an earlier
            // patch leaves the caller's complete collection untouched.
            const next = $.let(East.Blob.encodeBeast(current, "v2").decodeBeast(rowsType, "v2"));
            const changed = $.let(new Set<string>(), SetType(StringType));
            $.for(batch.changes, ($, change) => {
                $.assign(activeId, change.id);
                $.if(changed.has(change.id), ($) => { $.error("Compose each entry into one change before applying a batch"); });
                $(changed.insert(change.id));
                const before = $.const(next.firstMap((_$, row) => id(row).equal(change.id).ifElse(() => some(row), () => none)));
                const after = $.const(East.applyPatch(before, change.patch));
                $.if(after.hasTag("some"), ($) => {
                    const row = $.const(after.unwrap("some"));
                    $.if(id(row).notEqual(change.id), ($) => { $.error("An entry patch cannot change its identity"); });
                    $.if(before.hasTag("none").and(() => change.place.hasTag("none")), ($) => { $.error("A new entry needs an explicit placement"); });
                    $.if(before.hasTag("some"), ($) => {
                        $.assign(next, next.map((_$, old) => id(old).equal(change.id).ifElse(() => row, () => old)));
                    }).else(($) => { $.assign(next, next.concat([row])); });
                }).else(($) => {
                    $.if(change.place.hasTag("some"), ($) => { $.error("A removed entry cannot have a placement"); });
                    $.assign(next, next.filter((_$, row) => id(row).notEqual(change.id)));
                });
            });
            // All newly created identities exist before resolving anchors.
            $.for(batch.changes, ($, change) => {
                $.assign(activeId, change.id);
                $.if(change.place.hasTag("some"), ($) => {
                    const placement = $.const(change.place.unwrap("some"));
                    $.if(placement.hasTag("keyOrder"), ($) => { $.error("An inline Array requires an ordered placement; keyOrder belongs to a keyed source"); });
                    const position = $.const(placement.unwrap("ordered"));
                    const row = $.const(next.firstMap((_$, row) => id(row).equal(change.id).ifElse(() => some(row), () => none)).unwrap("some"));
                    const rest = $.const(next.filter((_$, row) => id(row).notEqual(change.id)));
                    const anchored = $.const(East.function([StringType], rowsType, ($, anchor) => {
                        $.if(anchor.equal(change.id).or(() => rest.filter((_$, r) => id(r).equal(anchor)).size().equal(0n)), ($) => {
                            $.error("The placement anchor is missing or names the moved entry");
                        });
                        return rest.flatMap((_$, other) => id(other).equal(anchor).ifElse(
                            () => position.hasTag("before").ifElse(() => [row, other], () => [other, row]),
                            () => [other],
                        ));
                    }));
                    $.assign(next, position.match({
                        start: () => East.value([row], rowsType).concat(rest),
                        end: () => rest.concat([row]),
                        before: (_$, anchor) => anchored(anchor),
                        after: (_$, anchor) => anchored(anchor),
                    }));
                });
            });
            $.assign(result, variant("applied", next));
        }).catch(($, message) => {
            $(issues.pushLast({ entry: activeId, row: none, field: none, message }));
            $.assign(result, variant("conflict", issues));
        });
        return result;
    });
}

/** {@link applyEditing} over a keyed Dict, its entries addressed by key. */
function applyKeyed(sourceType: DictType): ExprType<FunctionType> {
    const keyType = sourceType.key;
    // Entries are opaque here, as in the ordered form; the runtime types are exact.
    const opaqueEntry = sourceType.value as StructType<Record<never, never>>;
    const entriesType = DictType(keyType, opaqueEntry);
    const batchType = EditingChangeSetTypeFor(opaqueEntry, keyType);
    const resultType = EditingAppliedTypeFor(opaqueEntry, keyType);
    // A change names its entry by the key's text: a String key is its own
    // text, any other key its `.east` printing, read back here.
    const keyOf = keyType.type === "String"
        ? East.function([StringType], StringType, (_$, id) => id)
        : East.function([StringType], keyType, (_$, id) => id.parse(keyType));
    return East.function([entriesType, batchType, OptionType(StringType)], resultType, ($, current, batch, revision) => {
        const keyFrom = $.const(keyOf as ExprType<FunctionType<[StringType], EastType>>);
        const issues = $.let([], ArrayType(EditingIssueType));
        const result = $.let(variant("conflict", issues), resultType);
        const activeId = $.let("");
        $.try(($) => {
            const valid = $.const(batch.base.match({
                snapshot: (_$, snapshot) => East.equal(current, snapshot),
                revision: (_$, expected) => East.equal(revision, some(expected)),
            }));
            $.if(valid.not(), ($) => { $.error("The source changed since this batch began — discard or review against the new source"); });
            // Detached, as in the ordered form: a conflict leaves the caller's collection untouched.
            const next = $.let(East.Blob.encodeBeast(current, "v2").decodeBeast(entriesType, "v2"));
            const changed = $.let(new Set<string>(), SetType(StringType));
            $.for(batch.changes, ($, change) => {
                $.assign(activeId, change.id);
                $.if(changed.has(change.id), ($) => { $.error("Compose each entry into one change before applying a batch"); });
                $(changed.insert(change.id));
                const key = $.const(keyFrom(change.id));
                $.if(change.place.hasTag("some").and(() => change.place.unwrap("some").hasTag("ordered")), ($) => {
                    $.error("A keyed source orders its entries by key — its placement is keyOrder");
                });
                const before = $.const(next.tryGet(key));
                const after = $.const(East.applyPatch(before, change.patch));
                $.if(after.hasTag("some"), ($) => {
                    $.if(before.hasTag("none").and(() => change.place.hasTag("none")), ($) => { $.error("A new entry needs an explicit placement"); });
                    $(next.insertOrUpdate(key, after.unwrap("some"), (_$, _old, value) => value));
                }).else(($) => {
                    $.if(change.place.hasTag("some"), ($) => { $.error("A removed entry cannot have a placement"); });
                    $.if(before.hasTag("some"), ($) => { $(next.delete(key)); });
                });
            });
            $.assign(result, variant("applied", next));
        }).catch(($, message) => {
            $(issues.pushLast({ entry: activeId, row: none, field: none, message }));
            $.assign(result, variant("conflict", issues));
        });
        return result;
    });
}

// ============================================================================
// The wire — what a collection hands the renderer's session
// ============================================================================

/**
 * A synchronous or asynchronous authoritative apply callback, over the batch's
 * bytes.
 *
 * @internal
 * @property sync - A function
 * @property async - An async function
 */
export const EditingWireApplyType = VariantType({
    sync: FunctionType([BlobType], EditingApplyResultType),
    async: AsyncFunctionType([BlobType], EditingApplyResultType),
});

/**
 * When a ready batch goes: on Apply, or as soon as it is ready. Both use the
 * same serial checked protocol.
 *
 * @property batch - On Apply
 * @property auto - As soon as the batch is ready
 */
export const EditingApplyModeType = VariantType({ batch: NullType, auto: NullType });

/**
 * The fields every source-bound editing session carries to the renderer's
 * shared session — a collection's own editing declaration spreads them beside
 * its own (`SheetEditingType`). Blobs carry values at the exact schemas named,
 * so no hidden domain field is ever lost.
 *
 * @internal
 */
export const EditingSessionFields = {
    /** The source's identity — one session, and one unresolved request, per source. */
    sourceId: StringType,
    /** The entry schema. */
    entryType: EastTypeType,
    /** An Array source's String identity field. */
    idField: OptionType(StringType),
    /** The entry's draft schema. */
    draftType: EastTypeType,
    /** A group entry's child field. */
    children: OptionType(StringType),
    /**
     * A keyed source's key type — its entries sort by key, a change names its
     * entry by the key's text (a String key as it is, any other key its
     * `.east` text), its batches are `ChangeSet(E, K)` and an inline snapshot
     * is a `Dict` of it; `none` for an Array source.
     */
    keyType: OptionType(EastTypeType),
    /** An inline source's whole collection — the base its batches check. */
    snapshot: OptionType(BlobType),
    /** One entry by id at its source offset, for a paged source's reads. */
    readEntry: FunctionType([StringType, IntegerType], OptionType(BlobType)),
    /** The author's patch observer, over the event's bytes. */
    onPatch: OptionType(FunctionType([BlobType], NullType)),
    /** The authoritative apply. */
    onApply: OptionType(EditingWireApplyType),
    /** When a ready batch goes. */
    mode: EditingApplyModeType,
};

/**
 * The shared session's wire declaration — {@link EditingSessionFields} alone.
 *
 * @internal
 */
export const EditingType = StructType(EditingSessionFields);

// ============================================================================
// The inline adapter — idempotent writes through a live handle
// ============================================================================

/**
 * The inline adapter's request ledger. Unlike reactive state, it must outlive
 * a collection disappearing from a render; the browser implementation scopes
 * it to the current UI store's lifetime.
 *
 * @internal
 */
export const EditingRequestStore = {
    read: East.platform("editing_requests_read", [StringType], OptionType(BlobType), { optional: true }),
    write: East.platform("editing_requests_write", [StringType, BlobType], NullType, { optional: true }),
} as const;

/** A request retains its payload before writing, and the target of an uncertain write. */
const RequestType = StructType({
    payload: BlobType,
    result: OptionType(EditingApplyResultType),
    expected: OptionType(BlobType),
});
const RequestsType = DictType(StringType, RequestType);

/**
 * Builds the inline `onUpdate` adapter over a live Array handle.
 *
 * A confirmed request replays before any stale-base check. A throwing write
 * leaves an unresolved request in the store: retries confirm the target by
 * reading it, and never repeat an uncertain mutation. The request table lives
 * in the same browser state store as the binding, surviving remounts.
 *
 * @internal
 * @param entryType - The exact domain schema
 * @param idField - The entry identity field
 * @param sourceId - Stable identity of the captured binding
 * @param read - Invocation-time collection reader
 * @param write - The author's whole-collection writer
 * @returns A closed Blob transport function for the typed apply callback
 */
export function buildInlineApply(
    entryType: EastType,
    idField: string,
    sourceId: ExprType<StringType>,
    read: ExprType<FunctionType>,
    write: ExprType<FunctionType>,
): ExprType<FunctionType<[BlobType], typeof EditingApplyResultType>> {
    const entry = entryType as StructType<Record<never, never>>;
    return inlineApply(ArrayType(entry), EditingChangeSetTypeFor(entry), applyEditing(entry, idField), sourceId, read, write);
}

/**
 * Builds the inline `onUpdate` adapter over a live keyed handle — the
 * {@link buildInlineApply} protocol over a `Dict`, its batches applied by key
 * (`Editing.apply(DictType(K, E))`, #880).
 *
 * @internal
 * @param sourceType - The source's Dict type
 * @param sourceId - Stable identity of the captured binding
 * @param read - Invocation-time collection reader
 * @param write - The author's whole-collection writer
 * @returns A closed Blob transport function for the typed apply callback
 */
export function buildKeyedInlineApply(
    sourceType: DictType,
    sourceId: ExprType<StringType>,
    read: ExprType<FunctionType>,
    write: ExprType<FunctionType>,
): ExprType<FunctionType<[BlobType], typeof EditingApplyResultType>> {
    const entry = sourceType.value as StructType<Record<never, never>>;
    return inlineApply(DictType(sourceType.key, entry), EditingChangeSetTypeFor(entry, sourceType.key),
        applyEditing(DictType(sourceType.key, entry)), sourceId, read, write);
}

/** The inline adapter's protocol over one collection type — see {@link buildInlineApply}. */
function inlineApply(
    collectionType: EastType,
    batchType: EastType,
    apply: ExprType<FunctionType>,
    sourceId: ExprType<StringType>,
    read: ExprType<FunctionType>,
    write: ExprType<FunctionType>,
): ExprType<FunctionType<[BlobType], typeof EditingApplyResultType>> {
    // The algorithm treats the collection opaquely; its runtime type is exact.
    const _rowsType = collectionType as ArrayType<StructType<Record<never, never>>>;
    const typedBatch = batchType as ReturnType<typeof EditingChangeSetTypeFor<StructType<Record<never, never>>>>;
    return East.function([BlobType], EditingApplyResultType, ($, payload) => {
        const reader = $.const(read as ExprType<FunctionType<[], typeof _rowsType>>);
        const writer = $.const(write as ExprType<FunctionType<[typeof _rowsType], NullType>>);
        const transform = $.const(apply as ExprType<FunctionType<[typeof _rowsType, typeof typedBatch, OptionType<StringType>], ReturnType<typeof EditingAppliedTypeFor<StructType<Record<never, never>>>>>>);
        const key = $.const(East.str`editing.requests:${sourceId}`);
        const saved = $.const(EditingRequestStore.read(key));
        const requests = $.let(saved.match({ none: ($) => $.const(new Map(), RequestsType), some: (_$, blob) => blob.decodeBeast(RequestsType, "v2") }));
        const batch = $.const(payload.decodeBeast(typedBatch, "v2"));
        const recorded = $.const(requests.tryGet(batch.requestId));
        return recorded.match({
            some: ($, request) => East.equal(request.payload, payload).ifElse(
                (_$) => request.result.match({
                    some: (_$, result) => result,
                    none: ($) => {
                        // An uncertain writer is never invoked twice. Only
                        // the exact target establishes successful application.
                        const current = $.const(East.Blob.encodeBeast(reader(), "v2"));
                        return East.equal(request.expected, some(current)).ifElse(($) => {
                            const confirmed = $.const(variant("applied", { revision: none }), EditingApplyResultType);
                            $(requests.insertOrUpdate(batch.requestId, { payload, result: some(confirmed), expected: request.expected }, (_$, _old, next) => next));
                            $(EditingRequestStore.write(key, East.Blob.encodeBeast(requests, "v2")));
                            return confirmed;
                        }, ($) => $.error("The previous write has an unknown outcome — retry after its target is confirmed; it cannot be safely issued twice"));
                    },
                }),
                ($) => $.const(variant("conflict", [{ entry: "", row: none, field: none, message: "This request id already names a different batch" }]), EditingApplyResultType),
            ),
            none: ($) => {
                const unresolved = $.const(requests.toArray((_$, request) => request.result.hasTag("none")).filter((_$, pending) => pending).size());
                $.if(unresolved.greater(0n), ($) => {
                    $.error("This source already has an unresolved write — recover its original request before submitting another batch");
                });
                const current = $.const(reader());
                const applied = $.const(transform(current, batch, none));
                return applied.match({
                    conflict: ($, issues) => {
                        const result = $.const(variant("conflict", issues), EditingApplyResultType);
                        $(requests.insert(batch.requestId, { payload, result: some(result), expected: none }));
                        $(EditingRequestStore.write(key, East.Blob.encodeBeast(requests, "v2")));
                        return result;
                    },
                    applied: ($, rows) => {
                        const expected = $.const(some(East.Blob.encodeBeast(rows, "v2")), OptionType(BlobType));
                        $(requests.insert(batch.requestId, { payload, result: none, expected }));
                        $(EditingRequestStore.write(key, East.Blob.encodeBeast(requests, "v2")));
                        $(writer(rows));
                        const result = $.const(variant("applied", { revision: none }), EditingApplyResultType);
                        $(requests.insertOrUpdate(batch.requestId, { payload, result: some(result), expected }, (_$, _old, next) => next));
                        $(EditingRequestStore.write(key, East.Blob.encodeBeast(requests, "v2")));
                        return result;
                    },
                });
            },
        });
    });
}

// ============================================================================
// Namespace
// ============================================================================

/**
 * The type of the {@link Editing} namespace — declared explicitly so the
 * declaration emit stays within TypeScript's serialization limit.
 */
export interface EditingNamespace {
    /** Applies a checked batch to a collection atomically — an Array by identity field, or a keyed Dict by key. */
    apply: typeof applyEditing;
    /** The editing contract's East types. */
    Types: {
        /** `DraftField(T)` — one field of a draft: missing, a value, or unreadable text ({@link EditingDraftFieldType}). */
        DraftField: typeof EditingDraftFieldType;
        /** `Draft(R)` — a struct's field-by-field draft ({@link EditingDraftTypeFor}). */
        Draft: typeof EditingDraftTypeFor;
        /** `DraftGroup(G, "rows")` — a group's draft, its children drafts ({@link EditingDraftGroupTypeFor}). */
        DraftGroup: typeof EditingDraftGroupTypeFor;
        /** `Entry(G, "rows")` — groups with their rows beside ungrouped rows, as one union ({@link EditingEntryTypeFor}). */
        Entry: typeof EditingEntryTypeFor;
        /** `DraftEntry(E)` — an entry's draft ({@link EditingDraftEntryTypeFor}). */
        DraftEntry: typeof EditingDraftEntryTypeFor;
        /** `DraftChange(E)` — one change to the drafts ({@link EditingDraftChangeTypeFor}). */
        DraftChange: typeof EditingDraftChangeTypeFor;
        /** `Change(E)` — one entry's composed patch and placement ({@link EditingChangeTypeFor}). */
        Change: typeof EditingChangeTypeFor;
        /** `ChangeSet(E)` / `ChangeSet(E, K)` — an atomic request against a checked base ({@link EditingChangeSetTypeFor}). */
        ChangeSet: typeof EditingChangeSetTypeFor;
        /** `Base(E)` / `Base(E, K)` — a revision, or the whole collection ({@link EditingBaseTypeFor}). */
        Base: typeof EditingBaseTypeFor;
        /** `Applied(E)` / `Applied(E, K)` — the applied collection or the conflict ({@link EditingAppliedTypeFor}). */
        Applied: typeof EditingAppliedTypeFor;
        /** The source's answer to a request ({@link EditingApplyResultType}). */
        ApplyResult: typeof EditingApplyResultType;
        /** An issue addressed to an entry ({@link EditingIssueType}). */
        Issue: typeof EditingIssueType;
        /** An issue on a field ({@link EditingFieldIssueType}). */
        FieldIssue: typeof EditingFieldIssueType;
        /** One entry's readiness ({@link EditingReadinessType}). */
        Readiness: typeof EditingReadinessType;
        /** A batch's readiness ({@link EditingBatchReadinessType}). */
        BatchReadiness: typeof EditingBatchReadinessType;
        /** The gesture that made a transaction ({@link EditingOriginType}). */
        Origin: typeof EditingOriginType;
        /** `PatchEvent(E)` — what `onPatch` receives ({@link EditingPatchEventTypeFor}). */
        PatchEvent: typeof EditingPatchEventTypeFor;
        /** Where an entry stands — ordered, or in key order ({@link EditingPlacementType}). */
        Placement: typeof EditingPlacementType;
        /** A position in an ordered collection ({@link EditingPositionType}). */
        Position: typeof EditingPositionType;
    };
}

/**
 * The editing contract (#879) — the one transaction session every editable
 * collection speaks: drafts, one undoable transaction per gesture reported as a
 * `PatchEvent`, and Apply as one checked, idempotent `ChangeSet` applied with
 * `Editing.apply`. The Sheet keeps its names for it (`Sheet.Types.ChangeSet`,
 * `Sheet.apply`, …) — the same values.
 */
export const Editing: EditingNamespace = {
    apply: applyEditing,
    Types: {
        DraftField: EditingDraftFieldType,
        Draft: EditingDraftTypeFor,
        DraftGroup: EditingDraftGroupTypeFor,
        Entry: EditingEntryTypeFor,
        DraftEntry: EditingDraftEntryTypeFor,
        DraftChange: EditingDraftChangeTypeFor,
        Change: EditingChangeTypeFor,
        ChangeSet: EditingChangeSetTypeFor,
        Base: EditingBaseTypeFor,
        Applied: EditingAppliedTypeFor,
        ApplyResult: EditingApplyResultType,
        Issue: EditingIssueType,
        FieldIssue: EditingFieldIssueType,
        Readiness: EditingReadinessType,
        BatchReadiness: EditingBatchReadinessType,
        Origin: EditingOriginType,
        PatchEvent: EditingPatchEventTypeFor,
        Placement: EditingPlacementType,
        Position: EditingPositionType,
    },
};
