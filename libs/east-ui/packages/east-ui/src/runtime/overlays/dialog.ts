/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Overlay `<Dialog>` tag — modal window. Body is the children. Maps to `Dialog.Root`. */

import { Dialog as DialogFactory } from "../../overlays/dialog/index.js";
import { container, type ContainerProps, type JsxTag } from "../combinators.js";

/** Imperative `open` + types carried alongside the `<Dialog>` tag. */
type DialogBuilders = {
    open: typeof DialogFactory.open;
    Types: typeof DialogFactory.Types;
};

/**
 * `<Dialog trigger={Button.Root("Open")} title="My Dialog">…body…</Dialog>` —
 * modal window (body is children). Maps to `Dialog.Root`. The imperative
 * `Dialog.open(...)` (no-trigger programmatic open) and `Dialog.Types` are
 * carried through.
 */
export const Dialog: JsxTag<ContainerProps<typeof DialogFactory.Root>> & DialogBuilders =
    Object.assign(container(DialogFactory.Root), {
        open: DialogFactory.open,
        Types: DialogFactory.Types,
    });
