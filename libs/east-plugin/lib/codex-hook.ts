import { readFile } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { HookInput } from "./hook-io.js";
import { patchFiles, shellReadPaths, type PatchFile } from "./codex-tools.js";
import { writtenPaths } from "./bash-writes.js";
import { SEARCH_TOOLS, searchedInTranscript } from "./transcript.js";
import { GATE_TEXT, READ_TEXT, isExampleCorpusRead } from "./search-guidance.js";
import type { SearchHookReply } from "./search-hooks.js";

// The search-first hooks (#654), Codex's: one hook sees every tool — a patch,
// a shell command, a file read or write, an MCP call — so the gate, the read
// reminder and the record of a search seen are one function, configured by a
// plugin's own names as the Claude Code hooks are (lib/search-hooks.ts).

/** What a Codex tool call touches: the files it writes or reads, and the command or patch it runs. */
export interface CodexToolCall {
  /** The tool's name. */
  tool: string;
  /** The shell command or the patch, as the tool's input holds it. */
  command: string;
  /** Whether the tool runs a shell command. */
  shell: boolean;
  /** The files a patch adds, updates, moves or deletes. */
  patches: PatchFile[];
  /** The file a file tool names, resolved against the working directory. */
  filePath: string | undefined;
  /** Every file the call writes or reads, each once (a deleted file excluded). */
  paths: string[];
}

/**
 * What a Codex tool call touches.
 *
 * @param event - The hook's event
 * @returns The files, command and patch of the call
 */
export function codexToolCall(event: HookInput): CodexToolCall {
  const cwd = event.cwd || process.cwd();
  const input = event.tool_input ?? {};
  const command = typeof input.command === 'string' ? input.command : typeof input['cmd'] === 'string' ? input['cmd'] : '';
  const tool = event.tool_name ?? '';
  const patches = tool === 'apply_patch' ? patchFiles(command, cwd) : [];
  const shell = ['Bash', 'exec_command', 'shell_command'].includes(tool);
  const filePath = typeof input.file_path === 'string' ? resolve(cwd, input.file_path) : undefined;
  const paths = [...new Set([
    ...patches.filter(p => !p.deleted).map(p => p.path),
    ...(shell ? [...writtenPaths(command, cwd), ...shellReadPaths(command, cwd)] : []),
    ...(filePath ? [filePath] : []),
  ])];
  return { tool, command, shell, patches, filePath, paths };
}

/** The Codex search gate's configuration. */
export interface CodexSearchGateOptions {
  /** The tools whose call in a transcript counts as a search. */
  searchTools: readonly string[];
  /** Matches a search or fetch tool's MCP name, whatever server name Codex gives it. */
  searchToolName: RegExp;
  /** The instruction a write of corpus code with no search on record meets (`gateText(...)`). */
  gateText: string;
  /** The reminder a read of the corpus gets (`readText(...)`). */
  readText: string;
  /** Whether a file tool reaches for the corpus (`corpusReadFor(scope)`). */
  isCorpusRead(tool: string, input: Record<string, unknown>): boolean;
  /** Matches a shell command that reaches for the corpus. */
  shellSweep: RegExp;
  /** Matches the corpus's code in a file's text, before or after the write. */
  corpusCode: RegExp;
  /** The prefix of the per-session marker in the temporary directory that records a search seen. */
  markerPrefix: string;
  /** The environment variable that makes the gate refuse the write when it is `deny`. */
  requireSearchEnv: string;
}

/** East's Codex gate. */
export const EAST_CODEX_SEARCH_GATE: CodexSearchGateOptions = {
  searchTools: SEARCH_TOOLS,
  searchToolName: /__(?:search_east_examples|get_east_example)$/,
  gateText: GATE_TEXT,
  readText: READ_TEXT,
  isCorpusRead: isExampleCorpusRead,
  shellSweep: /node_modules\/@elaraai(?:\/|\b)|\.examples\.tsx?/,
  corpusCode: /@elaraai\/east|(?:from|import)\s+east\b/,
  markerPrefix: "east-codex-search-",
  requireSearchEnv: "EAST_REQUIRE_SEARCH",
};

/**
 * The search-first gate for a Codex tool call. After a successful search or
 * fetch it records the search (`"recorded"`) — the stable hook event, not the
 * transcript's undocumented wire format. Before a call, it reminds a read of
 * the corpus, and gives a write of corpus code with no search on record the
 * instruction to search first: a reminder, or a refusal when the options'
 * environment variable is `deny`.
 *
 * @param event - The hook's event
 * @param options - The gate's configuration
 * @param call - What the call touches, when the hook has read it already for
 *   its own use, so the patch or the command is parsed once
 * @returns The reply before a call, `"recorded"` after a search, else null
 */
export async function codexSearchGate(
  event: HookInput,
  options: CodexSearchGateOptions,
  call: CodexToolCall = codexToolCall(event),
): Promise<SearchHookReply | "recorded" | null> {
  const input = event.tool_input ?? {};
  const marker = join(tmpdir(), options.markerPrefix + createHash('sha256').update(event.session_id ?? '').digest('hex'));
  if (event.hook_event_name === 'PostToolUse') {
    if (call.tool.startsWith('mcp__') && options.searchToolName.test(call.tool)) {
      if (event.tool_response?.['isError'] !== true) writeFileSync(marker, 'searched');
      return 'recorded';
    }
    return null;
  }
  const context: string[] = [];
  if (options.isCorpusRead(call.tool, input) || (call.shell && options.shellSweep.test(call.command))) {
    context.push(options.readText);
  }
  const writes = call.tool === 'apply_patch' ? call.patches.filter(p => !p.deleted) :
    call.shell ? writtenPaths(call.command, event.cwd || process.cwd()).map(path => ({ path, originalPath: path, code: call.command })) :
    call.filePath && ['Edit', 'Write'].includes(call.tool) ? [{ path: call.filePath, originalPath: call.filePath, code: input.content ?? input.new_string ?? '' }] : [];
  let corpusWrite = false;
  for (const file of writes) {
    if (!/\.(tsx?|js|py)$/.test(file.path)) continue;
    let old = '';
    try { old = await readFile(file.originalPath, 'utf8'); } catch { /* new file */ }
    if (options.corpusCode.test(old + '\n' + file.code)) corpusWrite = true;
  }
  if (corpusWrite && !existsSync(marker) && !(event.transcript_path && await searchedInTranscript(event.transcript_path, options.searchTools))) {
    if (process.env[options.requireSearchEnv] === 'deny') return { decision: 'deny', text: options.gateText };
    context.push(options.gateText);
  }
  return context.length > 0 ? { decision: 'context', text: context.join('\n\n') } : null;
}
