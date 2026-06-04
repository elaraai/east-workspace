/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Feedback `<EmptyState>` tag — zero-state placeholder. Maps to `EmptyState.Root`. */

import { EmptyState as EmptyStateFactory, type EmptyStateOptions } from "../../feedback/empty-state/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/** `<EmptyState title="No results" icon={{ prefix: "fas", name: "magnifying-glass" }} />` — zero-state placeholder. Maps to `EmptyState.Root`. */
export const EmptyState: JsxTag<EmptyStateOptions> = optionsTag(EmptyStateFactory.Root);
