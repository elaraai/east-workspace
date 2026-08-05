/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, IntegerType, NullType, StringType, StructType, example, none, some, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Badge, Button, Configurator, HStack, SegmentGroup, Style, Switch, Text, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const badgeBasic = example({
    keywords: ["Badge", "Root", "basic", "label"],
    description: "Outlined micro-labels for taxonomic markers (NEW, BETA, PRO)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="2">
                <Badge>New</Badge>
                <Badge>Beta</Badge>
                <Badge>Pro</Badge>
            </HStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Badge — live configurator over every style axis
// ============================================================================

export const badgeStyles = example({
    keywords: ["Badge", "Root", "variant", "brand", "outline", "ok", "warn", "danger", "count", "callout", "pill", "colorPalette", "escape", "custom", "opacity", "background", "color", "width", "justifyContent", "borderWidth", "borderStyle", "borderRadius", "padding", "density", "condensed", "compact", "comfortable", "sizes", "Reactive", "State", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator", "interactive", "counter"],
    description: "Badge configurator — variant, density, colour, border, opacity and padding axes plus pill / fixed-width switches driving one live badge; the aside increments a reactive count",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Enumerated axes are just their variants — `getTag()` gives the
                // segment key AND its label, so there is no parallel table to
                // keep in step.
                const variants = $.const([
                    variant("outline", null), variant("brand", null), variant("ok", null),
                    variant("warn", null), variant("danger", null), variant("count", null),
                    variant("callout", null),
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
                const paddings = $.const(["0", "1", "3"], ArrayType(StringType));

                // Only colour needs a struct — it is a background/foreground
                // pair, with no single value to name it by.
                const colors = $.const([
                    { label: "recipe",   bg: "transparent", fg: "fg.default" },
                    { label: "custom",   bg: "status.neg",  fg: "fg.inverse" },
                    { label: "dark",     bg: "bg.inverse",  fg: "fg.inverse" },
                    { label: "gradient", bg: "linear-gradient(90deg, {colors.brand.500} 0%, {colors.brand.700} 100%)", fg: "fg.inverse" },
                ], ArrayType(StructType({ label: StringType, bg: StringType, fg: StringType })));

                const variantBind = $.let(State.bind([StringType], "badge_variant", "outline"));
                const densityBind = $.let(State.bind([StringType], "badge_density", "compact"));
                const colorBind   = $.let(State.bind([StringType], "badge_color", "recipe"));
                const borderBind  = $.let(State.bind([StringType], "badge_border", "solid"));
                const opacityBind = $.let(State.bind([StringType], "badge_opacity", "100"));
                const paddingBind = $.let(State.bind([StringType], "badge_padding", "0"));
                const pillBind    = $.let(State.bind([BooleanType], "badge_pill", false));
                const wideBind    = $.let(State.bind([BooleanType], "badge_wide", false));
                const counter     = $.let(State.bind([IntegerType], "badge_counter", 0n));

                const vKey = $.let(variantBind.read());
                const dKey = $.let(densityBind.read());
                const cKey = $.let(colorBind.read());
                const bKey = $.let(borderBind.read());
                const oKey = $.let(opacityBind.read());
                const pKey = $.let(paddingBind.read());
                const pill = $.let(pillBind.read());
                const wide = $.let(wideBind.read());
                const count = $.let(counter.read());

                const onVariant = $.const(East.function([StringType], NullType, ($, next) => { $(variantBind.write(next)); }));
                const onDensity = $.const(East.function([StringType], NullType, ($, next) => { $(densityBind.write(next)); }));
                const onColor   = $.const(East.function([StringType], NullType, ($, next) => { $(colorBind.write(next)); }));
                const onBorder  = $.const(East.function([StringType], NullType, ($, next) => { $(borderBind.write(next)); }));
                const onOpacity = $.const(East.function([StringType], NullType, ($, next) => { $(opacityBind.write(next)); }));
                const onPadding = $.const(East.function([StringType], NullType, ($, next) => { $(paddingBind.write(next)); }));
                const onPill    = $.const(East.function([BooleanType], NullType, ($, next) => { $(pillBind.write(next)); }));
                const onWide    = $.const(East.function([BooleanType], NullType, ($, next) => { $(wideBind.write(next)); }));
                const inc       = $.const(East.function([], NullType, $ => {
                    const cur = $.let(counter.read());
                    $(counter.write(cur.add(1n)));
                }));

                // Each selection is a lookup into the same array the control renders.
                const badgeVariant = $.let(variants.filter((_$, v) => v.getTag().equal(vKey)).get(0n));
                const density = $.let(densities.filter((_$, v) => v.getTag().equal(dKey)).get(0n));
                const border = $.let(borders.filter((_$, v) => v.getTag().equal(bKey)).get(0n));
                const opacityPct = $.let(opacities.filter((_$, p) => East.print(p).equal(oKey)).get(0n));
                const color = $.let(colors.filter((_$, o) => o.label.equal(cKey)).get(0n));
                const pad = $.let(paddings.filter((_$, s) => s.equal(pKey)).get(0n));

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
                            // Radius / Width spec rows below rather than as one value.
                            Configurator.Slot("Shape",
                                <HStack gap="5" align="center" wrap="wrap">
                                    <Switch checked={pill} label="Pill" onChange={onPill} />
                                    <Switch checked={wide} label="Fixed width" onChange={onWide} />
                                </HStack>),
                        ]}
                        preview={
                            <Badge
                                variant={badgeVariant}
                                density={density}
                                borderRadius={pill.ifElse(_$ => "full", _$ => "sm")}
                                width={wide.ifElse(_$ => "48px", _$ => "auto")}
                                justifyContent={wide.ifElse(_$ => variant("center", null), _$ => variant("flex-start", null))}
                                background={color.bg}
                                color={color.fg}
                                borderStyle={border}
                                opacity={opacityPct.toFloat().divide(100.0)}
                                padding={{ top: some(pad), right: some(pad), bottom: some(pad), left: some(pad) }}
                            >
                                {badgeVariant.getTag().upperCase()}
                            </Badge>
                        }
                        aside={{
                            label: "Count · Reactive",
                            body: (
                                <HStack gap="3" align="center">
                                    <Badge variant={badgeVariant} density={density}>{East.str`${East.print(count)}`}</Badge>
                                    <Button size="xs" onClick={inc}>Increment</Button>
                                </HStack>
                            ),
                        }}
                        spec={[
                            Configurator.Spec("Radius", pill.ifElse(_$ => "full", _$ => "sm")),
                            Configurator.Spec("Width", wide.ifElse(_$ => "48px", _$ => "auto")),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
