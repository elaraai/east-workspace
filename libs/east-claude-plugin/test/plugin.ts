import { resolve } from "node:path";

// The plugin as it ships: the directory `npm run package` assembles from this
// package's bundles, the shared skills catalog and the index (#1309). The
// tests run the bundles there, so what they prove is what a host installs.
export const PLUGIN_ROOT: string = resolve(process.cwd(), "..", "east-plugin", "marketplace", "east-claude-plugin");
