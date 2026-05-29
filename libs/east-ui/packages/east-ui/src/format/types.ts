/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Value-formatting types — the `TickFormat` model and its supporting display
 * enums (number / currency / percent / compact / unit / date / time / datetime).
 *
 * @remarks
 * Consumed by the `Format` builders, `Numeric`, and `Stat` to render a value for
 * display. Distinct from the chart axis tick format (`ChartTickFormatType` in
 * `charts/spec`), which the visx renderer owns.
 *
 * @packageDocumentation
 */

import {
    OptionType,
    StructType,
    StringType,
    VariantType,
    NullType,
    IntegerType,
} from "@elaraai/east";

// ============================================================================
// Tick Format Supporting Types
// ============================================================================

/**
 * Compact display style for number formatting.
 *
 * @property short - Short notation (1K, 1M, 1B)
 * @property long - Long notation (1 thousand, 1 million)
 */
export const CompactDisplayType = VariantType({
    short: NullType,
    long: NullType,
});
export type CompactDisplayType = typeof CompactDisplayType;
export type CompactDisplayLiteral = "short" | "long";

/**
 * Currency display style.
 *
 * @property code - ISO code (USD, EUR)
 * @property symbol - Currency symbol ($, €)
 * @property narrowSymbol - Narrow symbol variant
 * @property name - Full name (US dollars)
 */
export const CurrencyDisplayType = VariantType({
    code: NullType,
    symbol: NullType,
    narrowSymbol: NullType,
    name: NullType,
});
export type CurrencyDisplayType = typeof CurrencyDisplayType;
export type CurrencyDisplayLiteral = "code" | "symbol" | "narrowSymbol" | "name";

/**
 * Unit display style.
 *
 * @property short - Short form (16 l)
 * @property narrow - Narrow form (16l)
 * @property long - Long form (16 liters)
 */
export const UnitDisplayType = VariantType({
    short: NullType,
    narrow: NullType,
    long: NullType,
});
export type UnitDisplayType = typeof UnitDisplayType;
export type UnitDisplayLiteral = "short" | "narrow" | "long";

/**
 * Sign display style for numbers.
 *
 * @property auto - Sign for negative only (default)
 * @property never - Never show sign
 * @property always - Always show sign
 * @property exceptZero - Show sign except for zero
 */
export const SignDisplayType = VariantType({
    auto: NullType,
    never: NullType,
    always: NullType,
    exceptZero: NullType,
});
export type SignDisplayType = typeof SignDisplayType;
export type SignDisplayLiteral = "auto" | "never" | "always" | "exceptZero";

/**
 * Date/time style for Intl.DateTimeFormat.
 *
 * @property full - Full format (Wednesday, March 15, 2024)
 * @property long - Long format (March 15, 2024)
 * @property medium - Medium format (Mar 15, 2024)
 * @property short - Short format (3/15/24)
 */
export const DateTimeStyleType = VariantType({
    full: NullType,
    long: NullType,
    medium: NullType,
    short: NullType,
});
export type DateTimeStyleType = typeof DateTimeStyleType;
export type DateTimeStyleLiteral = "full" | "long" | "medium" | "short";

/**
 * ISO 4217 currency codes.
 *
 * @remarks
 * Common currencies supported by Intl.NumberFormat.
 *
 * Major currencies:
 * @property USD - US Dollar
 * @property EUR - Euro
 * @property GBP - British Pound
 * @property JPY - Japanese Yen
 * @property CHF - Swiss Franc
 * @property CAD - Canadian Dollar
 * @property AUD - Australian Dollar
 * @property NZD - New Zealand Dollar
 *
 * Asian currencies:
 * @property CNY - Chinese Yuan
 * @property HKD - Hong Kong Dollar
 * @property SGD - Singapore Dollar
 * @property KRW - South Korean Won
 * @property INR - Indian Rupee
 * @property TWD - Taiwan Dollar
 * @property THB - Thai Baht
 * @property MYR - Malaysian Ringgit
 * @property IDR - Indonesian Rupiah
 * @property PHP - Philippine Peso
 * @property VND - Vietnamese Dong
 *
 * European currencies:
 * @property SEK - Swedish Krona
 * @property NOK - Norwegian Krone
 * @property DKK - Danish Krone
 * @property PLN - Polish Zloty
 * @property CZK - Czech Koruna
 * @property HUF - Hungarian Forint
 * @property RUB - Russian Ruble
 * @property UAH - Ukrainian Hryvnia
 * @property RON - Romanian Leu
 *
 * Americas currencies:
 * @property MXN - Mexican Peso
 * @property BRL - Brazilian Real
 * @property ARS - Argentine Peso
 * @property CLP - Chilean Peso
 * @property COP - Colombian Peso
 * @property PEN - Peruvian Sol
 *
 * Middle East/Africa currencies:
 * @property AED - UAE Dirham
 * @property SAR - Saudi Riyal
 * @property ILS - Israeli Shekel
 * @property ZAR - South African Rand
 * @property TRY - Turkish Lira
 * @property EGP - Egyptian Pound
 * @property NGN - Nigerian Naira
 * @property KES - Kenyan Shilling
 */
