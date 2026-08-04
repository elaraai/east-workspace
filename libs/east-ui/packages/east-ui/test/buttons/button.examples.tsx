/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, IntegerType, NullType, StringType, StructType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, Configurator, HStack, SegmentGroup, Style, Switch, Text, Reactive } from "@elaraai/east-ui";

export const buttonBasic = example({
    keywords: ["Button", "Root", "label", "basic", "create"],
    description: "Create a simple button with a text label",
    fn: East.function([], UIComponentType, (_$) => {
        return <Button>Click me</Button>;
    }),
    inputs: [],
});

// ============================================================================
// Button — live configurator over every style axis
// ============================================================================

export const buttonVariants = example({
    keywords: ["Button", "Root", "variant", "solid", "colorPalette", "blue", "size", "outline", "ghost", "red", "danger", "escape-hatch", "color", "hoverBackground", "plain", "unadorned", "style", "background", "borderColor", "branded", "startIcon", "endIcon", "icon", "loading", "loadingText", "loadingIcon", "spinner", "label", "rich", "UIComp", "HStack", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator", "onClick", "Reactive", "State", "callback", "interactive", "counter"],
    description: "Button configurator — variant, palette, size and colour axes plus loading, icons and rich-label switches driving one live button; the aside increments a reactive count",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Enumerated axes are just their variants — `getTag()` gives the
                // segment key AND its label, so there is no parallel table to
                // keep in step.
                const variants = $.const([
                    variant("solid", null), variant("outline", null),
                    variant("ghost", null), variant("plain", null),
                ], ArrayType(Button.Types.Variant));

                const palettes = $.const([
                    variant("brand", null), variant("success", null), variant("warning", null),
                    variant("danger", null), variant("info", null), variant("gray", null),
                ], ArrayType(Style.Types.ColorScheme));

                const sizes = $.const([
                    variant("xs", null), variant("sm", null), variant("md", null), variant("lg", null),
                ], ArrayType(Style.Types.Size));

                // Only colour needs a struct — the four escape-hatch slots move
                // together, with no single value to name them by. The `palette`
                // row carries empty slots because the preview drops the
                // overrides entirely for it (below).
                const colours = $.const([
                    { label: "palette", color: "",           background: "",            borderColor: "",             hover: "" },
                    { label: "link",    color: "link",       background: "transparent", borderColor: "transparent",  hover: "bg.brand.subtle" },
                    { label: "branded", color: "fg.inverse", background: "bg.inverse",  borderColor: "border.brand", hover: "bg.inverse" },
                ], ArrayType(StructType({ label: StringType, color: StringType, background: StringType, borderColor: StringType, hover: StringType })));

                const variantBind = $.let(State.bind([StringType], "button_variant", "solid"));
                const paletteBind = $.let(State.bind([StringType], "button_palette", "brand"));
                const sizeBind    = $.let(State.bind([StringType], "button_size", "md"));
                const colourBind  = $.let(State.bind([StringType], "button_color", "palette"));
                const loadingBind = $.let(State.bind([BooleanType], "button_loading", false));
                const iconsBind   = $.let(State.bind([BooleanType], "button_icons", false));
                const richBind    = $.let(State.bind([BooleanType], "button_rich", false));
                const counter     = $.let(State.bind([IntegerType], "button_counter", 0n));

                const vKey    = $.let(variantBind.read());
                const pKey    = $.let(paletteBind.read());
                const sKey    = $.let(sizeBind.read());
                const cKey    = $.let(colourBind.read());
                const loading = $.let(loadingBind.read());
                const icons   = $.let(iconsBind.read());
                const rich    = $.let(richBind.read());
                const count   = $.let(counter.read());

                const onVariant = $.const(East.function([StringType], NullType, ($, next) => { $(variantBind.write(next)); }));
                const onPalette = $.const(East.function([StringType], NullType, ($, next) => { $(paletteBind.write(next)); }));
                const onSize    = $.const(East.function([StringType], NullType, ($, next) => { $(sizeBind.write(next)); }));
                const onColour  = $.const(East.function([StringType], NullType, ($, next) => { $(colourBind.write(next)); }));
                const onLoading = $.const(East.function([BooleanType], NullType, ($, next) => { $(loadingBind.write(next)); }));
                const onIcons   = $.const(East.function([BooleanType], NullType, ($, next) => { $(iconsBind.write(next)); }));
                const onRich    = $.const(East.function([BooleanType], NullType, ($, next) => { $(richBind.write(next)); }));
                const inc       = $.const(East.function([], NullType, $ => {
                    const cur = $.let(counter.read());
                    $(counter.write(cur.add(1n)));
                }));

                // Each selection is a lookup into the same array the control renders.
                const buttonVariant = $.let(variants.filter((_$, v) => v.getTag().equal(vKey)).get(0n));
                const palette = $.let(palettes.filter((_$, v) => v.getTag().equal(pKey)).get(0n));
                const size = $.let(sizes.filter((_$, v) => v.getTag().equal(sKey)).get(0n));
                const colour = $.let(colours.filter((_$, o) => o.label.equal(cKey)).get(0n));

                // The label is a UIComponentType slot — the rich switch swaps the
                // plain run for an HStack of Texts (primary + muted caption).
                const btnLabel = $.const(rich.ifElse(
                    _$ => (
                        <HStack gap="1" align="center">
                            <Text>Accept</Text>
                            <Text color="fg.inverse">→ log to MES</Text>
                        </HStack>
                    ),
                    _$ => <Text>Save Changes</Text>,
                ));

                // startIcon / endIcon and the colour slots are escape hatches the
                // factory omits from the IR entirely when absent — presence IS
                // the demo — so the preview picks between four buttons (slots ×
                // icons) rather than feeding empty values.
                const btn = $.const(cKey.equal("palette").ifElse(
                    _$ => icons.ifElse(
                        _$ => (
                            <Button variant={buttonVariant} colorPalette={palette} size={size}
                                loading={loading} loadingText="Submitting…" loadingIcon={{ prefix: "fas", name: "spinner" }}
                                startIcon={{ prefix: "fas", name: "save" }} endIcon={{ prefix: "fas", name: "arrow-right" }}>
                                {btnLabel}
                            </Button>
                        ),
                        _$ => (
                            <Button variant={buttonVariant} colorPalette={palette} size={size}
                                loading={loading} loadingText="Submitting…" loadingIcon={{ prefix: "fas", name: "spinner" }}>
                                {btnLabel}
                            </Button>
                        ),
                    ),
                    _$ => icons.ifElse(
                        _$ => (
                            <Button variant={buttonVariant} colorPalette={palette} size={size}
                                loading={loading} loadingText="Submitting…" loadingIcon={{ prefix: "fas", name: "spinner" }}
                                startIcon={{ prefix: "fas", name: "save" }} endIcon={{ prefix: "fas", name: "arrow-right" }}
                                color={colour.color} background={colour.background} borderColor={colour.borderColor} hoverBackground={colour.hover}>
                                {btnLabel}
                            </Button>
                        ),
                        _$ => (
                            <Button variant={buttonVariant} colorPalette={palette} size={size}
                                loading={loading} loadingText="Submitting…" loadingIcon={{ prefix: "fas", name: "spinner" }}
                                color={colour.color} background={colour.background} borderColor={colour.borderColor} hoverBackground={colour.hover}>
                                {btnLabel}
                            </Button>
                        ),
                    ),
                ));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Variant", vKey,
                                <SegmentGroup value={vKey} onChange={onVariant} size="sm"
                                    items={variants.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Palette", pKey,
                                <SegmentGroup value={pKey} onChange={onPalette} size="sm"
                                    items={palettes.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Size", sKey,
                                <SegmentGroup value={sKey} onChange={onSize} size="sm"
                                    items={sizes.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Colour", cKey,
                                <SegmentGroup value={cKey} onChange={onColour} size="sm"
                                    items={colours.map((_$, o) => SegmentGroup.Item(o.label, <Text>{o.label.upperCase()}</Text>))} />),
                            // Slots, not Controls: the switches report as the
                            // Loading / Icons / Label spec rows below rather than
                            // as one value each.
                            Configurator.Slot("State",
                                <HStack gap="5" align="center">
                                    <Switch checked={loading} label="Loading" onChange={onLoading} />
                                </HStack>),
                            Configurator.Slot("Content",
                                <HStack gap="5" align="center">
                                    <Switch checked={icons} label="Icons" onChange={onIcons} />
                                    <Switch checked={rich} label="Rich label" onChange={onRich} />
                                </HStack>),
                        ]}
                        preview={btn}
                        aside={{
                            label: "Count · Reactive",
                            body: (
                                <HStack gap="3" align="center">
                                    <Text>{East.str`Clicked ${East.print(count)} times`}</Text>
                                    <Button size="xs" onClick={inc}>Click me</Button>
                                </HStack>
                            ),
                        }}
                        spec={[
                            Configurator.Spec("Loading", loading.ifElse(_$ => "Submitting… · spinner", _$ => "idle")),
                            Configurator.Spec("Icons", icons.ifElse(_$ => "save · arrow-right", _$ => "none")),
                            Configurator.Spec("Label", rich.ifElse(_$ => "HStack · Accept + caption", _$ => "Save Changes")),
                            Configurator.Spec("Slots", cKey.equal("palette").ifElse(
                                _$ => "variant recipe",
                                _$ => East.str`${colour.color} · ${colour.background} · ${colour.borderColor}`,
                            )),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
