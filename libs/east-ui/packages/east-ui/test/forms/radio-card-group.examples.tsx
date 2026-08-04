/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, NullType, StringType, StructType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Configurator, HStack, RadioCardGroup, SegmentGroup, Switch, Text, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Module-scope fixtures — the configurator's card set, with and without the
// disabled card (items are host-level arrays at the factory boundary).
// ============================================================================

const RADIO_CARD_GROUP_ITEMS_DATA = [
    { value: "active", label: "Active", description: "Available now" },
    { value: "queued", label: "Queued", description: "Pending review" },
    { value: "archived", label: "Archived", description: "Read-only" },
];
const RADIO_CARD_GROUP_DISABLED_ITEM_DATA = [
    { value: "active", label: "Active", description: "Available now" },
    { value: "queued", label: "Queued", description: "Pending review" },
    { value: "archived", label: "Archived", description: "Read-only", disabled: true },
];

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const radioCardGroupBasic = example({
    keywords: ["RadioCardGroup", "Root", "card", "radio", "select"],
    description: "Pricing-tier card group with description per option",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <RadioCardGroup
                value="team"
                items={[
                    { value: "starter", label: "Starter", description: "Up to 5 users" },
                    { value: "team", label: "Team", description: "Up to 50 users" },
                    { value: "business", label: "Business", description: "Unlimited" },
                ]}
            />
        );
    }),
    inputs: [],
});

// ============================================================================
// RadioCardGroup — live configurator over every card-group axis
// ============================================================================

export const radioCardGroupVariants = example({
    keywords: ["RadioCardGroup", "horizontal", "orientation", "disabled", "item", "selectedBorderColor", "selectedCardBackground", "override", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator", "Reactive", "State", "onChange", "interactive"],
    description: "RadioCardGroup configurator — orientation and selected-card colour axes plus a disabled-card switch driving one live State-bound card group; the aside reads the selection back",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Enumerated axes are just their variants — `getTag()` gives the
                // segment key AND its label, so there is no parallel table to
                // keep in step.
                const orientations = $.const([
                    variant("vertical", null), variant("horizontal", null),
                ], ArrayType(RadioCardGroup.Types.Orientation));

                // Only colour needs a struct — the selected-card background /
                // border / description slots move together, with no single
                // value to name them by. The `recipe` row carries empty slots
                // because the preview drops the overrides entirely for it
                // (below).
                const colours = $.const([
                    { label: "recipe",    cardBg: "",                cardBorder: "",             description: "" },
                    { label: "overrides", cardBg: "bg.brand.subtle", cardBorder: "border.brand", description: "fg.muted" },
                ], ArrayType(StructType({ label: StringType, cardBg: StringType, cardBorder: StringType, description: StringType })));

                const orientationBind = $.let(State.bind([StringType], "radio_card_group_orientation", "vertical"));
                const colourBind      = $.let(State.bind([StringType], "radio_card_group_color", "recipe"));
                const disabledBind    = $.let(State.bind([BooleanType], "radio_card_group_disabled_item", false));
                const choiceBind      = $.let(State.bind([StringType], "radio_card_group_value", "active"));

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
                // IR entirely when absent, and the card set is a host-level
                // array — presence IS the demo for both — so the preview picks
                // between four card groups (slots × disabled card) rather than
                // feeding empty values.
                const cards = $.const(cKey.equal("recipe").ifElse(
                    _$ => disabledOne.ifElse(
                        _$ => <RadioCardGroup value={choice} items={RADIO_CARD_GROUP_DISABLED_ITEM_DATA} orientation={orientation} onChange={onChange} />,
                        _$ => <RadioCardGroup value={choice} items={RADIO_CARD_GROUP_ITEMS_DATA} orientation={orientation} onChange={onChange} />,
                    ),
                    _$ => disabledOne.ifElse(
                        _$ => (
                            <RadioCardGroup value={choice} items={RADIO_CARD_GROUP_DISABLED_ITEM_DATA} orientation={orientation} onChange={onChange}
                                selectedCardBackground={colour.cardBg} selectedBorderColor={colour.cardBorder} descriptionColor={colour.description} />
                        ),
                        _$ => (
                            <RadioCardGroup value={choice} items={RADIO_CARD_GROUP_ITEMS_DATA} orientation={orientation} onChange={onChange}
                                selectedCardBackground={colour.cardBg} selectedBorderColor={colour.cardBorder} descriptionColor={colour.description} />
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
                            Configurator.Slot("Cards",
                                <HStack gap="5" align="center">
                                    <Switch checked={disabledOne} label="Disabled card" onChange={onDisabled} />
                                </HStack>),
                        ]}
                        preview={cards}
                        aside={{
                            label: "Selection · Reactive",
                            body: <Text textStyle="body-sm" color="fg.muted">{East.str`Selected: ${choice}`}</Text>,
                        }}
                        spec={[
                            Configurator.Spec("Disabled", disabledOne.ifElse(_$ => "archived card", _$ => "none")),
                            Configurator.Spec("Slots", cKey.equal("recipe").ifElse(
                                _$ => "card recipe",
                                _$ => East.str`${colour.cardBg} · ${colour.cardBorder} · ${colour.description}`,
                            )),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
