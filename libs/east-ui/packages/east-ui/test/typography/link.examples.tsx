/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, IntegerType, NullType, StringType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, Configurator, Link, SegmentGroup, Switch, VStack, HStack, Text, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const linkBasic = example({
    keywords: ["Link", "Root", "basic", "hyperlink"],
    description: "Simple hyperlink",
    fn: East.function([], UIComponentType, (_$) => {
        return <Link href="/home">Click here</Link>;
    }),
    inputs: [],
});

// ============================================================================
// Link — live configurator over every style axis
// ============================================================================

export const linkVariants = example({
    keywords: ["Link", "Root", "external", "new tab", "variant", "underline", "plain", "colorPalette", "blue", "teal", "purple", "red", "inline", "context", "text", "combined", "Reactive", "State", "interactive", "counter", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "Link configurator — variant and palette axes plus external / in-context switches driving one live link; the aside relabels a reactive link from a counter",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Enumerated axes are just their variants — `getTag()` gives the
                // segment key AND its label, so there is no parallel table to
                // keep in step. The spec-default look is the absence of
                // `variant`, not a value of it, so the axis carries one extra
                // key beyond the variant table.
                const variants = $.const([
                    variant("underline", null), variant("plain", null),
                ], ArrayType(Link.Types.Variant));

                // A palette is just its name, so the axis is a bare array of
                // the value itself.
                const palettes = $.const(["brand", "danger", "gray"], ArrayType(StringType));

                const variantBind = $.let(State.bind([StringType], "link_variant", "underline"));
                const paletteBind = $.let(State.bind([StringType], "link_palette", "brand"));
                const extBind     = $.let(State.bind([BooleanType], "link_external", false));
                const counter     = $.let(State.bind([IntegerType], "link_counter", 0n));

                const vKey  = $.let(variantBind.read());
                const pKey  = $.let(paletteBind.read());
                const ext   = $.let(extBind.read());
                const count = $.let(counter.read());

                const onVariant  = $.const(East.function([StringType], NullType, ($, next) => { $(variantBind.write(next)); }));
                const onPalette  = $.const(East.function([StringType], NullType, ($, next) => { $(paletteBind.write(next)); }));
                const onExternal = $.const(East.function([BooleanType], NullType, ($, next) => { $(extBind.write(next)); }));
                const inc        = $.const(East.function([], NullType, $ => {
                    const cur = $.let(counter.read());
                    $(counter.write(cur.add(1n)));
                }));

                // ONE link — the variant feeds as an expression and the
                // running-sentence placement composes on permanently.
                const linkVariant = $.let(variants.filter((_$, v) => v.getTag().equal(vKey)).get(0n));
                const palette = $.let(palettes.filter((_$, s) => s.equal(pKey)).get(0n));
                const preview = $.const(
                    <HStack gap="1">
                        <Text>{"Read the "}</Text>
                        <Link href="https://docs.example.com" external={ext} colorPalette={palette} variant={linkVariant}>documentation</Link>
                        <Text>{" for more info."}</Text>
                    </HStack>,
                );

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Variant", vKey,
                                <SegmentGroup value={vKey} onChange={onVariant} size="sm"
                                    items={variants.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Palette", pKey,
                                <SegmentGroup value={pKey} onChange={onPalette} size="sm"
                                    items={palettes.map((_$, s) => SegmentGroup.Item(s, <Text>{s.upperCase()}</Text>))} />),
                            // A Slot, not a Control: the two switches report as
                            // the Target / Placement spec rows below rather than
                            // as one value.
                            Configurator.Slot("Behaviour",
                                <HStack gap="5" align="center" wrap="wrap">
                                    <Switch checked={ext} label="External" onChange={onExternal} />
                                </HStack>),
                        ]}
                        preview={preview}
                        aside={{
                            label: "Bump · Reactive",
                            body: (
                                <VStack gap="3" align="stretch">
                                    <Link href="https://example.com" external>{East.str`Visited ${East.print(count)} times — click here`}</Link>
                                    <Button size="xs" onClick={inc}>Bump label</Button>
                                </VStack>
                            ),
                        }}
                        spec={[
                            Configurator.Spec("Target", ext.ifElse(_$ => "new tab · noopener", _$ => "same tab")),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
