/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, FloatType, IntegerType, NullType, StringType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Avatar, Button, Configurator, HStack, SegmentGroup, Select, Slider, Style, Switch, Text, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const avatarBasic = example({
    keywords: ["Avatar", "Root", "name", "basic"],
    description: "User profile images",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="3">
                <Avatar name="John Doe" />
                <Avatar name="Jane Smith" colorPalette="brand" />
                <Avatar name="Bob Wilson" colorPalette="success" />
            </HStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Avatar — live configurator over every style axis
// ============================================================================

export const avatarVariants = example({
    keywords: ["Avatar", "Root", "size", "xs", "sm", "md", "lg", "colorPalette", "brand", "success", "warning", "danger", "info", "gray", "variant", "solid", "subtle", "outline", "density", "condensed", "compact", "comfortable", "sizes", "opacity", "borderRadius", "name", "initials", "Reactive", "State", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator", "interactive", "counter"],
    description: "Avatar configurator — size, colour, variant, density, opacity and radius axes with a full-name switch driving one live avatar; the aside cycles a name from a counter",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Enumerated axes are just their variants — `getTag()` gives the
                // segment key AND its label, so there is no parallel table to
                // keep in step.
                const sizes = $.const([
                    variant("xs", null), variant("sm", null),
                    variant("md", null), variant("lg", null),
                ], ArrayType(Style.Types.Size));

                const palettes = $.const([
                    variant("brand", null), variant("success", null), variant("warning", null),
                    variant("danger", null), variant("info", null), variant("gray", null),
                ], ArrayType(Style.Types.ColorScheme));

                const variants = $.const([
                    variant("solid", null), variant("subtle", null), variant("outline", null),
                ], ArrayType(Style.Types.StyleVariant));

                const densities = $.const([
                    variant("condensed", null), variant("compact", null), variant("comfortable", null),
                ], ArrayType(Style.Types.Density));

                // Numeric / token axes collapse the same way: an opacity is a
                // percentage and a radius is a CSS token, so both are bare
                // arrays of the value itself.
                const radii = $.const(["full", "md", "0"], ArrayType(StringType));

                const sizeBind    = $.let(State.bind([StringType], "avatar_size", "md"));
                const paletteBind = $.let(State.bind([StringType], "avatar_palette", "brand"));
                const variantBind = $.let(State.bind([StringType], "avatar_variant", "subtle"));
                const densityBind = $.let(State.bind([StringType], "avatar_density", "compact"));
                const opacityBind = $.let(State.bind([FloatType], "avatar_opacity", 1.0));
                const radiusBind  = $.let(State.bind([StringType], "avatar_radius", "full"));
                const fullBind    = $.let(State.bind([BooleanType], "avatar_full_name", true));
                const counter     = $.let(State.bind([IntegerType], "avatar_counter", 0n));

                const sKey = $.let(sizeBind.read());
                const cKey = $.let(paletteBind.read());
                const vKey = $.let(variantBind.read());
                const dKey = $.let(densityBind.read());
                const op = $.let(opacityBind.read());
                const rKey = $.let(radiusBind.read());
                const full = $.let(fullBind.read());
                const count = $.let(counter.read());

                const onSize    = $.const(East.function([StringType], NullType, ($, next) => { $(sizeBind.write(next)); }));
                const onPalette = $.const(East.function([StringType], NullType, ($, next) => { $(paletteBind.write(next)); }));
                const onVariant = $.const(East.function([StringType], NullType, ($, next) => { $(variantBind.write(next)); }));
                const onDensity = $.const(East.function([StringType], NullType, ($, next) => { $(densityBind.write(next)); }));
                const onOpacity = $.const(East.function([FloatType], NullType, ($, next) => { $(opacityBind.write(next)); }));
                const onRadius  = $.const(East.function([StringType], NullType, ($, next) => { $(radiusBind.write(next)); }));
                const onFull    = $.const(East.function([BooleanType], NullType, ($, next) => { $(fullBind.write(next)); }));
                const inc       = $.const(East.function([], NullType, $ => {
                    const cur = $.let(counter.read());
                    $(counter.write(cur.add(1n)));
                }));

                // Each selection is a lookup into the same array the control renders.
                const size = $.let(sizes.filter((_$, v) => v.getTag().equal(sKey)).get(0n));
                const palette = $.let(palettes.filter((_$, v) => v.getTag().equal(cKey)).get(0n));
                const avatarVariant = $.let(variants.filter((_$, v) => v.getTag().equal(vKey)).get(0n));
                const density = $.let(densities.filter((_$, v) => v.getTag().equal(dKey)).get(0n));
                const radius = $.let(radii.filter((_$, r) => r.equal(rKey)).get(0n));

                // The name is the initials source: two words fall back to two
                // initials, one word to one.
                const name = $.let(full.ifElse(_$ => "Jane Smith", _$ => "Quinn"));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Size", sKey,
                                <Select value={sKey} onChange={onSize} size="sm"
                                    items={sizes.map((_$, v) => Select.Item(v.getTag(), v.getTag()))} />),
                            Configurator.Control("Colour", cKey,
                                <Select value={cKey} onChange={onPalette} size="sm"
                                    items={palettes.map((_$, v) => Select.Item(v.getTag(), v.getTag()))} />),
                            Configurator.Control("Variant", vKey,
                                <SegmentGroup value={vKey} onChange={onVariant} size="sm"
                                    items={variants.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Density", dKey,
                                <SegmentGroup value={dKey} onChange={onDensity} size="sm"
                                    items={densities.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Opacity", East.str`${East.print(op.multiply(100.0).toInteger())}%`,
                                <Slider value={op} min={0.0} max={1.0} step={0.05} size="sm" onChange={onOpacity} />),
                            Configurator.Control("Radius", rKey,
                                <SegmentGroup value={rKey} onChange={onRadius} size="sm"
                                    items={radii.map((_$, r) => SegmentGroup.Item(r, <Text>{r.upperCase()}</Text>))} />),
                            // A Slot, not a Control: the switch reports as the
                            // Name / Initials spec rows below rather than as one value.
                            Configurator.Slot("Name",
                                <HStack gap="5" align="center" wrap="wrap">
                                    <Switch checked={full} label="Full name" onChange={onFull} />
                                </HStack>),
                        ]}
                        preview={
                            <Avatar
                                name={name}
                                size={size}
                                colorPalette={palette}
                                variant={avatarVariant}
                                density={density}
                                opacity={op}
                                borderRadius={radius}
                            />
                        }
                        aside={{
                            label: "Cycle · Reactive",
                            body: (
                                <HStack gap="3" align="center">
                                    <Avatar
                                        name={East.str`User ${East.print(count)}`}
                                        size={size}
                                        colorPalette={palette}
                                        variant={avatarVariant}
                                        density={density}
                                    />
                                    <Button size="xs" onClick={inc}>Cycle user</Button>
                                </HStack>
                            ),
                        }}
                        spec={[
                            Configurator.Spec("Name", name),
                            Configurator.Spec("Initials", full.ifElse(_$ => "JS", _$ => "Q")),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
