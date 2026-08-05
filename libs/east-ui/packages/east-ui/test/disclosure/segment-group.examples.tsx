/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, BooleanType, East, NullType, StringType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Badge, Configurator, HStack, Reactive, SegmentGroup, Switch, Text } from "@elaraai/east-ui";

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
    keywords: ["SegmentGroup", "Root", "Item", "size", "sm", "md", "colorPalette", "background", "activeBackground", "branded", "Reactive", "State", "onChange", "interactive", "Switch", "Configurator", "configurator"],
    description: "SegmentGroup configurator — a size axis plus a branded switch on one live State-bound segment control",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const sizes = $.const(["sm", "md"], ArrayType(StringType));

            const sizeBind = $.let(State.bind([StringType], "seggroup_size", "sm"));
            const brandedBind = $.let(State.bind([BooleanType], "seggroup_branded", false));
            const viewBind = $.let(State.bind([StringType], "seg_view", "summary"));

            const sKey = $.let(sizeBind.read());
            const brandedOn = $.let(brandedBind.read());
            const view = $.let(viewBind.read());

            const onSize = $.const(East.function([StringType], NullType, ($, next) => { $(sizeBind.write(next)); }));
            const onBranded = $.const(East.function([BooleanType], NullType, ($, next) => { $(brandedBind.write(next)); }));
            const onView = $.const(East.function([StringType], NullType, ($, next) => { $(viewBind.write(next)); }));

            // The colour hatches are presence-typed and size is a build-time
            // enum, so the axes pick between prebuilt groups; the binding is
            // shared.
            const preview = $.const(brandedOn.ifElse(
                _$ => sKey.equal("md").ifElse(
                    _$ => (
                        <SegmentGroup value={view} onChange={onView} size="md"
                            background="bg.canvas" borderColor="border.subtle"
                            activeBackground="bg.inverse" activeColor="fg.inverse" inactiveColor="fg.muted"
                            items={[
                                SegmentGroup.Item("summary", "Summary"),
                                SegmentGroup.Item("demand", "Demand"),
                                SegmentGroup.Item("coverage", "Coverage"),
                            ]} />
                    ),
                    _$ => (
                        <SegmentGroup value={view} onChange={onView} size="sm"
                            background="bg.canvas" borderColor="border.subtle"
                            activeBackground="bg.inverse" activeColor="fg.inverse" inactiveColor="fg.muted"
                            items={[
                                SegmentGroup.Item("summary", "Summary"),
                                SegmentGroup.Item("demand", "Demand"),
                                SegmentGroup.Item("coverage", "Coverage"),
                            ]} />
                    ),
                ),
                _$ => sKey.equal("md").ifElse(
                    _$ => (
                        <SegmentGroup value={view} onChange={onView} size="md" colorPalette="brand"
                            items={[
                                SegmentGroup.Item("summary", "Summary"),
                                SegmentGroup.Item("demand", "Demand"),
                                SegmentGroup.Item("coverage", "Coverage"),
                            ]} />
                    ),
                    _$ => (
                        <SegmentGroup value={view} onChange={onView} size="sm"
                            items={[
                                SegmentGroup.Item("summary", "Summary"),
                                SegmentGroup.Item("demand", "Demand"),
                                SegmentGroup.Item("coverage", "Coverage"),
                            ]} />
                    ),
                ),
            ));

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Size", sKey,
                            <SegmentGroup value={sKey} onChange={onSize} size="sm"
                                items={sizes.map((_$, v) => SegmentGroup.Item(v, <Text>{v.upperCase()}</Text>))} />),
                        Configurator.Slot("Colours",
                            <HStack gap="5" align="center">
                                <Switch checked={brandedOn} label="Branded" onChange={onBranded} />
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
