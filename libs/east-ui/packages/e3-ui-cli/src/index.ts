/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Programmatic API for `@elaraai/e3-ui-cli` — render east-ui / e3-ui components
 * to PNG without the CLI. The command-line entry lives in `cli.ts`.
 *
 * @packageDocumentation
 */

export { renderToPng, renderTaskToPng, defaultAppDir, type RenderToPngOptions, type RenderTaskOptions } from './render.js';
export {
    buildPayload, detectFormat,
    type ShotInput, type ShotPayload, type ComponentPayload, type TaskPayload, type InputFormat,
} from './payload.js';
export { capture, openCaptureSession, type CaptureSession, type SessionCaptureOptions, type CaptureOptions, type CaptureMode } from './capture.js';
export { sweep, isSweepableSource, outputStemFor, type SweepOptions, type SweepResult, type SweepRendered, type SweepSkipped, type SweepFailed } from './sweep.js';
export { classifyExport, classifyExports, detectContextFor, describeSkip, type DetectContext, type ExportClassification, type SkipReason } from './detect.js';
export { loadComponentFromSource, loadSourceExports, shapeOfExport, type ExportShape, type EastFunctionLike } from './load-source.js';
export { startRepoServer, type RepoServerHandle } from './e3-server.js';
export { launchBrowser, installBrowser, doctor, type BrowserSource } from './browser.js';
