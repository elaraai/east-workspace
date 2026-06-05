/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** e3 `<Diff>` tag — change-review panel. Maps to `Diff.Root`. */

import { optionsTag, type OptionsProps, type JsxTag } from "@elaraai/east-ui";
import { Diff as DiffFactory } from "../diff.js";

/** `<Diff bindings={[view.binding]} hideUnchanged={some(true)} />` — change-review panel. Maps to `Diff.Root`. */
export const Diff: JsxTag<OptionsProps<typeof DiffFactory.Root>> & { Types: typeof DiffFactory.Types } =
    Object.assign(optionsTag(DiffFactory.Root), { Types: DiffFactory.Types });
