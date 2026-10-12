/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Record affordances carry their own schema; the local Slice wire stays frozen. */
import { EastUI } from "../../extension.js";
import { RecordSliceChromeType } from "../../platform/slice/record-chrome.js";

/** Internal carrier for the record arm of Slice.Rail. */
export const RecordSliceRailComponent = EastUI.component("RecordSliceRail", RecordSliceChromeType);
