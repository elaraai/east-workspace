/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, FloatType, NullType, StringType, StructType, example, variant } from "@elaraai/east";
import { Format, State, UIComponentType } from "@elaraai/east-ui";
import { Configurator, Numeric, SegmentGroup, Select, Switch, HStack, Text, VStack, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Module-scope fixtures — one per merged example (consolidation epic #455).
// ============================================================================

const NUMERIC_DATE_TIME_DATA = 1716249600000;

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const numericKpi = example({
    keywords: ["Numeric", "Root", "KPI", "currency", "mono-kpi"],
    description: "KPI tiles — current vs baseline currency values, compact notation",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="6" align="baseline">
                <Numeric value={1842500} textStyle="mono-kpi" format={Format.Currency({ currency: "USD", display: "symbol", compact: "short", minimumFractionDigits: 2n, maximumFractionDigits: 2n })} />
                <Numeric value={2072500} textStyle="mono-kpi" format={Format.Currency({ currency: "USD", display: "symbol", compact: "short", minimumFractionDigits: 2n, maximumFractionDigits: 2n })} />
            </HStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Numeric — live configurator over every figure axis
// ============================================================================

export const numericVariants = example({
    keywords: ["Numeric", "Root", "percent", "sentiment", "compact", "large-number", "unit", "kg", "celsius", "scientific", "engineering", "notation", "date", "time", "datetime", "timestamp", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "Numeric configurator — format and sentiment axes plus a signed switch driving one live figure, each format swapping in its own magnitude; the aside shows the sibling notations",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Format is the one axis that needs a struct: a formatter is
                // only legible against the magnitude it was built for, so each
                // entry carries the raw value that goes with it. The format's
                // own `getTag()` still names the segment — there is no separate
                // key column.
                const formats = $.const([
                    { format: Format.Percent({ maximumFractionDigits: 0n, signDisplay: "exceptZero" }), value: 0.98 },
                    { format: Format.Compact({ display: "short" }), value: 1_240_000.0 },
                    { format: Format.Unit({ unit: "celsius", display: "short" }), value: 42.5 },
                    { format: Format.Scientific(), value: 60221408.0 },
                    { format: Format.DateTime("YYYY-MM-DD HH:mm:ss"), value: NUMERIC_DATE_TIME_DATA },
                ], ArrayType(StructType({ format: Format.Types.Tick, value: FloatType })));

                // Enumerated axes are just their variants — `getTag()` gives the
                // segment key AND its label, so there is no parallel table to
                // keep in step.
                const sentiments = $.const([
                    variant("positive", null), variant("negative", null), variant("neutral", null),
                ], ArrayType(Numeric.Types.Sentiment));

                const formatBind    = $.let(State.bind([StringType], "numeric_format", "percent"));
                const sentimentBind = $.let(State.bind([StringType], "numeric_sentiment", "positive"));
                const signBind      = $.let(State.bind([BooleanType], "numeric_sign", true));

                const fKey   = $.let(formatBind.read());
                const sKey   = $.let(sentimentBind.read());
                const signed = $.let(signBind.read());

                const onFormat    = $.const(East.function([StringType], NullType, ($, next) => { $(formatBind.write(next)); }));
                const onSentiment = $.const(East.function([StringType], NullType, ($, next) => { $(sentimentBind.write(next)); }));
                const onSign      = $.const(East.function([BooleanType], NullType, ($, next) => { $(signBind.write(next)); }));

                // Each selection is a lookup into the same array the control renders.
                const metric = $.let(formats.filter((_$, o) => o.format.getTag().equal(fKey)).get(0n));
                const sentiment = $.let(sentiments.filter((_$, v) => v.getTag().equal(sKey)).get(0n));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Format", fKey,
                                <Select value={fKey} onChange={onFormat} size="sm"
                                    items={formats.map((_$, o) => Select.Item(o.format.getTag(), o.format.getTag()))} />),
                            Configurator.Control("Sentiment", sKey,
                                <SegmentGroup value={sKey} onChange={onSentiment} size="sm"
                                    items={sentiments.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            // A Slot, not a Control: the switch reports as the
                            // Sign spec row below rather than as one value.
                            Configurator.Slot("Sign",
                                <HStack gap="5" align="center" wrap="wrap">
                                    <Switch checked={signed} label="Signed" onChange={onSign} />
                                </HStack>),
                        ]}
                        preview={
                            <Numeric value={metric.value} format={metric.format} sentiment={sentiment} showSign={signed} />
                        }
                        aside={{
                            label: "Sibling notations",
                            body: (
                                <VStack gap="2" align="stretch">
                                    <Numeric value={60221408} format={Format.Engineering()} />
                                    <Numeric value={12} format={Format.Unit({ unit: "kilogram", display: "short" })} />
                                    <Numeric value={NUMERIC_DATE_TIME_DATA} format={Format.Date("YYYY-MM-DD")} />
                                    <Numeric value={NUMERIC_DATE_TIME_DATA} format={Format.Time("HH:mm")} />
                                </VStack>
                            ),
                        }}
                        spec={[
                            Configurator.Spec("Raw value", East.print(metric.value)),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
