/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Declared structural editing capabilities. @packageDocumentation */
import { BooleanType, NullType, StructType, VariantType, variant, type ValueTypeOf } from "@elaraai/east";

/** Structural actions available in addition to editing existing cells. */
export interface SheetEditsInput {
    /** Create rows, including through paste and suggestions. Default true. */
    insertRows?: boolean;
    /** Remove existing rows. Local draft discard remains independent. Default true. */
    removeRows?: boolean;
    /** Reorder within a collection, or transfer between groups. */
    moveRows?: "none" | "within" | "between";
    /** Create groups; requires a group declaration. Default true when grouped. */
    insertGroups?: boolean;
    /** Reorder groups; requires an ordered grouped source. */
    moveGroups?: boolean;
    /** Remove groups; nonempty cascades also require removeRows. */
    removeGroups?: boolean;
}

/** Resolved structural capabilities transported to the renderer. @internal */
export const SheetEditsType = StructType({
    insertRows: BooleanType, removeRows: BooleanType,
    moveRows: VariantType({ none: NullType, within: NullType, between: NullType }),
    insertGroups: BooleanType, moveGroups: BooleanType, removeGroups: BooleanType,
});

/** Reject declarations the source cannot honour and resolve source-dependent defaults. @internal */
export function resolveSheetEdits(input: SheetEditsInput | undefined, grouped: boolean, keyed: boolean): ValueTypeOf<typeof SheetEditsType> {
    for (const name of ["insertGroups", "moveGroups", "removeGroups"] as const) {
        if (!grouped && input?.[name] !== undefined) throw new Error(`Sheet: edits.${name} requires a group declaration — omit it on a flat sheet`);
    }
    if (keyed && input?.moveGroups === true) throw new Error("Sheet: edits.moveGroups cannot reorder a key-ordered source — omit it or use a positional source");
    if (keyed && !grouped && input?.moveRows !== undefined && input.moveRows !== "none") throw new Error("Sheet: edits.moveRows cannot reorder a flat key-ordered source — use none or a positional source");
    return {
        insertRows: input?.insertRows ?? true, removeRows: input?.removeRows ?? true,
        moveRows: variant(input?.moveRows ?? (grouped ? "between" : keyed ? "none" : "within"), null),
        insertGroups: grouped && (input?.insertGroups ?? true),
        moveGroups: grouped && !keyed && (input?.moveGroups ?? true),
        removeGroups: grouped && (input?.removeGroups ?? true),
    };
}
