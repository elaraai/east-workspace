/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, IntegerType, NullType, StringType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, Configurator, Mark, Select, Switch, HStack, Text, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const markBasic = example({
    keywords: ["Mark", "Root", "basic"],
    description: "Simple text mark",
    fn: East.function([], UIComponentType, (_$) => {
        return <Mark>Important</Mark>;
    }),
    inputs: [],
});

// ============================================================================
// Mark — live configurator over every style axis
// ============================================================================

export const markVariants = example({
    keywords: ["Mark", "Root", "variant", "subtle", "solid", "text", "plain", "colorPalette", "yellow", "green", "blue", "red", "purple", "success", "warning", "error", "info", "inline", "context", "Reactive", "State", "interactive", "counter", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "Mark configurator — variant and palette axes plus an in-context switch driving one live mark; the aside bumps a reactive mark label",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Enumerated axes are just their variants — `getTag()` gives the
                // segment key AND its label, so there is no parallel table to
                // keep in step.
                const variants = $.const([
                    variant("subtle", null), variant("solid", null),
                    variant("text", null), variant("plain", null),
                ], ArrayType(Mark.Types.Variant));

                // A palette is just its name, so the axis is a bare array of
                // the value itself.
                const palettes = $.const(["warning", "success", "danger", "brand", "info"], ArrayType(StringType));

                const variantBind = $.let(State.bind([StringType], "mark_variant", "subtle"));
                const paletteBind = $.let(State.bind([StringType], "mark_palette", "warning"));
                const counter     = $.let(State.bind([IntegerType], "mark_counter", 0n));

                const vKey  = $.let(variantBind.read());
                const pKey  = $.let(paletteBind.read());
                const count = $.let(counter.read());

                const onVariant = $.const(East.function([StringType], NullType, ($, next) => { $(variantBind.write(next)); }));
                const onPalette = $.const(East.function([StringType], NullType, ($, next) => { $(paletteBind.write(next)); }));
                const inc       = $.const(East.function([], NullType, $ => {
                    const cur = $.let(counter.read());
                    $(counter.write(cur.add(1n)));
                }));

                // Each selection is a lookup into the same array the control renders.
                const markVariant = $.let(variants.filter((_$, v) => v.getTag().equal(vKey)).get(0n));
                const palette = $.let(palettes.filter((_$, s) => s.equal(pKey)).get(0n));

                // ONE mark — the running-sentence placement composes on.
                const preview = $.const(
                    <HStack gap="1">
                        <Text>{"This feature is "}</Text>
                        <Mark variant={markVariant} colorPalette={palette}>deprecated</Mark>
                        <Text>{" and will be removed."}</Text>
                    </HStack>,
                );

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Variant", vKey,
                                <Select value={vKey} onChange={onVariant} size="sm"
                                    items={variants.map((_$, v) => Select.Item(v.getTag(), v.getTag()))} />),
                            Configurator.Control("Palette", pKey,
                                <Select value={pKey} onChange={onPalette} size="sm"
                                    items={palettes.map((_$, s) => Select.Item(s, s))} />),
                            // A Slot, not a Control: the switch reports as the
                            // Placement spec row below rather than as one value.
                            Configurator.Slot("Context",
                                <HStack gap="5" align="center" wrap="wrap">
                                </HStack>),
                        ]}
                        preview={preview}
                        aside={{
                            label: "Bump · Reactive",
                            body: (
                                <HStack gap="3" align="center">
                                    <Mark variant={markVariant} colorPalette={palette}>{East.str`Mark #${East.print(count)}`}</Mark>
                                    <Button size="xs" onClick={inc}>Bump</Button>
                                </HStack>
                            ),
                        }}
                        spec={[
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
