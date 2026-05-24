import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPluginStatus, formatStatus } from "../lib/plugin-status.js";

// Runs from the plugin dir (built + bundled by the test script), so the
// plugin-global features should report OK; project-context features (East
// project / diagnostics prereqs) may be warn here and aren't asserted.
test("plugin status reports plugin-global features OK and never throws", async () => {
  const root = process.cwd();
  const checks = await checkPluginStatus(root, root);
  const byName = new Map(checks.map((c) => [c.name, c]));

  assert.equal(byName.get("Plugin")?.status, "ok");
  assert.equal(byName.get("Bundled artifacts")?.status, "ok");
  assert.equal(byName.get("Hooks registered")?.status, "ok");
  assert.equal(byName.get("Example search (index + MCP)")?.status, "ok");
  assert.equal(byName.get("Skills")?.status, "ok");

  const text = formatStatus(checks);
  assert.match(text, /East plugin status/);
  assert.match(text, /Bundled artifacts/);
  assert.match(text, /Diagnostics/);
});
