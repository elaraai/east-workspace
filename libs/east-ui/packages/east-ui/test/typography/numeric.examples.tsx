/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example } from "@elaraai/east";
import { Format, UIComponentType } from "@elaraai/east-ui";
import { Numeric, HStack } from "@elaraai/east-ui";

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

export const numericPercent = example({
    keywords: ["Numeric", "Root", "percent", "sentiment"],
    description: "Percent values with positive / negative sentiment colouring",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="6" align="baseline">
                <Numeric value={0.98} format={Format.Percent({ maximumFractionDigits: 0n, signDisplay: "exceptZero" })} sentiment="positive" showSign />
                <Numeric value={-0.12} format={Format.Percent({ maximumFractionDigits: 0n, signDisplay: "exceptZero" })} sentiment="negative" showSign />
                <Numeric value={0} format={Format.Percent({ maximumFractionDigits: 0n, signDisplay: "exceptZero" })} sentiment="neutral" showSign />
            </HStack>
        );
    }),
    inputs: [],
});

export const numericCompact = example({
    keywords: ["Numeric", "Root", "compact", "large-number"],
    description: "Compact notation — 1.24M / 384K for dashboards",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="6" align="baseline">
                <Numeric value={1_240_000} format={Format.Compact({ display: "short" })} />
                <Numeric value={384_000} format={Format.Compact({ display: "short" })} />
            </HStack>
        );
    }),
    inputs: [],
});

export const numericUnit = example({
    keywords: ["Numeric", "Root", "unit", "kg", "celsius"],
    description: "Unit-carrying values with locale-aware suffix",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="6" align="baseline">
                <Numeric value={12} format={Format.Unit({ unit: "kilogram", display: "short" })} />
                <Numeric value={42.5} format={Format.Unit({ unit: "celsius", display: "short" })} />
            </HStack>
        );
    }),
    inputs: [],
});

export const numericScientific = example({
    keywords: ["Numeric", "Root", "scientific", "engineering", "notation"],
    description: "Scientific and engineering notation for large magnitudes",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="6" align="baseline">
                <Numeric value={60221408} format={Format.Scientific()} />
                <Numeric value={60221408} format={Format.Engineering()} />
            </HStack>
        );
    }),
    inputs: [],
});

export const numericDateTime = example({
    keywords: ["Numeric", "Root", "date", "time", "datetime", "timestamp"],
    description: "Epoch-millisecond timestamps rendered as date / time / datetime",
    fn: East.function([], UIComponentType, (_$) => {
        const ts = 1716249600000;
        return (
            <HStack gap="6" align="baseline">
                <Numeric value={ts} format={Format.Date("YYYY-MM-DD")} />
                <Numeric value={ts} format={Format.Time("HH:mm")} />
                <Numeric value={ts} format={Format.DateTime("YYYY-MM-DD HH:mm:ss")} />
            </HStack>
        );
    }),
    inputs: [],
});
