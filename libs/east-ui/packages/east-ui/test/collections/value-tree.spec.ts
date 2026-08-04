/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import {
    ArrayType,
    BlobType,
    BooleanType,
    DateTimeType,
    DictType,
    East,
    FloatType,
    IntegerType,
    MatrixType,
    NullType,
    OptionType,
    RecursiveType,
    RefType,
    SetType,
    StringType,
    StructType,
    VariantType,
    VectorType,
    isValueOf,
    some,
    none,
    variant,
    type ExprType,
} from "@elaraai/east";
import { UIComponentType, ValueTree } from "@elaraai/east-ui";

import * as ex from "./value-tree.examples.js";

/** The host value type of a linked list used across recursion tests. */
const ListType = RecursiveType(self => VariantType({
    nil: StructType({}),
    cons: StructType({ head: IntegerType, tail: self }),
}));

describeEast("ValueTree", (test) => {
    Assert.examples(test, {
        valueTreeBasic: ex.valueTreeBasic,
        valueTreeVirtualized: ex.valueTreeVirtualized,
        valueTreeFillsBoundedParent: ex.valueTreeFillsBoundedParent,
        valueTreeKitchenSink: ex.valueTreeKitchenSink,
        valueTreeEditingContracts: ex.valueTreeEditingContracts,
    });

    // ------------------------------------------------------------------
    // Panels — every merged example stays mounted as a captioned row (#461).
    // The mono-uppercase Text captions are the stable per-mini anchors.
    // ------------------------------------------------------------------

    test("valueTreeKitchenSink drives its preview from inline option tables", $ => {
        // Everything the configurator needs — the data-shape table routing
        // between the two deep-tree fixtures — is declared inside the example
        // body, because the documentation capture only extracts `fn`. That
        // puts the tables inside the Reactive body, which TestImpl does not
        // execute, so they cannot be asserted from here; `Assert.examples`
        // above still compiles and evaluates the outer function. The
        // materialization coverage lives in the ValueTree.Root tests below,
        // which construct each node kind directly.
        const panel = $.const(ex.valueTreeKitchenSink.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });

    test("valueTreeEditingContracts panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.valueTreeEditingContracts.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 10n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "TREE EDITABLE"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "TREE SCOPED"));
        $(Assert.equal(rows.get(4n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "TREE COLLECTIONS"));
        $(Assert.equal(rows.get(6n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "TREE RAW PATHS"));
        $(Assert.equal(rows.get(8n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "TREE KITCHEN SINK EDITABLE"));
    });

    // ------------------------------------------------------------------
    // Materialization
    // ------------------------------------------------------------------

    test("materializes a struct into struct/leaf/array nodes", $ => {
        const ui = $.let(ValueTree.Root({ rate: 0.15, label: "Base", tags: ["a", "b"] }));
        const root = $.let(ui.unwrap().unwrap("ValueTree").root);
        const fields = $.let(root.unwrap().unwrap("struct").fields);
        $(Assert.equal(fields.size(), 3n));
        $(Assert.equal(fields.get(0n).name, "rate"));
        $(Assert.equal(fields.get(0n).node.unwrap().unwrap("leaf").unwrap("float"), 0.15));
        $(Assert.equal(fields.get(1n).node.unwrap().unwrap("leaf").unwrap("string"), "Base"));
        const items = $.let(fields.get(2n).node.unwrap().unwrap("array").items);
        $(Assert.equal(items.size(), 2n));
        $(Assert.equal(items.get(0n).unwrap().unwrap("leaf").unwrap("string"), "a"));
    });

    test("materializes dict entries, options and variants", $ => {
        const StatusType = VariantType({ running: IntegerType, down: StringType });
        const value = $.const(new Map([
            ["m1", { operator: some("dana"), status: variant("running", 3n) }],
            ["m2", { operator: none, status: variant("down", "belt snapped") }],
        ]), DictType(StringType, StructType({
            operator: OptionType(StringType),
            status: StatusType,
        })));
        const ui = $.let(ValueTree.Root(value));
        const dict = $.let(ui.unwrap().unwrap("ValueTree").root.unwrap().unwrap("dict"));
        $(Assert.equal(dict.editable, true));
        const entries = $.let(dict.entries);
        $(Assert.equal(entries.size(), 2n));
        $(Assert.equal(entries.get(0n).key, "m1"));
        const m1 = $.let(entries.get(0n).node.unwrap().unwrap("struct").fields);
        $(Assert.equal(
            m1.get(0n).node.unwrap().unwrap("option").value.unwrap("some")
                .unwrap().unwrap("leaf").unwrap("string"),
            "dana"));
        const m1status = $.let(m1.get(1n).node.unwrap().unwrap("variant"));
        $(Assert.equal(m1status.tag, "running"));
        // Variant cases are stored in East's canonical (sorted) order.
        $(Assert.equal(m1status.tags, ["down", "running"]));
        $(Assert.equal(m1status.value.unwrap().unwrap("leaf").unwrap("integer"), 3n));
        const m2 = $.let(entries.get(1n).node.unwrap().unwrap("struct").fields);
        $(Assert.equal(m2.get(0n).node.unwrap().unwrap("option").value.hasTag("none"), true));
    });

    test("materializes recursive values by unrolling the type", $ => {
        const value = $.const(
            variant("cons", { head: 1n, tail: variant("cons", { head: 2n, tail: variant("nil", {}) }) }),
            ListType);
        const ui = $.let(ValueTree.Root(value));
        const first = $.let(ui.unwrap().unwrap("ValueTree").root.unwrap().unwrap("variant"));
        $(Assert.equal(first.tag, "cons"));
        const firstFields = $.let(first.value.unwrap().unwrap("struct").fields);
        $(Assert.equal(firstFields.get(0n).node.unwrap().unwrap("leaf").unwrap("integer"), 1n));
        const second = $.let(firstFields.get(1n).node.unwrap().unwrap("variant"));
        $(Assert.equal(second.tag, "cons"));
    });

    test("summarizes sets, blobs and vectors as kinded opaque nodes", $ => {
        const value = $.const({
            tags: new Set(["a", "b"]),
            checksum: new Uint8Array([1, 2, 3]),
            samples: new Float64Array([1.0, 2.0, 3.0]),
        }, StructType({
            tags: SetType(StringType),
            checksum: BlobType,
            samples: VectorType(FloatType),
        }));
        const ui = $.let(ValueTree.Root(value));
        const fields = $.let(ui.unwrap().unwrap("ValueTree").root.unwrap().unwrap("struct").fields);
        $(Assert.equal(fields.get(0n).node.unwrap().unwrap("opaque"), "Set · 2 items"));
        $(Assert.equal(fields.get(1n).node.unwrap().unwrap("opaque"), "Blob · 3 bytes"));
        $(Assert.equal(fields.get(2n).node.unwrap().unwrap("opaque"), "Vector · 3 values"));
    });

    test("materializes non-string dict keys as browsable read-only entries", $ => {
        const value = $.const(new Map([[7n, "critical"], [12n, "routine"]]),
            DictType(IntegerType, StringType));
        const ui = $.let(ValueTree.Root(value));
        const dict = $.let(ui.unwrap().unwrap("ValueTree").root.unwrap().unwrap("dict"));
        $(Assert.equal(dict.editable, false));
        $(Assert.equal(dict.entries.size(), 2n));
        $(Assert.equal(dict.entries.get(0n).key, "7"));
        $(Assert.equal(dict.entries.get(0n).node.unwrap().unwrap("leaf").unwrap("string"), "critical"));
    });

    test("materializes empty collections with zero children", $ => {
        const value = $.const({
            samples: [],
            thresholds: new Map(),
        }, StructType({
            samples: ArrayType(FloatType),
            thresholds: DictType(StringType, FloatType),
        }));
        const ui = $.let(ValueTree.Root(value));
        const fields = $.let(ui.unwrap().unwrap("ValueTree").root.unwrap().unwrap("struct").fields);
        $(Assert.equal(fields.get(0n).node.unwrap().unwrap("array").items.size(), 0n));
        $(Assert.equal(fields.get(1n).node.unwrap().unwrap("dict").entries.size(), 0n));
    });

    test("carries callbacks and style through the payload", $ => {
        const ui = $.let(ValueTree.Root({ n: 1n }, { style: { height: "320px" } }));
        const payload = $.let(ui.unwrap().unwrap("ValueTree"));
        $(Assert.equal(payload.onEdit.hasTag("none"), true));
        $(Assert.equal(payload.style.unwrap("some").height.unwrap("some"), "320px"));
    });

    test("zero delegates to east's defaultValue across every data type", $ => {
        const T = StructType({
            n: IntegerType,
            tags: ArrayType(StringType),
            opt: OptionType(StringType),
        });
        const ui = $.let(ValueTree.Root(East.value(ValueTree.zero(T), T)));
        const fields = $.let(ui.unwrap().unwrap("ValueTree").root.unwrap().unwrap("struct").fields);
        $(Assert.equal(fields.get(0n).node.unwrap().unwrap("leaf").unwrap("integer"), 0n));
        $(Assert.equal(fields.get(1n).node.unwrap().unwrap("array").items.size(), 0n));
        $(Assert.equal(fields.get(2n).node.unwrap().unwrap("option").value.hasTag("none"), true));
        const vectorOk = $.const(isValueOf(ValueTree.zero(VectorType(FloatType)), VectorType(FloatType)));
        $(Assert.equal(vectorOk, true));
        const refOk = $.const(isValueOf(ValueTree.zero(RefType(IntegerType)), RefType(IntegerType)));
        $(Assert.equal(refOk, true));
        const matrixOk = $.const(isValueOf(ValueTree.zero(MatrixType(FloatType)), MatrixType(FloatType)));
        $(Assert.equal(matrixOk, true));
    });

    // ------------------------------------------------------------------
    // Generated wrappers: rebuild + onUpdate
    // ------------------------------------------------------------------

    test("onUpdate receives the whole value with a leaf edit applied", $ => {
        const T = DictType(StringType, FloatType);
        const data = $.let(new Map([["base", 0.15], ["peak", 0.4]]), T);
        const captured = $.let(new Map(), DictType(StringType, T));
        const onUpdate = $.const(East.function([T], NullType, ($h, next) => {
            $h(captured.insertOrUpdate("root", next));
        }));
        const ui = $.let(ValueTree.Root(data, { onUpdate }));
        const edit = $.let(ui.unwrap().unwrap("ValueTree").onEdit.unwrap("some"));
        $(edit.call([variant("key", "base")], variant("float", 0.99)));
        $(Assert.equal(captured.get("root").get("base"), 0.99));
        $(Assert.equal(captured.get("root").get("peak"), 0.4));
        // The rebuild is functional — the source value is untouched.
        $(Assert.equal(data.get("base"), 0.15));
    });

    test("rebuilds deep edits through dict, array and struct levels", $ => {
        const T = DictType(StringType, StructType({
            machines: ArrayType(StructType({ name: StringType, rate: FloatType })),
        }));
        const data = $.let(new Map([
            ["packing", { machines: [{ name: "Press", rate: 2.5 }, { name: "Mill", rate: 1.25 }] }],
        ]), T);
        const captured = $.let(new Map(), DictType(StringType, T));
        const onUpdate = $.const(East.function([T], NullType, ($h, next) => {
            $h(captured.insertOrUpdate("root", next));
        }));
        const ui = $.let(ValueTree.Root(data, { onUpdate }));
        const edit = $.let(ui.unwrap().unwrap("ValueTree").onEdit.unwrap("some"));
        $(edit.call(
            [variant("key", "packing"), variant("field", "machines"), variant("index", 1n), variant("field", "name")],
            variant("string", "Grinder")));
        const machines = $.let(captured.get("root").get("packing").machines);
        $(Assert.equal(machines.get(1n).name, "Grinder"));
        $(Assert.equal(machines.get(0n).name, "Press"));
        $(Assert.equal(machines.get(1n).rate, 1.25));
    });

    test("applies every leaf kind: string, integer, float, boolean, datetime", $ => {
        const T = StructType({
            name: StringType,
            batch: IntegerType,
            rate: FloatType,
            active: BooleanType,
            commissioned: DateTimeType,
        });
        const data = $.let({
            name: "Press", batch: 42n, rate: 2.5, active: false,
            commissioned: new Date("2021-06-01T00:00:00Z"),
        }, T);
        const captured = $.let(new Map(), DictType(StringType, T));
        const onUpdate = $.const(East.function([T], NullType, ($h, next) => {
            $h(captured.insertOrUpdate("root", next));
        }));
        const ui = $.let(ValueTree.Root(data, { onUpdate }));
        const edit = $.let(ui.unwrap().unwrap("ValueTree").onEdit.unwrap("some"));
        $(edit.call([variant("field", "name")], variant("string", "Mill")));
        $(Assert.equal(captured.get("root").name, "Mill"));
        $(edit.call([variant("field", "batch")], variant("integer", 7n)));
        $(Assert.equal(captured.get("root").batch, 7n));
        $(edit.call([variant("field", "rate")], variant("float", 1.25)));
        $(Assert.equal(captured.get("root").rate, 1.25));
        $(edit.call([variant("field", "active")], variant("boolean", true)));
        $(Assert.equal(captured.get("root").active, true));
        $(edit.call([variant("field", "commissioned")], variant("datetime", new Date("2026-01-01T00:00:00Z"))));
        $(Assert.equal(captured.get("root").commissioned, new Date("2026-01-01T00:00:00Z")));
    });

    test("toggles options: edits through some, tags to none, tags to zeroed some", $ => {
        const T = StructType({ operator: OptionType(StringType) });
        const data = $.let({ operator: some("dana") }, T);
        const captured = $.let(new Map(), DictType(StringType, T));
        const onUpdate = $.const(East.function([T], NullType, ($h, next) => {
            $h(captured.insertOrUpdate("root", next));
        }));
        const ui = $.let(ValueTree.Root(data, { onUpdate }));
        const payload = $.let(ui.unwrap().unwrap("ValueTree"));
        const edit = $.let(payload.onEdit.unwrap("some"));
        const tag = $.let(payload.onTag.unwrap("some"));
        $(edit.call([variant("field", "operator"), variant("some", null)], variant("string", "alex")));
        $(Assert.equal(captured.get("root").operator.unwrap("some"), "alex"));
        $(tag.call([variant("field", "operator")], "none"));
        $(Assert.equal(captured.get("root").operator.hasTag("none"), true));
        $(tag.call([variant("field", "operator")], "some"));
        // Toggling on installs the zero payload ("").
        $(Assert.equal(captured.get("root").operator.unwrap("some"), ""));
    });

    test("switches variant tags with zeroed payloads and edits inside payloads", $ => {
        const StateType = VariantType({
            running: StructType({ rate: FloatType }),
            down: StructType({ reason: StringType }),
        });
        const T = StructType({ state: StateType });
        const data = $.let({ state: variant("running", { rate: 2.5 }) }, T);
        const captured = $.let(new Map(), DictType(StringType, T));
        const onUpdate = $.const(East.function([T], NullType, ($h, next) => {
            $h(captured.insertOrUpdate("root", next));
        }));
        const ui = $.let(ValueTree.Root(data, { onUpdate }));
        const payload = $.let(ui.unwrap().unwrap("ValueTree"));
        const edit = $.let(payload.onEdit.unwrap("some"));
        const tag = $.let(payload.onTag.unwrap("some"));
        $(edit.call(
            [variant("field", "state"), variant("tag", null), variant("field", "rate")],
            variant("float", 3.5)));
        $(Assert.equal(captured.get("root").state.unwrap("running").rate, 3.5));
        $(tag.call([variant("field", "state")], "down"));
        $(Assert.equal(captured.get("root").state.unwrap("down").reason, ""));
    });

    test("array inserts append zeros and removes drop the indexed element", $ => {
        const T = ArrayType(FloatType);
        const data = $.let([1.0, 2.5, 4.0], T);
        const captured = $.let(new Map(), DictType(StringType, T));
        const onUpdate = $.const(East.function([T], NullType, ($h, next) => {
            $h(captured.insertOrUpdate("root", next));
        }));
        const ui = $.let(ValueTree.Root(data, { onUpdate }));
        const payload = $.let(ui.unwrap().unwrap("ValueTree"));
        const insert = $.let(payload.onInsert.unwrap("some"));
        const remove = $.let(payload.onRemove.unwrap("some"));
        $(insert.call([variant("append", null)]));
        $(Assert.equal(captured.get("root"), [1.0, 2.5, 4.0, 0.0]));
        $(remove.call([variant("index", 1n)]));
        $(Assert.equal(captured.get("root"), [1.0, 4.0]));
    });

    test("an array append inside a dict entry never inserts a dict key", $ => {
        const T = DictType(StringType, ArrayType(FloatType));
        const data = $.let(new Map([["a", [1.0]]]), T);
        const captured = $.let(new Map(), DictType(StringType, T));
        const onUpdate = $.const(East.function([T], NullType, ($h, next) => {
            $h(captured.insertOrUpdate("root", next));
        }));
        const ui = $.let(ValueTree.Root(data, { onUpdate }));
        const insert = $.let(ui.unwrap().unwrap("ValueTree").onInsert.unwrap("some"));
        // Terminal `append` step: grows the nested array, not the dict.
        $(insert.call([variant("key", "a"), variant("append", null)]));
        $(Assert.equal(captured.get("root").size(), 1n));
        $(Assert.equal(captured.get("root").get("a"), [1.0, 0.0]));
        // Terminal `key` step: inserts a zeroed dict entry.
        $(insert.call([variant("key", "b")]));
        $(Assert.equal(captured.get("root").size(), 2n));
        $(Assert.equal(captured.get("root").get("b"), []));
    });

    test("dict removes drop the keyed entry and leave the source untouched", $ => {
        const T = DictType(StringType, FloatType);
        const data = $.let(new Map([["base", 0.15], ["peak", 0.4]]), T);
        const captured = $.let(new Map(), DictType(StringType, T));
        const onUpdate = $.const(East.function([T], NullType, ($h, next) => {
            $h(captured.insertOrUpdate("root", next));
        }));
        const ui = $.let(ValueTree.Root(data, { onUpdate }));
        const remove = $.let(ui.unwrap().unwrap("ValueTree").onRemove.unwrap("some"));
        $(remove.call([variant("key", "base")]));
        $(Assert.equal(captured.get("root").size(), 1n));
        $(Assert.equal(captured.get("root").has("base"), false));
        $(Assert.equal(data.size(), 2n));
    });

    test("rebuilds edits through recursive unrollings", $ => {
        const data = $.let(
            variant("cons", { head: 1n, tail: variant("cons", { head: 2n, tail: variant("nil", {}) }) }),
            ListType);
        const captured = $.let(new Map(), DictType(StringType, ListType));
        const onUpdate = $.const(East.function([ListType], NullType, ($h, next) => {
            $h(captured.insertOrUpdate("root", next));
        }));
        const ui = $.let(ValueTree.Root<typeof ListType>(data, { onUpdate }));
        const edit = $.let(ui.unwrap().unwrap("ValueTree").onEdit.unwrap("some"));
        $(edit.call(
            [variant("tag", null), variant("field", "tail"), variant("tag", null), variant("field", "head")],
            variant("integer", 99n)));
        const second = $.let(captured.get("root").unwrap().unwrap("cons").tail.unwrap().unwrap("cons"));
        $(Assert.equal(second.head, 99n));
        $(Assert.equal(captured.get("root").unwrap().unwrap("cons").head, 1n));
    });

    test("edits beyond the recursion cap pass the value through unchanged", $ => {
        let deep: unknown = variant("nil", {});
        for (let i = 0; i < 10; i += 1) {
            deep = variant("cons", { head: BigInt(i), tail: deep });
        }
        const data = $.let(deep as never, ListType);
        const captured = $.let(new Map(), DictType(StringType, ListType));
        const onUpdate = $.const(East.function([ListType], NullType, ($h, next) => {
            $h(captured.insertOrUpdate("root", next));
        }));
        const ui = $.let(ValueTree.Root<typeof ListType>(data, { onUpdate }));
        const edit = $.let(ui.unwrap().unwrap("ValueTree").onEdit.unwrap("some"));
        const deepPath: unknown[] = [];
        for (let i = 0; i < 8; i += 1) {
            deepPath.push(variant("tag", null), variant("field", "tail"));
        }
        deepPath.push(variant("tag", null), variant("field", "head"));
        $(edit.call(deepPath as never, variant("integer", 999n)));
        // The target sits beyond MAX_RECURSION_DEPTH — nothing changes.
        $(Assert.equal(captured.get("root"), data));
    });

    test("async handlers (the State-writing shape) dispatch through the wrappers", $ => {
        // Hosts writing State pass ASYNC handlers — the payload slots and
        // generated wrappers must accept them (the sync shape is their
        // subtype). Regression: a sync-typed slot rejects these at runtime.
        const T = DictType(StringType, FloatType);
        const data = $.let(new Map([["base", 0.15]]), T);
        const captured = $.let(new Map(), DictType(StringType, T));
        const onUpdate = $.const(East.asyncFunction([T], NullType, ($h, next) => {
            $h(captured.insertOrUpdate("root", next));
        }));
        const ui = $.let(ValueTree.Root(data, { onUpdate }));
        const payload = $.let(ui.unwrap().unwrap("ValueTree"));
        $(payload.onInsert.unwrap("some").call([variant("key", "peak")]));
        $(Assert.equal(captured.get("root").has("peak"), true));
        $(payload.onEdit.unwrap("some").call([variant("key", "base")], variant("float", 0.5)));
        $(Assert.equal(captured.get("root").get("base"), 0.5));
    });

    test("raw path callbacks override the generated handler per event", $ => {
        const T = DictType(StringType, FloatType);
        const data = $.let(new Map([["base", 0.15]]), T);
        const rootCaptured = $.let(new Map(), DictType(StringType, T));
        const pathCaptured = $.let(new Map(), DictType(StringType, ValueTree.Types.Path));
        const onUpdate = $.const(East.function([T], NullType, ($h, next) => {
            $h(rootCaptured.insertOrUpdate("root", next));
        }));
        const onEdit = $.const(East.function(
            [ValueTree.Types.Path, ValueTree.Types.Leaf], NullType,
            ($h, path, _leaf) => {
                $h(pathCaptured.insertOrUpdate("edit", path));
            }));
        const ui = $.let(ValueTree.Root(data, { onUpdate, onEdit }));
        const payload = $.let(ui.unwrap().unwrap("ValueTree"));
        // The raw onEdit wins for leaf edits…
        $(payload.onEdit.unwrap("some").call([variant("key", "base")], variant("float", 1.0)));
        $(Assert.equal(pathCaptured.get("edit"), [variant("key", "base")]));
        $(Assert.equal(rootCaptured.has("root"), false));
        // …while other events still flow through the generated rebuild.
        $(payload.onInsert.unwrap("some").call([variant("key", "peak")]));
        $(Assert.equal(rootCaptured.get("root").has("peak"), true));
    });

    // ------------------------------------------------------------------
    // Scoped dispatch + bubbling
    // ------------------------------------------------------------------

    test("the deepest matching scope receives the rebuilt subtree", $ => {
        const MachineT = StructType({ name: StringType, rate: FloatType });
        const T = DictType(StringType, MachineT);
        const data = $.let(new Map([
            ["press", { name: "Press", rate: 2.5 }],
            ["mill", { name: "Mill", rate: 1.25 }],
        ]), T);
        const rootCaptured = $.let(new Map(), DictType(StringType, T));
        const machineCaptured = $.let(new Map(), DictType(StringType, MachineT));
        const onUpdate = $.const(East.function([T], NullType, ($h, next) => {
            $h(rootCaptured.insertOrUpdate("root", next));
        }));
        const onPress = $.const(East.function([MachineT], NullType, ($h, m) => {
            $h(machineCaptured.insertOrUpdate("press", m));
        }));
        const ui = $.let(ValueTree.Root(data, {
            onUpdate,
            at: [ValueTree.at(T, p => p.entry("press"), onPress)],
        }));
        const edit = $.let(ui.unwrap().unwrap("ValueTree").onEdit.unwrap("some"));
        // Inside the scope: only the scope handler fires, with the subtree.
        $(edit.call([variant("key", "press"), variant("field", "rate")], variant("float", 3.0)));
        $(Assert.equal(machineCaptured.get("press").rate, 3.0));
        $(Assert.equal(machineCaptured.get("press").name, "Press"));
        $(Assert.equal(rootCaptured.has("root"), false));
        // Outside the scope: bubbles to onUpdate, the scope stays quiet.
        $(edit.call([variant("key", "mill"), variant("field", "rate")], variant("float", 1.5)));
        $(Assert.equal(rootCaptured.get("root").get("mill").rate, 1.5));
        $(Assert.equal(machineCaptured.size(), 1n));
    });

    test("nested scopes dispatch deepest-first with bubbling between them", $ => {
        const MachineT = StructType({ name: StringType, rate: FloatType });
        const T = StructType({
            site: StringType,
            machines: DictType(StringType, MachineT),
        });
        const data = $.let({
            site: "Riverside",
            machines: new Map([["m1", { name: "Press", rate: 2.5 }], ["m2", { name: "Mill", rate: 1.25 }]]),
        }, T);
        const rootCaptured = $.let(new Map(), DictType(StringType, T));
        const machinesCaptured = $.let(new Map(), DictType(StringType, DictType(StringType, MachineT)));
        const m1Captured = $.let(new Map(), DictType(StringType, MachineT));
        const onUpdate = $.const(East.function([T], NullType, ($h, next) => {
            $h(rootCaptured.insertOrUpdate("root", next));
        }));
        const onMachines = $.const(East.function([DictType(StringType, MachineT)], NullType, ($h, ms) => {
            $h(machinesCaptured.insertOrUpdate("machines", ms));
        }));
        const onM1 = $.const(East.function([MachineT], NullType, ($h, m) => {
            $h(m1Captured.insertOrUpdate("m1", m));
        }));
        const ui = $.let(ValueTree.Root(data, {
            onUpdate,
            at: [
                ValueTree.at(T, p => p.machines, onMachines),
                ValueTree.at(T, p => p.machines.entry("m1"), onM1),
            ],
        }));
        const edit = $.let(ui.unwrap().unwrap("ValueTree").onEdit.unwrap("some"));
        // Deepest scope wins for m1.
        $(edit.call(
            [variant("field", "machines"), variant("key", "m1"), variant("field", "rate")],
            variant("float", 9.0)));
        $(Assert.equal(m1Captured.get("m1").rate, 9.0));
        $(Assert.equal(machinesCaptured.has("machines"), false));
        // The sibling entry bubbles to the machines scope.
        $(edit.call(
            [variant("field", "machines"), variant("key", "m2"), variant("field", "rate")],
            variant("float", 8.0)));
        $(Assert.equal(machinesCaptured.get("machines").get("m2").rate, 8.0));
        $(Assert.equal(m1Captured.size(), 1n));
        // Fields outside every scope bubble to the root.
        $(edit.call([variant("field", "site")], variant("string", "Lakeside")));
        $(Assert.equal(rootCaptured.get("root").site, "Lakeside"));
        $(Assert.equal(machinesCaptured.size(), 1n));
    });

    test("removing a scope's own subtree dispatches to its parent, not the scope", $ => {
        const MachineT = StructType({ name: StringType, rate: FloatType });
        const T = DictType(StringType, MachineT);
        const data = $.let(new Map([["press", { name: "Press", rate: 2.5 }]]), T);
        const rootCaptured = $.let(new Map(), DictType(StringType, T));
        const pressCaptured = $.let(new Map(), DictType(StringType, MachineT));
        const onUpdate = $.const(East.function([T], NullType, ($h, next) => {
            $h(rootCaptured.insertOrUpdate("root", next));
        }));
        const onPress = $.const(East.function([MachineT], NullType, ($h, m) => {
            $h(pressCaptured.insertOrUpdate("press", m));
        }));
        const ui = $.let(ValueTree.Root(data, {
            onUpdate,
            at: [ValueTree.at(T, p => p.entry("press"), onPress)],
        }));
        const remove = $.let(ui.unwrap().unwrap("ValueTree").onRemove.unwrap("some"));
        $(remove.call([variant("key", "press")]));
        // The scope's subtree no longer exists in the new value — its
        // PARENT (the root) receives the removal.
        $(Assert.equal(rootCaptured.get("root").size(), 0n));
        $(Assert.equal(pressCaptured.size(), 0n));
    });

    test("option scopes receive payload edits; clearing the option bubbles up", $ => {
        const T = StructType({ operator: OptionType(StringType) });
        const data = $.let({ operator: some("dana") }, T);
        const rootCaptured = $.let(new Map(), DictType(StringType, T));
        const nameCaptured = $.let(new Map(), DictType(StringType, StringType));
        const onUpdate = $.const(East.function([T], NullType, ($h, next) => {
            $h(rootCaptured.insertOrUpdate("root", next));
        }));
        const onName = $.const(East.function([StringType], NullType, ($h, name) => {
            $h(nameCaptured.insertOrUpdate("name", name));
        }));
        const ui = $.let(ValueTree.Root(data, {
            onUpdate,
            at: [ValueTree.at(T, p => p.operator.some(), onName)],
        }));
        const payload = $.let(ui.unwrap().unwrap("ValueTree"));
        $(payload.onEdit.unwrap("some").call(
            [variant("field", "operator"), variant("some", null)],
            variant("string", "alex")));
        $(Assert.equal(nameCaptured.get("name"), "alex"));
        $(Assert.equal(rootCaptured.has("root"), false));
        // Clearing the option happens AT the option, above the scope.
        $(payload.onTag.unwrap("some").call([variant("field", "operator")], "none"));
        $(Assert.equal(rootCaptured.get("root").operator.hasTag("none"), true));
        $(Assert.equal(nameCaptured.size(), 1n));
    });

    test("array item scopes receive the rebuilt element", $ => {
        const MachineT = StructType({ name: StringType, rate: FloatType });
        const T = ArrayType(MachineT);
        const data = $.let([{ name: "Press", rate: 2.5 }, { name: "Mill", rate: 1.25 }], T);
        const itemCaptured = $.let(new Map(), DictType(StringType, MachineT));
        const rootCaptured = $.let(new Map(), DictType(StringType, T));
        const onUpdate = $.const(East.function([T], NullType, ($h, next) => {
            $h(rootCaptured.insertOrUpdate("root", next));
        }));
        const onItem = $.const(East.function([MachineT], NullType, ($h, m) => {
            $h(itemCaptured.insertOrUpdate("item", m));
        }));
        const ui = $.let(ValueTree.Root(data, {
            onUpdate,
            at: [ValueTree.at(T, p => p.item(1), onItem)],
        }));
        const edit = $.let(ui.unwrap().unwrap("ValueTree").onEdit.unwrap("some"));
        $(edit.call([variant("index", 1n), variant("field", "name")], variant("string", "Grinder")));
        $(Assert.equal(itemCaptured.get("item").name, "Grinder"));
        $(Assert.equal(rootCaptured.has("root"), false));
    });

    test("scopes built against a mismatched root type fail at authoring time", $ => {
        const OtherT = StructType({ machines: DictType(StringType, FloatType) });
        const noop = East.function([DictType(StringType, FloatType)], NullType, (_$h, _v) => null);
        let threw = false;
        try {
            ValueTree.Root({ n: 1n }, {
                at: [ValueTree.at(OtherT, p => p.machines, noop)],
            });
        } catch {
            threw = true;
        }
        const threwE = $.const(threw);
        $(Assert.equal(threwE, true));
    });
}, { platformFns: TestImpl });
