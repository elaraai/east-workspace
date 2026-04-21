/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { Button, List, Reactive, Stack, State, UIComponentType } from "@elaraai/east-ui";

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
                    East.str`First — bump ${East.print(value)}`,
                    East.str`Second — bump ${East.print(value)}`,
                    East.str`Third — bump ${East.print(value)}`,
                ], { variant: "ordered" }),
                Button.Root("Bump", { onClick: increment }),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});
