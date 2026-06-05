/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, Reactive, Text, VStack, HStack } from "@elaraai/east-ui";

export const textBasic = example({
    keywords: ["Text", "Root", "basic"],
    description: "Plain text with no styling",
    fn: East.function([], UIComponentType, (_$) => {
        return <Text>Hello World - Basic Text</Text>;
    }),
    inputs: [],
});

export const textColored = example({
    keywords: ["Text", "Root", "color", "blue"],
    description: "Text with blue color",
    fn: East.function([], UIComponentType, (_$) => {
        return <Text color="blue.500">Blue colored text</Text>;
    }),
    inputs: [],
});

export const textBold = example({
    keywords: ["Text", "Root", "fontWeight", "bold"],
    description: "Text with bold font weight",
    fn: East.function([], UIComponentType, (_$) => {
        return <Text fontWeight="bold">Bold text</Text>;
    }),
    inputs: [],
});

export const textItalic = example({
    keywords: ["Text", "Root", "fontStyle", "italic"],
    description: "Text with italic font style",
    fn: East.function([], UIComponentType, (_$) => {
        return <Text fontStyle="italic">Italic text</Text>;
    }),
    inputs: [],
});

export const textFontWeights = example({
    keywords: ["Text", "Root", "fontWeight", "weights", "light", "normal", "medium", "semibold", "bold"],
    description: "All available font weights",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="4">
                <Text fontWeight="light">Light</Text>
                <Text fontWeight="normal">Normal</Text>
                <Text fontWeight="medium">Medium</Text>
                <Text fontWeight="semibold">Semibold</Text>
                <Text fontWeight="bold">Bold</Text>
            </HStack>
        );
    }),
    inputs: [],
});

export const textTransforms = example({
    keywords: ["Text", "Root", "textTransform", "uppercase", "lowercase", "capitalize"],
    description: "Text transformation options",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="4">
                <Text textTransform="uppercase">uppercase</Text>
                <Text textTransform="lowercase">LOWERCASE</Text>
                <Text textTransform="capitalize">capitalize</Text>
            </HStack>
        );
    }),
    inputs: [],
});

export const textBackground = example({
    keywords: ["Text", "Root", "background", "highlight"],
    description: "Text with background highlight",
    fn: East.function([], UIComponentType, (_$) => {
        return <Text background="yellow.200" color="gray.800">Highlighted text</Text>;
    }),
    inputs: [],
});

export const textBordered = example({
    keywords: ["Text", "Root", "border", "borderWidth", "borderStyle", "borderColor"],
    description: "Text with border styling",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Text borderWidth="thin" borderStyle="solid" borderColor="gray.400">
                Bordered text
            </Text>
        );
    }),
    inputs: [],
});

export const textColors = example({
    keywords: ["Text", "Root", "color", "palette", "red", "orange", "green", "teal", "blue", "purple"],
    description: "Various text colors",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="3">
                <Text color="red.500">Red</Text>
                <Text color="orange.500">Orange</Text>
                <Text color="green.500">Green</Text>
                <Text color="teal.500">Teal</Text>
                <Text color="blue.500">Blue</Text>
                <Text color="purple.500">Purple</Text>
            </HStack>
        );
    }),
    inputs: [],
});

export const textCombined = example({
    keywords: ["Text", "Root", "combined", "color", "fontWeight", "fontStyle", "background"],
    description: "Multiple styles on one text",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Text color="blue.600" fontWeight="bold" fontStyle="italic" background="blue.50">
                Styled Text
            </Text>
        );
    }),
    inputs: [],
});

export const textDecoration = example({
    keywords: ["Text", "Root", "textDecoration", "underline", "line-through", "overline"],
    description: "Underline, line-through, and overline",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="4">
                <Text textDecoration="underline">Underline</Text>
                <Text textDecoration="line-through">Line-through</Text>
                <Text textDecoration="overline">Overline</Text>
            </HStack>
        );
    }),
    inputs: [],
});

