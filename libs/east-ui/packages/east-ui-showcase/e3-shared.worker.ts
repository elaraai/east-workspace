/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The showcase's e3 worker for a page that shares its e3 with other tabs
 * (`?shared`, `showcase-config.ts`): `e3.worker.ts`'s e3, its repositories
 * kept in the browser — IndexedDB, OPFS and Web Locks, which e3-web keeps for
 * any number of tabs at once — so every tab of the showcase opened so reads
 * and writes the same ones, as two people would.
 *
 * @packageDocumentation
 */
import { serveE3 } from "@elaraai/e3-web/worker";
import { SHOWCASE_PIECE_TARGET } from "./showcase-pieces";

serveE3({
    units: () => new Worker(new URL("./unit.worker.ts", import.meta.url), { type: "module" }),
    width: 4,
    persist: true,
    name: "showcase-shared",
    pieceBytes: SHOWCASE_PIECE_TARGET,
});
