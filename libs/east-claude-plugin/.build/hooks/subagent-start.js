// lib/hook-io.ts
async function readHookInput() {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  return JSON.parse(input);
}
function writeHookOutput(hookEventName, additionalContext) {
  const output = {
    hookSpecificOutput: {
      hookEventName,
      additionalContext
    }
  };
  process.stdout.write(JSON.stringify(output));
}

// lib/east-project.ts
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
var PACKAGE_SKILL_MAP = {
  "@elaraai/east": "east",
  "@elaraai/east-node-std": "east-node-std",
  "@elaraai/east-node-io": "east-node-io",
  "@elaraai/east-py-datascience": "east-py-datascience",
  "@elaraai/east-ui": "east-ui",
  "@elaraai/e3": "e3",
  "@elaraai/e3-ui": "e3-ui"
};
async function findPackageJson(startDir) {
  let dir = startDir;
  while (true) {
    try {
      const content = await readFile(join(dir, "package.json"), "utf-8");
      return JSON.parse(content);
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  }
}
function detectEastSkills(pkg) {
  if (!pkg) return [];
  const allDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies
  };
  const skills = [];
  for (const [packageName, skillName] of Object.entries(PACKAGE_SKILL_MAP)) {
    if (packageName in allDeps) {
      skills.push(skillName);
    }
  }
  return skills;
}
async function getEastProjectInfo(cwd) {
  const pkg = await findPackageJson(cwd);
  const skills = detectEastSkills(pkg);
  return { isEast: skills.length > 0, skills, pkg };
}

// lib/east-rules-context.ts
var EAST_RULES_CONTEXT = [
  "What the East linter checks \u2014 the editor language server, ESLint `east/east-rules`, and the preemptive `<east-code-review>` all run the SAME rule set, so author to these from the start. Inside an `East.function` / `$`-block, the code must be East all the way down:",
  "",
  "Host-vs-East (most common):",
  "- no-host-in-east-block \u2014 avoid host TypeScript inside a block (`a + b`, `cond ? a : b`, `a && b`, `arr[i]`, a JS `for`/`if` that builds IR, a TS helper/closure call, a `${x}` string template); use East instead: `a.add(b)`, `cond.ifElse(() => a, () => b)`, `a.and(() => b)`, `coll.get(i)`, `$.for(...)` / `data.map(($, x) => \u2026)`, `East.str`.",
  "- no-module-scope-east-macro \u2014 avoid a module-scope TS helper that returns East IR or a composite string key like `(o, l) => `${o}|${l}``; make a real `East.function`, or model typed / nested East data.",
  "- no-compile-time-data-injection \u2014 avoid reading data at module load (`node:fs`, `readFileSync`, `JSON.parse`, `process.env`); load at runtime via `e3.input` / datasets / a platform task.",
  "- no-compile-time-seed-data \u2014 avoid computing an `e3.input` seed in host code (a Map filled by loops, `{ a: num(cfg.x) }`); pass a small literal / empty default and parse real data at runtime (`blob.decodeCsv` in a task).",
  "",
  "Bindings & values:",
  "- no-let-const-in-expression \u2014 avoid burying `$.let`/`$.const` mid-expression (a struct-field value, call argument, array element); declare it on its own line and reuse the binding.",
  "- no-redundant-east-cast \u2014 avoid a cast / generic / wrapper the East type already governs: `$.let(x as T, T)`, `$.let(new Map<K, V>(), DictType(...))`, `$.let(East.value(x, T), T)`; drop it.",
  "- prefer-explicit-east-type \u2014 avoid an under-determined `$.let([])` / `$.let({})` / `$.let(new Map())`; give the East type, e.g. `$.let([], ArrayType(IntegerType))`.",
  "- no-untracked-east-data \u2014 avoid a bare JS literal in an East-typed slot inside a block; bind it with `$.const`/`$.let`.",
  "- no-reinlined-east-binding \u2014 avoid reusing an East `Expr` held in a JS `const` across a block (it re-inlines per use); bind it once with `$.let`/`$.const`.",
  "- no-unexecuted-east-expression \u2014 avoid a bare East expression statement; execute it with `$(expr)` or bind it.",
  "",
  "Variants, types, imports, UI:",
  '- prefer-some-none \u2014 avoid `variant("some", x)` / `variant("none", null)`; use `some(x)` / `none`.',
  '- no-handrolled-variant \u2014 avoid a hand-rolled `{ type: "x", value: v }`; use `variant("x", v)`.',
  "- no-east-namespaced-type \u2014 avoid `East.IntegerType`; import `IntegerType` and use it bare.",
  "- prefer-let-const-over-east-value \u2014 avoid `East.value(...)` inside a block; use `$.let`/`$.const`.",
  "- prefer-jsx-over-factory-call \u2014 in a `.tsx` file, avoid `Foo.Root(...)`; author the `<Foo>` tag.",
  "- no-relative-src-import \u2014 avoid importing another package via `../src` or `@elaraai/x/src`; use its published package name."
].join("\n");

// hooks/subagent-start.ts
async function main() {
  const event = await readHookInput();
  const cwd = event.cwd || process.cwd();
  const { isEast, skills } = await getEastProjectInfo(cwd);
  if (!isEast) process.exit(0);
  const skillList = skills.map((s) => `/east:${s}`).join(", ");
  const packageList = skills.map((s) => `@elaraai/${s}`).join(", ");
  const context = [
    `This is an East project using ${packageList}.`,
    "",
    "When working with East code:",
    "- The East example index is the best API reference: call the `mcp__plugin_east_east__search_east_examples` MCP tool to find idiomatic examples before writing or modifying East code.",
    "- Do NOT learn the API from `.d.ts` files in node_modules \u2014 their signatures omit East's idioms and constraints, so reasoning from them reliably produces broken code. Search the examples instead.",
    "- After you read or edit an East file, the plugin injects an `<east-code-review>` block (TypeScript errors + East idiom issues). Treat it as authoritative and fix what it flags; the rules are summarised below so you can write to them up front.",
    "- East is a statically typed, expression-based language embedded in TypeScript \u2014 it has unique patterns that differ from regular TypeScript.",
    `- Available skills: ${skillList}`,
    "",
    EAST_RULES_CONTEXT
  ].join("\n");
  writeHookOutput("SubagentStart", context);
}
main().catch(() => process.exit(0));
