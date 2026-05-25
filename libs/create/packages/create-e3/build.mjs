import * as esbuild from "esbuild";
import { cpSync, rmSync, mkdirSync, chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const KIND = "e3";

rmSync(join(here, "dist"), { recursive: true, force: true });
mkdirSync(join(here, "dist"), { recursive: true });

await esbuild.build({
  entryPoints: [join(here, "src/index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: join(here, "dist/index.js"),
  banner: { js: "#!/usr/bin/env node" },
});
chmodSync(join(here, "dist/index.js"), 0o755);

// Copy the template tree into the published package (shipped as plain data).
const src = join(here, "..", "..", "templates", KIND);
const dest = join(here, "templates", KIND);
rmSync(join(here, "templates"), { recursive: true, force: true });
cpSync(src, dest, { recursive: true });

console.log(`built create-${KIND}: dist/index.js + templates/${KIND}`);
