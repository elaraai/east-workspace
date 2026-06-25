/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The render payload injected into the browser app as `window.__E3_UI_SHOT__`.
 *
 * This module has NO runtime imports so it can be shared by both the Node CLI
 * (`payload.ts`) and the browser app (`app/main.tsx`) — keeping the Node→browser
 * contract type-checked rather than duplicated.
 *
 * @packageDocumentation
 */

/** A standalone component to render: base64 Beast2-encoded function IR
 *  (consumed in-browser by `EncodedEastFunction`). */
export interface ComponentPayload {
    kind: 'component';
    b64: string;
}

/** A live e3 task to render: the browser fetches its already-computed output +
 *  bound datasets from the server (consumed by `TaskPreview`). */
export interface TaskPayload {
    kind: 'task';
    apiUrl: string;
    repo: string;
    workspace: string;
    task: string;
}

/** The render payload — a component or a live task. */
export type ShotPayload = ComponentPayload | TaskPayload;
