/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Diff component examples — realistic editing scenes that combine
 * `Data.bindStaged` with east-ui form components and a `Diff` panel
 * surfacing the pending changes for sign-off.
 *
 * Coverage:
 *   1. Slider-driven editor    → workforcePolicyEditor
 *   2. Heterogeneous inputs    → serviceConfigForm
 *   3. Editable Table cells    → rosterTableEditor
 *   4. Mixed sliders + inputs  → pricingRulesEditor (side-by-side mode)
 *   5. Minimal call site       → diffDefaults (IR-roundtrip)
 *
 * Pattern:
 *   1. Declare an `e3.input(name, type, default)` per editable scalar.
 *   2. Inside `Reactive.Root`, bind each via `Data.bindStaged`.
 *   3. Wire form components — `read()` for the current value,
 *      `write()` on change.
 *   4. Close the scene with `Diff.Root({ staged: [...inputs.path] })` —
 *      Apply commits the merged batch; Discard drops the buffer.
 */

import {
    East,
    FloatType,
    IntegerType,
    StringType,
    BooleanType,
    DateTimeType,
    ArrayType,
    StructType,
    SetType,
    DictType,
    VariantType,
    NullType,
    PatchType,
    diffFor,
    some,
    variant,
    example,
} from "@elaraai/east";
import {
    Card, Stack, Slider, Input, Switch, Select, Text, Button,
    Reactive, Table, UIComponentType,
} from "@elaraai/east-ui";
import { Data, Diff } from "@elaraai/e3-ui";
import * as e3 from "@elaraai/e3";

// ============================================================================
// Inputs — flat scalars for slider/input examples; one ArrayType binding for
// the table example so Diff can surface array-element patches end-to-end.
// ============================================================================

// Workforce-policy scenario (sliders)
export const maxWeeklyHoursInput      = e3.input("max_weekly_hours",         FloatType, 38.0);
export const overtimeThresholdInput   = e3.input("overtime_threshold_hours", FloatType, 38.0);
export const restGapHoursInput        = e3.input("mandatory_rest_gap_hours", FloatType, 12.0);
export const holidayPenaltyInput      = e3.input("public_holiday_penalty",   FloatType, 1.5);

// Service-config scenario (heterogeneous inputs)
export const serviceNameInput   = e3.input("service_name",  StringType,   "auth-svc");
export const replicasInput      = e3.input("replicas",      IntegerType,  3n);
export const autoScaleInput     = e3.input("auto_scale",    BooleanType,  false);
export const regionInput        = e3.input("region",        StringType,   "ap-southeast-2");
export const deployAfterInput   = e3.input("deploy_after",  DateTimeType, new Date("2026-05-01T08:00:00Z"));

// Roster table scenario (single ArrayType<Struct> binding)
const RosterEntryType = StructType({
    id:           StringType,
    name:         StringType,
    rate:         FloatType,
    shiftLength:  IntegerType,
});
const RosterArrayType = ArrayType(RosterEntryType);
export const rosterInput = e3.input("roster", RosterArrayType, [
    { id: "alice",   name: "Alice Chen",     rate: 32.50, shiftLength: 8n },
    { id: "bob",     name: "Bob Romero",     rate: 28.00, shiftLength: 8n },
    { id: "charlie", name: "Charlie Patel",  rate: 35.75, shiftLength: 10n },
    { id: "diana",   name: "Diana Wallace",  rate: 30.25, shiftLength: 8n },
]);

// Merge-conflict demo scenario — single Float; both bindStaged (for the user's
// pending edit) and bindDirect (for the "simulate concurrent edit" button)
// point at the same path so writes via the button drift the server view away
// from the staged buffer's pinned snapshot.
export const mergeDemoHoursInput = e3.input("merge_demo_hours", FloatType, 38.0);

// Pricing-rules scenario (mixed slider + integer/string input)
export const listPriceInput      = e3.input("list_price",        FloatType,   49.95);
export const discountPctInput    = e3.input("discount_pct",      FloatType,   10.0);
export const minOrderQtyInput    = e3.input("min_order_qty",     IntegerType, 1n);
export const currencyCodeInput   = e3.input("currency_code",     StringType,  "AUD");

// Feature flags scenario (Set<String>)
export const featureFlagsInput = e3.input(
    "feature_flags",
    SetType(StringType),
    new Set<string>(["dark_mode", "experiments"]),
);

// Regional pricing scenario (Dict<String, Float>)
export const regionalPricesInput = e3.input(
    "regional_prices",
    DictType(StringType, FloatType),
    new Map<string, number>([
        ["AU", 49.95],
        ["US", 39.95],
        ["EU", 44.95],
        ["JP", 5499.0],
    ]),
);

// Deployment status scenario (Variant)
const DeploymentStatusType = VariantType({
    pending:     NullType,
    in_progress: NullType,
    complete:    NullType,
    failed:      NullType,
});
export const deploymentStatusInput = e3.input(
    "deployment_status",
    DeploymentStatusType,
    variant("pending", null),
);

// ============================================================================
// 1. Workforce-policy editor — slider-driven edits across 4 staged scalars
// ============================================================================

