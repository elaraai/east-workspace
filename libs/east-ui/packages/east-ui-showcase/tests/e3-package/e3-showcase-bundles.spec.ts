/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * The showcase's workspace bundles (#849, #1397), as the page takes them in:
 * each area's, made as the Vite plugin makes it — the area's package deployed
 * and its dataflow run in an e3 as the page's runs, and the workspace written
 * out — makes the area's workspace in a fresh e3 of the same kind, every task's
 * output up to date, so the page deploys and runs nothing to start an area.
 */

import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createWebE3, inProcessUnits } from "@elaraai/e3-web";
import { serveE3 } from "@elaraai/e3-web/worker";
import { repoCreate, workspaceBundleImport, workspaceStatus, type RequestOptions } from "@elaraai/e3-api-client";
import { buildE3ShowcaseBundles } from "../../scripts/vite-plugin-e3-showcase";
import { SHOWCASE_REPO, showcaseE3Workspace } from "../../showcase-config";
import { SHOWCASE_PIECE_TARGET } from "../../showcase-pieces";

/** The showcase package's root. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** e3-ui's root, where the package step is. */
const E3_UI = path.resolve(ROOT, "../e3-ui");

describe("the showcase's workspace bundles, one an area", () => {
    let bundles: Map<string, Uint8Array>;

    before(async () => {
        bundles = await buildE3ShowcaseBundles(E3_UI);
    });

    test("each makes its area's workspace in a fresh e3, every task up to date and none to run", async () => {
        assert.ok(bundles.size > 0, "the build made bundles");
        const { port1, port2 } = new MessageChannel();
        serveE3({ units: inProcessUnits(), width: 4, persist: false, pieceBytes: SHOWCASE_PIECE_TARGET }, port1);
        const e3 = await createWebE3(port2);
        try {
            const options: RequestOptions = { token: null, fetch: e3.fetch };
            await repoCreate(e3.apiUrl, SHOWCASE_REPO, options);
            for (const [area, bundle] of bundles) {
                const workspace = showcaseE3Workspace(area);
                await workspaceBundleImport(e3.apiUrl, SHOWCASE_REPO, workspace, bundle, options);
                const status = await workspaceStatus(e3.apiUrl, SHOWCASE_REPO, workspace, options);
                const behind = status.tasks.filter((task) => task.status.type !== "up-to-date").map((task) => `${task.name}: ${task.status.type}`);
                assert.deepEqual(behind, [], `${area}: every task's output came with its bundle`);
            }
        } finally {
            e3.close();
        }
    });
});
