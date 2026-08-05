/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, NullType, StringType, StructType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Configurator, HStack, RadioGroup, SegmentGroup, Switch, Text, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Module-scope fixtures — the configurator's item set, with and without the
// disabled item (items are host-level arrays at the factory boundary).
// ============================================================================

const RADIO_GROUP_ITEMS_DATA = [
    { value: "small", label: "Small" },
    { value: "medium", label: "Medium" },
    { value: "large", label: "Large" },
];
const RADIO_GROUP_DISABLED_ITEM_DATA = [
    { value: "small", label: "Small" },
    { value: "medium", label: "Medium" },
    { value: "large", label: "Large", disabled: true },
];

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const radioGroupBasic = example({
    keywords: ["RadioGroup", "Root", "radio", "select", "single-select"],
    description: "Basic radio group with three options",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <RadioGroup
                value="yes"
                items={[
                    { value: "yes", label: "Yes" },
                    { value: "no", label: "No" },
                    { value: "maybe", label: "Maybe" },
                ]}
            />
        );
    }),
    inputs: [],
});

// ============================================================================
// RadioGroup — live configurator over every group axis
// ============================================================================

export const radioGroupVariants = example({
    keywords: ["RadioGroup", "orientation", "horizontal", "disabled", "item", "fillColor", "borderColor", "color", "override", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator", "Reactive", "State", "onChange", "interactive"],
    description: "RadioGroup configurator — orientation and colour-override axes plus a disabled-item switch driving one live State-bound group; the aside reads the selection back",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Enumerated axes are just their variants — `getTag()` gives the
                // segment key AND its label, so there is no parallel table to
                // keep in step.
                const orientations = $.const([
                    variant("vertical", null), variant("horizontal", null),
                ], ArrayType(RadioGroup.Types.Orientation));

                // Only colour needs a struct — the fill / border / label slots
                // move together, with no single value to name them by. The
                // `recipe` row carries empty slots because the preview drops
                // the overrides entirely for it (below).
                const colours = $.const([
                    { label: "recipe",    fill: "",     border: "",             text: "" },
                    { label: "overrides", fill: "link", border: "border.brand", text: "fg.default" },
                ], ArrayType(StructType({ label: StringType, fill: StringType, border: StringType, text: StringType })));

                const orientationBind = $.let(State.bind([StringType], "radio_group_orientation", "vertical"));
                const colourBind      = $.let(State.bind([StringType], "radio_group_color", "recipe"));
                const disabledBind    = $.let(State.bind([BooleanType], "radio_group_disabled_item", false));
                const choiceBind      = $.let(State.bind([StringType], "radio_group_value", "small"));

                const oKey        = $.let(orientationBind.read());
                const cKey        = $.let(colourBind.read());
                const disabledOne = $.let(disabledBind.read());
                const choice      = $.let(choiceBind.read(), StringType);

                const onOrientation = $.const(East.function([StringType], NullType, ($, next) => { $(orientationBind.write(next)); }));
                const onColour      = $.const(East.function([StringType], NullType, ($, next) => { $(colourBind.write(next)); }));
                const onDisabled    = $.const(East.function([BooleanType], NullType, ($, next) => { $(disabledBind.write(next)); }));
                const onChange      = $.const(East.function([StringType], NullType, ($, next) => { $(choiceBind.write(next)); }));

                // Each selection is a lookup into the same array the control renders.
                const orientation = $.let(orientations.filter((_$, v) => v.getTag().equal(oKey)).get(0n));
                const colour = $.let(colours.filter((_$, o) => o.label.equal(cKey)).get(0n));

                // The colour slots are escape hatches the factory omits from the
                // IR entirely when absent, and the item set is a host-level
                // array — presence IS the demo for both — so the preview picks
                // between four groups (slots × disabled item) rather than
                // feeding empty values.
                const group = $.const(cKey.equal("recipe").ifElse(
                    _$ => disabledOne.ifElse(
                        _$ => <RadioGroup value={choice} items={RADIO_GROUP_DISABLED_ITEM_DATA} orientation={orientation} onChange={onChange} />,
                        _$ => <RadioGroup value={choice} items={RADIO_GROUP_ITEMS_DATA} orientation={orientation} onChange={onChange} />,
                    ),
                    _$ => disabledOne.ifElse(
                        _$ => (
                            <RadioGroup value={choice} items={RADIO_GROUP_DISABLED_ITEM_DATA} orientation={orientation} onChange={onChange}
                                fillColor={colour.fill} borderColor={colour.border} color={colour.text} />
                        ),
                        _$ => (
                            <RadioGroup value={choice} items={RADIO_GROUP_ITEMS_DATA} orientation={orientation} onChange={onChange}
                                fillColor={colour.fill} borderColor={colour.border} color={colour.text} />
                        ),
                    ),
                ));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Orientation", oKey,
                                <SegmentGroup value={oKey} onChange={onOrientation} size="sm"
                                    items={orientations.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Colour", cKey,
                                <SegmentGroup value={cKey} onChange={onColour} size="sm"
                                    items={colours.map((_$, o) => SegmentGroup.Item(o.label, <Text>{o.label.upperCase()}</Text>))} />),
                            // A Slot, not a Control: the switch reports as the
                            // Disabled spec row below rather than as one value.
                            Configurator.Slot("Items",
                                <HStack gap="5" align="center" wrap="wrap">
                                    <Switch checked={disabledOne} label="Disabled item" onChange={onDisabled} />
                                </HStack>),
                        ]}
                        preview={group}
                        aside={{
                            label: "Selection · Reactive",
                            body: <Text textStyle="body-sm" color="fg.muted">{East.str`Selected: ${choice}`}</Text>,
                        }}
                        spec={[
                            Configurator.Spec("Disabled", disabledOne.ifElse(_$ => "large item", _$ => "none")),
                            Configurator.Spec("Slots", cKey.equal("recipe").ifElse(
                                _$ => "group recipe",
                                _$ => East.str`${colour.fill} · ${colour.border} · ${colour.text}`,
                            )),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
