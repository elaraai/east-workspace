/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, variant, example } from "@elaraai/east";
import {
    Numeric,
    NumericFormatType,
    Stack,
    UIComponentType,
} from "@elaraai/east-ui";

export const numericKpi = example({
    keywords: ["Numeric", "Root", "KPI", "currency", "mono-kpi"],
    description: "KPI tiles — current vs baseline currency values, compact notation",
    fn: East.function([], UIComponentType, (_$) => {
        const usd = (n: number) => Numeric.Root(n, {
            format: East.value(variant("Currency", {
                currency: variant("USD", null),
                display: variant("some", variant("symbol", null)),
                compact: variant("some", variant("short", null)),
                minimumFractionDigits: variant("some", 2n),
                maximumFractionDigits: variant("some", 2n),
            }), NumericFormatType),
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
                format: East.value(variant("Percent", {
                    minimumFractionDigits: variant("none", null),
                    maximumFractionDigits: variant("some", 0n),
                    signDisplay: variant("some", variant("exceptZero", null)),
                }), NumericFormatType),
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
            format: East.value(variant("Compact", {
                display: variant("some", variant("short", null)),
            }), NumericFormatType),
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
            format: East.value(variant("Unit", {
                unit: variant(u, null),
                display: variant("some", variant("short", null)),
            }), NumericFormatType),
        });
        return Stack.HStack([unit(12, "kilogram"), unit(42.5, "celsius")], { gap: "6", align: "baseline" });
    }),
    inputs: [],
});
