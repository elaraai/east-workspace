/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */

/**
 * A group's own row showing its members' total utilisation: a print works'
 * paper stores, each store's bays holding so many pallets, with so many in
 * them each day. Folded, a store's row is how full its bays are together, a
 * column at a time — the pallets in them over the pallets they hold — which
 * the group's own `summary` works out from its members: a big bay weighs more
 * than a small one, as the mean of their fills (`summaryAggregate: "mean"`)
 * would not have it. Open, each bay shows its own fill.
 *
 * The stores are read whole: a function of a row may map its collections —
 * a store's bays — only over rows read whole, since a page of rows carries
 * each without them.
 *
 * @packageDocumentation
 */

import { DateTimeType, DictType, East, IntegerType, StringType, StructType, example, none, some } from "@elaraai/east";
import { Box, Format, Reactive, UIComponentType } from "@elaraai/east-ui";
import { Data, Plan } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

// ============================================================================
// The paper stores — each store its bays, each bay the pallets it holds and the pallets in it each day
// ============================================================================

/** A bay of a paper store: its name, the pallets it holds, and the pallets in it at the start of each day. */
export const StoreBay = StructType({ name: StringType, capacity: IntegerType, stock: DictType(DateTimeType, IntegerType) });
/** A paper store: its name, and its bays by key. */
export const PaperStore = StructType({ name: StringType, bays: DictType(StringType, StoreBay) });
/** The paper stores, by key. */
export const PaperStores = DictType(StringType, PaperStore);

/**
 * How a bay is stocked, which the stores' seed works each day out from: its
 * name, the pallets it holds, the pallets in it as it is first restocked, the
 * pallets more each week after (fewer, below nought), the pallets a day takes
 * out, and the weekday it is restocked, Monday nought.
 */
export const BayStocking = StructType({
    name: StringType, capacity: IntegerType, restocked: IntegerType, weekly: IntegerType, daily: IntegerType, weekday: IntegerType,
});
/** A store's name, and how each of its bays is stocked, by key. */
export const StoreStocking = StructType({ name: StringType, bays: DictType(StringType, BayStocking) });

/**
 * The three stores: the reels the web presses run, a big bay running low beside
 * two small ones nearly full; the sheets the sheet-fed presses run, four bays of
 * two sizes; and the board, a big bay nearly full beside a small one running low.
 */
const STORE_STOCKING = new Map([
    ["S-1", { name: "Reel store", bays: new Map([
        ["R1", { name: "R1", capacity: 240n, restocked: 120n, weekly: 3n, daily: 10n, weekday: 0n }],
        ["R2", { name: "R2", capacity: 60n, restocked: 58n, weekly: 0n, daily: 2n, weekday: 2n }],
        ["R3", { name: "R3", capacity: 60n, restocked: 57n, weekly: -1n, daily: 3n, weekday: 4n }],
    ]) }],
    ["S-2", { name: "Sheet store", bays: new Map([
        ["S1", { name: "S1", capacity: 120n, restocked: 110n, weekly: -2n, daily: 6n, weekday: 1n }],
        ["S2", { name: "S2", capacity: 120n, restocked: 96n, weekly: 2n, daily: 5n, weekday: 3n }],
        ["S3", { name: "S3", capacity: 40n, restocked: 38n, weekly: 0n, daily: 1n, weekday: 0n }],
        ["S4", { name: "S4", capacity: 40n, restocked: 20n, weekly: 1n, daily: 2n, weekday: 2n }],
    ]) }],
    ["S-3", { name: "Board store", bays: new Map([
        ["B1", { name: "B1", capacity: 200n, restocked: 190n, weekly: -3n, daily: 8n, weekday: 0n }],
        ["B2", { name: "B2", capacity: 50n, restocked: 18n, weekly: 1n, daily: 2n, weekday: 3n }],
    ]) }],
]);

/** Monday 5 October 2026: the stores' first day. */
const STOCK_START = new Date("2026-10-05T00:00:00Z");
/** How many days the stock runs over: thirteen weeks, to Sunday 3 January 2027. */
const STOCK_DAYS = 91n;

/**
 * The paper stores over a number of days from Monday 5 October 2026: each bay
 * restocked once a week on its weekday and drawn down a day at a time between,
 * a little fuller or emptier each week. A function of the days alone.
 */
export const generatePaperStores = East.function([IntegerType], PaperStores, ($, days) => {
    const start = $.const(STOCK_START);
    const stores = $.const(STORE_STOCKING, DictType(StringType, StoreStocking));
    return stores.map((_$2, store) => ({
        name: store.name,
        bays: store.bays.map((_$3, bay) => ({
            name: bay.name,
            capacity: bay.capacity,
            stock: East.Array.range(0n, days).toDict(
                (_$4, d) => start.addDays(d),
                // As it was restocked, more or fewer each week, less what each day since its restocking took out.
                (_$4, d) => bay.restocked.add(bay.weekly.multiply(d.divide(7n))).subtract(bay.daily.multiply(d.add(7n).subtract(bay.weekday).remainder(7n))),
            ),
        })),
    }));
});

