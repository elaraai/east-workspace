/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import {
    ArrayType,
    BlobType,
    BooleanType,
    DateTimeType,
    DictType,
    East,
    FloatType,
    IntegerType,
    MatrixType,
    NullType,
    OptionType,
    RecursiveType,
    RefType,
    SetType,
    StringType,
    StructType,
    VariantType,
    VectorType,
    example,
    ref,
    some,
    none,
    variant,
} from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Box, Reactive, ValueTree } from "@elaraai/east-ui";

export const valueTreeBasic = example({
    keywords: ["ValueTree", "value", "tree", "inspector", "leaf", "struct", "read-only"],
    description: "Read-only inspector — any value materializes into an automatic tree",
    fn: East.function([], UIComponentType, (_$) => (
        <ValueTree
            value={{
                rate: 0.15,
                label: "Base",
                tags: ["a", "b"],
            }}
        />
    )),
    inputs: [],
});

const MachineType = StructType({
    name: StringType,
    rate: FloatType,
    operator: OptionType(StringType),
    state: VariantType({ running: NullType, down: StringType }),
});

export const valueTreeDictOfStructs = example({
    keywords: ["ValueTree", "dict", "struct", "option", "variant", "nested", "branch"],
    description: "A dict of structs with option and variant fields — every branch kind in one tree",
    fn: East.function([], UIComponentType, (_$) => (
        <ValueTree
            value={East.value(new Map([
                ["m1", { name: "Press", rate: 2.5, operator: some("dana"), state: variant("running", null) }],
                ["m2", { name: "Mill", rate: 1.25, operator: none, state: variant("down", "belt snapped") }],
            ]), DictType(StringType, MachineType))}
        />
    )),
    inputs: [],
});

export const valueTreeEditable = example({
    keywords: ["ValueTree", "onUpdate", "edit", "whole value", "Reactive", "State"],
    description: "Editable tree with onUpdate — every edit arrives as the whole rebuilt value; write it back and the tree refreshes",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const bind = $.let(State.bind(
                [DictType(StringType, MachineType)],
                "vt_machines",
                new Map([
                    ["m1", { name: "Press", rate: 2.5, operator: some("dana"), state: variant("running", null) }],
                    ["m2", { name: "Mill", rate: 1.25, operator: none, state: variant("down", "belt snapped") }],
                ]),
            ));
            const machines = $.let(bind.read());
            const onUpdate = $.const(East.function(
                [DictType(StringType, MachineType)], NullType,
                ($, next) => {
                    $(bind.write(next));
                },
            ));
            return <ValueTree value={machines} onUpdate={onUpdate} />;
        }}</Reactive>
    )),
    inputs: [],
});

export const valueTreeScoped = example({
    keywords: ["ValueTree", "at", "scope", "subtree", "handler", "bubble", "onUpdate", "dispatch"],
    description: "Scoped subtree handlers — ValueTree.at routes edits inside one entry to a typed handler; everything else bubbles to onUpdate",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const PlantType = DictType(StringType, MachineType);
            const bind = $.let(State.bind(
                [PlantType],
                "vt_plant",
                new Map([
                    ["press", { name: "Press", rate: 2.5, operator: some("dana"), state: variant("running", null) }],
                    ["mill", { name: "Mill", rate: 1.25, operator: none, state: variant("down", "belt snapped") }],
                ]),
            ));
            const plant = $.let(bind.read());
            // The scope receives just the rebuilt "press" machine — a
            // specialised, fully-typed handler for that subtree.
            const onPress = $.const(East.function([MachineType], NullType, ($, m) => {
                const next = $.let(bind.read());
                $(next.insertOrUpdate("press", m));
                $(bind.write(next));
            }));
            // Edits outside the scope (the mill, adds/removes) bubble here.
            const onUpdate = $.const(East.function([PlantType], NullType, ($, next) => {
                $(bind.write(next));
            }));
            return (
                <ValueTree
                    value={plant}
                    onUpdate={onUpdate}
                    at={[ValueTree.at(PlantType, p => p.entry("press"), onPress)]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const valueTreeCollections = example({
    keywords: ["ValueTree", "onUpdate", "array", "dict", "add", "remove", "insert", "collection"],
    description: "Collection editing through onUpdate — adds and removes arrive as the rebuilt value, no path plumbing",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const RunType = StructType({
                samples: ArrayType(FloatType),
                thresholds: DictType(StringType, FloatType),
            });
            const bind = $.let(State.bind([RunType], "vt_run", {
                samples: [1.0, 2.5],
                thresholds: new Map([["base", 0.15]]),
            }));
            const run = $.let(bind.read());
            const onUpdate = $.const(East.function([RunType], NullType, ($, next) => {
                $(bind.write(next));
            }));
            return <ValueTree value={run} onUpdate={onUpdate} />;
        }}</Reactive>
    )),
    inputs: [],
});

