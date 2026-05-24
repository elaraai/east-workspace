/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    IntegerType,
    StringType,
    variant,
    some,
    none,
} from "@elaraai/east";

import {
    NumberFormatType,
    CurrencyFormatType,
    PercentFormatType,
    CompactFormatType,
    UnitFormatType,
    DateFormatType,
    TimeFormatType,
    DateTimeFormatType,
    TickFormatType,
    SignDisplayType,
    type SignDisplayLiteral,
    CurrencyCodeType,
    type CurrencyCodeLiteral,
    CurrencyDisplayType,
    type CurrencyDisplayLiteral,
    CompactDisplayType,
    type CompactDisplayLiteral,
    UnitType,
    type UnitLiteral,
    UnitDisplayType,
    type UnitDisplayLiteral,
} from "../charts/types.js";

// ============================================================================
// Helper coercions
// ============================================================================

function toSignDisplay(
    v: SubtypeExprOrValue<SignDisplayType> | SignDisplayLiteral | undefined,
): ExprType<SignDisplayType> | undefined {
    if (v === undefined) return undefined;
    return typeof v === "string"
        ? East.value(variant(v, null), SignDisplayType)
        : v as ExprType<SignDisplayType>;
}

function toCompactDisplay(
    v: SubtypeExprOrValue<CompactDisplayType> | CompactDisplayLiteral | undefined,
): ExprType<CompactDisplayType> | undefined {
    if (v === undefined) return undefined;
    return typeof v === "string"
        ? East.value(variant(v, null), CompactDisplayType)
        : v as ExprType<CompactDisplayType>;
}

function toCurrencyCode(
    v: SubtypeExprOrValue<CurrencyCodeType> | CurrencyCodeLiteral,
): ExprType<CurrencyCodeType> {
    return typeof v === "string"
         
        ? East.value(variant(v as any, null), CurrencyCodeType)
        : v as ExprType<CurrencyCodeType>;
}

function toCurrencyDisplay(
    v: SubtypeExprOrValue<CurrencyDisplayType> | CurrencyDisplayLiteral | undefined,
): ExprType<CurrencyDisplayType> | undefined {
    if (v === undefined) return undefined;
    return typeof v === "string"
        ? East.value(variant(v, null), CurrencyDisplayType)
        : v as ExprType<CurrencyDisplayType>;
}

function toUnit(
    v: SubtypeExprOrValue<UnitType> | UnitLiteral,
): ExprType<UnitType> {
    return typeof v === "string"
         
        ? East.value(variant(v as any, null), UnitType)
        : v as ExprType<UnitType>;
}

function toUnitDisplay(
    v: SubtypeExprOrValue<UnitDisplayType> | UnitDisplayLiteral | undefined,
): ExprType<UnitDisplayType> | undefined {
    if (v === undefined) return undefined;
    return typeof v === "string"
        ? East.value(variant(v, null), UnitDisplayType)
        : v as ExprType<UnitDisplayType>;
}

// ============================================================================
// Factory option interfaces
// ============================================================================

/**
 * Options for `Format.Number`.
 *
 * @property minimumFractionDigits - Minimum decimal places
 * @property maximumFractionDigits - Maximum decimal places
 * @property signDisplay - How to display sign (`auto`, `always`, `never`, `exceptZero`)
 */
export interface NumberFormatOptions {
    /** Minimum decimal places */
    minimumFractionDigits?: SubtypeExprOrValue<IntegerType>;
    /** Maximum decimal places */
    maximumFractionDigits?: SubtypeExprOrValue<IntegerType>;
    /** How to display sign */
    signDisplay?: SubtypeExprOrValue<SignDisplayType> | SignDisplayLiteral;
}

/**
 * Options for `Format.Currency`.
 *
 * @property currency - ISO 4217 currency code (required)
 * @property display - How to display the currency (`symbol`, `narrowSymbol`, `code`, `name`)
 * @property compact - Compact notation (`short`, `long`)
 * @property minimumFractionDigits - Minimum decimal places
 * @property maximumFractionDigits - Maximum decimal places
 */
