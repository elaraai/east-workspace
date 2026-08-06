/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, East, NullType, StringType, StructType, example, variant } from "@elaraai/east";
import { State, Style, UIComponentType } from "@elaraai/east-ui";
import { Configurator, Kbd, Reactive, SegmentGroup, Text } from "@elaraai/east-ui";

export const kbdSingle = example({
    keywords: ["Kbd", "Root", "single", "key"],
    description: "Single key pill",
    fn: East.function([], UIComponentType, ($) => {
        return <Kbd keys={["K"]} />;
    }),
    inputs: [],
});

export const kbdVariants = example({
    keywords: ["Kbd", "Root", "chord", "multi-key", "variant", "solid", "size", "density", "condensed", "compact", "comfortable", "Reactive", "State", "SegmentGroup", "Configurator", "getTag", "configurator"],
    description: "Kbd configurator — keys, variant and density axes on one live key pill",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const keySets = $.const([
                { label: "single", keys: ["K"] },
                { label: "chord", keys: ["⌘", "K"] },
                { label: "sequence", keys: ["Ctrl", "Shift", "P"] },
            ], ArrayType(StructType({ label: StringType, keys: ArrayType(StringType) })));
            const variants = $.const(["subtle", "solid"], ArrayType(StringType));
            const densities = $.const([
                variant("condensed", null), variant("compact", null), variant("comfortable", null),
            ], ArrayType(Style.Types.Density));

            const keysBind = $.let(State.bind([StringType], "kbd_keys", "chord"));
            const densityBind = $.let(State.bind([StringType], "kbd_density", "compact"));

            const kKey = $.let(keysBind.read());
            const dKey = $.let(densityBind.read());

            const onKeys = $.const(East.function([StringType], NullType, ($, next) => { $(keysBind.write(next)); }));
            const onDensity = $.const(East.function([StringType], NullType, ($, next) => { $(densityBind.write(next)); }));

            const keySet = $.let(keySets.filter((_$, o) => o.label.equal(kKey)).get(0n));
            const density = $.let(densities.filter((_$, v) => v.getTag().equal(dKey)).get(0n));

            // ONE kbd — the solid brand variant composes on (the subtle
            // default is kbdBasic); keys + density stay live.
            const preview = $.const(
                <Kbd keys={keySet.keys} variant="solid" colorPalette="brand" density={density} />,
            );

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Keys", kKey,
                            <SegmentGroup value={kKey} onChange={onKeys} size="sm"
                                items={keySets.map((_$, o) => SegmentGroup.Item(o.label, <Text>{o.label.upperCase()}</Text>))} />),
                        Configurator.Control("Density", dKey,
                            <SegmentGroup value={dKey} onChange={onDensity} size="sm"
                                items={densities.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                    ]}
                    preview={preview}
                    spec={[
                        Configurator.Spec("Keys", East.print(keySet.keys.size())),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
