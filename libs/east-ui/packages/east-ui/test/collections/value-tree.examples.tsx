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
import { Box, Configurator, Reactive, SegmentGroup, Text, ValueTree } from "@elaraai/east-ui";

const MachineType = StructType({
    name: StringType,
    rate: FloatType,
    operator: OptionType(StringType),
    state: VariantType({ running: NullType, down: StringType }),
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

// ============================================================================
// Module-scope fixtures — one per merged example (consolidation epic #455).
// ============================================================================

const VALUE_TREE_DICT_OF_STRUCTS_DATA = East.value(new Map([
    ["m1", { name: "Press", rate: 2.5, operator: some("dana"), state: variant("running", null) }],
    ["m2", { name: "Mill", rate: 1.25, operator: none, state: variant("down", "belt snapped") }],
]), DictType(StringType, MachineType));
const VALUE_TREE_KITCHEN_SINK_DATA = East.value({
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
}, PlantType);
const VALUE_TREE_EDITABLE_DATA = new Map([
    ["m1", { name: "Press", rate: 2.5, operator: some("dana"), state: variant("running", null) }],
    ["m2", { name: "Mill", rate: 1.25, operator: none, state: variant("down", "belt snapped") }],
]);
const VALUE_TREE_SCOPED_DATA = new Map([
    ["press", { name: "Press", rate: 2.5, operator: some("dana"), state: variant("running", null) }],
    ["mill", { name: "Mill", rate: 1.25, operator: none, state: variant("down", "belt snapped") }],
]);
const VALUE_TREE_COLLECTIONS_DATA = {
    samples: [1.0, 2.5],
    thresholds: new Map([["base", 0.15]]),
};
const VALUE_TREE_RAW_PATHS_DATA = new Map([["base", 0.15], ["peak", 0.4]]);
const VALUE_TREE_KITCHEN_SINK_EDITABLE_DATA = {
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
};

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

/**
 * THE ValueTree configurator (pass 4) — one mode axis spans the surface:
 * both read-only inspectors (dict-of-structs and the every-East-type kitchen
 * sink), the five editing contracts (whole-value onUpdate, ValueTree.at
 * scoping, collection add/remove, raw onEdit paths, the deep editable sink),
 * and the two sizing contracts (virtualized pinned height, height:100% in a
 * bounded parent). Every arm keeps its own unconditional State bind and
 * typed handler; the axis just swaps which tree previews.
 */
export const valueTreeVariants = example({
    keywords: ["ValueTree", "dict", "struct", "option", "variant", "nested", "deep", "recursive", "set", "vector", "matrix", "blob", "ref", "kitchen sink", "at", "scope", "subtree", "handler", "bubble", "onUpdate", "dispatch", "add", "remove", "collection", "onEdit", "path", "leaf", "raw", "editable", "edit", "virtualized", "height", "scroll", "fill", "parent", "bounded", "Reactive", "State", "SegmentGroup", "Configurator", "getTag", "configurator"],
    description: "ValueTree configurator — a mode axis over the read-only inspectors, the five editing contracts (whole / scoped / collections / raw paths / deep sink) and the virtualized + fill sizing arms",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const modes = $.const([
                "read dict", "read sink", "edit", "scoped", "collections",
                "paths", "edit sink", "virtualized", "fill",
            ], ArrayType(StringType));
            const modeBind = $.let(State.bind([StringType], "valuetree_mode", "read dict"));
            const mKey = $.let(modeBind.read());
            const onMode = $.const(East.function([StringType], NullType, ($, next) => { $(modeBind.write(next)); }));

            // READ arms — the two differently-typed inspectors.
            const dictTree = $.const(<ValueTree value={VALUE_TREE_DICT_OF_STRUCTS_DATA} />);
            const sinkTree = $.const(<ValueTree value={VALUE_TREE_KITCHEN_SINK_DATA} />);

            // EDIT — every edit arrives as the whole rebuilt value.
            const editBind = $.let(State.bind([DictType(StringType, MachineType)], "vt_machines", VALUE_TREE_EDITABLE_DATA));
            const machines = $.let(editBind.read());
            const onMachines = $.const(East.function([DictType(StringType, MachineType)], NullType, ($, next) => {
                $(editBind.write(next));
            }));
            const editArm = $.const(<ValueTree value={machines} onUpdate={onMachines} />);

            // SCOPED — ValueTree.at routes one entry's edits to a typed
            // handler; everything else bubbles to onUpdate.
            const PlantDict = DictType(StringType, MachineType);
            const scopedBind = $.let(State.bind([PlantDict], "vt_plant", VALUE_TREE_SCOPED_DATA));
            const plant = $.let(scopedBind.read());
            const onPress = $.const(East.function([MachineType], NullType, ($, m) => {
                const next = $.let(scopedBind.read());
                $(next.insertOrUpdate("press", m));
                $(scopedBind.write(next));
            }));
            const onPlant = $.const(East.function([PlantDict], NullType, ($, next) => {
                $(scopedBind.write(next));
            }));
            const scopedArm = $.const(
                <ValueTree
                    value={plant}
                    onUpdate={onPlant}
                    at={[ValueTree.at(PlantDict, p => p.entry("press"), onPress)]}
                />,
            );

            // COLLECTIONS — adds and removes arrive as the rebuilt value.
            const RunType = StructType({
                samples: ArrayType(FloatType),
                thresholds: DictType(StringType, FloatType),
            });
            const runBind = $.let(State.bind([RunType], "vt_run", VALUE_TREE_COLLECTIONS_DATA));
            const run = $.let(runBind.read());
            const onRun = $.const(East.function([RunType], NullType, ($, next) => {
                $(runBind.write(next));
            }));
            const collectionsArm = $.const(<ValueTree value={run} onUpdate={onRun} />);

            // PATHS — onEdit receives the typed path + leaf for hosts with a
            // finer-grained store.
            const ratesBind = $.let(State.bind([DictType(StringType, FloatType)], "vt_rates", VALUE_TREE_RAW_PATHS_DATA));
            const rates = $.let(ratesBind.read());
            const onEdit = $.const(East.function(
                [ValueTree.Types.Path, ValueTree.Types.Leaf], NullType,
                ($, path, leaf) => {
                    const key = $.let(path.get(0n).unwrap("key"));
                    const next = $.let(ratesBind.read());
                    $(next.insertOrUpdate(key, leaf.unwrap("float")));
                    $(ratesBind.write(next));
                },
            ));
            const pathsArm = $.const(<ValueTree value={rates} onEdit={onEdit} />);

            // EDIT SINK — every editable leaf kind, nested variants, options
            // and collections through one onUpdate.
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
            const lineBind = $.let(State.bind([LineType], "vt_line", VALUE_TREE_KITCHEN_SINK_EDITABLE_DATA));
            const line = $.let(lineBind.read());
            const onLine = $.const(East.function([LineType], NullType, ($, next) => {
                $(lineBind.write(next));
            }));
            const sinkEditArm = $.const(<ValueTree value={line} onUpdate={onLine} />);

            // VIRTUALIZED — a pinned-height tree over hundreds of rows.
            const SeriesType = DictType(StringType, ArrayType(FloatType));
            const seriesBind = $.let(State.bind([SeriesType], "vt_series", new Map<string, number[]>()));
            $.if(seriesBind.read().size().equals(0n), $ => {
                const seeded = $.let(East.Array.range(0n, 24n).toDict(
                    (_$, i) => East.str`sensor ${i}`,
                    (_$, i) => East.Array.range(0n, 8n).map((_$2, j) => j.toFloat().multiply(0.5).add(i.toFloat())),
                ));
                $(seriesBind.write(seeded));
            });
            const series = $.let(seriesBind.read());
            const onSeries = $.const(East.function([SeriesType], NullType, ($, next) => {
                $(seriesBind.write(next));
            }));
            const virtualArm = $.const(<ValueTree value={series} onUpdate={onSeries} style={{ height: "320px" }} />);

            // FILL — height:100% resolves against a bounded parent Box.
            const fillBind = $.let(State.bind([SeriesType], "vt_fill_series", new Map<string, number[]>()));
            $.if(fillBind.read().size().equals(0n), $ => {
                const seeded = $.let(East.Array.range(0n, 40n).toDict(
                    (_$, i) => East.str`sensor ${i}`,
                    (_$, i) => East.Array.range(0n, 6n).map((_$2, j) => j.toFloat().add(i.toFloat())),
                ));
                $(fillBind.write(seeded));
            });
            const fillSeries = $.let(fillBind.read());
            const onFillSeries = $.const(East.function([SeriesType], NullType, ($, next) => {
                $(fillBind.write(next));
            }));
            const fillArm = $.const(
                <Box width="100%" height="280px" overflow="hidden">
                    <ValueTree value={fillSeries} onUpdate={onFillSeries} style={{ height: "100%" }} />
                </Box>,
            );

            const preview = $.const(mKey.equal("read dict").ifElse(
                _$ => dictTree,
                _$ => mKey.equal("read sink").ifElse(
                    _$ => sinkTree,
                    _$ => mKey.equal("edit").ifElse(
                        _$ => editArm,
                        _$ => mKey.equal("scoped").ifElse(
                            _$ => scopedArm,
                            _$ => mKey.equal("collections").ifElse(
                                _$ => collectionsArm,
                                _$ => mKey.equal("paths").ifElse(
                                    _$ => pathsArm,
                                    _$ => mKey.equal("edit sink").ifElse(
                                        _$ => sinkEditArm,
                                        _$ => mKey.equal("virtualized").ifElse(
                                            _$ => virtualArm,
                                            _$ => fillArm,
                                        ),
                                    ),
                                ),
                            ),
                        ),
                    ),
                ),
            ), UIComponentType);

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Mode", mKey,
                            <SegmentGroup value={mKey} onChange={onMode} size="sm"
                                items={modes.map((_$, m) => SegmentGroup.Item(m, <Text>{m.upperCase()}</Text>))} />),
                    ]}
                    preview={preview}
                    spec={[
                        Configurator.Spec("Editing", mKey.equal("read dict").or(_$ => mKey.equal("read sink")).ifElse(
                            _$ => "read-only",
                            _$ => mKey.equal("paths").ifElse(_$ => "onEdit · typed paths", _$ => "onUpdate · rebuilt value"),
                        )),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