export interface CurrencyFormatOptions {
    /** ISO 4217 currency code */
    currency: SubtypeExprOrValue<CurrencyCodeType> | CurrencyCodeLiteral;
    /** How to display the currency */
    display?: SubtypeExprOrValue<CurrencyDisplayType> | CurrencyDisplayLiteral;
    /** Compact notation */
    compact?: SubtypeExprOrValue<CompactDisplayType> | CompactDisplayLiteral;
    /** Minimum decimal places */
    minimumFractionDigits?: SubtypeExprOrValue<IntegerType>;
    /** Maximum decimal places */
    maximumFractionDigits?: SubtypeExprOrValue<IntegerType>;
}

/**
 * Options for `Format.Percent`.
 *
 * @property minimumFractionDigits - Minimum decimal places
 * @property maximumFractionDigits - Maximum decimal places
 * @property signDisplay - How to display sign
 */
export interface PercentFormatOptions {
    /** Minimum decimal places */
    minimumFractionDigits?: SubtypeExprOrValue<IntegerType>;
    /** Maximum decimal places */
    maximumFractionDigits?: SubtypeExprOrValue<IntegerType>;
    /** How to display sign */
    signDisplay?: SubtypeExprOrValue<SignDisplayType> | SignDisplayLiteral;
}

/**
 * Options for `Format.Compact`.
 *
 * @property display - Short (1K) or long (1 thousand)
 */
export interface CompactFormatOptions {
    /** Short (1K) or long (1 thousand) */
    display?: SubtypeExprOrValue<CompactDisplayType> | CompactDisplayLiteral;
}

/**
 * Options for `Format.Unit`.
 *
 * @property unit - The unit to format (required)
 * @property display - How to display the unit
 */
export interface UnitFormatOptions {
    /** The unit to format */
    unit: SubtypeExprOrValue<UnitType> | UnitLiteral;
    /** How to display the unit */
    display?: SubtypeExprOrValue<UnitDisplayType> | UnitDisplayLiteral;
}

// ============================================================================
// Factory functions
// ============================================================================

function createNumber(options?: NumberFormatOptions): ExprType<TickFormatType> {
    const signValue = toSignDisplay(options?.signDisplay);
    const cfg = East.value({
        minimumFractionDigits: options?.minimumFractionDigits !== undefined ? some(options.minimumFractionDigits) : none,
        maximumFractionDigits: options?.maximumFractionDigits !== undefined ? some(options.maximumFractionDigits) : none,
        signDisplay: signValue ? some(signValue) : none,
    }, NumberFormatType);
    return East.value(variant("number", cfg), TickFormatType);
}

function createCurrency(options: CurrencyFormatOptions): ExprType<TickFormatType> {
    const displayValue = toCurrencyDisplay(options.display);
    const compactValue = toCompactDisplay(options.compact);
    const cfg = East.value({
        currency: toCurrencyCode(options.currency),
        display: displayValue ? some(displayValue) : none,
        compact: compactValue ? some(compactValue) : none,
        minimumFractionDigits: options.minimumFractionDigits !== undefined ? some(options.minimumFractionDigits) : none,
        maximumFractionDigits: options.maximumFractionDigits !== undefined ? some(options.maximumFractionDigits) : none,
    }, CurrencyFormatType);
    return East.value(variant("currency", cfg), TickFormatType);
}

function createPercent(options?: PercentFormatOptions): ExprType<TickFormatType> {
    const signValue = toSignDisplay(options?.signDisplay);
    const cfg = East.value({
        minimumFractionDigits: options?.minimumFractionDigits !== undefined ? some(options.minimumFractionDigits) : none,
        maximumFractionDigits: options?.maximumFractionDigits !== undefined ? some(options.maximumFractionDigits) : none,
        signDisplay: signValue ? some(signValue) : none,
    }, PercentFormatType);
    return East.value(variant("percent", cfg), TickFormatType);
}

function createCompact(options?: CompactFormatOptions): ExprType<TickFormatType> {
    const displayValue = toCompactDisplay(options?.display);
    const cfg = East.value({
        display: displayValue ? some(displayValue) : none,
    }, CompactFormatType);
    return East.value(variant("compact", cfg), TickFormatType);
}

