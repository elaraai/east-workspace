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

            const variantBind = $.let(State.bind([StringType], "copybutton_variant", "outline"));

            const vKey = $.let(variantBind.read());

            const onVariant = $.const(East.function([StringType], NullType, ($, next) => { $(variantBind.write(next)); }));

            const buttonVariant = $.let(variants.filter((_$, v) => v.getTag().equal(vKey)).get(0n));

            // ONE button — recipe colouring; the escape hatches live in
            // their own example.
            const preview = $.const(
                <CopyButton label="Copy API key" variant={buttonVariant} timeout="1500">
                    elaraai_sk_live_xxxxxxxx
                </CopyButton>,
            );

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Variant", vKey,
                            <SegmentGroup value={vKey} onChange={onVariant} size="sm"
                                items={variants.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
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

/** Raw colour escape hatches on a static copy button. */
export const copyButtonCustomColours = example({
    keywords: ["CopyButton", "color", "background", "borderColor", "successColor", "override", "custom"],
    description: "Colour overrides — inverse-ink copy button with a success tint",
    fn: East.function([], UIComponentType, (_$) => (
        <CopyButton label="Copy API key" variant="solid" color="fg.inverse" background="bg.inverse" borderColor="border.brand" hoverBackground="bg.inverse" successColor="fg.success">
            elaraai_sk_live_xxxxxxxx
        </CopyButton>
    )),
    inputs: [],
});
