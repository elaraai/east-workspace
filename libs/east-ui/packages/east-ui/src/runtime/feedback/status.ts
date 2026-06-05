/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Feedback `<Status>` tag — semantic classification chip. Maps to `Status.Root`. */

import { Status as StatusFactory, type StatusOptions } from "../../feedback/status/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/** `<Status label="Up to date" value="success" />` — classification chip with paired icon. Maps to `Status.Root`. */
export const Status: JsxTag<StatusOptions> & { Types: typeof StatusFactory.Types } =
    Object.assign(optionsTag(StatusFactory.Root), { Types: StatusFactory.Types });