export const valueTreeRawPaths = example({
    keywords: ["ValueTree", "onEdit", "path", "leaf", "raw", "callback", "escape hatch"],
    description: "Raw path callbacks — onEdit receives the typed path and leaf for hosts with a finer-grained store",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const bind = $.let(State.bind(
                [DictType(StringType, FloatType)],
                "vt_rates",
                new Map([["base", 0.15], ["peak", 0.4]]),
            ));
            const rates = $.let(bind.read());
            const onEdit = $.const(East.function(
                [ValueTree.Types.Path, ValueTree.Types.Leaf], NullType,
                ($, path, leaf) => {
                    const key = $.let(path.get(0n).unwrap("key"));
                    const next = $.let(bind.read());
                    $(next.insertOrUpdate(key, leaf.unwrap("float")));
                    $(bind.write(next));
                },
            ));
            return <ValueTree value={rates} onEdit={onEdit} />;
        }}</Reactive>
    )),
    inputs: [],
});

/** Every East type in one deep tree: struct, dict, array, variant (with
 *  struct/array payloads), option (of variant), all six leaf kinds,
 *  recursion, and the summarized opaques (set, blob, vector, matrix,
 *  ref) plus a non-string-keyed dict (browsable read-only). */
const LineageType = RecursiveType(self => VariantType({
    original: NullType,
    upgraded: StructType({ from: StringType, prior: self }),
}));
const PlantType = StructType({
    site: StringType,
    commissioned: DateTimeType,
    active: BooleanType,
    batch: IntegerType,
    output: FloatType,
    notes: OptionType(StringType),
    lines: DictType(StringType, StructType({
        machines: ArrayType(StructType({
            name: StringType,
            state: VariantType({
                running: StructType({ since: DateTimeType, rate: FloatType }),
                down: StructType({ reason: StringType, parts: ArrayType(StringType) }),
                idle: NullType,
            }),
            calibration: OptionType(VariantType({
                auto: NullType,
                manual: StructType({ offset: FloatType, by: StringType }),
            })),
        })),
    })),
    lineage: LineageType,
    codes: DictType(IntegerType, StringType),
    tags: SetType(StringType),
    checksum: BlobType,
    samples: VectorType(FloatType),
    weights: MatrixType(FloatType),
    audit: RefType(StringType),
});

export const valueTreeKitchenSink = example({
    keywords: ["ValueTree", "all types", "deep", "nested", "recursive", "set", "vector", "matrix", "blob", "ref", "kitchen sink"],
    description: "Deeply nested tree over every East type — nested variants, options of variants, recursion, and summarized opaque leaves",
    fn: East.function([], UIComponentType, (_$) => (
        <ValueTree
            value={East.value({
                site: "Riverside",
                commissioned: new Date("2021-06-01T00:00:00Z"),
                active: true,
                batch: 42n,
                output: 812.5,
                notes: some("Night shift only"),
                lines: new Map([
                    ["packing", {
                        machines: [
                            {
                                name: "Press",
                                state: variant("running", { since: new Date("2026-07-01T06:00:00Z"), rate: 2.5 }),
                                calibration: some(variant("manual", { offset: 0.02, by: "dana" })),
                            },
                            {
                                name: "Mill",
                                state: variant("down", { reason: "belt snapped", parts: ["belt", "tensioner"] }),
                                calibration: none,
                            },
                            {
                                name: "Wrapper",
                                state: variant("idle", null),
                                calibration: some(variant("auto", null)),
                            },
                        ],
                    }],
                    ["casting", { machines: [] }],
                ]),
                lineage: variant("upgraded", {
                    from: "Mark II",
                    prior: variant("upgraded", { from: "Mark I", prior: variant("original", null) }),
                }),
                codes: new Map([[7n, "critical"], [12n, "routine"]]),
                tags: new Set(["food-grade", "iso-9001"]),
                checksum: new Uint8Array([202, 254, 186]),
                samples: new Float64Array([1.0, 1.5, 2.25]),
                weights: East.Matrix.fromArray([[1.0, 0.0], [0.0, 1.0]]),
                audit: ref("2026-07-01 dana"),
            }, PlantType)}
        />
    )),
    inputs: [],
});

