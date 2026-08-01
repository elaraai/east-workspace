/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import {
    East,
    IntegerType,
    NullType,
    StringType,
    DateTimeType,
    StructType,
    SetType,
    OptionType,
    ArrayType,
    variant,
    some,
    none,
    example,
} from "@elaraai/east";
import { Slice, UIComponentType } from "@elaraai/east-ui";
import { Button, Reactive, Text, VStack } from "@elaraai/east-ui";

// ---------------------------------------------------------------------------
// Each example below is self-contained: `UserEventType` is declared inside
// every `fn` body, and the slice config is built via `Slice.config({...})`
// so the doc extractor renders complete, runnable snippets.
// ---------------------------------------------------------------------------

export const sliceBindDefault = example({
    keywords: ["Slice", "bind", "default", "initial state"],
    description: "Slice.bind initialises to default state — no range, no filters, no breakdown",
    fn: East.function([], UIComponentType, (_$) => {
        const UserEventType = StructType({
            timestamp: DateTimeType,
            country:   StringType,
            sessions:  IntegerType,
            sku:       StringType,
        });
        return (
            <Reactive>{$ => {
                const cfg = $.let(Slice.config(UserEventType, {
                    fields: {
                        timestamp: { label: "Time"     },
                        country:   { label: "Country"  },
                        sessions:  { label: "Sessions" },
                        sku:       { label: "SKU"      },
                    },
                    rangeFieldId:      "timestamp",
                    searchFieldIds:    ["sku", "country"],
                    breakdownFieldIds: ["country"],
                }));
                const slice = $.let(Slice.bind([UserEventType], "demo.empty", cfg, Slice.state(), East.value([], ArrayType(UserEventType)), none));
                const state = $.let(slice.read(), Slice.Types.State);
                return <Text>{East.str`Filters: ${state.filters.length()} · Cohorts: ${state.activeCohorts.size()}`}</Text>;
            }}</Reactive>
        );
    }),
    inputs: [],
});

// ============================================================================
// Predicates — captioned rows, one per merged example (consolidation #455).
// ============================================================================

