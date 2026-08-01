/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Progress, Text, VStack } from "@elaraai/east-ui";

export const progressBasic = example({
    keywords: ["Progress", "Root", "basic"],
    description: "Simple progress bar",
    fn: East.function([], UIComponentType, (_$) => {
        return <Progress value={60.0} />;
    }),
    inputs: [],
});

// ============================================================================
// Variants — static enumeration panel (consolidation epic #455).
// ============================================================================

export const progressVariants = example({
    keywords: ["Progress", "Root", "label", "valueText", "tone", "brand", "pos", "neg", "size", "xs", "sm", "md", "striped", "animated", "min", "max", "indeterminate", "estimatedDuration", "startedAt", "ETA"],
    description: "Progress variant panel — labeled (mono uppercase label + value text), tones (brand / pos / neg), sizes (xs / sm / md via style.size, no lg per spec), striped (striped + animated), range (custom min/max), indeterminate (no known completion percentage), with ETA (estimatedDuration + startedAt drive an ETA label in the renderer)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">LABELED</Text>
                    <Progress value={75.0} label="Upload progress" valueText="75%" />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">TONES</Text>
                    <VStack gap="4" align="stretch" width="100%">
                        <Progress value={80.0} label="Brand" tone="brand" />
                        <Progress value={60.0} label="Pos" tone="pos" />
                        <Progress value={20.0} label="Neg" tone="neg" />
                    </VStack>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">SIZES</Text>
                    <VStack gap="4" align="stretch" width="100%">
                        <Progress value={50.0} size="xs" />
                        <Progress value={50.0} size="sm" />
                        <Progress value={50.0} size="md" />
                    </VStack>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">STRIPED</Text>
                    <VStack gap="4" align="stretch" width="100%">
                        <Progress value={65.0} striped />
                        <Progress value={45.0} striped animated tone="pos" />
                    </VStack>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">RANGE</Text>
                    <Progress value={7.5} min={0} max={10} label="Rating 7.5 / 10" />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">INDETERMINATE</Text>
                    <Progress value={0.0} indeterminate label="Solver running…" />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">WITH E T A</Text>
                    <Progress
                        value={42.0}
                        label="Solver running 42%"
                        estimatedDuration={120n}
                        startedAt={new Date("2026-01-01T09:00:00Z")}
                        showValue
                    />
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});
