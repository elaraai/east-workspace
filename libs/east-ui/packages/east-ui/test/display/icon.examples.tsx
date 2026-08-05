/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, FloatType, IntegerType, NullType, StringType, StructType, example, some, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Box, Button, Configurator, Icon, HStack, Reactive, SegmentGroup, Select, Slider, Text } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const iconBasic = example({
    keywords: ["Icon", "Root", "fas", "FontAwesome"],
    description: "Font Awesome icons",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="4">
                <Icon prefix="fas" name="house" />
                <Icon prefix="fas" name="user" />
                <Icon prefix="fas" name="gear" />
                <Icon prefix="fas" name="bell" />
                <Icon prefix="fas" name="heart" />
                <Icon prefix="fas" name="star" />
            </HStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Icon — live configurator over every style axis
// ============================================================================

export const iconStyles = example({
    keywords: ["Icon", "Root", "fas", "far", "fab", "FontAwesome", "prefix", "name", "glyph", "solid", "regular", "brands", "size", "xs", "sm", "md", "lg", "xl", "2xl", "color", "tint", "colorPalette", "opacity", "background", "borderRadius", "padding", "tile", "label", "aria-hidden", "decorative", "Reactive", "State", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator", "interactive", "toggle"],
    description: "Icon configurator — glyph, size, tint, opacity, tile and padding axes driving one live glyph; the aside sets it on a text baseline and toggles a star / heart on click",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Enumerated axes are just their variants — `getTag()` gives the
                // segment key AND its label, so there is no parallel table to
                // keep in step.
                const sizes = $.const([
                    variant("xs", null), variant("sm", null), variant("md", null),
                    variant("lg", null), variant("xl", null), variant("2xl", null),
                ], ArrayType(Icon.Types.Size));

                // Numeric / token axes collapse the same way: a tint is a colour
                // token, an opacity is a percentage and a padding is a
                // spacing-scale token, so all three are bare arrays of the value.
                const tints = $.const([
                    "fg.default", "fg.success", "fg.warning", "fg.danger", "link",
                ], ArrayType(StringType));
                const paddings = $.const(["0", "1", "3"], ArrayType(StringType));

                // Only the tile needs a struct — it is a background/radius pair,
                // with no single value to name it by.
                const tiles = $.const([
                    { label: "none",  background: "transparent",       radius: "0" },
                    { label: "plate", background: "bg.muted",          radius: "sm" },
                    { label: "brand", background: "bg.brand.subtle",   radius: "md" },
                    { label: "disc",  background: "bg.success.subtle", radius: "full" },
                ], ArrayType(StructType({ label: StringType, background: StringType, radius: StringType })));

                const glyphBind   = $.let(State.bind([StringType], "icon_glyph", "solid"));
                const sizeBind    = $.let(State.bind([StringType], "icon_size", "2xl"));
                const tintBind    = $.let(State.bind([StringType], "icon_tint", "fg.default"));
                const opacityBind = $.let(State.bind([FloatType], "icon_opacity", 1.0));
                const tileBind    = $.let(State.bind([StringType], "icon_tile", "none"));
                const paddingBind = $.let(State.bind([StringType], "icon_padding", "0"));
                // The aside's toggle is the reactive row — clicking flips the
                // counter's parity, which swaps the star / heart glyph (the old
                // interactive example's key).
                const counter     = $.let(State.bind([IntegerType], "icon_counter", 0n));

                const gKey = $.let(glyphBind.read());
                const sKey = $.let(sizeBind.read());
                const tKey = $.let(tintBind.read());
                const opacity = $.let(opacityBind.read());
                const bKey = $.let(tileBind.read());
                const pKey = $.let(paddingBind.read());
                const clicks = $.let(counter.read());

                const isStar = $.let(clicks.remainder(2n).equal(0n));
                const toggled = $.let(isStar.ifElse(
                    () => <Icon prefix="fas" name="star" size="2xl" colorPalette="warning" />,
                    () => <Icon prefix="fas" name="heart" size="2xl" colorPalette="danger" />,
                ));

                const onGlyph   = $.const(East.function([StringType], NullType, ($, next) => { $(glyphBind.write(next)); }));
                const onSize    = $.const(East.function([StringType], NullType, ($, next) => { $(sizeBind.write(next)); }));
                const onTint    = $.const(East.function([StringType], NullType, ($, next) => { $(tintBind.write(next)); }));
                const onOpacity = $.const(East.function([FloatType], NullType, ($, next) => { $(opacityBind.write(next)); }));
                const onTile    = $.const(East.function([StringType], NullType, ($, next) => { $(tileBind.write(next)); }));
                const onPadding = $.const(East.function([StringType], NullType, ($, next) => { $(paddingBind.write(next)); }));
                const inc       = $.const(East.function([], NullType, $ => {
                    const cur = $.let(counter.read());
                    $(counter.write(cur.add(1n)));
                }));

                // Each selection is a lookup into the same array the control renders.
                const size = $.let(sizes.filter((_$, v) => v.getTag().equal(sKey)).get(0n));
                const tint = $.let(tints.filter((_$, t) => t.equal(tKey)).get(0n));
                const tile = $.let(tiles.filter((_$, o) => o.label.equal(bKey)).get(0n));
                const padToken = $.let(paddings.filter((_$, s) => s.equal(pKey)).get(0n));

                const pad = $.let({ top: some(padToken), right: some(padToken), bottom: some(padToken), left: some(padToken) }, Box.Types.Padding);

                // The glyph axis is the one that carries its own rendered value:
                // a Font Awesome identity is a COMPILE-TIME pair — `prefix` and
                // `name` take host literals, never expressions — so each row
                // holds the built icon beside the identity it renders. Still one
                // array: the control, the preview and the spec readout all read
                // these same rows, and every icon takes the live style axes.
                const glyphs = $.const([
                    { label: "regular", prefix: "far", name: "bookmark", icon: <Icon prefix="far" name="bookmark" size={size} color={tint} opacity={opacity} background={tile.background} borderRadius={tile.radius} padding={pad} /> },
                    { label: "solid",   prefix: "fas", name: "bookmark", icon: <Icon prefix="fas" name="bookmark" size={size} color={tint} opacity={opacity} background={tile.background} borderRadius={tile.radius} padding={pad} /> },
                    { label: "github",  prefix: "fab", name: "github",   icon: <Icon prefix="fab" name="github"   size={size} color={tint} opacity={opacity} background={tile.background} borderRadius={tile.radius} padding={pad} /> },
                    { label: "twitter", prefix: "fab", name: "twitter",  icon: <Icon prefix="fab" name="twitter"  size={size} color={tint} opacity={opacity} background={tile.background} borderRadius={tile.radius} padding={pad} /> },
                    { label: "react",   prefix: "fab", name: "react",    icon: <Icon prefix="fab" name="react"    size={size} color={tint} opacity={opacity} background={tile.background} borderRadius={tile.radius} padding={pad} /> },
                ], ArrayType(StructType({ label: StringType, prefix: StringType, name: StringType, icon: UIComponentType })));

                const glyph = $.let(glyphs.filter((_$, g) => g.label.equal(gKey)).get(0n));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Glyph", gKey,
                                <Select value={gKey} onChange={onGlyph} size="sm"
                                    items={glyphs.map((_$, g) => Select.Item(g.label, g.label))} />),
                            Configurator.Control("Size", sKey,
                                <Select value={sKey} onChange={onSize} size="sm"
                                    items={sizes.map((_$, v) => Select.Item(v.getTag(), v.getTag()))} />),
                            Configurator.Control("Tint", tKey,
                                <Select value={tKey} onChange={onTint} size="sm"
                                    items={tints.map((_$, t) => Select.Item(t, t))} />),
                            Configurator.Control("Opacity", East.str`${East.print(opacity.multiply(100.0).toInteger())}%`,
                                <Slider value={opacity} min={0.0} max={1.0} step={0.05} size="sm" onChange={onOpacity} />),
                            Configurator.Control("Tile", bKey,
                                <Select value={bKey} onChange={onTile} size="sm"
                                    items={tiles.map((_$, o) => Select.Item(o.label, o.label))} />),
                            Configurator.Control("Padding", pKey,
                                <SegmentGroup value={pKey} onChange={onPadding} size="sm"
                                    items={paddings.map((_$, s) => SegmentGroup.Item(s, <Text>{s}</Text>))} />),
                        ]}
                        preview={glyph.icon}
                        aside={{
                            label: "Inline · Reactive",
                            body: (
                                <HStack gap="2" align="center">
                                    <Text>Reads inline with body copy</Text>
                                    {glyph.icon}
                                    {toggled}
                                    <Button size="xs" onClick={inc}>Toggle icon</Button>
                                </HStack>
                            ),
                        }}
                        spec={[
                            // The tile control reports only its name, so the pair it
                            // stands for gets its own spec rows.
                            Configurator.Spec("Font Awesome", East.str`${glyph.prefix} fa-${glyph.name}`),
                            Configurator.Spec("Background", tile.background),
                            Configurator.Spec("Radius", tile.radius),
                            Configurator.Spec("Aria", "aria-hidden — decorative, no label passed"),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