/** The stores, three of them with nine bays, read whole. */
export const planPaperStores = e3.record("plan_paper_stores", PaperStores, {
    initial: () => East.compile(generatePaperStores, [])(STOCK_DAYS),
});

// ============================================================================
// planGroupUtilisation — each store's own row its bays' total fill
// ============================================================================

/**
 * A group's own row showing its members' total utilisation. Each paper store
 * is a group (`Plan.series.group`), folded to start, its bays its members, each
 * a heat row of its own fill (`Plan.series.heat`). A store's row declares its
 * own `summary`: a function of the store, over its bays, giving a cell a day —
 * the pallets in all its bays over the pallets they hold. So a big bay weighs
 * more than a small one: the reel store's first week is 53% full, 190 of its
 * 360 pallets on average, where the mean of its bays' fills
 * (`summaryAggregate: "mean"`) would say 68%. Every cell prints a percent
 * through `Format.Percent`, a cell 85% full or more is ringed, and a week's
 * column is its days' mean. Each bay's gutter names the pallets it holds on
 * its second line. A group's summary draws while it is folded; open, its bays
 * show their own.
 *
 * The stores are read whole (`Data.bind`), as a summary mapping a store's bays
 * needs: a page of rows carries each without its collections.
 */
export const planGroupUtilisation = example({
    keywords: [
        "Plan", "Plan.series.group", "summary", "group summary", "a group's own row", "group total", "utilisation", "utilization",
        "total utilisation", "capacity", "fill", "how full", "occupancy", "weighted", "weighted average", "not the mean",
        "summaryAggregate", "folded", "collapsed", "Plan.series.heat", "Plan.heatCells", "Plan.children", "heat", "Format.Percent",
        "percent", "warnAt", "flattenToDict", "paper stores", "stores", "bays", "pallets", "stock", "Data.bind", "rows read whole",
        "e3.record",
    ],
    description: "A group's own row showing its members' total utilisation — a print works' paper stores, read whole, each bay the pallets it holds and the pallets in it each day: folded, a store's row is how full its bays are together a column at a time, the pallets in them over the pallets they hold (Plan.series.group's summary, a function of the store over its bays), so a big bay weighs more than a small one — not the mean of their fills (summaryAggregate: \"mean\"); open, each bay its own fill (Plan.series.heat), the pallets it holds on its gutter's second line; each a percent through Format.Percent, ringed at 85% full, a week's column its days' mean",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // The stores read whole: a store's summary maps its bays, which a page of rows would carry without.
            const stores = $.let(Data.bind(planPaperStores));
            return <Box width="100%" height="440px"><Plan id="planGroupUtilisation" data={stores}
                axis={Plan.axis({
                    window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-11-02T00:00:00Z") },
                    resolution: "week", now: new Date("2026-10-19T09:00:00Z"),
                })}
                series={[
                    // Each store a group, folded to start: its own row is its bays' total fill.
                    Plan.series.group(PaperStore, {
                        key: "stores", title: "Paper stores", label: (store) => store.name, collapsed: true,
                        // Each day, the pallets in all its bays over the pallets they hold: a big bay weighs more than a small
                        // one, as the mean of their fills would not have it.
                        summary: (store) => Plan.heatCells(
                            store.bays
                                .flattenToDict(
                                    (_$2, bay) => bay.stock.map((_$3, pallets) => ({ pallets, capacity: bay.capacity })),
                                    (_$2, held, more) => ({ pallets: held.pallets.add(more.pallets), capacity: held.capacity.add(more.capacity) }),
                                )
                                .toArray((_$2, held, at) => East.value({
                                    at: Plan.at.time(at), value: some(held.pallets.toFloat().divide(held.capacity.toFloat())), label: none,
                                }, Plan.Types.HeatCell)),
                            { min: 0, max: 1, warnAt: 0.85, format: Format.Percent({ maximumFractionDigits: 0n }) },
                        ),
                        children: Plan.children("bays", [Plan.series.heat(StoreBay, {
                            key: "bays", title: "Bays", label: (bay) => bay.name, id: true,
                            // The pallets it holds, on the gutter's second line.
                            stacked: true, sub: (bay) => some(East.str`${bay.capacity} pallets`),
                            // Each bay's own fill a day: the pallets in it over the pallets it holds.
                            cells: (bay) => Plan.heatCells(
                                bay.stock.toArray((_$2, pallets, at) => East.value({
                                    at: Plan.at.time(at), value: some(pallets.toFloat().divide(bay.capacity.toFloat())), label: none,
                                }, Plan.Types.HeatCell)),
                                { min: 0, max: 1, warnAt: 0.85, format: Format.Percent({ maximumFractionDigits: 0n }) },
                            ),
                        })]),
                    }),
                ]}
                style={{ height: "fill" }} />
            </Box>;
        }}</Reactive>
    )),
    inputs: [],
});
