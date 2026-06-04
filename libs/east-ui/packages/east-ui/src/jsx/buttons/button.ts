/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Button JSX tag. Button's factory nests visual style under `options.style`, so
 * the flat JSX props are split (shape-3): behaviour/state/content keys stay
 * top-level and the rest fold into `style`. The label is the tag's children,
 * typed as the factory's own `ButtonLabelInput` and forwarded verbatim — the
 * factory coerces a string to `Text.Root` and takes any `UIComponentType` as a
 * rich label.
 */

import {
    Button as ButtonFactory,
    type ButtonOptions,
} from "../../buttons/button/index.js";
import { flatten, type FlattenProps, type JsxTag } from "../combinators.js";

// Keys that stay top-level on `options`; everything else folds into `style`.
// Typed against ButtonOptions so a renamed/removed option key fails the build.
const BUTTON_TOP_LEVEL: ReadonlySet<keyof Omit<ButtonOptions, "style">> = new Set([
    "startIcon",
    "endIcon",
    "loadingText",
    "loadingIcon",
    "loading",
    "disabled",
    "onClick",
] as const);

/** `<Button>` — action button with flat style props. Maps to `Button.Root`. */
export const Button: JsxTag<FlattenProps<typeof ButtonFactory.Root>> =
    flatten(ButtonFactory.Root, BUTTON_TOP_LEVEL);
