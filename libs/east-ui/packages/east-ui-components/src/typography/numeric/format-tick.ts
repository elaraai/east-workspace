/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Shared `Format` / tick formatter. Turns a numeric value plus an (unwrapped)
 * `TickFormatType` variant into a display string. Number-ish tags resolve to
 * `Intl.NumberFormat`; date / time / datetime tags treat the value as an
 * epoch-millisecond timestamp and apply the East datetime format string.
 *
 * Consumed by both the Numeric renderer and the Stat renderer so the two share
 * one formatting code path.
 *
 * @packageDocumentation
 */

import { tokenizeDateTimeFormat, formatDateTime } from "@elaraai/east/internal";
import type { ValueTypeOf } from "@elaraai/east";
import type { TickFormatType } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";

/** An unwrapped `TickFormatType` variant, or undefined when no format is set.
 *  The real East union — so each `switch` case narrows `value` to its config
 *  struct and the enum tags are the exact `Intl` literal unions. */
export type TickFormatOpt = ValueTypeOf<TickFormatType> | undefined;

/** Adds an `exceptZero` sign default when `showSign` is set and the format
 *  doesn't already pin its own sign-display. */
function withSign(options: Intl.NumberFormatOptions, showSign: boolean): Intl.NumberFormatOptions {
    return showSign && !options.signDisplay ? { signDisplay: "exceptZero", ...options } : options;
}

function someNumber(value: bigint | undefined): number | undefined {
    return value === undefined ? undefined : Number(value);
}

/**
 * Formats `n` through the given tick format. `n` is the raw numeric value
 * (for date tags, an epoch-millisecond timestamp).
 */
export function formatTick(n: number, formatOpt: TickFormatOpt, showSign = false): string {
    if (!formatOpt) {
        return new Intl.NumberFormat(undefined, withSign({}, showSign)).format(n);
    }

    switch (formatOpt.type) {
        case "number": {
            const cfg = formatOpt.value;
            return new Intl.NumberFormat(undefined, withSign({
                style: "decimal",
                minimumFractionDigits: someNumber(getSomeorUndefined(cfg.minimumFractionDigits)),
                maximumFractionDigits: someNumber(getSomeorUndefined(cfg.maximumFractionDigits)),
                signDisplay: getSomeorUndefined(cfg.signDisplay)?.type,
            }, showSign)).format(n);
        }
        case "currency": {
            const cfg = formatOpt.value;
            const compact = getSomeorUndefined(cfg.compact);
            return new Intl.NumberFormat(undefined, withSign({
                style: "currency",
                currency: cfg.currency.type,
                currencyDisplay: getSomeorUndefined(cfg.display)?.type,
                notation: compact ? "compact" : undefined,
                compactDisplay: compact?.type,
                minimumFractionDigits: someNumber(getSomeorUndefined(cfg.minimumFractionDigits)),
                maximumFractionDigits: someNumber(getSomeorUndefined(cfg.maximumFractionDigits)),
            }, showSign)).format(n);
        }
        case "percent": {
            const cfg = formatOpt.value;
            return new Intl.NumberFormat(undefined, withSign({
                style: "percent",
                minimumFractionDigits: someNumber(getSomeorUndefined(cfg.minimumFractionDigits)),
                maximumFractionDigits: someNumber(getSomeorUndefined(cfg.maximumFractionDigits)),
                signDisplay: getSomeorUndefined(cfg.signDisplay)?.type,
            }, showSign)).format(n);
        }
        case "compact": {
            const display = getSomeorUndefined(formatOpt.value.display);
            return new Intl.NumberFormat(undefined, withSign({
                notation: "compact",
                compactDisplay: display?.type,
            }, showSign)).format(n);
        }
        case "unit": {
            const cfg = formatOpt.value;
            // The East `UnitType` enum uses camelCase tags (`kilometerPerHour`),
            // but `Intl.NumberFormat` requires the hyphenated unit identifier
            // (`kilometer-per-hour`).
            const unit = (cfg.unit.type as string).replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
            return new Intl.NumberFormat(undefined, withSign({
                style: "unit",
                unit,
                unitDisplay: getSomeorUndefined(cfg.display)?.type,
            }, showSign)).format(n);
        }
        case "scientific":
            return new Intl.NumberFormat(undefined, withSign({ notation: "scientific" }, showSign)).format(n);
        case "engineering":
            return new Intl.NumberFormat(undefined, withSign({ notation: "engineering" }, showSign)).format(n);
        case "date":
        case "time":
        case "datetime":
            return formatDateTime(new Date(n), tokenizeDateTimeFormat(formatOpt.value.format));
    }

    return new Intl.NumberFormat(undefined, withSign({}, showSign)).format(n);
}
