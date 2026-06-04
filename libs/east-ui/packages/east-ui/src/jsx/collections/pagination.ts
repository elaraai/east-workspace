/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Collection `<Pagination>` tag — page-navigation control. Maps to `Pagination.Root`. */

import { Pagination as PaginationFactory, type PaginationOptions } from "../../collections/pagination/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/** `<Pagination page={page} pageSize={20n} count={500n} onPageChange={…} size="md" />` — page-navigation control. Maps to `Pagination.Root`. */
export const Pagination: JsxTag<PaginationOptions> = optionsTag(PaginationFactory.Root);
