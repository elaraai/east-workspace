/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The shared links layer (#1321): what a host adds over Plan's drawing — a
 * selected link's caption ×, which unlinks and is never a drag (A68), and a
 * link drag's preview, the moved link's `was` line and the new line (A69) —
 * read from Plan's recipe, which merges the theme's shared `linkRibbons` part.
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { ChakraProvider, useSlotRecipe, Box } from "@chakra-ui/react";
import { system } from "@elaraai/east-ui-components";
import { LinksLayer, type LinkRibbon } from "./layer.js";
import { routeRibbon, type RibbonEnd } from "./geometry.js";

type Styles = Record<string, Record<string, unknown>>;

afterEach(() => cleanup());

/** A bin card's rect, in the layer's px. */
const card = (top: number): RibbonEnd => ({ leftX: 52, rightX: 140, top, bottom: top + 28 });
/** A resource row's leading edge, in the layer's px. */
const row = (top: number): RibbonEnd => ({ leftX: 440, rightX: 600, top: top + 8, bottom: top + 28 });
const ribbon = (id: number, from: RibbonEnd, to: RibbonEnd, label: string | undefined): LinkRibbon =>
    ({ ...routeRibbon(from, to, label === undefined ? 1.5 : 4), id, from, to, label });

const LINKS: LinkRibbon[] = [ribbon(0, card(4), row(108), "32 m³"), ribbon(1, card(40), row(180), "11 m³"), ribbon(2, card(76), row(36), undefined)];

function Layer(props: Partial<Parameters<typeof LinksLayer>[0]>) {
    const recipe = useSlotRecipe({ key: "plan" });
    const styles = recipe() as unknown as Styles;
    return (
        <Box css={styles.ribbons} data-plan-ribbons>
            <LinksLayer ribbons={LINKS} width={640} height={240} clip={{ left: 0, width: 640 }} hit={() => ({})} {...props} />
        </Box>
    );
}
const mount = (props: Partial<Parameters<typeof LinksLayer>[0]> = {}) => render(<ChakraProvider value={system}><Layer {...props} /></ChakraProvider>);

describe("the shared links layer", () => {
    test("draws Plan's links: every link's casing under its ink, a hit area per link, a caption per quantity", () => {
        const { container } = mount();
        expect(container.querySelectorAll("[data-plan-link]")).toHaveLength(3);
        expect(container.querySelectorAll("[data-plan-ribbon-casing]")).toHaveLength(3);
        expect(container.querySelectorAll("[data-link]")).toHaveLength(3);
        expect(container.querySelectorAll("[data-plan-ribbon-caption]")).toHaveLength(2);
        // Nothing to draw, no SVG.
        cleanup();
        const empty = render(<ChakraProvider value={system}><Layer ribbons={[]} /></ChakraProvider>);
        expect(empty.container.querySelector("svg")).toBeNull();
    });

    test("A68 — only the selected link's caption is outlined and carries a × in its own 16px target; its pointer-down is stopped and its click unlinks", () => {
        const onUnlink = vi.fn();
        const outer = vi.fn();
        const { container } = render(
            <ChakraProvider value={system}>
                <div onPointerDown={outer}>
                    <Layer selected={1} onUnlink={onUnlink} unlinkLabel={(r) => `Unlink ${r.label} · Delete`} />
                </div>
            </ChakraProvider>,
        );
        const selected = container.querySelectorAll("[data-plan-ribbon-label][data-selected]");
        expect(selected).toHaveLength(1);
        expect(selected[0]!.getAttribute("data-plan-ribbon-label")).toBe("1");
        const targets = container.querySelectorAll("[data-plan-ribbon-unlink]");
        expect(targets).toHaveLength(1);
        expect([targets[0]!.getAttribute("width"), targets[0]!.getAttribute("height")]).toEqual(["16", "16"]);
        const button = targets[0]!.querySelector("button")!;
        expect(button.getAttribute("aria-label")).toBe("Unlink 11 m³ · Delete");
        expect(button.querySelector("svg[data-icon='xmark']")).not.toBeNull();
        fireEvent.pointerDown(button);
        expect(outer).not.toHaveBeenCalled();
        fireEvent.click(button);
        expect(onUnlink).toHaveBeenCalledWith(1);
        // The selected link's group is marked for its outline.
        expect(container.querySelector("[data-plan-link='1']")!.hasAttribute("data-selected")).toBe(true);
        expect(container.querySelector("[data-plan-link='0']")!.hasAttribute("data-selected")).toBe(false);
    });

    test("A68 — with no host to unlink, a selected link has no ×", () => {
        const { container } = mount({ selected: 0 });
        expect(container.querySelector("[data-plan-ribbon-unlink]")).toBeNull();
    });

    test("A69 — a link drag fades the moved link to its was line, and draws the new line to the pointer", () => {
        const line = routeRibbon(card(4), { leftX: 300, rightX: 300, top: 150, bottom: 150 }, 3);
        const { container } = mount({ preview: { was: 0, line: { stroke: line.stroke, head: line.head } } });
        expect(container.querySelector("[data-plan-link='0']")!.hasAttribute("data-was")).toBe(true);
        expect(container.querySelector("[data-plan-link='1']")!.hasAttribute("data-was")).toBe(false);
        const preview = container.querySelector("[data-plan-link-preview]")!;
        expect(preview.querySelector("[data-plan-ribbon-band]")!.getAttribute("d")).toBe(line.stroke);
        expect(preview.querySelector("[data-plan-ribbon-head]")!.getAttribute("d")).toBe(line.head);
    });

    test("Plan's recipe merges the shared look, with the selected caption's outline and the preview's brand line", () => {
        let styles: Styles = {};
        function Read() { styles = useSlotRecipe({ key: "plan" })() as unknown as Styles; return null; }
        render(<ChakraProvider value={system}><Read /></ChakraProvider>);
        // A resolved slot holds its styles in the recipes' cascade layer.
        const look = styles.ribbons!["@layer recipes"] as Record<string, unknown>;
        expect(look["& [data-plan-ribbon-band]"]).toEqual({ fill: "none", stroke: "var(--chakra-colors-fg-muted)" });
        expect(look["& [data-selected] [data-plan-ribbon-knockout]"]).toEqual({ stroke: "var(--chakra-colors-fg)", strokeWidth: "1px" });
        expect(look["& [data-was] [data-plan-ribbon-band]"]).toEqual({ stroke: "var(--chakra-colors-fg-subtle)", strokeWidth: "1.5px" });
        expect((look["& [data-plan-link-preview] [data-plan-ribbon-band]"] as Record<string, unknown>).strokeWidth).toBe("3px");
        expect(look["position"]).toBe("absolute");
    });
});
