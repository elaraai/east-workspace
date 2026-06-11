/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** @jsxImportSource @elaraai/east-ui */

/**
 * Child coalescing contract (`src/jsx/children.ts`). The four cases the previous
 * runtime got silently wrong, each asserted East-equal to the factory output:
 * static children, a lone East `.map` array child kept whole, mixed static +
 * East-array children concatenated in source order, and an East `.map` inside a
 * Fragment.
 */

import { East, ArrayType, StringType } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Text, VStack, UIComponentType } from "@elaraai/east-ui";
import { Text as TextF, Stack } from "@elaraai/east-ui/internal";

describeEast("JSX children coalescing", (test) => {
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

    test("mixed static + East-array children concatenate in source order", ($) => {
        const labels = $.let(East.value(["a", "b"], ArrayType(StringType)));
        $(Assert.equal(
            <VStack gap="2"><Text>head</Text>{labels.map(($, s) => <Text>{s}</Text>)}<Text>tail</Text></VStack>,
            Stack.VStack(
                East.value([TextF.Root("head")], ArrayType(UIComponentType))
                    .concat(labels.map(($, s) => TextF.Root(s)))
                    .concat(East.value([TextF.Root("tail")], ArrayType(UIComponentType))),
                { gap: "2" },
            ),
        ));
    });

    test("a single child is wrapped into a one-element list", ($) => {
        $(Assert.equal(
            <VStack><Text>only</Text></VStack>,
            Stack.VStack([TextF.Root("only")]),
        ));
    });

    test("an East .map inside a Fragment coalesces like a direct child", ($) => {
        const labels = $.let(East.value(["a", "b"], ArrayType(StringType)));
        $(Assert.equal(
            <VStack><>{labels.map(($, s) => <Text>{s}</Text>)}</></VStack>,
            Stack.VStack(labels.map(($, s) => TextF.Root(s))),
        ));
    });
}, { platformFns: TestImpl });
