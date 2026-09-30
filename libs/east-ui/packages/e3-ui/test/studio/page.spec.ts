/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Studio.Page>` (#993): an interface the browser draws — the `StudioPage`
 * carrier, holding the pages record's value, the listed components, the page's
 * key and which of its layouts to draw — and its surface's manifest (R4),
 * which reads the record, writes nothing, and holds exactly what its
 * components read.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    ArrayType, East, FloatType, SortedMap, compareFor, decodeBeast2For, none, some, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import e3 from "@elaraai/e3";
import { TreePathType } from "@elaraai/e3-types";
import { Reactive, Text, UIComponentType } from "@elaraai/east-ui/internal";

import { Data, Studio, StudioKeyType, StudioPagesType, ui } from "@elaraai/e3-ui";
import { StudioPagePayloadType } from "@elaraai/e3-ui/internal";

type Key = ValueTypeOf<typeof Studio.Types.Key>;
type Entry = ValueTypeOf<typeof Studio.Types.Entry>;
type UI = ValueTypeOf<typeof UIComponentType>;

const keys = compareFor(StudioKeyType);
const pathKey = (p: ValueTypeOf<typeof TreePathType>) => p.map((s) => `${s.type}:${s.value}`).join("/");

/** The record: the Overview, live and drafted since. */
const PAGES = new SortedMap<Key, Entry>([
    [{ project: "ops", page: "overview" }, variant("page", {
        draft: {
            title: "Overview",
            cells: [
                { key: "c-note", row: "r1", span: 6n, height: none, align: variant("top", null), title: none, component: "note", fingerprint: "" },
            ],
        },
        live: some({
            version: 1n,
            page: {
                title: "Overview",
                cells: [
                    { key: "c-note", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "note", fingerprint: "" },
                ],
            },
        }),
    })],
], keys);

/** A component that reads nothing. */
const note = Studio.component("note", { name: "Note", category: "Display", icon: "note-sticky" },
    East.function([], UIComponentType, (_$) => Text.Root("A note's text")));

/** The StudioPage carrier's payload, decoded as its renderer decodes it. */
const payloadOf = (value: UI) => {
    if (value.type !== "Extension") assert.fail(`expected the StudioPage carrier, got ${value.type}`);
    assert.equal(value.value.kind, "StudioPage");
    return decodeBeast2For(StudioPagePayloadType)(value.value.payload);
};

describe("<Studio.Page> (#993)", () => {
    test("R4: its surface's manifest holds the record's path and no write, and exactly what its components read", () => {
        const visits = e3.input("studio_page_visits", ArrayType(FloatType), variant("value", []));
        const pages = e3.record("studio_page_record", StudioPagesType, new SortedMap<Key, Entry>([], keys));
        const surface = ui("studio_page_surface", [], East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const components = $.let([
                Studio.component("traffic", { name: "Traffic", category: "Charts", icon: "chart-line" },
                    East.function([], UIComponentType, (_$2) => Reactive.Root(East.function([], UIComponentType, ($2) => {
                        const days = $2.let(Data.bind(visits));
                        return Text.Root(East.print(days.read().size()));
                    })))),
            ]);
            const all = $.let(Data.bind(pages));
            return Studio.Page({ pages: all.read(), components, page: { project: "ops", page: "overview" } });
        }))));
        const manifest = surface.role.value!;
        assert.deepEqual(manifest.records, []);
        assert.deepEqual(manifest.paths.map(pathKey).sort(), ["field:inputs/field:studio_page_visits", "field:records/field:studio_page_record"]);
    });

    test("it is an interface the browser draws — the StudioPage carrier, holding the record's value, the components, the page and its version: the live one unless the draft is asked for", () => {
        const live = payloadOf(East.compile(East.function([], UIComponentType, ($) => {
            const components = $.let([note]);
            return Studio.Page({ pages: PAGES, components, page: { project: "ops", page: "overview" } });
        }), [])());
        assert.deepEqual(live.page, { project: "ops", page: "overview" });
        assert.deepEqual(live.version, variant("live", null));
        assert.deepEqual(live.components.map((component) => component.key), ["note"]);
        assert.deepEqual(live.pages.get({ project: "ops", page: "overview" }), PAGES.get({ project: "ops", page: "overview" }));

        const draft = payloadOf(East.compile(East.function([], UIComponentType, ($) => {
            const components = $.let([note]);
            return Studio.Page({ pages: PAGES, components, page: { project: "ops", page: "overview" }, version: "draft" });
        }), [])());
        assert.deepEqual(draft.version, variant("draft", null));
    });
});
