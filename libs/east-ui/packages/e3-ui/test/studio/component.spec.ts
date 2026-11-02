/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Studio.component` (#991): the component's struct, its `reads` from its
 * code, a surface's manifest as the union of its listed components' reads
 * (K2), a component's function as `ui()` takes it (K1), and what it reads
 * named in words, never a keypath (B3, B9, B17). How a placement draws its
 * component — the component, a placeholder naming an unlisted key (K5), an
 * error naming a shared key (K7), two placements sharing its State (K3) — is
 * the renderers', tested in the DOM.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";

import {
    ArrayType, East, FloatType, StringType, StructType, equalFor, some, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import { TreePathType } from "@elaraai/e3-types";
import { input } from "@elaraai/e3";
import { Reactive, Text, UIComponentType } from "@elaraai/east-ui/internal";

import { Data, DataManifestType, Studio, deriveManifest, ui } from "@elaraai/e3-ui";
import { dataName, readNames } from "@elaraai/e3-ui/internal";

const manifestEqual = equalFor(DataManifestType);
const pathKey = (p: ValueTypeOf<typeof TreePathType>) => p.map((s) => `${s.type}:${s.value}`).join("/");

const Sale = StructType({ day: StringType, revenue: FloatType });
const sales = input("studio_sales", ArrayType(Sale), variant("value", []));
const visits = input("studio_visits", ArrayType(FloatType), variant("value", []));

/** A component over the sales. */
const salesFn = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const rows = $.let(Data.bind(sales));
    return Text.Root(East.print(rows.read().size()));
})));
/** A component over the visits. */
const visitsFn = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const days = $.let(Data.bind(visits));
    return Text.Root(East.print(days.read().size()));
})));

const revenue = Studio.component("revenue", { name: "Revenue", category: "Charts", icon: "chart-area", span: 8n }, salesFn);
const traffic = Studio.component("traffic", { name: "Traffic", category: "Charts", icon: "chart-line" }, visitsFn);

describe("Studio.component (#991)", () => {
    test("builds the component: the meta as given, and the defaults filled in", () => {
        const v = East.compile(East.function([], Studio.Types.Component, (_$) => Studio.component("kpi_rail", {
            name: "KPI rail", category: "Display", icon: "gauge-high", description: "Revenue and orders", frame: "none",
            tags: ["finance"], collections: ["ops"], deprecated: true,
        }, salesFn)), [])();
        assert.deepEqual(
            [v.key, v.name, v.category, v.icon, v.span, v.frame.type, v.tags, v.collections, v.deprecated],
            ["kpi_rail", "KPI rail", "Display", "gauge-high", 12n, "none", ["finance"], ["ops"], true]);
        assert.deepEqual(v.description, some("Revenue and orders"));
        const d = East.compile(East.function([], Studio.Types.Component, (_$) =>
            Studio.component("plain", { name: "Plain", category: "Display", icon: "square" }, salesFn)), [])();
        assert.deepEqual(
            [d.span, d.frame.type, d.tags, d.collections, d.deprecated, d.description.type],
            [12n, "card", [], [], false, "none"]);
        assert.equal(East.compile(East.function([], Studio.Types.Component, (_$) => revenue), [])().span, 8n);
    });

    test("its reads are what its code binds — deriveManifest over its function", () => {
        const v = East.compile(East.function([], Studio.Types.Component, (_$) => revenue), [])();
        assert.ok(manifestEqual(v.reads, deriveManifest(salesFn)));
        assert.deepEqual(v.reads.paths.map(pathKey), ["field:inputs/field:studio_sales"]);
    });

    test("K2: a surface's ui() manifest holds every path its listed components read, and no other", () => {
        const surface = ui("studio_surface", [], East.function([], UIComponentType, ($) => {
            const components = $.let([revenue, traffic]);
            const pages = $.let(new Map(), Studio.Types.Pages);
            return Studio.Page({ pages, components, page: { project: "ops", page: "overview" } });
        }));
        const paths = surface.role.value!.paths.map(pathKey).sort();
        assert.deepEqual(paths, ["field:inputs/field:studio_sales", "field:inputs/field:studio_visits"]);
    });

    test("K1: a component's function is exactly what ui() takes", () => {
        const task = ui("studio_component_as_ui", [], salesFn);
        assert.ok(manifestEqual(task.role.value!, East.compile(East.function([], Studio.Types.Component, (_$) => revenue), [])().reads));
    });
});

/** A path of fields, as e3 holds one. */
const pathOf = (...fields: string[]) => fields.map((field) => variant("field", field));

describeEast("What a component reads, in words — never a keypath (B3, B9, B17)", (test) => {
    test("data by its own name, a task's output by its task's: each word apart, the first upper case", $ => {
        $(Assert.equal(dataName(pathOf("inputs", "sales_daily")), "Sales daily"));
        $(Assert.equal(dataName(pathOf("tasks", "weeklyForecast", "output")), "Weekly forecast"));
        $(Assert.equal(dataName(pathOf("records", "work-orders")), "Work orders"));
        $(Assert.equal(dataName(pathOf("inputs", "_scrap__rate_")), "Scrap rate"));
    });

    test("a component's reads, each named so; one that reads nothing names none", $ => {
        $(Assert.equal(readNames(revenue.reads), ["Studio sales"]));
        const note = $.let(Studio.component("note", { name: "Note", category: "Display", icon: "note-sticky" },
            East.function([], UIComponentType, (_$) => Text.Root("A note"))));
        $(Assert.equal(readNames(note.reads), []));
    });
}, { platformFns: TestImpl });
