/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A slot's offers as the shared picker lists them (#1673): the editor's
 * offers (`slotItems`) — grouped, each with its detail, its note and its
 * meta — as the `Chooser`'s sections and options, for the builder and for
 * every host of the condition rows in place.
 *
 * - **Sections**: the offers' groups, in their order — `Fields`, `Values`,
 *   `Typed`.
 * - **An option**: its label — words in the body face, or data (`mono`) in
 *   the mono; its detail and its note on its line; its meta at its end; its
 *   icon before it; and, listed but not to be picked, refused with its reason.
 * - **Its key**: the offer's group and label — what holds the highlight on it
 *   as the list is given again for the text typed — and the value typed
 *   always the one key, whatever is typed.
 *
 * @packageDocumentation
 */

import type { IconName, IconProp } from "@fortawesome/fontawesome-svg-core";
import type { ChooserOption, ChooserSection } from "@elaraai/east-ui-components/internal";
import type { SlotItem } from "./model/slots.js";

/** A slot's offers as the picker takes them. */
export interface SlotOptions {
    /** The sections, in the offers' order. */
    readonly sections: readonly ChooserSection[];
    /** Each option's offer, by its key: what a choice picks. */
    readonly offerOf: ReadonlyMap<string, SlotItem>;
    /** The key of the offer the list opens on; `undefined` where none can be picked. */
    readonly initialKey: string | undefined;
}

/** The key the value typed is listed under, whatever is typed. */
const TYPED_KEY = "typed";

/**
 * A slot's offers as the picker's sections and options — see the module docs.
 *
 * @param items - The offers, in their groups' order (`slotItems`)
 * @param initialActive - The offer the list opens on (`activeItem`): its index, or `-1`
 * @returns The sections, each option's offer by its key, and the key it opens on
 */
export function slotOptions(items: readonly SlotItem[], initialActive: number): SlotOptions {
    const sections: { label: string; options: ChooserOption[] }[] = [];
    const offerOf = new Map<string, SlotItem>();
    let initialKey: string | undefined;
    items.forEach((item, i) => {
        const base = item.typed === true ? TYPED_KEY : `${item.group}\u001f${item.label}`;
        let key = base;
        for (let n = 2; offerOf.has(key); n++) key = `${base}\u001f${n}`;
        offerOf.set(key, item);
        if (i === initialActive) initialKey = key;
        let section = sections.at(-1);
        if (section === undefined || section.label !== item.group) {
            section = { label: item.group, options: [] };
            sections.push(section);
        }
        const line = [item.detail, item.note].filter((part): part is string => part !== undefined && part !== "").join(" · ");
        section.options.push({
            key,
            label: item.label,
            state: item.disabled === true ? "refused" : "enabled",
            ...(line === "" ? {} : { line }),
            ...(item.meta === undefined || item.meta === "" ? {} : { range: item.meta }),
            ...(item.icon === undefined ? {} : { icon: ["fas", item.icon as IconName] as IconProp }),
            ...(item.mono === true ? {} : { words: true }),
        });
    });
    return { sections, offerOf, initialKey };
}
