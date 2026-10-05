/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Sheet against east-ui's shared contracts (#567, #879) — the cases of
 * east-ui's own contract specs that hold a collection to them, for the Sheet,
 * which is e3-ui's (#1179): a lookalike paged source is refused naming the
 * contract, and the Sheet's transaction names are the shared editing
 * contract's own values.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ArrayType, East, FunctionType, IntegerType, OptionType, StringType, StructType, some } from "@elaraai/east";
import { Editing, EditingSessionFields } from "@elaraai/east-ui/internal";
import { Sheet, SheetEditingType } from "@elaraai/e3-ui/internal";

const RowType = StructType({ title: StringType, due: IntegerType });

/** What a refusal of a lookalike says: the contract, every field in its order at its type. */
const NAMES_THE_CONTRACT = new RegExp(
    "^Error: Sheet: a paged source is a platform bind's handle \\(Data\\.bindPaged\\) — " +
    "`\\{ id: String, page: \\(Integer, Integer\\) → Option<C>, total: \\(\\) → Option<Integer>, " +
    "seek: Option<\\(SeekQuery\\) → Option<SeekRange>>, revision: \\(\\) → Option<String>, " +
    "refresh: \\(Option<String>\\) → Null \\}`, its fields in that order at those types, " +
    "or the same without `revision` and `refresh`");

describe("the Sheet against the shared contracts", () => {
    test("a lookalike paged source is refused, naming the contract", () => {
        const Rows = ArrayType(RowType);
        const lookalike = East.value(
            {
                page: East.function([IntegerType, IntegerType], OptionType(Rows), () => some([])),
                total: East.function([], OptionType(IntegerType), () => some(0n)),
            },
            StructType({ page: FunctionType([IntegerType, IntegerType], OptionType(Rows)), total: FunctionType([], OptionType(IntegerType)) }));
        assert.throws(() => Sheet.Root(lookalike as never, { title: Sheet.column.text(RowType) } as never, { id: "title" } as never),
            NAMES_THE_CONTRACT);
    });

    test("the Sheet's transaction names are the shared contract's own values", () => {
        assert.equal(Sheet.apply, Editing.apply);
        const shared: Record<string, keyof typeof Editing.Types> = {
            Entry: "Entry", DraftGroup: "DraftGroup", DraftEntry: "DraftEntry", DraftChange: "DraftChange",
            PatchEvent: "PatchEvent", Position: "Position", EntryPlacement: "Placement", FieldIssue: "FieldIssue",
            Readiness: "Readiness", Issue: "Issue", BatchReadiness: "BatchReadiness", Origin: "Origin",
            ApplyResult: "ApplyResult", Draft: "Draft", Base: "Base", Change: "Change", ChangeSet: "ChangeSet",
            Applied: "Applied",
        };
        for (const [sheetName, editingName] of Object.entries(shared)) {
            assert.equal((Sheet.Types as Record<string, unknown>)[sheetName], Editing.Types[editingName], `Sheet.Types.${sheetName}`);
        }
        // The Sheet's editing wire carries every field of the shared session's, at the same type.
        for (const [field, type] of Object.entries(EditingSessionFields)) {
            assert.equal(SheetEditingType.fields[field as keyof typeof SheetEditingType.fields], type, `SheetEditingType.${field}`);
        }
    });
});
