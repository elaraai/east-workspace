/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, East, NullType, StringType, example, variant } from "@elaraai/east";
import { State, Style, UIComponentType } from "@elaraai/east-ui";
import { AvatarGroup, Configurator, Reactive, SegmentGroup, Text } from "@elaraai/east-ui";

export const avatarGroupBasic = example({
    keywords: ["AvatarGroup", "Root", "avatars"],
    description: "Basic avatar group with three avatars",
    fn: East.function([], UIComponentType, ($) => {
        return <AvatarGroup avatars={[{ name: "Alice" }, { name: "Bob" }, { name: "Carol" }]} />;
    }),
    inputs: [],
});

export const avatarGroupVariants = example({
    keywords: ["AvatarGroup", "Root", "size", "sm", "lg", "max", "overflow", "density", "condensed", "compact", "comfortable", "borderColor", "branded", "Reactive", "State", "SegmentGroup", "Configurator", "getTag", "configurator"],
    description: "AvatarGroup configurator — size and density axes on one live group with the +N overflow and branded border composed on",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const sizes = $.const([
                variant("sm", null), variant("md", null), variant("lg", null),
            ], ArrayType(Style.Types.Size));
            const densities = $.const([
                variant("condensed", null), variant("compact", null), variant("comfortable", null),
            ], ArrayType(Style.Types.Density));

            const sizeBind = $.let(State.bind([StringType], "avatargroup_size", "md"));
            const densityBind = $.let(State.bind([StringType], "avatargroup_density", "compact"));

            const sKey = $.let(sizeBind.read());
            const dKey = $.let(densityBind.read());

            const onSize = $.const(East.function([StringType], NullType, ($, next) => { $(sizeBind.write(next)); }));
            const onDensity = $.const(East.function([StringType], NullType, ($, next) => { $(densityBind.write(next)); }));

            const size = $.let(sizes.filter((_$, v) => v.getTag().equal(sKey)).get(0n));
            const density = $.let(densities.filter((_$, v) => v.getTag().equal(dKey)).get(0n));

            // max and borderColor are presence-typed, so the switches pick
            // between prebuilt groups.
            // ONE group — the overflow +N chip and the branded border are
            // presence-typed, so both compose on permanently.
            const preview = $.const(
                <AvatarGroup avatars={[{ name: "Alice" }, { name: "Bob" }, { name: "Carol" }, { name: "Dan" }, { name: "Eve" }]} max={3n} size={size} density={density} borderColor="border.brand" />,
            );

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Size", sKey,
                            <SegmentGroup value={sKey} onChange={onSize} size="sm"
                                items={sizes.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                        Configurator.Control("Density", dKey,
                            <SegmentGroup value={dKey} onChange={onDensity} size="sm"
                                items={densities.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                    ]}
                    preview={preview}
                    spec={[
                        Configurator.Spec("Avatars", "5 · max 3"),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
