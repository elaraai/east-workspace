/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, NullType, StringType, StructType, example, none, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Avatar, Badge, ChipRail, Configurator, HStack, MetricChip, SegmentGroup, Style, Switch, Tag, Text, VStack, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const chipRailBasic = example({
    keywords: ["ChipRail", "Root", "tags", "line-separator", "compact"],
    description: "Six Tag chips in a ChipRail with line separators and compact density",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <ChipRail density="compact" separator="line">
                <Tag>Week 12</Tag>
                <Tag>Cycle</Tag>
                <Tag>17–23 Mar</Tag>
                <Tag>Red</Tag>
                <Tag>ICU</Tag>
                <Tag>Europe</Tag>
            </ChipRail>
        );
    }),
    inputs: [],
});

// ============================================================================
// Overflow — the +N collapse contract
// ============================================================================

export const chipRailOverflow = example({
    keywords: ["ChipRail", "Root", "overflow", "scroll", "responsive"],
    description: "Twenty chips with overflow=\"scroll\" — the rail scrolls horizontally on narrow containers",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <ChipRail density="condensed" separator="none" overflow="scroll">
                {Array.from({ length: 20 }, (_, i) => <Tag variant="subtle" colorPalette="brand">{`Chip ${i + 1}`}</Tag>)}
            </ChipRail>
        );
    }),
    inputs: [],
});

// ============================================================================
// ChipRail — live configurator over every rail axis
// ============================================================================

export const chipRailVariants = example({
    keywords: ["ChipRail", "mixed", "Badge", "MetricChip", "Avatar", "Tag", "density", "Root", "tags", "separator", "dot-separator", "line", "none", "labels", "labeled", "caption", "dimension", "sizes", "condensed", "compact", "comfortable", "Reactive", "State", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator", "interactive"],
    description: "ChipRail configurator — chip set, density and separator axes on one live labeled rail; the aside stacks the set at all three densities",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Enumerated axes are just their variants — `getTag()` gives the
                // segment key AND its label, so there is no parallel table to
                // keep in step.
                const densities = $.const([
                    variant("condensed", null), variant("compact", null), variant("comfortable", null),
                ], ArrayType(Style.Types.Density));

                const separators = $.const([
                    variant("line", null), variant("dot", null), none,
                ], ArrayType(ChipRail.Types.Separator));

                // Only the chip set needs a struct — a rail is its chips PLUS
                // the index-aligned captions labeled mode shows above them, so
                // there is no single value to name it by.
                const sets = $.const([
                    {
                        label: "mixed",
                        chips: [
                            <Avatar name="Mia Kerr" colorPalette="brand" />,
                            <Tag>Batch A</Tag>,
                            <Tag variant="brand">Running</Tag>,
                            <Badge variant="ok">ON PLAN</Badge>,
                            <MetricChip tone="positive"><Text>+4.2%</Text></MetricChip>,
                        ],
                        captions: ["Owner", "Batch", "State", "Plan", "Trend"],
                    },
                    {
                        label: "steps",
                        chips: [<Tag>Observe</Tag>, <Tag>Explain</Tag>, <Tag>Decide</Tag>, <Tag>Commit</Tag>],
                        captions: ["Step 1", "Step 2", "Step 3", "Step 4"],
                    },
                    {
                        label: "facets",
                        chips: [<Tag>Week 12</Tag>, <Tag>Europe</Tag>, <Tag>On track</Tag>, <Tag>Red</Tag>],
                        captions: ["Week", "Region", "Status", "Cycle"],
                    },
                ], ArrayType(StructType({ label: StringType, chips: ArrayType(UIComponentType), captions: ArrayType(StringType) })));

                const chipsBind     = $.let(State.bind([StringType], "chiprail_chips", "mixed"));
                const densityBind   = $.let(State.bind([StringType], "chiprail_density", "compact"));
                const separatorBind = $.let(State.bind([StringType], "chiprail_separator", "dot"));

                const cKey = $.let(chipsBind.read());
                const dKey = $.let(densityBind.read());
                const sKey = $.let(separatorBind.read());

                const onChips     = $.const(East.function([StringType], NullType, ($, next) => { $(chipsBind.write(next)); }));
                const onDensity   = $.const(East.function([StringType], NullType, ($, next) => { $(densityBind.write(next)); }));
                const onSeparator = $.const(East.function([StringType], NullType, ($, next) => { $(separatorBind.write(next)); }));

                // Each selection is a lookup into the same array the control renders.
                const chipSet = $.let(sets.filter((_$, o) => o.label.equal(cKey)).get(0n));
                const density = $.let(densities.filter((_$, v) => v.getTag().equal(dKey)).get(0n));
                const separator = $.let(separators.filter((_$, v) => v.getTag().equal(sKey)).get(0n));

                // ONE rail — the caption labels compose on (they are chip-set
                // DATA); density / separator / chips stay live.
                const rail = $.const(
                    <ChipRail density={density} separator={separator} labels={chipSet.captions}>{chipSet.chips}</ChipRail>,
                );

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Chips", cKey,
                                <SegmentGroup value={cKey} onChange={onChips} size="sm"
                                    items={sets.map((_$, o) => SegmentGroup.Item(o.label, <Text>{o.label.upperCase()}</Text>))} />),
                            Configurator.Control("Density", dKey,
                                <SegmentGroup value={dKey} onChange={onDensity} size="sm"
                                    items={densities.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Separator", sKey,
                                <SegmentGroup value={sKey} onChange={onSeparator} size="sm"
                                    items={separators.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            // A Slot, not a Control: the switch reports as the
                            // Mode / Captions spec rows below rather than as one value.
                            Configurator.Slot("Labels",
                                <HStack gap="5" align="center" wrap="wrap">
                                </HStack>),
                        ]}
                        preview={rail}
                        aside={{
                            label: "Density ladder",
                            body: (
                                <VStack gap="4" align="stretch">
                                    {densities.map((_$, d) => <ChipRail density={d} separator={separator}>{chipSet.chips}</ChipRail>)}
                                </VStack>
                            ),
                        }}
                        spec={[
                            Configurator.Spec("Mode", "labeled"),
                            Configurator.Spec("Chip count", East.print(chipSet.chips.size())),
                            Configurator.Spec("Captions", East.print(chipSet.captions.size())),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
