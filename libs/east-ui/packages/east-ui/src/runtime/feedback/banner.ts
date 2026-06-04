/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Feedback `<Banner>` tag — full-width page-level surface. Maps to `Banner.Root`. */

import { Banner as BannerFactory, type BannerOptions } from "../../feedback/banner/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/** `<Banner status="warning" title="Data is stale" description="…" />` — page-level feedback surface. Maps to `Banner.Root`. */
export const Banner: JsxTag<BannerOptions> = optionsTag(BannerFactory.Root);
