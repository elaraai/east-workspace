/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Form `<Slider value={…}>` tag — numeric slider. Maps to `Slider.Root`. */

import { Slider as SliderFactory } from "../../forms/slider/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/** `<Slider value={…}>` — numeric slider. Maps to `Slider.Root`. */
export const Slider: JsxTag<ValueProps<typeof SliderFactory.Root, "value">> & { Types: typeof SliderFactory.Types } =
    Object.assign(leaf(SliderFactory.Root, "value"), { Types: SliderFactory.Types });
