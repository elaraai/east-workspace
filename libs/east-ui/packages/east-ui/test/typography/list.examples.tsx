/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, IntegerType, NullType, OptionType, StringType, StructType, example, none, some, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, Configurator, Icon, List, SegmentGroup, Switch, VStack, HStack, Text, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const listUnordered = example({
    keywords: ["List", "Root", "unordered", "bulleted"],
    description: "Bulleted list",
    fn: East.function([], UIComponentType, (_$) => {
        return <List items={["First item", "Second item", "Third item"]} variant="unordered" />;
    }),
    inputs: [],
});

// ============================================================================
// List — live configurator over every list axis
// ============================================================================

export const listVariants = example({
    keywords: ["List", "Root", "ordered", "numbered", "gap", "spacing", "colorPalette", "blue", "markers", "green", "empty", "Reactive", "State", "interactive", "counter", "features", "product", "steps", "installation", "marker", "check", "compliance", "workforce", "dash", "danger", "problem", "issues", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "List configurator — content, variant, gap and palette axes plus an empty switch driving one live list; the aside bumps item labels from a reactive counter",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Enumerated axes are just their variants — `getTag()` gives the
                // segment key AND its label, so there is no parallel table to
                // keep in step.
                const variants = $.const([
                    variant("unordered", null), variant("ordered", null),
                ], ArrayType(List.Types.Variant));

                // Token axes collapse the same way: a gap is a spacing-scale
                // token and a palette is its name, so both are bare arrays of
                // the value itself.
                const gaps = $.const(["2", "3", "4"], ArrayType(StringType));
                const palettes = $.const(["gray", "brand", "success"], ArrayType(StringType));

                // Only content needs a struct — a semantic treatment is its
                // items PLUS the marker + tint that go with them (check for the
                // compliance checklist, dash for the problem notes), so there is
                // no single value to name it by.
                const sets = $.const([
                    {
                        label: "features",
                        items: [
                            <Text>Fast performance</Text>,
                            <Text>Type-safe development</Text>,
                            <Text>Easy to use API</Text>,
                            <Text>Comprehensive documentation</Text>,
                        ],
                        marker: none,
                        markerColor: "fg.default",
                    },
                    {
                        label: "steps",
                        items: [
                            <Text>Install dependencies</Text>,
                            <Text>Configure environment</Text>,
                            <Text>Run the application</Text>,
                            <Text>Verify installation</Text>,
                        ],
                        marker: none,
                        markerColor: "fg.default",
                    },
                    {
                        label: "checkmarks",
                        items: [
                            <Text>Max 5 consecutive shifts — 412 staff, clear</Text>,
                            <Text>SLA: 92% on-time (27 misses)</Text>,
                            <Text>Rostered vs demand: within tolerance</Text>,
                            <Text>Training currency: all staff in-date</Text>,
                        ],
                        marker: some(variant("check", null)),
                        markerColor: "fg.success",
                    },
                    {
                        label: "dashed",
                        items: [
                            <Text fontStyle="italic">Stage 1 delayed ~6h by setpoint drift since 02:00</Text>,
                            <Text fontStyle="italic">Vendor feed unavailable — forecast using last-known</Text>,
                            <Text fontStyle="italic">3 drivers flagged for manual review</Text>,
                        ],
                        marker: some(variant("dash", null)),
                        markerColor: "fg.danger",
                    },
                ], ArrayType(StructType({ label: StringType, items: ArrayType(UIComponentType), marker: OptionType(List.Types.Marker), markerColor: StringType })));

                const contentBind = $.let(State.bind([StringType], "list_content", "features"));
                const variantBind = $.let(State.bind([StringType], "list_variant", "unordered"));
                const gapBind     = $.let(State.bind([StringType], "list_gap", "2"));
                const paletteBind = $.let(State.bind([StringType], "list_palette", "brand"));
                const emptyBind   = $.let(State.bind([BooleanType], "list_empty", false));
                const counter     = $.let(State.bind([IntegerType], "list_counter", 0n));

                const cKey  = $.let(contentBind.read());
                const vKey  = $.let(variantBind.read());
                const gKey  = $.let(gapBind.read());
                const pKey  = $.let(paletteBind.read());
                const empty = $.let(emptyBind.read());
                const count = $.let(counter.read());

                const onContent = $.const(East.function([StringType], NullType, ($, next) => { $(contentBind.write(next)); }));
                const onVariant = $.const(East.function([StringType], NullType, ($, next) => { $(variantBind.write(next)); }));
                const onGap     = $.const(East.function([StringType], NullType, ($, next) => { $(gapBind.write(next)); }));
                const onPalette = $.const(East.function([StringType], NullType, ($, next) => { $(paletteBind.write(next)); }));
                const onEmpty   = $.const(East.function([BooleanType], NullType, ($, next) => { $(emptyBind.write(next)); }));
                const inc       = $.const(East.function([], NullType, $ => {
                    const cur = $.let(counter.read());
                    $(counter.write(cur.add(1n)));
                }));

                // Each selection is a lookup into the same array the control renders.
                const content = $.let(sets.filter((_$, o) => o.label.equal(cKey)).get(0n));
                const listVariant = $.let(variants.filter((_$, v) => v.getTag().equal(vKey)).get(0n));
                const gap = $.let(gaps.filter((_$, s) => s.equal(gKey)).get(0n));
                const palette = $.let(palettes.filter((_$, s) => s.equal(pKey)).get(0n));

                const noItems = $.const([], ArrayType(UIComponentType));
                const items = $.let(empty.ifElse(_$ => noItems, _$ => content.items));

                // A check / dash treatment is the presence of `marker`, not a
                // value of it — marked presets swap the variant axis for their
                // own marker + tint rather than feeding a hollow marker in.
                const list = $.const(content.marker.hasTag("some").ifElse(
                    _$ => <List items={items} marker={content.marker.unwrap("some")} markerColor={content.markerColor} gap={gap} colorPalette={palette} />,
                    _$ => <List items={items} variant={listVariant} gap={gap} colorPalette={palette} />,
                ));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Content", cKey,
                                <SegmentGroup value={cKey} onChange={onContent} size="sm"
                                    items={sets.map((_$, o) => SegmentGroup.Item(o.label, <Text>{o.label.upperCase()}</Text>))} />),
                            Configurator.Control("Variant", vKey,
                                <SegmentGroup value={vKey} onChange={onVariant} size="sm"
                                    items={variants.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Gap", gKey,
                                <SegmentGroup value={gKey} onChange={onGap} size="sm"
                                    items={gaps.map((_$, s) => SegmentGroup.Item(s, <Text>{s}</Text>))} />),
                            Configurator.Control("Palette", pKey,
                                <SegmentGroup value={pKey} onChange={onPalette} size="sm"
                                    items={palettes.map((_$, s) => SegmentGroup.Item(s, <Text>{s.upperCase()}</Text>))} />),
                            // A Slot, not a Control: the switch reports as the
                            // Items spec row below rather than as one value.
                            Configurator.Slot("Empty",
                                <HStack gap="5" align="center">
                                    <Switch checked={empty} label="No items" onChange={onEmpty} />
                                </HStack>),
                        ]}
                        preview={list}
                        aside={{
                            label: "Bump · Reactive",
                            body: (
                                <VStack gap="3" align="stretch">
                                    <List
                                        items={[
                                            <Text>{East.str`First — bump ${East.print(count)}`}</Text>,
                                            <Text>{East.str`Second — bump ${East.print(count)}`}</Text>,
                                            <Text>{East.str`Third — bump ${East.print(count)}`}</Text>,
                                        ]}
                                        variant="ordered"
                                    />
                                    <Button size="xs" onClick={inc}>Bump</Button>
                                </VStack>
                            ),
                        }}
                        spec={[
                            Configurator.Spec("Items", East.print(items.size())),
                            Configurator.Spec("Marker", content.marker.hasTag("some").ifElse(
                                _$ => content.marker.unwrap("some").getTag(),
                                _$ => vKey,
                            )),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

// ============================================================================
// Rich items — the custom item-slot contract
// ============================================================================

export const listRichItems = example({
    keywords: ["List", "Root", "rich", "UIComp", "icon", "HStack"],
    description: "Rich items — each is a custom HStack with icon + text",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <List
                items={[
                    <HStack gap="2" align="center">
                        <Icon prefix="fas" name="circle-check" color="fg.success" />
                        <Text>Passed: schema validation</Text>
                    </HStack>,
                    <HStack gap="2" align="center">
                        <Icon prefix="fas" name="circle-xmark" color="fg.danger" />
                        <Text>Failed: missing required field `id`</Text>
                    </HStack>,
                    <HStack gap="2" align="center">
                        <Icon prefix="fas" name="circle-info" color="fg.info" />
                        <Text>Skipped: optional integrity check</Text>
                    </HStack>,
                ]}
                marker="none"
                gap="2"
            />
        );
    }),
    inputs: [],
});
