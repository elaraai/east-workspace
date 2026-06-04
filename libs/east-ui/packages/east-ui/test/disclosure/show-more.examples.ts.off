/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, example } from "@elaraai/east";
import { Disclosure, Text, UIComponentType } from "@elaraai/east-ui";

export const disclosureRationale = example({
    keywords: ["Disclosure", "Root", "show more", "truncate", "rationale"],
    description: "Action-card rationale clamped to 3 lines with a show-more toggle",
    fn: East.function([], UIComponentType, (_$) => {
        return Disclosure.Root(
            "Stage 1 was delayed ~6h due to setpoint drift since 02:00. Redirecting feedstock to Stage 2 reduces unmet demand at the cost of 1.2% yield. Our model scored this option 0.83 on confidence based on historical recovery patterns from the last 12 months of similar upsets; prior comparable recoveries averaged 5.8h with a standard deviation of 1.2h.",
            { lines: 3n },
        );
    }),
    inputs: [],
});

export const disclosureNarrative = example({
    keywords: ["Disclosure", "Root", "narrative", "driver list"],
    description: "Driver-list narrative with custom labels",
    fn: East.function([], UIComponentType, (_$) => {
        return Disclosure.Root(
            Text.Root(
                "Service level slipped from 92% to 85% this week. Root cause: Stage 2 blender #3 downtime 07:00–11:30 on Wednesday, compounded by a 2-hour delay in Stage 1 feed due to a sensor drift on loop LIC-107. Mitigation: swapped to backup blender #5 at 11:45; tuned LIC-107 controller; both are now stable. Residual risk: backup blender runs at 85% capacity until spares arrive Friday.",
                { color: "fg.muted" },
            ),
            { lines: 2n, moreLabel: "Read full narrative", lessLabel: "Collapse narrative" },
        );
    }),
    inputs: [],
});

export const disclosureDefault = example({
    keywords: ["Disclosure", "Root", "default"],
    description: "Default Disclosure — 3 lines + 'show more' / 'show less'",
    fn: East.function([], UIComponentType, (_$) => {
        return Disclosure.Root(
            "Short enough to stay on one or two lines most of the time, but long enough to demonstrate the show-more toggle when the container is narrow — this paragraph adapts to the surrounding layout.",
        );
    }),
    inputs: [],
});

export const disclosureBranded = example({
    keywords: ["Disclosure", "style", "color", "triggerColor", "branded"],
    description: "Branded Disclosure with custom body + trigger colours",
    fn: East.function([], UIComponentType, (_$) => {
        return Disclosure.Root(
            "Branded narrative text that clamps to the configured number of lines and reveals the full content on demand. Useful when the theme's default link colour doesn't fit.",
            {
                lines: 2n,
                style: { color: "#374151", triggerColor: "#3d5cff" },
            },
        );
    }),
    inputs: [],
});
