/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `resolveColor` (#817) — a colour string resolved against the Chakra system,
 * never guessed from its shape.
 */

import { describe, test, expect } from "vitest";
import { system } from "../../theme/index.js";
import { resolveColor } from "./helpers.js";

describe("resolveColor", () => {
    test("a theme token path becomes its CSS variable — bare, `colors.`-prefixed or braced", () => {
        expect(resolveColor(system, "brand.600")).toBe("var(--chakra-colors-brand-600)");
        expect(resolveColor(system, "colors.brand.600")).toBe("var(--chakra-colors-brand-600)");
        expect(resolveColor(system, "{colors.brand.600}")).toBe("var(--chakra-colors-brand-600)");
        // A semantic token too — the system knows it, whatever its spelling.
        expect(resolveColor(system, "fg.muted")).toBe("var(--chakra-colors-fg-muted)");
    });

    test("raw CSS comes back as it is — a hex, a var(), an rgb(), a named colour", () => {
        expect(resolveColor(system, "#1a2b3c")).toBe("#1a2b3c");
        expect(resolveColor(system, "var(--my-colour)")).toBe("var(--my-colour)");
        expect(resolveColor(system, "rgb(1, 2, 3)")).toBe("rgb(1, 2, 3)");
        expect(resolveColor(system, "red")).toBe("red");
    });

    test("a dotted string the system does not hold is not a token", () => {
        expect(resolveColor(system, "ink.3")).toBe("ink.3");
        expect(resolveColor(system, "0.5")).toBe("0.5");
    });
});
