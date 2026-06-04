/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
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
import {
    Button,
    Reactive,
    Slice,
    Stack,
    Text,
    UIComponentType,
} from "@elaraai/east-ui";

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
        return Reactive.Root(East.function([], UIComponentType, $ => {
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
            return Text.Root(East.str`Filters: ${state.filters.length()} · Cohorts: ${state.activeCohorts.size()}`);
        }));
    }),
    inputs: [],
});

export const sliceAddIntegerPredicate = example({
    keywords: ["Slice", "addFilter", "Predicate", "integer", "gte", "typed"],
    description: "Typed nested predicate: variant('integer', {fieldId: 'sessions', op: variant('gte', 10n)})",
    fn: East.function([], UIComponentType, (_$) => {
        const UserEventType = StructType({
            timestamp: DateTimeType,
            country:   StringType,
            sessions:  IntegerType,
            sku:       StringType,
        });
        return Reactive.Root(East.function([], UIComponentType, $ => {
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
            return Button.Root("Sessions ≥ 10", { onClick: onAdd });
        }));
    }),
    inputs: [],
});

export const sliceAddStringInPredicate = example({
    keywords: ["Slice", "addFilter", "Predicate", "string", "in", "Set"],
    description: "Typed nested predicate: variant('string', {fieldId: 'country', op: variant('in', new Set([…]))})",
    fn: East.function([], UIComponentType, (_$) => {
        const UserEventType = StructType({
            timestamp: DateTimeType,
            country:   StringType,
            sessions:  IntegerType,
            sku:       StringType,
        });
        return Reactive.Root(East.function([], UIComponentType, $ => {
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
            return Button.Root("Country ∈ {US, UK, DE}", { onClick: onAdd });
        }));
    }),
    inputs: [],
});

export const sliceSetRangePreset = example({
    keywords: ["Slice", "setRange", "Range", "datetimePreset"],
    description: "Activate a datetime preset range — variant('datetimePreset', variant('last30d', null))",
    fn: East.function([], UIComponentType, (_$) => {
        const UserEventType = StructType({
            timestamp: DateTimeType,
            country:   StringType,
            sessions:  IntegerType,
            sku:       StringType,
        });
        return Reactive.Root(East.function([], UIComponentType, $ => {
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
            return Button.Root("Last 30 days", { onClick });
        }));
    }),
    inputs: [],
});

export const sliceSetRangeCustomDateTime = example({
    keywords: ["Slice", "setRange", "Range", "datetime", "custom"],
    description: "Activate a pinned datetime range — variant('datetime', {from, to})",
    fn: East.function([], UIComponentType, (_$) => {
        const UserEventType = StructType({
            timestamp: DateTimeType,
            country:   StringType,
            sessions:  IntegerType,
            sku:       StringType,
        });
        return Reactive.Root(East.function([], UIComponentType, $ => {
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
            return Button.Root("Q1 2025", { onClick });
        }));
    }),
    inputs: [],
});

export const sliceSetRangeInteger = example({
    keywords: ["Slice", "setRange", "Range", "integer", "numeric slider"],
    description: "Activate an integer range — sessions between 5 and 100",
    fn: East.function([], UIComponentType, (_$) => {
        const UserEventType = StructType({
            timestamp: DateTimeType,
            country:   StringType,
            sessions:  IntegerType,
            sku:       StringType,
        });
        return Reactive.Root(East.function([], UIComponentType, $ => {
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
            return Button.Root("Sessions 5–100", { onClick });
        }));
    }),
    inputs: [],
});

export const sliceDefineCohort = example({
    keywords: ["Slice", "defineCohort", "Cohort", "toggleCohort", "typed"],
    description: "Define a Power users cohort with two AND-ed typed predicates",
    fn: East.function([], UIComponentType, (_$) => {
        const UserEventType = StructType({
            timestamp: DateTimeType,
            country:   StringType,
            sessions:  IntegerType,
            sku:       StringType,
        });
        return Reactive.Root(East.function([], UIComponentType, $ => {
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
            return Stack.VStack([
                Button.Root("Define Power users", { onClick: onDefine }),
                Button.Root("Toggle Power users", { onClick: onToggle }),
            ], { gap: "2", align: "stretch" });
        }));
    }),
    inputs: [],
});

export const sliceSetBreakdown = example({
    keywords: ["Slice", "setBreakdown", "Breakdown", "top-N"],
    description: "Group by country with a top-5 limit",
    fn: East.function([], UIComponentType, (_$) => {
        const UserEventType = StructType({
            timestamp: DateTimeType,
            country:   StringType,
            sessions:  IntegerType,
            sku:       StringType,
        });
        return Reactive.Root(East.function([], UIComponentType, $ => {
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
            return Button.Root("Break by country (top 5)", { onClick });
        }));
    }),
    inputs: [],
});

export const sliceSetSearch = example({
    keywords: ["Slice", "setSearch", "Search", "OptionType"],
    description: "Activate text search with setSearch(some(query)); clear with none",
    fn: East.function([], UIComponentType, (_$) => {
        const UserEventType = StructType({
            timestamp: DateTimeType,
            country:   StringType,
            sessions:  IntegerType,
            sku:       StringType,
        });
        return Reactive.Root(East.function([], UIComponentType, $ => {
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
            return Stack.VStack([
                Button.Root("Search SKU-001", { onClick: onSet }),
                Button.Root("Clear", { onClick: onClear }),
            ], { gap: "2", align: "stretch" });
        }));
    }),
    inputs: [],
});

export const sliceSetVisible = example({
    keywords: ["Slice", "setVisible", "Legend", "Set"],
    description: "Restrict the legend's visible series whitelist to a Set of ids",
    fn: East.function([], UIComponentType, (_$) => {
        const UserEventType = StructType({
            timestamp: DateTimeType,
            country:   StringType,
            sessions:  IntegerType,
            sku:       StringType,
        });
        return Reactive.Root(East.function([], UIComponentType, $ => {
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
            return Button.Root("Show only US and UK", { onClick });
        }));
    }),
    inputs: [],
});
