/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, East, NullType, StringType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Configurator, Note, Reactive, SegmentGroup, Text, VStack } from "@elaraai/east-ui";

export const noteNarrative = example({
    keywords: ["Note", "Root", "variant", "narrative"],
    description: "Narrative prose block (dashed border accent + muted body)",
    fn: East.function([], UIComponentType, (_$) => {
        return <Note variant="narrative">A slow process rate combined with setpoint drift since 02:00 is delaying Stage 1 by ~6 hours.</Note>;
    }),
    inputs: [],
});

export const noteVariants = example({
    keywords: ["Note", "Root", "variant", "narrative", "callout", "quote", "emphasis", "rich", "body", "Reactive", "State", "SegmentGroup", "Configurator", "configurator"],
    description: "Note configurator — a variant axis (narrative / callout / quote) plus a rich-body switch",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const variants = $.const([
                variant("narrative", null), variant("callout", null), variant("quote", null),
            ], ArrayType(Note.Types.Variant));

            const variantBind = $.let(State.bind([StringType], "note_variant", "narrative"));

            const vKey = $.let(variantBind.read());

            const onVariant = $.const(East.function([StringType], NullType, ($, next) => { $(variantBind.write(next)); }));

            // ONE note — the variant feeds as an expression over a shared
            // rich body; the chrome (callout tint, quote rule, narrative
            // face) is the whole demo.
            const vSel = $.let(variants.filter((_$, v) => v.getTag().equal(vKey)).get(0n));
            const preview = $.const(
                <Note variant={vSel}>
                    <VStack gap="1" align="flex-start">
                        <Text fontWeight="semibold">Service level slipped from 92% to 85% this week.</Text>
                        <Text color="fg.muted">Root cause: Stage 2 blender #3 downtime 07:00–11:30 on Wednesday.</Text>
                    </VStack>
                </Note>,
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
                        Configurator.Spec("Variant", vKey),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
