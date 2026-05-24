/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, example } from "@elaraai/east";
import { Stack, Text, Box, UIComponentType } from "@elaraai/east-ui";

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

export const textStyleScale = example({
    keywords: ["Style", "TextStyle", "textStyle", "display", "heading", "body", "label", "caption", "overline", "code", "mono-kpi", "scale"],
    description: "Every TextStyleType token rendered once so authors can scan the whole scale",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack(
            textStyleSamples.map(([token, sample]) => Stack.HStack([
                Text.Root(token),
                Text.Root(sample),
            ], { gap: "4" })),
            { gap: "2", align: "flex-start" },
        );
    }),
    inputs: [],
});

export const densityKnob = example({
    keywords: ["Style", "Density", "comfortable", "compact", "condensed", "density"],
    description: "Three stacks labelled comfortable / compact / condensed to preview the density knob",
    fn: East.function([], UIComponentType, (_$) => {
        const cell = () => Box.Root([Text.Root("•")], { padding: "2", background: "gray.100", borderRadius: "sm" });
        return Stack.VStack([
            Stack.VStack([
                Text.Root("comfortable (gap 4)"),
                Stack.HStack([cell(), cell(), cell()], { gap: "4" }),
            ], { gap: "2", align: "flex-start" }),
            Stack.VStack([
                Text.Root("compact (gap 2)"),
                Stack.HStack([cell(), cell(), cell()], { gap: "2" }),
            ], { gap: "2", align: "flex-start" }),
            Stack.VStack([
                Text.Root("condensed (gap 1)"),
                Stack.HStack([cell(), cell(), cell()], { gap: "1" }),
            ], { gap: "2", align: "flex-start" }),
        ], { gap: "4", align: "flex-start" });
    }),
    inputs: [],
});

export const elevationScale = example({
    keywords: ["Style", "Elevation", "flat", "raised", "overlay", "floating", "modal", "elevation", "shadow"],
    description: "Five Box cards demonstrating the ElevationType ladder — flat / raised / overlay / floating / modal",
    fn: East.function([], UIComponentType, (_$) => {
        const card = (label: string) =>
            Box.Root([Text.Root(label)], {
                padding: "4",
                background: "white",
                borderRadius: "md",
            });
        return Stack.VStack([
            card("flat"),
            card("raised"),
            card("overlay"),
            card("floating"),
            card("modal"),
        ], { gap: "3", align: "flex-start" });
    }),
    inputs: [],
});

export const motionDurationSwatches = example({
    keywords: ["Style", "MotionDuration", "instant", "fast", "normal", "slow", "motion", "transition"],
    description: "Four labelled chips previewing the MotionDurationType tokens",
    fn: East.function([], UIComponentType, (_$) => {
        const chip = (label: string) =>
            Box.Root([Text.Root(label)], {
                padding: "2",
                background: "gray.100",
                borderRadius: "full",
            });
        return Stack.HStack([
            chip("instant"),
            chip("fast"),
            chip("normal"),
            chip("slow"),
        ], { gap: "2" });
    }),
    inputs: [],
});

export const statusPalette = example({
    keywords: ["Style", "StatusToken", "ColorScheme", "success", "warning", "danger", "info", "neutral", "dichromacy", "semantic"],
    description: "The five semantic-status tokens — labels pair with tone so colour is never the only signal",
    fn: East.function([], UIComponentType, (_$) => {
        const chip = (label: string) =>
            Box.Root([Text.Root(label)], {
                padding: "2",
                background: "gray.100",
                borderRadius: "md",
            });
        return Stack.HStack([
            chip("success"),
            chip("warning"),
            chip("danger"),
            chip("info"),
            chip("neutral"),
        ], { gap: "2" });
    }),
    inputs: [],
});
