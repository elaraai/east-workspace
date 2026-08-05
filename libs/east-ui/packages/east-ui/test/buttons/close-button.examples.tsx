/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, East, IntegerType, NullType, StringType, example, variant } from "@elaraai/east";
import { State, Style, UIComponentType } from "@elaraai/east-ui";
import { CloseButton, Configurator, Reactive, SegmentGroup, Text } from "@elaraai/east-ui";

export const closeButtonBasic = example({
    keywords: ["CloseButton", "Root", "dismiss", "default"],
    description: "Default CloseButton — aria-label renders as 'Close'",
    fn: East.function([], UIComponentType, (_$) => {
        return <CloseButton />;
    }),
    inputs: [],
});

export const closeButtonVariants = example({
    keywords: ["CloseButton", "Root", "variant", "ghost", "subtle", "solid", "size", "label", "aria-label", "localised", "color", "background", "branded", "onClick", "Reactive", "State", "dismiss", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "CloseButton configurator — variant, size and colour axes on one live button with a custom aria-label; the aside counts dismissals",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const variants = $.const([
                variant("ghost", null), variant("subtle", null), variant("solid", null),
            ], ArrayType(CloseButton.Types.Variant));
            const sizes = $.const([
                variant("sm", null), variant("md", null), variant("lg", null),
            ], ArrayType(Style.Types.Size));
            const colours = $.const(["recipe", "branded"], ArrayType(StringType));

            const variantBind = $.let(State.bind([StringType], "closebutton_variant", "ghost"));
            const sizeBind = $.let(State.bind([StringType], "closebutton_size", "md"));
            const colourBind = $.let(State.bind([StringType], "closebutton_colour", "recipe"));
            const countBind = $.let(State.bind([IntegerType], "closebutton_count", 0n));

            const vKey = $.let(variantBind.read());
            const sKey = $.let(sizeBind.read());
            const cKey = $.let(colourBind.read());
            const count = $.let(countBind.read());

            const onVariant = $.const(East.function([StringType], NullType, ($, next) => { $(variantBind.write(next)); }));
            const onSize = $.const(East.function([StringType], NullType, ($, next) => { $(sizeBind.write(next)); }));
            const onColour = $.const(East.function([StringType], NullType, ($, next) => { $(colourBind.write(next)); }));
            const dismiss = $.const(East.function([], NullType, $ => {
                const cur = $.let(countBind.read());
                $(countBind.write(cur.add(1n)));
            }));

            const buttonVariant = $.let(variants.filter((_$, v) => v.getTag().equal(vKey)).get(0n));
            const size = $.let(sizes.filter((_$, v) => v.getTag().equal(sKey)).get(0n));

            // The colour escape hatches are presence-typed, so the colour axis
            // picks between two buttons.
            const preview = $.const(cKey.equal("branded").ifElse(
                _$ => (
                    <CloseButton label="Dismiss banner" variant={buttonVariant} size={size} onClick={dismiss}
                        color="fg.inverse" background="bg.inverse" hoverBackground="bg.inverse" />
                ),
                _$ => (
                    <CloseButton label="Dismiss banner" variant={buttonVariant} size={size} onClick={dismiss} />
                ),
            ));

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Variant", vKey,
                            <SegmentGroup value={vKey} onChange={onVariant} size="sm"
                                items={variants.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                        Configurator.Control("Size", sKey,
                            <SegmentGroup value={sKey} onChange={onSize} size="sm"
                                items={sizes.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                        Configurator.Control("Colour", cKey,
                            <SegmentGroup value={cKey} onChange={onColour} size="sm"
                                items={colours.map((_$, c) => SegmentGroup.Item(c, <Text>{c.upperCase()}</Text>))} />),
                    ]}
                    preview={preview}
                    aside={{
                        label: "Dismissals · Reactive",
                        body: <Text.MonoLabel>{East.str`DISMISSED · ${East.print(count)}`}</Text.MonoLabel>,
                    }}
                    spec={[
                        Configurator.Spec("aria-label", "Dismiss banner"),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
