/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A page's filters and selections (#1673): `Studio.Types.Filter` — a jq
 * condition on one listed source's rows — the list a page holds of them, the
 * groups a reader clicked on each placement, and the UI-store keys both are
 * kept under: the page's, one a page and apart for every page.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { decodeBeast2For, encodeBeast2For, equalFor, isValueOf, none, parseJq, some, variant, type JqNode } from "@elaraai/east";
import { Studio } from "@elaraai/e3-ui";
import {
    StudioClickedType, StudioFiltersType, StudioPickType, StudioSelectionsType, studioFiltersKey, studioSelectionsKey,
} from "@elaraai/e3-ui/internal";

/** A jq expression, parsed: a condition over one row, or a literal. */
function jq(text: string): JqNode {
    const parsed = parseJq(text);
    if (parsed.program.type === "none") assert.fail(`does not parse: ${text}`);
    return parsed.program.value;
}

describe("A page's filters and selections (#1673)", () => {
    test("a filter is a source's key and a jq condition over one of its rows; a page's filters are a list of them, kept as they are written", () => {
        const filter = { source: "orders", where: jq(`.region == "SA"`) };
        assert.ok(isValueOf(filter, Studio.Types.Filter));
        const filters = [filter, { source: "orders", where: jq(".units > 1") }, { source: "assets", where: jq(`.site == "North"`) }];
        assert.ok(isValueOf(filters, StudioFiltersType));
        const kept = decodeBeast2For(StudioFiltersType)(encodeBeast2For(StudioFiltersType)(filters));
        assert.ok(equalFor(StudioFiltersType)(kept, filters));
    });

    test("a clicked group is each field it was made on — the field, a date's bucket, and the group's key as a jq literal; a page's selections hold each placement's by its key", () => {
        const region = { field: "region", bucket: none, key: jq(`"SA"`) };
        const month = { field: "ordered_at", bucket: some(variant("month", null)), key: jq("24318") };
        assert.ok(isValueOf(region, StudioPickType));
        assert.ok(isValueOf([region, month], StudioClickedType));
        const selections = new Map([["c-regions", [[region], [region, month]]], ["c-months", []]]);
        assert.ok(isValueOf(selections, StudioSelectionsType));
        const kept = decodeBeast2For(StudioSelectionsType)(encodeBeast2For(StudioSelectionsType)(selections));
        assert.ok(equalFor(StudioSelectionsType)(kept, selections));
    });

    test("a page's filters and its selections are kept under keys of the page's own: one a page, apart from each other and from every other page's", () => {
        const overview = { project: "ops", page: "overview" };
        const detail = { project: "ops", page: "detail" };
        const keys = [studioFiltersKey(overview), studioFiltersKey(detail), studioSelectionsKey(overview), studioSelectionsKey(detail)];
        assert.equal(new Set(keys).size, 4);
        assert.equal(studioFiltersKey({ project: "ops", page: "overview" }), keys[0]);
        assert.equal(studioSelectionsKey({ project: "ops", page: "overview" }), keys[2]);
        // A project and a page whose names run together are another page's.
        assert.notEqual(studioFiltersKey({ project: "ops.overview", page: "" }), studioFiltersKey({ project: "ops", page: ".overview" }));
    });
});