export const valueTreeKitchenSinkEditable = example({
    keywords: ["ValueTree", "editable", "deep", "nested", "variant", "option", "datetime", "boolean", "onUpdate"],
    description: "Deep editable tree — every editable kind (all leaf types, nested variants, options, collections) through one onUpdate",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const LineType = StructType({
                machines: ArrayType(StructType({
                    name: StringType,
                    commissioned: DateTimeType,
                    active: BooleanType,
                    batch: IntegerType,
                    rate: FloatType,
                    operator: OptionType(StringType),
                    state: VariantType({
                        running: StructType({ rate: FloatType }),
                        down: StructType({ reason: StringType, parts: ArrayType(StringType) }),
                        idle: NullType,
                    }),
                })),
                thresholds: DictType(StringType, FloatType),
            });
            const bind = $.let(State.bind([LineType], "vt_line", {
                machines: [
                    {
                        name: "Press",
                        commissioned: new Date("2021-06-01T00:00:00Z"),
                        active: true,
                        batch: 42n,
                        rate: 2.5,
                        operator: some("dana"),
                        state: variant("running", { rate: 2.5 }),
                    },
                    {
                        name: "Mill",
                        commissioned: new Date("2019-02-15T00:00:00Z"),
                        active: false,
                        batch: 7n,
                        rate: 1.25,
                        operator: none,
                        state: variant("down", { reason: "belt snapped", parts: ["belt"] }),
                    },
                ],
                thresholds: new Map([["base", 0.15], ["peak", 0.4]]),
            }));
            const line = $.let(bind.read());
            const onUpdate = $.const(East.function([LineType], NullType, ($, next) => {
                $(bind.write(next));
            }));
            return <ValueTree value={line} onUpdate={onUpdate} />;
        }}</Reactive>
    )),
    inputs: [],
});

export const valueTreeVirtualized = example({
    keywords: ["ValueTree", "virtualized", "height", "scroll", "large", "many rows"],
    description: "A pinned-height tree over hundreds of rows — rows virtualize and scroll position persists",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const SeriesType = DictType(StringType, ArrayType(FloatType));
            const bind = $.let(State.bind([SeriesType], "vt_series", new Map<string, number[]>()));
            $.if(bind.read().size().equals(0n), $ => {
                const seeded = $.let(East.Array.range(0n, 24n).toDict(
                    (_$, i) => East.str`sensor ${i}`,
                    (_$, i) => East.Array.range(0n, 8n).map((_$2, j) => j.toFloat().multiply(0.5).add(i.toFloat())),
                ));
                $(bind.write(seeded));
            });
            const series = $.let(bind.read());
            const onUpdate = $.const(East.function([SeriesType], NullType, ($, next) => {
                $(bind.write(next));
            }));
            return <ValueTree value={series} onUpdate={onUpdate} style={{ height: "320px" }} />;
        }}</Reactive>
    )),
    inputs: [],
});

export const valueTreeFillsBoundedParent = example({
    keywords: ["ValueTree", "virtualized", "height", "100%", "fill", "parent", "bounded", "scroll", "preview"],
    description: "A tree told to fill a bounded parent scrolls inside it instead of growing to its content",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // The host-preview shape: a fixed-height frame that hands the tree
            // a percentage bound. The tree must resolve that against the frame
            // and virtualize, not fall back to auto height and render every row.
            const SeriesType = DictType(StringType, ArrayType(FloatType));
            const bind = $.let(State.bind([SeriesType], "vt_fill_series", new Map<string, number[]>()));
            $.if(bind.read().size().equals(0n), $ => {
                const seeded = $.let(East.Array.range(0n, 40n).toDict(
                    (_$, i) => East.str`sensor ${i}`,
                    (_$, i) => East.Array.range(0n, 6n).map((_$2, j) => j.toFloat().add(i.toFloat())),
                ));
                $(bind.write(seeded));
            });
            const series = $.let(bind.read());
            const onUpdate = $.const(East.function([SeriesType], NullType, ($, next) => {
                $(bind.write(next));
            }));
            return (
                <Box height="280px" overflow="hidden">
                    <ValueTree value={series} onUpdate={onUpdate} style={{ height: "100%" }} />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});
