/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Typography `<Text>` tag — body text. Maps to `Text.Root`.
 *
 * The `Presets` style presets are attached to the tag, so a single `Text`
 * import gives both `<Text …>{body}</Text>` and `Text.Presets.MonoLabel(…)` /
 * `Text.Presets.Eyebrow(…)` — no separate factory import.
 */

import { Text as TextFactory } from "../../typography/text/index.js";
import { content, type ContentProps, type JsxTag } from "../combinators.js";

/** Style presets surfaced on the `<Text>` tag (mirrors the `Text` factory namespace). */
type TextBuilders = {
    Presets: typeof TextFactory.Presets;
};

/** `<Text>` — body text. `Text.Presets.*` builds the recurring typographic presets (eyebrow, mono-label, …). Maps to `Text.Root`. */
export const Text: JsxTag<ContentProps<typeof TextFactory.Root>> & TextBuilders =
    Object.assign(content(TextFactory.Root), {
        Presets: TextFactory.Presets,
    });
