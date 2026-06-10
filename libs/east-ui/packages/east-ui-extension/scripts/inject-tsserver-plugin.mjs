// Adds @elaraai/tsserver-plugin-east into the packaged vsix.
// vsce --no-dependencies unconditionally excludes node_modules (negations in
// .vscodeignore don't apply there), but tsserver can only resolve contributed
// plugins from <extension>/node_modules/<name> — so the built package is
// zipped in after packaging. In the dev workspace the pnpm symlink at
// node_modules/@elaraai/tsserver-plugin-east already satisfies the probe.
//
// The contribution uses the SAME name as the tsconfig `plugins` entry that
// scaffolded projects carry: tsserver skips a global plugin when a configured
// plugin with that name exists, so projects with the dep never double-report.
import { createRequire } from "node:module";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require_ = createRequire(join(root, "package.json"));

const entry = require_.resolve("@elaraai/tsserver-plugin-east"); // <pkg>/dist/index.cjs
const pkgDir = dirname(dirname(entry));
const version = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf-8")).version;

const vsix = readdirSync(root).find((f) => f.endsWith(".vsix"));
if (vsix === undefined) throw new Error("no .vsix found — run vsce package first");

const stage = mkdtempSync(join(tmpdir(), "east-tsserver-vsix-"));
const stageDir = join(stage, "extension", "node_modules", "@elaraai", "tsserver-plugin-east");
mkdirSync(join(stageDir, "dist"), { recursive: true });
copyFileSync(entry, join(stageDir, "dist", "index.cjs"));
writeFileSync(
  join(stageDir, "package.json"),
  `${JSON.stringify({ name: "@elaraai/tsserver-plugin-east", version, main: "dist/index.cjs" }, null, 2)}\n`,
);
execFileSync(
  "zip",
  [
    "-q",
    join(root, vsix),
    "extension/node_modules/@elaraai/tsserver-plugin-east/package.json",
    "extension/node_modules/@elaraai/tsserver-plugin-east/dist/index.cjs",
  ],
  { cwd: stage },
);
rmSync(stage, { recursive: true, force: true });
console.log(`injected @elaraai/tsserver-plugin-east@${version} into ${vsix}`);
