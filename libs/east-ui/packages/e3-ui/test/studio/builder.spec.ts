/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Studio.Builder>` (#1000): an interface the browser draws — the
 * `StudioBuilder` carrier, holding the pages record bound for its patch, the
 * listed components, the project and the publish preview's words — and its
 * surface's manifest (R4), which holds the record it writes and what its
 * components read.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    ArrayType, East, FloatType, OptionType, PatchType, SortedMap, StringType, compareFor, decodeBeast2For, none, some, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import e3 from "@elaraai/e3";
import { RecordCommitInfoType, TreePathType } from "@elaraai/e3-types";
import { Reactive, Text, UIComponentType } from "@elaraai/east-ui/internal";

import { Data, Record, RecordOutcomeType, Studio, StudioKeyType, StudioPagesType, ui } from "@elaraai/e3-ui";
import { StudioBuilderPayloadType, StudioPagesHandleType } from "@elaraai/e3-ui/internal";

type Key = ValueTypeOf<typeof Studio.Types.Key>;
type Entry = ValueTypeOf<typeof Studio.Types.Entry>;

const pathKey = (p: ValueTypeOf<typeof TreePathType>) => p.map((s) => `${s.type}:${s.value}`).join("/");

/** A dataset a component reads. */
const salesDaily = e3.input("builder_sales_daily", ArrayType(FloatType), variant("value", []));

/** A component that reads the dataset. */
const revenueTrend = Studio.component("revenue_trend", { name: "Revenue trend", category: "Charts", icon: "chart-area", span: 8n },
    East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const sales = $.let(Data.bind(salesDaily));
        return Text.Root(East.print(sales.read().size()));
    }))));

/** A frameless component that reads nothing. */
const kpiRail = Studio.component("kpi_rail", { name: "KPI rail", category: "Display", icon: "gauge-high", frame: "none" },
    East.function([], UIComponentType, (_$) => Text.Root("KPIs")));

/** The record: one page, never published. */
const PAGES = new SortedMap<Key, Entry>([
    [{ project: "ops", page: "overview" }, variant("page", {
        draft: {
            title: "Overview",
            cells: [
                { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" },
            ],
        },
        live: none,
    })],
], compareFor(StudioKeyType));

describe("<Studio.Builder> (#1000)", () => {
    test("R4: its surface's manifest holds the record it writes, and exactly what its components read", () => {
        const pages = e3.record("builder_pages", StudioPagesType, new SortedMap<Key, Entry>([], compareFor(StudioKeyType)));
        const pagesPatch = e3.mutation.patch(pages);
        const surface = ui("builder_surface", [], East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const components = $.let([revenueTrend, kpiRail]);
            const record = $.let(Record.bind(pages, [pagesPatch]));
            return Studio.Builder({ pages: record, components, project: "ops" });
        }))));
        const manifest = surface.role.value!;
        assert.deepEqual(manifest.records, ["builder_pages"]);
        assert.deepEqual(manifest.paths.map(pathKey).sort(), [
            "field:inputs/field:builder_sales_daily",
            "field:records/field:builder_pages",
        ]);
    });

    test("it is an interface the browser draws — the StudioBuilder carrier, holding the bound record, the components, the project and the preview's words; a word not given is none", () => {
        const value = East.compile(East.function([], UIComponentType, ($) => {
            const components = $.let([revenueTrend, kpiRail]);
            const record = $.let({
                read: East.function([], StudioPagesType, (_$2) => PAGES),
                history: East.function([], OptionType(ArrayType(RecordCommitInfoType)), (_$2) => none),
                commit: {
                    patch: East.asyncFunction([StringType, PatchType(StudioPagesType)], RecordOutcomeType,
                        (_$2) => variant("committed", { commitHash: "c", stateHash: "s" })),
                },
            }, StudioPagesHandleType);
            return Studio.Builder({ pages: record, components, project: "ops", env: "Staging" });
        }), [])();
        if (value.type !== "Extension") assert.fail(`expected the StudioBuilder carrier, got ${value.type}`);
        assert.equal(value.value.kind, "StudioBuilder");
        const payload = decodeBeast2For(StudioBuilderPayloadType)(value.value.payload);
        assert.deepEqual(
            [payload.project, payload.env, payload.audience, payload.rollout, payload.id],
            ["ops", some("Staging"), none, none, none]);
        assert.deepEqual(payload.components.map((component) => component.key), ["revenue_trend", "kpi_rail"]);
        assert.deepEqual(payload.pages.read().get({ project: "ops", page: "overview" }), PAGES.get({ project: "ops", page: "overview" }));
    });
});
