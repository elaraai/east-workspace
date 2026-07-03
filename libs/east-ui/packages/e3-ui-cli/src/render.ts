/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Programmatic entry point: normalise an input into a payload and capture it to
 * a PNG. The CLI's `shot` command is a thin wrapper over {@link renderToPng}.
 *
 * @packageDocumentation
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPayload, type ShotInput, type TaskPayload } from './payload.js';
import { capture, type CaptureMode } from './capture.js';
import { startRepoServer } from './e3-server.js';

/** Options for {@link renderToPng}. */
export interface RenderToPngOptions {
    /** The component input (source/serialized + format/export). */
    input: ShotInput;
    /** Output PNG path. */
    output: string;
    /** Also write a self-contained HTML here. */
    html?: string | undefined;
    /** Override the prebuilt app directory (defaults to the shipped `dist/app`). */
    appDir?: string | undefined;
    /** Chromium viewport. */
    viewport?: { width: number; height: number } | undefined;
    /** Device scale factor. */
    deviceScaleFactor?: number | undefined;
    /** Framing. */
    mode?: CaptureMode | undefined;
    /** Settle time after skeletons clear. */
    settleMs?: number | undefined;
    /** Max time to wait for the render to complete. */
    timeoutMs?: number | undefined;
    /** Storage key prefix for persisted component state. */
    storageKey?: string | undefined;
    /** Component-frame mount width ('full' or a CSS width) — see CaptureOptions. */
    frameWidth?: string | undefined;
}

/** Resolve the shipped prebuilt app directory (`dist/app`, sibling of this module). */
export function defaultAppDir(): string {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(here, 'app');
}

/**
 * Render a component input to a PNG (and optionally a standalone HTML).
 *
 * @param opts - Render options
 * @throws If the input cannot be decoded, or the component fails to render
 */
export async function renderToPng(opts: RenderToPngOptions): Promise<void> {
    const payload = await buildPayload(opts.input);
    await capture({
        appDir: opts.appDir ?? defaultAppDir(),
        payload,
        outPng: opts.output,
        outHtml: opts.html,
        storageKey: opts.storageKey,
        viewport: opts.viewport,
        deviceScaleFactor: opts.deviceScaleFactor,
        mode: opts.mode,
        frameWidth: opts.frameWidth,
        settleMs: opts.settleMs,
        timeoutMs: opts.timeoutMs,
    });
}

/** Options for {@link renderTaskToPng}. */
export interface RenderTaskOptions {
    /** Local e3 repository directory. */
    repo: string;
    /** Workspace name. */
    workspace: string;
    /** Task name within the workspace. */
    task: string;
    /** Output PNG path. */
    output: string;
    /** Also write a self-contained HTML here. */
    html?: string | undefined;
    /** Override the prebuilt app directory. */
    appDir?: string | undefined;
    /** Chromium viewport. */
    viewport?: { width: number; height: number } | undefined;
    /** Device scale factor. */
    deviceScaleFactor?: number | undefined;
    /** Framing. */
    mode?: CaptureMode | undefined;
    /** Settle time (defaults higher than component mode — the task must fetch). */
    settleMs?: number | undefined;
    /** Max time to wait for the task to render (drives the in-app hard-stop too). */
    timeoutMs?: number | undefined;
}

/**
 * Render a LIVE e3 task's output to a PNG. Starts a local e3 API server over
 * the repo, lets the browser app fetch the already-computed task output + bound
 * datasets, screenshots, and stops the server. The workspace dataflow must have
 * already produced the task's output.
 *
 * @param opts - Render options
 * @throws If the server cannot start, the task fails to render, or capture times out
 */
export async function renderTaskToPng(opts: RenderTaskOptions): Promise<void> {
    const server = await startRepoServer(opts.repo);
    try {
        const payload: TaskPayload = {
            kind: 'task',
            apiUrl: server.apiUrl,
            repo: server.repo,
            workspace: opts.workspace,
            task: opts.task,
        };
        await capture({
            appDir: opts.appDir ?? defaultAppDir(),
            payload,
            outPng: opts.output,
            outHtml: opts.html,
            viewport: opts.viewport,
            deviceScaleFactor: opts.deviceScaleFactor,
            mode: opts.mode,
            // Extra grace after the app reports ready (the task render settles
            // its own async fetches first via the data-shot-status marker).
            settleMs: opts.settleMs ?? 800,
            timeoutMs: opts.timeoutMs,
        });
    } finally {
        await server.stop();
    }
}
