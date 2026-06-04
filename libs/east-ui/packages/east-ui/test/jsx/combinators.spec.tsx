/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** @jsxImportSource @elaraai/east-ui */

/**
 * Tag-builder combinator contract (`src/jsx/combinators.ts`). One representative
 * per shape — `container`, `textLeaf`, `leaf`, the shape-3 `Button`, the
 * builder-children `Reactive` — each asserted East-equal to the factory call it
 * desugars to, plus the `joinText` text/numeric folds. Per-component coverage
 * lives in each component's `*.examples.tsx`, so this stays a small contract.
 */

import { East, StringType } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Badge, Button, Checkbox, Code, Flex, HStack, Reactive, ScrollArea, Slider, Text } from "@elaraai/east-ui/jsx";
import {
    Badge as BadgeF,
    Button as ButtonF,
    Checkbox as CheckboxF,
    Code as CodeF,
    Flex as FlexF,
    ScrollArea as ScrollAreaF,
    Slider as SliderF,
    Text as TextF,
    Stack,
} from "@elaraai/east-ui";

describeEast("JSX tag combinators", (test) => {
    test("shape-3 Button desugars to Button.Root", ($) => {
        $(Assert.equal(
            <Button variant="solid" colorPalette="blue">Save</Button>,
            ButtonF.Root("Save", { style: { variant: "solid", colorPalette: "blue" } }),
        ));
    });

    test("container/textLeaf tags (Flex/Code/Badge) desugar to their factories", ($) => {
        $(Assert.equal(
            <Flex direction="row" gap="2"><Code>x = 1</Code></Flex>,
            FlexF.Root([CodeF.Root("x = 1")], { direction: "row", gap: "2" }),
        ));
        $(Assert.equal(
            <Badge variant="solid" colorPalette="green">Active</Badge>,
            BadgeF.Root("Active", { variant: "solid", colorPalette: "green" }),
        ));
    });

    test("value-leaf tags (Checkbox/Slider) desugar to their factories", ($) => {
        $(Assert.equal(
            <Checkbox checked={true} colorPalette="blue" />,
            CheckboxF.Root(true, { colorPalette: "blue" }),
        ));
        $(Assert.equal(
            <Slider value={5.0} min={0.0} max={10.0} />,
            SliderF.Root(5.0, { min: 0.0, max: 10.0 }),
        ));
    });

    test("text is a single string value (interpolate East-side with East.str)", ($) => {
        const name = $.let(East.value("Ada", StringType));
        $(Assert.equal(
            <Text>{East.str`Hi ${name}!`}</Text>,
            TextF.Root(East.str`Hi ${name}!`),
        ));
    });

    test("single-content tag (ScrollArea) forwards its one child", ($) => {
        $(Assert.equal(
            <ScrollArea><Text>scroll me</Text></ScrollArea>,
            ScrollAreaF.Root(TextF.Root("scroll me")),
        ));
    });

    test("a single component child is the Button label", ($) => {
        $(Assert.equal(
            <Button><HStack><Text>Accept</Text></HStack></Button>,
            ButtonF.Root(Stack.HStack([TextF.Root("Accept")])),
        ));
    });

    test("Reactive builder-children tag lifts the $ block", ($) => {
        const r = $.let(<Reactive>{($) => {
            const label = $.let(East.value("hi", StringType));
            return <Text>{label}</Text>;
        }}</Reactive>);
        $(Assert.equal(r.unwrap().getTag(), "ReactiveComponent"));
    });
}, { platformFns: TestImpl });
