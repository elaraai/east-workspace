/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, BooleanType, East, NullType, StringType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Configurator, HStack, Note, Reactive, SegmentGroup, Switch, Text, VStack } from "@elaraai/east-ui";

export const noteNarrative = example({
    keywords: ["Note", "Root", "variant", "narrative"],
    description: "Narrative prose block (dashed border accent + muted body)",
    fn: East.function([], UIComponentType, (_$) => {
        return <Note variant="narrative">A slow process rate combined with setpoint drift since 02:00 is delaying Stage 1 by ~6 hours.</Note>;
    }),
    inputs: [],
});

export const noteVariants = example({
    keywords: ["Note", "Root", "variant", "narrative", "callout", "quote", "emphasis", "rich", "body", "Reactive", "State", "SegmentGroup", "Switch", "Configurator", "configurator"],
    description: "Note configurator — a variant axis (narrative / callout / quote) plus a rich-body switch",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const variants = $.const(["narrative", "callout", "quote"], ArrayType(StringType));

            const variantBind = $.let(State.bind([StringType], "note_variant", "narrative"));
            const richBind = $.let(State.bind([BooleanType], "note_rich", false));

            const vKey = $.let(variantBind.read());
            const richOn = $.let(richBind.read());

            const onVariant = $.const(East.function([StringType], NullType, ($, next) => { $(variantBind.write(next)); }));
            const onRich = $.const(East.function([BooleanType], NullType, ($, next) => { $(richBind.write(next)); }));

            const preview = $.const(vKey.equal("callout").ifElse(
                _$ => <Note variant="callout" emphasis="strong">Raising this retrains the workforce chain model — expect ~30 min recompute.</Note>,
                _$ => vKey.equal("quote").ifElse(
                    _$ => (
                        <Note variant="quote">
                            <Text fontStyle="italic">{"“The fastest path to confident decisions is the one we can audit twice.”"}</Text>
                        </Note>
                    ),
                    _$ => richOn.ifElse(
                        _$ => (
                            <Note variant="narrative">
                                <VStack gap="1" align="flex-start">
                                    <Text fontWeight="semibold">Service level slipped from 92% to 85% this week.</Text>
                                    <Text color="fg.muted">Root cause: Stage 2 blender #3 downtime 07:00–11:30 on Wednesday.</Text>
                                </VStack>
                            </Note>
                        ),
                        _$ => <Note variant="narrative">A slow process rate combined with setpoint drift since 02:00 is delaying Stage 1 by ~6 hours.</Note>,
                    ),
                ),
            ));

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Variant", vKey,
                            <SegmentGroup value={vKey} onChange={onVariant} size="sm"
                                items={variants.map((_$, v) => SegmentGroup.Item(v, <Text>{v.upperCase()}</Text>))} />),
                        Configurator.Slot("Body",
                            <HStack gap="5" align="center" wrap="wrap">
                                <Switch checked={richOn} label="Rich body (narrative)" onChange={onRich} />
                            </HStack>),
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
