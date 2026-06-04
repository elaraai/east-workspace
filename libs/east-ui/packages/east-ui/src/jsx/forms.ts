/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Form JSX tags — value leaves whose primary datum is a typed prop (not
 * children): `<Checkbox checked={…}>`, `<Switch checked={…}>`, `<Slider
 * value={…}>`. The remaining options (onChange, min/max, colorPalette, …) sit
 * flat, derived from each factory's option type.
 */

import {
    Checkbox as CheckboxFactory,
    Switch as SwitchFactory,
    Slider as SliderFactory,
} from "../forms/index.js";
import { leaf, type ValueProps, type JsxTag } from "./combinators.js";

/** `<Checkbox checked={…}>` — boolean toggle. Maps to `Checkbox.Root`. */
export const Checkbox: JsxTag<ValueProps<typeof CheckboxFactory.Root, "checked">> =
    leaf(CheckboxFactory.Root, "checked");

/** `<Switch checked={…}>` — on/off switch. Maps to `Switch.Root`. */
export const Switch: JsxTag<ValueProps<typeof SwitchFactory.Root, "checked">> =
    leaf(SwitchFactory.Root, "checked");

/** `<Slider value={…}>` — numeric slider. Maps to `Slider.Root`. */
export const Slider: JsxTag<ValueProps<typeof SliderFactory.Root, "value">> =
    leaf(SliderFactory.Root, "value");
