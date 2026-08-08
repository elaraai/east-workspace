/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, FloatType, IntegerType, NullType, StringType, StructType, example, some, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, Configurator, HStack, SegmentGroup, Select, Slider, Style, Switch, Text, VStack, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const textBasic = example({
    keywords: ["Text", "Root", "basic"],
    description: "Plain text with no styling",
    fn: East.function([], UIComponentType, (_$) => {
        return <Text>Hello World - Basic Text</Text>;
    }),
    inputs: [],
});

// ============================================================================
// Text — live configurator over every style axis
// ============================================================================

export const textVariants = example({
    keywords: ["Text", "Root", "color", "blue", "fontWeight", "bold", "fontStyle", "italic", "weights", "light", "normal", "medium", "semibold", "textTransform", "uppercase", "lowercase", "capitalize", "background", "highlight", "border", "borderWidth", "borderStyle", "borderColor", "palette", "red", "orange", "green", "teal", "purple", "combined", "textDecoration", "underline", "line-through", "overline", "letterSpacing", "lineHeight", "spacing", "opacity", "transparency", "padding", "margin", "overflow", "width", "height", "textOverflow", "ellipsis", "Reactive", "State", "interactive", "counter", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator", "textStyle", "scale", "typography", "mono-kpi", "KPI", "fontVariantNumeric", "tabular-nums", "align"],
    description: "Text configurator — ink, weight, emphasis, treatment, spacing, opacity, box, style-scale and numeric axes plus a clip switch; the scale and numeric axes render their own specimens beneath the live run",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Enumerated axes are just their variants — `getTag()` gives the
                // segment key AND its label, so there is no parallel table to
                // keep in step.
                const weights = $.const([
                    variant("light", null), variant("normal", null), variant("medium", null),
                    variant("semibold", null), variant("bold", null),
                ], ArrayType(Style.Types.FontWeight));

                // The remaining axes are presets — each bundles the props that
                // only read well together (an ink token, a face, a background /
                // border pair, a tracking / leading pair, a padding / margin
                // pair), so a struct carries the label and the values it swaps.
                const inks = $.const([
                    { label: "default", ink: "fg.default" },
                    { label: "link",    ink: "link" },
                    { label: "success", ink: "fg.success" },
                    { label: "warning", ink: "fg.warning" },
                    { label: "danger",  ink: "fg.danger" },
                    { label: "brand",   ink: "brand.600" },
                    { label: "purple",  ink: "accent.purple" },
                ], ArrayType(StructType({ label: StringType, ink: StringType })));

                const faces = $.const([
                    { label: "none",       fontStyle: variant("normal", null), decoration: variant("none", null),         transform: variant("none", null) },
                    { label: "italic",     fontStyle: variant("italic", null), decoration: variant("none", null),         transform: variant("none", null) },
                    { label: "underline",  fontStyle: variant("normal", null), decoration: variant("underline", null),    transform: variant("none", null) },
                    { label: "strike",     fontStyle: variant("normal", null), decoration: variant("line-through", null), transform: variant("none", null) },
                    { label: "overline",   fontStyle: variant("normal", null), decoration: variant("overline", null),     transform: variant("none", null) },
                    { label: "uppercase",  fontStyle: variant("normal", null), decoration: variant("none", null),         transform: variant("uppercase", null) },
                    { label: "lowercase",  fontStyle: variant("normal", null), decoration: variant("none", null),         transform: variant("lowercase", null) },
                    { label: "capitalize", fontStyle: variant("normal", null), decoration: variant("none", null),         transform: variant("capitalize", null) },
                ], ArrayType(StructType({ label: StringType, fontStyle: Style.Types.FontStyle, decoration: Style.Types.TextDecoration, transform: Style.Types.TextTransform })));

                const treatments = $.const([
                    { label: "plain",     bg: "transparent",       borderWidth: variant("none", null), borderStyle: variant("none", null),  borderColor: "transparent" },
                    { label: "highlight", bg: "bg.warning.subtle", borderWidth: variant("none", null), borderStyle: variant("none", null),  borderColor: "transparent" },
                    { label: "bordered",  bg: "transparent",       borderWidth: variant("thin", null), borderStyle: variant("solid", null), borderColor: "border.strong" },
                    { label: "brand",     bg: "bg.brand.subtle",   borderWidth: variant("thin", null), borderStyle: variant("solid", null), borderColor: "border.brand" },
                    { label: "success",   bg: "bg.success.subtle", borderWidth: variant("thin", null), borderStyle: variant("solid", null), borderColor: "status.pos" },
                ], ArrayType(StructType({ label: StringType, bg: StringType, borderWidth: Style.Types.BorderWidth, borderStyle: Style.Types.BorderStyle, borderColor: StringType })));

                const spacings = $.const([
                    { label: "normal", tracking: "normal",  leading: "normal" },
                    { label: "tight",  tracking: "tighter", leading: "short" },
                    { label: "airy",   tracking: "wider",   leading: "tall" },
                ], ArrayType(StructType({ label: StringType, tracking: StringType, leading: StringType })));

                const boxes = $.const([
                    { label: "none",   pad: "0", marg: "0" },
                    { label: "padded", pad: "4", marg: "0" },
                    { label: "spaced", pad: "2", marg: "4" },
                ], ArrayType(StructType({ label: StringType, pad: StringType, marg: StringType })));

                // The full textStyle token ramp — the selected token renders its
                // own specimen beneath the live run, so every step of the scale
                // stays reachable.
                const scales = $.const([
                    variant("display-lg", null), variant("display-md", null), variant("display-sm", null),
                    variant("heading-lg", null), variant("heading-md", null), variant("heading-sm", null),
                    variant("heading-xs", null), variant("body-lg", null), variant("body-md", null),
                    variant("body-sm", null), variant("label-md", null), variant("label-sm", null),
                    variant("caption", null), variant("overline", null), variant("code-sm", null),
                    variant("code-md", null), variant("mono-kpi", null),
                ], ArrayType(Style.Types.TextStyle));

                // The tabular-nums contract — each numeric style renders its own
                // specimen (a mono KPI figure, or a right-aligned column whose
                // digits stay in register).
                const numerics = $.const(["mono-kpi", "tabular-nums"], ArrayType(StringType));

                const inkBind       = $.let(State.bind([StringType], "text_ink", "default"));
                const weightBind    = $.let(State.bind([StringType], "text_weight", "normal"));
                const faceBind      = $.let(State.bind([StringType], "text_emphasis", "none"));
                const treatmentBind = $.let(State.bind([StringType], "text_treatment", "plain"));
                const spacingBind   = $.let(State.bind([StringType], "text_spacing", "normal"));
                const opacityBind   = $.let(State.bind([FloatType], "text_opacity", 1.0));
                const boxBind       = $.let(State.bind([StringType], "text_box", "none"));
                const scaleBind     = $.let(State.bind([StringType], "text_scale", "body-md"));
                const numericBind   = $.let(State.bind([StringType], "text_numeric", "mono-kpi"));
                const clipBind      = $.let(State.bind([BooleanType], "text_clip", false));
                const counter       = $.let(State.bind([IntegerType], "text_counter", 0n));

                const iKey  = $.let(inkBind.read());
                const wKey  = $.let(weightBind.read());
                const fKey  = $.let(faceBind.read());
                const tKey  = $.let(treatmentBind.read());
                const sKey  = $.let(spacingBind.read());
                const op    = $.let(opacityBind.read());
                const bKey  = $.let(boxBind.read());
                const scKey = $.let(scaleBind.read());
                const nKey  = $.let(numericBind.read());
                const clip  = $.let(clipBind.read());
                const count = $.let(counter.read());

                const onInk       = $.const(East.function([StringType], NullType, ($, next) => { $(inkBind.write(next)); }));
                const onWeight    = $.const(East.function([StringType], NullType, ($, next) => { $(weightBind.write(next)); }));
                const onEmphasis  = $.const(East.function([StringType], NullType, ($, next) => { $(faceBind.write(next)); }));
                const onTreatment = $.const(East.function([StringType], NullType, ($, next) => { $(treatmentBind.write(next)); }));
                const onSpacing   = $.const(East.function([StringType], NullType, ($, next) => { $(spacingBind.write(next)); }));
                const onOpacity   = $.const(East.function([FloatType], NullType, ($, next) => { $(opacityBind.write(next)); }));
                const onBox       = $.const(East.function([StringType], NullType, ($, next) => { $(boxBind.write(next)); }));
                const onScale     = $.const(East.function([StringType], NullType, ($, next) => { $(scaleBind.write(next)); }));
                const onNumeric   = $.const(East.function([StringType], NullType, ($, next) => { $(numericBind.write(next)); }));
                const onClip      = $.const(East.function([BooleanType], NullType, ($, next) => { $(clipBind.write(next)); }));
                const inc         = $.const(East.function([], NullType, $ => {
                    const cur = $.let(counter.read());
                    $(counter.write(cur.add(1n)));
                }));

                // Each selection is a lookup into the same array the control renders.
                const ink = $.let(inks.filter((_$, o) => o.label.equal(iKey)).get(0n));
                const weight = $.let(weights.filter((_$, v) => v.getTag().equal(wKey)).get(0n));
                const face = $.let(faces.filter((_$, o) => o.label.equal(fKey)).get(0n));
                const treatment = $.let(treatments.filter((_$, o) => o.label.equal(tKey)).get(0n));
                const spacing = $.let(spacings.filter((_$, o) => o.label.equal(sKey)).get(0n));
                const box = $.let(boxes.filter((_$, o) => o.label.equal(bKey)).get(0n));
                const scale = $.let(scales.filter((_$, v) => v.getTag().equal(scKey)).get(0n));

                // Each numeric style renders its own specimen — the mono KPI
                // figure, or the right-aligned column whose digits stay in
                // register under tabular-nums.
                const kpiSpecimen = $.let(<Text textStyle="mono-kpi">$1,842,500</Text>, UIComponentType);
                const tabularSpecimen = $.let((
                    <VStack gap="1" align="stretch">
                        <HStack gap="4" align="baseline">
                            <Text textStyle="body-sm" color="fg.muted">Q1</Text>
                            <Text fontFamily="mono" fontVariantNumeric="tabular-nums" textAlign="right" width="6rem">{"  1,234.56"}</Text>
                        </HStack>
                        <HStack gap="4" align="baseline">
                            <Text textStyle="body-sm" color="fg.muted">Q2</Text>
                            <Text fontFamily="mono" fontVariantNumeric="tabular-nums" textAlign="right" width="6rem">{" 98,765.43"}</Text>
                        </HStack>
                        <HStack gap="4" align="baseline">
                            <Text textStyle="body-sm" color="fg.muted">Q3</Text>
                            <Text fontFamily="mono" fontVariantNumeric="tabular-nums" textAlign="right" width="6rem">{"456,789.01"}</Text>
                        </HStack>
                        <HStack gap="4" align="baseline">
                            <Text textStyle="body-sm" color="fg.muted">Q4</Text>
                            <Text fontFamily="mono" fontVariantNumeric="tabular-nums" textAlign="right" width="6rem">{"  7,890.12"}</Text>
                        </HStack>
                    </VStack>
                ), UIComponentType);
                const numericSpecimen = $.let(nKey.equal("mono-kpi").ifElse(_$ => kpiSpecimen, _$ => tabularSpecimen));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Ink", iKey,
                                <Select value={iKey} onChange={onInk} size="sm"
                                    items={inks.map((_$, o) => Select.Item(o.label, o.label))} />),
                            Configurator.Control("Weight", wKey,
                                <Select value={wKey} onChange={onWeight} size="sm"
                                    items={weights.map((_$, v) => Select.Item(v.getTag(), v.getTag()))} />),
                            Configurator.Control("Emphasis", fKey,
                                <Select value={fKey} onChange={onEmphasis} size="sm"
                                    items={faces.map((_$, o) => Select.Item(o.label, o.label))} />),
                            Configurator.Control("Treatment", tKey,
                                <Select value={tKey} onChange={onTreatment} size="sm"
                                    items={treatments.map((_$, o) => Select.Item(o.label, o.label))} />),
                            Configurator.Control("Spacing", sKey,
                                <SegmentGroup value={sKey} onChange={onSpacing} size="sm"
                                    items={spacings.map((_$, o) => SegmentGroup.Item(o.label, <Text>{o.label.upperCase()}</Text>))} />),
                            Configurator.Control("Opacity", East.str`${East.print(op.multiply(100.0).toInteger())}%`,
                                <Slider value={op} min={0.0} max={1.0} step={0.05} size="sm" onChange={onOpacity} />),
                            Configurator.Control("Box", bKey,
                                <SegmentGroup value={bKey} onChange={onBox} size="sm"
                                    items={boxes.map((_$, o) => SegmentGroup.Item(o.label, <Text>{o.label.upperCase()}</Text>))} />),
                            Configurator.Control("Scale", scKey,
                                <Select value={scKey} onChange={onScale} size="sm"
                                    items={scales.map((_$, v) => Select.Item(v.getTag(), v.getTag()))} />),
                            Configurator.Control("Numeric", nKey,
                                <SegmentGroup value={nKey} onChange={onNumeric} size="sm"
                                    items={numerics.map((_$, s) => SegmentGroup.Item(s, <Text>{s.upperCase()}</Text>))} />),
                            // A Slot, not a Control: the switch reports as the
                            // Width / Overflow spec rows below rather than as one value.
                            Configurator.Slot("Clip",
                                <HStack gap="5" align="center" wrap="wrap">
                                    <Switch checked={clip} label="Constrain" onChange={onClip} />
                                </HStack>),
                        ]}
                        preview={
                            <VStack gap="4" align="flex-start">
                                <Text
                                    color={ink.ink}
                                    fontWeight={weight}
                                    fontStyle={face.fontStyle}
                                    textDecoration={face.decoration}
                                    textTransform={face.transform}
                                    background={treatment.bg}
                                    borderWidth={treatment.borderWidth}
                                    borderStyle={treatment.borderStyle}
                                    borderColor={treatment.borderColor}
                                    letterSpacing={spacing.tracking}
                                    lineHeight={spacing.leading}
                                    opacity={op}
                                    padding={{ top: some(box.pad), right: some(box.pad), bottom: some(box.pad), left: some(box.pad) }}
                                    margin={{ top: some(box.marg), right: some(box.marg), bottom: some(box.marg), left: some(box.marg) }}
                                    maxWidth="260px"
                                    width={clip.ifElse(_$ => "200px", _$ => "auto")}
                                    height={clip.ifElse(_$ => "40px", _$ => "auto")}
                                    overflow={clip.ifElse(_$ => variant("hidden", null), _$ => variant("visible", null))}
                                    textOverflow={clip.ifElse(_$ => variant("ellipsis", null), _$ => variant("clip", null))}
                                    whiteSpace={clip.ifElse(_$ => variant("nowrap", null), _$ => variant("normal", null))}
                                >
                                    The quick brown fox jumps over the lazy dog
                                </Text>
                                {/* Scale specimen — the selected textStyle token at its own size. */}
                                <HStack gap="3" align="baseline">
                                    <Text textStyle={scale}>{scKey}</Text>
                                    <Text textStyle="caption" color="fg.muted">{scKey}</Text>
                                </HStack>
                                {numericSpecimen}
                            </VStack>
                        }
                        aside={{
                            label: "Count · Reactive",
                            body: (
                                <HStack gap="3" align="center">
                                    <Text>{East.str`Clicked ${East.print(count)} times`}</Text>
                                    <Button size="xs" onClick={inc}>Click me</Button>
                                </HStack>
                            ),
                        }}
                        spec={[
                            Configurator.Spec("Size", clip.ifElse(_$ => "200px × 40px", _$ => "auto")),
                            Configurator.Spec("Overflow", clip.ifElse(_$ => "hidden · ellipsis", _$ => "visible")),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
