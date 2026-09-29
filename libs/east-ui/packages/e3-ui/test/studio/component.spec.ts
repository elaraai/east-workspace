/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Studio.component` and the dispatcher (#991): the component's struct, its
 * `reads` from its code, a surface's manifest as the union of its listed
 * components' reads (K2), a fingerprint that follows the code and nothing else
 * (K4), a component's function as `ui()` takes it (K1), and the dispatcher's
 * three outcomes — the component, a placeholder naming an unlisted key (K5),
 * an error naming a shared key (K7).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    ArrayType, East, FloatType, IntegerType, StringType, StructType, equalFor, some, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import { TreePathType } from "@elaraai/e3-types";
import { input } from "@elaraai/e3";
import { Reactive, State, Text, UIComponentType } from "@elaraai/east-ui/internal";

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
            tags: ["finance"], collections: ["ops"], owner: "Data team", thumbnail: "kpi.png", deprecated: true,
        }, salesFn)), [])();
        assert.deepEqual(
            [v.key, v.name, v.category, v.icon, v.span, v.frame.type, v.tags, v.collections, v.deprecated],
            ["kpi_rail", "KPI rail", "Display", "gauge-high", 12n, "none", ["finance"], ["ops"], true]);
        assert.deepEqual([v.description, v.owner, v.thumbnail], [some("Revenue and orders"), some("Data team"), some("kpi.png")]);
        const d = East.compile(East.function([], Studio.Types.Component, (_$) =>
            Studio.component("plain", { name: "Plain", category: "Display", icon: "square" }, salesFn)), [])();
        assert.deepEqual(
            [d.span, d.frame.type, d.tags, d.collections, d.deprecated, d.description.type, d.owner.type, d.thumbnail.type],
            [12n, "card", [], [], false, "none", "none", "none"]);
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
            return Studio.dispatch(components, "revenue");
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

    test("the dispatcher renders the component the surface lists under the key", () => {
        const hello = Studio.component("hello", { name: "Hello", category: "Display", icon: "hand" },
            East.function([], UIComponentType, (_$) => Text.Root("Hello")));
        const ui = East.compile(East.function([], UIComponentType, ($) => {
            const components = $.let([hello, revenue]);
            return Studio.dispatch(components, "hello");
        }), [])();
        assert.equal(ui.type, "Text");
        assert.equal((ui.value as { value: string }).value, "Hello");
    });

    test("K5: a key the surface does not list renders a placeholder naming it", () => {
        const ui = East.compile(East.function([], UIComponentType, ($) => {
            const components = $.let([revenue]);
            return Studio.dispatch(components, "retired");
        }), [])();
        assert.equal(ui.type, "EmptyState");
        const title = (ui.value as { title: ValueTypeOf<typeof UIComponentType> }).title;
        assert.equal(title.type, "Text");
        assert.equal((title.value as { value: string }).value, 'No component "retired"');
    });

    test("K7: a key two listed components share renders an error naming it", () => {
        const ui = East.compile(East.function([], UIComponentType, ($) => {
            const listed = $.let(revenue);
            const components = $.let([listed, traffic, listed]);
            return Studio.dispatch(components, "revenue");
        }), [])();
        assert.equal(ui.type, "Banner");
        const banner = ui.value as { status: { type: string }; title: ValueTypeOf<typeof UIComponentType> };
        assert.equal(banner.status.type, "error");
        assert.equal((banner.title.value as { value: string }).value, 'Two components share the key "revenue"');
    });

    test("K3: every placement of a component is its one function's UI — its State keys with it", () => {
        const counter = Studio.component("counter", { name: "Counter", category: "Display", icon: "gauge-high" },
            East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
                const n = $.let(State.bind([IntegerType], "studio-spec.counter", 0n));
                return Text.Root(East.print(n.read()));
            }))));
        // Each placement calls the component's own function; the DOM test shows two sharing a write.
        const alone = East.compile(East.function([], UIComponentType, ($) => {
            const components = $.let([counter]);
            return Studio.dispatch(components, "counter");
        }), [])();
        const listed = East.compile(East.function([], UIComponentType, ($) => {
            const components = $.let([counter, revenue]);
            return Studio.dispatch(components, "counter");
        }), [])();
        assert.deepEqual([alone.type, listed.type], ["ReactiveComponent", "ReactiveComponent"]);
    });
});
