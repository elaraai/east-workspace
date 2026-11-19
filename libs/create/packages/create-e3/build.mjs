import * as esbuild from "esbuild";
import { cpSync, rmSync, mkdirSync, chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { PINS_DIR, PINS_FILES } from "@elaraai/scaffold-core";
import { EAST_PY_PINS_DIR } from "../../../../scripts/set-python-version.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..");
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

// The release's python pins, which a scaffold writes into a python project's
// pyproject.toml and `--update` replaces: @elaraai/e3-core's copy, which the
// release's images install under, and which the version drift check holds to
// this package's version (scripts/check-version-drift.mjs).
mkdirSync(join(dest, PINS_DIR));
for (const name of Object.values(PINS_FILES)) cpSync(join(repoRoot, EAST_PY_PINS_DIR, name), join(dest, PINS_DIR, name));

console.log(`built create-${KIND}: dist/index.js + templates/${KIND} + the release's python pins`);
