/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, IntegerType, NullType, StringType, StructType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Configurator, Pagination, Reactive, SegmentGroup, Text } from "@elaraai/east-ui";

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
    keywords: ["Pagination", "Root", "variant", "outline", "subtle", "size", "lg", "siblings", "boundaries", "color", "activeColor", "activeBackground", "palette", "Reactive", "State", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
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

            // Siblings and boundaries travel together — the trigger window is
            // only legible as a pair, so the axis is a struct.
            const spans = $.const([
                { label: "narrow", siblings: 1n, boundaries: 1n },
                { label: "wide",   siblings: 2n, boundaries: 2n },
            ], ArrayType(StructType({ label: StringType, siblings: IntegerType, boundaries: IntegerType })));

            // The colour escape hatches are presence-typed — recipe means the
            // overrides stay unset — so the palette axis is a bare label pair.
            const palettes = $.const(["recipe", "custom"], ArrayType(StringType));

            const variantBind = $.let(State.bind([StringType], "pagination_variant", "subtle"));
            const sizeBind    = $.let(State.bind([StringType], "pagination_size", "md"));
            const spanBind    = $.let(State.bind([StringType], "pagination_span", "narrow"));
            const paletteBind = $.let(State.bind([StringType], "pagination_palette", "recipe"));
            const pageBind    = $.let(State.bind([IntegerType], "pagination_page", 5n));

            const vKey = $.let(variantBind.read());
            const sKey = $.let(sizeBind.read());
            const wKey = $.let(spanBind.read());
            const cKey = $.let(paletteBind.read());
            const page = $.let(pageBind.read());

            const onVariant = $.const(East.function([StringType], NullType, ($, next) => { $(variantBind.write(next)); }));
            const onSize    = $.const(East.function([StringType], NullType, ($, next) => { $(sizeBind.write(next)); }));
            const onSpan    = $.const(East.function([StringType], NullType, ($, next) => { $(spanBind.write(next)); }));
            const onPalette = $.const(East.function([StringType], NullType, ($, next) => { $(paletteBind.write(next)); }));
            const onPageChange = $.const(East.function([IntegerType], NullType, ($, next) => { $(pageBind.write(next)); }));

            // Each selection is a lookup into the same array the control renders.
            const pagerVariant = $.let(variants.filter((_$, v) => v.getTag().equal(vKey)).get(0n));
            const size = $.let(sizes.filter((_$, v) => v.getTag().equal(sKey)).get(0n));
            const span = $.let(spans.filter((_$, o) => o.label.equal(wKey)).get(0n));
            const custom = $.let(cKey.equal("custom"));

            // The overrides are presence-typed options, so the palette axis
            // picks between two pagers rather than feeding empty strings.
            const pager = $.const(custom.ifElse(
                _$ => (
                    <Pagination page={page} pageSize={10n} count={500n} onPageChange={onPageChange}
                        variant={pagerVariant} size={size} siblings={span.siblings} boundaries={span.boundaries}
                        activeBackground="bg.brand.subtle" activeColor="fg.inverse" />
                ),
                _$ => (
                    <Pagination page={page} pageSize={10n} count={500n} onPageChange={onPageChange}
                        variant={pagerVariant} size={size} siblings={span.siblings} boundaries={span.boundaries} />
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
                        Configurator.Control("Siblings", wKey,
                            <SegmentGroup value={wKey} onChange={onSpan} size="sm"
                                items={spans.map((_$, o) => SegmentGroup.Item(o.label, <Text>{o.label.upperCase()}</Text>))} />),
                        Configurator.Control("Palette", cKey,
                            <SegmentGroup value={cKey} onChange={onPalette} size="sm"
                                items={palettes.map((_$, p) => SegmentGroup.Item(p, <Text>{p.upperCase()}</Text>))} />),
                    ]}
                    preview={pager}
                    spec={[
                        Configurator.Spec("Pages", "50"),
                        Configurator.Spec("Window", East.str`${East.print(span.siblings)} · ${East.print(span.boundaries)}`),
                        Configurator.Spec("Palette", custom.ifElse(_$ => "active overrides", _$ => "recipe")),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
