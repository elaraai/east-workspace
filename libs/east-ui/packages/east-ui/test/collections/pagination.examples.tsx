/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, IntegerType, NullType, StringType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Configurator, Input, Pagination, Reactive, SegmentGroup, Text } from "@elaraai/east-ui";

export const paginationBasic = example({
    keywords: ["Pagination", "Root", "page", "basic", "Reactive", "State"],
    description: "Default pagination at page 0 of 25 (pageSize 20 of 500 total)",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const pageBind = $.let(State.bind([IntegerType], "pagination_basic_page", 0n));
            const page = $.let(pageBind.read());
            const onPageChange = $.const(East.function([IntegerType], NullType, ($, next) => {
                $(pageBind.write(next));
            }));
            return <Pagination page={page} pageSize={20n} count={500n} onPageChange={onPageChange} />;
        }}</Reactive>
    )),
    inputs: [],
});

export const paginationVariants = example({
    keywords: ["Pagination", "Root", "variant", "outline", "subtle", "size", "lg", "siblings", "boundaries", "color", "activeColor", "activeBackground", "palette", "Reactive", "State", "SegmentGroup", "Input", "Integer", "Configurator", "getTag", "configurator"],
    description: "Pagination configurator — variant, size, siblings and palette axes driving one live pager over 500 rows; custom swaps in the active-trigger colour overrides",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // Enumerated axes are just their variants — `getTag()` gives the
            // segment key AND its label, so there is no parallel table to
            // keep in step.
            const variants = $.const([
                variant("subtle", null), variant("outline", null),
            ], ArrayType(Pagination.Types.Variant));

            const sizes = $.const([
                variant("sm", null), variant("md", null), variant("lg", null),
            ], ArrayType(Pagination.Types.Size));

            // The colour escape hatches are presence-typed — recipe means the
            // overrides stay unset — so the palette axis is a bare label pair.
            const palettes = $.const(["recipe", "custom"], ArrayType(StringType));

            const variantBind = $.let(State.bind([StringType], "pagination_variant", "subtle"));
            const sizeBind    = $.let(State.bind([StringType], "pagination_size", "md"));
            // Siblings and boundaries are expression-fed integers — real
            // numeric inputs, not canned presets.
            const siblingsBind   = $.let(State.bind([IntegerType], "pagination_siblings", 1n));
            const boundariesBind = $.let(State.bind([IntegerType], "pagination_boundaries", 1n));
            const paletteBind = $.let(State.bind([StringType], "pagination_palette", "recipe"));
            const pageBind    = $.let(State.bind([IntegerType], "pagination_page", 5n));

            const vKey = $.let(variantBind.read());
            const sKey = $.let(sizeBind.read());
            const sibs   = $.let(siblingsBind.read());
            const bounds = $.let(boundariesBind.read());
            const cKey = $.let(paletteBind.read());
            const page = $.let(pageBind.read());

            const onVariant = $.const(East.function([StringType], NullType, ($, next) => { $(variantBind.write(next)); }));
            const onSize    = $.const(East.function([StringType], NullType, ($, next) => { $(sizeBind.write(next)); }));
            const onSiblings   = $.const(East.function([IntegerType], NullType, ($, next) => { $(siblingsBind.write(next)); }));
            const onBoundaries = $.const(East.function([IntegerType], NullType, ($, next) => { $(boundariesBind.write(next)); }));
            const onPalette = $.const(East.function([StringType], NullType, ($, next) => { $(paletteBind.write(next)); }));
            const onPageChange = $.const(East.function([IntegerType], NullType, ($, next) => { $(pageBind.write(next)); }));

            // Each selection is a lookup into the same array the control renders.
            const pagerVariant = $.let(variants.filter((_$, v) => v.getTag().equal(vKey)).get(0n));
            const size = $.let(sizes.filter((_$, v) => v.getTag().equal(sKey)).get(0n));
            const custom = $.let(cKey.equal("custom"));

            // The overrides are presence-typed options, so the palette axis
            // picks between two pagers rather than feeding empty strings.
            const pager = $.const(custom.ifElse(
                _$ => (
                    <Pagination page={page} pageSize={10n} count={500n} onPageChange={onPageChange}
                        variant={pagerVariant} size={size} siblings={sibs} boundaries={bounds}
                        activeBackground="bg.brand.subtle" activeColor="fg.inverse" />
                ),
                _$ => (
                    <Pagination page={page} pageSize={10n} count={500n} onPageChange={onPageChange}
                        variant={pagerVariant} size={size} siblings={sibs} boundaries={bounds} />
                ),
            ));

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Variant", vKey,
                            <SegmentGroup value={vKey} onChange={onVariant} size="sm"
                                items={variants.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                        Configurator.Control("Size", sKey,
                            <SegmentGroup value={sKey} onChange={onSize} size="sm"
                                items={sizes.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                        Configurator.Control("Siblings", East.print(sibs),
                            <Input.Integer value={sibs} min={0n} max={4n} step={1n} size="sm" onChange={onSiblings} />),
                        Configurator.Control("Boundaries", East.print(bounds),
                            <Input.Integer value={bounds} min={0n} max={4n} step={1n} size="sm" onChange={onBoundaries} />),
                        Configurator.Control("Palette", cKey,
                            <SegmentGroup value={cKey} onChange={onPalette} size="sm"
                                items={palettes.map((_$, p) => SegmentGroup.Item(p, <Text>{p.upperCase()}</Text>))} />),
                    ]}
                    preview={pager}
                    spec={[
                        Configurator.Spec("Pages", "50"),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
