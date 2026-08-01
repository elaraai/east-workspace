/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, Reactive, Separator, Text, VStack, HStack } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const textBasic = example({
    keywords: ["Text", "Root", "basic"],
    description: "Plain text with no styling",
    fn: East.function([], UIComponentType, (_$) => {
        return <Text>Hello World - Basic Text</Text>;
    }),
    inputs: [],
});

// ============================================================================
// Text — styling options (variant panel)
// ============================================================================

export const textVariants = example({
    keywords: ["Text", "Root", "color", "blue", "fontWeight", "bold", "fontStyle", "italic", "weights", "light", "normal", "medium", "semibold", "textTransform", "uppercase", "lowercase", "capitalize", "background", "highlight", "border", "borderWidth", "borderStyle", "borderColor", "palette", "red", "orange", "green", "teal", "purple", "combined", "textDecoration", "underline", "line-through", "overline", "letterSpacing", "lineHeight", "spacing", "opacity", "transparency", "padding", "margin", "overflow", "width", "height", "textOverflow", "ellipsis", "Reactive", "State", "interactive", "counter"],
    description: "Text variant panel — colored (blue color), bold (bold font weight), italic (italic font style), font weights (all available font weights), transforms (text transformation options), background (background highlight), bordered (border styling), colors (various text colors), combined (multiple styles on one text), decoration (underline, line-through, and overline), spacing (fine-tune text spacing), opacity (varying opacity), padding margin (padding and margin), overflow (constrained size and overflow), interactive (reactive text whose content updates from a counter)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="COLORED" align="start" />
                <Text color="blue.500">Blue colored text</Text>
                <Separator label="BOLD" align="start" />
                <Text fontWeight="bold">Bold text</Text>
                <Separator label="ITALIC" align="start" />
                <Text fontStyle="italic">Italic text</Text>
                <Separator label="FONT WEIGHTS" align="start" />
                <HStack gap="4">
                    <Text fontWeight="light">Light</Text>
                    <Text fontWeight="normal">Normal</Text>
                    <Text fontWeight="medium">Medium</Text>
                    <Text fontWeight="semibold">Semibold</Text>
                    <Text fontWeight="bold">Bold</Text>
                </HStack>
                <Separator label="TRANSFORMS" align="start" />
                <HStack gap="4">
                    <Text textTransform="uppercase">uppercase</Text>
                    <Text textTransform="lowercase">LOWERCASE</Text>
                    <Text textTransform="capitalize">capitalize</Text>
                </HStack>
                <Separator label="BACKGROUND" align="start" />
                <Text background="yellow.200" color="gray.800">Highlighted text</Text>
                <Separator label="BORDERED" align="start" />
                <Text borderWidth="thin" borderStyle="solid" borderColor="gray.400">
                    Bordered text
                </Text>
                <Separator label="COLORS" align="start" />
                <HStack gap="3">
                    <Text color="red.500">Red</Text>
                    <Text color="orange.500">Orange</Text>
                    <Text color="green.500">Green</Text>
                    <Text color="teal.500">Teal</Text>
                    <Text color="blue.500">Blue</Text>
                    <Text color="purple.500">Purple</Text>
                </HStack>
                <Separator label="COMBINED" align="start" />
                <Text color="blue.600" fontWeight="bold" fontStyle="italic" background="blue.50">
                    Styled Text
                </Text>
                <Separator label="DECORATION" align="start" />
                <HStack gap="4">
                    <Text textDecoration="underline">Underline</Text>
                    <Text textDecoration="line-through">Line-through</Text>
                    <Text textDecoration="overline">Overline</Text>
                </HStack>
                <Separator label="SPACING" align="start" />
                <VStack gap="2" align="flex-start">
                    <Text letterSpacing="tighter">Tight letter spacing</Text>
                    <Text letterSpacing="wider">Wide letter spacing</Text>
                    <Text lineHeight="tall" maxWidth="250px">Tall line height - wraps to show multi-line effect when the text is long enough</Text>
                    <Text lineHeight="short" maxWidth="250px">Short line height - compact multi-line text when the content wraps</Text>
                </VStack>
                <Separator label="OPACITY" align="start" />
                <HStack gap="4">
                    <Text color="blue.600" fontWeight="bold">100%</Text>
                    <Text color="blue.600" fontWeight="bold" opacity={0.75}>75%</Text>
                    <Text color="blue.600" fontWeight="bold" opacity={0.5}>50%</Text>
                    <Text color="blue.600" fontWeight="bold" opacity={0.25}>25%</Text>
                </HStack>
                <Separator label="PADDING MARGIN" align="start" />
                <VStack gap="2" align="flex-start">
                    <Text padding="4" background="blue.50" borderWidth="thin" borderStyle="solid" borderColor="blue.200">Padding: 4</Text>
                    <Text padding="2" margin="4" background="green.50" borderWidth="thin" borderStyle="solid" borderColor="green.200">Padding: 2, Margin: 4</Text>
                </VStack>
                <Separator label="OVERFLOW" align="start" />
                <VStack gap="2" align="flex-start">
                    <Text width="200px" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap" background="orange.50" padding="2">
                        This text is constrained to 200px width and will clip overflow content.
                    </Text>
                    <Text width="150px" height="40px" background="purple.50" padding="2" overflow="hidden">Fixed width and height box</Text>
                </VStack>
                <Separator label="INTERACTIVE" align="start" />
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
            </VStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Style scale — the full textStyle token ramp (visual-guard for the type system)
// ============================================================================

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

// ============================================================================
// Numeric styles — the tabular-nums contract (variant panel)
// ============================================================================

export const textNumericStyles = example({
    keywords: ["Text", "Root", "textStyle", "mono-kpi", "KPI", "fontVariantNumeric", "tabular-nums", "align"],
    description: "Text numeric-styles panel — mono kpi (big mono number with tabular-nums), tabular nums (column of right-aligned numbers with tabular-nums keeps digits aligned)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="MONO KPI" align="start" />
                <Text textStyle="mono-kpi">$1,842,500</Text>
                <Separator label="TABULAR NUMS" align="start" />
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
            </VStack>
        );
    }),
    inputs: [],
});