export const slicePredicates = example({
    keywords: ["Slice", "addFilter", "Predicate", "integer", "gte", "typed", "string", "in", "Set", "defineCohort", "Cohort", "toggleCohort", "setBreakdown", "Breakdown", "top-N", "setSearch", "Search", "OptionType", "setVisible", "Legend"],
    description: "Slice predicate panel — add integer predicate (variant('integer', {fieldId: 'sessions', op: variant('gte', 10n)})), add string in predicate (variant('string', {fieldId: 'country', op: variant('in', new Set([…]))})), define cohort (a Power users cohort with two AND-ed typed predicates), set breakdown (group by country with a top-5 limit), set search (setSearch(some(query)); clear with none), set visible (the legend's visible series whitelist as a Set of ids)",
    fn: East.function([], UIComponentType, (_$) => {
        const UserEventType = StructType({
            timestamp: DateTimeType,
            country:   StringType,
            sessions:  IntegerType,
            sku:       StringType,
        });
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">ADD INTEGER PREDICATE</Text>
                    <Reactive>{$ => {
                        const cfg = $.let(Slice.config(UserEventType, {
                            fields: {
                                timestamp: { label: "Time"     },
                                country:   { label: "Country"  },
                                sessions:  { label: "Sessions" },
                                sku:       { label: "SKU"      },
                            },
                            rangeFieldId:      "timestamp",
                            searchFieldIds:    ["sku", "country"],
                            breakdownFieldIds: ["country"],
                        }));
                        const slice = $.let(Slice.bind([UserEventType], "demo.filter.int", cfg, Slice.state(), East.value([], ArrayType(UserEventType)), none));
                        const onAdd = $.const(East.function([], NullType, $ => {
                            const pred = $.const(
                                variant("integer", { fieldId: "sessions", op: variant("gte", 10n) }),
                                Slice.Types.Predicate,
                            );
                            $(slice.addFilter(pred));
                        }));
                        return <Button onClick={onAdd}>Sessions ≥ 10</Button>;
                    }}</Reactive>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">ADD STRING IN PREDICATE</Text>
                    <Reactive>{$ => {
                        const cfg = $.let(Slice.config(UserEventType, {
                            fields: {
                                timestamp: { label: "Time"     },
                                country:   { label: "Country"  },
                                sessions:  { label: "Sessions" },
                                sku:       { label: "SKU"      },
                            },
                            rangeFieldId:      "timestamp",
                            searchFieldIds:    ["sku", "country"],
                            breakdownFieldIds: ["country"],
                        }));
                        const slice = $.let(Slice.bind([UserEventType], "demo.filter.str", cfg, Slice.state(), East.value([], ArrayType(UserEventType)), none));
                        const onAdd = $.const(East.function([], NullType, $ => {
                            const pred = $.const(
                                variant("string", {
                                    fieldId: "country",
                                    op:      variant("in", new Set(["US", "UK", "DE"])),
                                }),
                                Slice.Types.Predicate,
                            );
                            $(slice.addFilter(pred));
                        }));
                        return <Button onClick={onAdd}>{"Country ∈ {US, UK, DE}"}</Button>;
                    }}</Reactive>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">DEFINE COHORT</Text>
                    <Reactive>{$ => {
                        const cfg = $.let(Slice.config(UserEventType, {
                            fields: {
                                timestamp: { label: "Time"     },
                                country:   { label: "Country"  },
                                sessions:  { label: "Sessions" },
                                sku:       { label: "SKU"      },
                            },
                            rangeFieldId:      "timestamp",
                            searchFieldIds:    ["sku", "country"],
                            breakdownFieldIds: ["country"],
                        }));
                        const slice = $.let(Slice.bind([UserEventType], "demo.cohort", cfg, Slice.state(), East.value([], ArrayType(UserEventType)), none));
                        const onDefine = $.const(East.function([], NullType, $ => {
                            const cohort = $.const({
                                id:   "power-users",
                                name: "Power users",
                                filters: [
                                    variant("integer", { fieldId: "sessions", op: variant("gte", 10n) }),
                                    variant("string",  { fieldId: "country",  op: variant("eq",  "US") }),
                                ],
                            }, Slice.Types.Cohort);
                            $(slice.defineCohort(cohort));
                        }));
                        const onToggle = $.const(East.function([], NullType, $ => {
                            $(slice.toggleCohort("power-users"));
                        }));
                        return (
                            <VStack gap="2" align="stretch">
                                <Button onClick={onDefine}>Define Power users</Button>
                                <Button onClick={onToggle}>Toggle Power users</Button>
                            </VStack>
                        );
                    }}</Reactive>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">SET BREAKDOWN</Text>
                    <Reactive>{$ => {
                        const cfg = $.let(Slice.config(UserEventType, {
                            fields: {
                                timestamp: { label: "Time"     },
                                country:   { label: "Country"  },
                                sessions:  { label: "Sessions" },
                                sku:       { label: "SKU"      },
                            },
                            rangeFieldId:      "timestamp",
                            searchFieldIds:    ["sku", "country"],
                            breakdownFieldIds: ["country"],
                        }));
                        const slice = $.let(Slice.bind([UserEventType], "demo.breakdown", cfg, Slice.state(), East.value([], ArrayType(UserEventType)), none));
                        const onClick = $.const(East.function([], NullType, $ => {
                            const b = $.const(
                                some({ fieldId: "country", limit: some(5n) }),
                                OptionType(Slice.Types.Breakdown),
                            );
                            $(slice.setBreakdown(b));
                        }));
                        return <Button onClick={onClick}>Break by country (top 5)</Button>;
                    }}</Reactive>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">SET SEARCH</Text>
                    <Reactive>{$ => {
                        const cfg = $.let(Slice.config(UserEventType, {
                            fields: {
                                timestamp: { label: "Time"     },
                                country:   { label: "Country"  },
                                sessions:  { label: "Sessions" },
                                sku:       { label: "SKU"      },
                            },
                            rangeFieldId:      "timestamp",
                            searchFieldIds:    ["sku", "country"],
                            breakdownFieldIds: ["country"],
                        }));
                        const slice = $.let(Slice.bind([UserEventType], "demo.search", cfg, Slice.state(), East.value([], ArrayType(UserEventType)), none));
                        const onSet = $.const(East.function([], NullType, $ => {
                            const q = $.const(some("SKU-001"), OptionType(StringType));
                            $(slice.setSearch(q));
                        }));
                        const onClear = $.const(East.function([], NullType, $ => {
                            const q = $.const(none, OptionType(StringType));
                            $(slice.setSearch(q));
                        }));
                        return (
                            <VStack gap="2" align="stretch">
                                <Button onClick={onSet}>Search SKU-001</Button>
                                <Button onClick={onClear}>Clear</Button>
                            </VStack>
                        );
                    }}</Reactive>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">SET VISIBLE</Text>
                    <Reactive>{$ => {
                        const cfg = $.let(Slice.config(UserEventType, {
                            fields: {
                                timestamp: { label: "Time"     },
                                country:   { label: "Country"  },
                                sessions:  { label: "Sessions" },
                                sku:       { label: "SKU"      },
                            },
                            rangeFieldId:      "timestamp",
                            searchFieldIds:    ["sku", "country"],
                            breakdownFieldIds: ["country"],
                        }));
                        const slice = $.let(Slice.bind([UserEventType], "demo.visible", cfg, Slice.state(), East.value([], ArrayType(UserEventType)), none));
                        const onClick = $.const(East.function([], NullType, $ => {
                            const v = $.const(
                                some(new Set(["US", "UK"])),
                                OptionType(SetType(StringType)),
                            );
                            $(slice.setVisible(v));
                        }));
                        return <Button onClick={onClick}>Show only US and UK</Button>;
                    }}</Reactive>
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Ranges — captioned rows, one per merged example (consolidation #455).
// ============================================================================

export const sliceRanges = example({
    keywords: ["Slice", "setRange", "Range", "datetimePreset", "datetime", "custom", "integer", "numeric slider"],
    description: "Slice range panel — set range preset (variant('datetimePreset', variant('last30d', null))), set range custom date time (a pinned variant('datetime', {from, to})), set range integer (sessions between 5 and 100)",
    fn: East.function([], UIComponentType, (_$) => {
        const UserEventType = StructType({
            timestamp: DateTimeType,
            country:   StringType,
            sessions:  IntegerType,
            sku:       StringType,
        });
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">SET RANGE PRESET</Text>
                    <Reactive>{$ => {
                        const cfg = $.let(Slice.config(UserEventType, {
                            fields: {
                                timestamp: { label: "Time"     },
                                country:   { label: "Country"  },
                                sessions:  { label: "Sessions" },
                                sku:       { label: "SKU"      },
                            },
                            rangeFieldId:      "timestamp",
                            searchFieldIds:    ["sku", "country"],
                            breakdownFieldIds: ["country"],
                        }));
                        const slice = $.let(Slice.bind([UserEventType], "demo.range.preset", cfg, Slice.state(), East.value([], ArrayType(UserEventType)), none));
                        const onClick = $.const(East.function([], NullType, $ => {
                            const r = $.const(
                                some(variant("datetimePreset", variant("last30d", null))),
                                OptionType(Slice.Types.Range),
                            );
                            $(slice.setRange(r));
                        }));
                        return <Button onClick={onClick}>Last 30 days</Button>;
                    }}</Reactive>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">SET RANGE CUSTOM DATE TIME</Text>
                    <Reactive>{$ => {
                        const cfg = $.let(Slice.config(UserEventType, {
                            fields: {
                                timestamp: { label: "Time"     },
                                country:   { label: "Country"  },
                                sessions:  { label: "Sessions" },
                                sku:       { label: "SKU"      },
                            },
                            rangeFieldId:      "timestamp",
                            searchFieldIds:    ["sku", "country"],
                            breakdownFieldIds: ["country"],
                        }));
                        const slice = $.let(Slice.bind([UserEventType], "demo.range.dt", cfg, Slice.state(), East.value([], ArrayType(UserEventType)), none));
                        const onClick = $.const(East.function([], NullType, $ => {
                            const r = $.const(
                                some(variant("datetime", {
                                    from: new Date("2025-01-01T00:00:00Z"),
                                    to:   new Date("2025-03-31T23:59:59Z"),
                                })),
                                OptionType(Slice.Types.Range),
                            );
                            $(slice.setRange(r));
                        }));
                        return <Button onClick={onClick}>Q1 2025</Button>;
                    }}</Reactive>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">SET RANGE INTEGER</Text>
                    <Reactive>{$ => {
                        const cfg = $.let(Slice.config(UserEventType, {
                            fields: {
                                timestamp: { label: "Time"     },
                                country:   { label: "Country"  },
                                sessions:  { label: "Sessions" },
                                sku:       { label: "SKU"      },
                            },
                            rangeFieldId:      "timestamp",
                            searchFieldIds:    ["sku", "country"],
                            breakdownFieldIds: ["country"],
                        }));
                        const slice = $.let(Slice.bind([UserEventType], "demo.range.int", cfg, Slice.state(), East.value([], ArrayType(UserEventType)), none));
                        const onClick = $.const(East.function([], NullType, $ => {
                            const r = $.const(
                                some(variant("integer", { from: 5n, to: 100n })),
                                OptionType(Slice.Types.Range),
                            );
                            $(slice.setRange(r));
                        }));
                        return <Button onClick={onClick}>Sessions 5–100</Button>;
                    }}</Reactive>
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});
