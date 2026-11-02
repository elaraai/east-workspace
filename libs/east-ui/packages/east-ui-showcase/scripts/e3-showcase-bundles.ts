/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * Builds the showcase's workspace bundles (#849, #1397): each area's package —
 * the zip e3-ui's examples' package step wrote for it — imported into an e3 in
 * this process, as the page's runs (e3-web, its repositories in memory, four
 * units at most, a split task's pieces cut at the showcase's size), deployed
 * to the area's workspace and its dataflow run once; then the workspace written
 * out as a bundle, which the e3 the page runs makes the area's workspace from,
 * with nothing to deploy or run.
 *
 * Usage: `node --import tsx scripts/e3-showcase-bundles.ts <dir> [area…]` reads
 * `<dir>/<area>.zip` for each area named, or for each zip the directory holds,
 * and writes `<dir>/<area>.beast2` beside it. A dataflow that does not succeed
 * fails the step, naming each task that failed and why.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { IntegerType, printFor } from "@elaraai/east";
import { createWebE3, inProcessUnits, type WebE3 } from "@elaraai/e3-web";
import { serveE3 } from "@elaraai/e3-web/worker";
import {
    dataflowExecute, packageImport, repoCreate, taskLogs, workspaceBundle, workspaceCreate, workspaceDeploy,
    type DataflowResult, type RequestOptions,
} from "@elaraai/e3-api-client";
import { SHOWCASE_REPO, showcaseE3Workspace } from "../showcase-config";
import { SHOWCASE_PIECE_TARGET } from "../showcase-pieces";

const printInteger = printFor(IntegerType);

/** What a dataflow run that did not succeed says of each task that failed —
 *  its error, or how it exited and its stderr's lines but the stack. */
async function runFailures(e3: WebE3, workspace: string, options: RequestOptions, run: DataflowResult): Promise<string> {
    const said = await Promise.all(run.tasks.map(async (task): Promise<string[]> => {
        switch (task.state.type) {
            case "error":
                return [`task '${task.name}': ${task.state.value.message}`];
            case "failed": {
                const exited = `task '${task.name}' exited ${printInteger(task.state.value.exitCode)}`;
                const stderr = await taskLogs(e3.apiUrl, SHOWCASE_REPO, workspace, task.name, { stream: "stderr" }, options)
                    .then((chunk) => chunk.data.split("\n").filter((line) => line.trim() !== "" && !line.startsWith("  at ")).join(" "))
                    .catch(() => "");
                return [stderr === "" ? exited : `${exited}: ${stderr}`];
            }
            case "success":
            case "skipped":
                return [];
        }
    }));
    return said.flat().join("; ");
}

/**
 * Makes an area's workspace from its package and writes it out as a bundle.
 *
 * @throws {Error} Naming the area, when its package does not import or
 *   deploy, or its dataflow does not succeed
 */
async function bundleArea(e3: WebE3, options: RequestOptions, dir: string, area: string): Promise<void> {
    const workspace = showcaseE3Workspace(area);
    const zip = await fs.readFile(path.join(dir, `${area}.zip`));
    const { name, version } = await packageImport(e3.apiUrl, SHOWCASE_REPO, zip, options);
    await workspaceCreate(e3.apiUrl, SHOWCASE_REPO, workspace, options);
    await workspaceDeploy(e3.apiUrl, SHOWCASE_REPO, workspace, `${name}@${version}`, options);
    // A run in this process answers its polls at once, so they come often.
    const run = await dataflowExecute(e3.apiUrl, SHOWCASE_REPO, workspace, {}, options, { pollInterval: 100 });
    if (!run.success) {
        const failures = await runFailures(e3, workspace, options, run);
        throw new Error(`the area '${area}': its dataflow did not succeed${failures === "" ? "" : `: ${failures}`}`);
    }
    await fs.writeFile(path.join(dir, `${area}.beast2`), await workspaceBundle(e3.apiUrl, SHOWCASE_REPO, workspace, options));
}

const [dir, ...named] = process.argv.slice(2);
if (dir === undefined) throw new Error("usage: e3-showcase-bundles.ts <dir> [area…]");
const areas = named.length > 0
    ? named
    : (await fs.readdir(dir)).filter((file) => file.endsWith(".zip")).map((file) => file.slice(0, -".zip".length)).sort((a, b) => a.localeCompare(b));

const { port1, port2 } = new MessageChannel();
serveE3({ units: inProcessUnits(), width: 4, persist: false, pieceBytes: SHOWCASE_PIECE_TARGET }, port1);
const e3 = await createWebE3(port2);
try {
    const options: RequestOptions = { token: null, fetch: e3.fetch };
    await repoCreate(e3.apiUrl, SHOWCASE_REPO, options);
    for (const area of areas) await bundleArea(e3, options, dir, area);
} finally {
    e3.close();
}
