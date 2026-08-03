/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, IntegerType, NullType, StringType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, Configurator, Mark, SegmentGroup, Switch, HStack, Text, Reactive } from "@elaraai/east-ui";

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
                const contextBind = $.let(State.bind([BooleanType], "mark_context", false));
                const counter     = $.let(State.bind([IntegerType], "mark_counter", 0n));

                const vKey  = $.let(variantBind.read());
                const pKey  = $.let(paletteBind.read());
                const ctx   = $.let(contextBind.read());
                const count = $.let(counter.read());

                const onVariant = $.const(East.function([StringType], NullType, ($, next) => { $(variantBind.write(next)); }));
                const onPalette = $.const(East.function([StringType], NullType, ($, next) => { $(paletteBind.write(next)); }));
                const onContext = $.const(East.function([BooleanType], NullType, ($, next) => { $(contextBind.write(next)); }));
                const inc       = $.const(East.function([], NullType, $ => {
                    const cur = $.let(counter.read());
                    $(counter.write(cur.add(1n)));
                }));

                // Each selection is a lookup into the same array the control renders.
                const markVariant = $.let(variants.filter((_$, v) => v.getTag().equal(vKey)).get(0n));
                const palette = $.let(palettes.filter((_$, s) => s.equal(pKey)).get(0n));

                // In-context mode is a placement, not a prop — so the switch
                // picks between the standalone mark and the same mark set in a
                // running sentence.
                const preview = $.const(ctx.ifElse(
                    _$ => (
                        <HStack gap="1">
                            <Text>{"This feature is "}</Text>
                            <Mark variant={markVariant} colorPalette={palette}>deprecated</Mark>
                            <Text>{" and will be removed."}</Text>
                        </HStack>
                    ),
                    _$ => <Mark variant={markVariant} colorPalette={palette}>{markVariant.getTag().upperCase()}</Mark>,
                ));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Variant", vKey,
                                <SegmentGroup value={vKey} onChange={onVariant} size="sm"
                                    items={variants.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Palette", pKey,
                                <SegmentGroup value={pKey} onChange={onPalette} size="sm"
                                    items={palettes.map((_$, s) => SegmentGroup.Item(s, <Text>{s.upperCase()}</Text>))} />),
                            // A Slot, not a Control: the switch reports as the
                            // Placement spec row below rather than as one value.
                            Configurator.Slot("Context",
                                <HStack gap="5" align="center">
                                    <Switch checked={ctx} label="In sentence" onChange={onContext} />
                                    <Text textStyle="caption" color="fg.subtle">mark inside a running text flow</Text>
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
                            Configurator.Spec("Placement", ctx.ifElse(_$ => "in sentence", _$ => "standalone")),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
