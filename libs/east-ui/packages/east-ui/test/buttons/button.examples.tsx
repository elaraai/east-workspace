/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, IntegerType, NullType, StringType, StructType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, Configurator, HStack, SegmentGroup, Select, Style, Switch, Text, Reactive } from "@elaraai/east-ui";

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

                const variantBind = $.let(State.bind([StringType], "button_variant", "solid"));
                const paletteBind = $.let(State.bind([StringType], "button_palette", "brand"));
                const sizeBind    = $.let(State.bind([StringType], "button_size", "md"));
                const loadingBind = $.let(State.bind([BooleanType], "button_loading", false));
                const richBind    = $.let(State.bind([BooleanType], "button_rich", false));
                const counter     = $.let(State.bind([IntegerType], "button_counter", 0n));

                const vKey    = $.let(variantBind.read());
                const pKey    = $.let(paletteBind.read());
                const sKey    = $.let(sizeBind.read());
                const loading = $.let(loadingBind.read());
                const rich    = $.let(richBind.read());
                const count   = $.let(counter.read());

                const onVariant = $.const(East.function([StringType], NullType, ($, next) => { $(variantBind.write(next)); }));
                const onPalette = $.const(East.function([StringType], NullType, ($, next) => { $(paletteBind.write(next)); }));
                const onSize    = $.const(East.function([StringType], NullType, ($, next) => { $(sizeBind.write(next)); }));
                const onLoading = $.const(East.function([BooleanType], NullType, ($, next) => { $(loadingBind.write(next)); }));
                const onRich    = $.const(East.function([BooleanType], NullType, ($, next) => { $(richBind.write(next)); }));
                const inc       = $.const(East.function([], NullType, $ => {
                    const cur = $.let(counter.read());
                    $(counter.write(cur.add(1n)));
                }));

                // Each selection is a lookup into the same array the control renders.
                const buttonVariant = $.let(variants.filter((_$, v) => v.getTag().equal(vKey)).get(0n));
                const palette = $.let(palettes.filter((_$, v) => v.getTag().equal(pKey)).get(0n));
                const size = $.let(sizes.filter((_$, v) => v.getTag().equal(sKey)).get(0n));

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

                // ONE button — the icon slots compose on permanently; the raw
                // colour escape hatches live in their own example.
                const btn = $.const(
                    <Button variant={buttonVariant} colorPalette={palette} size={size}
                        loading={loading} loadingText="Submitting…" loadingIcon={{ prefix: "fas", name: "spinner" }}
                        startIcon={{ prefix: "fas", name: "save" }} endIcon={{ prefix: "fas", name: "arrow-right" }}>
                        {btnLabel}
                    </Button>,
                );

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Variant", vKey,
                                <Select value={vKey} onChange={onVariant} size="sm"
                                    items={variants.map((_$, v) => Select.Item(v.getTag(), v.getTag()))} />),
                            Configurator.Control("Palette", pKey,
                                <Select value={pKey} onChange={onPalette} size="sm"
                                    items={palettes.map((_$, v) => Select.Item(v.getTag(), v.getTag()))} />),
                            Configurator.Control("Size", sKey,
                                <Select value={sKey} onChange={onSize} size="sm"
                                    items={sizes.map((_$, v) => Select.Item(v.getTag(), v.getTag()))} />),
                            // Slots, not Controls: the switches report as the
                            // Loading / Icons / Label spec rows below rather than
                            // as one value each.
                            Configurator.Slot("State",
                                <HStack gap="5" align="center" wrap="wrap">
                                    <Switch checked={loading} label="Loading" onChange={onLoading} />
                                </HStack>),
                            Configurator.Slot("Content",
                                <HStack gap="5" align="center" wrap="wrap">
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
                            Configurator.Spec("Label", rich.ifElse(_$ => "HStack · Accept + caption", _$ => "Save Changes")),
                            Configurator.Spec("Slots", "variant recipe"),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

/** Raw colour escape hatches — branded ink and plain unadorned buttons. */
export const buttonCustomColours = example({
    keywords: ["Button", "escape-hatch", "color", "background", "borderColor", "hoverBackground", "branded", "plain", "unadorned", "override", "link"],
    description: "Colour escape hatches — link and branded-ink buttons beside the recipe default",
    fn: East.function([], UIComponentType, (_$) => (
        <HStack gap="3" align="center">
            <Button variant="solid" colorPalette="brand">Recipe</Button>
            <Button variant="ghost" color="link" background="transparent" borderColor="transparent" hoverBackground="bg.brand.subtle">Link</Button>
            <Button variant="solid" color="fg.inverse" background="bg.inverse" borderColor="border.brand" hoverBackground="bg.inverse">Branded</Button>
        </HStack>
    )),
    inputs: [],
});
