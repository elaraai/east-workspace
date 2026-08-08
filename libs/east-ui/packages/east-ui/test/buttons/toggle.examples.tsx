/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, BooleanType, East, NullType, StringType, example, variant } from "@elaraai/east";
import { State, Style, UIComponentType } from "@elaraai/east-ui";
import { Configurator, Reactive, SegmentGroup, Text, Toggle } from "@elaraai/east-ui";

export const toggleGridlines = example({
    keywords: ["Toggle", "Root", "pressed", "toolbar", "gridlines"],
    description: "Toolbar toggle — 'Show gridlines' with a leading icon",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Toggle pressed icon={{ prefix: "fas", name: "table-cells" }} variant="subtle" size="sm">
                Show gridlines
            </Toggle>
        );
    }),
    inputs: [],
});

export const toggleVariants = example({
    keywords: ["Toggle", "Root", "pressed", "variant", "subtle", "outline", "size", "icon", "pressedBackground", "override", "Reactive", "State", "onChange", "SegmentGroup", "Configurator", "getTag", "configurator"],
    description: "Toggle configurator — variant and size axes on one live State-bound toggle with icon and pressed tint composed on",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const variants = $.const([
                variant("subtle", null), variant("outline", null),
            ], ArrayType(Toggle.Types.Variant));
            const sizes = $.const([
                variant("sm", null), variant("md", null), variant("lg", null),
            ], ArrayType(Style.Types.Size));
            const variantBind = $.let(State.bind([StringType], "toggle_variant", "subtle"));
            const sizeBind = $.let(State.bind([StringType], "toggle_size", "sm"));
            const pressedBind = $.let(State.bind([BooleanType], "toggle_pressed", true));

            const vKey = $.let(variantBind.read());
            const sKey = $.let(sizeBind.read());
            const pressed = $.let(pressedBind.read());

            const onVariant = $.const(East.function([StringType], NullType, ($, next) => { $(variantBind.write(next)); }));
            const onSize = $.const(East.function([StringType], NullType, ($, next) => { $(sizeBind.write(next)); }));
            const onPressed = $.const(East.function([BooleanType], NullType, ($, next) => { $(pressedBind.write(next)); }));

            const toggleVariant = $.let(variants.filter((_$, v) => v.getTag().equal(vKey)).get(0n));
            const size = $.let(sizes.filter((_$, v) => v.getTag().equal(sKey)).get(0n));

            // pressedBackground is presence-typed, so the branded switch picks
            // between two toggles.
            // ONE toggle — the icon slot and pressed tint compose on.
            const preview = $.const(
                <Toggle pressed={pressed} onChange={onPressed} variant={toggleVariant} size={size}
                    icon={{ prefix: "fas", name: "rotate" }} pressedBackground="bg.brand.subtle">
                    Auto-refresh
                </Toggle>,
            );

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Variant", vKey,
                            <SegmentGroup value={vKey} onChange={onVariant} size="sm"
                                items={variants.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                        Configurator.Control("Size", sKey,
                            <SegmentGroup value={sKey} onChange={onSize} size="sm"
                                items={sizes.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                    ]}
                    preview={preview}
                    spec={[
                        Configurator.Spec("Pressed", pressed.ifElse(_$ => "on", _$ => "off")),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
