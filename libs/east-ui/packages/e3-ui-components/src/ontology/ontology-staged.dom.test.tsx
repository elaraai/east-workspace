/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A staged Ontology's own Apply and Discard, on e3: an edit is held, the
 * header saying Unsaved changes beside Discard and Apply; Discard drops it,
 * the dataset as it was, and Apply commits it to the dataset. A direct
 * binding is never pending, so neither shows.
 */

import { describe, test, expect } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/ontology/ontology";
import { act, e3Harness, settle } from "../e3-web-mount.test-utils.js";
// The editor is an extension: its renderer registers as it loads.
import "./index.js";

const h = e3Harness({ "ontology/ontology": ex }, { measure: false });

/** The header's buttons, by their words. */
const headerButtons = (container: HTMLElement) => [...container.querySelectorAll("button")]
    .map((button) => button.textContent ?? "")
    .filter((text) => text === "Discard" || text === "Apply");

/** The header's button of these words; the properties drawer, modal, hides it from a role query while it is open. */
const headerButton = (container: HTMLElement, words: "Discard" | "Apply") =>
    [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === words)!;

/** Renames the node a table chip names, through its properties drawer, as Enter commits it. */
async function rename(container: HTMLElement, from: string, to: string): Promise<void> {
    const chip = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === from);
    if (chip === undefined) throw new Error(`no chip names ${from}`);
    await act(async () => { fireEvent.click(chip); });
    const drawer = await screen.findByText("Edit Node");
    const name = within(drawer.closest<HTMLElement>("[role=dialog]")!).getByDisplayValue(from);
    await act(async () => {
        fireEvent.change(name, { target: { value: to } });
        fireEvent.keyDown(name, { key: "Enter" });
    });
    await settle();
}

/** The names of the dataset's nodes, as e3 holds them. */
const storedNames = async () => (await h.read(ex.tradingCycleOntologyInput)).nodes.map((node) => node.name);

describe("a staged Ontology's Apply and Discard", () => {
    test("an edit is held beside Discard and Apply; Discard drops it, and Apply commits it", async () => {
        const { container } = await h.mount(ex.ontologyStaged, { storageKey: "ontology-staged", drag: false });
        expect(headerButtons(container)).toEqual([]);

        await rename(container, "Raw materials", "Raw stock");
        expect(container.textContent).toContain("Unsaved changes");
        expect(headerButtons(container)).toEqual(["Discard", "Apply"]);
        expect(await storedNames()).toContain("Raw materials");

        await act(async () => { fireEvent.click(headerButton(container, "Discard")); });
        await settle();
        expect(headerButtons(container)).toEqual([]);
        expect(container.textContent).not.toContain("Unsaved changes");
        expect(await storedNames()).toContain("Raw materials");

        await rename(container, "Raw materials", "Raw stock");
        await act(async () => { fireEvent.click(headerButton(container, "Apply")); });
        await settle();
        expect(headerButtons(container)).toEqual([]);
        const names = await storedNames();
        expect(names).toContain("Raw stock");
        expect(names).not.toContain("Raw materials");
    });

    test("a direct binding is never pending: an edit writes through, and neither button shows", async () => {
        const { container } = await h.mount(ex.ontologyTableCycleView, { storageKey: "ontology-direct", drag: false });
        await rename(container, "Raw materials", "Raw stock");
        expect(headerButtons(container)).toEqual([]);
        expect(await storedNames()).toContain("Raw stock");
    });
});
