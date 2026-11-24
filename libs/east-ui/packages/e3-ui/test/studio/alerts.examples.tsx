/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */

/**
 * The Studio's alerts (#1674) as a solution writes them: an alerts record
 * declared beside the pages record — every alert by its name, its one write a
 * patch — bound to the Visuals page, so each of its visuals carries a bell,
 * under the bell for the host's bar. Its four alerts are set on the page's
 * latest quarter, July to September 2026: the quarter's revenue under its goal
 * of 400,000 — it is 392,489 — and the months under theirs of 130,000 — July
 * and August — both of which fire; a customer over 50,000, which none is — the
 * most is 46,555; and a region's margin under 19%, which Queensland's is, but
 * which is paused.
 *
 * The builder over the same page is given the record too: the selected
 * visual's alerts are then set from its inspector, beside everything else of
 * the visual, as well as from its bell.
 */

import { East, NullType, example, none, parseJq, type ValueTypeOf } from "@elaraai/east";
import { Box, HStack, Reactive, State, Text, UIComponentType, VStack } from "@elaraai/east-ui";
import { Data, Record, Studio } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";
import { orderFields, studioOrders, studioVisualPages } from "./studio.examples.js";

type Alert = ValueTypeOf<typeof Studio.Types.Alert>;

/** The page the alerts are set on: the Visuals page, live as it was drafted. */
const VISUALS = { project: "Sales desk", page: "Visuals" };

/**
 * The jq the alerts hold: the latest quarter, the filter each was made with —
 * the page's starting filter, as its reader had it — and each one's condition
 * on one of its visual's rows, its groups and values by name. A value read over
 * two periods, as a KPI against a year ago reads it, may have none.
 */
const [quarter, quarterUnderGoal, monthUnderGoal, customerOver, marginUnder] = [
    `.ordered_at >= "2026-07-01" and .ordered_at < "2026-10-01"`,
    `.revenue != null and .revenue < 400000`,
    `.revenue < 130000`,
    `.revenue > 50000`,
    `.mean_margin != null and .mean_margin < 0.19`,
].map((text) => {
    const parsed = parseJq(text).program;
    if (parsed.type === "none") throw new Error(`An alert's jq does not parse: ${text}`);
    return parsed.value;
});

/** The latest quarter, as the alerts' filters hold it. */
const inQuarter = [{ source: "orders", where: quarter!, from: none }];

/**
 * The alerts record: four alerts on the Visuals page, none fired yet — the
 * page writes each one's latest firing as it checks them.
 */
export const studioAlerts = e3.record("studio_alerts", Studio.Types.Alerts, {
    initial: new Map<string, Alert>([
        ["Quarter under goal", { page: VISUALS, cell: "v-revenue", condition: quarterUnderGoal!, filters: inQuarter, paused: false, firing: none }],
        ["Month under goal", { page: VISUALS, cell: "v-trend", condition: monthUnderGoal!, filters: inQuarter, paused: false, firing: none }],
        ["Customer over 50,000", { page: VISUALS, cell: "v-customers", condition: customerOver!, filters: inQuarter, paused: false, firing: none }],
        ["Margin under 19%", { page: VISUALS, cell: "v-combo", condition: marginUnder!, filters: inQuarter, paused: true, firing: none }],
    ]),
    mutations: (mutation) => ({
        // The record's one write: every Save, pause, delete and firing is a patch of it.
        patch: mutation.patch(),
    }),
});

export const studioAlertsPage = example({
    keywords: [
        "Studio", "Studio.Page", "Studio.AlertBell", "alerts", "alert", "bell", "notification", "condition", "threshold", "goal",
        "fires", "firing", "cleared", "paused", "Studio.Types.Alerts", "e3.record", "Record.bind", "mutation.patch", "banner",
        "Show rows", "onOpen", "State.bind", "Studio.source", "Data.bind",
    ],
    description: "Alerts on a published page over two years of orders, every reader starting in the latest quarter: the solution declares an alerts record (`Studio.Types.Alerts`, its one mutation a patch) and passes it bound to `<Studio.Page alerts>`, so each data visual's header carries a bell — marked while one of its alerts fires — whose popover lists them and sets one: its name, a condition on the visual's rows (its groups and values by name, in the query builder's condition rows), the rows that meet it now, pause and delete; a new alert starts from the visual's first value, under its goal where it has one. The page checks its project's alerts as it opens and as the orders change, and writes each one's latest firing; `<Studio.AlertBell>` in the host's bar counts the alerts firing and lists them, and opening one sets the page's filters to the alert's and tells `onOpen` its page, which then draws a banner naming the alert, with Show rows. Four are set: the quarter's revenue under its goal and the months under theirs, both firing; a customer over 50,000, which none is; and a region's margin under 19%, paused",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const pages = $.let(Data.bind(studioVisualPages));
            const orders = $.let(Data.bind(studioOrders));
            const alerts = $.let(Record.bind(studioAlerts));
            // The open page is the surface's: an alert opened from the bar writes it. A host with routes navigates here instead.
            const open = $.let(State.bind([Studio.Types.Key], "ex.studio.alerts.open", VISUALS));
            const go = $.const(East.function([Studio.Types.Key], NullType, ($2, key) => { $2(open.write(key)); }));
            return (
                <VStack gap="3" align="stretch">
                    <HStack justify="space-between" align="center">
                        <Text>{East.str`${open.read().project} · ${open.read().page}`}</Text>
                        <Studio.AlertBell alerts={alerts} onOpen={go} />
                    </HStack>
                    <Studio.Page pages={pages.read()} components={[]} page={open.read()} onOpen={go} alerts={alerts}
                        sources={{
                            orders: Studio.source(orders, {
                                name: "Orders", icon: "receipt", description: "One row per order",
                                fields: orderFields,
                                range: "ordered_at",
                            }),
                        }} />
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const studioAlertsBuilder = example({
    keywords: [
        "Studio", "Studio.Builder", "alerts", "alert", "inspector", "Configure", "bell", "condition", "threshold", "goal", "paused",
        "Studio.Types.Alerts", "e3.record", "Record.bind", "mutation.patch", "Studio.source", "Data.bind",
    ],
    description: "Alerts set from the builder: `<Studio.Builder alerts>` is given the alerts record bound, as the page is, so the selected visual's Configure tab in the inspector ends with Alerts — its alerts listed, each by its name and where it stands, under New alert — and one is written there, in place: its name, a condition on the visual's rows in the query builder's condition rows, pause, the rows that meet it now, Delete, Cancel and Save. Each tile of the canvas carries the same bell as the page's. An alert is the alerts record's, not the page's draft's: Save, pause and Delete are each a patch of the record as they are made, which the page's Undo, Discard and Publish leave as it is; the published page is what checks them",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const pages = $.let(Record.bind(studioVisualPages));
            const orders = $.let(Data.bind(studioOrders));
            const alerts = $.let(Record.bind(studioAlerts));
            return (
                <Box height="760px">
                    <Studio.Builder pages={pages} components={[]} project="Sales desk" id="studioAlerts" alerts={alerts}
                        sources={{
                            orders: Studio.source(orders, {
                                name: "Orders", icon: "receipt", description: "One row per order",
                                fields: orderFields,
                                range: "ordered_at",
                            }),
                        }} />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});
