/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, IntegerType, NullType, StringType, StructType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Box, Button, Configurator, HStack, SegmentGroup, Separator, Style, Text, VStack, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const separatorBasic = example({
    keywords: ["Separator", "Root", "orientation", "horizontal", "basic"],
    description: "Default horizontal divider",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="3" width="100%">
                <Text>Content above</Text>
                <Separator orientation="horizontal" />
                <Text>Content below</Text>
            </VStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Separator — live configurator over orientation, hairline and label axes
// ============================================================================

export const separatorVariants = example({
    keywords: ["Separator", "Root", "orientation", "vertical", "variant", "subtle", "strong", "dashed", "brand", "label", "form", "align", "eyebrow", "chain-divider", "start", "Reactive", "State", "interactive", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "Separator configurator — orientation, variant, label and align axes driving one live divider; the aside steps a reactive counter label",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Enumerated axes are just their variants — `getTag()` gives the
                // segment key AND its label, so there is no parallel table to
                // keep in step.
                const orientations = $.const([
                    variant("horizontal", null), variant("vertical", null),
                ], ArrayType(Style.Types.Orientation));

                const hairlines = $.const([
                    variant("subtle", null), variant("strong", null),
                    variant("dashed", null), variant("brand", null),
                ], ArrayType(Separator.Types.Variant));

                const aligns = $.const([
                    variant("start", null), variant("center", null), variant("end", null),
                ], ArrayType(Separator.Types.Align));

                // Only the label needs a struct — each entry pairs the segment
                // key with the text it renders: a short OR, a form-section
                // heading, and the uppercase eyebrow phrase.
                const labels = $.const([
                    { label: "none",    text: "" },
                    { label: "or",      text: "OR" },
                    { label: "section", text: "Contact Details" },
                    { label: "eyebrow", text: "Cross-phase decisions" },
                ], ArrayType(StructType({ label: StringType, text: StringType })));

                const orientationBind = $.let(State.bind([StringType], "separator_orientation", "horizontal"));
                const variantBind     = $.let(State.bind([StringType], "separator_variant", "subtle"));
                const labelBind       = $.let(State.bind([StringType], "separator_label", "or"));
                const alignBind       = $.let(State.bind([StringType], "separator_align", "center"));
                const counter         = $.let(State.bind([IntegerType], "separator_counter", 0n));

                const oKey  = $.let(orientationBind.read());
                const vKey  = $.let(variantBind.read());
                const lKey  = $.let(labelBind.read());
                const aKey  = $.let(alignBind.read());
                const count = $.let(counter.read());

                const onOrientation = $.const(East.function([StringType], NullType, ($, next) => { $(orientationBind.write(next)); }));
                const onVariant     = $.const(East.function([StringType], NullType, ($, next) => { $(variantBind.write(next)); }));
                const onLabel       = $.const(East.function([StringType], NullType, ($, next) => { $(labelBind.write(next)); }));
                const onAlign       = $.const(East.function([StringType], NullType, ($, next) => { $(alignBind.write(next)); }));
                const inc           = $.const(East.function([], NullType, $ => {
                    const cur = $.let(counter.read());
                    $(counter.write(cur.add(1n)));
                }));

                // Each selection is a lookup into the same array the control renders.
                const hairline = $.let(hairlines.filter((_$, v) => v.getTag().equal(vKey)).get(0n));
                const align = $.let(aligns.filter((_$, v) => v.getTag().equal(aKey)).get(0n));
                const entry = $.let(labels.filter((_$, o) => o.label.equal(lKey)).get(0n));
                const labeled = $.let(lKey.equal("none").not());

                // A label is the presence of the slot, not a value of it — so
                // the lookup picks between prebuilt dividers rather than feeding
                // an empty label (the chip-rail presence precedent). Vertical
                // dividers drop label + align and divide a 40px row instead.
                const divider = $.const(oKey.equal("vertical").ifElse(
                    _$ => (
                        <HStack gap="4" align="center">
                            <Text>Left</Text>
                            <Box height="40px">
                                <Separator orientation="vertical" variant={hairline} />
                            </Box>
                            <Text>Right</Text>
                        </HStack>
                    ),
                    _$ => labeled.ifElse(
                        _$ => (
                            <VStack gap="3" align="stretch">
                                <Text>Above</Text>
                                <Separator variant={hairline} align={align} label={<Text>{entry.text}</Text>} />
                                <Text>Below</Text>
                            </VStack>
                        ),
                        _$ => (
                            <VStack gap="3" align="stretch">
                                <Text>Above</Text>
                                <Separator variant={hairline} />
                                <Text>Below</Text>
                            </VStack>
                        ),
                    ),
                ));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Orientation", oKey,
                                <SegmentGroup value={oKey} onChange={onOrientation} size="sm"
                                    items={orientations.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />,
                                "vertical divides a 40px row"),
                            Configurator.Control("Variant", vKey,
                                <SegmentGroup value={vKey} onChange={onVariant} size="sm"
                                    items={hairlines.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Label", lKey,
                                <SegmentGroup value={lKey} onChange={onLabel} size="sm"
                                    items={labels.map((_$, o) => SegmentGroup.Item(o.label, <Text>{o.label.upperCase()}</Text>))} />,
                                "suppressed when vertical"),
                            Configurator.Control("Align", aKey,
                                <SegmentGroup value={aKey} onChange={onAlign} size="sm"
                                    items={aligns.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />,
                                "label placement between the hairlines"),
                        ]}
                        preview={divider}
                        aside={{
                            label: "Steps · Reactive",
                            body: (
                                <VStack gap="3" align="stretch">
                                    <Text>Above</Text>
                                    {/* dynamic-string labels need an explicit Text wrap so the
                                        string→UIComp coercion is unambiguous; plain string labels auto-coerce */}
                                    <Separator label={<Text>{East.str`STEP ${East.print(count)}`}</Text>} />
                                    <Text>Below</Text>
                                    <Button size="xs" onClick={inc}>Next step</Button>
                                </VStack>
                            ),
                        }}
                        spec={[
                            Configurator.Spec("Label text", labeled.ifElse(_$ => entry.text, _$ => "none")),
                            Configurator.Spec("Context", oKey.equal("vertical").ifElse(_$ => "40px row", _$ => "stacked copy")),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
