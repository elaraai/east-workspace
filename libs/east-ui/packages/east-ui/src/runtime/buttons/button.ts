/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Button JSX tag. Button's options are flat (Principle 6), so the tag is a plain
 * `content` wrapper: the label is the single child (the factory's own
 * `ButtonLabelInput` — string → `Text.Root`, or any `UIComponentType`), and every
 * option is a flat prop. Annotated with the named `ButtonOptions` interface so it
 * surfaces on hover.
 */

import {
    Button as ButtonFactory,
    type ButtonOptions,
    type ButtonLabelInput,
} from "../../buttons/button/index.js";
import { content, type JsxTag } from "../combinators.js";

/** `<Button variant="solid" onClick={f}>Save</Button>` — action button. Maps to `Button.Root`. */
export const Button: JsxTag<ButtonOptions & { children: ButtonLabelInput }> & { Types: typeof ButtonFactory.Types } =
    Object.assign(content(ButtonFactory.Root), { Types: ButtonFactory.Types });
