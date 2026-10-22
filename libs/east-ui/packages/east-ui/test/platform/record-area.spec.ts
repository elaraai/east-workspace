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
    ArrayType, FloatType, IntegerType, compareFor, decodeBeast2For, encodeBeast2For, equalFor,
    none, parseFor, printFor, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { RecordSliceChoiceType, RecordSliceIndexType, RecordSliceWhereType } from "../../src/platform/slice/record-types.js";
import { planRecordSlice } from "../../src/platform/slice/record-plan.js";
import {
    AREA_FIELD, AREA_UNPLACED, MAX_AREA_SEARCHES, areaMarkerFields, areaQueries, readAreaMarker, type AreaWindow,
} from "../../src/platform/slice/record-area.js";
import { SeekQueryType } from "../../src/contracts/source.js";

type Query = ValueTypeOf<SeekQueryType>;
type Where = ValueTypeOf<typeof RecordSliceWhereType>;
type Choice = Where extends Map<string, infer C> ? C : never;
const integerOf = parseFor(IntegerType);
const sameKey = equalFor(IntegerType);
const keyOrder = compareFor(IntegerType);
const printWindow = printFor(RecordSliceChoiceType.cases.window);
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

/** How many of a plan's searches hold a key, after the leading values they all name. */
function reads(queries: readonly Query[], prefix: readonly string[], key: bigint): number {
    let count = 0;
    for (const query of queries) {
        if (query.type === "fields") {
            assert.deepEqual(query.value.values.slice(0, -1), prefix);
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
 * A plan's searches as the half-open spans of `__area` they hold, in key order,
 * after the leading values they all name; refused unless they are disjoint.
 */
function spans(queries: readonly Query[], prefix: readonly string[]): [bigint, bigint][] {
    const held = queries.map((query): [bigint, bigint] => {
        if (query.type === "fields") {
            assert.deepEqual(query.value.values.slice(0, -1), prefix);
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
            const queries = areaQueries(prefix, view, cell);
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
    const queries = areaQueries([], view, cell);
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
            assert.equal(reads(areaQueries([], view, cell), [], 0n), 1);
        }
    }
    // A viewport wider than the domain plans its root alone, as a range over every placed row.
    assert.deepEqual(areaQueries([], { minX: -4 * half, minY: -4 * half, maxX: 4 * half, maxY: 4 * half }, cell),
        [variant("range", { from: ["0"], to: [`${4n ** 28n * 32n}`] })]);
});

test("a window planned again plans the same searches for each cell it shares, so a pan searches only the cells it adds", () => {
    const cell = 2 ** -7;
    const print = printFor(SeekQueryType);
    const text = (queries: readonly Query[]) => queries.map(query => print(query));
    const view = { minX: 3, minY: 4, maxX: 13, maxY: 9 };
    const panned = { minX: 4, minY: 4, maxX: 14, maxY: 9 };
    const first = new Set(text(areaQueries([], view, cell)));
    const second = text(areaQueries([], panned, cell));
    const shared = second.filter(query => first.has(query));
    assert.ok(shared.length > second.length / 2, `a pan of a tenth shares most cells: ${shared.length} of ${second.length}`);
    assert.deepEqual(text(areaQueries([], view, cell)), [...first], "the same window plans the same searches, in key order");
});

test("a window that is not finite, is inverted, or reads an index whose cell is no power of two is refused", () => {
    assert.throws(() => areaQueries([], { minX: Number.NaN, minY: 0, maxX: 1, maxY: 1 }, 1), /finite bounds/);
    assert.throws(() => areaQueries([], { minX: 0, minY: 0, maxX: 1, maxY: Number.POSITIVE_INFINITY }, 1), /finite bounds/);
    assert.throws(() => areaQueries([], { minX: 2, minY: 0, maxX: 1, maxY: 1 }, 1), /maximum is below its minimum/);
    assert.throws(() => areaQueries([], { minX: 0, minY: 0, maxX: 1, maxY: 1 }, 0.01), /power of two/);
    assert.throws(() => areaQueries([], { minX: 0, minY: 0, maxX: 1, maxY: 1 }, 0), /power of two/);
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
const indexes = decodeBeast2For(indexType)(encodeBeast2For(indexType)([
    { name: "by_hall", fields: ["hall"], sets: new Set(), structured: false, interval: none, area: none },
    { name: "racks_by_area", fields: [AREA_FIELD], sets: new Set(), structured: true, interval: none, area: some({ ...box, optional: true }) },
    { name: "racks_by_hall_area", fields: ["hall", AREA_FIELD], sets: new Set(), structured: true, interval: none, area: some({ ...box, optional: true }) },
    { name: "racks_by_tag_area", fields: ["tags", AREA_FIELD], sets: new Set(["tags"]), structured: true, interval: none, area: some({ ...box, optional: true }) },
    { name: "zones_by_area", fields: ["floor", AREA_FIELD], sets: new Set(), structured: true, interval: none, area: some({ ...box, centre: false, optional: false }) },
]));
const view = { minX: 2, minY: 3, maxX: 12, maxY: 8 };
const values = (...choices: string[]): Choice => variant("values", choices);
/** Plan a narrowing decoded at the runtime boundary, as a read's `where` arrives. */
function plan(entries: [string, Choice][]) {
    const where = decodeBeast2For(RecordSliceWhereType)(encodeBeast2For(RecordSliceWhereType)(new Map(entries)));
    return planRecordSlice(indexes, where, "primary");
}

test("a window plans through the area index whose leading fields the other choices fill, a combination at a time", () => {
    assert.deepEqual(plan([[AREA_FIELD, variant("window", view)]]), { index: "racks_by_area", queries: areaQueries([], view, 2 ** -7) });
    assert.deepEqual(plan([["hall", values('"H1"', '"H2"')], [AREA_FIELD, variant("window", view)]]), {
        index: "racks_by_hall_area", queries: [...areaQueries(['"H1"'], view, 2 ** -7), ...areaQueries(['"H2"'], view, 2 ** -7)],
    });
    assert.deepEqual(plan([["tags", values('"cold"')], [AREA_FIELD, variant("window", view)]]), {
        index: "racks_by_tag_area", queries: areaQueries(['"cold"'], view, 2 ** -7),
    });
    // The unplaced clause: the rows of no place, a search a combination.
    assert.deepEqual(plan([[AREA_FIELD, values(AREA_UNPLACED)]]), {
        index: "racks_by_area", queries: [variant("fields", { values: [AREA_UNPLACED], prefix: none })],
    });
    assert.deepEqual(plan([["hall", values('"H1"', '"H2"')], [AREA_FIELD, values(AREA_UNPLACED)]]), {
        index: "racks_by_hall_area", queries: ['"H1"', '"H2"'].map(hall => variant("fields", { values: [hall, AREA_UNPLACED], prefix: none })),
    });
    // Without a clause under `__area`, an area index is an ordinary path among the others.
    assert.deepEqual(plan([["hall", values('"H1"')]]), { index: "by_hall", queries: [variant("key", '"H1"')] });
    assert.deepEqual(plan([["floor", values("2")]]), { index: "zones_by_area", queries: [variant("fields", { values: ["2"], prefix: none })] });
});

test("a read by area it cannot plan is refused, naming why", () => {
    assert.throws(() => plan([["status", values('"held"')], [AREA_FIELD, variant("window", view)]]),
        /beside 'status' needs an area index led by exactly 'status' — e3\.recordIndex\.area\(name, record, \{ on: \["status"\], x, y, … \}\).*'racks_by_area', 'racks_by_hall_area', 'racks_by_tag_area', 'zones_by_area' are led by other fields/);
    assert.throws(() => planRecordSlice([indexes[0]!], new Map([[AREA_FIELD, variant("window", view)]]), "primary"),
        /needs an area index led by no field .*; this binding lists none/);
    assert.throws(() => plan([["hall", variant("prefix", "H")], [AREA_FIELD, variant("window", view)]]), /takes exact choices beside it, and 'hall' holds a range or a prefix/);
    assert.throws(() => plan([["tags", values('"cold"', '"hot"')], [AREA_FIELD, variant("window", view)]]), /takes one value of 'tags', which fans out over a Set/);
    assert.throws(() => plan([["hall", variant("window", view)]]), /reads through an area index's __area, not 'hall'/);
    assert.throws(() => plan([[AREA_FIELD, variant("range", { from: "0", to: "5" })]]), /choose a window or the unplaced clause, not a range/);
    assert.throws(() => plan([[AREA_FIELD, values("5")]]), /the one value is the unplaced clause, -1/);
    assert.throws(() => plan([["floor", values("2")], [AREA_FIELD, values(AREA_UNPLACED)]]), /'zones_by_area' places every row: its 'x' and 'y' are not Options/);
    assert.throws(() => plan([["hall", values(...Array.from({ length: 65 }, (_, i) => `"H${i}"`))], [AREA_FIELD, variant("window", view)]]), /choose fewer values/);
});
