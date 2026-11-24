/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Writes the Access database the Access tests read
 * (`test/sql/fixtures/actors.mdb`) from what `test/sql/access-actors.ts` says
 * it holds, with `test/sql/access-writer.ts`. Run it from this package's
 * directory after changing either: `pnpm run test:fixtures`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ACTORS_PATH, actorsDatabase } from "../test/sql/access-actors.js";

mkdirSync(dirname(ACTORS_PATH), { recursive: true });
writeFileSync(ACTORS_PATH, actorsDatabase());
console.log(`Wrote ${ACTORS_PATH}`);
