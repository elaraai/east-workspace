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
                const variantKeys = $.const(["default", "underline", "plain"], ArrayType(StringType));

                // A palette is just its name, so the axis is a bare array of
                // the value itself.
                const palettes = $.const(["brand", "danger", "gray"], ArrayType(StringType));

                const variantBind = $.let(State.bind([StringType], "link_variant", "default"));
                const paletteBind = $.let(State.bind([StringType], "link_palette", "brand"));
                const extBind     = $.let(State.bind([BooleanType], "link_external", false));
                const contextBind = $.let(State.bind([BooleanType], "link_context", false));
                const counter     = $.let(State.bind([IntegerType], "link_counter", 0n));

                const vKey  = $.let(variantBind.read());
                const pKey  = $.let(paletteBind.read());
                const ext   = $.let(extBind.read());
                const ctx   = $.let(contextBind.read());
                const count = $.let(counter.read());

                const onVariant  = $.const(East.function([StringType], NullType, ($, next) => { $(variantBind.write(next)); }));
                const onPalette  = $.const(East.function([StringType], NullType, ($, next) => { $(paletteBind.write(next)); }));
                const onExternal = $.const(East.function([BooleanType], NullType, ($, next) => { $(extBind.write(next)); }));
                const onContext  = $.const(East.function([BooleanType], NullType, ($, next) => { $(contextBind.write(next)); }));
                const inc        = $.const(East.function([], NullType, $ => {
                    const cur = $.let(counter.read());
                    $(counter.write(cur.add(1n)));
                }));

                // Each selection is a lookup into the same array the control
                // renders; the default key matches nothing, and the lookup only
                // runs on the branch where a match exists.
                const matches = $.let(variants.filter((_$, v) => v.getTag().equal(vKey)));
                const palette = $.let(palettes.filter((_$, s) => s.equal(pKey)).get(0n));

                const link = $.const(matches.size().equal(0n).ifElse(
                    _$ => <Link href="https://docs.example.com" external={ext} colorPalette={palette}>documentation</Link>,
                    _$ => <Link href="https://docs.example.com" external={ext} colorPalette={palette} variant={matches.get(0n)}>documentation</Link>,
                ));

                // In-context mode is a placement, not a prop — so the switch
                // picks between the standalone link and the same link set in a
                // running sentence.
                const preview = $.const(ctx.ifElse(
                    _$ => (
                        <HStack gap="1">
                            <Text>{"Read the "}</Text>
                            {link}
                            <Text>{" for more info."}</Text>
                        </HStack>
                    ),
                    _$ => link,
                ));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Variant", vKey,
                                <SegmentGroup value={vKey} onChange={onVariant} size="sm"
                                    items={variantKeys.map((_$, s) => SegmentGroup.Item(s, <Text>{s.upperCase()}</Text>))} />),
                            Configurator.Control("Palette", pKey,
                                <SegmentGroup value={pKey} onChange={onPalette} size="sm"
                                    items={palettes.map((_$, s) => SegmentGroup.Item(s, <Text>{s.upperCase()}</Text>))} />),
                            // A Slot, not a Control: the two switches report as
                            // the Target / Placement spec rows below rather than
                            // as one value.
                            Configurator.Slot("Behaviour",
                                <HStack gap="5" align="center" wrap="wrap">
                                    <Switch checked={ext} label="External" onChange={onExternal} />
                                    <Switch checked={ctx} label="In sentence" onChange={onContext} />
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
                            Configurator.Spec("Placement", ctx.ifElse(_$ => "in sentence", _$ => "standalone")),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
