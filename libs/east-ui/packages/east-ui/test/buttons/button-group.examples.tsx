/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, BooleanType, East, NullType, StringType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, ButtonGroup, Configurator, HStack, IconButton, Reactive, SegmentGroup, Switch, Text } from "@elaraai/east-ui";

// NOTE: Chakra v3's <Group> does NOT propagate `variant` / `size` /
// `colorPalette` to descendant buttons — set those on EACH child Button
// explicitly. The group-level options carry only Group-level visuals
// (`attached` / `gap` / `borderColor`).

export const buttonGroupPrevNext = example({
    keywords: ["ButtonGroup", "Root", "attached", "Prev", "Next"],
    description: "Attached Prev/Next pair — two buttons sharing a border",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <ButtonGroup attached>
                <Button variant="outline" size="md">Prev</Button>
                <Button variant="outline" size="md">Next</Button>
            </ButtonGroup>
        );
    }),
    inputs: [],
});

export const buttonGroupVariants = example({
    keywords: ["ButtonGroup", "Root", "attached", "timescale", "segmented", "split", "mixed", "IconButton", "gap", "Reactive", "State", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "ButtonGroup configurator — a composition preset axis (timescale / split) plus an attached switch",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const presets = $.const(["timescale", "split"], ArrayType(StringType));

            const presetBind = $.let(State.bind([StringType], "buttongroup_preset", "timescale"));
            const attachedBind = $.let(State.bind([BooleanType], "buttongroup_attached", true));

            const pKey = $.let(presetBind.read());
            const attachedOn = $.let(attachedBind.read());

            const onPreset = $.const(East.function([StringType], NullType, ($, next) => { $(presetBind.write(next)); }));
            const onAttached = $.const(East.function([BooleanType], NullType, ($, next) => { $(attachedBind.write(next)); }));

            // children are VALUES — the preset swaps the kid array on the
            // ONE group; attached stays live.
            const splitKids = $.let([
                <Button variant="solid" colorPalette="brand" size="md">Deploy</Button>,
                <IconButton prefix="fas" name="chevron-down" label="More deploy options" variant="solid" colorPalette="brand" size="md" />,
            ], ArrayType(UIComponentType));
            const rangeKids = $.let([
                <Button variant="outline" size="sm">1d</Button>,
                <Button variant="outline" size="sm">1w</Button>,
                <Button variant="outline" size="sm">1m</Button>,
                <Button variant="outline" size="sm">3m</Button>,
                <Button variant="outline" size="sm">1y</Button>,
            ], ArrayType(UIComponentType));
            const kids = $.let(pKey.equal("split").ifElse(_$ => splitKids, _$ => rangeKids));
            const preview = $.const(<ButtonGroup attached={attachedOn}>{kids}</ButtonGroup>);

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Preset", pKey,
                            <SegmentGroup value={pKey} onChange={onPreset} size="sm"
                                items={presets.map((_$, p) => SegmentGroup.Item(p, <Text>{p.upperCase()}</Text>))} />),
                        Configurator.Slot("Layout",
                            <HStack gap="5" align="center" wrap="wrap">
                                <Switch checked={attachedOn} label="Attached" onChange={onAttached} />
                            </HStack>),
                    ]}
                    preview={preview}
                    spec={[
                        Configurator.Spec("Buttons", pKey.equal("split").ifElse(_$ => "2 · mixed", _$ => "5")),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
