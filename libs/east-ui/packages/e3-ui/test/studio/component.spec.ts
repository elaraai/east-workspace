/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Studio.component` (#991): the component's struct, its `reads` from its
 * code, a surface's manifest as the union of its listed components' reads
 * (K2), a fingerprint that follows the code and nothing else (K4), and a
 * component's function as `ui()` takes it (K1). How a placement draws its
 * component — the component, a placeholder naming an unlisted key (K5), an
 * error naming a shared key (K7), two placements sharing its State (K3) — is
 * the renderers', tested in the DOM.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    ArrayType, East, FloatType, StringType, StructType, equalFor, some, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import { TreePathType } from "@elaraai/e3-types";
import { input } from "@elaraai/e3";
import { Reactive, Text, UIComponentType } from "@elaraai/east-ui/internal";

import { Data, DataManifestType, Studio, deriveManifest, fingerprintOf, ui } from "@elaraai/e3-ui";

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

    test("K4: the same code fingerprints the same wherever it is written; changed code does not", () => {
        // Built apart, with other functions built between them.
        const again = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const rows = $.let(Data.bind(sales));
            return Text.Root(East.print(rows.read().size()));
        })));
        assert.equal(fingerprintOf(again), fingerprintOf(salesFn));
        assert.equal(
            East.compile(East.function([], Studio.Types.Component, (_$) =>
                Studio.component("revenue_again", { name: "Again", category: "Charts", icon: "chart-area" }, again)), [])().fingerprint,
            East.compile(East.function([], Studio.Types.Component, (_$) => revenue), [])().fingerprint);
        // One change to the code — a different binding — changes it.
        assert.notEqual(fingerprintOf(visitsFn), fingerprintOf(salesFn));
        const counted = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const rows = $.let(Data.bind(sales));
            return Text.Root(East.print(rows.read().size().add(1n)));
        })));
        assert.notEqual(fingerprintOf(counted), fingerprintOf(salesFn));
        assert.match(fingerprintOf(salesFn), /^[0-9a-f]{64}$/);
    });
});
