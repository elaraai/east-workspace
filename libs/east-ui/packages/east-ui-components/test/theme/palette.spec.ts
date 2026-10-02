/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The palette roles a solid button reads (#1091). A palette's roles are CSS
 * variables, set where the palette is set; a role a palette lacks is
 * inherited from the nearest element whose palette has it — at the last,
 * `html`, where the default palette (brand) is set. So a palette missing one
 * of the roles the `solid` and `commit-primary` variants read would paint
 * that state in another palette's colour: a red button hovering in brand, or
 * a `danger` button filled from a stop it does not have.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Style } from "@elaraai/east-ui";
import { system } from "../../src/theme/index.js";

/** The roles the button recipe's `solid` and `commit-primary` read, as the variables a palette sets. */
const SOLID_ROLES = ["solid", "contrast", "solid-hover"].map((role) => `--chakra-colors-color-palette-${role}`);

test("every palette with a solid fill carries every role a solid button reads", () => {
    const missing: string[] = [];
    for (const [palette, roles] of system.tokens.colorPaletteMap) {
        if (!roles.has("--chakra-colors-color-palette-solid")) continue;
        for (const role of SOLID_ROLES) if (!roles.has(role)) missing.push(`${palette}: ${role}`);
    }
    assert.deepEqual(missing, []);
});

test("every palette an East program can name has a solid fill", () => {
    const palettes = Object.keys(Style.Types.ColorScheme.cases);
    assert.ok(palettes.length >= 16, "the ColorScheme names the brand, Chakra's hues and the valences");
    const without = palettes.filter((name) => system.tokens.colorPaletteMap.get(name)?.has("--chakra-colors-color-palette-solid") !== true);
    assert.deepEqual(without, []);
});
