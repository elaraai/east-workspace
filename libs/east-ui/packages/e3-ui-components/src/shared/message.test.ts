/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** What an error says: the one copy the package's parts share. */

import { describe, expect, it } from "vitest";
import { messageOf } from "./message.js";

describe("messageOf", () => {
    it("says an Error's message, and what else was thrown as text", () => {
        expect(messageOf(new TypeError("fetch failed"))).toBe("fetch failed");
        expect(messageOf("refused")).toBe("refused");
        expect(messageOf(undefined)).toBe("undefined");
    });
});
