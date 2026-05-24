/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, example } from "@elaraai/east";
import {
    Numeric,
    Format,
    Stack,
    UIComponentType,
} from "@elaraai/east-ui";

export const numericKpi = example({
    keywords: ["Numeric", "Root", "KPI", "currency", "mono-kpi"],
    description: "KPI tiles — current vs baseline currency values, compact notation",
    fn: East.function([], UIComponentType, (_$) => {
        const usd = (n: number) => Numeric.Root(n, {
            textStyle: "mono-kpi",
            format: Format.Currency({
                currency: "USD",
                display: "symbol",
                compact: "short",
                minimumFractionDigits: 2n,
                maximumFractionDigits: 2n,
            }),
        });
        return Stack.HStack([usd(1842500), usd(2072500)], { gap: "6", align: "baseline" });
    }),
    inputs: [],
});

export const numericPercent = example({
    keywords: ["Numeric", "Root", "percent", "sentiment"],
    description: "Percent values with positive / negative sentiment colouring",
    fn: East.function([], UIComponentType, (_$) => {
        const pct = (n: number, sentiment: "positive" | "negative" | "neutral") =>
            Numeric.Root(n, {
                format: Format.Percent({ maximumFractionDigits: 0n, signDisplay: "exceptZero" }),
                sentiment,
                showSign: true,
            });
        return Stack.HStack([
            pct(0.98, "positive"),
            pct(-0.12, "negative"),
            pct(0.00, "neutral"),
        ], { gap: "6", align: "baseline" });
    }),
    inputs: [],
});

export const numericCompact = example({
    keywords: ["Numeric", "Root", "compact", "large-number"],
    description: "Compact notation — 1.24M / 384K for dashboards",
    fn: East.function([], UIComponentType, (_$) => {
        const compact = (n: number) => Numeric.Root(n, {
            format: Format.Compact({ display: "short" }),
        });
        return Stack.HStack([compact(1_240_000), compact(384_000)], { gap: "6", align: "baseline" });
    }),
    inputs: [],
});

export const numericUnit = example({
    keywords: ["Numeric", "Root", "unit", "kg", "celsius"],
    description: "Unit-carrying values with locale-aware suffix",
    fn: East.function([], UIComponentType, (_$) => {
        const unit = (n: number, u: "kilogram" | "celsius") => Numeric.Root(n, {
            format: Format.Unit({ unit: u, display: "short" }),
        });
        return Stack.HStack([unit(12, "kilogram"), unit(42.5, "celsius")], { gap: "6", align: "baseline" });
    }),
    inputs: [],
});

export const numericScientific = example({
    keywords: ["Numeric", "Root", "scientific", "engineering", "notation"],
    description: "Scientific and engineering notation for large magnitudes",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Numeric.Root(60221408, { format: Format.Scientific() }),
            Numeric.Root(60221408, { format: Format.Engineering() }),
        ], { gap: "6", align: "baseline" });
    }),
    inputs: [],
});

export const numericDateTime = example({
    keywords: ["Numeric", "Root", "date", "time", "datetime", "timestamp"],
    description: "Epoch-millisecond timestamps rendered as date / time / datetime",
    fn: East.function([], UIComponentType, (_$) => {
        const ts = 1716249600000;
        return Stack.HStack([
            Numeric.Root(ts, { format: Format.Date("YYYY-MM-DD") }),
            Numeric.Root(ts, { format: Format.Time("HH:mm") }),
            Numeric.Root(ts, { format: Format.DateTime("YYYY-MM-DD HH:mm:ss") }),
        ], { gap: "6", align: "baseline" });
    }),
    inputs: [],
});
