/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `declaredStyle` reads what an element's own emotion class sets, as the
 * cascade would take it (#1263): a rule outside a cascade layer over one in a
 * layer, a later rule over an earlier, no rule under a condition, and no other
 * class's rule.
 */

import { describe, test, expect, afterEach } from "vitest";
import { declaredStyle } from "./styles.js";

afterEach(() => {
    document.head.replaceChildren();
    document.body.replaceChildren();
});

/** A style element holding the CSS, as emotion writes one. */
function sheet(css: string): void {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
}

/** An element of the classes. */
function element(classes: string): HTMLElement {
    const el = document.createElement("span");
    el.className = classes;
    document.body.append(el);
    return el;
}

describe("declaredStyle (#1263)", () => {
    test("reads the property the element's own class sets — a calc() font, a custom property — and none it does not set", () => {
        sheet(".css-a1{display:inline-flex;font-size:calc(20px / 1.2);--fa-width:1em;}");
        const el = element("elara-btn css-a1");
        expect([declaredStyle(el, "font-size"), declaredStyle(el, "--fa-width"), declaredStyle(el, "display"), declaredStyle(el, "color")])
            .toEqual(["calc(20px / 1.2)", "1em", "inline-flex", undefined]);
        // No class of its own: nothing to read.
        expect(declaredStyle(element("elara-btn"), "font-size")).toBeUndefined();
    });

    test("a rule outside a cascade layer wins over one in a layer, and a later rule over an earlier", () => {
        sheet("@layer recipes{.css-b2{font-size:11px;--fa-width:1em;}}.css-b2{font-size:9px;}");
        const el = element("css-b2");
        expect([declaredStyle(el, "font-size"), declaredStyle(el, "--fa-width")]).toEqual(["9px", "1em"]);
        sheet("@layer recipes{.css-b2{--fa-width:auto;}}");
        expect(declaredStyle(el, "--fa-width")).toBe("auto");
    });

    test("a rule under a condition is left out, before or after the rule it would override, and another class's rule is never read", () => {
        sheet("@media (pointer: coarse){.css-c3{font-size:44px;}}.css-c3{font-size:12px;}@supports (display:grid){.css-c3{font-size:40px;}}.css-c33{font-size:99px;}.css-c3 svg{font-size:7px;}");
        expect(declaredStyle(element("css-c3"), "font-size")).toBe("12px");
    });
});
