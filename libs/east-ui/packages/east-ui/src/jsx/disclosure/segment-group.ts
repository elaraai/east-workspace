/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Disclosure `<SegmentGroup>` tag — toolbar toggle. Maps to `SegmentGroup.Root`. */

import { SegmentGroup as SegmentGroupFactory, type SegmentGroupOptions } from "../../disclosure/segment-group/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/** `<SegmentGroup value={…} items={[SegmentGroup.Item(…)]} onChange={…} />` — segmented toolbar toggle. Maps to `SegmentGroup.Root`. */
export const SegmentGroup: JsxTag<SegmentGroupOptions> = optionsTag(SegmentGroupFactory.Root);
