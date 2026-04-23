/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, IntegerType, NullType, example } from "@elaraai/east";
import { Button, Reactive, Stack, Stat, State, Text, UIComponentType } from "@elaraai/east-ui";

export const reactiveBasic = example({
    keywords: ["Reactive", "Root", "basic", "render"],
    description: "Wrap a static UI in Reactive.Root — re-renders on state changes",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, (_$) => {
            return Text.Root("Reactive content");
        }));
    }),
    inputs: [],
});

export const reactiveCounter = example({
    keywords: ["Reactive", "Root", "State", "bind", "counter", "interactive"],
    description: "Counter that increments on click and re-renders only its subtree",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const counter = $.let(State.bind([IntegerType], "reactiveCounter", 0n));
            const count = $.let(counter.read());
            const increment = $.const(East.function([], NullType, $ => {
                const current = $.let(counter.read());
                $(counter.write(current.add(1n)));
            }));
            return Stack.VStack([
                Stat.Root("Count", Text.Root(East.print(count))),
                Button.Root("Increment", { onClick: increment, style: { variant: "solid", colorPalette: "blue" } }),
            ], { gap: "3", align: "center" });
        }));
    }),
    inputs: [],
});

export const reactiveNested = example({
    keywords: ["Reactive", "Root", "nested", "isolation", "re-render"],
    description: "Two independent Reactive.Root subtrees — each re-renders independently",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Reactive.Root(East.function([], UIComponentType, $ => {
                const a = $.let(State.bind([IntegerType], "reactiveNestedA", 0n));
                const va = $.let(a.read());
                const inc = $.const(East.function([], NullType, $ => {
                    const current = $.let(a.read());
                    $(a.write(current.add(1n)));
                }));
                return Stack.HStack([
                    Stat.Root("A", Text.Root(East.print(va))),
                    Button.Root("A++", { onClick: inc, style: { size: "sm" } }),
                ], { gap: "2" });
            })),
            Reactive.Root(East.function([], UIComponentType, $ => {
                const b = $.let(State.bind([IntegerType], "reactiveNestedB", 0n));
                const vb = $.let(b.read());
                const inc = $.const(East.function([], NullType, $ => {
                    const current = $.let(b.read());
                    $(b.write(current.add(1n)));
                }));
                return Stack.HStack([
                    Stat.Root("B", Text.Root(East.print(vb))),
                    Button.Root("B++", { onClick: inc, style: { size: "sm" } }),
                ], { gap: "2" });
            })),
        ], { gap: "4", align: "stretch" });
    }),
    inputs: [],
});

export const reactiveDerived = example({
    keywords: ["Reactive", "Root", "State", "derived", "computed", "double"],
    description: "Display a value derived from state — re-renders when source state changes",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const counter = $.let(State.bind([IntegerType], "reactiveDerivedCounter", 1n));
            const count = $.let(counter.read());
            const doubled = $.let(count.multiply(2n));
            const inc = $.const(East.function([], NullType, $ => {
                const current = $.let(counter.read());
                $(counter.write(current.add(1n)));
            }));
            return Stack.VStack([
                Stat.Root("Count", Text.Root(East.print(count))),
                Stat.Root("Doubled", Text.Root(East.print(doubled))),
                Button.Root("Increment", { onClick: inc, style: { variant: "solid", colorPalette: "purple" } }),
            ], { gap: "3", align: "center" });
        }));
    }),
    inputs: [],
});
