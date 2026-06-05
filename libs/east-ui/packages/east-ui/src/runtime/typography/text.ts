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

/**
 * Style presets and type namespace surfaced on the `<Text>` tag (mirrors the
 * `Text` factory namespace). Each preset is also exposed as a nested content
 * tag so authors can write `<Text.Eyebrow>…</Text.Eyebrow>` directly.
 */
type TextBuilders = {
    Types: typeof TextFactory.Types;
    Presets: typeof TextFactory.Presets;
    Eyebrow: JsxTag<ContentProps<typeof TextFactory.Presets.Eyebrow>>;
    EyebrowSm: JsxTag<ContentProps<typeof TextFactory.Presets.EyebrowSm>>;
    MonoSm: JsxTag<ContentProps<typeof TextFactory.Presets.MonoSm>>;
    MonoLabel: JsxTag<ContentProps<typeof TextFactory.Presets.MonoLabel>>;
    MetaSm: JsxTag<ContentProps<typeof TextFactory.Presets.MetaSm>>;
    Lead: JsxTag<ContentProps<typeof TextFactory.Presets.Lead>>;
    MonoKpi: JsxTag<ContentProps<typeof TextFactory.Presets.MonoKpi>>;
};

/** `<Text>` — body text. `Text.Presets.*` builds the recurring typographic presets (eyebrow, mono-label, …), each also surfaced as a nested `<Text.Eyebrow>` content tag. Maps to `Text.Root`. */
export const Text: JsxTag<ContentProps<typeof TextFactory.Root>> & TextBuilders =
    Object.assign(content(TextFactory.Root), {
        Types: TextFactory.Types,
        Presets: TextFactory.Presets,
        Eyebrow: content(TextFactory.Presets.Eyebrow),
        EyebrowSm: content(TextFactory.Presets.EyebrowSm),
        MonoSm: content(TextFactory.Presets.MonoSm),
        MonoLabel: content(TextFactory.Presets.MonoLabel),
        MetaSm: content(TextFactory.Presets.MetaSm),
        Lead: content(TextFactory.Presets.Lead),
        MonoKpi: content(TextFactory.Presets.MonoKpi),
    });
