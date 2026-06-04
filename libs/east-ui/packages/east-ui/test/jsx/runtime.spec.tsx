/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** @jsxImportSource @elaraai/east-ui */

/**
 * JSX runtime foundation tests.
 *
 * Each case asserts a tag-built component is East-equal to the factory-built
 * component it desugars to. The four load-bearing dynamic cases (a lone East
 * array child, a mixed static + East array parent, an East array inside a
 * Fragment, and text interpolation) are the ones the previous runtime got
 * silently wrong; here they are pinned against the factory output.
 */

import { East, ArrayType, StringType } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Button, Text, VStack } from "@elaraai/east-ui/jsx";
import { Button as ButtonF, Text as TextF, Stack, UIComponentType } from "@elaraai/east-ui";

describeEast("JSX runtime", (test) => {
    test("Button tag desugars to Button.Root", ($) => {
        $(Assert.equal(
            <Button variant="solid" colorPalette="blue">Save</Button>,
            ButtonF.Root("Save", { style: { variant: "solid", colorPalette: "blue" } }),
        ));
    });

    test("static children desugar to a plain array", ($) => {
        $(Assert.equal(
            <VStack gap="2"><Text>one</Text><Text>two</Text></VStack>,
            Stack.VStack([TextF.Root("one"), TextF.Root("two")], { gap: "2" }),
        ));
    });

    test("a lone East .map child is kept whole (not pushed as one element)", ($) => {
        const labels = $.let(East.value(["a", "b", "c"], ArrayType(StringType)));
        $(Assert.equal(
            <VStack>{labels.map(($, s) => <Text>{s}</Text>)}</VStack>,
            Stack.VStack(labels.map(($, s) => TextF.Root(s))),
        ));
    });

    test("mixed static + East .map children concat in source order", ($) => {
        const labels = $.let(East.value(["x", "y"], ArrayType(StringType)));
        $(Assert.equal(
            <VStack><Text>head</Text>{labels.map(($, s) => <Text>{s}</Text>)}</VStack>,
            Stack.VStack(
                East.value([TextF.Root("head")], ArrayType(UIComponentType)).concat(
                    labels.map(($, s) => TextF.Root(s)),
                ),
            ),
        ));
    });

    test("an East .map inside a Fragment coalesces like a direct child", ($) => {
        const labels = $.let(East.value(["a", "b"], ArrayType(StringType)));
        $(Assert.equal(
            <VStack><>{labels.map(($, s) => <Text>{s}</Text>)}</></VStack>,
            Stack.VStack(labels.map(($, s) => TextF.Root(s))),
        ));
    });

    test("text interpolation folds via East.str instead of throwing", ($) => {
        const name = $.let(East.value("Ada", StringType));
        $(Assert.equal(
            <Text>Hi {name}!</Text>,
            TextF.Root(East.str`Hi ${name}!`),
        ));
    });
}, { platformFns: TestImpl });