function createUnit(options: UnitFormatOptions): ExprType<TickFormatType> {
    const displayValue = toUnitDisplay(options.display);
    const cfg = East.value({
        unit: toUnit(options.unit),
        display: displayValue ? some(displayValue) : none,
    }, UnitFormatType);
    return East.value(variant("unit", cfg), TickFormatType);
}

function createScientific(): ExprType<TickFormatType> {
    return East.value(variant("scientific", null), TickFormatType);
}

function createEngineering(): ExprType<TickFormatType> {
    return East.value(variant("engineering", null), TickFormatType);
}

function createDate(format: SubtypeExprOrValue<StringType>): ExprType<TickFormatType> {
    const cfg = East.value({ format }, DateFormatType);
    return East.value(variant("date", cfg), TickFormatType);
}

function createTime(format: SubtypeExprOrValue<StringType>): ExprType<TickFormatType> {
    const cfg = East.value({ format }, TimeFormatType);
    return East.value(variant("time", cfg), TickFormatType);
}

function createDateTime(format: SubtypeExprOrValue<StringType>): ExprType<TickFormatType> {
    const cfg = East.value({ format }, DateTimeFormatType);
    return East.value(variant("datetime", cfg), TickFormatType);
}

// ============================================================================
// Format namespace
// ============================================================================

/**
 * `Format` — locale-aware number, currency, percent, compact, unit, date,
 * time, and datetime formatting helpers.
 *
 * @remarks
 * Each helper returns an `ExprType<TickFormatType>` value usable wherever
 * the IR accepts a tick / axis / tooltip / cell formatter — chart axes,
 * `Numeric.Root`, `Stat.Root`, table column renderers, etc.
 *
 * Underlying StructTypes are exposed via `Format.Types.*` for callers that
 * need the raw East type (e.g. constructing IR by hand).
 *
 * @example
 * ```ts
 * import { Format } from "@elaraai/east-ui";
 *
 * Format.Number({ minimumFractionDigits: 2n, maximumFractionDigits: 2n });
 * Format.Currency({ currency: "AUD", compact: "short" });
 * Format.Percent({ maximumFractionDigits: 1n });
 * Format.Compact({ display: "short" });
 * Format.Unit({ unit: "kilometer-per-hour", display: "short" });
 * Format.Scientific();
 * Format.Engineering();
 * Format.Date("YYYY-MM-DD");
 * Format.Time("HH:mm");
 * Format.DateTime("YYYY-MM-DD HH:mm:ss");
 * ```
 */
