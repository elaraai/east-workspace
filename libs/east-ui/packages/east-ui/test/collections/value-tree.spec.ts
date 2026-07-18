/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import {
    ArrayType,
    DictType,
    East,
    IntegerType,
    OptionType,
    RecursiveType,
    SetType,
    StringType,
    StructType,
    VariantType,
    some,
    none,
    variant,
} from "@elaraai/east";
import { ValueTree } from "@elaraai/east-ui";

import * as ex from "./value-tree.examples.js";

describeEast("ValueTree", (test) => {
    Assert.examples(test, {
        valueTreeBasic: ex.valueTreeBasic,
        valueTreeDictOfStructs: ex.valueTreeDictOfStructs,
        valueTreeEditable: ex.valueTreeEditable,
        valueTreeCollections: ex.valueTreeCollections,
    });

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
        const value = $.const(East.value(new Map([
            ["m1", { operator: some("dana"), status: variant("running", 3n) }],
            ["m2", { operator: none, status: variant("down", "belt snapped") }],
        ]), DictType(StringType, StructType({
            operator: OptionType(StringType),
            status: StatusType,
        }))));
        const ui = $.let(ValueTree.Root(value));
        const entries = $.let(ui.unwrap().unwrap("ValueTree").root.unwrap().unwrap("dict").entries);
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
        const ListType = RecursiveType(self => VariantType({
            nil: StructType({}),
            cons: StructType({ head: IntegerType, tail: self }),
        }));
        const value = $.const(East.value(
            variant("cons", { head: 1n, tail: variant("cons", { head: 2n, tail: variant("nil", {}) }) }),
            ListType));
        const ui = $.let(ValueTree.Root(value));
        const first = $.let(ui.unwrap().unwrap("ValueTree").root.unwrap().unwrap("variant"));
        $(Assert.equal(first.tag, "cons"));
        const firstFields = $.let(first.value.unwrap().unwrap("struct").fields);
        $(Assert.equal(firstFields.get(0n).node.unwrap().unwrap("leaf").unwrap("integer"), 1n));
        const second = $.let(firstFields.get(1n).node.unwrap().unwrap("variant"));
        $(Assert.equal(second.tag, "cons"));
    });

    test("prints unsupported types as opaque nodes", $ => {
        const value = $.const(East.value(new Set([1n, 2n]), SetType(IntegerType)));
        const ui = $.let(ValueTree.Root(value));
        $(Assert.equal(ui.unwrap().unwrap("ValueTree").root.unwrap().hasTag("opaque"), true));
    });

    test("carries callbacks and style through the payload", $ => {
        const ui = $.let(ValueTree.Root({ n: 1n }, { style: { height: "320px" } }));
        const payload = $.let(ui.unwrap().unwrap("ValueTree"));
        $(Assert.equal(payload.onEdit.hasTag("none"), true));
        $(Assert.equal(payload.style.unwrap("some").height.unwrap("some"), "320px"));
    });

    test("zero builds a default value for compound types", $ => {
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
    });
}, { platformFns: TestImpl });
