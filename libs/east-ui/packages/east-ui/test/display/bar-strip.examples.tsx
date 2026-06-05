/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { BarStrip, Text } from "@elaraai/east-ui";

export const barStripBasic = example({
    keywords: ["BarStrip", "Root", "items"],
    description: "Basic BarStrip with three rows and tones",
    fn: East.function([], UIComponentType, ($) => {
        return (
            <BarStrip items={[
                { label: <Text>Alpha</Text>, value: 42.0, tone: "success" },
                { label: <Text>Beta</Text>, value: 28.0, tone: "warning" },
                { label: <Text>Gamma</Text>, value: 15.0, tone: "danger" },
            ]} />
        );
    }),
    inputs: [],
});

export const barStripSorted = example({
    keywords: ["BarStrip", "Root", "sort", "desc"],
    description: "BarStrip sorted descending by value",
    fn: East.function([], UIComponentType, ($) => {
        return (
            <BarStrip
                items={[
                    { label: <Text>Backend</Text>, value: 120.0, tone: "info" },
                    { label: <Text>Frontend</Text>, value: 85.0, tone: "info" },
                    { label: <Text>DevOps</Text>, value: 42.0, tone: "info" },
                ]}
                sort="desc"
                thickness="md"
            />
        );
    }),
    inputs: [],
});

export const barStripMaxItems = example({
    keywords: ["BarStrip", "Root", "maxItems", "clipping"],
    description: "BarStrip with row limit",
    fn: East.function([], UIComponentType, ($) => {
        return (
            <BarStrip
                items={[
                    { label: <Text>A</Text>, value: 100.0 },
                    { label: <Text>B</Text>, value: 80.0 },
                    { label: <Text>C</Text>, value: 60.0 },
                    { label: <Text>D</Text>, value: 40.0 },
                    { label: <Text>E</Text>, value: 20.0 },
                ]}
                sort="desc"
                maxItems={3n}
                showValues={true}
            />
        );
    }),
    inputs: [],
});
