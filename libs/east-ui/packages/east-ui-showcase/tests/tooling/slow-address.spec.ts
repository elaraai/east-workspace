/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * The page's address asking every read of its e3 to wait (`?slow=<ms>`,
 * #1438), as the fault hook reads it: a whole number of milliseconds, at most
 * thirty seconds, and nothing else.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { slowFromAddress } from "../../showcase-e3-faults";

test("an address's slowing: a whole number of milliseconds, at most thirty seconds, and nothing else", () => {
    assert.equal(slowFromAddress("?slow=600"), 600);
    assert.equal(slowFromAddress("?theme=light&slow=1500"), 1500);
    assert.equal(slowFromAddress("?slow=99999"), 30_000);
    for (const search of ["", "?theme=dark", "?slow=", "?slow=0", "?slow=-5", "?slow=1.5", "?slow=soon"]) {
        assert.equal(slowFromAddress(search), undefined, search);
    }
});
