/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The area index's planner (#1385), held to a brute force: every row whose box
 * meets a window grown by its margin is read, each once, by at most 266
 * searches a combination of leading values; and the record slice plans a
 * window, and the unplaced clause, through the area index whose leading fields
 * the other choices fill, refusing what it cannot plan.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, FloatType, IntegerType, StringType, StructType, compareFor, decodeBeast2For, encodeBeast2For, equalFor,
    none, parseFor, printFor, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { RecordSliceAreaType, RecordSliceIndexType, RecordSliceWhereType } from "../../src/platform/slice/record-types.js";
import { planRecordSlice } from "../../src/platform/slice/record-plan.js";
import { recordOnPrinter, recordOnPrinters } from "../../src/platform/slice/record-on.js";
import {
    AREA_UNPLACED, MAX_AREA_RASTER, MAX_AREA_SEARCHES, areaCells, areaMarkerFields, areaQueries, areaRaster, readAreaMarker, type AreaWindow,
} from "../../src/platform/slice/record-area.js";
import { SeekQueryType } from "../../src/contracts/source.js";

type Query = ValueTypeOf<SeekQueryType>;
type Where = ValueTypeOf<typeof RecordSliceWhereType>;
type Choice = Where extends Map<string, infer C> ? C : never;
const integerOf = parseFor(IntegerType);
const sameKey = equalFor(IntegerType);
const keyOrder = compareFor(IntegerType);
const printWindow = printFor(RecordSliceAreaType.cases.window);

/** The `on` printers of an area index led by no field, and of one led by a hall (#1432). */
const UNLED = recordOnPrinter(StructType({}));
const BY_HALL = recordOnPrinter(StructType({ hall: StringType }));
/** An index's printer, by the leading values a search names. */
const printerOf = (prefix: readonly string[]) => prefix.length === 0 ? UNLED : BY_HALL;
const printFloat = printFor(FloatType);