export const CurrencyCodeType = VariantType({
    // Major
    USD: NullType,
    EUR: NullType,
    GBP: NullType,
    JPY: NullType,
    CHF: NullType,
    CAD: NullType,
    AUD: NullType,
    NZD: NullType,
    // Asia
    CNY: NullType,
    HKD: NullType,
    SGD: NullType,
    KRW: NullType,
    INR: NullType,
    TWD: NullType,
    THB: NullType,
    MYR: NullType,
    IDR: NullType,
    PHP: NullType,
    VND: NullType,
    // Europe
    SEK: NullType,
    NOK: NullType,
    DKK: NullType,
    PLN: NullType,
    CZK: NullType,
    HUF: NullType,
    RUB: NullType,
    UAH: NullType,
    RON: NullType,
    // Americas
    MXN: NullType,
    BRL: NullType,
    ARS: NullType,
    CLP: NullType,
    COP: NullType,
    PEN: NullType,
    // Middle East/Africa
    AED: NullType,
    SAR: NullType,
    ILS: NullType,
    ZAR: NullType,
    TRY: NullType,
    EGP: NullType,
    NGN: NullType,
    KES: NullType,
});
export type CurrencyCodeType = typeof CurrencyCodeType;
export type CurrencyCodeLiteral =
    | "USD" | "EUR" | "GBP" | "JPY" | "CHF" | "CAD" | "AUD" | "NZD"
    | "CNY" | "HKD" | "SGD" | "KRW" | "INR" | "TWD" | "THB" | "MYR" | "IDR" | "PHP" | "VND"
    | "SEK" | "NOK" | "DKK" | "PLN" | "CZK" | "HUF" | "RUB" | "UAH" | "RON"
    | "MXN" | "BRL" | "ARS" | "CLP" | "COP" | "PEN"
    | "AED" | "SAR" | "ILS" | "ZAR" | "TRY" | "EGP" | "NGN" | "KES";

/**
 * Unit types supported by Intl.NumberFormat.
 *
 * @remarks
 * Standard units from the CLDR specification.
 *
 * Digital/Data:
 * @property bit - Bits
 * @property byte - Bytes
 * @property kilobit - Kilobits
 * @property kilobyte - Kilobytes
 * @property megabit - Megabits
 * @property megabyte - Megabytes
 * @property gigabit - Gigabits
 * @property gigabyte - Gigabytes
 * @property terabit - Terabits
 * @property terabyte - Terabytes
 * @property petabyte - Petabytes
 *
 * Duration:
 * @property nanosecond - Nanoseconds
 * @property microsecond - Microseconds
 * @property millisecond - Milliseconds
 * @property second - Seconds
 * @property minute - Minutes
 * @property hour - Hours
 * @property day - Days
 * @property week - Weeks
 * @property month - Months
 * @property year - Years
 *
 * Length:
 * @property millimeter - Millimeters
 * @property centimeter - Centimeters
 * @property meter - Meters
 * @property kilometer - Kilometers
 * @property inch - Inches
 * @property foot - Feet
 * @property yard - Yards
 * @property mile - Miles
 *
 * Mass:
 * @property gram - Grams
 * @property kilogram - Kilograms
 * @property milligram - Milligrams
 * @property ounce - Ounces
 * @property pound - Pounds
 * @property stone - Stones
 *
 * Temperature:
 * @property celsius - Celsius
 * @property fahrenheit - Fahrenheit
 *
 * Volume:
 * @property milliliter - Milliliters
 * @property liter - Liters
 * @property gallon - Gallons
 * @property fluidOunce - Fluid ounces
 *
 * Area:
 * @property acre - Acres
 * @property hectare - Hectares
 *
 * Speed:
 * @property meterPerSecond - Meters per second
 * @property kilometerPerHour - Kilometers per hour
 * @property milePerHour - Miles per hour
 *
 * Other:
 * @property percent - Percentage
 * @property degree - Degrees (angle)
 */
