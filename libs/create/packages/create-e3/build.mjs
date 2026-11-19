import * as esbuild from "esbuild";
import { cpSync, rmSync, mkdirSync, chmodSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { RELEASE_PINS_FILE, parseReleasePins } from "@elaraai/scaffold-core";
import { EAST_PY_CONSTRAINTS, EAST_PY_OVERRIDES, EAST_PY_PINS_DIR, semverToPep440 } from "../../../../scripts/set-python-version.mjs";

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
// pyproject.toml and `--update` gives in place of an earlier release's. Read
// here, once, from @elaraai/e3-core's tier/, which the release's images
// install under, and held to this package's version: a change of the files'
// form, or pins of another release, fail this build and not a scaffold.
const tier = join(repoRoot, EAST_PY_PINS_DIR);
const pins = parseReleasePins({
  constraints: readFileSync(join(tier, EAST_PY_CONSTRAINTS), "utf8"),
  overrides: readFileSync(join(tier, EAST_PY_OVERRIDES), "utf8"),
});
const release = semverToPep440(JSON.parse(readFileSync(join(here, "package.json"), "utf8")).version);
if (pins.release !== release) throw new Error(`${EAST_PY_PINS_DIR}'s pins are of release ${pins.release}, and create-${KIND} is ${release}`);
writeFileSync(join(dest, RELEASE_PINS_FILE), `${JSON.stringify(pins, null, 2)}\n`);

console.log(`built create-${KIND}: dist/index.js + templates/${KIND} + release ${release}'s python pins`);
