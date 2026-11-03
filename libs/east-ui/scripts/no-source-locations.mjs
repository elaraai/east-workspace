/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * CI's IR specs build their East functions with no source locations:
 * `node --import` this from a package that depends on `@elaraai/east`.
 *
 * Every East expression reads a stack as it is built and parses it to the
 * author's frames (`libs/east/src/location.ts`), which a profile of these specs
 * puts at some two thirds of a spec's time. The specs hold what an expression
 * builds and refuses, never where it was written: East's own `location.spec.ts`
 * holds that. This loads East once for the process, so a spec's import finds it
 * with capture off.
 */

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(pathToFileURL(`${process.cwd()}/package.json`));
const { setLocationCapture } = await import(pathToFileURL(require.resolve("@elaraai/east")).href);
setLocationCapture(false);
