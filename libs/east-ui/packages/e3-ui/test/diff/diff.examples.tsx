/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */

/**
 * Diff component examples — realistic editing scenes that combine
 * `Data.bind` with east-ui form components and a `<Diff>` panel
 * surfacing the pending changes for sign-off.
 *
 * Coverage:
 *   1. Slider-driven editor     → workforcePolicyEditor
 *   2. Editor variants panel    → diffEditorVariants (heterogeneous inputs /
 *      mixed sliders + inputs / Set / Dict / Variant / density presets)
 *   3. Editable Table cells     → rosterTableEditor
 *   4. Minimal call site        → diffDefaults (IR-roundtrip)
 *   5. Merge-conflict chooser   → mergeConflictDemo
 *   6. Overlay-mode patches     → diffOverlayVariants
 *   7. Staged + patch datasets  → diffStagedPatchVariants
 *
 * Pattern:
 *   1. Declare an `e3.input(name, type, default)` per editable scalar.
 *   2. Inside `<Reactive>`, bind each via `Data.bind`.
 *   3. Wire form components — `read()` for the current value,
 *      `write()` on change.
 *   4. Close the scene with `<Diff bindings={[...]} />` — Apply commits
 *      the merged batch; Discard drops the buffer.
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
    FunctionType,
    PatchType,
    diffFor,
    some,
    variant,
    example,
} from "@elaraai/east";
import {
    Card, HStack, VStack, Slider, Input, Switch, Select, Separator, Text, Button,
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
        return (
            <Reactive>{$ => {
                const maxHours = $.let(Data.bind(maxWeeklyHoursInput, { mode: "staged" }));
                const otThresh = $.let(Data.bind(overtimeThresholdInput, { mode: "staged" }));
                const restGap  = $.let(Data.bind(restGapHoursInput, { mode: "staged" }));
                const penalty  = $.let(Data.bind(holidayPenaltyInput, { mode: "staged" }));
                return (
                    <Card>
                        <VStack gap="5" align="stretch">
                            <Text textStyle="heading-md">Workforce policy</Text>
                            <Text>Drag the sliders to stage policy changes — review in the Diff card before applying.</Text>
                            <VStack gap="1">
                                <Text textStyle="label-sm">Max weekly hours</Text>
                                <Slider value={maxHours.read()} min={30.0} max={60.0} step={1.0}
                                    onChangeEnd={($, v) => $(maxHours.write(v))} />
                            </VStack>
                            <VStack gap="1">
                                <Text textStyle="label-sm">Overtime threshold (h)</Text>
                                <Slider value={otThresh.read()} min={30.0} max={60.0} step={1.0}
                                    onChangeEnd={($, v) => $(otThresh.write(v))} />
                            </VStack>
                            <VStack gap="1">
                                <Text textStyle="label-sm">Mandatory rest gap (h)</Text>
                                <Slider value={restGap.read()} min={8.0} max={16.0} step={1.0}
                                    onChangeEnd={($, v) => $(restGap.write(v))} />
                            </VStack>
                            <VStack gap="1">
                                <Text textStyle="label-sm">Public holiday penalty (×)</Text>
                                <Slider value={penalty.read()} min={1.0} max={3.0} step={0.25}
                                    onChangeEnd={($, v) => $(penalty.write(v))} />
                            </VStack>
                            <Diff bindings={[maxHours.binding, otThresh.binding, restGap.binding, penalty.binding]}
                                hideUnchanged={some(true)} />
                        </VStack>
                    </Card>
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

// ============================================================================
// 2. Editor variants panel — the type-coverage enumeration: heterogeneous
//    scalar inputs (String / Integer / Bool / DateTime / Select), mixed
//    sliders + inputs (side-by-side Diff), Set / Dict / Variant bindings,
//    and the two non-default density presets.
// ============================================================================

export const diffEditorVariants = example({
    keywords: ["Diff", "Input", "Switch", "Select", "DateTime", "Toast", "onCommitted", "side-by-side", "Slider", "pricing", "discount", "mixed", "Set", "feature flags", "bindStaged", "Dict", "regional pricing", "Variant", "Button", "deployment status", "density", "compact", "condensed"],
    description: "Editor variant panel — SERVICE CONFIG FORM: heterogeneous String / Integer / Bool / DateTime / Select inputs, commit fires a success Toast; PRICING RULES: sliders for list price/discount, IntegerInput for min order qty, StringInput for currency, Diff in side-by-side mode; FEATURE FLAGS: Switch per known flag toggles inclusion in a staged Set, Diff shows insertions / deletions; REGIONAL PRICING: Input.Float per region writes back to a staged Dict, Diff shows per-key updates; DEPLOYMENT STATUS: buttons set a Variant binding, Diff shows the status tag change; PRICING RULES COMPACT: `density: \"compact\"` — denser rows; PRICING RULES CONDENSED: `density: \"condensed\"` — mission-control sizing for read-heavy views",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="SERVICE CONFIG FORM" align="start" />
                <Reactive>{$ => {
                    const svcName     = $.let(Data.bind(serviceNameInput, { mode: "staged" }));
                    const replicas    = $.let(Data.bind(replicasInput, { mode: "staged" }));
                    const autoScale   = $.let(Data.bind(autoScaleInput, { mode: "staged" }));
                    const region      = $.let(Data.bind(regionInput, { mode: "staged" }));
                    const deployAfter = $.let(Data.bind(deployAfterInput, { mode: "staged" }));
                    return (
                        <Card>
                            <VStack gap="4" align="stretch">
                                <Text textStyle="heading-md">Service configuration</Text>
                                <Text>Stage edits across heterogeneous types; on apply you’ll see a confirmation toast.</Text>

                                <VStack gap="1">
                                    <Text textStyle="label-sm">Service name</Text>
                                    <Input.String value={svcName.read()} placeholder="service-name"
                                        onChange={($, v) => $(svcName.write(v))} />
                                </VStack>

                                <VStack gap="1">
                                    <Text textStyle="label-sm">Replicas</Text>
                                    <Input.Integer value={replicas.read()} min={1n} max={50n}
                                        onChange={($, v) => $(replicas.write(v))} />
                                </VStack>

                                <VStack gap="1">
                                    <Text textStyle="label-sm">Auto-scale</Text>
                                    <Switch checked={autoScale.read()} onChange={($, v) => $(autoScale.write(v))} />
                                </VStack>

                                <VStack gap="1">
                                    <Text textStyle="label-sm">Region</Text>
                                    <Select value={region.read()} items={[
                                        Select.Item("ap-southeast-2", "ap-southeast-2 (Sydney)"),
                                        Select.Item("us-east-1",      "us-east-1 (N. Virginia)"),
                                        Select.Item("eu-west-1",      "eu-west-1 (Ireland)"),
                                    ]} onChange={($, v) => $(region.write(v))} />
                                </VStack>

                                <VStack gap="1">
                                    <Text textStyle="label-sm">Deploy after</Text>
                                    <Input.DateTime value={deployAfter.read()} precision="datetime"
                                        onChange={($, v) => $(deployAfter.write(v))} />
                                </VStack>

                                <Diff bindings={[svcName.binding, replicas.binding, autoScale.binding, region.binding, deployAfter.binding]} />
                            </VStack>
                        </Card>
                    );
                }}</Reactive>
                <Separator label="PRICING RULES" align="start" />
                <Reactive>{$ => {
                    const listPrice    = $.let(Data.bind(listPriceInput, { mode: "staged" }));
                    const discountPct  = $.let(Data.bind(discountPctInput, { mode: "staged" }));
                    const minOrderQty  = $.let(Data.bind(minOrderQtyInput, { mode: "staged" }));
                    const currency     = $.let(Data.bind(currencyCodeInput, { mode: "staged" }));
                    return (
                        <Card>
                            <VStack gap="5" align="stretch">
                                <Text textStyle="heading-md">Pricing rules</Text>
                                <Text>Stage pricing changes — review side-by-side before applying to the catalog.</Text>
                                <VStack gap="1">
                                    <Text textStyle="label-sm">List price</Text>
                                    <Slider value={listPrice.read()} min={0.0} max={999.95} step={0.05}
                                        onChangeEnd={($, v) => $(listPrice.write(v))} />
                                </VStack>
                                <VStack gap="1">
                                    <Text textStyle="label-sm">Discount (%)</Text>
                                    <Slider value={discountPct.read()} min={0.0} max={75.0} step={0.5}
                                        onChangeEnd={($, v) => $(discountPct.write(v))} />
                                </VStack>
                                <VStack gap="1">
                                    <Text textStyle="label-sm">Minimum order quantity</Text>
                                    <Input.Integer value={minOrderQty.read()} min={1n} max={1000n}
                                        onChange={($, v) => $(minOrderQty.write(v))} />
                                </VStack>
                                <VStack gap="1">
                                    <Text textStyle="label-sm">Currency code</Text>
                                    <Input.String value={currency.read()} placeholder="AUD"
                                        onChange={($, v) => $(currency.write(v))} />
                                </VStack>
                                <Diff bindings={[listPrice.binding, discountPct.binding, minOrderQty.binding, currency.binding]}
                                    hideUnchanged={some(true)} />
                            </VStack>
                        </Card>
                    );
                }}</Reactive>
                <Separator label="FEATURE FLAGS" align="start" />
                <Reactive>{$ => {
                    const flags = $.let(Data.bind(featureFlagsInput, { mode: "staged" }));
                    const flagsRead = $.let(flags.read(), SetType(StringType));
                    // ONE East closure factory: `toggle(flag)` returns the per-switch
                    // handler as a real East function value (captures `flag` in East).
                    const toggle = $.const(East.function([StringType], FunctionType([BooleanType], NullType), (_$, flag) =>
                        East.function([BooleanType], NullType, ($, isOn) => {
                            const next = $.let(flags.read(), SetType(StringType));
                            $.if(isOn, $ => { $(next.insert(flag)); }).else($ => { $(next.delete(flag)); });
                            $(flags.write(next));
                        })));
                    const onDarkMode = $.const(toggle("dark_mode"));
                    const onExperiments = $.const(toggle("experiments"));
                    const onNotifications = $.const(toggle("notifications"));
                    const onAnalytics = $.const(toggle("analytics"));
                    const onAiAssist = $.const(toggle("ai_assist"));
                    return (
                        <Card>
                            <VStack gap="4" align="stretch">
                                <Text textStyle="heading-md">Feature flags</Text>
                                <Text>Toggle flags to stage changes; Diff card below shows the set delta.</Text>
                                <VStack gap="3" justify="space-between">
                                    <Text textStyle="label-sm">dark_mode</Text>
                                    <Switch checked={flagsRead.has("dark_mode")} onChange={onDarkMode} />
                                </VStack>
                                <VStack gap="3" justify="space-between">
                                    <Text textStyle="label-sm">experiments</Text>
                                    <Switch checked={flagsRead.has("experiments")} onChange={onExperiments} />
                                </VStack>
                                <VStack gap="3" justify="space-between">
                                    <Text textStyle="label-sm">notifications</Text>
                                    <Switch checked={flagsRead.has("notifications")} onChange={onNotifications} />
                                </VStack>
                                <VStack gap="3" justify="space-between">
                                    <Text textStyle="label-sm">analytics</Text>
                                    <Switch checked={flagsRead.has("analytics")} onChange={onAnalytics} />
                                </VStack>
                                <VStack gap="3" justify="space-between">
                                    <Text textStyle="label-sm">ai_assist</Text>
                                    <Switch checked={flagsRead.has("ai_assist")} onChange={onAiAssist} />
                                </VStack>
                                <Diff bindings={[flags.binding]} hideUnchanged={some(true)} />
                            </VStack>
                        </Card>
                    );
                }}</Reactive>
                <Separator label="REGIONAL PRICING" align="start" />
                <Reactive>{$ => {
                    const prices = $.let(Data.bind(regionalPricesInput, { mode: "staged" }));
                    const pricesRead = $.let(prices.read(), DictType(StringType, FloatType));
                    // ONE East closure factory: `setPrice(region)` returns the
                    // per-region handler as a real East function value.
                    const setPrice = $.const(East.function([StringType], FunctionType([FloatType], NullType), (_$, region) =>
                        East.function([FloatType], NullType, ($, newPrice) => {
                            const next = $.let(prices.read(), DictType(StringType, FloatType));
                            $(next.insertOrUpdate(region, newPrice));
                            $(prices.write(next));
                        })));
                    const onAu = $.const(setPrice("AU"));
                    const onUs = $.const(setPrice("US"));
                    const onEu = $.const(setPrice("EU"));
                    const onJp = $.const(setPrice("JP"));
                    return (
                        <Card>
                            <VStack gap="4" align="stretch">
                                <Text textStyle="heading-md">Regional pricing</Text>
                                <Text>Edit per-region prices; Diff card below tracks pending updates.</Text>
                                <VStack gap="3" justify="space-between">
                                    <Text textStyle="label-sm">AU</Text>
                                    <Input.Float value={pricesRead.get("AU", East.function([StringType], FloatType, _$ => 0.0))}
                                        min={0.0} max={99999.0} step={0.05}
                                        onChange={onAu} />
                                </VStack>
                                <VStack gap="3" justify="space-between">
                                    <Text textStyle="label-sm">US</Text>
                                    <Input.Float value={pricesRead.get("US", East.function([StringType], FloatType, _$ => 0.0))}
                                        min={0.0} max={99999.0} step={0.05}
                                        onChange={onUs} />
                                </VStack>
                                <VStack gap="3" justify="space-between">
                                    <Text textStyle="label-sm">EU</Text>
                                    <Input.Float value={pricesRead.get("EU", East.function([StringType], FloatType, _$ => 0.0))}
                                        min={0.0} max={99999.0} step={0.05}
                                        onChange={onEu} />
                                </VStack>
                                <VStack gap="3" justify="space-between">
                                    <Text textStyle="label-sm">JP</Text>
                                    <Input.Float value={pricesRead.get("JP", East.function([StringType], FloatType, _$ => 0.0))}
                                        min={0.0} max={99999.0} step={0.05}
                                        onChange={onJp} />
                                </VStack>
                                <Diff bindings={[prices.binding]} hideUnchanged={some(true)} />
                            </VStack>
                        </Card>
                    );
                }}</Reactive>
                <Separator label="DEPLOYMENT STATUS" align="start" />
                <Reactive>{$ => {
                    const status = $.let(Data.bind(deploymentStatusInput, { mode: "staged" }));
                    const statusRead = $.let(status.read(), DeploymentStatusType);
                    const setPending = $.const(East.function([], NullType, $ => $(status.write(variant("pending", null)))));
                    const setInProgress = $.const(East.function([], NullType, $ => $(status.write(variant("in_progress", null)))));
                    const setComplete = $.const(East.function([], NullType, $ => $(status.write(variant("complete", null)))));
                    const setFailed = $.const(East.function([], NullType, $ => $(status.write(variant("failed", null)))));
                    return (
                        <Card>
                            <VStack gap="4" align="stretch">
                                <Text textStyle="heading-md">Deployment status</Text>
                                <Text>Current:</Text>
                                <Text textStyle="label-md">{statusRead.getTag()}</Text>
                                <HStack gap="2">
                                    <Button onClick={setPending}>Pending</Button>
                                    <Button onClick={setInProgress}>In progress</Button>
                                    <Button onClick={setComplete}>Complete</Button>
                                    <Button onClick={setFailed}>Failed</Button>
                                </HStack>
                                <Diff bindings={[status.binding]} hideUnchanged={some(true)} />
                            </VStack>
                        </Card>
                    );
                }}</Reactive>
                <Separator label="PRICING RULES COMPACT" align="start" />
                <Reactive>{$ => {
                    const listPrice    = $.let(Data.bind(listPriceInput, { mode: "staged" }));
                    const discountPct  = $.let(Data.bind(discountPctInput, { mode: "staged" }));
                    const minOrderQty  = $.let(Data.bind(minOrderQtyInput, { mode: "staged" }));
                    const currency     = $.let(Data.bind(currencyCodeInput, { mode: "staged" }));
                    return (
                        <Card>
                            <VStack gap="5" align="stretch">
                                <Text textStyle="heading-md">Pricing rules — compact</Text>
                                <Slider value={listPrice.read()} min={0.0} max={999.95} step={0.05}
                                    onChangeEnd={($, v) => $(listPrice.write(v))} />
                                <Slider value={discountPct.read()} min={0.0} max={75.0} step={0.5}
                                    onChangeEnd={($, v) => $(discountPct.write(v))} />
                                <Input.Integer value={minOrderQty.read()} min={1n} max={1000n}
                                    onChange={($, v) => $(minOrderQty.write(v))} />
                                <Input.String value={currency.read()} placeholder="AUD"
                                    onChange={($, v) => $(currency.write(v))} />
                                <Diff bindings={[listPrice.binding, discountPct.binding, minOrderQty.binding, currency.binding]}
                                    density="compact" hideUnchanged={some(true)} />
                            </VStack>
                        </Card>
                    );
                }}</Reactive>
                <Separator label="PRICING RULES CONDENSED" align="start" />
                <Reactive>{$ => {
                    const listPrice    = $.let(Data.bind(listPriceInput, { mode: "staged" }));
                    const discountPct  = $.let(Data.bind(discountPctInput, { mode: "staged" }));
                    const minOrderQty  = $.let(Data.bind(minOrderQtyInput, { mode: "staged" }));
                    const currency     = $.let(Data.bind(currencyCodeInput, { mode: "staged" }));
                    return (
                        <Card>
                            <VStack gap="5" align="stretch">
                                <Text textStyle="heading-md">Pricing rules — condensed</Text>
                                <Slider value={listPrice.read()} min={0.0} max={999.95} step={0.05}
                                    onChangeEnd={($, v) => $(listPrice.write(v))} />
                                <Slider value={discountPct.read()} min={0.0} max={75.0} step={0.5}
                                    onChangeEnd={($, v) => $(discountPct.write(v))} />
                                <Input.Integer value={minOrderQty.read()} min={1n} max={1000n}
                                    onChange={($, v) => $(minOrderQty.write(v))} />
                                <Input.String value={currency.read()} placeholder="AUD"
                                    onChange={($, v) => $(currency.write(v))} />
                                <Diff bindings={[listPrice.binding, discountPct.binding, minOrderQty.binding, currency.binding]}
                                    density="condensed" hideUnchanged={some(true)} />
                            </VStack>
                        </Card>
                    );
                }}</Reactive>
            </VStack>
        );
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
        return (
            <Reactive>{$ => {
                const roster = $.let(Data.bind(rosterInput, { mode: "staged" }));
                // Get the roster array fresh inside the render closures to ensure edits to sibling
                const rosterArray = $.let(roster.read(), RosterArrayType);
                return (
                    <Card>
                        <VStack gap="5" align="stretch">
                            <Text textStyle="heading-md">Worker roster</Text>
                            <Text>Edit hourly rates and default shift lengths inline; Diff card below tracks pending changes.</Text>
                            <Table data={rosterArray} columns={{
                                name: { header: "Name" },
                                rate: {
                                    header: "Hourly rate ($)",
                                    render: East.function(
                                        [Table.Types.CellRenderContext],
                                        UIComponentType,
                                        ($, ctx) => {
                                            const idx = $.let(ctx.rowIndex, IntegerType);
                                            const row = $.let(rosterArray.get(idx), RosterEntryType);
                                            // Re-read fresh inside the handler so a sibling cell's
                                            // edit on the same row isn't overwritten by a stale
                                            // capture of `row`. Merge via the map iterator's `r`.
                                            const onRateChange = $.const(East.function([FloatType], NullType, ($, v) => {
                                                const fresh = $.let(roster.read(), RosterArrayType);
                                                const next = $.let(fresh.map(($, r, i) =>
                                                    i.equal(idx).ifElse(_$ => ({ ...r, rate: v }), () => r),
                                                ), RosterArrayType);
                                                $(roster.write(next));
                                            }));
                                            return (
                                                <Input.Float value={row.rate} min={15.0} max={80.0} step={0.25}
                                                    onChange={onRateChange} />
                                            );
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
                                            const onShiftChange = $.const(East.function([IntegerType], NullType, ($, v) => {
                                                const fresh = $.let(roster.read(), RosterArrayType);
                                                $(roster.write(fresh.map(($, r, i) =>
                                                    i.equal(idx).ifElse(_$ => ({ ...r, shiftLength: v }), () => r),
                                                )));
                                            }));
                                            return (
                                                <Input.Integer value={row.shiftLength} min={4n} max={12n}
                                                    onChange={onShiftChange} />
                                            );
                                        },
                                    ),
                                },
                            }} variant="line" striped />
                            <Diff bindings={[roster.binding]} hideUnchanged={some(true)} />
                        </VStack>
                    </Card>
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

// ============================================================================
// 4. Minimal call site — defaults only (used by IR-roundtrip + smoke tests)
// ============================================================================

export const diffDefaults = example({
    keywords: ["Diff", "Root", "defaults", "minimal"],
    description: "Minimal Diff — single binding, all options omitted (defaults from IR)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                const view = $.let(Data.bind(maxWeeklyHoursInput, { mode: "staged" }));
                return <Diff bindings={[view.binding]} />;
            }}</Reactive>
        );
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
        return (
            <Reactive>{$ => {
                const staged = $.let(Data.bind(mergeDemoHoursInput, { mode: "staged" }));
                const direct = $.let(Data.bind(mergeDemoHoursInput, { mode: "direct" }));
                const stagedValue = $.let(staged.read(), FloatType);
                const serverValue = $.let(direct.read(), FloatType);
                return (
                    <Card>
                        <VStack gap="5" align="stretch">
                            <Text textStyle="heading-md">Merge-conflict demo</Text>
                            <Text>{
                                "1. Drag the slider — your edit lands in the StagedStore (snapshot pinned).  "
                                + "2. Click \"Simulate concurrent edit\" — writes 42 through the live cache, "
                                + "mimicking another session committing while you have edits open.  "
                                + "3. Click Apply on the Diff card — the merge tool detects drift and fires "
                                + "the orange chooser row."
                            }</Text>
                            <VStack gap="2">
                                <Text textStyle="label-sm">Server (live cache):</Text>
                                <Text>{East.str`${serverValue}`}</Text>
                            </VStack>
                            <VStack gap="2">
                                <Text textStyle="label-sm">Your staged value:</Text>
                                <Text>{East.str`${stagedValue}`}</Text>
                            </VStack>
                            <Slider value={stagedValue} min={30.0} max={60.0} step={1.0}
                                onChangeEnd={($, v) => $(staged.write(v))} />
                            <VStack gap="2">
                                <Button onClick={$ => $(direct.write(42.0))}>Simulate concurrent edit (server ← 42)</Button>
                                <Button onClick={$ => $(direct.write(38.0))}>Reset server to 38</Button>
                            </VStack>
                            <Diff bindings={[staged.binding]} hideUnchanged={some(true)} />
                        </VStack>
                    </Card>
                );
            }}</Reactive>
        );
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
// 5499.0}`. Used by `diffOverlayVariants` (the REGIONAL PRICING OVERLAY
// DRIFT row) to demonstrate what the Diff card surfaces when a server-stored
// patch was authored against an older version of its source. Conflicts (per `apply.ts` semantics):
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
 * Overlay-mode variant panel. POLICY OVERLAY: Slider edits go to
 * `max_weekly_hours_patch`, the Diff card surfaces the patch against the
 * source. REGIONAL PRICING OVERLAY DRIFT: the patch input *starts* with a
 * non-trivial patch that is stale relative to the source — what the Diff card
 * displays when a server-stored patch was authored against an older revision
 * (stale delete, stale insert, stale replace); no form components, because
 * `view.read()` calls `apply(source, patch)` which throws `ConflictError` on
 * the stale ops, while the Diff card walks the patch IR directly from cache
 * bytes (no apply) so it renders cleanly (the bind is kept so the renderer's
 * overlay-type registry knows how to decode the patch bytes). ROSTER OVERLAY
 * DRIFT: an array-of-structs patch exercising nested grouping (binding →
 * `[index]` → struct field) — only `rate` of entries 0 and 1 change, so the
 * card renders `ROSTER → [0] → rate`, `[1] → rate`. ROSTER TABLE OVERLAY:
 * the roster table editor with patches stored in `roster_patch`, surviving
 * page reload and visible to other workspace sessions.
 */
