/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, StringType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Box, Calendar, Reactive, Text, VStack } from "@elaraai/east-ui";

/** Five weeks × seven days of forecast demand with a last-year baseline; the
 *  first Monday is intentionally omitted so it renders the hatched empty cell. */
const DEMAND = [
    { week: "W37", day: "Tue", demand: 105.0, lastYear: 95.0 }, { week: "W37", day: "Wed", demand: 116.0, lastYear: 102.0 },
    { week: "W37", day: "Thu", demand: 120.0, lastYear: 103.0 }, { week: "W37", day: "Fri", demand: 144.0, lastYear: 121.0 },
    { week: "W37", day: "Sat", demand: 179.0, lastYear: 147.0 }, { week: "W37", day: "Sun", demand: 151.0, lastYear: 134.0 },
    { week: "W38", day: "Mon", demand: 96.0, lastYear: 89.0 }, { week: "W38", day: "Tue", demand: 104.0, lastYear: 94.0 },
    { week: "W38", day: "Wed", demand: 124.0, lastYear: 109.0 }, { week: "W38", day: "Thu", demand: 131.0, lastYear: 112.0 },
    { week: "W38", day: "Fri", demand: 157.0, lastYear: 132.0 }, { week: "W38", day: "Sat", demand: 187.0, lastYear: 153.0 },
    { week: "W38", day: "Sun", demand: 160.0, lastYear: 142.0 }, { week: "W39", day: "Mon", demand: 98.0, lastYear: 91.0 },
    { week: "W39", day: "Tue", demand: 116.0, lastYear: 104.0 }, { week: "W39", day: "Wed", demand: 127.0, lastYear: 112.0 },
    { week: "W39", day: "Thu", demand: 141.0, lastYear: 121.0 }, { week: "W39", day: "Fri", demand: 165.0, lastYear: 139.0 },
    { week: "W39", day: "Sat", demand: 201.0, lastYear: 165.0 }, { week: "W39", day: "Sun", demand: 164.0, lastYear: 145.0 },
    { week: "W40", day: "Mon", demand: 102.0, lastYear: 95.0 }, { week: "W40", day: "Tue", demand: 118.0, lastYear: 106.0 },
    { week: "W40", day: "Wed", demand: 134.0, lastYear: 118.0 }, { week: "W40", day: "Thu", demand: 141.0, lastYear: 121.0 },
    { week: "W40", day: "Fri", demand: 175.0, lastYear: 147.0 }, { week: "W40", day: "Sat", demand: 207.0, lastYear: 170.0 },
    { week: "W40", day: "Sun", demand: 175.0, lastYear: 155.0 }, { week: "W41", day: "Mon", demand: 112.0, lastYear: 104.0 },
    { week: "W41", day: "Tue", demand: 130.0, lastYear: 117.0 }, { week: "W41", day: "Wed", demand: 140.0, lastYear: 123.0 },
    { week: "W41", day: "Thu", demand: 154.0, lastYear: 132.0 }, { week: "W41", day: "Fri", demand: 178.0, lastYear: 150.0 },
    { week: "W41", day: "Sat", demand: 222.0, lastYear: 182.0 }, { week: "W41", day: "Sun", demand: 181.0, lastYear: 160.0 },
];

export const calendarDemand = example({
    keywords: ["Calendar", "heatmap", "intensity", "week", "day", "totals", "mean", "footer", "legend", "compare"],
    description: "The full heatmap — the Σ-wk totals rail, the per-weekday mean row, and the selection footer (predicted / last-year / delta chip) with the low→high gradient legend",
    fn: East.function([], UIComponentType, ($) => (
        <Calendar
            data={DEMAND}
            cell={d => ({
                week: d.week, day: d.day,
                value: d.demand, compare: d.lastYear,
                text: East.Float.printFixed(d.demand, 0n),
            })}
            totals={Calendar.totals({ aggregate: "sum", label: "Σ wk" })}
            aggregateRow={Calendar.aggregateRow({ aggregate: "mean", label: "mean" })}
            footer={Calendar.footer({ valueLabel: "predicted", compareLabel: "last yr", legend: true })}
        />
    )),
    inputs: [],
});

