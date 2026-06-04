/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Layout `<Splitter>` tag — resizable panel layout. Maps to `Splitter.Root`. */

import { Splitter as SplitterFactory, type SplitterOptions } from "../../layout/splitter/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/** `<Splitter panels={[Splitter.Panel(…)]} defaultSize={[50.0, 50.0]} orientation="horizontal" />` — resizable panels. Maps to `Splitter.Root`. */
export const Splitter: JsxTag<SplitterOptions> = optionsTag(SplitterFactory.Root);