export const textSpacing = example({
    keywords: ["Text", "Root", "letterSpacing", "lineHeight", "spacing"],
    description: "Fine-tune text spacing",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="2" align="flex-start">
                <Text letterSpacing="tighter">Tight letter spacing</Text>
                <Text letterSpacing="wider">Wide letter spacing</Text>
                <Text lineHeight="tall" maxWidth="250px">Tall line height - wraps to show multi-line effect when the text is long enough</Text>
                <Text lineHeight="short" maxWidth="250px">Short line height - compact multi-line text when the content wraps</Text>
            </VStack>
        );
    }),
    inputs: [],
});

export const textOpacity = example({
    keywords: ["Text", "Root", "opacity", "transparency"],
    description: "Text with varying opacity",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="4">
                <Text color="blue.600" fontWeight="bold">100%</Text>
                <Text color="blue.600" fontWeight="bold" opacity={0.75}>75%</Text>
                <Text color="blue.600" fontWeight="bold" opacity={0.5}>50%</Text>
                <Text color="blue.600" fontWeight="bold" opacity={0.25}>25%</Text>
            </HStack>
        );
    }),
    inputs: [],
});

export const textPaddingMargin = example({
    keywords: ["Text", "Root", "padding", "margin", "spacing"],
    description: "Text with padding and margin",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="2" align="flex-start">
                <Text padding="4" background="blue.50" borderWidth="thin" borderStyle="solid" borderColor="blue.200">Padding: 4</Text>
                <Text padding="2" margin="4" background="green.50" borderWidth="thin" borderStyle="solid" borderColor="green.200">Padding: 2, Margin: 4</Text>
            </VStack>
        );
    }),
    inputs: [],
});

export const textOverflow = example({
    keywords: ["Text", "Root", "overflow", "width", "height", "textOverflow", "ellipsis"],
    description: "Text with constrained size and overflow",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="2" align="flex-start">
                <Text width="200px" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap" background="orange.50" padding="2">
                    This text is constrained to 200px width and will clip overflow content.
                </Text>
                <Text width="150px" height="40px" background="purple.50" padding="2" overflow="hidden">Fixed width and height box</Text>
            </VStack>
        );
    }),
    inputs: [],
});

export const textStyleScale = example({
    keywords: ["Text", "Root", "textStyle", "scale", "typography"],
    description: "Every textStyle token rendered as a row of its own",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="2" align="stretch">
                <HStack gap="3" align="baseline">
                    <Text textStyle="display-lg">Display LG</Text>
                    <Text textStyle="caption" color="fg.muted">display-lg</Text>
                </HStack>
                <HStack gap="3" align="baseline">
                    <Text textStyle="display-md">Display MD</Text>
                    <Text textStyle="caption" color="fg.muted">display-md</Text>
                </HStack>
                <HStack gap="3" align="baseline">
                    <Text textStyle="display-sm">Display SM</Text>
                    <Text textStyle="caption" color="fg.muted">display-sm</Text>
                </HStack>
                <HStack gap="3" align="baseline">
                    <Text textStyle="heading-lg">Heading LG</Text>
                    <Text textStyle="caption" color="fg.muted">heading-lg</Text>
                </HStack>
                <HStack gap="3" align="baseline">
                    <Text textStyle="heading-md">Heading MD</Text>
                    <Text textStyle="caption" color="fg.muted">heading-md</Text>
                </HStack>
                <HStack gap="3" align="baseline">
                    <Text textStyle="heading-sm">Heading SM</Text>
                    <Text textStyle="caption" color="fg.muted">heading-sm</Text>
                </HStack>
                <HStack gap="3" align="baseline">
                    <Text textStyle="heading-xs">Heading XS</Text>
                    <Text textStyle="caption" color="fg.muted">heading-xs</Text>
                </HStack>
                <HStack gap="3" align="baseline">
                    <Text textStyle="body-lg">Body LG</Text>
                    <Text textStyle="caption" color="fg.muted">body-lg</Text>
                </HStack>
                <HStack gap="3" align="baseline">
                    <Text textStyle="body-md">Body MD</Text>
                    <Text textStyle="caption" color="fg.muted">body-md</Text>
                </HStack>
                <HStack gap="3" align="baseline">
                    <Text textStyle="body-sm">Body SM</Text>
                    <Text textStyle="caption" color="fg.muted">body-sm</Text>
                </HStack>
                <HStack gap="3" align="baseline">
                    <Text textStyle="label-md">Label MD</Text>
                    <Text textStyle="caption" color="fg.muted">label-md</Text>
                </HStack>
                <HStack gap="3" align="baseline">
                    <Text textStyle="label-sm">Label SM</Text>
                    <Text textStyle="caption" color="fg.muted">label-sm</Text>
                </HStack>
                <HStack gap="3" align="baseline">
                    <Text textStyle="caption">Caption</Text>
                    <Text textStyle="caption" color="fg.muted">caption</Text>
                </HStack>
                <HStack gap="3" align="baseline">
                    <Text textStyle="overline">Overline</Text>
                    <Text textStyle="caption" color="fg.muted">overline</Text>
                </HStack>
                <HStack gap="3" align="baseline">
                    <Text textStyle="code-sm">Code SM</Text>
                    <Text textStyle="caption" color="fg.muted">code-sm</Text>
                </HStack>
                <HStack gap="3" align="baseline">
                    <Text textStyle="code-md">Code MD</Text>
                    <Text textStyle="caption" color="fg.muted">code-md</Text>
                </HStack>
                <HStack gap="3" align="baseline">
                    <Text textStyle="mono-kpi">$1,234,567.89</Text>
                    <Text textStyle="caption" color="fg.muted">mono-kpi</Text>
                </HStack>
            </VStack>
        );
    }),
    inputs: [],
});

