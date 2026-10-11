/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { extractDependencies } from "../../scripts/vite-plugin-example-sources";

test("showcase dependencies include shared record declarations once, without unrelated examples", async () => {
    const dir = await mkdtemp(join(tmpdir(), "showcase-source-"));
    try {
        await writeFile(join(dir, "records.ts"), `
            import { render } from "./view.js";
            export const rowType = { name: "String" };
            export const staff = makeRecord("staff", rowType);
            export const byTeam = makeIndex(staff, "team");
            export const unused = makeRecord("unused", rowType);
            export const otherView = example({ fn: () => render(unused) });
        `);
        const code = `
            import { staff, byTeam as index } from "./records.js";
            export const render = () => bind(staff, index);
            export const view = example({ fn: render });
        `;
        const file = join(dir, "view.tsx");
        await writeFile(file, code);
        const shown = await extractDependencies(file, code);
        assert.match(shown, /makeRecord\("staff", rowType\)/);
        assert.match(shown, /makeIndex\(staff, "team"\)/);
        assert.match(shown, /const index = byTeam;/);
        assert.match(shown, /export const render/);
        assert.doesNotMatch(shown, /unused|otherView|example\(/);
        assert.equal(shown.match(/export const staff/g)?.length, 1);
        assert.ok(shown.indexOf("export const staff") < shown.indexOf("export const render"));
    } finally { await rm(dir, { recursive: true, force: true }); }
});
