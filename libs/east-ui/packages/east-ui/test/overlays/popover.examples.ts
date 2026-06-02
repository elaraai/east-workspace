/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, IntegerType, NullType, StringType, StructType, ArrayType, example } from "@elaraai/east";
import { Button, Chart, Popover, Reactive, Stack, State, Text, UIComponentType } from "@elaraai/east-ui";

export const popoverBasic = example({
    keywords: ["Popover", "Root", "title", "description", "click"],
    description: "Click-triggered floating panel",
    fn: East.function([], UIComponentType, (_$) => {
        return Popover.Root(
            Button.Root("Open Popover"),
            [Text.Root("This is the popover content. You can put any UI components here.")],
            { title: "Popover Title", description: "A helpful description" }
        );
    }),
    inputs: [],
});

export const popoverChart = example({
    keywords: ["Popover", "Root", "Chart", "Area", "hasArrow"],
    description: "Rich content with area chart",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { day: "Mon", value: 120n }, { day: "Tue", value: 150n }, { day: "Wed", value: 180n },
            { day: "Thu", value: 140n }, { day: "Fri", value: 200n },
        ], ArrayType(StructType({ day: StringType, value: IntegerType })));
        return Popover.Root(
            Button.Root("View Stats", { style: { variant: "solid" } }),
            [
                Chart.Root(
                    Chart.Area(rows, { x: r => r.day, y: r => r.value }, { color: "brand.500", fillOpacity: 0.3 }),
                    { height: 160 },
                ),
            ],
            { hasArrow: true, title: "Weekly Sales" }
        );
    }),
    inputs: [],
});

export const popoverInteractive = example({
    keywords: ["Popover", "Reactive", "State", "interactive", "onOpenChange"],
    description: "Popover whose onOpenChange counts open/close transitions",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const bind = $.let(State.bind([IntegerType], "popover_toggles", 0n));
            const value = $.let(bind.read());
            const onOpenChange = $.const(East.function([BooleanType], NullType, ($, _open) => {
                const cur = $.let(bind.read());
                $(bind.write(cur.add(1n)));
            }));
            return Stack.VStack([
                Popover.Root(
                    Button.Root("Open popover"),
                    [Text.Root("Popover content")],
                    {
                        title: "Reactive popover",
                        description: "Each open/close fires onOpenChange",
                        onOpenChange,
                    },
                ),
                Text.Presets.MonoLabel(East.str`TOGGLED · ${East.print(value)}`),
            ], { gap: "3", align: "flex-start" });
        }));
    }),
    inputs: [],
});
