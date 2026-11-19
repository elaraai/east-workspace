/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The query builder's slots, driven as a pointer drives them — for the tests
 * of every surface that draws its condition rows: the builder's own, and a
 * Studio page's filters (#1673). A slot is opened by the words it shows, and
 * an offer of its list picked by its label — the builder's autocomplete, or
 * the shared picker the rows in place draw (`[data-chooser]`).
 *
 * @packageDocumentation
 */

import { fireEvent } from "@testing-library/react";

/** Runs an update as the test's surface runs one: a harness's own `act`, or Testing Library's. */
export type Act = (update: () => Promise<void>) => Promise<void>;

/** A slot's driver. */
export interface SlotActions {
    /** The open autocomplete; `null` when none is. */
    readonly popover: () => HTMLElement | null;
    /** Its offers' labels, in order. */
    readonly offers: () => (string | null)[];
    /** Opens a slot by the words it shows, in a card or a block of rows. */
    readonly openSlot: (within: HTMLElement, text: string) => Promise<void>;
    /** Picks an offer of the open autocomplete by its label, as a click does. */
    readonly pick: (label: string) => Promise<void>;
}

/**
 * The slots' driver, for a surface's own `act`.
 *
 * @param act - Runs an update as the surface's tests run one
 * @param settle - Waits for what the update started
 * @returns The driver
 */
export function slotActions(act: Act, settle: () => Promise<void>): SlotActions {
    const popover = () => document.querySelector<HTMLElement>("[data-query-autocomplete], [data-chooser]");
    /** An offer's label: the autocomplete's, or the picker's. */
    const labelOf = (option: HTMLElement) => option.querySelector("[data-label], [data-option-label]")!.textContent;
    const offers = () => [...popover()!.querySelectorAll<HTMLElement>("[role=option]")].map(labelOf);
    return {
        popover,
        offers,
        openSlot: async (within, text) => {
            const slot = [...within.querySelectorAll<HTMLElement>("[aria-haspopup=listbox]")].find((el) => el.querySelector("span")!.textContent === text);
            if (slot === undefined) throw new Error(`no slot “${text}”`);
            await act(async () => { fireEvent.click(slot); });
            await settle();
        },
        pick: async (label) => {
            const option = [...popover()!.querySelectorAll<HTMLElement>("[role=option]")].find((o) => labelOf(o) === label);
            if (option === undefined) throw new Error(`no offer “${label}”: ${offers().join(", ")}`);
            await act(async () => { fireEvent.click(option); });
            await settle();
        },
    };
}
