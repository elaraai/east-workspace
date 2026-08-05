/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, IntegerType, NullType, StringType, StructType, example, none, some, variant } from "@elaraai/east";
import { State, Style, UIComponentType } from "@elaraai/east-ui";
import { Configurator, HStack, Reactive, SegmentGroup, Switch, Tag, Text } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const tagBasic = example({
    keywords: ["Tag", "Root", "basic", "filter", "chip"],
    description: "Filter / category chips — outline default, brand when active, dashed for empty",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="2">
                <Tag>region · SE</Tag>
                <Tag variant="brand">cohort · selected</Tag>
                <Tag variant="dashed">+ add filter</Tag>
            </HStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Tag — live configurator over every style axis
// ============================================================================

export const tagStyles = example({
    keywords: ["Tag", "Root", "variant", "outline", "brand", "subtle", "solid", "dashed", "background", "color", "custom", "escape", "opacity", "borderWidth", "borderStyle", "borderRadius", "padding", "width", "overflow", "density", "condensed", "compact", "comfortable", "sizes", "ifElse", "dynamic", "Style", "Reactive", "State", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator", "interactive", "closable", "removable", "onClose"],
    description: "Tag configurator — variant, density, colour, border, opacity and padding axes plus pill / fixed-width / closable switches driving one live chip; the aside resolves a variant via ifElse and counts onClose",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Enumerated axes are just their variants — `getTag()` gives the
                // segment key AND its label, so there is no parallel table to
                // keep in step.
                const variants = $.const([
                    variant("outline", null), variant("brand", null), variant("subtle", null),
                    variant("solid", null), variant("dashed", null),
                ], ArrayType(Style.Types.StyleVariant));

                const densities = $.const([
                    variant("condensed", null), variant("compact", null), variant("comfortable", null),
                ], ArrayType(Style.Types.Density));

                const borders = $.const([
                    variant("solid", null), variant("dashed", null),
                    variant("dotted", null), none,
                ], ArrayType(Style.Types.BorderStyle));

                // Numeric / token axes collapse the same way: an opacity is a
                // percentage and a padding is a spacing-scale token, so both are
                // bare arrays of the value itself.
                const opacities = $.const([100n, 75n, 50n, 25n], ArrayType(IntegerType));
                const paddings = $.const(["0", "1", "2", "3"], ArrayType(StringType));

                // Only colour needs a struct — it is a background/foreground
                // pair, with no single value to name it by.
                const colors = $.const([
                    { label: "recipe", bg: "transparent", fg: "fg.default" },
                    { label: "custom", bg: "status.neg",  fg: "fg.inverse" },
                    { label: "brand",  bg: "brand.600",   fg: "fg.inverse" },
                    { label: "dark",   bg: "bg.inverse",  fg: "fg.inverse" },
                ], ArrayType(StructType({ label: StringType, bg: StringType, fg: StringType })));

                const variantBind = $.let(State.bind([StringType], "tag_variant", "outline"));
                const densityBind = $.let(State.bind([StringType], "tag_density", "compact"));
                const colorBind   = $.let(State.bind([StringType], "tag_color", "recipe"));
                const borderBind  = $.let(State.bind([StringType], "tag_border", "solid"));
                const opacityBind = $.let(State.bind([StringType], "tag_opacity", "100"));
                const paddingBind = $.let(State.bind([StringType], "tag_padding", "0"));
                const pillBind    = $.let(State.bind([BooleanType], "tag_pill", false));
                const wideBind    = $.let(State.bind([BooleanType], "tag_wide", false));
                const activeBind  = $.let(State.bind([BooleanType], "tag_active", true));
                const closableBind = $.let(State.bind([BooleanType], "tag_closable", true));
                const closeCount  = $.let(State.bind([IntegerType], "tag_close_count", 0n));

                const vKey = $.let(variantBind.read());
                const dKey = $.let(densityBind.read());
                const cKey = $.let(colorBind.read());
                const bKey = $.let(borderBind.read());
                const oKey = $.let(opacityBind.read());
                const pKey = $.let(paddingBind.read());
                const pill = $.let(pillBind.read());
                const wide = $.let(wideBind.read());
                const active = $.let(activeBind.read());
                const closable = $.let(closableBind.read());
                const closed = $.let(closeCount.read());

                const onVariant = $.const(East.function([StringType], NullType, ($, next) => { $(variantBind.write(next)); }));
                const onDensity = $.const(East.function([StringType], NullType, ($, next) => { $(densityBind.write(next)); }));
                const onColor   = $.const(East.function([StringType], NullType, ($, next) => { $(colorBind.write(next)); }));
                const onBorder  = $.const(East.function([StringType], NullType, ($, next) => { $(borderBind.write(next)); }));
                const onOpacity = $.const(East.function([StringType], NullType, ($, next) => { $(opacityBind.write(next)); }));
                const onPadding = $.const(East.function([StringType], NullType, ($, next) => { $(paddingBind.write(next)); }));
                const onPill    = $.const(East.function([BooleanType], NullType, ($, next) => { $(pillBind.write(next)); }));
                const onWide    = $.const(East.function([BooleanType], NullType, ($, next) => { $(wideBind.write(next)); }));
                const onActive  = $.const(East.function([BooleanType], NullType, ($, next) => { $(activeBind.write(next)); }));
                const onClosable = $.const(East.function([BooleanType], NullType, ($, next) => { $(closableBind.write(next)); }));
                const onClose   = $.const(East.function([], NullType, $ => {
                    const cur = $.let(closeCount.read());
                    $(closeCount.write(cur.add(1n)));
                }));

                // Each selection is a lookup into the same array the control renders.
                const tagVariant = $.let(variants.filter((_$, v) => v.getTag().equal(vKey)).get(0n));
                const density = $.let(densities.filter((_$, v) => v.getTag().equal(dKey)).get(0n));
                const border = $.let(borders.filter((_$, v) => v.getTag().equal(bKey)).get(0n));
                const opacityPct = $.let(opacities.filter((_$, p) => East.print(p).equal(oKey)).get(0n));
                const color = $.let(colors.filter((_$, o) => o.label.equal(cKey)).get(0n));
                const pad = $.let(paddings.filter((_$, s) => s.equal(pKey)).get(0n));

                // The dynamic axis: a variant resolved by ifElse rather than picked.
                const dynamicVariant = $.let(
                    active.ifElse(_$ => variant("brand", null), _$ => variant("outline", null)),
                    Style.Types.StyleVariant,
                );

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Variant", vKey,
                                <SegmentGroup value={vKey} onChange={onVariant} size="sm"
                                    items={variants.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Density", dKey,
                                <SegmentGroup value={dKey} onChange={onDensity} size="sm"
                                    items={densities.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Colour", cKey,
                                <SegmentGroup value={cKey} onChange={onColor} size="sm"
                                    items={colors.map((_$, o) => SegmentGroup.Item(o.label, <Text>{o.label.upperCase()}</Text>))} />),
                            Configurator.Control("Border", bKey,
                                <SegmentGroup value={bKey} onChange={onBorder} size="sm"
                                    items={borders.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Opacity", East.str`${oKey}%`,
                                <SegmentGroup value={oKey} onChange={onOpacity} size="sm"
                                    items={opacities.map((_$, p) => SegmentGroup.Item(East.print(p), <Text>{East.str`${East.print(p)}%`}</Text>))} />),
                            Configurator.Control("Padding", pKey,
                                <SegmentGroup value={pKey} onChange={onPadding} size="sm"
                                    items={paddings.map((_$, s) => SegmentGroup.Item(s, <Text>{s}</Text>))} />),
                            // A Slot, not a Control: the two switches report as the
                            // Radius / Width / Overflow spec rows below rather than
                            // as one value.
                            Configurator.Slot("Shape",
                                <HStack gap="5" align="center" wrap="wrap">
                                    <Switch checked={pill} label="Pill" onChange={onPill} />
                                    <Switch checked={wide} label="Fixed width" onChange={onWide} />
                                </HStack>),
                            Configurator.Slot("Dynamic",
                                <HStack gap="5" align="center" wrap="wrap">
                                    <Switch checked={active} label="Active" onChange={onActive} />
                                </HStack>),
                            // Filter chips set by the operator always carry a
                            // removable × — the switch drives `closable` and the
                            // preview's onClose feeds the aside counter.
                            Configurator.Slot("Closable",
                                <HStack gap="5" align="center" wrap="wrap">
                                    <Switch checked={closable} label="Closable" onChange={onClosable} />
                                </HStack>),
                        ]}
                        preview={
                            <Tag
                                variant={tagVariant}
                                density={density}
                                borderRadius={pill.ifElse(_$ => "full", _$ => "md")}
                                width={wide.ifElse(_$ => "120px", _$ => "auto")}
                                overflow={wide.ifElse(_$ => variant("hidden", null), _$ => variant("visible", null))}
                                background={color.bg}
                                color={color.fg}
                                borderStyle={border}
                                opacity={opacityPct.toFloat().divide(100.0)}
                                padding={{ top: some(pad), right: some(pad), bottom: some(pad), left: some(pad) }}
                                closable={closable}
                                onClose={onClose}
                            >
                                {East.str`region · ${tagVariant.getTag().upperCase()}`}
                            </Tag>
                        }
                        aside={{
                            label: "Dynamic · onClose",
                            body: (
                                <HStack gap="3" align="center">
                                    <Tag variant={dynamicVariant} density={density}>{East.str`ACTIVE → ${dynamicVariant.getTag().upperCase()}`}</Tag>
                                    <Tag variant={Style.StyleVariant("solid")} density={density}>Style.StyleVariant solid</Tag>
                                    {<Text.MonoLabel>{East.str`CLOSED · ${closed}`}</Text.MonoLabel>}
                                </HStack>
                            ),
                        }}
                        spec={[
                            Configurator.Spec("Radius", pill.ifElse(_$ => "full", _$ => "md")),
                            Configurator.Spec("Width", wide.ifElse(_$ => "120px", _$ => "auto")),
                            Configurator.Spec("Overflow", wide.ifElse(_$ => "hidden", _$ => "visible")),
                            Configurator.Spec("Dynamic", dynamicVariant.getTag()),
                            Configurator.Spec("Closable", closable.ifElse(_$ => "removable ×", _$ => "static")),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
