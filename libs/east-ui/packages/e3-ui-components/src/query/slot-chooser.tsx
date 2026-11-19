/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The open slot's offers in the shared picker (#1673): the `Chooser`, its
 * options the editor's offers (`slotOptions`) as the editor gives them for
 * the text typed — the value typed offered first — its label the slot's
 * (`FIELD`), its empty words the slot's, Tab choosing as Enter does, ⌘ or
 * Ctrl Enter left to its host, and Esc closing it, the host's frame staying.
 * A choice or an Esc gives the focus back to the slot, where the next slot
 * the pick opens takes it on.
 *
 * Laid in the flow under the rows it is bare (`surface="bare"`): its host
 * frames it.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useMemo } from "react";
import { Chooser } from "@elaraai/east-ui-components/internal";
import { slotOptions } from "./slot-options.js";
import type { SlotPopover } from "./use-query-editor.js";

/** Props of {@link SlotChooser}. */
export interface SlotChooserProps {
    /** The open slot's offers, and what it is told. */
    readonly popover: SlotPopover;
    /** Where it sits: bare in a body its host frames, or in a popover of its own. */
    readonly surface: "bare" | "popover";
}

/**
 * The open slot's offers in the shared picker — see the module docs.
 *
 * @param props - The open slot's offers, and where it sits ({@link SlotChooserProps})
 * @returns The picker
 */
export const SlotChooser = memo(function SlotChooser({ popover, surface }: SlotChooserProps) {
    const { items, initialActive, onPick, onClose, slot } = popover;
    const { sections, offerOf, initialKey } = useMemo(() => slotOptions(items, initialActive), [items, initialActive]);
    const anchor = slot.anchor;
    const choose = useCallback((key: string) => {
        const offer = offerOf.get(key);
        if (offer === undefined) return;
        // The focus back on the slot: the next slot the pick opens takes it on, and with none it stays in the rows.
        anchor.focus({ preventScroll: true });
        onPick(offer);
    }, [offerOf, anchor, onPick]);
    const close = useCallback(() => {
        anchor.focus({ preventScroll: true });
        onClose();
    }, [anchor, onClose]);
    return (
        <Chooser sections={sections} placeholder={popover.placeholder} label={popover.label} empty={popover.empty} hint={popover.hint}
            query={popover.text} onQuery={popover.onText} initialKey={initialKey} tabChooses
            onChoose={choose} onClose={close} surface={surface} autoFocus />
    );
});
