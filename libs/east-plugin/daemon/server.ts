import { createServer, type Socket } from "node:net";
import { existsSync, unlinkSync } from "node:fs";
import { createDiagnosticsService } from "@elaraai/east-diagnostics";

// Resident East-diagnostics daemon: holds a warm LanguageService (via
// createDiagnosticsService) and answers per-file diagnose requests over a Unix
// socket. Spawned lazily by the PostToolUse client; exits after idle.
const socketPath = process.env["EAST_DIAG_SOCKET"];
if (socketPath === undefined) process.exit(1);

const service = createDiagnosticsService();
const IDLE_MS = 10 * 60 * 1000;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function armIdle(): void {
  if (idleTimer !== undefined) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    server.close();
    process.exit(0);
  }, IDLE_MS);
  idleTimer.unref();
}

const server = createServer((conn: Socket) => {
  armIdle();
  let buffer = "";
  conn.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    const newline = buffer.indexOf("\n");
    if (newline < 0) return;
    let response: string;
    try {
      const request = JSON.parse(buffer.slice(0, newline)) as { file?: unknown };
      const text = typeof request.file === "string" ? service.diagnoseText(request.file) : "";
      response = JSON.stringify({ ok: true, text });
    } catch (error) {
      response = JSON.stringify({ ok: false, error: String(error) });
    }
    conn.end(`${response}\n`);
  });
  conn.on("error", () => undefined);
});

if (existsSync(socketPath)) {
  try {
    unlinkSync(socketPath);
  } catch {
    /* ignore */
  }
}
server.on("error", () => process.exit(1));
server.listen(socketPath, () => {
  armIdle();
  // Pre-build the LanguageService for this workspace now — off the edit
  // critical path — so the first PostToolUse diagnose isn't a cold program load
  // that blows the client's budget and silently drops the review. The daemon is
  // spawned detached at SessionStart, so blocking here is fine; setImmediate
  // lets `listen` settle first.
  const cwd = process.env["EAST_DIAG_CWD"];
  if (cwd !== undefined && cwd !== "") {
    setImmediate(() => {
      try {
        service.warm(cwd);
      } catch {
        /* best-effort warm */
      }
    });
  }
});
