/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, example } from "@elaraai/east";
import { Format } from "@elaraai/east-ui";

export const formatNumberBasic = example({
    keywords: ["Format", "Number", "tick"],
    description: "Plain number with two decimal places",
    fn: East.function([], Format.Types.Tick, (_$) => {
        return Format.Number({ minimumFractionDigits: 2n, maximumFractionDigits: 2n });
    }),
    inputs: [],
});

export const formatCurrencyAud = example({
    keywords: ["Format", "Currency", "AUD", "compact"],
    description: "AUD currency with compact short notation",
    fn: East.function([], Format.Types.Tick, (_$) => {
        return Format.Currency({ currency: "AUD", compact: "short" });
    }),
    inputs: [],
});

export const formatPercent = example({
    keywords: ["Format", "Percent", "tick"],
    description: "Percent with one decimal place",
    fn: East.function([], Format.Types.Tick, (_$) => {
        return Format.Percent({ maximumFractionDigits: 1n });
    }),
    inputs: [],
});

export const formatCompact = example({
    keywords: ["Format", "Compact", "short"],
    description: "Compact short notation",
    fn: East.function([], Format.Types.Tick, (_$) => {
        return Format.Compact({ display: "short" });
    }),
    inputs: [],
});

export const formatUnit = example({
    keywords: ["Format", "Unit", "kilometerPerHour"],
    description: "Unit format with short display",
    fn: East.function([], Format.Types.Tick, (_$) => {
        return Format.Unit({ unit: "kilometerPerHour", display: "short" });
    }),
    inputs: [],
});

export const formatScientific = example({
    keywords: ["Format", "Scientific"],
    description: "Scientific notation",
    fn: East.function([], Format.Types.Tick, (_$) => {
        return Format.Scientific();
    }),
    inputs: [],
});

export const formatEngineering = example({
    keywords: ["Format", "Engineering"],
    description: "Engineering notation",
    fn: East.function([], Format.Types.Tick, (_$) => {
        return Format.Engineering();
    }),
    inputs: [],
});

export const formatDate = example({
    keywords: ["Format", "Date", "YYYY-MM-DD"],
    description: "ISO-style date format",
    fn: East.function([], Format.Types.Tick, (_$) => {
        return Format.Date("YYYY-MM-DD");
    }),
    inputs: [],
});

export const formatTime = example({
    keywords: ["Format", "Time", "HH:mm"],
    description: "24-hour time format",
    fn: East.function([], Format.Types.Tick, (_$) => {
        return Format.Time("HH:mm");
    }),
    inputs: [],
});

export const formatDateTime = example({
    keywords: ["Format", "DateTime", "YYYY-MM-DD HH:mm:ss"],
    description: "Combined ISO date+time format",
    fn: East.function([], Format.Types.Tick, (_$) => {
        return Format.DateTime("YYYY-MM-DD HH:mm:ss");
    }),
    inputs: [],
});
