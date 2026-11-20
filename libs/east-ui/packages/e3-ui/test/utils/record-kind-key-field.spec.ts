/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A kind over a record whose rows hold their own key in a field (`keyField`,
 * east-workspace#1705), as every kind the Schematic and the Flowchart share
 * declares one (`utils/record-kind.ts`): racks keyed by their code, each
 * rack's `code` its key. Its session names the field as its entries' identity
 * field — which the renderer's session keeps a new row's key in — its Save
 * writes a new rack's key into it and leaves a stored rack's alone, its form
 * shows the field read only, and what it refuses.
 *
 * e3-ui's specs read and write no e3: the record is a handle made by hand
 * (`record-handles.ts`), its draft door answering the patch as a draft.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    DictType, East, IntegerType, OptionType, PatchType, SortedMap, StringType, StructType,
    compareFor, decodeBeast2For, diffFor, encodeBeast2For, equalFor, none, some, variant, type EastType, type ExprType,
} from "@elaraai/east";
import { Editing } from "@elaraai/east-ui";
import { Fields } from "@elaraai/east-ui/internal";
import { FuncDraftType } from "@elaraai/e3-ui";
import { KindSideFields, recordSide, type KindBinding } from "@elaraai/e3-ui/internal";
import { recordHandle } from "../record-handles.js";

/** A rack: its code, which is its key too, and the bay it stands in. */
const Rack = StructType({ code: StringType, bay: IntegerType });
const Racks = DictType(StringType, Rack);
/** The racks the record holds: one whose row holds its key, and one saved before its row did. */
const RACKS = new SortedMap([["R-1", { code: "R-1", bay: 1n }], ["R-2", { code: "", bay: 2n }]], compareFor(StringType));
const RackKind = StructType({ ...KindSideFields });
const racksHandle = recordHandle(Racks, RACKS, "spec_racks");

/** The racks' kind, built as a builder builds one: told its key field, or told none. */
const racksKind = (config: object, omitted: readonly string[] = []) => East.compile(East.function([], RackKind, ($) => {
    const handle = $.let(racksHandle());
    const bound: KindBinding = { form: "record", handle: handle as unknown as ExprType<EastType>, keyType: StringType, rowType: Rack };
    return recordSide(bound, undefined, undefined, config as never, omitted, "Spec.racks") as never;
}), []);

const Batch = Editing.Types.ChangeSet(Rack, StringType);
const change = diffFor(OptionType(Rack));
const byCode = compareFor(StringType);

describe("a kind told its record's key field", () => {
    test("its session names the field as its entries' identity field; told none, it names none", () => {
        const keyed = racksKind({ keyField: "code" })();
        if (keyed.editing.type !== "some") assert.fail("expected the kind's session");
        assert.ok(equalFor(OptionType(StringType))(keyed.editing.value.idField, some("code")));
        const plain = racksKind({})();
        if (plain.editing.type !== "some") assert.fail("expected the kind's session");
        assert.ok(equalFor(OptionType(StringType))(plain.editing.value.idField, none));
    });

    test("its Save writes a new rack's key into the field, whatever the batch drafted there, and leaves a stored rack's field as it holds it", () => {
        const kind = racksKind({ keyField: "code" })();
        if (kind.editing.type !== "some" || kind.editing.value.toDraft.type !== "some") assert.fail("expected the session's draft form");
        const answer = kind.editing.value.toDraft.value(encodeBeast2For(Batch)({
            requestId: "", base: variant("snapshot", RACKS), label: "",
            changes: [
                { id: "R-9", patch: change(none, some({ code: "", bay: 9n })), place: some(variant("keyOrder", null)) },
                { id: "R-2", patch: change(some({ code: "", bay: 2n }), some({ code: "", bay: 5n })), place: none },
            ],
        }));
        if (answer.type !== "draft") assert.fail(`expected a draft, got ${answer.type}`);
        const draft = decodeBeast2For(FuncDraftType)(answer.value);
        const after = new SortedMap([["R-1", { code: "R-1", bay: 1n }], ["R-2", { code: "", bay: 5n }], ["R-9", { code: "R-9", bay: 9n }]], byCode);
        assert.ok(equalFor(PatchType(Racks))(decodeBeast2For(PatchType(Racks))(draft.args[0]!), diffFor(Racks)(RACKS, after)));
    });

    test("its form shows the field read only, under the label its hint gives; told none, the field is edited as any other", () => {
        const editorOf = (kind: ReturnType<ReturnType<typeof racksKind>>, field: string) => {
            const spec = kind.fields.find((one) => equalFor(StringType)(one.path[0] ?? "", field));
            if (spec === undefined) assert.fail(`expected a field "${field}" in the form`);
            return `${spec.label}: ${spec.editor.type}`;
        };
        const keyed = racksKind({ keyField: "code", fields: { code: Fields.text({ label: "Rack code" }) } })();
        assert.deepEqual([editorOf(keyed, "code"), editorOf(keyed, "bay")], ["Rack code: readonly", "Bay: number"]);
        assert.equal(editorOf(racksKind({ keyField: "code" })(), "code"), "Code: readonly");
        assert.equal(editorOf(racksKind({})(), "code"), "Code: text");
    });

    test("refuses a field the rows do not have, one of another type than the key, and one a role of the kind writes", () => {
        assert.throws(() => racksKind({ keyField: "label" }),
            /Spec\.racks: `keyField` names the field of an entry that holds its key, a \.String as the key is — "label" is not a field of \.Struct/);
        assert.throws(() => racksKind({ keyField: "bay" }),
            /Spec\.racks: `keyField` names the field of an entry that holds its key, a \.String as the key is — "bay" is a \.Integer field of \.Struct/);
        assert.throws(() => racksKind({ keyField: "code" }, ["code"]),
            /Spec\.racks: `keyField` names "code", which one of the kind's roles writes — a row's key is kept in its key field by the builder, and nothing else writes it/);
    });
});
