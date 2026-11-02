/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

import { beforeEach } from "vitest";
import { resetKept } from "./src/platform/kept.js";

// Each test opens a fresh page: what the page kept in memory goes, as storage's clearing takes what it stored. A test is
// a tab of its own: what an earlier test's sessions kept in the tab's storage is not its.
beforeEach(() => {
    resetKept();
    if (typeof sessionStorage !== "undefined") sessionStorage.clear();
});
