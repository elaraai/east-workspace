import { createConnection } from "node:net";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { existsSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type RequestResult =
  | { kind: "text"; text: string }
  | { kind: "refused" }
  | { kind: "timeout" }
  | { kind: "error" };

// One resident daemon per installed plugin version, keyed on the bundled daemon
// path (which lives under the versioned plugin cache dir) — NOT the workspace.
// It serves every project: createDiagnosticsService caches a LanguageService per
// tsconfig, so each project cold-loads once and then stays warm. This avoids
// per-directory daemon churn, and a new plugin version spawns a fresh daemon
// instead of reusing a stale one.
function daemonSocket(): string {
  const hash = createHash("sha1").update(daemonEntry()).digest("hex").slice(0, 16);
  return join(tmpdir(), `east-diag-${hash}.sock`);
}

// Inlined by esbuild into .build/hooks/diagnose.js, so import.meta.url is that
// path: .build/hooks → up one to .build, then daemon/server.js.
function daemonEntry(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "daemon", "server.js");
}

function tryRequest(socketPath: string, file: string, timeoutMs: number): Promise<RequestResult> {
  return new Promise((resolveResult) => {
    const conn = createConnection(socketPath);
    let buffer = "";
    let settled = false;
    const settle = (result: RequestResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      conn.destroy();
      resolveResult(result);
    };
    const timer = setTimeout(() => settle({ kind: "timeout" }), timeoutMs);
    timer.unref();

    conn.on("connect", () => conn.write(`${JSON.stringify({ file })}\n`));
    conn.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try {
        const response = JSON.parse(buffer.slice(0, newline)) as { ok?: boolean; text?: string };
        settle(response.ok === true ? { kind: "text", text: response.text ?? "" } : { kind: "error" });
      } catch {
        settle({ kind: "error" });
      }
    });
    conn.on("error", (err: NodeJS.ErrnoException) => {
      settle(err.code === "ECONNREFUSED" || err.code === "ENOENT" ? { kind: "refused" } : { kind: "error" });
    });
  });
}

function spawnDaemon(socketPath: string, workspace: string): void {
  const entry = daemonEntry();
  if (!existsSync(entry)) return;
  try {
    spawn(process.execPath, [entry], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, EAST_DIAG_SOCKET: socketPath, EAST_DIAG_CWD: workspace },
    }).unref();
  } catch {
    /* ignore */
  }
}

/** Fire-and-forget: ensure a daemon is running for this workspace so the first
 * edit doesn't pay process-spawn latency. Probes the socket and only spawns if
 * nothing is listening (so a live daemon is never disrupted). */
export function warmDaemon(workspace: string): void {
  const socketPath = daemonSocket();
  const conn = createConnection(socketPath);
  conn.on("connect", () => conn.destroy());
  conn.on("error", (err: NodeJS.ErrnoException) => {
    conn.destroy();
    if (err.code === "ECONNREFUSED" || err.code === "ENOENT") {
      if (existsSync(socketPath)) {
        try {
          unlinkSync(socketPath);
        } catch {
          /* ignore */
        }
      }
      spawnDaemon(socketPath, workspace);
    }
  });
}

/** Get the `<east-code-review>` text for `file` from the daemon (lazily
 * spawning it if absent). Returns `""` when clean and `null` when the daemon
 * could not be reached within `budgetMs` — callers degrade to a silent no-op. */
export async function getDiagnosticsText(
  workspace: string,
  file: string,
  budgetMs = 4000,
): Promise<string | null> {
  const socketPath = daemonSocket();
  const deadline = Date.now() + budgetMs;
  let spawned = false;

  while (Date.now() < deadline) {
    const attempt = await tryRequest(socketPath, file, Math.min(1500, deadline - Date.now()));
    if (attempt.kind === "text") return attempt.text;
    if (attempt.kind === "refused" && !spawned) {
      // No live daemon: clear any stale socket file, then spawn one.
      if (existsSync(socketPath)) {
        try {
          unlinkSync(socketPath);
        } catch {
          /* ignore */
        }
      }
      spawnDaemon(socketPath, workspace);
      spawned = true;
    }
    // refused-after-spawn (still starting) or timeout (warming): wait and retry.
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}