export const workforcePolicyEditor = example({
    keywords: ["Diff", "Slider", "bindStaged", "workforce", "policy", "Card"],
    description: "Slider-driven workforce-policy editor — 4 staged Float scalars; Diff surfaces pending edits",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const maxHours = $.let(Data.bind([FloatType], maxWeeklyHoursInput.path));
            const otThresh = $.let(Data.bind([FloatType], overtimeThresholdInput.path));
            const restGap  = $.let(Data.bind([FloatType], restGapHoursInput.path));
            const penalty  = $.let(Data.bind([FloatType], holidayPenaltyInput.path));

            return Card.Root([
                Stack.VStack([
                    Text.Root("Workforce policy", { textStyle: "heading-md" }),
                    Text.Root("Drag the sliders to stage policy changes — review in the Diff card before applying."),
                    Stack.VStack([
                        Text.Root("Max weekly hours", { textStyle: "label-sm" }),
                        Slider.Root(maxHours.read(), {
                            min: 30.0, max: 60.0, step: 1.0,
                            onChangeEnd: ($, v) => $(maxHours.write(v)),
                        }),
                    ], { gap: "1" }),
                    Stack.VStack([
                        Text.Root("Overtime threshold (h)", { textStyle: "label-sm" }),
                        Slider.Root(otThresh.read(), {
                            min: 30.0, max: 60.0, step: 1.0,
                            onChangeEnd: ($, v) => $(otThresh.write(v)),
                        }),
                    ], { gap: "1" }),
                    Stack.VStack([
                        Text.Root("Mandatory rest gap (h)", { textStyle: "label-sm" }),
                        Slider.Root(restGap.read(), {
                            min: 8.0, max: 16.0, step: 1.0,
                            onChangeEnd: ($, v) => $(restGap.write(v)),
                        }),
                    ], { gap: "1" }),
                    Stack.VStack([
                        Text.Root("Public holiday penalty (×)", { textStyle: "label-sm" }),
                        Slider.Root(penalty.read(), {
                            min: 1.0, max: 3.0, step: 0.25,
                            onChangeEnd: ($, v) => $(penalty.write(v)),
                        }),
                    ], { gap: "1" }),
                    Diff.Root({
                        bindings: [maxHours.binding, otThresh.binding, restGap.binding, penalty.binding],
                        hideUnchanged: some(true),
                    }),
                ], { gap: "5", align: "stretch" }),
            ]);
        }));
    }),
    inputs: [],
});

// ============================================================================
// 2. Service-config form — heterogeneous Inputs (String / Integer / DateTime),
//    Switch, Select; commit fires a Toast.
// ============================================================================

export const serviceConfigForm = example({
    keywords: ["Diff", "Input", "Switch", "Select", "DateTime", "Toast", "onCommitted"],
    description: "Service-config form covering String / Integer / Bool / DateTime / Select; commit fires a success Toast",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const svcName     = $.let(Data.bind([StringType],   serviceNameInput.path));
            const replicas    = $.let(Data.bind([IntegerType],  replicasInput.path));
            const autoScale   = $.let(Data.bind([BooleanType],  autoScaleInput.path));
            const region      = $.let(Data.bind([StringType],   regionInput.path));
            const deployAfter = $.let(Data.bind([DateTimeType], deployAfterInput.path));

            return Card.Root([
                Stack.VStack([
                    Text.Root("Service configuration", { textStyle: "heading-md" }),
                    Text.Root("Stage edits across heterogeneous types; on apply you'll see a confirmation toast."),

                    Stack.VStack([
                        Text.Root("Service name", { textStyle: "label-sm" }),
                        Input.String(svcName.read(), {
                            placeholder: "service-name",
                            onChange: ($, v) => $(svcName.write(v)),
                        }),
                    ], { gap: "1" }),

                    Stack.VStack([
                        Text.Root("Replicas", { textStyle: "label-sm" }),
                        Input.Integer(replicas.read(), {
                            min: 1n, max: 50n,
                            onChange: ($, v) => $(replicas.write(v)),
                        }),
                    ], { gap: "1" }),

                    Stack.VStack([
                        Text.Root("Auto-scale", { textStyle: "label-sm" }),
                        Switch.Root(autoScale.read(), {
                            onChange: ($, v) => $(autoScale.write(v)),
                        }),
                    ], { gap: "1" }),

                    Stack.VStack([
                        Text.Root("Region", { textStyle: "label-sm" }),
                        Select.Root(
                            region.read(),
                            [
                                Select.Item("ap-southeast-2", "ap-southeast-2 (Sydney)"),
                                Select.Item("us-east-1",      "us-east-1 (N. Virginia)"),
                                Select.Item("eu-west-1",      "eu-west-1 (Ireland)"),
                            ],
                            {
                                onChange: ($, v) => $(region.write(v)),
                            },
                        ),
                    ], { gap: "1" }),

                    Stack.VStack([
                        Text.Root("Deploy after", { textStyle: "label-sm" }),
                        Input.DateTime(deployAfter.read(), {
                            precision: "datetime",
                            onChange: ($, v) => $(deployAfter.write(v)),
                        }),
                    ], { gap: "1" }),

                    Diff.Root({
                        bindings: [svcName.binding, replicas.binding, autoScale.binding, region.binding, deployAfter.binding],
                    }),
                ], { gap: "4", align: "stretch" }),
            ]);
        }));
    }),
    inputs: [],
});

// ============================================================================
// 3. Roster Table — editable cells (Float / Integer Inputs) writing back to
//    a single ArrayType<Struct> staged binding. Diff visualises array
//    patches per row.
// ============================================================================

