/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 *
 * A loading button (#1573) — Publish while it publishes — is working, not
 * off: its variant's own look under its spinner, at full strength over
 * Chakra's disabled fade, the pointer saying so. The disabled look, the
 * `bg.emphasized` slab, is a button's that cannot act.
 */

import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Button, ChakraProvider } from "@chakra-ui/react";
import { system } from "./index.js";

afterEach(cleanup);

/** Every style rule the page's sheets hold, those inside a layer or a condition among them. */
function styleRules(): CSSStyleRule[] {
    const out: CSSStyleRule[] = [];
    const walk = (rules: CSSRuleList) => {
        for (const rule of rules) {
            if (rule instanceof CSSStyleRule) out.push(rule);
            else if ("cssRules" in rule) walk((rule as CSSGroupingRule).cssRules);
        }
    };
    for (const sheet of document.styleSheets) walk(sheet.cssRules);
    return out;
}

/** The declarations of every rule that applies to an element, as `property: value`. */
function declared(element: Element): string[] {
    return styleRules().filter((rule) => {
        try {
            return element.matches(rule.selectorText);
        } catch {
            return false;
        }
    }).flatMap((rule) => [...rule.style].map((property) => `${property}: ${rule.style.getPropertyValue(property)}`));
}

describe("a loading button (#1573)", () => {
    test("keeps its variant's look at full strength, the pointer saying it works; a disabled one takes the disabled slab", () => {
        const { container } = render(<ChakraProvider value={system}>
            <Button variant="solid" loading aria-label="Publish" data-button="loading">Publish</Button>
            <Button variant="solid" disabled data-button="disabled">Publish</Button>
        </ChakraProvider>);
        const loading = container.querySelector<HTMLButtonElement>('[data-button="loading"]')!;
        const disabled = container.querySelector<HTMLButtonElement>('[data-button="disabled"]')!;
        expect([loading.disabled, loading.hasAttribute("data-loading")]).toEqual([true, true]);
        const slab = (rules: readonly string[]) => rules.some((rule) => rule.startsWith("background") && rule.includes("bg-emphasized"));
        const onLoading = declared(loading);
        expect([onLoading.includes("opacity: 1"), onLoading.includes("cursor: progress"), slab(onLoading)]).toEqual([true, true, false]);
        const onDisabled = declared(disabled);
        expect([slab(onDisabled), onDisabled.includes("cursor: not-allowed"), onDisabled.includes("cursor: progress")]).toEqual([true, true, false]);
    });
});
