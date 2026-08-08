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
import { Box, Configurator, HStack, Input, Reactive, SegmentGroup, Switch, Text, ValueTree } from "@elaraai/east-ui";

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

/** The every-East-type read-only inspector — one deep kitchen-sink value. */
export const valueTreeInspect = example({
    keywords: ["ValueTree", "dict", "struct", "option", "variant", "nested", "deep", "recursive", "set", "vector", "matrix", "blob", "ref", "kitchen sink", "read-only", "inspector"],
    description: "Kitchen-sink inspector — every East type (recursion, opaques, non-string dict keys) in one read-only tree",
    fn: East.function([], UIComponentType, (_$) => {
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
        return (
        <ValueTree value={VALUE_TREE_KITCHEN_SINK_DATA} />
    );
    }),
    inputs: [],
});

/**
 * THE editable ValueTree configurator (pass 5) — ONE live tree over the deep
 * 24-machine line: every editable leaf kind, nested variants, options and
 * collection add/remove through one whole-value `onUpdate`; the size axis
 * feeds the height expression (auto / bounded scroll / fill — an empty height
 * reads as unbounded), the open-depth axis feeds `style.openDepth` (0 = all
 * collapsed; per-row toggles shadow it) and the toolbar switch feeds
 * `style.toolbar` (collapse-all / expand-all header; Alt-click a twist
 * collapses that whole subtree), so the sizing and expansion contracts need
 * no second tree.
 */
export const valueTreeVariants = example({
    keywords: ["ValueTree", "onUpdate", "rebuilt value", "editable", "edit", "add", "remove", "collection", "leaf", "virtualized", "height", "scroll", "fill", "parent", "bounded", "openDepth", "toolbar", "collapse", "expand", "collapse all", "expand all", "controls", "Alt-click", "subtree", "Reactive", "State", "SegmentGroup", "Input", "Switch", "Configurator", "configurator"],
    description: "Editable ValueTree configurator — one live 24-machine tree with whole-value onUpdate; the size axis (auto / scroll / fill) feeds the height expression, openDepth and the toolbar switch feed the expansion contract (Alt-click a twist collapses its subtree)",
    fn: East.function([], UIComponentType, (_$) => {
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
        const VALUE_TREE_EDITABLE_LINE_DATA = East.value({
            machines: East.Array.range(0n, 24n).map((_$, i) => ({
                name: East.str`machine-${i}`,
                commissioned: new Date("2021-06-01T00:00:00Z"),
                active: i.remainder(2n).equals(0n),
                batch: i.multiply(3n),
                rate: i.toFloat().multiply(0.25).add(1.0),
                operator: i.remainder(3n).equals(0n).ifElse(() => some("dana"), () => East.value(none, OptionType(StringType))),
                state: i.remainder(3n).equals(0n).ifElse(
                    () => East.value(variant("running", { rate: 2.5 }), VariantType({
                        running: StructType({ rate: FloatType }),
                        down: StructType({ reason: StringType, parts: ArrayType(StringType) }),
                        idle: NullType,
                    })),
                    () => i.remainder(3n).equals(1n).ifElse(
                        () => East.value(variant("down", { reason: "belt snapped", parts: ["belt"] }), VariantType({
                            running: StructType({ rate: FloatType }),
                            down: StructType({ reason: StringType, parts: ArrayType(StringType) }),
                            idle: NullType,
                        })),
                        () => East.value(variant("idle", null), VariantType({
                            running: StructType({ rate: FloatType }),
                            down: StructType({ reason: StringType, parts: ArrayType(StringType) }),
                            idle: NullType,
                        })),
                    ),
                ),
            })),
            thresholds: new Map([["base", 0.15], ["peak", 0.4]]),
        }, LineType);
        return (
        <Reactive>{$ => {
            const sizes = $.const(["auto", "scroll", "fill"], ArrayType(StringType));
            const sizeBind = $.let(State.bind([StringType], "valuetree_size", "scroll"));
            const sKey = $.let(sizeBind.read());
            const onSize = $.const(East.function([StringType], NullType, ($, next) => { $(sizeBind.write(next)); }));

            const lineBind = $.let(State.bind([LineType], "vt_line", VALUE_TREE_EDITABLE_LINE_DATA));
            const line = $.let(lineBind.read());
            const onLine = $.const(East.function([LineType], NullType, ($, next) => {
                $(lineBind.write(next));
            }));

            const depthBind = $.let(State.bind([IntegerType], "vt_depth", 1n));
            const depth = $.let(depthBind.read());
            const onDepth = $.const(East.function([IntegerType], NullType, ($, next) => { $(depthBind.write(next)); }));

            const toolbarBind = $.let(State.bind([BooleanType], "vt_toolbar", true));
            const toolbarOn = $.let(toolbarBind.read());
            const onToolbar = $.const(East.function([BooleanType], NullType, ($, next) => { $(toolbarBind.write(next)); }));

            // An empty height string reads as "unbounded"; the wrapper Box only
            // bounds in fill mode.
            const boxHeight = $.let(sKey.equal("fill").ifElse(_$ => "280px", _$ => ""));
            const treeHeight = $.let(sKey.equal("scroll").ifElse(
                _$ => "320px",
                _$ => sKey.equal("fill").ifElse(_$ => "100%", _$ => ""),
            ));

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Size", sKey,
                            <SegmentGroup value={sKey} onChange={onSize} size="sm"
                                items={sizes.map((_$, m) => SegmentGroup.Item(m, <Text>{m.upperCase()}</Text>))} />),
                        Configurator.Control("Open depth", East.print(depth),
                            <Input.Integer value={depth} min={0n} max={5n} step={1n} size="sm" onChange={onDepth} />),
                        Configurator.Slot("Chrome",
                            <HStack gap="5" align="center" wrap="wrap">
                                <Switch checked={toolbarOn} label="Toolbar" onChange={onToolbar} />
                            </HStack>),
                    ]}
                    preview={
                        <Box width="100%" height={boxHeight} overflow="hidden">
                            <ValueTree value={line} onUpdate={onLine} style={{ height: treeHeight, openDepth: depth, toolbar: toolbarOn }} />
                        </Box>
                    }
                    spec={[
                        Configurator.Spec("Machines", East.print(line.machines.size())),
                        Configurator.Spec("Editing", "onUpdate · rebuilt value"),
                    ]}
                />
            );
        }}</Reactive>
    );
    }),
    inputs: [],
});

