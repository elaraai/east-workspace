/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Schematic kind read by area (#1393, `Schematic Builder Spec.md` §10.4,
 * §11.4): which area index and which searches a window reads — one whose `on`
 * the rail's exact choices fill while its searches stay within the record
 * slice's bound on landed searches, else the one led by no field, the
 * narrowing left to `within` (SC34); an area index whose box isn't the kind's
 * roles, and a kind read by area with no area index led by no field, each
 * refused naming what to declare (SC34); the density's raster, a combination
 * of the leading values at a time, within its budget, and the cells of it that
 * hold rows (D25); how a kind read by area reads its rows with no position,
 * its Backlog's (D51); and the floor of 20,000 racks read a window at a time,
 * its examples run — the floor, and the same in a phone-width frame.
 */

import { test as hostTest } from "node:test";
import assert from "node:assert/strict";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { ArrayType, decodeBeast2For, encodeBeast2For, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { AREA_FIELD, AREA_UNPLACED, MAX_AREA_RASTER, MAX_LANDED_SEARCHES, RecordSliceIndexType, RecordSliceWhereType, areaQueries } from "@elaraai/east-ui/internal";
import {
    SCHEMATIC_WINDOW_READ_ROWS, SCHEMATIC_WINDOW_ROWS, schematicAreaIndexes, schematicDensityCells, schematicRaster, schematicUnplacedPlan, schematicWindowPlan,
} from "@elaraai/e3-ui/internal";
import * as rec from "./schematic-records.examples.js";

describeEast("Schematic reading by area", (test) => {
    Assert.examples(test, {
        schematicRecordIndexes: rec.schematicRecordIndexes,
        schematicRecordIndexesMobile: rec.schematicRecordIndexesMobile,
    });
}, { platformFns: TestImpl });

type Where = ValueTypeOf<typeof RecordSliceWhereType>;
type Choice = Where extends Map<string, infer C> ? C : never;

const indexType = ArrayType(RecordSliceIndexType);
/** The racks' box, as an area index over them names it: placed by their centre, at a cell of 2⁻⁷ m. */
const rackBox = { x: "x", y: "y", width: some("w"), height: some("h"), centre: true, cell: 2 ** -7, optional: false };
const indexes = decodeBeast2For(indexType)(encodeBeast2For(indexType)([
    { name: "racks_by_model", fields: ["model"], sets: new Set(), structured: false, interval: none, area: none, series: none, summary: none },
    { name: "racks_by_area", fields: [AREA_FIELD], sets: new Set(), structured: true, interval: none, area: some(rackBox), series: none, summary: none },
    { name: "racks_by_hall_area", fields: ["hall", AREA_FIELD], sets: new Set(), structured: true, interval: none, area: some(rackBox), series: none, summary: none },
    { name: "racks_by_tag_area", fields: ["tags", AREA_FIELD], sets: new Set(["tags"]), structured: true, interval: none, area: some(rackBox), series: none, summary: none },
]));
const [byModel, , byHallArea] = indexes;
/** The racks' kind's roles: its box's fields. */
const roles = { x: "x", y: "y", width: some("w"), height: some("h") };
const view = { minX: 0, minY: 0, maxX: 40, maxY: 30 };
const values = (...choices: string[]): Choice => variant("values", choices);
/** A narrowing decoded at the runtime boundary, as the rail's arrives. */
function where(entries: [string, Choice][] = []): Where {
    return decodeBeast2For(RecordSliceWhereType)(encodeBeast2For(RecordSliceWhereType)(new Map(entries)));
}
const areas = schematicAreaIndexes(indexes, roles, "items", "Schematic.items: \"Rack\"")!;
/** The plan's index's name, its prefixes and the fields it leaves to `within`. */
function planned(narrowing: Where) {
    const plan = schematicWindowPlan(areas, narrowing, view);
    return { index: plan.index.name, prefixes: plan.prefixes, residual: plan.residual };
}

hostTest("a source listing no area index reads its kind complete; one listing area indexes reads it by area, through the one led by no field and those led beside it (§10.4)", () => {
    assert.equal(schematicAreaIndexes([byModel!], roles, "items", "racks"), undefined);
    assert.equal(areas.unled.name, "racks_by_area");
    assert.deepEqual(areas.led.map((index) => index.name), ["racks_by_hall_area", "racks_by_tag_area"]);
});

hostTest("a window reads through the area index whose `on` the rail's exact choices fill, a combination at a time; otherwise through the one led by no field, the narrowing left to `within` (SC34)", () => {
    assert.deepEqual(planned(where()), { index: "racks_by_area", prefixes: [[]], residual: [] }, "no narrowing: the window alone");
    assert.deepEqual(planned(where([["hall", values('"Hall 1"', '"Hall 2"')]])),
        { index: "racks_by_hall_area", prefixes: [['"Hall 1"'], ['"Hall 2"']], residual: [] }, "the halls and the window in one read");
    assert.deepEqual(planned(where([["hall", values('"Hall 1"')], ["model", values('"42U"')]])),
        { index: "racks_by_hall_area", prefixes: [['"Hall 1"']], residual: ["model"] }, "the hall led, the model left to `within`");
    assert.deepEqual(planned(where([["tags", values('"cold"')]])), { index: "racks_by_tag_area", prefixes: [['"cold"']], residual: [] }, "a Set field's one value");
    assert.deepEqual(planned(where([["tags", values('"cold"', '"hot"')]])), { index: "racks_by_area", prefixes: [[]], residual: ["tags"] },
        "two values of a Set field fan out: no led read");
    assert.deepEqual(planned(where([["model", values('"42U"')]])), { index: "racks_by_area", prefixes: [[]], residual: ["model"] }, "a choice no area index leads");
    assert.deepEqual(planned(where([["hall", variant("prefix", "Hall")]])), { index: "racks_by_area", prefixes: [[]], residual: ["hall"] },
        "a prefix is no exact choice");
});

hostTest("past the record slice's bound on landed searches across its choices, a window reads through the index led by no field (SC34)", () => {
    const each = areaQueries([], view, rackBox.cell).length;
    const most = Math.floor(MAX_LANDED_SEARCHES / each);
    const halls = (n: number) => Array.from({ length: n }, (_, i) => `"Hall ${i + 1}"`);
    assert.ok(most >= 1 && most < 64, `${each} searches a hall`);
    assert.equal(planned(where([["hall", values(...halls(most))]])).index, "racks_by_hall_area", `${most} halls stay within ${MAX_LANDED_SEARCHES} searches`);
    assert.deepEqual(planned(where([["hall", values(...halls(most + 1))]])), { index: "racks_by_area", prefixes: [[]], residual: ["hall"] },
        `${most + 1} halls would ask more than ${MAX_LANDED_SEARCHES}: the window alone, the halls by \`within\``);
});

hostTest("a kind read by area with no area index led by no field is refused, naming the index to declare (SC34)", () => {
    assert.throws(() => schematicAreaIndexes([byModel!, byHallArea!], roles, "items", "Schematic.items: \"Rack\""),
        /^Error: Schematic\.items: "Rack": a kind read by area reads its window through an area index led by no field, whatever the rail chooses, and 'racks_by_hall_area' is led by fields — declare e3\.recordIndex\.area\(name, record, \{ x: "x", y: "y", width: "w", height: "h", at: "centre", cell \}\) beside it, and list it in Data\.bindPaged's indexes$/);
});

hostTest("an area index whose box isn't the kind's roles is refused as it reads, naming both (SC34)", () => {
    assert.throws(() => schematicAreaIndexes(indexes, { ...roles, width: some("depth") }, "items", "Schematic.items: \"Rack\""),
        /^Error: Schematic\.items: "Rack": the area index 'racks_by_area' boxes each row by \{ x: "x", y: "y", width: "w", height: "h", at: "centre" \}, and the kind's roles place it by \{ x: "x", y: "y", width: "depth", height: "h", at: "centre" \} — an area index the kind is read by boxes each row as its roles place it/);
    assert.throws(() => schematicAreaIndexes(indexes, roles, "zones", "Schematic.zones: \"Hall\""),
        /the area index 'racks_by_area' boxes each row by \{ x: "x", y: "y", width: "w", height: "h", at: "centre" \}, and the kind's roles place it by \{ x: "x", y: "y", width: "w", height: "h", at: "corner" \}/,
        "a zone is placed by its corner");
    assert.throws(() => schematicAreaIndexes(indexes, { x: "x", y: "y", width: none, height: none }, "items", "Schematic.items: \"Pin\""),
        /and the kind's roles place it by \{ x: "x", y: "y", at: "centre" \}/, "a kind of points, and an index of boxes");
});

hostTest("the density's raster is each combination of the leading values', all at one level, within the counted ranges of one request (D25)", () => {
    // Past 5,000 rows in view the density draws; a window reads its rows while its searches hold four views' worth at most.
    assert.equal(SCHEMATIC_WINDOW_ROWS, 5_000);
    assert.equal(SCHEMATIC_WINDOW_READ_ROWS, 4 * SCHEMATIC_WINDOW_ROWS);
    const plan = schematicWindowPlan(areas, where([["hall", values('"Hall 1"', '"Hall 2"')]]), view);
    const raster = schematicRaster(plan, view);
    assert.equal(raster.cells.length, 2, "a raster per hall");
    assert.ok(raster.cells.every((cells) => cells.length > 0 && cells.length <= MAX_AREA_RASTER / 2));
    assert.ok(raster.cells.flat().length <= MAX_AREA_RASTER);
    assert.equal(raster.side, rackBox.cell * 2 ** (28 - raster.level));
    assert.deepEqual(raster.cells.map((cells) => [...new Set(cells.map((c) => (c.query.type === "range" ? c.query.value.from[0] : "")))]),
        [['"Hall 1"'], ['"Hall 2"']], "each hall's cells searched under its value");
    // Read through the index led by no field, one raster.
    assert.equal(schematicRaster(schematicWindowPlan(areas, where(), view), view).cells.length, 1);
    // Its coarser cells are every combination's, each coarser than the raster.
    assert.ok(raster.coarse.length > 0 && raster.coarse.every((c) => c.level < raster.level));
});

hostTest("the density's cells add every combination's counts cell by cell, and spread a coarser cell's rows evenly over the raster cells it covers (D25)", () => {
    const raster = schematicRaster(schematicWindowPlan(areas, where([["hall", values('"Hall 1"', '"Hall 2"')]]), view), view);
    const first = raster.cells[0]!, second = raster.cells[1]!;
    const last = first.length - 1;
    // Hall 1 holds 3 rows in the raster's first cell; Hall 2 holds 2 there and 1 in its last.
    const counts = [...first.map((_, i) => (i === 0 ? 3n : 0n)), ...second.map((_, i) => (i === 0 ? 2n : i === last ? 1n : 0n))];
    assert.deepEqual(schematicDensityCells(raster, counts).map((c) => [c.minX, c.minY, c.count]),
        [[first[0]!.minX, first[0]!.minY, 5], [first[last]!.minX, first[last]!.minY, 1]], "a cell's rows, every hall's");
    // A cell one level coarser than the raster covers four of its cells: its 8 rows are 2 in each.
    const xs = first.map((c) => c.ix), ys = first.map((c) => c.iy);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const up = raster.coarse.findIndex((c) => c.level === raster.level - 1 && 2 * c.ix >= x0 && 2 * c.ix + 1 <= x1 && 2 * c.iy >= y0 && 2 * c.iy + 1 <= y1);
    assert.ok(up >= 0, "a coarser cell inside the raster");
    const empty = counts.map(() => 0n);
    const coarser = raster.coarse[up]!;
    const spread = schematicDensityCells(raster, empty, raster.coarse.map((_, i) => (i === up ? 8n : 0n)));
    const covered = first.filter((c) => c.ix >> 1 === coarser.ix && c.iy >> 1 === coarser.iy);
    assert.deepEqual(spread.map((c) => [c.minX, c.minY, c.count]), covered.map((c) => [c.minX, c.minY, 2]), "its four raster cells, 2 rows each");
    // The root's rows, spread over the whole domain, are under half a row a cell: none holds any.
    const root = raster.coarse.findIndex((c) => c.level === 0);
    assert.deepEqual(schematicDensityCells(raster, empty, raster.coarse.map((_, i) => (i === root ? 3n : 0n))), []);
    // Counts that are not one a cell are refused.
    assert.throws(() => schematicDensityCells(raster, counts.slice(1)), /was counted/);
    assert.throws(() => schematicDensityCells(raster, counts, [1n]), /was counted/);
});

hostTest("a kind read by area reads its rows with no position through the area index its window would: the choices it leads beside the unplaced clause, the rest left to `within` (D51)", () => {
    const unplaced = (narrowing: Where) => {
        const plan = schematicUnplacedPlan(areas, narrowing);
        return { index: plan.index.name, where: [...plan.where].map(([field, choice]) => [field, choice.type, choice.value]), residual: plan.residual };
    };
    assert.deepEqual(unplaced(where()), { index: "racks_by_area", where: [[AREA_FIELD, "values", [AREA_UNPLACED]]], residual: [] }, "no narrowing: the clause alone");
    assert.deepEqual(unplaced(where([["hall", values('"Hall 1"', '"Hall 2"')]])),
        { index: "racks_by_hall_area", where: [[AREA_FIELD, "values", [AREA_UNPLACED]], ["hall", "values", ['"Hall 1"', '"Hall 2"']]], residual: [] },
        "the halls led, read with the clause");
    assert.deepEqual(unplaced(where([["hall", values('"Hall 1"')], ["model", values('"42U"')]])),
        { index: "racks_by_hall_area", where: [[AREA_FIELD, "values", [AREA_UNPLACED]], ["hall", "values", ['"Hall 1"']]], residual: ["model"] },
        "the hall led, the model left to `within`");
    assert.deepEqual(unplaced(where([["model", values('"42U"')]])),
        { index: "racks_by_area", where: [[AREA_FIELD, "values", [AREA_UNPLACED]]], residual: ["model"] }, "a choice no area index leads, left to `within`");
    // One search a combination: many more halls than a window could take stay led.
    const halls = Array.from({ length: 40 }, (_, i) => `"Hall ${i + 1}"`);
    assert.equal(schematicUnplacedPlan(areas, where([["hall", values(...halls)]])).index.name, "racks_by_hall_area");
});
