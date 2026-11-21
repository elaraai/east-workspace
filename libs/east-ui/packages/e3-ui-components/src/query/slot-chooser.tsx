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
 * Laid in the flow under the rows, or in a phone's view, it is bare
 * (`surface="bare"`): its host frames it — a view that titles it with the
 * slot's label, the slot's value now checked, and a short list of steps with
 * no search. In the builder's pane it sits in the popover the builder places
 * under its slot (`surface="popover"`).
 *
 * @packageDocumentation
 */

import { memo, useCallback, useMemo } from "react";
import { library } from "@fortawesome/fontawesome-svg-core";
import { fas } from "@fortawesome/free-solid-svg-icons";
import { Chooser } from "@elaraai/east-ui-components/internal";
import { slotOptions } from "./slot-options.js";
import type { SlotPopover } from "./use-query-editor.js";

// An offer's icon is a Font Awesome solid name (e.g. "filter"); register the
// free-solid set so it resolves by name (idempotent — safe if already added).
library.add(fas);

/** Props of {@link SlotChooser}. */
export interface SlotChooserProps {
    /** The open slot's offers, and what it is told. */
    readonly popover: SlotPopover;
    /** Where it sits: bare in a body its host frames, or in a popover of its own. */
    readonly surface: "bare" | "popover";
    /** Whether it draws its search; a short list offered whole — a phone's steps (QP34) — has none. Drawn by default. */
    readonly search?: boolean | undefined;
    /** Whether the offer that sets what the slot holds now is checked (QP33): a phone's view's. */
    readonly checked?: boolean | undefined;
    /** Whether its host titles it — a phone's view, its label in its head: the label is not said again before the search. */
    readonly titled?: boolean | undefined;
}

/**
 * The open slot's offers in the shared picker — see the module docs.
 *
 * @param props - The open slot's offers, where it sits, whether it searches, and whether its value now is checked ({@link SlotChooserProps})
 * @returns The picker
 */
export const SlotChooser = memo(function SlotChooser({ popover, surface, search, checked = false, titled = false }: SlotChooserProps) {
    const { items, initialActive, current, onPick, onClose, slot } = popover;
    const { sections, offerOf, initialKey } = useMemo(() => slotOptions(items, initialActive, checked ? current : -1), [items, initialActive, checked, current]);
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
        <Chooser sections={sections} placeholder={popover.placeholder} label={titled ? undefined : popover.label} empty={popover.empty} hint={popover.hint}
            query={popover.text} onQuery={popover.onText} initialKey={initialKey} tabChooses search={search}
            onChoose={choose} onClose={close} surface={surface} autoFocus />
    );
});