export const calendarMinimal = example({
    keywords: ["Calendar", "heatmap", "minimal", "sparse", "hatched"],
    description: "Minimal sparse heatmap — no chrome; missing days render the hatched neutral fill",
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

export const calendarValuesOff = example({
    keywords: ["Calendar", "values", "heat", "overview", "scale", "steps"],
    description: "A pure heat read — `values={false}` drops the in-cell numbers and a 6-step `Calendar.scale` coarsens the ramp",
    fn: East.function([], UIComponentType, ($) => (
        <Calendar
            data={DEMAND}
            cell={d => ({ week: d.week, day: d.day, value: d.demand })}
            values={false}
            scale={Calendar.scale({ steps: 6n })}
            density="condensed"
        />
    )),
    inputs: [],
});

export const calendarTotals = example({
    keywords: ["Calendar", "totals", "aggregate", "sum", "mean", "rail", "bar"],
    description: "The weekly totals rail and per-weekday aggregate row — the same sum/mean/min/max/count vocabulary as Table",
    fn: East.function([], UIComponentType, ($) => (
        <Calendar
            data={DEMAND}
            cell={d => ({ week: d.week, day: d.day, value: d.demand, text: East.Float.printFixed(d.demand, 0n) })}
            totals={Calendar.totals({ aggregate: "sum", label: "Σ wk", bar: true })}
            aggregateRow={Calendar.aggregateRow({ aggregate: "max", label: "peak" })}
        />
    )),
    inputs: [],
});

export const calendarDensity = example({
    keywords: ["Calendar", "density", "comfortable", "compact", "condensed", "sizes"],
    description: "The three densities stacked — cell + label sizing comfortable → compact → condensed",
    fn: East.function([], UIComponentType, ($) => {
        const days = $.const([
            { week: "W1", day: "Mon", v: 4.0 }, { week: "W1", day: "Tue", v: 7.0 },
            { week: "W1", day: "Wed", v: 9.0 }, { week: "W1", day: "Thu", v: 5.0 },
            { week: "W2", day: "Mon", v: 6.0 }, { week: "W2", day: "Tue", v: 11.0 },
            { week: "W2", day: "Wed", v: 3.0 }, { week: "W2", day: "Thu", v: 8.0 },
        ]);
        const comfortable = $.const(<Calendar data={days} density="comfortable" cell={d => ({ week: d.week, day: d.day, value: d.v })} />);
        const compact = $.const(<Calendar data={days} density="compact" cell={d => ({ week: d.week, day: d.day, value: d.v })} />);
        const condensed = $.const(<Calendar data={days} density="condensed" cell={d => ({ week: d.week, day: d.day, value: d.v })} />);
        return (
            <VStack gap="6">
                {comfortable}
                {compact}
                {condensed}
            </VStack>
        );
    }),
    inputs: [],
});

export const calendarInteractive = example({
    keywords: ["Calendar", "Reactive", "State", "onSelect", "interactive", "footer"],
    description: "Heatmap whose onSelect tracks the drilled day; the footer surfaces the predicted vs last-year delta",
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
                        data={DEMAND}
                        cell={d => ({ week: d.week, day: d.day, value: d.demand, compare: d.lastYear, text: East.Float.printFixed(d.demand, 0n) })}
                        footer={Calendar.footer({ valueLabel: "predicted", compareLabel: "last yr", legend: true })}
                        onSelect={onSelect}
                    />
                    <Text.MonoLabel>{East.str`SELECTED · ${selected}`}</Text.MonoLabel>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});


export const calendarScroll = example({
    keywords: ["Calendar", "maxHeight", "bounded", "scroll", "virtual", "week", "sizing", "#320"],
    description: "Bounded calendar (#320) — maxHeight=\"200px\" caps the component; eight week rows overflow so it clips mid-row and scrolls within",
    fn: East.function([], UIComponentType, ($) => {
        const days = $.const([
            { week: "W31", day: "Mon", demand: 90.0 },
            { week: "W31", day: "Wed", demand: 108.0 },
            { week: "W31", day: "Fri", demand: 126.0 },
            { week: "W32", day: "Mon", demand: 97.0 },
            { week: "W32", day: "Wed", demand: 115.0 },
            { week: "W32", day: "Fri", demand: 133.0 },
            { week: "W33", day: "Mon", demand: 104.0 },
            { week: "W33", day: "Wed", demand: 122.0 },
            { week: "W33", day: "Fri", demand: 140.0 },
            { week: "W34", day: "Mon", demand: 111.0 },
            { week: "W34", day: "Wed", demand: 129.0 },
            { week: "W34", day: "Fri", demand: 147.0 },
            { week: "W35", day: "Mon", demand: 118.0 },
            { week: "W35", day: "Wed", demand: 136.0 },
            { week: "W35", day: "Fri", demand: 154.0 },
            { week: "W36", day: "Mon", demand: 125.0 },
            { week: "W36", day: "Wed", demand: 143.0 },
            { week: "W36", day: "Fri", demand: 161.0 },
            { week: "W37", day: "Mon", demand: 132.0 },
            { week: "W37", day: "Wed", demand: 150.0 },
            { week: "W37", day: "Fri", demand: 168.0 },
            { week: "W38", day: "Mon", demand: 139.0 },
            { week: "W38", day: "Wed", demand: 157.0 },
            { week: "W38", day: "Fri", demand: 175.0 },
        ]);
        return (
            <Calendar
                data={days}
                cell={d => ({ week: d.week, day: d.day, value: d.demand, text: East.Float.printFixed(d.demand, 0n) })}
                maxHeight="200px"
            />
        );
    }),
    inputs: [],
});

export const calendarFill = example({
    keywords: ["Calendar", "fill", "height", "Box", "bounded", "scroll", "virtual", "week", "sizing", "#320"],
    description: "height=\"fill\" (#320) — the calendar fills a fixed 200px Box and scrolls within it; two hundred week rows overflow the box so only the visible weeks (plus overscan) mount",
    fn: East.function([], UIComponentType, ($) => {
        const days = $.const(East.Array.range(10n, 210n).map((_$, w) => ({
            week: East.str`W${w}`,
            day: "Wed",
            demand: w.toFloat().multiply(4.0),
        })));
        return (
            <Box height="200px">
                <Calendar
                    data={days}
                    cell={d => ({ week: d.week, day: d.day, value: d.demand, text: East.Float.printFixed(d.demand, 0n) })}
                    height="fill"
                />
            </Box>
        );
    }),
    inputs: [],
});
