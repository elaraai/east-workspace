// Bundles @elaraai/east-diagnostics' tsserver plugin entry into a single
// self-contained CommonJS file. tsserver loads plugins with require(), so the
// published artifact must be CJS regardless of the host's Node version — no
// runtime dependency on require(esm) support.
import { build } from "esbuild";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require_ = createRequire(join(root, "package.json"));

await build({
  entryPoints: [require_.resolve("@elaraai/east-diagnostics/tsserver-plugin")],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  external: ["typescript"],
  outfile: join(root, "dist", "index.cjs"),
  // tsserver requires the module and calls it directly as the plugin factory.
  footer: { js: "module.exports = module.exports.default;" },
});
console.log("built dist/index.cjs");
