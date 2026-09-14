/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Checked entry patches shared by every Sheet. @packageDocumentation */
import {
    East, ArrayType, FunctionType, IntegerType, NullType, OptionType,
    PatchType, SetType, StringType, StructType, VariantType, none, some, variant,
    type EastType, type ExprType, type PatchTypeOf,
} from "@elaraai/east";

/** A position in an explicitly ordered collection. */
export const SheetPositionType = VariantType({ start: NullType, end: NullType, before: StringType, after: StringType });
/** An entry's placement, or the source's authoritative key order. */
export const SheetEntryPlacementType = VariantType({ ordered: SheetPositionType, keyOrder: NullType });
/** A row's destination: a top-level entry or a child array position. */
export const SheetRowDestinationType = VariantType({
    entry: SheetEntryPlacementType,
    child: StructType({ group: StringType, index: IntegerType }),
});
/** One author readiness issue on a field. */
export const SheetFieldIssueType = StructType({ field: StringType, message: StringType });
/** Readiness after structural and author checks. */
export const SheetReadinessType = VariantType({ ready: NullType, incomplete: ArrayType(SheetFieldIssueType), invalid: ArrayType(SheetFieldIssueType) });
/** An issue addressed to an entry, optional child position and optional field. */
export const SheetIssueType = StructType({ entry: StringType, row: OptionType(IntegerType), field: OptionType(StringType), message: StringType });
/** Readiness of the complete editing batch. */
export const SheetBatchReadinessType = VariantType({ ready: NullType, incomplete: ArrayType(SheetIssueType), invalid: ArrayType(SheetIssueType) });
/** The gesture that produced one transaction. */
export const SheetOriginType = VariantType({
    typed: NullType, pasted: NullType, fill: NullType, row: NullType, pattern: NullType,
    insert: NullType, move: NullType, remove: NullType, undo: NullType, redo: NullType, discard: NullType,
});
/** Authoritative acknowledgement of one idempotent request. */
export const SheetApplyResultType = VariantType({
    applied: StructType({ revision: OptionType(StringType) }),
    rejected: ArrayType(SheetIssueType), conflict: ArrayType(SheetIssueType),
});
/** Context supplied to a new row constructor. */
export const SheetNewRowType = StructType({ destination: SheetRowDestinationType });
/** Context supplied to a new group constructor. */
export const SheetNewGroupType = StructType({ place: SheetEntryPlacementType });

/** Preserve missing and invalid input independently from a field's domain value. */
export function SheetDraftFieldType<T extends EastType>(type: T) {
    return VariantType({ missing: NullType, value: type, invalid: StringType });
}
/** The field-by-field draft type of a domain struct. */
export type SheetDraftOf<R extends StructType> = StructType<{
    [K in keyof R["fields"]]: ReturnType<typeof SheetDraftFieldType<R["fields"][K]>>;
}>;
/**
 * Constructs the field-by-field draft type, including fields without columns.
 * @typeParam R - The domain row type
 * @param rowType - The complete domain struct
 * @returns The draft struct; an optional domain field still starts missing
 */
export function SheetDraftTypeFor<R extends StructType>(rowType: R): SheetDraftOf<R> {
    return StructType(Object.fromEntries(Object.entries(rowType.fields).map(([k, t]) => [k, SheetDraftFieldType(t)]))) as SheetDraftOf<R>;
}
/**
 * Constructs the checked base of a batch.
 * @typeParam E - The source entry type
 * @param entryType - The source entry type
 * @returns A revision token or the complete inline collection snapshot
 */
export function SheetBaseTypeFor<E extends EastType>(entryType: E) {
    return VariantType({ revision: StringType, snapshot: ArrayType(entryType) });
}
/**
 * Constructs one composed entry patch and its placement.
 * @typeParam E - The source entry type
 * @param entryType - The source entry type
 * @returns An entry-addressed East patch; none represents an absent entry
 */
export function SheetChangeTypeFor<E extends EastType>(entryType: E) {
    return StructType({ id: StringType, patch: PatchType(OptionType(entryType)) as PatchTypeOf<OptionType<E>>, place: OptionType(SheetEntryPlacementType) });
}
/**
 * Constructs an atomic request against a checked base.
 * @typeParam E - The source entry type
 * @param entryType - The source entry type
 * @returns The batch type accepted by onApply
 */
export function SheetChangeSetTypeFor<E extends EastType>(entryType: E) {
    return StructType({ requestId: StringType, base: SheetBaseTypeFor(entryType), label: StringType, changes: ArrayType(SheetChangeTypeFor(entryType)) });
}
/**
 * Constructs the result of the pure collection transform.
 * @typeParam E - The source entry type
 * @param entryType - The source entry type
 * @returns The complete applied collection or conflict issues
 */
export function SheetAppliedTypeFor<E extends EastType>(entryType: E) {
    return VariantType({ applied: ArrayType(entryType), conflict: ArrayType(SheetIssueType) });
}

/**
 * Creates a reified East function that applies a complete batch atomically.
 *
 * Checks the whole snapshot or authoritative revision before inspecting any
 * patch. No positional rebasing takes place. This pure function does not own
 * request deduplication; the live binding or application's onApply owns it.
 *
 * @typeParam E - The source entry type
 * @param entryType - A row struct or a variant of entry structs
 * @param idField - The String identity field shared by every entry arm
 * @returns An East function taking the latest collection, batch and authoritative revision
 * @throws {Error} When the identity field is not String on every entry arm
 * @example
 * ```ts
 * const apply = Sheet.apply(JobType, "id");
 * const result = apply(jobs.read(), batch, none);
 * ```
 */
export function applySheet<E extends EastType>(entryType: E, idField: string): ExprType<FunctionType<[
    ArrayType<E>, ReturnType<typeof SheetChangeSetTypeFor<E>>, OptionType<StringType>,
], ReturnType<typeof SheetAppliedTypeFor<E>>>>;
export function applySheet(entryType: EastType, idField: string): ExprType<FunctionType> {
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
        throw new Error(`Sheet.apply: "${idField}" must be a String field on every entry — pass the source identity field`);
    };
    const idOf = identity(entryType);
    // The algorithm treats entries opaquely. Erase their TS fields here to
    // avoid expanding recursive PatchTypeOf<EastType>; the runtime East type
    // remains the exact author type, including every nested field and arm.
    const opaqueEntry = entryType as StructType<Record<never, never>>;
    const rowsType = ArrayType(opaqueEntry);
    const batchType = SheetChangeSetTypeFor(opaqueEntry);
    const resultType = SheetAppliedTypeFor(opaqueEntry);
    return East.function([rowsType, batchType, OptionType(StringType)], resultType, ($, current, batch, revision) => {
        const id = $.const(idOf);
        const issues = $.let([], ArrayType(SheetIssueType));
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
