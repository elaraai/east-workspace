/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, IntegerType, NullType, StringType, StructType, example, none, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Configurator, HStack, IconButton, Reactive, SegmentGroup, Stat, Style, Switch, Text } from "@elaraai/east-ui";

export const iconButtonBasic = example({
    keywords: ["IconButton", "Root", "label", "aria-label", "close"],
    description: "Icon-only close affordance with required aria-label",
    fn: East.function([], UIComponentType, (_$) => {
        return <IconButton prefix="fas" name="xmark" label="Close" variant="ghost" />;
    }),
    inputs: [],
});

// ============================================================================
// IconButton — live configurator over every style axis
// ============================================================================

export const iconButtonVariants = example({
    keywords: ["IconButton", "Root", "loading", "loadingIcon", "spinner", "style", "color", "background", "borderColor", "branded", "badge", "count", "notification", "attention", "pulse", "ring", "dot", "onClick", "Reactive", "State", "counter", "interactive", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "IconButton configurator — glyph, size, palette, colour, badge and attention axes plus a loading switch driving one live icon button; the aside folds the reactive click counter",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Enumerated axes are just their variants — `getTag()` gives the
                // segment key AND its label, so there is no parallel table to
                // keep in step.
                const sizes = $.const([
                    variant("xs", null), variant("sm", null), variant("md", null), variant("lg", null),
                ], ArrayType(Style.Types.Size));

                const palettes = $.const([
                    variant("brand", null), variant("success", null), variant("warning", null),
                    variant("danger", null), variant("info", null), variant("gray", null),
                ], ArrayType(Style.Types.ColorScheme));

                const attentions = $.const([
                    none, variant("pulse", null), variant("ring", null),
                ], ArrayType(IconButton.Types.Attention));

                // The badge forms need a struct — a badge is its superscript text
                // PLUS the bubble palette that reads with it (`""` renders the
                // dot-only indicator), so there is no single value to name it by.
                const badges = $.const([
                    { label: "count", text: "3",   palette: variant("danger", null) },
                    { label: "99+",   text: "99+", palette: variant("warning", null) },
                    { label: "dot",   text: "",    palette: variant("danger", null) },
                ], ArrayType(StructType({ label: StringType, text: StringType, palette: Style.Types.ColorScheme })));

                const glyphBind     = $.let(State.bind([StringType], "icon_button_glyph", "bell"));
                const sizeBind      = $.let(State.bind([StringType], "icon_button_size", "md"));
                const paletteBind   = $.let(State.bind([StringType], "icon_button_palette", "brand"));
                const colourBind    = $.let(State.bind([StringType], "icon_button_color", "palette"));
                const badgeBind     = $.let(State.bind([StringType], "icon_button_badge", "count"));
                const attentionBind = $.let(State.bind([StringType], "icon_button_attention", "none"));
                const loadingBind   = $.let(State.bind([BooleanType], "icon_button_loading", false));
                const counter       = $.let(State.bind([IntegerType], "icon_button_counter", 0n));

                const gKey    = $.let(glyphBind.read());
                const sKey    = $.let(sizeBind.read());
                const pKey    = $.let(paletteBind.read());
                const cKey    = $.let(colourBind.read());
                const bKey    = $.let(badgeBind.read());
                const aKey    = $.let(attentionBind.read());
                const loading = $.let(loadingBind.read());
                const count   = $.let(counter.read());

                const onGlyph     = $.const(East.function([StringType], NullType, ($, next) => { $(glyphBind.write(next)); }));
                const onSize      = $.const(East.function([StringType], NullType, ($, next) => { $(sizeBind.write(next)); }));
                const onPalette   = $.const(East.function([StringType], NullType, ($, next) => { $(paletteBind.write(next)); }));
                const onColour    = $.const(East.function([StringType], NullType, ($, next) => { $(colourBind.write(next)); }));
                const onBadge     = $.const(East.function([StringType], NullType, ($, next) => { $(badgeBind.write(next)); }));
                const onAttention = $.const(East.function([StringType], NullType, ($, next) => { $(attentionBind.write(next)); }));
                const onLoading   = $.const(East.function([BooleanType], NullType, ($, next) => { $(loadingBind.write(next)); }));
                const inc         = $.const(East.function([], NullType, $ => {
                    const cur = $.let(counter.read());
                    $(counter.write(cur.add(1n)));
                }));

                // Each selection is a lookup into the same array the control renders.
                const size = $.let(sizes.filter((_$, v) => v.getTag().equal(sKey)).get(0n));
                const palette = $.let(palettes.filter((_$, v) => v.getTag().equal(pKey)).get(0n));
                const attention = $.let(attentions.filter((_$, v) => v.getTag().equal(aKey)).get(0n));
                const bdg = $.let(badges.filter((_$, o) => o.label.equal(bKey)).get(0n));

                // The glyph axis carries its own rendered value: a Font Awesome
                // identity is a COMPILE-TIME pair — `prefix` / `name` / `label`
                // take host literals, never expressions — so each row holds the
                // built button beside the identity it renders. And because the
                // colour slots are escape hatches the factory omits from the IR
                // entirely when absent, each row holds the palette-recipe build
                // AND the branded build: `palette` is the absence of the props,
                // not an empty value of them, and the preview picks between the
                // two. Every button takes the live style axes.
                const glyphs = $.const([
                    {
                        label: "bell", prefix: "fas", name: "bell", aria: "Alerts",
                        button: <IconButton prefix="fas" name="bell" label="Alerts" size={size} colorPalette={palette} badge={bdg.text} badgeColorPalette={bdg.palette} attention={attention} loading={loading} loadingIcon={{ prefix: "fas", name: "spinner" }} />,
                        branded: <IconButton prefix="fas" name="bell" label="Alerts" size={size} colorPalette={palette} badge={bdg.text} badgeColorPalette={bdg.palette} attention={attention} loading={loading} loadingIcon={{ prefix: "fas", name: "spinner" }} color="fg.inverse" background="bg.inverse" borderColor="border.brand" hoverBackground="bg.inverse" />,
                    },
                    {
                        label: "rotate", prefix: "fas", name: "rotate", aria: "Refresh",
                        button: <IconButton prefix="fas" name="rotate" label="Refresh" size={size} colorPalette={palette} badge={bdg.text} badgeColorPalette={bdg.palette} attention={attention} loading={loading} loadingIcon={{ prefix: "fas", name: "spinner" }} />,
                        branded: <IconButton prefix="fas" name="rotate" label="Refresh" size={size} colorPalette={palette} badge={bdg.text} badgeColorPalette={bdg.palette} attention={attention} loading={loading} loadingIcon={{ prefix: "fas", name: "spinner" }} color="fg.inverse" background="bg.inverse" borderColor="border.brand" hoverBackground="bg.inverse" />,
                    },
                    {
                        label: "rocket", prefix: "fas", name: "rocket", aria: "Deploy",
                        button: <IconButton prefix="fas" name="rocket" label="Deploy" size={size} colorPalette={palette} badge={bdg.text} badgeColorPalette={bdg.palette} attention={attention} loading={loading} loadingIcon={{ prefix: "fas", name: "spinner" }} />,
                        branded: <IconButton prefix="fas" name="rocket" label="Deploy" size={size} colorPalette={palette} badge={bdg.text} badgeColorPalette={bdg.palette} attention={attention} loading={loading} loadingIcon={{ prefix: "fas", name: "spinner" }} color="fg.inverse" background="bg.inverse" borderColor="border.brand" hoverBackground="bg.inverse" />,
                    },
                    {
                        label: "inbox", prefix: "fas", name: "inbox", aria: "Unread",
                        button: <IconButton prefix="fas" name="inbox" label="Unread" size={size} colorPalette={palette} badge={bdg.text} badgeColorPalette={bdg.palette} attention={attention} loading={loading} loadingIcon={{ prefix: "fas", name: "spinner" }} />,
                        branded: <IconButton prefix="fas" name="inbox" label="Unread" size={size} colorPalette={palette} badge={bdg.text} badgeColorPalette={bdg.palette} attention={attention} loading={loading} loadingIcon={{ prefix: "fas", name: "spinner" }} color="fg.inverse" background="bg.inverse" borderColor="border.brand" hoverBackground="bg.inverse" />,
                    },
                ], ArrayType(StructType({ label: StringType, prefix: StringType, name: StringType, aria: StringType, button: UIComponentType, branded: UIComponentType })));

                const glyph = $.let(glyphs.filter((_$, g) => g.label.equal(gKey)).get(0n));
                const btn = $.const(cKey.equal("palette").ifElse(_$ => glyph.button, _$ => glyph.branded));

                // The colour axis is two-valued — palette recipe or the branded
                // slot set — so a bare array of the two keys is the whole table.
                const colours = $.const(["palette", "branded"], ArrayType(StringType));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Glyph", gKey,
                                <SegmentGroup value={gKey} onChange={onGlyph} size="sm"
                                    items={glyphs.map((_$, g) => SegmentGroup.Item(g.label, <Text>{g.label.upperCase()}</Text>))} />),
                            Configurator.Control("Size", sKey,
                                <SegmentGroup value={sKey} onChange={onSize} size="sm"
                                    items={sizes.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Palette", pKey,
                                <SegmentGroup value={pKey} onChange={onPalette} size="sm"
                                    items={palettes.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Colour", cKey,
                                <SegmentGroup value={cKey} onChange={onColour} size="sm"
                                    items={colours.map((_$, s) => SegmentGroup.Item(s, <Text>{s.upperCase()}</Text>))} />),
                            Configurator.Control("Badge", bKey,
                                <SegmentGroup value={bKey} onChange={onBadge} size="sm"
                                    items={badges.map((_$, o) => SegmentGroup.Item(o.label, <Text>{o.label.upperCase()}</Text>))} />),
                            Configurator.Control("Attention", aKey,
                                <SegmentGroup value={aKey} onChange={onAttention} size="sm"
                                    items={attentions.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            // A Slot, not a Control: the switch reports as the
                            // Loading spec row below rather than as one value.
                            Configurator.Slot("State",
                                <HStack gap="5" align="center" wrap="wrap">
                                    <Switch checked={loading} label="Loading" onChange={onLoading} />
                                </HStack>),
                        ]}
                        preview={btn}
                        aside={{
                            label: "Clicks · Reactive",
                            body: (
                                <HStack gap="3" align="center">
                                    <Stat label="Clicks" value={East.print(count)} />
                                    <IconButton prefix="fas" name="plus" label="Increment" onClick={inc} variant="solid" colorPalette="brand" />
                                </HStack>
                            ),
                        }}
                        spec={[
                            Configurator.Spec("Font Awesome", East.str`${glyph.prefix} fa-${glyph.name}`),
                            Configurator.Spec("Aria label", glyph.aria),
                            Configurator.Spec("Slots", cKey.equal("palette").ifElse(
                                _$ => "palette recipe",
                                _$ => "fg.inverse · bg.inverse · border.brand",
                            )),
                            Configurator.Spec("Loading", loading.ifElse(_$ => "spinner swap", _$ => "idle")),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
