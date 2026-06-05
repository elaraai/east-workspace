/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Slider>` tag — see the export's JSDoc.
 */

import { Slider as SliderFactory } from "../../forms/slider/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/**
 * Numeric range slider — drag a thumb to pick a value between `min` and `max`.
 * Reach for it when an approximate magnitude reads better as a track than a typed
 * number (volume, opacity, a threshold). Supports `step` quantisation and a
 * disabled state. The number is the `value` prop. `onChange` fires continuously
 * while dragging; `onChangeEnd` fires once on release.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Slider, UIComponentType } from "@elaraai/east-ui";
 *
 * const level = East.function([], UIComponentType, _$ => (
 *     <Slider value={50.0} min={0} max={100} step={25} />
 * ));
 * ```
 *
 * @remarks
 * Carries `Slider.Types`. Bind `value` to state and wire `onChange` (or
 * `onChangeEnd` to commit only on release) inside a `<Reactive>` block. Desugars
 * to `Slider.Root(value, style)`.
 */
export const Slider: JsxTag<ValueProps<typeof SliderFactory.Root, "value">> & { Types: typeof SliderFactory.Types } =
    Object.assign(leaf(SliderFactory.Root, "value"), { Types: SliderFactory.Types });
