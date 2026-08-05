/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, BooleanType, East, IntegerType, NullType, StringType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Configurator, HStack, IconButton, Reactive, SegmentGroup, Text, ToggleTip } from "@elaraai/east-ui";

export const toggleTipBasic = example({
    keywords: ["ToggleTip", "Root", "Icon", "accessible", "click"],
    description: "Click-activated tip with a circular ink-4 ring affordance",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="2" align="center">
                <Text>What is this?</Text>
                <ToggleTip
                    trigger={<IconButton prefix="fas" name="circle-info" label="What is this" variant="ghost" size="xs" color="fg.muted" />}
                    placement="top"
                    hasArrow={true}
                >ToggleTip is an accessible alternative to hover tooltips. Click to toggle!</ToggleTip>
            </HStack>
        );
    }),
    inputs: [],
});

export const toggleTipVariants = example({
    keywords: ["ToggleTip", "Root", "info", "help", "placement", "hasArrow", "Reactive", "State", "onOpenChange", "interactive", "SegmentGroup", "Configurator", "configurator"],
    description: "ToggleTip configurator — a placement axis on one live tip; the aside counts open/close transitions",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const placements = $.const(["top", "bottom"], ArrayType(StringType));

            const placementBind = $.let(State.bind([StringType], "toggletip_placement", "top"));
            const togglesBind = $.let(State.bind([IntegerType], "toggletip_toggles", 0n));

            const pKey = $.let(placementBind.read());
            const toggles = $.let(togglesBind.read());

            const onPlacement = $.const(East.function([StringType], NullType, ($, next) => { $(placementBind.write(next)); }));
            const onOpenChange = $.const(East.function([BooleanType], NullType, ($, _open) => {
                const cur = $.let(togglesBind.read());
                $(togglesBind.write(cur.add(1n)));
            }));

            const preview = $.const(pKey.equal("bottom").ifElse(
                _$ => (
                    <ToggleTip
                        trigger={<IconButton prefix="fas" name="circle-info" label="Help" variant="ghost" size="xs" color="fg.muted" />}
                        placement="bottom"
                        onOpenChange={onOpenChange}
                    >Click the info button for help. This is useful for touch and keyboard users.</ToggleTip>
                ),
                _$ => (
                    <ToggleTip
                        trigger={<IconButton prefix="fas" name="circle-info" label="Toggle me" variant="ghost" size="xs" color="fg.muted" />}
                        placement="top"
                        hasArrow={true}
                        onOpenChange={onOpenChange}
                    >ToggleTip is an accessible alternative to hover tooltips. Click to toggle!</ToggleTip>
                ),
            ));

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Placement", pKey,
                            <SegmentGroup value={pKey} onChange={onPlacement} size="sm"
                                items={placements.map((_$, o) => SegmentGroup.Item(o, <Text>{o.upperCase()}</Text>))} />),
                    ]}
                    preview={preview}
                    aside={{
                        label: "onOpenChange · Reactive",
                        body: <Text.MonoLabel>{East.str`TOGGLED · ${East.print(toggles)}`}</Text.MonoLabel>,
                    }}
                    spec={[
                        Configurator.Spec("Arrow", pKey.equal("top").ifElse(_$ => "on", _$ => "off")),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