export const rosterTableEditor = example({
    keywords: ["Diff", "Table", "cell", "render", "Input", "Array", "bindStaged", "roster"],
    description: "Editable Table — Input.Float / Input.Integer cells write back to a staged roster array; Diff shows per-row updates",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const roster = $.let(Data.bind([RosterArrayType], rosterInput.path));
            // Get the roster array fresh inside the render closures to ensure edits to sibling
            const rosterArray = $.let(roster.read(), RosterArrayType);

            return Card.Root([
                Stack.VStack([
                    Text.Root("Worker roster", { textStyle: "heading-md" }),
                    Text.Root("Edit hourly rates and default shift lengths inline; Diff card below tracks pending changes."),
                    Table.Root(
                        rosterArray,
                        {
                            name: { header: "Name" },
                            rate: {
                                header: "Hourly rate ($)",
                                render: East.function(
                                    [Table.Types.CellRenderContext],
                                    UIComponentType,
                                    ($, ctx) => {
                                        const idx = $.let(ctx.rowIndex, IntegerType);
                                        const row = $.let(rosterArray.get(idx), RosterEntryType);
                                        return Input.Float(row.rate, {
                                            min: 15.0, max: 80.0, step: 0.25,
                                            // Re-read fresh inside the handler so a sibling cell's
                                            // edit on the same row isn't overwritten by a stale
                                            // capture of `row`. Merge via the map iterator's `r`.
                                            onChange: East.function([FloatType], NullType, ($, v) => {
                                                const fresh = $.let(roster.read(), RosterArrayType);
                                                const next = $.let(fresh.map(($, r, i) =>
                                                    i.equal(idx).ifElse(_$ => ({ ...r, rate: v }), () => r),
                                                ), RosterArrayType);
                                                $(roster.write(next));
                                            }),
                                        });
                                    },
                                ),
                            },
                            shiftLength: {
                                header: "Shift length (h)",
                                render: East.function(
                                    [Table.Types.CellRenderContext],
                                    UIComponentType,
                                    ($, ctx) => {
                                        const idx = $.let(ctx.rowIndex, IntegerType);
                                        const row = $.let(rosterArray.get(idx), RosterEntryType);
                                        return Input.Integer(row.shiftLength, {
                                            min: 4n, max: 12n,
                                            onChange: East.function([IntegerType], NullType, ($, v) => {
                                                const fresh = $.let(roster.read(), RosterArrayType);
                                                $(roster.write(fresh.map(($, r, i) =>
                                                    i.equal(idx).ifElse(_$ => ({ ...r, shiftLength: v }),() => r),
                                                )));
                                            }),
                                        });
                                    },
                                ),
                            },
                        },
                        { variant: "line", striped: true },
                    ),
                    Diff.Root({
                        bindings: [roster.binding],
                        hideUnchanged: some(true),
                    }),
                ], { gap: "5", align: "stretch" }),
            ]);
        }));
    }),
    inputs: [],
});

// ============================================================================
// 4. Pricing-rules editor — sliders + integer/string inputs together;
//    side-by-side Diff mode for a wider review surface.
// ============================================================================

export const pricingRulesEditor = example({
    keywords: ["Diff", "side-by-side", "Slider", "Input", "pricing", "discount", "mixed"],
    description: "Pricing rules editor — sliders for list price/discount, IntegerInput for min order qty, StringInput for currency; Diff in side-by-side mode",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const listPrice    = $.let(Data.bind([FloatType],   listPriceInput.path));
            const discountPct  = $.let(Data.bind([FloatType],   discountPctInput.path));
            const minOrderQty  = $.let(Data.bind([IntegerType], minOrderQtyInput.path));
            const currency     = $.let(Data.bind([StringType],  currencyCodeInput.path));

            return Card.Root([
                Stack.VStack([
                    Text.Root("Pricing rules", { textStyle: "heading-md" }),
                    Text.Root("Stage pricing changes — review side-by-side before applying to the catalog."),
                    Stack.VStack([
                        Text.Root("List price", { textStyle: "label-sm" }),
                        Slider.Root(listPrice.read(), {
                            min: 0.0, max: 999.95, step: 0.05,
                            onChangeEnd: ($, v) => $(listPrice.write(v)),
                        }),
                    ], { gap: "1" }),
                    Stack.VStack([
                        Text.Root("Discount (%)", { textStyle: "label-sm" }),
                        Slider.Root(discountPct.read(), {
                            min: 0.0, max: 75.0, step: 0.5,
                            onChangeEnd: ($, v) => $(discountPct.write(v)),
                        }),
                    ], { gap: "1" }),
                    Stack.VStack([
                        Text.Root("Minimum order quantity", { textStyle: "label-sm" }),
                        Input.Integer(minOrderQty.read(), {
                            min: 1n, max: 1000n,
                            onChange: ($, v) => $(minOrderQty.write(v)),
                        }),
                    ], { gap: "1" }),
                    Stack.VStack([
                        Text.Root("Currency code", { textStyle: "label-sm" }),
                        Input.String(currency.read(), {
                            placeholder: "AUD",
                            onChange: ($, v) => $(currency.write(v)),
                        }),
                    ], { gap: "1" }),
                    Diff.Root({
                        bindings: [listPrice.binding, discountPct.binding, minOrderQty.binding, currency.binding],
                        hideUnchanged: some(true),
                    }),
                ], { gap: "5", align: "stretch" }),
            ]);
        }));
    }),
    inputs: [],
});

// ============================================================================
// 5. Feature flags editor — Set<String> binding; Switch per known flag.
//    Demonstrates Set insert/delete patches in the Diff.
// ============================================================================

