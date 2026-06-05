/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Progress, VStack } from "@elaraai/east-ui";

export const progressBasic = example({
    keywords: ["Progress", "Root", "basic"],
    description: "Simple progress bar",
    fn: East.function([], UIComponentType, (_$) => {
        return <Progress value={60.0} />;
    }),
    inputs: [],
});

export const progressLabeled = example({
    keywords: ["Progress", "Root", "label", "valueText"],
    description: "Progress with mono uppercase label and value text",
    fn: East.function([], UIComponentType, (_$) => {
        return <Progress value={75.0} label="Upload progress" valueText="75%" />;
    }),
    inputs: [],
});

export const progressTones = example({
    keywords: ["Progress", "Root", "tone", "brand", "pos", "neg"],
    description: "Spec tones — brand (default), pos (on-track), neg (off-spec)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch" width="100%">
                <Progress value={80.0} label="Brand" tone="brand" />
                <Progress value={60.0} label="Pos" tone="pos" />
                <Progress value={20.0} label="Neg" tone="neg" />
            </VStack>
        );
    }),
    inputs: [],
});

export const progressSizes = example({
    keywords: ["Progress", "Root", "size", "xs", "sm", "md"],
    description: "Available sizes via style.size — xs / sm / md (no lg per spec)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch" width="100%">
                <Progress value={50.0} size="xs" />
                <Progress value={50.0} size="sm" />
                <Progress value={50.0} size="md" />
            </VStack>
        );
    }),
    inputs: [],
});

export const progressStriped = example({
    keywords: ["Progress", "Root", "striped", "animated"],
    description: "Striped pattern for visual emphasis",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch" width="100%">
                <Progress value={65.0} striped />
                <Progress value={45.0} striped animated tone="pos" />
            </VStack>
        );
    }),
    inputs: [],
});

export const progressRange = example({
    keywords: ["Progress", "Root", "min", "max"],
    description: "Progress with custom min/max",
    fn: East.function([], UIComponentType, (_$) => {
        return <Progress value={7.5} min={0} max={10} label="Rating 7.5 / 10" />;
    }),
    inputs: [],
});

export const progressIndeterminate = example({
    keywords: ["Progress", "indeterminate"],
    description: "Indeterminate progress — no known completion percentage",
    fn: East.function([], UIComponentType, (_$) => {
        return <Progress value={0.0} indeterminate label="Solver running…" />;
    }),
    inputs: [],
});

export const progressWithETA = example({
    keywords: ["Progress", "estimatedDuration", "startedAt", "ETA"],
    description: "Progress with an estimated duration + startedAt drives an ETA label in the renderer",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Progress
                value={42.0}
                label="Solver running 42%"
                estimatedDuration={120n}
                startedAt={new Date("2026-01-01T09:00:00Z")}
                showValue
            />
        );
    }),
    inputs: [],
});
