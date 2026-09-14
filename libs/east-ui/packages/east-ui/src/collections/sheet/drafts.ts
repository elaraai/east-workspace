/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Typed draft entries and the stable transaction event envelope. @packageDocumentation */
import { ArrayType, OptionType, StringType, StructType, VariantType, type EastType } from "@elaraai/east";
import {
    SheetDraftFieldType, SheetDraftTypeFor, SheetChangeTypeFor, SheetOriginType,
    SheetBatchReadinessType, type SheetDraftOf,
} from "./transactions.js";

/** Fields that can contain a group's child rows. */
export type SheetChildrenField<G extends StructType> = {
    [K in keyof G["fields"] & string]: G["fields"][K] extends ArrayType<StructType> ? K : never;
}[keyof G["fields"] & string];
/** The row type carried by a group's child array. */
export type SheetChildOf<G extends StructType, F extends SheetChildrenField<G>> =
    G["fields"][F] extends ArrayType<infer R extends StructType> ? R : never;
/** Draft a group's fields while retaining its child array's ordered structure. */
export type SheetDraftGroupOf<G extends StructType, F extends SheetChildrenField<G>> = StructType<{
    [K in keyof G["fields"]]: K extends F ? ArrayType<SheetDraftOf<SheetChildOf<G, F>>> : ReturnType<typeof SheetDraftFieldType<G["fields"][K]>>;
}>;

/** The declared child field of a group schema (never inferred from arbitrary row fields). */
const children = new WeakMap<EastType, string>();

/**
 * Constructs a group's draft type, with drafts in its child array.
 * @typeParam G - The complete group struct
 * @typeParam F - Its Array-of-structs child field
 * @param groupType - The group type
 * @param field - The child array field
 * @returns The group's draft struct
 * @throws {Error} When the named field is not an Array of structs
 */
export function SheetDraftGroupTypeFor<G extends StructType, F extends SheetChildrenField<G>>(groupType: G, field: F): SheetDraftGroupOf<G, F> {
    const t = groupType.fields[field];
    if (t?.type !== "Array" || t.value.type !== "Struct") throw new Error(`Sheet: "${field}" must hold an Array of row structs`);
    const rowDraft = SheetDraftTypeFor(t.value);
    return StructType(Object.fromEntries(Object.entries(groupType.fields).map(([key, type]) => [key,
        key === field ? ArrayType(rowDraft) : SheetDraftFieldType(type),
    ]))) as SheetDraftGroupOf<G, F>;
}
/**
 * Constructs the union of groups carrying child rows and ungrouped rows.
 * @typeParam G - The group struct
 * @typeParam F - Its Array-of-structs child field
 * @param groupType - The group type
 * @param field - The child array field
 * @returns The group-or-row entry type
 * @throws {Error} When the child field is not an Array of structs
 * @example
 * ```ts
 * const Entry = Sheet.Types.Entry(GroupType, "rows");
 * ```
 */
export function SheetEntryTypeFor<G extends StructType, F extends SheetChildrenField<G>>(groupType: G, field: F): VariantType<{ group: G; row: SheetChildOf<G, F> }> {
    SheetDraftGroupTypeFor(groupType, field);
    const row = groupType.fields[field].value as SheetChildOf<G, F>;
    const entry = VariantType({ group: groupType, row });
    children.set(entry, field);
    return entry;
}
/** Child fields whose row type matches an entry union's ungrouped arm. */
type MatchingChildren<G extends StructType, R extends StructType> = {
    [K in SheetChildrenField<G>]: G["fields"][K] extends ArrayType<R> ? K : never;
}[SheetChildrenField<G>];
/** The draft type of a flat, grouped-only, or group-or-row entry. */
export type SheetDraftEntryOf<E extends EastType, F extends string = never> =
    E extends VariantType<{ group: infer G extends StructType; row: infer R extends StructType }>
        ? VariantType<{ group: SheetDraftGroupOf<G, MatchingChildren<G, R>>; row: SheetDraftOf<R> }>
        : E extends StructType ? [F] extends [never] ? SheetDraftOf<E> : SheetDraftGroupOf<E, F & SheetChildrenField<E>> : never;
/**
 * Constructs the draft equivalent of a source entry.
 * @typeParam E - The entry schema
 * @typeParam F - A groups-only source's child field
 * @param entryType - A flat struct or a group-or-row union
 * @param field - The child field for a groups-only source
 * @returns The draft entry schema
 * @throws {Error} When a group union has no unambiguous child field
 */
export function SheetDraftEntryTypeFor<E extends EastType, F extends string = never>(entryType: E, field?: F): SheetDraftEntryOf<E, F> {
    if (entryType.type === "Struct") {
        return (field === undefined ? SheetDraftTypeFor(entryType) : SheetDraftGroupTypeFor(entryType, field)) as SheetDraftEntryOf<E, F>;
    }
    if (entryType.type === "Variant" && entryType.cases.group?.type === "Struct" && entryType.cases.row?.type === "Struct") {
        const group = entryType.cases.group as StructType;
        const row = entryType.cases.row as StructType;
        const candidates = Object.entries(group.fields).filter(([, t]) => t.type === "Array" && t.value === row);
        const childField = field ?? children.get(entryType) ?? (candidates.length === 1 ? candidates[0]![0] : undefined);
        if (childField === undefined) throw new Error("Sheet: declare the child field with Sheet.Types.Entry(GroupType, field)");
        return VariantType({ group: SheetDraftGroupTypeFor(group, childField), row: SheetDraftTypeFor(row) }) as SheetDraftEntryOf<E, F>;
    }
    throw new Error("Sheet: entries must be row structs or a group/row variant of structs");
}
/**
 * Constructs one gesture's typed, draft-aware patch event.
 * @typeParam E - The source entry type
 * @typeParam F - A groups-only source's child field
 * @param entryType - The domain entry schema
 * @param field - The child field for a groups-only source
 * @returns The stable onPatch event envelope, including incomplete edits
 */
export function SheetPatchEventTypeFor<E extends EastType, F extends string = never>(entryType: E, field?: F) {
    const draft = SheetDraftEntryTypeFor(entryType, field);
    return StructType({
        transactionId: StringType, origin: SheetOriginType, label: StringType,
        draftChanges: ArrayType(SheetChangeTypeFor(draft)),
        domainChanges: OptionType(ArrayType(SheetChangeTypeFor(entryType))),
        readiness: SheetBatchReadinessType,
    });
}

/**
 * Constructs an entry-addressed draft patch, including top-level placement.
 * @typeParam E - The source entry schema
 * @typeParam F - A groups-only source's child field
 * @param entryType - The source entry type
 * @param field - The child field for a groups-only source
 * @returns One change to the local draft collection
 */
export function SheetDraftChangeTypeFor<E extends EastType, F extends string = never>(entryType: E, field?: F) {
    return SheetChangeTypeFor(SheetDraftEntryTypeFor(entryType, field));
}
