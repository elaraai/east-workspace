/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, East, NullType, StringType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Badge, Configurator, HStack, Reactive, SegmentGroup, VStack, Style, Text } from "@elaraai/east-ui";

export const segmentGroupViewToggle = example({
    keywords: ["SegmentGroup", "Root", "Item", "toolbar", "toggle", "view"],
    description: "Summary / Demand / Coverage / Rotation plan / Unmet · 2 toolbar (shift-optimiser mockup)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <SegmentGroup
                value="summary"
                items={[
                    SegmentGroup.Item("summary", "Summary"),
                    SegmentGroup.Item("demand", "Demand"),
                    SegmentGroup.Item("coverage", "Coverage"),
                    SegmentGroup.Item("rotation", "Rotation plan"),
                    SegmentGroup.Item("unmet", <HStack gap="2" align="center"><Text>Unmet</Text><Badge colorPalette="danger" variant="subtle">2</Badge></HStack>),
                ]}
                size="sm"
            />
        );
    }),
    inputs: [],
});

export const segmentGroupVariants = example({
    keywords: ["SegmentGroup", "Root", "Item", "size", "sm", "md", "colorPalette", "background", "activeBackground", "branded", "Reactive", "State", "onChange", "interactive", "Configurator", "configurator"],
    description: "SegmentGroup configurator — a size axis plus a branded switch on one live State-bound segment control",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const sizes = $.const([
                variant("sm", null), variant("md", null),
            ], ArrayType(Style.Types.Size));

            const sizeBind = $.let(State.bind([StringType], "seggroup_size", "sm"));
            const viewBind = $.let(State.bind([StringType], "seg_view", "summary"));

            const sKey = $.let(sizeBind.read());
            const view = $.let(viewBind.read());

            const onSize = $.const(East.function([StringType], NullType, ($, next) => { $(sizeBind.write(next)); }));
            const onView = $.const(East.function([StringType], NullType, ($, next) => { $(viewBind.write(next)); }));

            // The colour hatches are presence-typed and size is a build-time
            // enum, so the axes pick between prebuilt groups; the binding is
            // shared.
            // ONE live group — size feeds as an expression; the raw colour
            // overrides are presence-typed and live in their own example.
            const sizeSel = $.let(sizes.filter((_$, v) => v.getTag().equal(sKey)).get(0n));
            const preview = $.const(
                <SegmentGroup value={view} onChange={onView} size={sizeSel}
                    items={[
                        SegmentGroup.Item("summary", "Summary"),
                        SegmentGroup.Item("demand", "Demand"),
                        SegmentGroup.Item("coverage", "Coverage"),
                    ]} />,
            );

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Size", sKey,
                            <SegmentGroup value={sKey} onChange={onSize} size="sm"
                                items={sizes.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                        Configurator.Slot("Colours",
                            <HStack gap="5" align="center" wrap="wrap">
                            </HStack>),
                    ]}
                    preview={preview}
                    spec={[
                        Configurator.Spec("Active", view),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

/** Raw colour overrides — the ink-on-canvas segmented look via the escape hatches. */
export const segmentGroupCustomColours = example({
    keywords: ["SegmentGroup", "background", "borderColor", "activeBackground", "activeColor", "inactiveColor", "colorPalette", "override", "custom"],
    description: "Colour overrides — ink-on-canvas segments via the raw colour escape hatches, beside the brand palette knob",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const viewBind = $.let(State.bind([StringType], "segment_group_custom_view", "summary"));
            const view = $.let(viewBind.read());
            const onView = $.const(East.function([StringType], NullType, ($, next) => { $(viewBind.write(next)); }));
            return (
                <VStack gap="3" align="flex-start">
                    <SegmentGroup value={view} onChange={onView} size="md"
                        background="bg.canvas" borderColor="border.subtle"
                        activeBackground="bg.inverse" activeColor="fg.inverse" inactiveColor="fg.muted"
                        items={[
                            SegmentGroup.Item("summary", "Summary"),
                            SegmentGroup.Item("demand", "Demand"),
                            SegmentGroup.Item("coverage", "Coverage"),
                        ]} />
                    <SegmentGroup value={view} onChange={onView} size="md" colorPalette="brand"
                        items={[
                            SegmentGroup.Item("summary", "Summary"),
                            SegmentGroup.Item("demand", "Demand"),
                            SegmentGroup.Item("coverage", "Coverage"),
                        ]} />
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