export const diffOverlayVariants = example({
    keywords: ["Diff", "bindOverlay", "Slider", "overlay", "policy", "patch", "Dict", "conflict", "drift", "roster", "array", "nested", "Table"],
    description: "Overlay variant panel — POLICY OVERLAY: Slider writes patches to a sibling e3.input, Diff shows them; REGIONAL PRICING OVERLAY DRIFT: a stale patch — the Diff card surfaces ops that don't match the source; ROSTER OVERLAY DRIFT: an overlay roster patch — the Diff card surfaces nested array-element field changes; ROSTER TABLE OVERLAY: an editable table backed by a separate patch e3.input — patches persist across sessions",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="POLICY OVERLAY" align="start" />
                <Reactive>{$ => {
                    const view = $.let(Data.bind(maxWeeklyHoursInput,
                        { mode: "direct", patch: maxWeeklyHoursPatchInput },
                    ));
                    return (
                        <Card>
                            <VStack gap="5" align="stretch">
                                <Text textStyle="heading-md">Max weekly hours (overlay)</Text>
                                <Slider value={view.read()} min={30.0} max={60.0} step={1.0}
                                    onChangeEnd={($, v) => $(view.write(v))} />
                                <Diff bindings={[view.binding]} hideUnchanged={some(true)} />
                            </VStack>
                        </Card>
                    );
                }}</Reactive>
                <Separator label="REGIONAL PRICING OVERLAY DRIFT" align="start" />
                <Reactive>{$ => {
                    const view = $.let(Data.bind(regionalPricesInput,
                        { mode: "direct", patch: regionalPricesDriftPatchInput },
                    ));
                    return (
                        <Card>
                            <VStack gap="5" align="stretch">
                                <Text textStyle="heading-md">Regional pricing — overlay with stale patch</Text>
                                <Text>{
                                    "The patch input was authored against an older source. The Diff card below "
                                    + "shows: a stale delete (MX missing from source), a stale insert (AU already "
                                    + "exists), a stale replace (US before=30 doesn't match current 39.95), and "
                                    + "one clean replace (EU 44.95 → 39.95). Apply would throw ConflictError on "
                                    + "the stale ops; this example exists to show what the Diff renderer surfaces "
                                    + "when a server-stored patch has drifted from its source."
                                }</Text>
                                <Diff bindings={[view.binding]} hideUnchanged={some(true)} />
                            </VStack>
                        </Card>
                    );
                }}</Reactive>
                <Separator label="ROSTER OVERLAY DRIFT" align="start" />
                <Reactive>{$ => {
                    const view = $.let(Data.bind(rosterInput,
                        { mode: "direct", patch: rosterDriftPatchInput },
                    ));
                    return (
                        <Card>
                            <VStack gap="5" align="stretch">
                                <Text textStyle="heading-md">Roster — overlay patch (nested)</Text>
                                <Text>{
                                    "The patch changes the hourly rate of the first two roster entries. The "
                                    + "Diff card groups each change under its array index, demonstrating the "
                                    + "binding → [index] → field nesting."
                                }</Text>
                                <Diff bindings={[view.binding]} hideUnchanged={some(true)} />
                            </VStack>
                        </Card>
                    );
                }}</Reactive>
                <Separator label="ROSTER TABLE OVERLAY" align="start" />
                <Reactive>{$ => {
                    const view = $.let(Data.bind(rosterInput,
                        { mode: "direct", patch: rosterPatchInput },
                    ));
                    const rosterArray = $.let(view.read(), RosterArrayType);
                    return (
                        <Card>
                            <VStack gap="5" align="stretch">
                                <Text textStyle="heading-md">Worker roster (overlay-mode)</Text>
                                <Text>Patches stored in a sibling dataset — survive reload, visible to other sessions.</Text>
                                <Table data={rosterArray} columns={{
                                    name: { header: "Name" },
                                    rate: {
                                        header: "Hourly rate ($)",
                                        render: East.function(
                                            [Table.Types.CellRenderContext],
                                            UIComponentType,
                                            ($, ctx) => {
                                                const idx = $.let(ctx.rowIndex, IntegerType);
                                                const row = $.let(rosterArray.get(idx), RosterEntryType);
                                                const onRateChange = $.const(East.function([FloatType], NullType, ($, v) => {
                                                    const fresh = $.let(view.read(), RosterArrayType);
                                                    const next = $.let(fresh.map(($, r, i) =>
                                                        i.equal(idx).ifElse(_$ => ({ ...r, rate: v }), _$ => r),
                                                    ), RosterArrayType);
                                                    $(view.write(next));
                                                }));
                                                return (
                                                    <Input.Float value={row.rate} min={15.0} max={80.0} step={0.25}
                                                        onChange={onRateChange} />
                                                );
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
                                                const onShiftChange = $.const(East.function([IntegerType], NullType, ($, v) => {
                                                    const fresh = $.let(view.read(), RosterArrayType);
                                                    const next = $.let(fresh.map(($, r, i) =>
                                                        i.equal(idx).ifElse(_$ => ({ ...r, shiftLength: v }), _$ => r),
                                                    ), RosterArrayType);
                                                    $(view.write(next));
                                                }));
                                                return (
                                                    <Input.Integer value={row.shiftLength} min={4n} max={12n}
                                                        onChange={onShiftChange} />
                                                );
                                            },
                                        ),
                                    },
                                }} variant="line" striped />
                                <Diff bindings={[view.binding]} hideUnchanged={some(true)} />
                            </VStack>
                        </Card>
                    );
                }}</Reactive>
            </VStack>
        );
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
 * Staged + patch variant panel. POLICY STAGED PATCH: single-Float
 * staged-with-patch editor — buffered Slider edits publish to
 * `max_weekly_hours_patch` on Apply; the source `max_weekly_hours` stays
 * untouched until a separate apply-patch-to-source step. ROSTER STAGED
 * PATCH: the roster table editor in staged + patch mode — cell edits buffer
 * in IndexedDB until Apply, which publishes a fresh patch to `roster_patch`;
 * survives reload as a draft, and multi-session reviewers see the patch only
 * after the author commits.
 */
export const diffStagedPatchVariants = example({
    keywords: ["Diff", "Slider", "staged", "patch", "publish", "policy", "Table", "roster"],
    description: "Staged + patch variant panel — POLICY STAGED PATCH: Slider edits buffered locally, Apply publishes the draft to a server-backed patch dataset; ROSTER STAGED PATCH: an editable roster whose buffered cell edits publish a fresh patch to the patch dataset on Apply",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="POLICY STAGED PATCH" align="start" />
                <Reactive>{$ => {
                    const view = $.let(Data.bind(maxWeeklyHoursInput,
                        { mode: "staged", patch: maxWeeklyHoursPatchInput },
                    ));
                    return (
                        <Card>
                            <VStack gap="5" align="stretch">
                                <Text textStyle="heading-md">Max weekly hours (staged + patch)</Text>
                                <Text>Drag to buffer locally; Apply publishes the draft as a patch to the patch dataset (source untouched).</Text>
                                <Slider value={view.read()} min={30.0} max={60.0} step={1.0}
                                    onChange={($, v) => $(view.write(v))} />
                                <Diff bindings={[view.binding]} hideUnchanged={some(true)} />
                            </VStack>
                        </Card>
                    );
                }}</Reactive>
                <Separator label="ROSTER STAGED PATCH" align="start" />
                <Reactive>{$ => {
                    const view = $.let(Data.bind(rosterInput,
                        { mode: "staged", patch: rosterPatchInput },
                    ));
                    const rosterArray = $.let(view.read(), RosterArrayType);
                    return (
                        <Card>
                            <VStack gap="5" align="stretch">
                                <Text textStyle="heading-md">Worker roster (staged + patch)</Text>
                                <Text>Edits buffer locally until Apply, which publishes a draft patch to the patch dataset for review.</Text>
                                <Table data={rosterArray} columns={{
                                    name: { header: "Name" },
                                    rate: {
                                        header: "Hourly rate ($)",
                                        render: East.function(
                                            [Table.Types.CellRenderContext],
                                            UIComponentType,
                                            ($, ctx) => {
                                                const idx = $.let(ctx.rowIndex, IntegerType);
                                                const row = $.let(rosterArray.get(idx), RosterEntryType);
                                                const onRateChange = $.const(East.function([FloatType], NullType, ($, v) => {
                                                    const fresh = $.let(view.read(), RosterArrayType);
                                                    $(view.write(fresh.map(($, r, i) =>
                                                        i.equal(idx).ifElse(_$ => ({ ...r, rate: v }), () => r),
                                                    )));
                                                }));
                                                return (
                                                    <Input.Float value={row.rate} min={15.0} max={80.0} step={0.25}
                                                        onChange={onRateChange} />
                                                );
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
                                                const onShiftChange = $.const(East.function([IntegerType], NullType, ($, v) => {
                                                    const fresh = $.let(view.read(), RosterArrayType);
                                                    $(view.write(fresh.map(($, r, i) =>
                                                        i.equal(idx).ifElse(_$ => ({ ...r, shiftLength: v }), () => r),
                                                    )));
                                                }));
                                                return (
                                                    <Input.Integer value={row.shiftLength} min={4n} max={12n}
                                                        onChange={onShiftChange} />
                                                );
                                            },
                                        ),
                                    },
                                }} variant="line" striped />
                                <Diff bindings={[view.binding]} hideUnchanged={some(true)} />
                            </VStack>
                        </Card>
                    );
                }}</Reactive>
            </VStack>
        );
    }),
    inputs: [],
});