export const featureFlagsEditor = example({
    keywords: ["Diff", "Set", "Switch", "feature flags", "bindStaged"],
    description: "Feature-flags editor — Switch per known flag toggles inclusion in a staged Set; Diff shows insertions / deletions",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const flags = $.let(Data.bind([SetType(StringType)], featureFlagsInput.path));
            const flagsRead = $.let(flags.read(), SetType(StringType));

            return Card.Root([
                Stack.VStack([
                    Text.Root("Feature flags", { textStyle: "heading-md" }),
                    Text.Root("Toggle flags to stage changes; Diff card below shows the set delta."),
                    Stack.VStack([
                        Text.Root("dark_mode", { textStyle: "label-sm" }),
                        Switch.Root(flagsRead.has("dark_mode"), {
                            onChange: East.function([BooleanType], NullType, ($, isOn) => {
                                const next = $.let(flags.read(), SetType(StringType));
                                $.if(isOn, $ => { $(next.insert("dark_mode")); }).else($ => { $(next.delete("dark_mode")); });
                                $(flags.write(next));
                            }),
                        }),
                    ], { gap: "3", justify: "space-between" }),
                    Stack.VStack([
                        Text.Root("experiments", { textStyle: "label-sm" }),
                        Switch.Root(flagsRead.has("experiments"), {
                            onChange: East.function([BooleanType], NullType, ($, isOn) => {
                                const next = $.let(flags.read(), SetType(StringType));
                                $.if(isOn, $ => { $(next.insert("experiments")); }).else($ => { $(next.delete("experiments")); });
                                $(flags.write(next));
                            }),
                        }),
                    ], { gap: "3", justify: "space-between" }),
                    Stack.VStack([
                        Text.Root("notifications", { textStyle: "label-sm" }),
                        Switch.Root(flagsRead.has("notifications"), {
                            onChange: East.function([BooleanType], NullType, ($, isOn) => {
                                const next = $.let(flags.read(), SetType(StringType));
                                $.if(isOn, $ => { $(next.insert("notifications")); }).else($ => { $(next.delete("notifications")); });
                                $(flags.write(next));
                            }),
                        }),
                    ], { gap: "3", justify: "space-between" }),
                    Stack.VStack([
                        Text.Root("analytics", { textStyle: "label-sm" }),
                        Switch.Root(flagsRead.has("analytics"), {
                            onChange: East.function([BooleanType], NullType, ($, isOn) => {
                                const next = $.let(flags.read(), SetType(StringType));
                                $.if(isOn, $ => { $(next.insert("analytics")); }).else($ => { $(next.delete("analytics")); });
                                $(flags.write(next));
                            }),
                        }),
                    ], { gap: "3", justify: "space-between" }),
                    Stack.VStack([
                        Text.Root("ai_assist", { textStyle: "label-sm" }),
                        Switch.Root(flagsRead.has("ai_assist"), {
                            onChange: East.function([BooleanType], NullType, ($, isOn) => {
                                const next = $.let(flags.read(), SetType(StringType));
                                $.if(isOn, $ => { $(next.insert("ai_assist")); }).else($ => { $(next.delete("ai_assist")); });
                                $(flags.write(next));
                            }),
                        }),
                    ], { gap: "3", justify: "space-between" }),
                    Diff.Root({
                        bindings: [flags.binding],
                        hideUnchanged: some(true),
                    }),
                ], { gap: "4", align: "stretch" }),
            ]);
        }));
    }),
    inputs: [],
});

// ============================================================================
// 6. Regional pricing editor — Dict<String, Float>; Input per known key.
//    Demonstrates Dict update patches per key in the Diff.
// ============================================================================

export const regionalPricingEditor = example({
    keywords: ["Diff", "Dict", "Input", "regional pricing", "bindStaged"],
    description: "Regional-pricing editor — Input.Float per region writes back to a staged Dict; Diff shows per-key updates",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const prices = $.let(Data.bind([DictType(StringType, FloatType)], regionalPricesInput.path));
            const pricesRead = $.let(prices.read(), DictType(StringType, FloatType));

            return Card.Root([
                Stack.VStack([
                    Text.Root("Regional pricing", { textStyle: "heading-md" }),
                    Text.Root("Edit per-region prices; Diff card below tracks pending updates."),
                    Stack.VStack([
                        Text.Root("AU", { textStyle: "label-sm" }),
                        Input.Float(pricesRead.get("AU", East.function([StringType], FloatType, _$ => 0.0)), {
                            min: 0.0, max: 99999.0, step: 0.05,
                            onChange: East.function([FloatType], NullType, ($, newPrice) => {
                                const next = $.let(prices.read(), DictType(StringType, FloatType));
                                $(next.insertOrUpdate("AU", newPrice));
                                $(prices.write(next));
                            }),
                        }),
                    ], { gap: "3", justify: "space-between" }),
                    Stack.VStack([
                        Text.Root("US", { textStyle: "label-sm" }),
                        Input.Float(pricesRead.get("US", East.function([StringType], FloatType, _$ => 0.0)), {
                            min: 0.0, max: 99999.0, step: 0.05,
                            onChange: East.function([FloatType], NullType, ($, newPrice) => {
                                const next = $.let(prices.read(), DictType(StringType, FloatType));
                                $(next.insertOrUpdate("US", newPrice));
                                $(prices.write(next));
                            }),
                        }),
                    ], { gap: "3", justify: "space-between" }),
                    Stack.VStack([
                        Text.Root("EU", { textStyle: "label-sm" }),
                        Input.Float(pricesRead.get("EU", East.function([StringType], FloatType, _$ => 0.0)), {
                            min: 0.0, max: 99999.0, step: 0.05,
                            onChange: East.function([FloatType], NullType, ($, newPrice) => {
                                const next = $.let(prices.read(), DictType(StringType, FloatType));
                                $(next.insertOrUpdate("EU", newPrice));
                                $(prices.write(next));
                            }),
                        }),
                    ], { gap: "3", justify: "space-between" }),
                    Stack.VStack([
                        Text.Root("JP", { textStyle: "label-sm" }),
                        Input.Float(pricesRead.get("JP", East.function([StringType], FloatType, _$ => 0.0)), {
                            min: 0.0, max: 99999.0, step: 0.05,
                            onChange: East.function([FloatType], NullType, ($, newPrice) => {
                                const next = $.let(prices.read(), DictType(StringType, FloatType));
                                $(next.insertOrUpdate("JP", newPrice));
                                $(prices.write(next));
                            }),
                        }),
                    ], { gap: "3", justify: "space-between" }),
                    Diff.Root({
                        bindings: [prices.binding],
                        hideUnchanged: some(true),
                    }),
                ], { gap: "4", align: "stretch" }),
            ]);
        }));
    }),
    inputs: [],
});

// ============================================================================
// 7. Deployment status editor — Variant binding; one Button per status.
//    Demonstrates Variant tag changes in the Diff.
// ============================================================================

