/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * jq's `strftime` / `strptime` formats as East's datetime format tokens: the
 * checker reads a format by them, reporting a code East has no token for, and
 * the translator gives the tokens they make (`devdocs/QUERY.md` §10).
 *
 * @packageDocumentation
 */

import { variant } from "../../containers/variant.js";
import type { DateTimeFormatToken } from "../../datetime_format/types.js";

/** jq's `%` codes, each as the East tokens it writes. */
const FORMAT_CODES: Readonly<Record<string, readonly DateTimeFormatToken[]>> = {
  Y: [variant("year4", null)],
  m: [variant("month2", null)],
  d: [variant("day2", null)],
  H: [variant("hour24_2", null)],
  M: [variant("minute2", null)],
  S: [variant("second2", null)],
  b: [variant("monthNameShort", null)],
  B: [variant("monthNameFull", null)],
  a: [variant("weekdayNameShort", null)],
  A: [variant("weekdayNameFull", null)],
  F: [variant("year4", null), variant("literal", "-"), variant("month2", null), variant("literal", "-"), variant("day2", null)],
  T: [variant("hour24_2", null), variant("literal", ":"), variant("minute2", null), variant("literal", ":"), variant("second2", null)],
};

/**
 * A strftime format as East datetime format tokens.
 *
 * @param format - jq's format text: `%Y %m %d %H %M %S %b %B %a %A %F %T`,
 *   `%%` for a percent sign, and any other text as it is
 * @returns the tokens, or the first code East has no token for
 *
 * @internal
 */
export function formatTokens(format: string): { tokens: DateTimeFormatToken[] } | { code: string } {
  const tokens: DateTimeFormatToken[] = [];
  let text = "";
  for (let i = 0; i < format.length; i++) {
    const c = format[i]!;
    if (c !== "%") {
      text += c;
      continue;
    }
    const code = format[i + 1];
    i += 1;
    if (code === "%") {
      text += "%";
      continue;
    }
    const mapped = code === undefined ? undefined : FORMAT_CODES[code];
    if (mapped === undefined) return { code: code ?? "" };
    if (text !== "") {
      tokens.push(variant("literal", text));
      text = "";
    }
    tokens.push(...mapped);
  }
  if (text !== "") tokens.push(variant("literal", text));
  return { tokens };
}
