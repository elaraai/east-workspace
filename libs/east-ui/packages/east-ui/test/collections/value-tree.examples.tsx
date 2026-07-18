/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import {
    ArrayType,
    DictType,
    East,
    FloatType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
    example,
    some,
    none,
    variant,
} from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Reactive, ValueTree } from "@elaraai/east-ui";

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
    keywords: ["ValueTree", "onEdit", "leaf", "edit", "Reactive", "State", "path"],
    description: "Editable leaves — onEdit applies the new float at the dict-key path to bound state",
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

export const valueTreeCollections = example({
    keywords: ["ValueTree", "onInsert", "onRemove", "array", "add", "remove", "row"],
    description: "Collection editing — onInsert appends a default element, onRemove drops the indexed one",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const bind = $.let(State.bind([ArrayType(FloatType)], "vt_samples", [1.0, 2.5]));
            const samples = $.let(bind.read());
            const onInsert = $.const(East.function(
                [ValueTree.Types.Path], NullType,
                ($, _path) => {
                    const next = $.let(bind.read());
                    $(next.pushLast(0.0));
                    $(bind.write(next));
                },
            ));
            const onRemove = $.const(East.function(
                [ValueTree.Types.Path], NullType,
                ($, path) => {
                    const idx = $.let(path.get(path.size().subtract(1n)).unwrap("index"));
                    const next = $.let(bind.read().filter((_$, _x, i) => i.notEquals(idx)));
                    $(bind.write(next));
                },
            ));
            return <ValueTree value={samples} onInsert={onInsert} onRemove={onRemove} />;
        }}</Reactive>
    )),
    inputs: [],
});