export const UnitType = VariantType({
    // Digital
    bit: NullType,
    byte: NullType,
    kilobit: NullType,
    kilobyte: NullType,
    megabit: NullType,
    megabyte: NullType,
    gigabit: NullType,
    gigabyte: NullType,
    terabit: NullType,
    terabyte: NullType,
    petabyte: NullType,
    // Duration
    nanosecond: NullType,
    microsecond: NullType,
    millisecond: NullType,
    second: NullType,
    minute: NullType,
    hour: NullType,
    day: NullType,
    week: NullType,
    month: NullType,
    year: NullType,
    // Length
    millimeter: NullType,
    centimeter: NullType,
    meter: NullType,
    kilometer: NullType,
    inch: NullType,
    foot: NullType,
    yard: NullType,
    mile: NullType,
    // Mass
    gram: NullType,
    kilogram: NullType,
    milligram: NullType,
    ounce: NullType,
    pound: NullType,
    stone: NullType,
    // Temperature
    celsius: NullType,
    fahrenheit: NullType,
    // Volume
    milliliter: NullType,
    liter: NullType,
    gallon: NullType,
    fluidOunce: NullType,
    // Area
    acre: NullType,
    hectare: NullType,
    // Speed
    meterPerSecond: NullType,
    kilometerPerHour: NullType,
    milePerHour: NullType,
    // Other
    percent: NullType,
    degree: NullType,
});
export type UnitType = typeof UnitType;
export type UnitLiteral =
    | "bit" | "byte" | "kilobit" | "kilobyte" | "megabit" | "megabyte" | "gigabit" | "gigabyte" | "terabit" | "terabyte" | "petabyte"
    | "nanosecond" | "microsecond" | "millisecond" | "second" | "minute" | "hour" | "day" | "week" | "month" | "year"
    | "millimeter" | "centimeter" | "meter" | "kilometer" | "inch" | "foot" | "yard" | "mile"
    | "gram" | "kilogram" | "milligram" | "ounce" | "pound" | "stone"
    | "celsius" | "fahrenheit"
    | "milliliter" | "liter" | "gallon" | "fluidOunce"
    | "acre" | "hectare"
    | "meterPerSecond" | "kilometerPerHour" | "milePerHour"
    | "percent" | "degree";

// ============================================================================
// Tick Format Type
// ============================================================================

/**
 * Number format configuration.
 *
 * @property minimumFractionDigits - Minimum decimal places
 * @property maximumFractionDigits - Maximum decimal places
 * @property signDisplay - How to display sign
 */
export const NumberFormatType = StructType({
    minimumFractionDigits: OptionType(IntegerType),
    maximumFractionDigits: OptionType(IntegerType),
    signDisplay: OptionType(SignDisplayType),
});
export type NumberFormatType = typeof NumberFormatType;

/**
 * Currency format configuration.
 *
 * @property currency - ISO 4217 currency code
 * @property display - How to display the currency
 * @property compact - Use compact notation (e.g., $1K instead of $1,000)
 * @property minimumFractionDigits - Minimum decimal places
 * @property maximumFractionDigits - Maximum decimal places
 */
export const CurrencyFormatType = StructType({
    currency: CurrencyCodeType,
    display: OptionType(CurrencyDisplayType),
    compact: OptionType(CompactDisplayType),
    minimumFractionDigits: OptionType(IntegerType),
    maximumFractionDigits: OptionType(IntegerType),
});
export type CurrencyFormatType = typeof CurrencyFormatType;

