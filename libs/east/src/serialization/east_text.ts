/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * East text's two quoted forms, spelled alike by everything that prints them:
 * a string in double quotes, and an identifier in backticks. Each escapes its
 * quote and the backslash — the only escapes the grammar reads — and writes
 * every other character as itself, as east-c prints them.
 */

/**
 * Spells a string as East text: in double quotes, with `\` and `"` escaped.
 *
 * @param x - The string
 * @returns Its East text
 */
export function printEastString(x: string): string {
  return `"${x.replace(/[\\"]/g, "\\$&")}"`;
}

/**
 * Quotes an identifier in backticks, with `\` and `` ` `` escaped.
 *
 * @param x - The identifier
 * @returns It quoted
 */
export function quoteEastIdentifier(x: string): string {
  return `\`${x.replace(/[\\`]/g, "\\$&")}\``;
}
