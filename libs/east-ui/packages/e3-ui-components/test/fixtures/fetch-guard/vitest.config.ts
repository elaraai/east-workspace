/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** The fetch guard's own tests (`test/fetch-guard.spec.ts`), under the package's setup and nothing else. */

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
    root: here,
    test: {
        environment: "node",
        include: ["requests.guard.ts"],
        setupFiles: ["../../../vitest.setup.ts"],
    },
});