/**
 * Percent format configuration.
 *
 * @property minimumFractionDigits - Minimum decimal places
 * @property maximumFractionDigits - Maximum decimal places
 * @property signDisplay - How to display sign
 */
export const PercentFormatType = StructType({
    minimumFractionDigits: OptionType(IntegerType),
    maximumFractionDigits: OptionType(IntegerType),
    signDisplay: OptionType(SignDisplayType),
});
export type PercentFormatType = typeof PercentFormatType;

/**
 * Compact notation format configuration.
 *
 * @property display - Short (1K) or long (1 thousand)
 */
export const CompactFormatType = StructType({
    display: OptionType(CompactDisplayType),
});
export type CompactFormatType = typeof CompactFormatType;

/**
 * Unit format configuration.
 *
 * @property unit - The unit to format
 * @property display - How to display the unit
 */
export const UnitFormatType = StructType({
    unit: UnitType,
    display: OptionType(UnitDisplayType),
});
export type UnitFormatType = typeof UnitFormatType;

/**
 * Date format configuration using East format strings.
 *
 * @property format - East datetime format string (e.g., "YYYY-MM-DD", "MMM D, YYYY")
 *
 * @remarks
 * Format codes:
 * - YYYY: 4-digit year
 * - YY: 2-digit year
 * - MMMM: Full month name (January)
 * - MMM: Short month name (Jan)
 * - MM: 2-digit month (01-12)
 * - M: Month (1-12)
 * - DD: 2-digit day (01-31)
 * - D: Day (1-31)
 * - dddd: Full weekday (Sunday)
 * - ddd: Short weekday (Sun)
 * - dd: Min weekday (Su)
 */
export const DateFormatType = StructType({
    format: StringType,
});
export type DateFormatType = typeof DateFormatType;

/**
 * Time format configuration using East format strings.
 *
 * @property format - East datetime format string (e.g., "HH:mm:ss", "h:mm A")
 *
 * @remarks
 * Format codes:
 * - HH: 24-hour with zero-pad (00-23)
 * - H: 24-hour (0-23)
 * - hh: 12-hour with zero-pad (01-12)
 * - h: 12-hour (1-12)
 * - mm: Minutes with zero-pad (00-59)
 * - m: Minutes (0-59)
 * - ss: Seconds with zero-pad (00-59)
 * - s: Seconds (0-59)
 * - SSS: Milliseconds (000-999)
 * - A: AM/PM uppercase
 * - a: am/pm lowercase
 */
export const TimeFormatType = StructType({
    format: StringType,
});
export type TimeFormatType = typeof TimeFormatType;

/**
 * DateTime format configuration using East format strings.
 *
 * @property format - East datetime format string (e.g., "YYYY-MM-DD HH:mm:ss")
 *
 * @remarks
 * Combines date and time format codes. See DateFormatType and TimeFormatType for available codes.
 */
export const DateTimeFormatType = StructType({
    format: StringType,
});
export type DateTimeFormatType = typeof DateTimeFormatType;

/**
 * Tick format for axis values.
 *
 * @remarks
 * Comprehensive formatting options based on Intl.NumberFormat and Intl.DateTimeFormat.
 * Each variant contains configuration specific to that format type.
 *
 * Number formats:
 * @property number - Plain number with optional decimal/sign configuration
 * @property currency - Currency format with code and display options
 * @property percent - Percentage with decimal configuration
 * @property compact - Compact notation (1K, 1M) with short/long display
 * @property unit - Unit formatting (bytes, meters, etc.)
 * @property scientific - Scientific notation (1.23e+4)
 * @property engineering - Engineering notation (12.3e+3)
 *
 * Date/Time formats:
 * @property date - Date formatting with style
 * @property time - Time formatting with style and 12/24 hour
 * @property datetime - Combined date and time
 */
export const TickFormatType = VariantType({
    // Number formats
    number: NumberFormatType,
    currency: CurrencyFormatType,
    percent: PercentFormatType,
    compact: CompactFormatType,
    unit: UnitFormatType,
    scientific: NullType,
    engineering: NullType,
    // Date/Time formats
    date: DateFormatType,
    time: TimeFormatType,
    datetime: DateTimeFormatType,
});

/**
 * Type representing tick format.
 */
export type TickFormatType = typeof TickFormatType;
