/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Navigation `<Breadcrumb>` tag — trail of links. Maps to `Breadcrumb.Root`. */

import { Breadcrumb as BreadcrumbFactory } from "../../navigation/breadcrumb/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/** `<Breadcrumb items={[Breadcrumb.Item(…)]} />` — navigation trail. Maps to `Breadcrumb.Root`. */
export const Breadcrumb: JsxTag<ValueProps<typeof BreadcrumbFactory.Root, "items">> & { Types: typeof BreadcrumbFactory.Types } =
    Object.assign(leaf(BreadcrumbFactory.Root, "items"), { Types: BreadcrumbFactory.Types });
