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
var PYTHON_SKILL_MAP = [
  [/elaraai-east-py-datascience(?![\w-])/, "east-py-datascience"],
  [/elaraai-east-py-std(?![\w-])/, "east-py-std"],
  [/elaraai-east-py-io(?![\w-])/, "east-py-io"],
  [/elaraai-east-py(?![\w-])/, "east-py"]
];
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
async function findPyProject(startDir) {
  let dir = startDir;
  while (true) {
    try {
      return await readFile(join(dir, "pyproject.toml"), "utf-8");
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
function detectPythonSkills(pyproject) {
  if (pyproject === null) return [];
  const skills = [];
  for (const [pattern, skill] of PYTHON_SKILL_MAP) {
    if (pattern.test(pyproject)) skills.push(skill);
  }
  return skills;
}
async function getEastProjectInfo(cwd) {
  const pkg = await findPackageJson(cwd);
  const tsSkills = detectEastSkills(pkg);
  const pySkills = detectPythonSkills(await findPyProject(cwd));
  const languages = [];
  if (tsSkills.length > 0) languages.push("typescript");
  if (pySkills.length > 0) languages.push("python");
  const skills = [...tsSkills, ...pySkills.filter((s) => !tsSkills.includes(s))];
  return { isEast: skills.length > 0, skills, languages, pkg };
}

// lib/diagnostics-client.ts
import { createConnection } from "node:net";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { existsSync, unlinkSync } from "node:fs";
import { dirname as dirname2, join as join2, resolve } from "node:path";
import { fileURLToPath } from "node:url";
function daemonSocket() {
  const hash = createHash("sha1").update(daemonEntry()).digest("hex").slice(0, 16);
  return join2(tmpdir(), `east-diag-${hash}.sock`);
}
function daemonEntry() {
  return resolve(dirname2(fileURLToPath(import.meta.url)), "..", "daemon", "server.js");
}
function spawnDaemon(socketPath, workspace) {
  const entry = daemonEntry();
  if (!existsSync(entry)) return;
  try {
    spawn(process.execPath, [entry], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, EAST_DIAG_SOCKET: socketPath, EAST_DIAG_CWD: workspace }
    }).unref();
  } catch {
  }
}
function warmDaemon(workspace) {
  const socketPath = daemonSocket();
  const conn = createConnection(socketPath);
  conn.on("connect", () => conn.destroy());
  conn.on("error", (err) => {
    conn.destroy();
    if (err.code === "ECONNREFUSED" || err.code === "ENOENT") {
      if (existsSync(socketPath)) {
        try {
          unlinkSync(socketPath);
        } catch {
        }
      }
      spawnDaemon(socketPath, workspace);
    }
  });
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
var EAST_RULES_CONTEXT_PY = [
  "What the East python linter checks \u2014 `east-py lint`, the flake8 `EAS` codes and the language server all run the SAME rules, so author to these from the start. Inside an `East.function` body the code must be East all the way down, and most of these are BUILD-TIME REFUSALS said early, not style notes:",
  "",
  "Body shape (the strict surface):",
  "- body-takes-block-first \u2014 every body takes the block first: `lambda b, x: \u2026` / `def f(b, x)`, never `lambda x: \u2026`; the block is for statements, so `b.price` is not a field read.",
  "- no-statement-on-outer-block \u2014 inside a nested body use THAT body's block: `lambda b: b.assign(...)`, not `lambda _b: b.assign(...)` reaching outward.",
  "- no-discarded-expression \u2014 a bare expression statement is built and thrown away; append it with `b.do(...)` or return it.",
  "",
  "Python that cannot be traced (the build refuses these):",
  "- no-python-boolean \u2014 avoid `and` / `or` / `not` / `if` / `in` / `len()` / iteration / `int()` / `float()` over an expression; use `&`, `|`, `~`, `b.if_(...)` / `East.if_else(...)`, and the expression's own methods.",
  "- no-python-formatting \u2014 avoid f-strings / `str()` / `format()` / `%` over an expression; build strings with `+`, or `East.String.print(T, value)`.",
  "- no-operator-fork \u2014 avoid `//`, `%`, `**` and `a[-1]` on an expression; call `East.Integer.divide` / `remainder` / `pow`, and spell the element you mean.",
  "- no-python-round \u2014 avoid `round(x)` (ties-to-even); call `East.Float.round_half` / `round_floor` / `round_ceil` / `round_trunc`.",
  "- no-python-work \u2014 avoid an eager callback reaching for a module, an installed package, or a python `def` doing work; express it in East.",
  "- no-deprecated-alias \u2014 use the canonical spelling (e.g. `.reduce()`, not `.fold()`).",
  "",
  "Bindings & values:",
  "- no-let-const-in-expression \u2014 give `b.let` / `b.const` its own statement; don't bury a declaration inside an expression.",
  "- prefer-explicit-east-type \u2014 avoid `b.let([])` / `b.let({})`; pass the East type, e.g. `b.let([], ArrayType(IntegerType))`.",
  "- no-untracked-east-data \u2014 avoid a plain python literal local reaching an expression's method; bind it with `b.const(rows, Type)`.",
  "- no-reinlined-east-binding \u2014 an expression held in a python local and used twice is re-inlined and re-evaluated; bind it once with `b.let` / `b.const`.",
  "- no-redundant-east-cast \u2014 avoid `b.let(East.value(x, T), T)`; pass the value and type to `b.let` directly.",
  "- prefer-let-const-over-east-value \u2014 inside a body declare with `b.const(value, Type)` / `b.let`, not `East.value(...)`.",
  "",
  "Variants & comparison:",
  '- prefer-some-none \u2014 avoid `variant("some", x)` / `variant("none", None)`; use `some(x)` / `none`.',
  '- no-handrolled-variant \u2014 avoid a `{"type": \u2026, "value": \u2026}` dict; use `variant("Tag", value, Type)` \u2014 the encoder needs what it constructs.',
  "- no-host-comparison-on-east-values \u2014 outside a body, avoid `==` / `<` on a decoded variant or option; use `equal_for(T)` / `compare_for(T)` (and `make_east_key(T)` for `sorted`).",
  "",
  "Build time vs runtime (python computing what East should declare):",
  "- no-build-time-clock \u2014 avoid `datetime.now()` / `time.time()` at module scope; author the constant, or read the clock inside a platform function.",
  "- no-compile-time-data-injection \u2014 avoid `open()` / `json.load` / `os.environ` at module import; load at runtime (an e3 input, a dataset, a platform function).",
  '- no-inline-credentials \u2014 avoid a literal password / token; `East.Env.get("YOUR_VAR")`, since IR is content-addressed and replicated.',
  '- no-module-scope-east-macro \u2014 avoid a module-scope helper that builds IR for a body, or a composite `f"{a}|{b}"` key; make it an `East.function`, or model typed / nested East data.',
  "- no-python-east-data \u2014 avoid assembling East rows with a module-scope comprehension or loop; write them out, or produce them at runtime.",
  "- no-python-string-building \u2014 avoid an f-string assembling an East string constant (a regex, a template, a key); spell the constant out.",
  "- no-derived-struct-fields \u2014 avoid declaring a type from another type's fields; a declaration is a wire format, so spell the fields.",
  "- no-python-data-work \u2014 avoid a python helper doing the parse / strip / null-check / coerce work for a body; express it in East."
].join("\n");
function eastRulesContextFor(languages) {
  const python = languages.includes("python");
  const typescript = languages.includes("typescript") || !python;
  const parts = [];
  if (typescript) parts.push(EAST_RULES_CONTEXT);
  if (python) parts.push(EAST_RULES_CONTEXT_PY);
  return parts.join("\n\n");
}

// hooks/session-start.ts
async function main() {
  const event = await readHookInput();
  const cwd = event.cwd || process.cwd();
  const { isEast, skills, languages } = await getEastProjectInfo(cwd);
  if (!isEast) process.exit(0);
  warmDaemon(cwd);
  const skillList = skills.map((s) => `/east:${s}`).join(", ");
  const context = [
    "This is an East project. East is a statically typed, expression-based language embedded in TypeScript \u2014 its patterns differ from regular TypeScript, so don't assume TS idioms carry over.",
    "",
    'East + e3 solutions are decision-oriented: they exist to improve a business decision and show the evidence behind it ("decisions, not dashboards"). The platform is a stack \u2014 an economic ontology (the typed model of the business) at the hub, an Integrate / Reason / Compute engine beneath it, and UI / agent / API surfaces above. Design top-down from the decision.',
    "",
    `Available East skills: ${skillList}. Invoke the relevant skill when writing East programs \u2014 they provide type-safe API patterns and examples. Each skill ends with a "Related skills" list; load those too when a task spans layers.`,
    "Always available regardless of dependencies: /east:east-design (architect a solution before coding), /east:east-ontology (model the business as an economic ontology), /east:east-project (scaffold + run the build/deploy lifecycle).",
    "",
    "Finding East API usage (required):",
    '- Before writing or changing East code, search the tested example index: call `mcp__plugin_east_east__search_east_examples` for each capability you are about to use (language: "python" for east-py, "typescript" otherwise) \u2014 summaries come back first \u2014 then `mcp__plugin_east_east__get_east_example` for the one that matches, and pattern your code on it. Nothing is injected for you; the search is the step, and every East skill requires it.',
    "- Do NOT read `node_modules/@elaraai/**` or `*.examples.ts` files wholesale, and do not reason from `.d.ts` signatures: the index holds the same programs, exact and far cheaper, printed in either language from their IR. The signatures omit the runtime rules that make East code correct.",
    "",
    "Preemptive diagnostics:",
    "- After you read or edit an East file, the plugin injects an `<east-code-review>` block listing TypeScript errors and East-specific idiom issues. Treat it as authoritative and fix what it flags \u2014 it's preemptive, so resolving it now avoids build-and-retry loops later. The rules it enforces are summarised below; write to them up front.",
    "",
    eastRulesContextFor(languages)
  ].join("\n");
  writeHookOutput("SessionStart", context);
}
main().catch(() => process.exit(0));
