/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Plan row's id, as the package's tests and specs name one (test use): by
 * the series that made it and the path of keys to it — the renderer's own
 * maker of an entry row's id (`landingRowId`), named once for every test that
 * names a row.
 *
 * @packageDocumentation
 */
import { landingRowId } from "./root/landings.js";
import type { PlanRowId } from "./row-key.js";

/**
 * A row's id, by its series and path.
 *
 * @param series - Its series: `<kind>.<draw>` for a resource's row, `""` for a hand-built row
 * @param path - Its path: the keys to it, its group's first
 * @returns The id
 */
export const entry = (series: string, ...path: string[]): PlanRowId => landingRowId(series, path);
