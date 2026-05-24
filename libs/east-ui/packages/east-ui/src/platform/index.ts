/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Platform functions for East UI.
 *
 * - `State.bind` — browser-local key-value store with reactive tracking
 * - `Slice.bind` — shared narrowing state for the `Slice.*` UI family
 * - `Clipboard.copy` — write text to the system clipboard
 * - `Download.blob` / `Download.csv` — trigger browser file downloads
 * - `Share.link` — invoke the OS share sheet, falling back to clipboard
 * - For e3 dataset bindings, use `Data.bind` from `@elaraai/e3-ui`
 *
 * @packageDocumentation
 */

export { State } from "./state.js";
export { Slice } from "./slice/index.js";
export { SliceApplyImpl, sliceDimensions, sliceFields, sliceMatches, sliceBreakdown, sliceSeries, SLICE_SERIES_PALETTE } from "./slice/impl.js";
export { Clipboard } from "./clipboard/index.js";
export { Download } from "./download/index.js";
export { Share } from "./share/index.js";
