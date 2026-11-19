/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The hold a rail gives its live row (#1673): while an editor of the row is
 * open — a filter's chip's, a new filter's — the row tells the rail engine,
 * which holds the cluster at the form and the chips it had as the editor
 * opened, as it holds it while the cluster's own editor is open
 * (`../../toolbar/rail/use-rail.ts`). An edit that applies as it is made
 * then never refolds the row under its popover.
 *
 * @packageDocumentation
 */

import { createContext } from "react";

/** Holds the cluster a row is drawn in while one of its editors is open (`true`), and lets that hold go (`false`); nothing outside a rail. */
export const SliceRailHold = createContext<(holding: boolean) => void>(() => undefined);