export const Format = {
    /**
     * Plain number with optional decimal-place + sign-display configuration.
     *
     * @param options - Optional `minimumFractionDigits` / `maximumFractionDigits` / `signDisplay`
     * @returns An East expression representing a number tick format
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Numeric, Format, UIComponentType } from "@elaraai/east-ui";
     *
     * const ui = East.function([], UIComponentType, _$ =>
     *     Numeric.Root(1234.5, { format: Format.Number({ minimumFractionDigits: 2n, maximumFractionDigits: 2n }) }),
     * );
     * ```
     */
    Number: createNumber,
    /**
     * Currency with ISO 4217 code + optional display / compact / decimal-place
     * configuration.
     *
     * @param options - `currency` (required) plus `display` / `compact` / `minimumFractionDigits` / `maximumFractionDigits`
     * @returns An East expression representing a currency tick format
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Numeric, Format, UIComponentType } from "@elaraai/east-ui";
     *
     * const ui = East.function([], UIComponentType, _$ =>
     *     Numeric.Root(1842500, { format: Format.Currency({ currency: "AUD", compact: "short" }) }),
     * );
     * ```
     */
    Currency: createCurrency,
    /**
     * Percentage with optional decimal-place + sign-display configuration.
     *
     * @param options - Optional `minimumFractionDigits` / `maximumFractionDigits` / `signDisplay`
     * @returns An East expression representing a percent tick format
     */
    Percent: createPercent,
    /**
     * Compact notation (1K, 1M, 1B …) with `short` / `long` display.
     *
     * @param options - Optional `display` (`short` | `long`)
     * @returns An East expression representing a compact tick format
     */
    Compact: createCompact,
    /**
     * Unit formatting (`bytes`, `meters`, `kilometer-per-hour` …).
     *
     * @param options - `unit` (required) + optional `display`
     * @returns An East expression representing a unit tick format
     */
    Unit: createUnit,
    /**
     * Scientific notation (1.23e+4).
     *
     * @returns An East expression representing a scientific tick format
     */
    Scientific: createScientific,
    /**
     * Engineering notation (12.3e+3).
     *
     * @returns An East expression representing an engineering tick format
     */
    Engineering: createEngineering,
    /**
     * Date formatting using East format strings (`YYYY-MM-DD`, `MMM D, YYYY`).
     *
     * @param format - East datetime format string
     * @returns An East expression representing a date tick format
     */
    Date: createDate,
    /**
     * Time formatting using East format strings (`HH:mm:ss`, `h:mm A`).
     *
     * @param format - East datetime format string
     * @returns An East expression representing a time tick format
     */
    Time: createTime,
    /**
     * Combined date+time formatting (`YYYY-MM-DD HH:mm:ss`).
     *
     * @param format - East datetime format string
     * @returns An East expression representing a datetime tick format
     */
    DateTime: createDateTime,
    Types: {
        /**
         * East StructType for plain-number formatting configuration.
         *
         * @property minimumFractionDigits - Minimum decimal places
         * @property maximumFractionDigits - Maximum decimal places
         * @property signDisplay - How to display sign
         */
        Number: NumberFormatType,
        /**
         * East StructType for currency formatting configuration.
         *
         * @property currency - ISO 4217 currency code
         * @property display - How to display the currency
         * @property compact - Compact notation flag
         * @property minimumFractionDigits - Minimum decimal places
         * @property maximumFractionDigits - Maximum decimal places
         */
        Currency: CurrencyFormatType,
        /**
         * East StructType for percent formatting configuration.
         *
         * @property minimumFractionDigits - Minimum decimal places
         * @property maximumFractionDigits - Maximum decimal places
         * @property signDisplay - How to display sign
         */
        Percent: PercentFormatType,
        /**
         * East StructType for compact-notation formatting configuration.
         *
         * @property display - Short (1K) or long (1 thousand)
         */
        Compact: CompactFormatType,
        /**
         * East StructType for unit formatting configuration.
         *
         * @property unit - The unit to format
         * @property display - How to display the unit
         */
        Unit: UnitFormatType,
        /**
         * East StructType for date formatting configuration.
         *
         * @property format - East datetime format string
         */
        Date: DateFormatType,
        /**
         * East StructType for time formatting configuration.
         *
         * @property format - East datetime format string
         */
        Time: TimeFormatType,
        /**
         * East StructType for datetime formatting configuration.
         *
         * @property format - East datetime format string
         */
        DateTime: DateTimeFormatType,
        /**
         * East VariantType union of every tick / axis / cell formatter.
         *
         * @property number - Plain number format
         * @property currency - Currency format
         * @property percent - Percentage format
         * @property compact - Compact notation
         * @property unit - Unit format
         * @property scientific - Scientific notation
         * @property engineering - Engineering notation
         * @property date - Date format
         * @property time - Time format
         * @property datetime - Combined date+time format
         */
        Tick: TickFormatType,
        /**
         * East VariantType for sign-display options.
         *
         * @property auto - Default sign display
         * @property always - Always show a sign (positive included)
         * @property never - Never show a sign
         * @property exceptZero - Show a sign except for zero
         */
        SignDisplay: SignDisplayType,
        /**
         * East VariantType for currency-code values.
         */
        CurrencyCode: CurrencyCodeType,
        /**
         * East VariantType for currency-display options.
         */
        CurrencyDisplay: CurrencyDisplayType,
        /**
         * East VariantType for compact-notation display options.
         */
        CompactDisplay: CompactDisplayType,
        /**
         * East VariantType for unit values.
         */
        Unit_: UnitType,
        /**
         * East VariantType for unit-display options.
         */
        UnitDisplay: UnitDisplayType,
    },
} as const;
