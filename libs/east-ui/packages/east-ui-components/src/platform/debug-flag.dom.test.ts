/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 */

/** A developer's debug flag: read by the name a developer types, on unless unset or `off`, off where storage is out of reach. */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { debugFlag } from "./debug-flag.js";

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("debug flag", () => {
    test("on once set by its name, unless set to off", () => {
        expect(debugFlag("e3-paging-debug")).toBe(false);
        window.localStorage.setItem("e3-paging-debug", "1");
        expect(debugFlag("e3-paging-debug")).toBe(true);
        window.localStorage.setItem("e3-paging-debug", "off");
        expect(debugFlag("e3-paging-debug")).toBe(false);
    });

    test("off where storage cannot be reached", () => {
        vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
        expect(debugFlag("e3-paging-debug")).toBe(false);
    });
});
