/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { expect, test } from "vitest";
import { authorOf } from "./author.js";

test("a commit names the person who made it, and no one for the platform's own writers or a write that named no one", () => {
    expect(["auth:ada@example.com", "cli:ada", "Ada Brook", "system:deploy", "files:sync", "api", "auth:", ""].map(authorOf))
        .toEqual(["ada@example.com", "ada", "Ada Brook", undefined, undefined, undefined, undefined, undefined]);
});
