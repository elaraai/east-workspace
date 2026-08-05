/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, BooleanType, East, NullType, StringType, example, variant } from "@elaraai/east";
import { State, Style, UIComponentType } from "@elaraai/east-ui";
import { AvatarGroup, Configurator, HStack, Reactive, SegmentGroup, Switch, Text } from "@elaraai/east-ui";

export const avatarGroupBasic = example({
    keywords: ["AvatarGroup", "Root", "avatars"],
    description: "Basic avatar group with three avatars",
    fn: East.function([], UIComponentType, ($) => {
        return <AvatarGroup avatars={[{ name: "Alice" }, { name: "Bob" }, { name: "Carol" }]} />;
    }),
    inputs: [],
});

export const avatarGroupVariants = example({
    keywords: ["AvatarGroup", "Root", "size", "sm", "lg", "max", "overflow", "density", "condensed", "compact", "comfortable", "borderColor", "branded", "Reactive", "State", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "AvatarGroup configurator — size and density axes plus max-overflow and branded-border switches on one live group",
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
            const overflowBind = $.let(State.bind([BooleanType], "avatargroup_overflow", true));
            const borderBind = $.let(State.bind([BooleanType], "avatargroup_border", false));

            const sKey = $.let(sizeBind.read());
            const dKey = $.let(densityBind.read());
            const overflowOn = $.let(overflowBind.read());
            const borderOn = $.let(borderBind.read());

            const onSize = $.const(East.function([StringType], NullType, ($, next) => { $(sizeBind.write(next)); }));
            const onDensity = $.const(East.function([StringType], NullType, ($, next) => { $(densityBind.write(next)); }));
            const onOverflow = $.const(East.function([BooleanType], NullType, ($, next) => { $(overflowBind.write(next)); }));
            const onBorder = $.const(East.function([BooleanType], NullType, ($, next) => { $(borderBind.write(next)); }));

            const size = $.let(sizes.filter((_$, v) => v.getTag().equal(sKey)).get(0n));
            const density = $.let(densities.filter((_$, v) => v.getTag().equal(dKey)).get(0n));

            // max and borderColor are presence-typed, so the switches pick
            // between prebuilt groups.
            const preview = $.const(overflowOn.ifElse(
                _$ => borderOn.ifElse(
                    _$ => <AvatarGroup avatars={[{ name: "Alice" }, { name: "Bob" }, { name: "Carol" }, { name: "Dan" }, { name: "Eve" }]} max={3n} size={size} density={density} borderColor="border.brand" />,
                    _$ => <AvatarGroup avatars={[{ name: "Alice" }, { name: "Bob" }, { name: "Carol" }, { name: "Dan" }, { name: "Eve" }]} max={3n} size={size} density={density} />,
                ),
                _$ => borderOn.ifElse(
                    _$ => <AvatarGroup avatars={[{ name: "Alice" }, { name: "Bob" }, { name: "Carol" }]} size={size} density={density} borderColor="border.brand" />,
                    _$ => <AvatarGroup avatars={[{ name: "Alice" }, { name: "Bob" }, { name: "Carol" }]} size={size} density={density} />,
                ),
            ));

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Size", sKey,
                            <SegmentGroup value={sKey} onChange={onSize} size="sm"
                                items={sizes.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                        Configurator.Control("Density", dKey,
                            <SegmentGroup value={dKey} onChange={onDensity} size="sm"
                                items={densities.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                        Configurator.Slot("Members",
                            <HStack gap="5" align="center">
                                <Switch checked={overflowOn} label="Overflow +N" onChange={onOverflow} />
                                <Switch checked={borderOn} label="Branded border" onChange={onBorder} />
                            </HStack>),
                    ]}
                    preview={preview}
                    spec={[
                        Configurator.Spec("Avatars", overflowOn.ifElse(_$ => "5 · max 3", _$ => "3")),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
