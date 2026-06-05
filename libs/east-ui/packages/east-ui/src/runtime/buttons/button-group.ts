/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Button `<ButtonGroup>` tag — grouped buttons. Maps to `ButtonGroup.Root`. */

import { ButtonGroup as ButtonGroupFactory, type ButtonGroupOptions } from "../../buttons/button-group/index.js";
import { container, type JsxTag } from "../combinators.js";
import type { ContainerChildrenType } from "../children.js";

/** `<ButtonGroup attached gap="2">…buttons…</ButtonGroup>` — grouped buttons. Maps to `ButtonGroup.Root`. */
export const ButtonGroup: JsxTag<ButtonGroupOptions & { children?: ContainerChildrenType }> & { Types: typeof ButtonGroupFactory.Types } =
    Object.assign(container(ButtonGroupFactory.Root), { Types: ButtonGroupFactory.Types });