export const deploymentStatusEditor = example({
    keywords: ["Diff", "Variant", "Button", "deployment status", "bindStaged"],
    description: "Deployment-status editor — buttons set a Variant binding; Diff shows the status tag change",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const status = $.let(Data.bind([DeploymentStatusType], deploymentStatusInput.path));
            const statusRead = $.let(status.read(), DeploymentStatusType);

            return Card.Root([
                Stack.VStack([
                    Text.Root("Deployment status", { textStyle: "heading-md" }),
                    Text.Root("Current:"),
                    Text.Root(statusRead.getTag(), { textStyle: "label-md" }),
                    Stack.HStack([
                        Button.Root("Pending", {
                            onClick: East.function([], NullType, $ => $(status.write(variant("pending", null)))),
                        }),
                        Button.Root("In progress", {
                            onClick: East.function([], NullType, $ => $(status.write(variant("in_progress", null)))),
                        }),
                        Button.Root("Complete", {
                            onClick: East.function([], NullType, $ => $(status.write(variant("complete", null)))),
                        }),
                        Button.Root("Failed", {
                            onClick: East.function([], NullType, $ => $(status.write(variant("failed", null)))),
                        }),
                    ], { gap: "2" }),
                    Diff.Root({
                        bindings: [status.binding],
                        hideUnchanged: some(true),
                    }),
                ], { gap: "4", align: "stretch" }),
            ]);
        }));
    }),
    inputs: [],
});

// ============================================================================
// 8. Minimal call site — defaults only (used by IR-roundtrip + smoke tests)
// ============================================================================

export const diffDefaults = example({
    keywords: ["Diff", "Root", "defaults", "minimal"],
    description: "Minimal Diff.Root — single binding, all options omitted (defaults from IR)",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const view = $.let(Data.bind([FloatType], maxWeeklyHoursInput.path));
            return Diff.Root({ bindings: [view.binding] });
        }));
    }),
    inputs: [],
});

// ============================================================================
// Merge-conflict demo — bindStaged for the user's edit + bindDirect on the
// SAME path for a "simulate concurrent edit" button. Clicking the button
// writes a different value through the live cache, so the staged buffer's
// pinned snapshot drifts away from the current server value. Hitting Apply
// on the Diff card then triggers the orange chooser flow.
// ============================================================================

/**
 * Demonstrates the staged-mode merge tool / orange chooser. Workflow:
 *
 *   1. Drag the slider — your edit gets staged (snapshot pinned in StagedStore).
 *   2. Click "Simulate concurrent edit" — `Data.bind.write(42.0)` writes 42 to
 *      the same path through the live cache, mimicking another session
 *      committing while you have edits open. Server view is now 42; your
 *      pinned snapshot is still 38; your buffer is whatever you dragged to.
 *   3. Click Apply — `detectConflictsFor(userPatch, serverPatch)` finds both
 *      sides touching the root, switches the renderer to conflict mode, and
 *      shows the orange chooser row: keep yours (your dragged value), keep
 *      theirs (42), or manual (type a fresh number).
 */
export const mergeConflictDemo = example({
    keywords: ["Diff", "merge", "conflict", "chooser", "bindStaged", "Slider"],
    description: "Demo of the merge tool's orange chooser — drag, click Simulate, then Apply",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const staged = $.let(Data.bind([FloatType], mergeDemoHoursInput.path));
            const direct = $.let(Data.bind([FloatType], mergeDemoHoursInput.path, { mode: "direct" }));
            const stagedValue = $.let(staged.read(), FloatType);
            const serverValue = $.let(direct.read(), FloatType);
            return Card.Root([
                Stack.VStack([
                    Text.Root("Merge-conflict demo", { textStyle: "heading-md" }),
                    Text.Root(
                        "1. Drag the slider — your edit lands in the StagedStore (snapshot pinned).  "
                        + "2. Click \"Simulate concurrent edit\" — writes 42 through the live cache, "
                        + "mimicking another session committing while you have edits open.  "
                        + "3. Click Apply on the Diff card — the merge tool detects drift and fires "
                        + "the orange chooser row.",
                    ),
                    Stack.VStack([
                        Text.Root("Server (live cache):", { textStyle: "label-sm" }),
                        Text.Root(East.str`${serverValue}`),
                    ], { gap: "2" }),
                    Stack.VStack([
                        Text.Root("Your staged value:", { textStyle: "label-sm" }),
                        Text.Root(East.str`${stagedValue}`),
                    ], { gap: "2" }),
                    Slider.Root(stagedValue, {
                        min: 30.0, max: 60.0, step: 1.0,
                        onChangeEnd: ($, v) => $(staged.write(v)),
                    }),
                    Stack.VStack([
                        Button.Root("Simulate concurrent edit (server ← 42)", {
                            onClick: $ => $(direct.write(42.0)),
                        }),
                        Button.Root("Reset server to 38", {
                            onClick: $ => $(direct.write(38.0)),
                        }),
                    ], { gap: "2" }),
                    Diff.Root({
                        bindings: [staged.binding],
                        hideUnchanged: some(true),
                    }),
                ], { gap: "5", align: "stretch" }),
            ]);
        }));
    }),
    inputs: [],
});

// ============================================================================
// Density variants — same pricing-rules content rendered at the two
// non-default density presets, so the showcase can compare side-by-side
// against the default (`pricingRulesEditor` above).
// ============================================================================

/**
 * Pricing-rules editor at `compact` density — tighter row padding and smaller
 * type scale than the default `comfortable`. Suited to data-dense pages where
 * the Diff card is one of several panels competing for vertical space.
 */
