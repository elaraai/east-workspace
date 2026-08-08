/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, IntegerType, NullType, StringType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, Code, Configurator, HStack, SegmentGroup, Select, Style, Text, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const codeBasic = example({
    keywords: ["Code", "Root", "basic", "inline"],
    description: "Plain inline code snippet",
    fn: East.function([], UIComponentType, (_$) => {
        return <Code>const x = 1</Code>;
    }),
    inputs: [],
});

// ============================================================================
// Code — live configurator over every style axis
// ============================================================================

export const codeVariants = example({
    keywords: ["Code", "Root", "variant", "subtle", "surface", "outline", "size", "xs", "sm", "md", "lg", "colorPalette", "gray", "blue", "green", "red", "combined", "Reactive", "State", "interactive", "counter", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "Code configurator — variant, size and palette axes driving one live inline snippet; the aside increments a reactive counter into a second snippet",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Enumerated axes are just their variants — `getTag()` gives the
                // segment key AND its label, so there is no parallel table to
                // keep in step.
                const variants = $.const([
                    variant("subtle", null), variant("surface", null), variant("outline", null),
                ], ArrayType(Code.Types.Variant));

                const sizes = $.const([
                    variant("xs", null), variant("sm", null), variant("md", null), variant("lg", null),
                ], ArrayType(Style.Types.Size));

                // A palette is just its name, so the axis is a bare array of
                // the value itself.
                const palettes = $.const(["gray", "brand", "success", "danger"], ArrayType(StringType));

                const variantBind = $.let(State.bind([StringType], "code_variant", "subtle"));
                const sizeBind    = $.let(State.bind([StringType], "code_size", "md"));
                const paletteBind = $.let(State.bind([StringType], "code_palette", "gray"));
                const counter     = $.let(State.bind([IntegerType], "code_counter", 0n));

                const vKey  = $.let(variantBind.read());
                const sKey  = $.let(sizeBind.read());
                const pKey  = $.let(paletteBind.read());
                const count = $.let(counter.read());

                const onVariant = $.const(East.function([StringType], NullType, ($, next) => { $(variantBind.write(next)); }));
                const onSize    = $.const(East.function([StringType], NullType, ($, next) => { $(sizeBind.write(next)); }));
                const onPalette = $.const(East.function([StringType], NullType, ($, next) => { $(paletteBind.write(next)); }));
                const inc       = $.const(East.function([], NullType, $ => {
                    const cur = $.let(counter.read());
                    $(counter.write(cur.add(1n)));
                }));

                // Each selection is a lookup into the same array the control renders.
                const codeVariant = $.let(variants.filter((_$, v) => v.getTag().equal(vKey)).get(0n));
                const size = $.let(sizes.filter((_$, v) => v.getTag().equal(sKey)).get(0n));
                const palette = $.let(palettes.filter((_$, s) => s.equal(pKey)).get(0n));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Variant", vKey,
                                <SegmentGroup value={vKey} onChange={onVariant} size="sm"
                                    items={variants.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Size", sKey,
                                <Select value={sKey} onChange={onSize} size="sm"
                                    items={sizes.map((_$, v) => Select.Item(v.getTag(), v.getTag()))} />),
                            Configurator.Control("Palette", pKey,
                                <Select value={pKey} onChange={onPalette} size="sm"
                                    items={palettes.map((_$, s) => Select.Item(s, s))} />),
                        ]}
                        preview={
                            <Code variant={codeVariant} size={size} colorPalette={palette}>console.log('Hello')</Code>
                        }
                        aside={{
                            label: "Count · Reactive",
                            body: (
                                <HStack gap="3" align="center">
                                    <Code variant={codeVariant} colorPalette={palette}>{East.str`const count = ${East.print(count)};`}</Code>
                                    <Button size="xs" onClick={inc}>Increment</Button>
                                </HStack>
                            ),
                        }}
                        spec={[
                            Configurator.Spec("Snippet", "console.log('Hello')"),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
