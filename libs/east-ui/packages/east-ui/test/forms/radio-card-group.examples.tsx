/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, NullType, StringType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Configurator, RadioCardGroup, SegmentGroup, Text, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Module-scope fixtures — the configurator's card set, with and without the
// disabled card (items are host-level arrays at the factory boundary).
// ============================================================================

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
    keywords: ["RadioCardGroup", "horizontal", "orientation", "disabled", "item", "selectedBorderColor", "selectedCardBackground", "override", "SegmentGroup", "Configurator", "getTag", "configurator", "Reactive", "State", "onChange", "interactive"],
    description: "RadioCardGroup configurator — orientation and selected-card colour axes plus a disabled-card switch driving one live State-bound card group; the aside reads the selection back",
    fn: East.function([], UIComponentType, (_$) => {
        const RADIO_CARD_GROUP_DISABLED_ITEM_DATA = [
            { value: "active", label: "Active", description: "Available now" },
            { value: "queued", label: "Queued", description: "Pending review" },
            { value: "archived", label: "Archived", description: "Read-only", disabled: true },
        ];
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

                const orientationBind = $.let(State.bind([StringType], "radio_card_group_orientation", "vertical"));
                const choiceBind      = $.let(State.bind([StringType], "radio_card_group_value", "active"));

                const oKey        = $.let(orientationBind.read());
                const choice      = $.let(choiceBind.read(), StringType);

                const onOrientation = $.const(East.function([StringType], NullType, ($, next) => { $(orientationBind.write(next)); }));
                const onChange      = $.const(East.function([StringType], NullType, ($, next) => { $(choiceBind.write(next)); }));

                // Each selection is a lookup into the same array the control renders.
                const orientation = $.let(orientations.filter((_$, v) => v.getTag().equal(oKey)).get(0n));

                // items is a host-level array (build-time) — the disabled card
                // composes into the ONE set permanently; the colour escape
                // hatches live in their own example.
                const cards = $.const(
                    <RadioCardGroup value={choice} items={RADIO_CARD_GROUP_DISABLED_ITEM_DATA} orientation={orientation} onChange={onChange} />,
                );

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Orientation", oKey,
                                <SegmentGroup value={oKey} onChange={onOrientation} size="sm"
                                    items={orientations.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            // A Slot, not a Control: the switch reports as the
                            // Disabled spec row below rather than as one value.
                        ]}
                        preview={cards}
                        aside={{
                            label: "Selection · Reactive",
                            body: <Text textStyle="body-sm" color="fg.muted">{East.str`Selected: ${choice}`}</Text>,
                        }}
                        spec={[
                            Configurator.Spec("Disabled", "archived card"),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

/** Raw colour escape hatches on a static card group. */
export const radioCardGroupCustomColours = example({
    keywords: ["RadioCardGroup", "fillColor", "borderColor", "color", "override", "custom"],
    description: "Colour overrides — brand border and fill on a static card group",
    fn: East.function([], UIComponentType, (_$) => {
        const RADIO_CARD_GROUP_ITEMS_DATA = [
            { value: "active", label: "Active", description: "Available now" },
            { value: "queued", label: "Queued", description: "Pending review" },
            { value: "archived", label: "Archived", description: "Read-only" },
        ];
        return (
        <RadioCardGroup value="active" items={RADIO_CARD_GROUP_ITEMS_DATA} selectedCardBackground="bg.brand.subtle" selectedBorderColor="border.brand" color="fg.default" />
    );
    }),
    inputs: [],
});