export const pricingRulesEditorCompact = example({
    keywords: ["Diff", "density", "compact", "Slider", "Input", "pricing"],
    description: "Pricing-rules editor with `density: \"compact\"` — same content as pricingRulesEditor, denser rows",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const listPrice    = $.let(Data.bind([FloatType],   listPriceInput.path));
            const discountPct  = $.let(Data.bind([FloatType],   discountPctInput.path));
            const minOrderQty  = $.let(Data.bind([IntegerType], minOrderQtyInput.path));
            const currency     = $.let(Data.bind([StringType],  currencyCodeInput.path));
            return Card.Root([
                Stack.VStack([
                    Text.Root("Pricing rules — compact", { textStyle: "heading-md" }),
                    Slider.Root(listPrice.read(), {
                        min: 0.0, max: 999.95, step: 0.05,
                        onChangeEnd: ($, v) => $(listPrice.write(v)),
                    }),
                    Slider.Root(discountPct.read(), {
                        min: 0.0, max: 75.0, step: 0.5,
                        onChangeEnd: ($, v) => $(discountPct.write(v)),
                    }),
                    Input.Integer(minOrderQty.read(), {
                        min: 1n, max: 1000n,
                        onChange: ($, v) => $(minOrderQty.write(v)),
                    }),
                    Input.String(currency.read(), {
                        placeholder: "AUD",
                        onChange: ($, v) => $(currency.write(v)),
                    }),
                    Diff.Root({
                        bindings: [listPrice.binding, discountPct.binding, minOrderQty.binding, currency.binding],
                        density: "compact",
                        hideUnchanged: some(true),
                    }),
                ], { gap: "5", align: "stretch" }),
            ]);
        }));
    }),
    inputs: [],
});

/**
 * Pricing-rules editor at `condensed` density — mission-control sizing.
 * Tightest row padding and smallest type scale; pairs with status dashboards
 * and other read-heavy contexts where a diff list is reference data, not the
 * main interaction surface.
 */
export const pricingRulesEditorCondensed = example({
    keywords: ["Diff", "density", "condensed", "Slider", "Input", "pricing"],
    description: "Pricing-rules editor with `density: \"condensed\"` — mission-control sizing for read-heavy views",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const listPrice    = $.let(Data.bind([FloatType],   listPriceInput.path));
            const discountPct  = $.let(Data.bind([FloatType],   discountPctInput.path));
            const minOrderQty  = $.let(Data.bind([IntegerType], minOrderQtyInput.path));
            const currency     = $.let(Data.bind([StringType],  currencyCodeInput.path));
            return Card.Root([
                Stack.VStack([
                    Text.Root("Pricing rules — condensed", { textStyle: "heading-md" }),
                    Slider.Root(listPrice.read(), {
                        min: 0.0, max: 999.95, step: 0.05,
                        onChangeEnd: ($, v) => $(listPrice.write(v)),
                    }),
                    Slider.Root(discountPct.read(), {
                        min: 0.0, max: 75.0, step: 0.5,
                        onChangeEnd: ($, v) => $(discountPct.write(v)),
                    }),
                    Input.Integer(minOrderQty.read(), {
                        min: 1n, max: 1000n,
                        onChange: ($, v) => $(minOrderQty.write(v)),
                    }),
                    Input.String(currency.read(), {
                        placeholder: "AUD",
                        onChange: ($, v) => $(currency.write(v)),
                    }),
                    Diff.Root({
                        bindings: [listPrice.binding, discountPct.binding, minOrderQty.binding, currency.binding],
                        density: "condensed",
                        hideUnchanged: some(true),
                    }),
                ], { gap: "5", align: "stretch" }),
            ]);
        }));
    }),
    inputs: [],
});

// ============================================================================
// Overlay-mode bindings — patches stored in a sibling `e3.input` typed
// `PatchType(T)`. The Diff component surfaces them via the `overlay` option
// instead of `staged`. See `Data.bindOverlay`.
// ============================================================================

// Patch inputs for overlay-mode examples. Each defaults to `unchanged`.
export const maxWeeklyHoursPatchInput = e3.input(
    "max_weekly_hours_patch",
    PatchType(FloatType),
    variant("unchanged", null),
);

export const regionalPricesPatchInput = e3.input(
    "regional_prices_patch",
    PatchType(DictType(StringType, FloatType)),
    variant("unchanged", null),
);

export const rosterPatchInput = e3.input(
    "roster_patch",
    PatchType(RosterArrayType),
    variant("unchanged", null),
);

// Drift-laden patch input — defaults to a non-trivial patch whose ops are
// stale relative to the source dict `{AU: 49.95, US: 39.95, EU: 44.95, JP:
// 5499.0}`. Used by `regionalPricingOverlayDrift` to demonstrate what the
// Diff card surfaces when a server-stored patch was authored against an
// older version of its source. Conflicts (per `apply.ts` semantics):
//   - `delete "MX"`        — key not in source                 → stale delete
//   - `insert "AU"`        — key already exists in source      → stale insert
//   - `update "US"` with `replace(before=30 → 25)` — before mismatches source's 39.95
//   - `update "EU"` with `replace(before=44.95 → 39.95)` — clean (for contrast)
export const regionalPricesDriftPatchInput = e3.input(
    "regional_prices_drift_patch",
    PatchType(DictType(StringType, FloatType)),
    variant("patch", new Map<string, { type: string; value: unknown }>([
        ["MX", variant("delete", 99.0)],
        ["AU", variant("insert", 100.0)],
        ["US", variant("update", variant("replace", { before: 30.0, after: 25.0 }))],
        ["EU", variant("update", variant("replace", { before: 44.95, after: 39.95 }))],
    ])),
);

// Roster overlay drift — a patch over the array-of-structs source. Built with
// `diffFor` (base matches the bound source, so ops are clean) so the Diff card
// exercises its nested grouping: binding → array index → struct field. Only
// the `rate` of entries 0 and 1 change, producing `[0] → rate`, `[1] → rate`.
const rosterDriftBase = [
    { id: "alice",   name: "Alice Chen",    rate: 32.50, shiftLength: 8n },
    { id: "bob",     name: "Bob Romero",    rate: 28.00, shiftLength: 8n },
    { id: "charlie", name: "Charlie Patel", rate: 35.75, shiftLength: 10n },
    { id: "diana",   name: "Diana Wallace", rate: 30.25, shiftLength: 8n },
];
const rosterDriftEdited = [
    { id: "alice",   name: "Alice Chen",    rate: 6.00,  shiftLength: 8n },
    { id: "bob",     name: "Bob Romero",    rate: 29.00, shiftLength: 8n },
    { id: "charlie", name: "Charlie Patel", rate: 35.75, shiftLength: 10n },
    { id: "diana",   name: "Diana Wallace", rate: 30.25, shiftLength: 8n },
];
export const rosterDriftPatchInput = e3.input(
    "roster_drift_patch",
    PatchType(RosterArrayType),
    diffFor(RosterArrayType)(rosterDriftBase, rosterDriftEdited),
);

