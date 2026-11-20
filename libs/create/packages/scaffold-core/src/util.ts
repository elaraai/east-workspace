/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0-or-later. See LICENSE for details.
 */

/**
 * Whether a value is a plain object: a JSON object or a TOML table, read.
 *
 * @param value - The value
 * @returns Whether it is an object that is neither null nor an array
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
