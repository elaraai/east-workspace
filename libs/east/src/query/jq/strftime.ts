/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * jq's `strftime` / `strptime` formats as East's datetime format tokens, and
 * back: the checker rewrites a format into its tokens, and the printer writes
 * a checked program's tokens as the format again.
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

/** The one-token codes, by the token each writes. */
const CODE_OF: ReadonlyMap<string, string> = new Map(
  Object.entries(FORMAT_CODES).filter(([, tokens]) => tokens.length === 1).map(([code, tokens]) => [tokens[0]!.type, code]),
);

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

/**
 * The strftime format that gives some tokens: {@link formatTokens} read back.
 *
 * @param tokens - tokens a format gave
 * @returns the format, with `%%` for each percent sign in literal text
 * @throws {Error} When a token is not one a format gives.
 *
 * @internal
 */
export function formatText(tokens: readonly DateTimeFormatToken[]): string {
  return tokens.map(token => {
    if (token.type === "literal") return (token.value as string).replaceAll("%", "%%");
    const code = CODE_OF.get(token.type);
    if (code === undefined) throw new Error(`printJq: the datetime token ${token.type} has no strftime code`);
    return `%${code}`;
  }).join("");
}
