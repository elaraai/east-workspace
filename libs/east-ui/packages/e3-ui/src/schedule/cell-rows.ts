/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The rows a builder's reader read of an event kind's series index's cells, as the kind's read seams take them
 * (#1771): never packed for the kind to unpack again, but the rows the page unpacked as e3's answers landed, named by
 * a handle the reader gives the seams.
 *
 * A builder's payload holds every kind behind one type whatever its record holds (`ScheduleKindType`), so the seams
 * over the cells take the handle, and read the rows behind it through one generic platform function at the kind's own
 * cells type — an Array of `{ key, row }` at its record's key and row types (`cellsType`). The renderer answers it with
 * the rows its reader holds under the handle, as they are.
 *
 * @packageDocumentation
 */

import { East, StringType } from "@elaraai/east";

/**
 * `schedule_cell_rows([T], handle) -> T`: the rows a builder's reader holds under a handle, at a kind's cells type `T`
 * (#1771). Implemented by the renderer, which refuses a handle it holds no rows under; a payload compiled with no
 * implementation is refused only where a kind's seam reads the cells.
 *
 * @internal
 */
export const scheduleCellRows = East.genericPlatform("schedule_cell_rows", ["T"], [StringType], "T", { optional: true });
