/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Layout `<Splitter>` tag — resizable panel layout. Maps to `Splitter.Root`.
 *
 * The `Panel` builder and `Types` are attached to the tag, so a single
 * `Splitter` import gives both `<Splitter …/>` and `Splitter.Panel(…)` /
 * `Splitter.Types.*` — no separate factory import.
 */

import { Splitter as SplitterFactory, type SplitterOptions } from "../../layout/splitter/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/** Panel builder + types surfaced on the `<Splitter>` tag (mirrors the `Splitter` factory namespace). */
type SplitterBuilders = {
    Panel: typeof SplitterFactory.Panel;
    Types: typeof SplitterFactory.Types;
};

/** `<Splitter panels={[Splitter.Panel(…)]} defaultSize={[50.0, 50.0]} orientation="horizontal" />` — resizable panels. Maps to `Splitter.Root`. */
export const Splitter: JsxTag<SplitterOptions> & SplitterBuilders =
    Object.assign(optionsTag(SplitterFactory.Root), {
        Panel: SplitterFactory.Panel,
        Types: SplitterFactory.Types,
    });
