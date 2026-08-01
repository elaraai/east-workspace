/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example } from "@elaraai/east";
import { Format, UIComponentType } from "@elaraai/east-ui";
import { Numeric, HStack, Separator, VStack } from "@elaraai/east-ui";

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
// Numeric — formats (variant panel)
// ============================================================================

export const numericVariants = example({
    keywords: ["Numeric", "Root", "percent", "sentiment", "compact", "large-number", "unit", "kg", "celsius", "scientific", "engineering", "notation", "date", "time", "datetime", "timestamp"],
    description: "Numeric variant panel — percent (positive / negative sentiment colouring), compact (1.24M / 384K for dashboards), unit (unit-carrying values with locale-aware suffix), scientific (scientific and engineering notation for large magnitudes), date time (epoch-millisecond timestamps rendered as date / time / datetime)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="PERCENT" align="start" />
                <HStack gap="6" align="baseline">
                    <Numeric value={0.98} format={Format.Percent({ maximumFractionDigits: 0n, signDisplay: "exceptZero" })} sentiment="positive" showSign />
                    <Numeric value={-0.12} format={Format.Percent({ maximumFractionDigits: 0n, signDisplay: "exceptZero" })} sentiment="negative" showSign />
                    <Numeric value={0} format={Format.Percent({ maximumFractionDigits: 0n, signDisplay: "exceptZero" })} sentiment="neutral" showSign />
                </HStack>
                <Separator label="COMPACT" align="start" />
                <HStack gap="6" align="baseline">
                    <Numeric value={1_240_000} format={Format.Compact({ display: "short" })} />
                    <Numeric value={384_000} format={Format.Compact({ display: "short" })} />
                </HStack>
                <Separator label="UNIT" align="start" />
                <HStack gap="6" align="baseline">
                    <Numeric value={12} format={Format.Unit({ unit: "kilogram", display: "short" })} />
                    <Numeric value={42.5} format={Format.Unit({ unit: "celsius", display: "short" })} />
                </HStack>
                <Separator label="SCIENTIFIC" align="start" />
                <HStack gap="6" align="baseline">
                    <Numeric value={60221408} format={Format.Scientific()} />
                    <Numeric value={60221408} format={Format.Engineering()} />
                </HStack>
                <Separator label="DATE TIME" align="start" />
                <HStack gap="6" align="baseline">
                    <Numeric value={NUMERIC_DATE_TIME_DATA} format={Format.Date("YYYY-MM-DD")} />
                    <Numeric value={NUMERIC_DATE_TIME_DATA} format={Format.Time("HH:mm")} />
                    <Numeric value={NUMERIC_DATE_TIME_DATA} format={Format.DateTime("YYYY-MM-DD HH:mm:ss")} />
                </HStack>
            </VStack>
        );
    }),
    inputs: [],
});
