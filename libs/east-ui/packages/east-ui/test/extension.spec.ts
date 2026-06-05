/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { East, StructType, StringType, IntegerType, OptionType, encodeBeast2For, decodeBeast2For, equalFor, some } from "@elaraai/east";
import { EastUI, UIComponentType } from "@elaraai/east-ui/internal";
import * as ex from "./extension.examples.js";

describeEast("EastUI.component (extension API)", (test) => {
    Assert.examples(test, {
        counterBasic: ex.counterBasic,
        counterInsideStack: ex.counterInsideStack,
        bannerExample: ex.bannerExample,
    });

    test("EastUI.component returns a def with name, schema, and optional flag", $ => {
        const Schema = StructType({ x: IntegerType });
        const Comp = EastUI.component("Comp", Schema, { optional: true });
        $(Assert.equal(East.value(Comp.name), "Comp"));
        $(Assert.equal(East.value(Comp.optional), true));
    });

    test("optional defaults to false", $ => {
        const Schema = StructType({ y: StringType });
        const Comp = EastUI.component("Required", Schema);
        $(Assert.equal(East.value(Comp.optional), false));
    });

    test("Root produces a UIComponentType variant tagged Extension with the right kind", $ => {
        const Schema = StructType({ x: IntegerType });
        const Comp = EastUI.component("MyKind", Schema);
        const tree = $.let(Comp.Root({ x: 7n }), UIComponentType);
        const ext = tree.unwrap().unwrap("Extension");
        $(Assert.equal(ext.kind, "MyKind"));
    });

    test("Root payload round-trips through beast2 to the original value", () => {
        // Pure JS roundtrip — the IR layer carries bytes; the renderer decodes them.
        const Schema = StructType({
            label: StringType,
            value: IntegerType,
            accent: OptionType(StringType),
        });
        const original = {
            label: "Visits",
            value: 42n,
            accent: some("#488e97"),
        };
        const payload = encodeBeast2For(Schema)(original);
        const decoded = decodeBeast2For(Schema)(payload);
        // The decoded value should be structurally equal to the original.
        const valuesEqual = equalFor(Schema);
        if (!valuesEqual(original, decoded as typeof original)) {
            throw new Error("payload did not round-trip via beast2");
        }
    });
}, { platformFns: TestImpl });
