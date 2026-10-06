import { fileURLToPath } from "node:url";

// East's own example index as the published package ships it: `index.json` at
// the package root, two directories above this module's `dist/lib/`. A plugin
// that builds on East's serves it beside its own corpus (`loadIndexes`), or
// copies it into its bundle at build time, as East's plugins do — a bundled
// module no longer sits where this path is reckoned from.

/** The path of East's `index.json` in the installed `@elaraai/east-plugin`. */
export const EAST_INDEX_PATH: string = fileURLToPath(new URL("../../index.json", import.meta.url));