/**
 * Single-Float overlay editor — Slider edits go to `max_weekly_hours_patch`,
 * the Diff card surfaces the patch against the source.
 */
export const policyOverlayEditor = example({
    keywords: ["Diff", "bindOverlay", "Slider", "overlay", "policy", "patch"],
    description: "Overlay-mode editor — Slider writes patches to a sibling e3.input; Diff shows them",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const view = $.let(Data.bind(
                [FloatType],
                maxWeeklyHoursInput.path,
                { mode: "direct", patch: maxWeeklyHoursPatchInput.path },
            ));
            return Card.Root([
                Stack.VStack([
                    Text.Root("Max weekly hours (overlay)", { textStyle: "heading-md" }),
                    Slider.Root(view.read(), {
                        min: 30.0, max: 60.0, step: 1.0,
                        onChangeEnd: ($, v) => $(view.write(v)),
                    }),
                    Diff.Root({
                        bindings: [view.binding],
                        hideUnchanged: some(true),
                    }),
                ], { gap: "5", align: "stretch" }),
            ]);
        }));
    }),
    inputs: [],
});

/**
 * Overlay binding whose patch input *starts* with a non-trivial patch that
 * is stale relative to the source. Demonstrates what the Diff card displays
 * when a server-stored patch was authored against an older revision of its
 * source — stale delete, stale insert, stale replace.
 *
 * No form components: `view.read()` calls `apply(source, patch)`, which
 * throws `ConflictError` on the stale ops. The Diff card walks the patch IR
 * directly from cache bytes (no apply) so it renders cleanly. The
 * `bindOverlay` call is kept so the renderer's overlay-type registry knows
 * how to decode the patch bytes for this binding.
 */
export const regionalPricingOverlayDrift = example({
    keywords: ["Diff", "bindOverlay", "Dict", "conflict", "drift", "patch"],
    description: "Overlay-mode example with a stale patch — Diff card surfaces ops that don't match the source",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const view = $.let(Data.bind(
                [DictType(StringType, FloatType)],
                regionalPricesInput.path,
                { mode: "direct", patch: regionalPricesDriftPatchInput.path },
            ));
            return Card.Root([
                Stack.VStack([
                    Text.Root("Regional pricing — overlay with stale patch", { textStyle: "heading-md" }),
                    Text.Root(
                        "The patch input was authored against an older source. The Diff card below "
                        + "shows: a stale delete (MX missing from source), a stale insert (AU already "
                        + "exists), a stale replace (US before=30 doesn't match current 39.95), and "
                        + "one clean replace (EU 44.95 → 39.95). Apply would throw ConflictError on "
                        + "the stale ops; this example exists to show what the Diff renderer surfaces "
                        + "when a server-stored patch has drifted from its source.",
                    ),
                    Diff.Root({
                        bindings: [view.binding],
                        hideUnchanged: some(true),
                    }),
                ], { gap: "5", align: "stretch" }),
            ]);
        }));
    }),
    inputs: [],
});

/**
 * Roster overlay drift — array-of-structs patch surfaced by the Diff card,
 * exercising nested grouping (binding → `[index]` → struct field). The patch
 * touches only `rate` on the first two entries, so the card renders
 * `ROSTER → [0] → rate`, `[1] → rate`.
 */
export const rosterOverlayDrift = example({
    keywords: ["Diff", "overlay", "roster", "array", "nested", "patch"],
    description: "Overlay-mode roster patch — Diff card surfaces nested array-element field changes",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const view = $.let(Data.bind(
                [RosterArrayType],
                rosterInput.path,
                { mode: "direct", patch: rosterDriftPatchInput.path },
            ));
            return Card.Root([
                Stack.VStack([
                    Text.Root("Roster — overlay patch (nested)", { textStyle: "heading-md" }),
                    Text.Root(
                        "The patch changes the hourly rate of the first two roster entries. The "
                        + "Diff card groups each change under its array index, demonstrating the "
                        + "binding → [index] → field nesting.",
                    ),
                    Diff.Root({
                        bindings: [view.binding],
                        hideUnchanged: some(true),
                    }),
                ], { gap: "5", align: "stretch" }),
            ]);
        }));
    }),
    inputs: [],
});

/**
 * Roster table editor in overlay mode — patches stored in `roster_patch`,
 * survive page reload and are visible to other workspace sessions.
 */
