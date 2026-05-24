/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import {
    Button,
    Icon,
    List,
    Reactive,
    Stack,
    State,
    Text,
    UIComponentType,
} from "@elaraai/east-ui";

export const listUnordered = example({
    keywords: ["List", "Root", "unordered", "bulleted"],
    description: "Bulleted list",
    fn: East.function([], UIComponentType, (_$) => {
        return List.Root(["First item", "Second item", "Third item"], {
            variant: "unordered",
        });
    }),
    inputs: [],
});

export const listOrdered = example({
    keywords: ["List", "Root", "ordered", "numbered"],
    description: "Numbered list",
    fn: East.function([], UIComponentType, (_$) => {
        return List.Root(["Step one", "Step two", "Step three"], {
            variant: "ordered",
        });
    }),
    inputs: [],
});

export const listWithGap = example({
    keywords: ["List", "Root", "gap", "spacing"],
    description: "Increased spacing between items",
    fn: East.function([], UIComponentType, (_$) => {
        return List.Root(["Item A", "Item B", "Item C"], {
            variant: "unordered",
            gap: "4",
        });
    }),
    inputs: [],
});

export const listColored = example({
    keywords: ["List", "Root", "colorPalette", "blue", "markers"],
    description: "Blue list markers",
    fn: East.function([], UIComponentType, (_$) => {
        return List.Root(["Blue item one", "Blue item two", "Blue item three"], {
            variant: "unordered",
            colorPalette: "blue",
        });
    }),
    inputs: [],
});

export const listGreen = example({
    keywords: ["List", "Root", "ordered", "colorPalette", "green"],
    description: "Green numbered list",
    fn: East.function([], UIComponentType, (_$) => {
        return List.Root(["Complete task A", "Complete task B", "Complete task C"], {
            variant: "ordered",
            colorPalette: "green",
        });
    }),
    inputs: [],
});

export const listFeatures = example({
    keywords: ["List", "Root", "features", "product"],
    description: "Product features example",
    fn: East.function([], UIComponentType, (_$) => {
        return List.Root([
            "Fast performance",
            "Type-safe development",
            "Easy to use API",
            "Comprehensive documentation",
        ], {
            variant: "unordered",
            gap: "2",
            colorPalette: "teal",
        });
    }),
    inputs: [],
});

export const listSteps = example({
    keywords: ["List", "Root", "ordered", "steps", "installation"],
    description: "Installation steps",
    fn: East.function([], UIComponentType, (_$) => {
        return List.Root([
            "Install dependencies",
            "Configure environment",
            "Run the application",
            "Verify installation",
        ], {
            variant: "ordered",
            gap: "3",
        });
    }),
    inputs: [],
});

export const listEmpty = example({
    keywords: ["List", "Root", "empty"],
    description: "List with no items",
    fn: East.function([], UIComponentType, (_$) => {
        return List.Root([]);
    }),
    inputs: [],
});

export const listCheckmarks = example({
    keywords: ["List", "Root", "marker", "check", "compliance", "workforce"],
    description: "Compliance checklist with green check markers — mirrors the shift-optimiser `.wf-constraints` block",
    fn: East.function([], UIComponentType, (_$) => {
        return List.Root([
            "Max 5 consecutive shifts — 412 staff, clear",
            "SLA: 92% on-time (27 misses)",
            "Rostered vs demand: within tolerance",
            "Training currency: all staff in-date",
        ], {
            marker: "check",
            markerColor: "fg.success",
            gap: "2",
        });
    }),
    inputs: [],
});

export const listDashed = example({
    keywords: ["List", "Root", "marker", "dash", "danger", "problem", "issues"],
    description: "Problem notes with red dash markers — mirrors the `.problem-notes` block",
    fn: East.function([], UIComponentType, (_$) => {
        return List.Root([
            Text.Root("Stage 1 delayed ~6h by setpoint drift since 02:00", { fontStyle: "italic" }),
            Text.Root("Vendor feed unavailable — forecast using last-known", { fontStyle: "italic" }),
            Text.Root("3 drivers flagged for manual review", { fontStyle: "italic" }),
        ], {
            marker: "dash",
            markerColor: "fg.danger",
            gap: "2",
        });
    }),
    inputs: [],
});

export const listRichItems = example({
    keywords: ["List", "Root", "rich", "UIComp", "icon", "HStack"],
    description: "Rich items — each is a custom HStack with icon + text",
    fn: East.function([], UIComponentType, (_$) => {
        const row = (glyph: "circle-check" | "circle-xmark" | "circle-info", tint: string, text: string) =>
            Stack.HStack([
                Icon.Root("fas", glyph, { color: tint }),
                Text.Root(text),
            ], { gap: "2", align: "center" });
        return List.Root([
            row("circle-check", "fg.success", "Passed: schema validation"),
            row("circle-xmark", "fg.danger", "Failed: missing required field `id`"),
            row("circle-info", "fg.info", "Skipped: optional integrity check"),
        ], { marker: "none", gap: "2" });
    }),
    inputs: [],
});

export const listInteractive = example({
    keywords: ["List", "Reactive", "State", "interactive", "counter"],
    description: "Reactive list whose item labels update from a counter",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const counter = $.let(State.bind([IntegerType], "list_counter", 0n));
            const value = $.let(counter.read());
            const increment = $.const(East.function([], NullType, $ => {
                const cur = $.let(counter.read());
                $(counter.write(cur.add(1n)));
            }));
            return Stack.VStack([
                List.Root([
                    Text.Root(East.str`First — bump ${East.print(value)}`),
                    Text.Root(East.str`Second — bump ${East.print(value)}`),
                    Text.Root(East.str`Third — bump ${East.print(value)}`),
                ], { variant: "ordered" }),
                Button.Root("Bump", { onClick: increment }),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});