export const textMonoKpi = example({
    keywords: ["Text", "Root", "textStyle", "mono-kpi", "KPI"],
    description: "Mono-KPI textStyle — big mono number with tabular-nums",
    fn: East.function([], UIComponentType, (_$) => {
        return <Text textStyle="mono-kpi">$1,842,500</Text>;
    }),
    inputs: [],
});

export const textTabularNums = example({
    keywords: ["Text", "Root", "fontVariantNumeric", "tabular-nums", "align"],
    description: "Column of right-aligned numbers with tabular-nums keeps digits aligned",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="1" align="stretch">
                <HStack gap="4" align="baseline">
                    <Text textStyle="body-sm" color="fg.muted">Q1</Text>
                    <Text fontFamily="mono" fontVariantNumeric="tabular-nums" textAlign="right" width="6rem">{"  1,234.56"}</Text>
                </HStack>
                <HStack gap="4" align="baseline">
                    <Text textStyle="body-sm" color="fg.muted">Q2</Text>
                    <Text fontFamily="mono" fontVariantNumeric="tabular-nums" textAlign="right" width="6rem">{" 98,765.43"}</Text>
                </HStack>
                <HStack gap="4" align="baseline">
                    <Text textStyle="body-sm" color="fg.muted">Q3</Text>
                    <Text fontFamily="mono" fontVariantNumeric="tabular-nums" textAlign="right" width="6rem">{"456,789.01"}</Text>
                </HStack>
                <HStack gap="4" align="baseline">
                    <Text textStyle="body-sm" color="fg.muted">Q4</Text>
                    <Text fontFamily="mono" fontVariantNumeric="tabular-nums" textAlign="right" width="6rem">{"  7,890.12"}</Text>
                </HStack>
            </VStack>
        );
    }),
    inputs: [],
});

export const textInteractive = example({
    keywords: ["Text", "Reactive", "State", "interactive", "counter"],
    description: "Reactive text whose content updates from a counter",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const counter = $.let(State.bind([IntegerType], "text_counter", 0n));
            const value = $.let(counter.read());
            const increment = $.const(East.function([], NullType, $ => {
                const cur = $.let(counter.read());
                $(counter.write(cur.add(1n)));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Text>{East.str`Clicked ${East.print(value)} times`}</Text>
                    <Button onClick={increment}>Click me</Button>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