export const rosterTableEditorOverlay = example({
    keywords: ["Diff", "Table", "bindOverlay", "patch", "overlay", "roster"],
    description: "Editable table backed by a separate patch e3.input — patches persist across sessions",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const view = $.let(Data.bind(
                [RosterArrayType],
                rosterInput.path,
                { mode: "direct", patch: rosterPatchInput.path },
            ));
            const rosterArray = $.let(view.read(), RosterArrayType);
            return Card.Root([
                Stack.VStack([
                    Text.Root("Worker roster (overlay-mode)", { textStyle: "heading-md" }),
                    Text.Root("Patches stored in a sibling dataset — survive reload, visible to other sessions."),
                    Table.Root(
                        rosterArray,
                        {
                            name: { header: "Name" },
                            rate: {
                                header: "Hourly rate ($)",
                                render: East.function(
                                    [Table.Types.CellRenderContext],
                                    UIComponentType,
                                    ($, ctx) => {
                                        const idx = $.let(ctx.rowIndex, IntegerType);
                                        const row = $.let(rosterArray.get(idx), RosterEntryType);
                                        return Input.Float(row.rate, {
                                            min: 15.0, max: 80.0, step: 0.25,
                                            onChange: East.function([FloatType], NullType, ($, v) => {
                                                const fresh = $.let(view.read(), RosterArrayType);
                                                const next = $.let(fresh.map(($, r, i) =>
                                                    i.equal(idx).ifElse(_$ => ({ ...r, rate: v }), _$ => r),
                                                ), RosterArrayType);
                                                $(view.write(next));
                                            }),
                                        });
                                    },
                                ),
                            },
                            shiftLength: {
                                header: "Shift length (h)",
                                render: East.function(
                                    [Table.Types.CellRenderContext],
                                    UIComponentType,
                                    ($, ctx) => {
                                        const idx = $.let(ctx.rowIndex, IntegerType);
                                        const row = $.let(rosterArray.get(idx), RosterEntryType);
                                        return Input.Integer(row.shiftLength, {
                                            min: 4n, max: 12n,
                                            onChange: East.function([IntegerType], NullType, ($, v) => {
                                                const fresh = $.let(view.read(), RosterArrayType);
                                                const next = $.let(fresh.map(($, r, i) =>
                                                    i.equal(idx).ifElse(_$ => ({ ...r, shiftLength: v }), _$ => r),
                                                ), RosterArrayType);
                                                $(view.write(next));
                                            }),
                                        });
                                    },
                                ),
                            },
                        },
                        { variant: "line", striped: true },
                    ),
                    Diff.Root({
                        bindings: [view.binding],
                        hideUnchanged: some(true),
                    }),
                ], { gap: "5", align: "stretch" }),
            ]);
        }));
    }),
    inputs: [],
});

// ============================================================================
// Staged + patch dataset — the fourth mode. Edits buffer locally (IndexedDB)
// while the user iterates; commit publishes a fresh patch IR to the patch
// dataset (the source is not touched until a separate apply step). Pairs
// well with reviewer / approval workflows where the patch dataset becomes
// the unit of review.
// ============================================================================

/**
 * Single-Float staged-with-patch editor — buffered Slider edits publish to
 * `max_weekly_hours_patch` on Apply. The source `max_weekly_hours` stays
 * untouched until a separate apply-patch-to-source step.
 */
export const policyStagedPatchEditor = example({
    keywords: ["Diff", "Slider", "staged", "patch", "publish", "policy"],
    description: "Slider edits buffered locally; Apply publishes draft to a server-backed patch dataset",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const view = $.let(Data.bind(
                [FloatType],
                maxWeeklyHoursInput.path,
                { mode: "staged", patch: maxWeeklyHoursPatchInput.path },
            ));
            return Card.Root([
                Stack.VStack([
                    Text.Root("Max weekly hours (staged + patch)", { textStyle: "heading-md" }),
                    Text.Root("Drag to buffer locally; Apply publishes the draft as a patch to the patch dataset (source untouched)."),
                    Slider.Root(view.read(), {
                        min: 30.0, max: 60.0, step: 1.0,
                        onChange: ($, v) => $(view.write(v)),
                    }),
                    Diff.Root({
                        bindings: [view.binding],
                        hideUnchanged: some(true),
                    }),
                ], { gap: "5", align: "stretch" }),
            ]);
        }));
    }),
    inputs: [],
});

/**
 * Roster table editor in staged + patch mode. Cell edits buffer in
 * IndexedDB until Apply, which publishes a fresh patch to `roster_patch`.
 * Survives reload as a draft; multi-session reviewers see the patch only
 * after the author commits.
 */
export const rosterStagedPatchEditor = example({
    keywords: ["Diff", "Table", "staged", "patch", "publish", "roster"],
    description: "Editable roster — edits buffered locally; Apply publishes a fresh patch to a server-backed patch dataset",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const view = $.let(Data.bind(
                [RosterArrayType],
                rosterInput.path,
                { mode: "staged", patch: rosterPatchInput.path },
            ));
            const rosterArray = $.let(view.read(), RosterArrayType);
            return Card.Root([
                Stack.VStack([
                    Text.Root("Worker roster (staged + patch)", { textStyle: "heading-md" }),
                    Text.Root("Edits buffer locally until Apply, which publishes a draft patch to the patch dataset for review."),
                    Table.Root(
                        rosterArray,
                        {
                            name: { header: "Name" },
                            rate: {
                                header: "Hourly rate ($)",
                                render: East.function(
                                    [Table.Types.CellRenderContext],
                                    UIComponentType,
                                    ($, ctx) => {
                                        const idx = $.let(ctx.rowIndex, IntegerType);
                                        const row = $.let(rosterArray.get(idx), RosterEntryType);
                                        return Input.Float(row.rate, {
                                            min: 15.0, max: 80.0, step: 0.25,
                                            onChange: East.function([FloatType], NullType, ($, v) => {
                                                const fresh = $.let(view.read(), RosterArrayType);
                                                $(view.write(fresh.map(($, r, i) =>
                                                    i.equal(idx).ifElse(_$ => ({ ...r, rate: v }), () => r),
                                                )));
                                            }),
                                        });
                                    },
                                ),
                            },
                            shiftLength: {
                                header: "Shift length (h)",
                                render: East.function(
                                    [Table.Types.CellRenderContext],
                                    UIComponentType,
                                    ($, ctx) => {
                                        const idx = $.let(ctx.rowIndex, IntegerType);
                                        const row = $.let(rosterArray.get(idx), RosterEntryType);
                                        return Input.Integer(row.shiftLength, {
                                            min: 4n, max: 12n,
                                            onChange: East.function([IntegerType], NullType, ($, v) => {
                                                const fresh = $.let(view.read(), RosterArrayType);
                                                $(view.write(fresh.map(($, r, i) =>
                                                    i.equal(idx).ifElse(_$ => ({ ...r, shiftLength: v }), () => r),
                                                )));
                                            }),
                                        });
                                    },
                                ),
                            },
                        },
                        { variant: "line", striped: true },
                    ),
                    Diff.Root({
                        bindings: [view.binding],
                        hideUnchanged: some(true),
                    }),
                ], { gap: "5", align: "stretch" }),
            ]);
        }));
    }),
    inputs: [],
});
