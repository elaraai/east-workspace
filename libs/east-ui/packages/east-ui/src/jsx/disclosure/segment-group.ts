/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Disclosure `<SegmentGroup>` tag — toolbar toggle. Maps to
 * `SegmentGroup.Root`.
 *
 * The `Item` segment builder is attached to the tag, so a single
 * `SegmentGroup` import gives both `<SegmentGroup …/>` and
 * `SegmentGroup.Item(…)` — no separate factory import.
 */

import { SegmentGroup as SegmentGroupFactory, type SegmentGroupOptions } from "../../disclosure/segment-group/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/** Segment builder surfaced on the `<SegmentGroup>` tag (mirrors the `SegmentGroup` factory namespace). */
type SegmentGroupBuilders = {
    Item: typeof SegmentGroupFactory.Item;
};

/** `<SegmentGroup value={…} items={[SegmentGroup.Item(…)]} onChange={…} />` — segmented toolbar toggle. Maps to `SegmentGroup.Root`. */
export const SegmentGroup: JsxTag<SegmentGroupOptions> & SegmentGroupBuilders =
    Object.assign(optionsTag(SegmentGroupFactory.Root), {
        Item: SegmentGroupFactory.Item,
    });
