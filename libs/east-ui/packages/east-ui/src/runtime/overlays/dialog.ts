/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** `<Dialog>` tag — see the export's JSDoc. */

import { Dialog as DialogFactory } from "../../overlays/dialog/index.js";
import { container, type ContainerProps, type JsxTag } from "../combinators.js";

/** Imperative `open` + types carried alongside the `<Dialog>` tag. */
type DialogBuilders = {
    open: typeof DialogFactory.open;
    Types: typeof DialogFactory.Types;
};

/**
 * Dialog — a modal window that overlays the page and captures focus until it is
 * dismissed. Use it for a focused task or a confirmation that must interrupt the
 * flow (a settings form, "are you sure?"); for a non-blocking inline panel reach
 * for {@link Popover}, and for an edge-anchored panel use {@link Drawer}. The
 * body is the children; an optional eyebrow, title, and description form the
 * header, and `size` controls its width. Placement of those, plus an
 * `onOpenChange` callback, are flat props ({@link DialogOptions}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Button, Dialog, HStack, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const confirm = East.function([], UIComponentType, _$ => (
 *     <Dialog trigger={<Button>Open Dialog</Button>} title="Confirm Action" description="Are you sure you want to proceed?">
 *         <Text>This is a dialog. It appears as a modal overlay and captures focus.</Text>
 *         <HStack gap="2" justify="flex-end">
 *             <Button variant="outline">Cancel</Button>
 *             <Button variant="solid">Confirm</Button>
 *         </HStack>
 *     </Dialog>
 * ));
 * ```
 *
 * @remarks
 * Carries `Dialog.Types` and the imperative `Dialog.open(input)` — a
 * trigger-less programmatic open, called from an `onClick` to raise a dialog
 * built from a `Dialog.Types.OpenInput` value. Desugars to
 * `Dialog.Root(body, options)`.
 */
export const Dialog: JsxTag<ContainerProps<typeof DialogFactory.Root>> & DialogBuilders =
    Object.assign(container(DialogFactory.Root), {
        open: DialogFactory.open,
        Types: DialogFactory.Types,
    });
