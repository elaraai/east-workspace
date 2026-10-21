/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The stand-ins e3-ui-components' lint keeps out of its tests (#1380): an
 * in-memory record or function API, a mock of e3's client and a stub of the
 * global fetch, each refused in a test or a test's helper — files matched by
 * pattern (`*.test.*`, `*.test-utils.*`, `test/**`), never by a list — and
 * named with what replaces it, the e3-web harness; and none refused in a
 * source, where the in-memory APIs serve the snapshot tool and hosts with no
 * server. The spec reads the rule as the package's config gives it to each
 * file, and runs it over each stand-in planted, and over what a test may do.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { ESLint, Linter } from "eslint";
import * as tsParser from "@typescript-eslint/parser";

const PACKAGE = dirname(import.meta.dirname);
const eslint = new ESLint({ cwd: PACKAGE });

/** The restricted syntax the package's config gives a file: each selector and its message. */
async function restrictedFor(file: string): Promise<{ selector: string; message: string }[]> {
    const config = await eslint.calculateConfigForFile(join(PACKAGE, file)) as { rules?: Record<string, unknown> };
    const rule = config.rules?.["no-restricted-syntax"];
    return Array.isArray(rule) ? rule.slice(1) as { selector: string; message: string }[] : [];
}

/** Whether a selector is one of the stand-ins'. */
const standIn = (restricted: { selector: string }) => /createInMemory|e3-api-client|stubGlobal/.test(restricted.selector);

/** What the rule says of some code, as a test file's lint runs it. */
async function refusals(code: string): Promise<string[]> {
    const restricted = await restrictedFor("src/hooks/planted.test.tsx");
    const linter = new Linter({ configType: "flat" });
    return linter.verify(code, {
        files: ["**/*.ts"],
        languageOptions: { parser: tsParser as unknown as Linter.Parser },
        rules: { "no-restricted-syntax": ["error", ...restricted] },
    }, "planted.test.ts").map((message) => message.message);
}

test("a test or a test's helper, by its name's pattern, is held to the rule; a source is not", async () => {
    for (const file of ["src/hooks/a.test.tsx", "src/plan/b.test.ts", "src/shared/c.test-utils.tsx", "src/d.test-utils.ts", "test/e.spec.ts", "test/fixtures/f.ts"]) {
        assert.equal((await restrictedFor(file)).filter(standIn).length, 3, file);
    }
    for (const file of ["src/snapshot/main.tsx", "src/platform/record-runtime.ts", "src/plan/canvas.tsx"]) {
        assert.equal((await restrictedFor(file)).filter(standIn).length, 0, file);
    }
});

test("each stand-in planted in a test is refused, naming the e3-web harness", async () => {
    const planted = [
        `import { createInMemoryRecordApi } from "../platform/index.js";\ncreateInMemoryRecordApi(cache, "w", []);`,
        `import { createInMemoryFunctionApi } from "../platform/index.js";\nexport const api = createInMemoryFunctionApi([]);`,
        `import * as platform from "../platform/index.js";\nplatform.createInMemoryRecordApi(cache, "w", []);`,
        `vi.mock("@elaraai/e3-api-client", async () => ({}));`,
        `vi.doMock("@elaraai/e3-api-client");`,
        `vi.stubGlobal("fetch", async () => new Response(null));`,
    ];
    for (const code of planted) {
        const said = await refusals(code);
        assert.ok(said.length > 0, `refused: ${code}`);
        for (const message of said) assert.match(message, /the e3-web harness \(src\/e3-web\.test-utils\.ts, src\/e3-web-mount\.test-utils\.tsx, test\/fixtures\/e3\.ts\)/, code);
    }
});

test("what a test may do is not refused: another module mocked, another global stubbed, a fault at the harness's fetch", async () => {
    assert.deepEqual(await refusals([
        `vi.mock("./words.js", async () => ({}));`,
        `vi.stubGlobal("ResizeObserver", class {});`,
        `h.e3.fail((request) => request.kind === "page", "network");`,
        `const api = createDefaultRecordApi(h.e3.apiUrl, h.e3.repo, () => h.e3.options);`,
    ].join("\n")), []);
});
