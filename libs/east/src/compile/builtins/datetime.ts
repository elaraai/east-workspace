/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type { BuiltinEvaluators } from "../runtime.js";
import { parseDateTimeFormatted } from "../../datetime_format/parse.js";
import { formatDateTime } from "../../datetime_format/print.js";
import type { DateTimeFormatToken } from "../../datetime_format/types.js";
import { EastError } from "../../error.js";
import type { Location, SourceMap } from "../../location.js";

/** The builtins for DateTimes. @internal */
export const datetime_builtins = {
  DateTimeGetYear: (_loc_id: bigint, _source_map: SourceMap | null) => (date: Date) => BigInt(date.getUTCFullYear()),
  DateTimeGetMonth: (_loc_id: bigint, _source_map: SourceMap | null) => (date: Date) => BigInt(date.getUTCMonth() + 1), // JavaScript months are 0-based, East uses 1-based
  DateTimeGetDayOfMonth: (_loc_id: bigint, _source_map: SourceMap | null) => (date: Date) => BigInt(date.getUTCDate()),
  DateTimeGetHour: (_loc_id: bigint, _source_map: SourceMap | null) => (date: Date) => BigInt(date.getUTCHours()),
  DateTimeGetMinute: (_loc_id: bigint, _source_map: SourceMap | null) => (date: Date) => BigInt(date.getUTCMinutes()),
  DateTimeGetSecond: (_loc_id: bigint, _source_map: SourceMap | null) => (date: Date) => BigInt(date.getUTCSeconds()),
  DateTimeGetDayOfWeek: (_loc_id: bigint, _source_map: SourceMap | null) => (date: Date) => {
    const jsDay = date.getUTCDay(); // JavaScript: 0=Sunday, 1=Monday, ..., 6=Saturday
    return BigInt(jsDay === 0 ? 7 : jsDay); // ISO 8601: 1=Monday, 2=Tuesday, ..., 7=Sunday
  },
  DateTimeGetMillisecond: (_loc_id: bigint, _source_map: SourceMap | null) => (date: Date) => BigInt(date.getUTCMilliseconds()),
  DateTimeAddMilliseconds: (_loc_id: bigint, _source_map: SourceMap | null) => (date: Date, milliseconds: bigint) => new Date(date.getTime() + Number(milliseconds)),
  DateTimeDurationMilliseconds: (_loc_id: bigint, _source_map: SourceMap | null) => (date1: Date, date2: Date) => BigInt(date1.getTime() - date2.getTime()),
  DateTimeToEpochMilliseconds: (_loc_id: bigint, _source_map: SourceMap | null) => (date: Date) => BigInt(date.getTime()),
  DateTimeFromEpochMilliseconds: (_loc_id: bigint, _source_map: SourceMap | null) => (milliseconds: bigint) => new Date(Number(milliseconds)),
  DateTimeFromComponents: (_loc_id: bigint, _source_map: SourceMap | null) => (year: bigint, month: bigint, day: bigint, hour: bigint, minute: bigint, second: bigint, millisecond: bigint) => {
    const y = Number(year);
    const date = new Date(Date.UTC(y, Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), Number(millisecond)));
    // `Date.UTC` applies JavaScript's legacy two-digit-year rule, remapping a
    // year of 0-99 to 1900-1999. East years mean what they say (east-c sets
    // `tm_year = year - 1900` and does no remapping), so undo it — on the
    // ROLLED year, since an out-of-range month or day may have carried into
    // it and the normalisation is part of the contract.
    if (y >= 0 && y <= 99) date.setUTCFullYear(date.getUTCFullYear() - 1900);
    return date;
  },
  DateTimePrintFormat: (_loc_id: bigint, _source_map: SourceMap | null) => (date: Date, tokens: DateTimeFormatToken[]) => {
    return formatDateTime(date, tokens);
  },
  DateTimeParseFormat: (loc_id: bigint, source_map: SourceMap | null) => (str: string, tokens: DateTimeFormatToken[]) => {
    const result = parseDateTimeFormatted(str, tokens);
    if (result.success) {
      return result.value;
    } else {
      throw new EastError(`Failed to parse datetime at position ${result.position}: ${result.error}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
  },
} satisfies BuiltinEvaluators;
