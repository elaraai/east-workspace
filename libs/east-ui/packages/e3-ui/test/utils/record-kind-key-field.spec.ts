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
 * shows the field read only, and what it refuses. The kinds that hand their
 * record's side over themselves — the Flowchart's lanes and the Plan's link
 * kinds, each adding rows of its own — take the option too.
 *
 * e3-ui's specs read and write no e3: the record is a handle made by hand
 * (`record-handles.ts`), its draft door answering the patch as a draft.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    DictType, East, FloatType, IntegerType, NullType, OptionType, PatchType, SortedMap, StringType, StructType,
    compareFor, decodeBeast2For, diffFor, encodeBeast2For, equalFor, none, some, variant, type BlockBuilder, type EastType, type ExprType, type ValueTypeOf,
} from "@elaraai/east";
import { Editing } from "@elaraai/east-ui";
import { EditingType, Fields } from "@elaraai/east-ui/internal";
import { Flowchart, FuncDraftType, Plan, Record } from "@elaraai/e3-ui";
import { KindSideFields, recordSide, type KindBinding } from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";
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

/** A lane: its code, which is its key too, its header and its place among the lanes. */
const Lane = StructType({ code: StringType, label: StringType, seq: FloatType });
const Lanes = DictType(StringType, Lane);
const lanesHandle = recordHandle(Lanes, new SortedMap<string, ValueTypeOf<typeof Lane>>([["intake", { code: "intake", label: "Intake", seq: 1 }]], byCode), "spec_lanes");
/** The lanes' session, built as the Flowchart builds them: told their key field, or told none. */
const lanesSession = (spec: object) => East.compile(East.function([], OptionType(EditingType), ($) => {
    const handle = $.let(lanesHandle());
    return Flowchart.lanes(handle as never, { label: "label", order: "seq", ...spec } as never).build(undefined, false).editing;
}), []);

/** A feed between two jobs: its reference, which is its key too, and the jobs it joins. */
const Feed = StructType({ ref: StringType, from: StringType, to: StringType });
const Feeds = DictType(StringType, Feed);
const feedsHandle = recordHandle(Feeds, new SortedMap<string, ValueTypeOf<typeof Feed>>([["f-1", { ref: "f-1", from: "J-1", to: "J-2" }]], byCode), "spec_feeds");
/** The feeds' session, built as the Plan builds a link kind: told its key field, or told none. */
const feedsSession = (config: object) => East.compile(East.function([], OptionType(EditingType), ($) => {
    const handle = $.let(feedsHandle());
    return Plan.links(handle as never, {
        name: "Feed", icon: "arrow-right-long", from: { field: "from", of: "job" }, to: { field: "to", of: "job" }, ...config,
    } as never).build("feed").editing;
}), []);

describe("a kind that hands its record's side over itself, told its record's key field", () => {
    /** The field a kind's session names as its entries' identity field. */
    const idField = (editing: ValueTypeOf<OptionType<typeof EditingType>>) => {
        if (editing.type !== "some") assert.fail("expected the kind's session");
        return editing.value.idField;
    };

    test("the Flowchart's lanes: their session names the field, told none it names none, and a field a role writes is refused", () => {
        assert.ok(equalFor(OptionType(StringType))(idField(lanesSession({ keyField: "code" })()), some("code")));
        assert.ok(equalFor(OptionType(StringType))(idField(lanesSession({})()), none));
        assert.throws(() => lanesSession({ keyField: "label" }),
            /Flowchart\.lanes: `keyField` names "label", which one of the kind's roles writes — a row's key is kept in its key field by the builder, and nothing else writes it/);
    });

    test("a Plan's link kind: its session names the field, told none it names none, and a field an end names is refused", () => {
        assert.ok(equalFor(OptionType(StringType))(idField(feedsSession({ keyField: "ref" })()), some("ref")));
        assert.ok(equalFor(OptionType(StringType))(idField(feedsSession({})()), none));
        assert.throws(() => feedsSession({ keyField: "from" }),
            /Plan\.links: "Feed": `keyField` names "from", which one of the kind's roles writes — a row's key is kept in its key field by the builder, and nothing else writes it/);
    });
});

// Records declared with e3, as an app declares them: what each option's type is checked over.
const lanes = e3.record("key_field_lanes", Lanes, {
    initial: new Map(),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});
const feeds = e3.record("key_field_feeds", Feeds, {
    initial: new Map(),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

/** The options' type checks: never called — `tsc` checks what each line says. */
export function keyFieldKindChecks($: BlockBuilder<NullType>): void {
    const boundLanes = $.let(Record.bind(lanes));
    Flowchart.lanes(boundLanes, { label: "label", order: "seq", keyField: "code" });
    // @ts-expect-error — `seq` is a Float, and the lanes are keyed by a String
    Flowchart.lanes(boundLanes, { label: "label", order: "seq", keyField: "seq" });
    const boundFeeds = $.let(Record.bind(feeds));
    Plan.links(boundFeeds, { name: "Feed", icon: "arrow-right-long", from: { field: "from", of: "job" }, to: { field: "to", of: "job" }, keyField: "ref" });
    Plan.links(boundFeeds, {
        name: "Feed", icon: "arrow-right-long", from: { field: "from", of: "job" }, to: { field: "to", of: "job" },
        // @ts-expect-error — the feeds have no field `code`
        keyField: "code",
    });
}