/**
 * `ValueTree.at` scoping — one entry's edits route to a typed handler;
 * everything else bubbles to the whole-value `onUpdate`.
 */
export const valueTreeScoped = example({
    keywords: ["ValueTree", "at", "scope", "subtree", "handler", "bubble", "onUpdate", "dispatch", "Reactive", "State"],
    description: "Scoped edits — ValueTree.at routes the press entry to a typed handler while the rest bubbles to onUpdate",
    fn: East.function([], UIComponentType, (_$) => {
        const MachineType = StructType({
            name: StringType,
            rate: FloatType,
            operator: OptionType(StringType),
            state: VariantType({ running: NullType, down: StringType }),
        });
        const VALUE_TREE_SCOPED_DATA = new Map([
            ["press", { name: "Press", rate: 2.5, operator: some("dana"), state: variant("running", null) }],
            ["mill", { name: "Mill", rate: 1.25, operator: none, state: variant("down", "belt snapped") }],
        ]);
        return (
        <Reactive>{$ => {
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
            return (
                <ValueTree
                    value={plant}
                    onUpdate={onPlant}
                    at={[ValueTree.at(PlantDict, p => p.entry("press"), onPress)]}
                />
            );
        }}</Reactive>
    );
    }),
    inputs: [],
});

/**
 * Raw `onEdit` paths — hosts with a finer-grained store receive the typed
 * path + leaf instead of a rebuilt value.
 */
export const valueTreePaths = example({
    keywords: ["ValueTree", "onEdit", "path", "leaf", "raw", "typed", "Reactive", "State"],
    description: "Raw paths — onEdit receives the typed path + leaf for hosts with a finer-grained store",
    fn: East.function([], UIComponentType, (_$) => {
        const VALUE_TREE_RAW_PATHS_DATA = new Map([["base", 0.15], ["peak", 0.4]]);
        return (
        <Reactive>{$ => {
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
            return <ValueTree value={rates} onEdit={onEdit} />;
        }}</Reactive>
    );
    }),
    inputs: [],
});