/** A seeded stream of numbers in [0, 1) (mulberry32): the same cases on every run. */
function stream(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * The key e3's area index files a box under, written out from §11.2 on its
 * own: the deepest level whose cell is at least twice the box's larger side,
 * the cell of that level holding its centre, its Morton code at level 28 times
 * 32 plus its level; the root's for a box outside the domain, not finite, or
 * larger than half of it.
 */
function keyOf(cx: number, cy: number, side: number, cell: number): bigint {
    const half = cell * 2 ** 27;
    if (![cx, cy, side].every(Number.isFinite) || cx < -half || cx >= half || cy < -half || cy >= half || side > half) return 0n;
    let level = 28;
    let size = cell;
    let step = 1n;
    while (size < 2 * side) { size *= 2; level--; step *= 2n; }
    let x = (BigInt(Math.floor(cx / cell)) + (1n << 27n)) / step * step;
    let y = (BigInt(Math.floor(cy / cell)) + (1n << 27n)) / step * step;
    let code = 0n;
    for (let bit = 1n, i = 0; i < 28; i++, bit *= 4n) {
        code += (x % 2n) * bit + (y % 2n) * bit * 2n;
        x /= 2n;
        y /= 2n;
    }
    return code * 32n + BigInt(level);
}

/** A row's box as its fields give it: placed by its centre, or by its minimum corner. */
interface Box { x: number; y: number; w: number; h: number; centre: boolean }

/** The key a row's box files under, its centre computed as the key function computes it. */
function filed(box: Box, cell: number): bigint {
    const cx = box.centre ? box.x : box.x + box.w / 2;
    const cy = box.centre ? box.y : box.y + box.h / 2;
    return keyOf(cx, cy, Math.max(Math.abs(box.w), Math.abs(box.h)), cell);
}

/** Whether a row's box meets the window: the viewport grown by an eighth of its larger side on each side. */
function meets(box: Box, view: AreaWindow): boolean {
    const margin = Math.max(view.maxX - view.minX, view.maxY - view.minY) / 8;
    const [x0, x1] = box.centre ? [box.x - Math.abs(box.w) / 2, box.x + Math.abs(box.w) / 2] : [Math.min(box.x, box.x + box.w), Math.max(box.x, box.x + box.w)];
    const [y0, y1] = box.centre ? [box.y - Math.abs(box.h) / 2, box.y + Math.abs(box.h) / 2] : [Math.min(box.y, box.y + box.h), Math.max(box.y, box.y + box.h)];
    return x0 <= view.maxX + margin && x1 >= view.minX - margin && y0 <= view.maxY + margin && y1 >= view.minY - margin;
}

/** The literal's Integer. */
function integer(text: string): bigint {
    const read = integerOf(text);
    assert.ok(read.success, text);
    return read.value;
}

/** How many of a plan's searches hold a key, after the leading values they all name: an exact search's as one `on`, a range's one by one (#1432). */
function reads(queries: readonly Query[], prefix: readonly string[], key: bigint): number {
    let count = 0;
    for (const query of queries) {
        if (query.type === "fields") {
            assert.deepEqual(query.value.values.slice(0, -1), [printerOf(prefix)(prefix)]);
            assert.equal(query.value.prefix.type, "none");
            if (sameKey(integer(query.value.values.at(-1)!), key)) count++;
        } else if (query.type === "range") {
            assert.deepEqual(query.value.from.slice(0, -1), prefix);
            assert.deepEqual(query.value.to.slice(0, -1), prefix);
            const from = integer(query.value.from.at(-1)!);
            const to = integer(query.value.to.at(-1)!);
            if (keyOrder(from, key) <= 0 && keyOrder(key, to) < 0) count++;
        } else assert.fail(`an area window searches exact keys and ranges, not ${query.type}`);
    }
    return count;
}

/** A box of the kind a floor holds, from a speck to most of the domain, some on cell corners. */
function randomBox(next: () => number, cell: number): Box {
    const half = cell * 2 ** 27;
    const scale = cell * 2 ** Math.floor(next() * 30);
    const onGrid = next() < 0.3;
    const at = (span: number) => onGrid ? Math.round((next() - 0.5) * span / scale) * scale : (next() - 0.5) * span;
    const span = next() < 0.1 ? 3 * half : Math.min(2 * half, scale * 200);
    const size = () => next() < 0.15 ? 0 : (onGrid ? scale / 2 ** Math.floor(next() * 3) : next() * scale * 3);
    return { x: at(span), y: at(span), w: size(), h: size(), centre: next() < 0.5 };
}

/** A viewport of any size, anywhere, inside the domain or out of it. */
function randomView(next: () => number, cell: number): AreaWindow {
    const half = cell * 2 ** 27;
    const side = next() < 0.05 ? 0 : cell * 2 ** (next() * 31 - 2);
    const aspect = 0.25 + next() * 3;
    const width = side, height = side * aspect;
    const reach = next() < 0.1 ? 4 * half : Math.min(2 * half, side * 50);
    const minX = (next() - 0.5) * reach, minY = (next() - 0.5) * reach;
    return { minX, minY, maxX: minX + width, maxY: minY + height };
}

/**
 * A plan's searches as the half-open spans of `area` codes they hold, in key
 * order, after the leading values they all name — an exact search's as one
 * `on` (#1432); refused unless they are disjoint.
 */
function spans(queries: readonly Query[], prefix: readonly string[]): [bigint, bigint][] {
    const held = queries.map((query): [bigint, bigint] => {
        if (query.type === "fields") {
            assert.deepEqual(query.value.values.slice(0, -1), [printerOf(prefix)(prefix)]);
            const key = integer(query.value.values.at(-1)!);
            return [key, key + 1n];
        }
        assert.equal(query.type, "range", `an area window searches exact keys and ranges, not ${query.type}`);
        if (query.type !== "range") return [0n, 0n];
        assert.deepEqual([query.value.from.slice(0, -1), query.value.to.slice(0, -1)], [prefix, prefix]);
        return [integer(query.value.from.at(-1)!), integer(query.value.to.at(-1)!)];
    });
    held.sort((a, b) => keyOrder(a[0], b[0]));
    for (let i = 1; i < held.length; i++) assert.ok(keyOrder(held[i - 1]![1], held[i]![0]) <= 0, "a window's searches are disjoint");
    return held;
}

/** Whether a key lies in one of a window's disjoint spans. */
function holds(sorted: readonly [bigint, bigint][], key: bigint): boolean {
    let lo = 0, hi = sorted.length - 1, found = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (keyOrder(sorted[mid]![0], key) <= 0) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return found >= 0 && keyOrder(key, sorted[found]![1]) < 0;
}

test("a window's searches hold every row whose box meets it, each once, within the bound, at cells of several sizes", () => {
    const next = stream(1385);
    for (const cell of [2 ** -7, 1, 2 ** 5]) {
        const boxes = Array.from({ length: 1500 }, () => randomBox(next, cell));
        const keys = boxes.map(box => filed(box, cell));
        for (let w = 0; w < 150; w++) {
            const view = randomView(next, cell);
            const prefix = w % 3 === 0 ? [] : ['"H1"'];
            const queries = areaQueries(prefix, view, cell, printerOf(prefix));
            assert.ok(queries.length <= MAX_AREA_SEARCHES, `${queries.length} searches for ${printWindow(view)}`);
            const sorted = spans(queries, prefix);
            boxes.forEach((box, i) => {
                if (meets(box, view)) assert.ok(holds(sorted, keys[i]!), `box ${JSON.stringify(box)} meets ${printWindow(view)} at cell ${printFloat(cell)}`);
            });
        }
    }
});

test("a window reads a coarser cell sharing its range's corner by its exact key, once, and an unplaced row never", () => {
    const cell = 1;
    const view = { minX: 10, minY: 10, maxX: 74, maxY: 74 };
    const queries = areaQueries([], view, cell, UNLED);
    // The window's level: an eighth of the window's larger side (80) is 10, so 16-unit cells, level 24.
    const ranges = queries.filter(query => query.type === "range");
    assert.ok(ranges.length > 0 && ranges.every(query => query.type === "range" && integer(query.value.from[0]!) % 32n === 24n));
    // A box of side 20 files at level 22 (64-unit cells), in the cell [0, 64)², whose aligned code is a
    // level-24 cell's too: the range of that level-24 cell starts above it, and its exact key reads it.
    const box: Box = { x: 32, y: 32, w: 20, h: 20, centre: true };
    const key = filed(box, cell);
    assert.equal(key % 32n, 22n);
    assert.ok(queries.some(query => query.type === "range" && sameKey(integer(query.value.from[0]!), key - 22n + 24n)),
        "the level-24 cell at its corner is searched");
    assert.equal(reads(queries, [], key), 1);
    assert.equal(reads(queries, [], -1n), 0, "an unplaced row has no box to meet a window");
});

test("the root is searched whatever the window: a row outside the domain, or not finite, is read wherever one looks", () => {
    const cell = 2 ** -7;
    const half = cell * 2 ** 27;
    for (const box of [
        { x: 3 * half, y: 0, w: 1, h: 1, centre: true }, { x: Number.NaN, y: 0, w: 1, h: 1, centre: true },
        { x: 0, y: 0, w: 2 * half, h: 1, centre: false }, { x: 0, y: Number.POSITIVE_INFINITY, w: 0, h: 0, centre: true },
    ]) {
        assert.equal(filed(box, cell), 0n);
        for (const view of [{ minX: 0, minY: 0, maxX: 1, maxY: 1 }, { minX: 5 * half, minY: 5 * half, maxX: 5 * half + 2, maxY: 5 * half + 1 }]) {
            assert.equal(reads(areaQueries([], view, cell, UNLED), [], 0n), 1);
        }
    }
    // A viewport wider than the domain plans its root alone, as a range over every placed row.
    assert.deepEqual(areaQueries([], { minX: -4 * half, minY: -4 * half, maxX: 4 * half, maxY: 4 * half }, cell, UNLED),
        [variant("range", { from: ["0"], to: [`${4n ** 28n * 32n}`] })]);
});

test("a window planned again plans the same searches for each cell it shares, so a pan searches only the cells it adds", () => {
    const cell = 2 ** -7;
    const print = printFor(SeekQueryType);
    const text = (queries: readonly Query[]) => queries.map(query => print(query));
    const view = { minX: 3, minY: 4, maxX: 13, maxY: 9 };
    const panned = { minX: 4, minY: 4, maxX: 14, maxY: 9 };
    const first = new Set(text(areaQueries([], view, cell, UNLED)));
    const second = text(areaQueries([], panned, cell, UNLED));
    const shared = second.filter(query => first.has(query));
    assert.ok(shared.length > second.length / 2, `a pan of a tenth shares most cells: ${shared.length} of ${second.length}`);
    assert.deepEqual(text(areaQueries([], view, cell, UNLED)), [...first], "the same window plans the same searches, in key order");
});

test("a window's searches are its cells, each where its search's key says — its level, its indices and its box — so a reader can weigh its count by how much of it a view holds", () => {
    const next = stream(1393);
    for (const cell of [2 ** -7, 1, 2 ** 5]) {
        const half = cell * 2 ** 27;
        for (let w = 0; w < 60; w++) {
            const view = randomView(next, cell);
            const prefix = w % 3 === 0 ? [] : ['"H1"'];
            const cells = areaCells(prefix, view, cell, printerOf(prefix));
            assert.deepEqual(cells.map(c => c.query), areaQueries(prefix, view, cell, printerOf(prefix)), "the cells are the window's searches, in their order");
            for (const c of cells) {
                const size = cell * 2 ** (28 - c.level);
                assert.deepEqual([c.side, c.minX, c.minY], [size, -half + c.ix * size, -half + c.iy * size], `the cell ${c.level}:${c.ix},${c.iy}'s box`);
                // Its search starts at its own key: the key a box half its side, centred in it, files under.
                const start = c.query.type === "range" ? c.query.value.from.at(-1)! : c.query.type === "fields" ? c.query.value.values.at(-1)! : "";
                const centre = (i: number) => -half + (i + 0.5) * size;
                assert.ok(sameKey(integer(start), c.level === 0 ? 0n : keyOf(centre(c.ix), centre(c.iy), size / 2, cell)),
                    `the cell ${c.level}:${c.ix},${c.iy} is the one its search names`);
            }
        }
    }
});

test("a window that is not finite, is inverted, or reads an index whose cell is no power of two is refused", () => {
    assert.throws(() => areaQueries([], { minX: Number.NaN, minY: 0, maxX: 1, maxY: 1 }, 1, UNLED), /finite bounds/);
    assert.throws(() => areaQueries([], { minX: 0, minY: 0, maxX: 1, maxY: Number.POSITIVE_INFINITY }, 1, UNLED), /finite bounds/);
    assert.throws(() => areaQueries([], { minX: 2, minY: 0, maxX: 1, maxY: 1 }, 1, UNLED), /maximum is below its minimum/);
    assert.throws(() => areaQueries([], { minX: 0, minY: 0, maxX: 1, maxY: 1 }, 0.01, UNLED), /power of two/);
    assert.throws(() => areaQueries([], { minX: 0, minY: 0, maxX: 1, maxY: 1 }, 0, UNLED), /power of two/);
});

/** Whether a row's box meets a box itself, with no margin: what a raster's coarser levels read. */
function touches(box: Box, view: AreaWindow): boolean {
    const [x0, x1] = box.centre ? [box.x - Math.abs(box.w) / 2, box.x + Math.abs(box.w) / 2] : [Math.min(box.x, box.x + box.w), Math.max(box.x, box.x + box.w)];
    const [y0, y1] = box.centre ? [box.y - Math.abs(box.h) / 2, box.y + Math.abs(box.h) / 2] : [Math.min(box.y, box.y + box.h), Math.max(box.y, box.y + box.h)];
    return x0 <= view.maxX && x1 >= view.minX && y0 <= view.maxY && y1 >= view.minY;
}

/** The index along one axis of the cell of a level holding a coordinate, as the key function files it. */
function cellIndex(at: number, cell: number, level: number): bigint {
    return (BigInt(Math.floor(at / cell)) + (1n << 27n)) / 2n ** BigInt(28 - level);
}

test("a raster counts each row filed at its level or finer once, in the cell holding its centre, and reads each coarser row meeting its box by its key", () => {
    const next = stream(1393);
    for (const cell of [2 ** -7, 1, 2 ** 5]) {
        const half = cell * 2 ** 27;
        const boxes = Array.from({ length: 1500 }, () => randomBox(next, cell));
        const keys = boxes.map(box => filed(box, cell));
        for (let w = 0; w < 40; w++) {
            const view = randomView(next, cell);
            const prefix = w % 3 === 0 ? [] : ['"H1"'];
            const raster = areaRaster(prefix, view, cell, printerOf(prefix));
            assert.ok(raster.cells.length <= MAX_AREA_RASTER, `${raster.cells.length} cells for ${printWindow(view)}`);
            assert.equal(raster.side, cell * 2 ** (28 - raster.level));
            const cellQueries = raster.cells.map(c => c.query);
            const coarseQueries = raster.coarse.map(c => c.query);
            // The cells' ranges and the coarser keys are disjoint, so no row is held twice.
            spans([...cellQueries, ...coarseQueries], prefix);
            const ranges = spans(cellQueries, prefix);
            const coarse = spans(coarseQueries, prefix);
            const byCell = new Map<string, (typeof raster.cells)[number]>(raster.cells.map(c => [`${c.ix},${c.iy}`, c]));
            // Each coarser cell names where it is: its level coarser than the raster's, and the key a box half its side,
            // centred in it, files under — the key function's own cell for it.
            for (const c of raster.coarse) {
                assert.ok(c.level < raster.level, `a coarser cell's level ${c.level} is coarser than the raster's ${raster.level}`);
                const size = cell * 2 ** (28 - c.level);
                const centre = (i: number) => -half + (i + 0.5) * size;
                assert.equal(reads([c.query], prefix, c.level === 0 ? 0n : keyOf(centre(c.ix), centre(c.iy), size / 2, cell)), 1,
                    `the coarser cell ${c.level}:${c.ix},${c.iy} is the one its key names`);
            }
            boxes.forEach((box, i) => {
                const key = keys[i]!;
                if (key < 0n) return;
                if (key === 0n) {
                    // The root's — outside the domain, not finite, or larger than half of it: the root range's at level 0, else read by its key.
                    assert.ok(holds(raster.level === 0 ? ranges : coarse, key), `box ${JSON.stringify(box)} files under the root`);
                    return;
                }
                const cx = box.centre ? box.x : box.x + box.w / 2;
                const cy = box.centre ? box.y : box.y + box.h / 2;
                if (Number(key % 32n) >= raster.level) {
                    // Filed at the raster's level or finer: counted by the range of the cell holding its centre, when the raster has that cell.
                    const own = byCell.get(`${cellIndex(cx, cell, raster.level)},${cellIndex(cy, cell, raster.level)}`);
                    if (own !== undefined) assert.equal(reads([own.query], prefix, key), 1, `box ${JSON.stringify(box)} counts in the cell holding its centre`);
                    else assert.ok(!holds(ranges, key), "a row whose centre's cell the raster leaves out counts nowhere");
                    if (cx >= view.minX && cx <= view.maxX && cy >= view.minY && cy <= view.maxY && cx >= -half && cx < half && cy >= -half && cy < half) {
                        assert.ok(own !== undefined, `the cell holding the centre of ${JSON.stringify(box)}, inside ${printWindow(view)}, is the raster's`);
                    }
                    assert.ok(!holds(coarse, key), "a row the raster counts is never read as a row");
                } else {
                    // Coarser than the raster: never counted by its ranges, and found by its key when its box meets the raster's
                    // box, in the coarser cell holding its centre.
                    assert.ok(!holds(ranges, key), "a coarser row is never counted by the raster's ranges");
                    if (touches(box, view)) {
                        const level = Number(key % 32n);
                        const own = raster.coarse.find(c => reads([c.query], prefix, key) === 1);
                        assert.ok(own !== undefined, `box ${JSON.stringify(box)} meets ${printWindow(view)}`);
                        assert.deepEqual([own.level, BigInt(own.ix), BigInt(own.iy)], [level, cellIndex(cx, cell, level), cellIndex(cy, cell, level)],
                            `box ${JSON.stringify(box)} is found in the coarser cell holding its centre`);
                    }
                }
            });
            assert.ok(!holds(ranges, -1n) && !holds(coarse, -1n), "an unplaced row has no box to count or read");
        }
    }
});

test("a raster's level is the deepest whose cells are a sixty-fourth of its box's larger side at least, coarser while it would take more cells than its budget", () => {
    const cell = 1;
    const box = { minX: 0, minY: 0, maxX: 640, maxY: 400 };
    // A sixty-fourth of 640 is 10: 16-unit cells, level 24, 41 by 26 of them meeting the box.
    const raster = areaRaster([], box, cell, UNLED);
    assert.deepEqual([raster.level, raster.side, raster.cells.length], [24, 16, 41 * 26]);
    assert.ok(raster.cells.every(c => c.query.type === "range" && integer(c.query.value.from[0]!) % 32n === 24n));
    assert.deepEqual(raster.cells.slice(0, 2).map(c => [c.minX, c.minY]), [[0, 0], [16, 0]], "row by row, each cell's corner in world units");
    // A budget of 100 cells: 32-unit cells take 21 by 13, too many; 64-unit cells 11 by 7.
    const coarser = areaRaster([], box, cell, UNLED, 100);
    assert.deepEqual([coarser.level, coarser.side, coarser.cells.length], [22, 64, 77]);
    // Its coarser levels: the root, and every level down to the raster's, by exact key, each its own level's.
    assert.ok(coarser.coarse.length > 0 && coarser.coarse.every(c => c.query.type === "fields" && c.query.value.values[0] === UNLED([])
        && integer(c.query.value.values[1]!) % 32n === BigInt(c.level) && c.level < 22));
    assert.ok(coarser.coarse.some(c => c.level === 0 && c.ix === 0 && c.iy === 0 && c.query.type === "fields" && sameKey(integer(c.query.value.values[1]!), 0n)),
        "the root is read whatever the box");
    // A box wider than the domain: the domain's cells a sixty-fourth of the box wide, sixteen a side at level 4, and
    // its coarser levels' 85 cells by key, the root among them.
    const half = cell * 2 ** 27;
    const domain = areaRaster([], { minX: -4 * half, minY: -4 * half, maxX: 4 * half, maxY: 4 * half }, cell, UNLED);
    assert.deepEqual([domain.level, domain.side, domain.cells.length, domain.coarse.length], [4, 2 ** 24, 256, 1 + 4 + 16 + 64]);
    assert.deepEqual(domain.cells[0], {
        level: 4, ix: 0, iy: 0, minX: -half, minY: -half, side: 2 ** 24, query: variant("range", { from: ["4"], to: [`${4n ** 24n * 32n}`] }),
    });
});

test("a raster's box that is not finite or is inverted, an index whose cell is no power of two, and a budget of no cell are refused", () => {
    assert.throws(() => areaRaster([], { minX: Number.NaN, minY: 0, maxX: 1, maxY: 1 }, 1, UNLED), /finite bounds/);
    assert.throws(() => areaRaster([], { minX: 2, minY: 0, maxX: 1, maxY: 1 }, 1, UNLED), /maximum below its minimum/);
    assert.throws(() => areaRaster([], { minX: 0, minY: 0, maxX: 1, maxY: 1 }, 0.01, UNLED), /power of two/);
    assert.throws(() => areaRaster([], { minX: 0, minY: 0, maxX: 1, maxY: 1 }, 1, UNLED, 0), /at least one cell/);
});

test("an area index's marker names its box's fields by role, and reads back as itself", () => {
    for (const box of [
        { x: "x", y: "y", width: "w", height: "h", centre: true, cell: 2 ** -7 },
        { x: "left", y: "top", width: "side", height: "side", centre: false, cell: 1 },
        { x: "px", y: "py", centre: false, cell: 2 ** 10 },
        { x: "a=b", y: "__centre", width: "x=y", height: "h", centre: true, cell: 2 ** -30 },
    ]) {
        assert.deepEqual(readAreaMarker(areaMarkerFields(box)), box);
    }
    assert.deepEqual(areaMarkerFields({ x: "x", y: "y", width: "w", height: "h", centre: true, cell: 2 ** -7 }),
        ["x=x", "y=y", "width=w", "height=h", "__centre", "cell=0.0078125"]);
    for (const names of [["x=x", "y=y"], ["x=x", "cell=1.0"], ["x=x", "y=y", "width=w", "cell=1.0"], ["x=x", "x=y", "y=y", "cell=1.0"],
        ["x=x", "y=y", "cell=nope"], ["x=x", "y=y", "depth=d", "cell=1.0"], ["x", "y=y", "cell=1.0"], ["x=x", "y=y", "cell=-1.0"]]) {
        assert.equal(readAreaMarker(names), undefined, names.join(", "));
    }
});

const indexType = ArrayType(RecordSliceIndexType);
const box = { x: "x", y: "y", width: some("w"), height: some("h"), centre: true, cell: 2 ** -7 };
// Each index's fields are the row fields it is led by alone (#1432): its key's `on`.
const indexes = decodeBeast2For(indexType)(encodeBeast2For(indexType)([
    { name: "by_hall", fields: ["hall"], sets: new Set(), structured: false, interval: none, area: none, series: none, summary: none },
    { name: "racks_by_area", fields: [], sets: new Set(), structured: true, interval: none, area: some({ ...box, optional: true }), series: none, summary: none },
    { name: "racks_by_hall_area", fields: ["hall"], sets: new Set(), structured: true, interval: none, area: some({ ...box, optional: true }), series: none, summary: none },
    { name: "racks_by_tag_area", fields: ["tags"], sets: new Set(["tags"]), structured: true, interval: none, area: some({ ...box, optional: true }), series: none, summary: none },
    { name: "zones_by_area", fields: ["floor"], sets: new Set(), structured: true, interval: none, area: some({ ...box, centre: false, optional: false }), series: none, summary: none },
]));
/** Each area index's `on` printer, from its key type, as the binding's index key types give them. */
const keyOf_ = (on: StructType) => StructType({ on, area: IntegerType });
const PRINTERS = recordOnPrinters({
    racks_by_area: keyOf_(StructType({})), racks_by_hall_area: keyOf_(StructType({ hall: StringType })),
    racks_by_tag_area: keyOf_(StructType({ tags: StringType })), zones_by_area: keyOf_(StructType({ floor: IntegerType })),
});
const BY_TAG = recordOnPrinter(StructType({ tags: StringType }));
const view = { minX: 2, minY: 3, maxX: 12, maxY: 8 };
const values = (...choices: string[]): Choice => variant("values", choices);
type Area = ValueTypeOf<typeof RecordSliceAreaType>;
const windowOf = (box: AreaWindow): Area => variant("window", box);
const UNPLACED: Area = variant("unplaced", null);
/** Plan a narrowing decoded at the runtime boundary, as a read's `where` arrives, a read by area's clause beside it. */
function plan(entries: [string, Choice][], area?: Area) {
    const where = decodeBeast2For(RecordSliceWhereType)(encodeBeast2For(RecordSliceWhereType)(new Map(entries)));
    return planRecordSlice(indexes, where, "primary", area, PRINTERS);
}

test("a window plans through the area index whose leading fields the narrowing fills, a combination at a time", () => {
    assert.deepEqual(plan([], windowOf(view)), { index: "racks_by_area", queries: areaQueries([], view, 2 ** -7, UNLED) });
    assert.deepEqual(plan([["hall", values('"H1"', '"H2"')]], windowOf(view)), {
        index: "racks_by_hall_area", queries: [...areaQueries(['"H1"'], view, 2 ** -7, BY_HALL), ...areaQueries(['"H2"'], view, 2 ** -7, BY_HALL)],
    });
    assert.deepEqual(plan([["tags", values('"cold"')]], windowOf(view)), {
        index: "racks_by_tag_area", queries: areaQueries(['"cold"'], view, 2 ** -7, BY_TAG),
    });
    // The unplaced clause: the rows of no place, a search a combination, its leading values one `on` (#1432).
    assert.deepEqual(plan([], UNPLACED), {
        index: "racks_by_area", queries: [variant("fields", { values: ["()", AREA_UNPLACED], prefix: none })],
    });
    assert.deepEqual(plan([["hall", values('"H1"', '"H2"')]], UNPLACED), {
        index: "racks_by_hall_area", queries: ['(hall="H1")', '(hall="H2")'].map(on => variant("fields", { values: [on, AREA_UNPLACED], prefix: none })),
    });
    // Without a read by area, an area index is a path among the others, read by its whole `on`.
    assert.deepEqual(plan([["hall", values('"H1"')]]), { index: "by_hall", queries: [variant("key", '"H1"')] });
    assert.deepEqual(plan([["floor", values("2")]]), { index: "zones_by_area", queries: [variant("fields", { values: ["(floor=2)"], prefix: none })] });
});

test("a narrowing choosing a field named `area` or `__area` beside a read by area's window is planned through an area index led by it: e3's parts are the kind's, never a field's name (#1432)", () => {
    const named = decodeBeast2For(indexType)(encodeBeast2For(indexType)([
        { name: "by_area", fields: ["area"], sets: new Set(), structured: false, interval: none, area: none, series: none, summary: none },
        { name: "racks_by_area", fields: [], sets: new Set(), structured: true, interval: none, area: some({ ...box, optional: true }), series: none, summary: none },
        { name: "racks_by_area_area", fields: ["area", "__area"], sets: new Set(), structured: true, interval: none, area: some({ ...box, optional: true }), series: none, summary: none },
    ]));
    const On = StructType({ area: StringType, __area: StringType });
    const printers = recordOnPrinters({ racks_by_area: keyOf_(StructType({})), racks_by_area_area: keyOf_(On) });
    const where = (entries: [string, Choice][]) => decodeBeast2For(RecordSliceWhereType)(encodeBeast2For(RecordSliceWhereType)(new Map(entries)));
    const chosen = where([["area", values('"A1"')], ["__area", values('"B"')]]);
    const read = planRecordSlice(named, chosen, "primary", windowOf(view), printers)!;
    assert.deepEqual(read, { index: "racks_by_area_area", queries: areaQueries(['"A1"', '"B"'], view, 2 ** -7, recordOnPrinter(On)) });
    assert.ok(read.queries.some(query => query.type === "fields" && query.value.values[0] === '(area="A1", __area="B")'),
        "its coarser cells name both leading values as one `on`");
    assert.deepEqual(planRecordSlice(named, chosen, "primary", UNPLACED, printers),
        { index: "racks_by_area_area", queries: [variant("fields", { values: ['(area="A1", __area="B")', AREA_UNPLACED], prefix: none })] });
    // Without a read by area, `area` alone is a field the plain index answers.
    assert.deepEqual(planRecordSlice(named, where([["area", values('"A1"')]]), "primary", undefined, printers), { index: "by_area", queries: [variant("key", '"A1"')] });
});

test("a read by area it cannot plan is refused, naming why", () => {
    assert.throws(() => plan([["status", values('"held"')]], windowOf(view)),
        /beside 'status' needs an area index led by exactly 'status' — e3\.recordIndex\.area\(name, record, \{ on: \["status"\], x, y, … \}\).*'racks_by_area', 'racks_by_hall_area', 'racks_by_tag_area', 'zones_by_area' are led by other fields/);
    assert.throws(() => planRecordSlice([indexes[0]!], new Map(), "primary", windowOf(view), PRINTERS),
        /needs an area index led by no field .*; this binding lists none/);
    assert.throws(() => plan([["hall", variant("prefix", "H")]], windowOf(view)), /takes exact choices beside it, and 'hall' holds a range or a prefix/);
    assert.throws(() => plan([["tags", values('"cold"', '"hot"')]], windowOf(view)), /takes one value of 'tags', which fans out over a Set/);
    assert.throws(() => plan([["floor", values("2")]], UNPLACED), /'zones_by_area' places every row: its 'x' and 'y' are not Options/);
    assert.throws(() => plan([["hall", values(...Array.from({ length: 65 }, (_, i) => `"H${i}"`))]], windowOf(view)), /choose fewer values/);
});
