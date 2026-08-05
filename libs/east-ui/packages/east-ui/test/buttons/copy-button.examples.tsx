/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, East, NullType, StringType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Configurator, CopyButton, Reactive, SegmentGroup, Text } from "@elaraai/east-ui";

export const copyButtonBasic = example({
    keywords: ["CopyButton", "Root", "icon-only", "clipboard"],
    description: "Icon-only copy affordance (aria-label 'Copy to clipboard')",
    fn: East.function([], UIComponentType, (_$) => {
        return <CopyButton>super-secret-api-key</CopyButton>;
    }),
    inputs: [],
});

export const copyButtonVariants = example({
    keywords: ["CopyButton", "Root", "variant", "outline", "solid", "label", "timeout", "color", "background", "successColor", "branded", "clipboard", "Reactive", "State", "SegmentGroup", "Configurator", "getTag", "configurator"],
    description: "CopyButton configurator — variant and colour axes on one live labelled copy button with a custom Copied! timeout",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const variants = $.const([
                variant("ghost", null), variant("outline", null), variant("solid", null),
            ], ArrayType(CopyButton.Types.Variant));
            const colours = $.const(["recipe", "branded"], ArrayType(StringType));

            const variantBind = $.let(State.bind([StringType], "copybutton_variant", "outline"));
            const colourBind = $.let(State.bind([StringType], "copybutton_colour", "recipe"));

            const vKey = $.let(variantBind.read());
            const cKey = $.let(colourBind.read());

            const onVariant = $.const(East.function([StringType], NullType, ($, next) => { $(variantBind.write(next)); }));
            const onColour = $.const(East.function([StringType], NullType, ($, next) => { $(colourBind.write(next)); }));

            const buttonVariant = $.let(variants.filter((_$, v) => v.getTag().equal(vKey)).get(0n));

            // The colour escape hatches (including successColor) are
            // presence-typed, so the colour axis picks between two buttons.
            const preview = $.const(cKey.equal("branded").ifElse(
                _$ => (
                    <CopyButton label="Copy API key" variant={buttonVariant} timeout="1500"
                        color="fg.inverse" background="bg.inverse" borderColor="border.brand"
                        hoverBackground="bg.inverse" successColor="fg.success">
                        elaraai_sk_live_xxxxxxxx
                    </CopyButton>
                ),
                _$ => (
                    <CopyButton label="Copy link" variant={buttonVariant} timeout="1500" colorPalette="brand">
                        https://elara.ai/share/abc123
                    </CopyButton>
                ),
            ));

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Variant", vKey,
                            <SegmentGroup value={vKey} onChange={onVariant} size="sm"
                                items={variants.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                        Configurator.Control("Colour", cKey,
                            <SegmentGroup value={cKey} onChange={onColour} size="sm"
                                items={colours.map((_$, c) => SegmentGroup.Item(c, <Text>{c.upperCase()}</Text>))} />),
                    ]}
                    preview={preview}
                    spec={[
                        Configurator.Spec("Timeout", "1500ms"),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
