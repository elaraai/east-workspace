import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { buildSearchIndex } from "./search.js";
import { getEastProjectInfo } from "./east-project.js";

export interface FeatureCheck {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

const ICON: Record<FeatureCheck["status"], string> = { ok: "✓", warn: "⚠", fail: "✗" };

function check(name: string, fn: () => FeatureCheck | Promise<FeatureCheck>): Promise<FeatureCheck> {
  return Promise.resolve()
    .then(fn)
    .catch((e) => ({ name, status: "fail" as const, detail: `check errored: ${String(e).slice(0, 100)}` }));
}

function resolves(fromDir: string, spec: string): string | undefined {
  try {
    // Absolute base so module resolution works even when given a relative cwd.
    return createRequire(resolve(fromDir, "_.js")).resolve(spec);
  } catch {
    return undefined;
  }
}

function nearestTsconfig(fromDir: string): string | undefined {
  let dir = resolve(fromDir);
  for (;;) {
    const candidate = join(dir, "tsconfig.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

const BUNDLED = [
  ".build/hooks/session-start.js",
  ".build/hooks/prompt-submit.js",
  ".build/hooks/subagent-start.js",
  ".build/hooks/pre-agent.js",
  ".build/hooks/pre-write.js",
  ".build/hooks/diagnose.js",
  ".build/daemon/server.js",
  ".build/mcp/server.js",
];

/** Inspect the installed plugin + the current project; never throws. */
export async function checkPluginStatus(pluginRoot: string, cwd: string): Promise<FeatureCheck[]> {
  const checks: FeatureCheck[] = [];

  checks.push(await check("Plugin", () => {
    const pkg = JSON.parse(readFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8")) as { version?: string };
    return { name: "Plugin", status: "ok", detail: `version ${pkg.version ?? "?"} (${pluginRoot})` };
  }));

  checks.push(await check("Bundled artifacts", () => {
    const missing = BUNDLED.filter((a) => !existsSync(join(pluginRoot, a)));
    return missing.length === 0
      ? { name: "Bundled artifacts", status: "ok", detail: `all ${BUNDLED.length} hook/daemon/MCP bundles present` }
      : { name: "Bundled artifacts", status: "fail", detail: `missing ${missing.length}: ${missing.join(", ")}` };
  }));

  checks.push(await check("Hooks registered", () => {
    const json = JSON.parse(readFileSync(join(pluginRoot, "hooks", "hooks.json"), "utf8")) as { hooks?: Record<string, unknown> };
    const events = Object.keys(json.hooks ?? {});
    const diagnoseWired = JSON.stringify(json.hooks ?? {}).includes("diagnose.js");
    return {
      name: "Hooks registered",
      status: diagnoseWired ? "ok" : "warn",
      detail: diagnoseWired
        ? `${events.length} events: ${events.join(", ")}`
        : `${events.join(", ")} — PostToolUse is NOT wired to diagnose.js (stale install?)`,
    };
  }));

  checks.push(await check("Example search", async () => {
    const indexPath = join(pluginRoot, "index.json");
    const data = JSON.parse(readFileSync(indexPath, "utf8")) as { entries?: unknown[] };
    const count = data.entries?.length ?? 0;
    const index = await buildSearchIndex(indexPath);
    const hits = index.search("array map", { limit: 3 } as Parameters<typeof index.search>[1]);
    return {
      name: "Example search (index + MCP)",
      status: count > 0 && hits.length > 0 ? "ok" : "warn",
      detail: `${count} examples indexed; sample query → ${hits.length} hits`,
    };
  }));

  checks.push(await check("Skills", () => {
    const dirs = readdirSync(join(pluginRoot, "skills"), { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(pluginRoot, "skills", d.name, "SKILL.md")))
      .map((d) => d.name);
    return { name: "Skills", status: dirs.length > 0 ? "ok" : "warn", detail: `${dirs.length}: ${dirs.join(", ")}` };
  }));

  checks.push(await check("East project (cwd)", async () => {
    const { isEast, skills } = await getEastProjectInfo(cwd);
    return {
      name: "East project (cwd)",
      status: isEast ? "ok" : "warn",
      detail: isEast ? `detected: ${skills.join(", ")}` : `${cwd} is not an East project — hooks stay idle here (expected outside East projects)`,
    };
  }));

  checks.push(await check("Diagnostics (PostToolUse daemon)", () => {
    const parts: string[] = [];
    let status: FeatureCheck["status"] = "ok";
    const tsOk = resolves(cwd, "typescript") !== undefined;
    parts.push(tsOk ? "typescript resolvable" : "typescript NOT resolvable");
    if (!tsOk) status = "warn";
    const tsconfig = nearestTsconfig(cwd) !== undefined;
    parts.push(tsconfig ? "tsconfig found" : "no tsconfig near cwd");
    if (!tsconfig) status = "warn";
    const eastOk = resolves(cwd, "@elaraai/east") !== undefined;
    parts.push(eastOk ? "@elaraai/east resolvable (built)" : "@elaraai/east not resolvable/built");
    const daemonOk = existsSync(join(pluginRoot, ".build/daemon/server.js"));
    if (!daemonOk) { parts.push("daemon bundle MISSING"); status = "fail"; }
    return {
      name: "Diagnostics (PostToolUse daemon)",
      status,
      detail: `${parts.join("; ")} — ${status === "ok" ? "ready" : status === "fail" ? "broken" : "limited (prereqs missing)"}`,
    };
  }));

  return checks;
}

export function formatStatus(checks: FeatureCheck[]): string {
  const anyFail = checks.some((c) => c.status === "fail");
  const anyWarn = checks.some((c) => c.status === "warn");
  const header = anyFail ? "East plugin status — ISSUES" : anyWarn ? "East plugin status — OK (with notes)" : "East plugin status — OK";
  const lines = checks.map((c) => `- ${ICON[c.status]} **${c.name}**: ${c.detail}`);
  return [`## ${header}`, "", ...lines].join("\n");
}
