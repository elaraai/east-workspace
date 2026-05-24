import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkPluginStatus, formatStatus } from "../lib/plugin-status.js";

// Bundled to .build/status/report.js → the plugin root is two dirs up.
const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cwd = resolve(process.argv[2] ?? process.cwd());

const checks = await checkPluginStatus(pluginRoot, cwd);
console.log(formatStatus(checks));
