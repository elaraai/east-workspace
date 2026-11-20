/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0-or-later. See LICENSE for details.
 */

export { scaffold } from "./scaffold.js";
export type { Features, ProjectKind, ScaffoldOptions, ScaffoldResult } from "./scaffold.js";
export { deriveNames } from "./names.js";
export type { ProjectNames } from "./names.js";
export { runCreateCli } from "./cli.js";
export { updateStack } from "./update.js";
export type { UpdateOptions, UpdateResult, UpdatedDep } from "./update.js";
// create-e3's build reads the release's python pin files, and ships them in its template
export { RELEASE_PINS_FILE, parseReleasePins } from "./pins.js";
