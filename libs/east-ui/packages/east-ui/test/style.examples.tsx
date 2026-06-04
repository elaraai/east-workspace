/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Box, HStack, Text, VStack } from "@elaraai/east-ui/jsx";

// -----------------------------------------------------------------------------
// Style token examples.
//
// These examples exercise the raw and semantic style tokens defined in
// `src/style.ts`. Primitives that *consume* the tokens (Heading.textStyle,
// Card.elevation, Box.position / boxShadow / animation / transition, etc.)
// live under their respective folders in `src/`.
//
// For now each example renders a labelled row demonstrating token-name
// discovery. The East IR round-trip asserts the tokens compile; the
// design-system showcase renders them once the consuming primitives ship.
// -----------------------------------------------------------------------------

export const textStyleScale = example({
    keywords: ["Style", "TextStyle", "textStyle", "display", "heading", "body", "label", "caption", "overline", "code", "mono-kpi", "scale"],
    description: "Every TextStyleType token rendered once so authors can scan the whole scale",
    fn: East.function([], UIComponentType, (_$) => {
        const textStyleSamples: Array<[string, string]> = [
            ["display-lg", "Display Lg"],
            ["display-md", "Display Md"],
            ["display-sm", "Display Sm"],
            ["heading-lg", "Heading Lg"],
            ["heading-md", "Heading Md"],
            ["heading-sm", "Heading Sm"],
            ["heading-xs", "Heading Xs"],
            ["body-lg", "Body Lg"],
            ["body-md", "Body Md"],
            ["body-sm", "Body Sm"],
            ["label-md", "Label Md"],
            ["label-sm", "Label Sm"],
            ["caption", "Caption"],
            ["overline", "Overline"],
            ["code-sm", "Code Sm"],
            ["code-md", "Code Md"],
            ["mono-kpi", "Mono KPI 1,234,567"],
        ];
        return (
            <VStack gap="2" align="flex-start">
                {textStyleSamples.map(([token, sample]) => (
                    <HStack gap="4">
                        <Text>{token}</Text>
                        <Text>{sample}</Text>
                    </HStack>
                ))}
            </VStack>
        );
    }),
    inputs: [],
});

export const densityKnob = example({
    keywords: ["Style", "Density", "comfortable", "compact", "condensed", "density"],
    description: "Three stacks labelled comfortable / compact / condensed to preview the density knob",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="flex-start">
                <VStack gap="2" align="flex-start">
                    <Text>comfortable (gap 4)</Text>
                    <HStack gap="4">
                        <Box padding="2" background="gray.100" borderRadius="sm"><Text>•</Text></Box>
                        <Box padding="2" background="gray.100" borderRadius="sm"><Text>•</Text></Box>
                        <Box padding="2" background="gray.100" borderRadius="sm"><Text>•</Text></Box>
                    </HStack>
                </VStack>
                <VStack gap="2" align="flex-start">
                    <Text>compact (gap 2)</Text>
                    <HStack gap="2">
                        <Box padding="2" background="gray.100" borderRadius="sm"><Text>•</Text></Box>
                        <Box padding="2" background="gray.100" borderRadius="sm"><Text>•</Text></Box>
                        <Box padding="2" background="gray.100" borderRadius="sm"><Text>•</Text></Box>
                    </HStack>
                </VStack>
                <VStack gap="2" align="flex-start">
                    <Text>condensed (gap 1)</Text>
                    <HStack gap="1">
                        <Box padding="2" background="gray.100" borderRadius="sm"><Text>•</Text></Box>
                        <Box padding="2" background="gray.100" borderRadius="sm"><Text>•</Text></Box>
                        <Box padding="2" background="gray.100" borderRadius="sm"><Text>•</Text></Box>
                    </HStack>
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});

export const elevationScale = example({
    keywords: ["Style", "Elevation", "flat", "raised", "overlay", "floating", "modal", "elevation", "shadow"],
    description: "Five Box cards demonstrating the ElevationType ladder — flat / raised / overlay / floating / modal",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="3" align="flex-start">
                <Box padding="4" background="white" borderRadius="md"><Text>flat</Text></Box>
                <Box padding="4" background="white" borderRadius="md"><Text>raised</Text></Box>
                <Box padding="4" background="white" borderRadius="md"><Text>overlay</Text></Box>
                <Box padding="4" background="white" borderRadius="md"><Text>floating</Text></Box>
                <Box padding="4" background="white" borderRadius="md"><Text>modal</Text></Box>
            </VStack>
        );
    }),
    inputs: [],
});

export const motionDurationSwatches = example({
    keywords: ["Style", "MotionDuration", "instant", "fast", "normal", "slow", "motion", "transition"],
    description: "Four labelled chips previewing the MotionDurationType tokens",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="2">
                <Box padding="2" background="gray.100" borderRadius="full"><Text>instant</Text></Box>
                <Box padding="2" background="gray.100" borderRadius="full"><Text>fast</Text></Box>
                <Box padding="2" background="gray.100" borderRadius="full"><Text>normal</Text></Box>
                <Box padding="2" background="gray.100" borderRadius="full"><Text>slow</Text></Box>
            </HStack>
        );
    }),
    inputs: [],
});

export const statusPalette = example({
    keywords: ["Style", "StatusToken", "ColorScheme", "success", "warning", "danger", "info", "neutral", "dichromacy", "semantic"],
    description: "The five semantic-status tokens — labels pair with tone so colour is never the only signal",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="2">
                <Box padding="2" background="gray.100" borderRadius="md"><Text>success</Text></Box>
                <Box padding="2" background="gray.100" borderRadius="md"><Text>warning</Text></Box>
                <Box padding="2" background="gray.100" borderRadius="md"><Text>danger</Text></Box>
                <Box padding="2" background="gray.100" borderRadius="md"><Text>info</Text></Box>
                <Box padding="2" background="gray.100" borderRadius="md"><Text>neutral</Text></Box>
            </HStack>
        );
    }),
    inputs: [],
});
