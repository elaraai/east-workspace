/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, StringType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Calendar, Reactive, Text, VStack } from "@elaraai/east-ui";

export const calendarDemand = example({
    keywords: ["Calendar", "heatmap", "intensity", "week", "day", "summary", "delta"],
    description: "Forecasted demand heatmap — four weeks with selection summary and drill action",
    fn: East.function([], UIComponentType, ($) => {
        const days = $.const([
            { week: "W37", day: "Tue", demand: 102.0, lastYear: 96.0 },
            { week: "W37", day: "Wed", demand: 110.0, lastYear: 104.0 },
            { week: "W37", day: "Thu", demand: 128.0, lastYear: 115.0 },
            { week: "W37", day: "Fri", demand: 152.0, lastYear: 140.0 },
            { week: "W37", day: "Sat", demand: 168.0, lastYear: 151.0 },
            { week: "W37", day: "Sun", demand: 141.0, lastYear: 129.0 },
            { week: "W38", day: "Mon", demand: 98.0, lastYear: 91.0 },
            { week: "W38", day: "Tue", demand: 104.0, lastYear: 99.0 },
            { week: "W38", day: "Wed", demand: 122.0, lastYear: 109.0 },
            { week: "W38", day: "Thu", demand: 131.0, lastYear: 112.0 },
            { week: "W38", day: "Fri", demand: 156.0, lastYear: 137.0 },
            { week: "W38", day: "Sat", demand: 189.0, lastYear: 164.0 },
            { week: "W38", day: "Sun", demand: 162.0, lastYear: 148.0 },
            { week: "W39", day: "Mon", demand: 96.0, lastYear: 90.0 },
            { week: "W39", day: "Tue", demand: 118.0, lastYear: 106.0 },
            { week: "W39", day: "Wed", demand: 125.0, lastYear: 114.0 },
            { week: "W39", day: "Thu", demand: 144.0, lastYear: 126.0 },
            { week: "W39", day: "Fri", demand: 182.0, lastYear: 158.0 },
            { week: "W39", day: "Sat", demand: 204.0, lastYear: 175.0 },
            { week: "W39", day: "Sun", demand: 177.0, lastYear: 160.0 },
            { week: "W40", day: "Mon", demand: 93.0, lastYear: 88.0 },
            { week: "W40", day: "Tue", demand: 115.0, lastYear: 103.0 },
            { week: "W40", day: "Wed", demand: 147.0, lastYear: 128.0 },
            { week: "W40", day: "Thu", demand: 158.0, lastYear: 137.0 },
            { week: "W40", day: "Fri", demand: 196.0, lastYear: 169.0 },
            { week: "W40", day: "Sat", demand: 219.0, lastYear: 187.0 },
            { week: "W40", day: "Sun", demand: 191.0, lastYear: 170.0 },
        ]);
        return (
            <Calendar
                data={days}
                cell={d => ({
                    week: d.week, day: d.day, value: d.demand,
                    text: East.Float.printFixed(d.demand, 0n),
                    summary: East.str`predicted ${East.Float.printFixed(d.demand, 0n)} · last yr ${East.Float.printFixed(d.lastYear, 0n)}`,
                    delta: d.demand.subtract(d.lastYear).divide(d.lastYear),
                })}
                actionLabel="Open day"
            />
        );
    }),
    inputs: [],
});

export const calendarMinimal = example({
    keywords: ["Calendar", "heatmap", "minimal", "sparse"],
    description: "Minimal sparse heatmap — missing days render the neutral fill",
    fn: East.function([], UIComponentType, ($) => {
        const days = $.const([
            { week: "W1", day: "Mon", v: 4.0 },
            { week: "W1", day: "Wed", v: 9.0 },
            { week: "W1", day: "Fri", v: 2.0 },
            { week: "W2", day: "Tue", v: 6.0 },
            { week: "W2", day: "Sat", v: 12.0 },
        ]);
        return (
            <Calendar
                data={days}
                cell={d => ({ week: d.week, day: d.day, value: d.v })}
            />
        );
    }),
    inputs: [],
});

export const calendarInteractive = example({
    keywords: ["Calendar", "Reactive", "State", "onSelect", "interactive"],
    description: "Heatmap whose onSelect tracks the drilled day",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const bind = $.let(State.bind([StringType], "calendar_selected", "none"));
            const onSelect = $.const(East.function([Calendar.Types.CellRef], NullType, ($, ref) => {
                $(bind.write(East.str`${ref.day} ${ref.week}`));
            }));
            const selected = $.let(bind.read());
            return (
                <VStack gap="3" align="stretch">
                    <Calendar
                        data={[
                            { week: "W1", day: "Mon", v: 10.0 },
                            { week: "W1", day: "Tue", v: 20.0 },
                            { week: "W1", day: "Wed", v: 30.0 },
                        ]}
                        cell={d => ({ week: d.week, day: d.day, value: d.v })}
                        onSelect={onSelect}
                    />
                    <Text.MonoLabel>{East.str`SELECTED · ${selected}`}</Text.MonoLabel>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
