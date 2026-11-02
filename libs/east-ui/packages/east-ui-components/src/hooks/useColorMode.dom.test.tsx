/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 */

/** The colour mode, kept for the device: read back after a reload, left by a sign-out. */

import { describe, test, expect, beforeEach } from "vitest";
import { clearKept, keptName, resetKept } from "../platform/kept.js";
import { applyColorMode, storedColorMode } from "./useColorMode.js";

beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
});

describe("colour mode", () => {
    test("an applied mode is stamped on the page and kept for the device", () => {
        expect(storedColorMode()).toBeUndefined();
        applyColorMode("dark");
        expect(document.documentElement.classList.contains("dark")).toBe(true);
        resetKept();
        expect(storedColorMode()).toBe("dark");
    });

    test("a sign-out leaves the device's mode", () => {
        applyColorMode("dark");
        clearKept();
        expect(storedColorMode()).toBe("dark");
    });

    test("a stored mode other than light or dark is not taken", () => {
        window.localStorage.setItem(keptName("east-ui.color-mode", { scoped: false }), "sepia");
        expect(storedColorMode()).toBeUndefined();
    });
});
