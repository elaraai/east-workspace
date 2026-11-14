/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A commit over rows a test holds in page state (#1541, U4): what a test of
 * the canvas's editing wire hands the canvas builder as `editing.onApply`,
 * the seam a record's commit fills.
 *
 * A Plan saves through a record alone (`record`), so no page builds this. A
 * test that keeps its rows in `State` still drives the whole session over a
 * source read whole and committed at once: each batch is applied by key over
 * the handle's latest rows, the whole result written back, and a request sent
 * again answered from its ledger. The protocol is east-ui's
 * (`buildKeyedInlineApply`, the one the Sheet's `onUpdate` runs), not a copy.
 */

import { East, type DictType, type EastType, type ExprType, type FunctionType, type NullType } from "@elaraai/east";
import { Editing, buildKeyedInlineApply } from "@elaraai/east-ui/internal";

/** A whole-value handle over the rows: what `State.bind` returns for them. */
interface RowsHandle<Rows extends EastType> {
    /** The rows as they stand. */
    read: ExprType<FunctionType<[], Rows>>;
    /** Writes the rows whole. */
    write: ExprType<FunctionType<[Rows], NullType>>;
}

/**
 * Builds the commit of a canvas's batches over rows held in page state.
 *
 * @param rowsType - The rows' type: a `Dict` of the canvas's entries by their keys
 * @param sourceId - What names the rows among the session's requests: the key they are bound under
 * @param rows - The rows' handle
 * @returns The commit, over `Editing.Types.ChangeSet(R, K)`: what `Plan.Root`'s `editing.onApply` takes
 */
export function stateApply<Rows extends DictType<EastType, EastType>>(rowsType: Rows, sourceId: string, rows: RowsHandle<Rows>) {
    const batchType = Editing.Types.ChangeSet(rowsType.value, rowsType.key);
    const transport = buildKeyedInlineApply(rowsType, East.value(sourceId), rows.read as unknown as ExprType<FunctionType>,
        rows.write as unknown as ExprType<FunctionType>);
    return East.function([batchType], Editing.Types.ApplyResult, ($, batch) => {
        const apply = $.const(transport);
        return apply(East.Blob.encodeBeast(batch, "v2"));
    });
}
