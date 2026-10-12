import { readFile } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PYTHON_EAST_IMPORT } from "@elaraai/east-diagnostics";
import { readHookInput, writeHookDecision, writeHookOutput, type HookInput } from "./hook-io.js";
import { getEastProjectInfo } from "./east-project.js";
import { SEARCH_TOOLS, searchedInTranscript } from "./transcript.js";
import { GATE_TEXT, READ_TEXT, isExampleCorpusRead } from "./search-guidance.js";

// The search-first hooks (#654), Claude Code's: the gate a write of corpus
// code meets when no example search is on record, and the reminder a read of
// the corpus gets. Each is configured by a plugin's own names and its own idea
// of what its code is, so a plugin that builds on East's runs the same hooks
// over its corpus. East's hooks are these, configured with East's.

/** What a search-first hook answers: context given to the agent, or the call refused with its reason. */
export interface SearchHookReply {
  decision: "context" | "deny";
  text: string;
}

/** The pre-write gate's configuration. */
export interface SearchGateOptions {
  /** The tools whose call counts as a search: the plugin's own and, with the East plugin beside it, East's. */
  searchTools: readonly string[];
  /** The instruction the gate gives (`gateText(...)`). */
  gateText: string;
  /** Whether a file's code is the corpus's: it imports the corpus's packages. */
  isCorpusCode(code: string, python: boolean): boolean;
  /** Whether the project at `cwd` is one the gate applies in; every project when absent. */
  isProject?(cwd: string, python: boolean): Promise<boolean>;
  /** The prefix of the per-session marker in the temporary directory that remembers a search seen. */
  markerPrefix: string;
  /** The environment variable that makes the gate refuse the write when it is `deny`. */
  requireSearchEnv: string;
}

/** East's gate. */
export const EAST_SEARCH_GATE: SearchGateOptions = {
  searchTools: SEARCH_TOOLS,
  gateText: GATE_TEXT,
  isCorpusCode: (code, python) => (python ? PYTHON_EAST_IMPORT : /@elaraai\/east/).test(code),
  isProject: async (cwd, python) => python || (await getEastProjectInfo(cwd)).isEast,
  markerPrefix: "east-search-seen",
  requireSearchEnv: "EAST_REQUIRE_SEARCH",
};

/**
 * The pre-write gate's answer to an Edit or Write: the instruction to search
 * first when it writes corpus code and no search is on record, else nothing. A
 * reminder, or a refusal when the options' environment variable is `deny`.
 * Once a search is seen, a per-session marker keeps every later write silent,
 * so a long transcript is read at most once.
 *
 * @param event - The PreToolUse event
 * @param options - The gate's configuration
 * @returns The reply, or null when the write passes
 */
export async function preWriteGate(event: HookInput, options: SearchGateOptions): Promise<SearchHookReply | null> {
  const cwd = event.cwd || process.cwd();
  const filePath = event.tool_input?.file_path;
  if (!filePath) return null;

  const python = filePath.endsWith(".py");
  if (!python && !filePath.endsWith(".ts") && !filePath.endsWith(".tsx") && !filePath.endsWith(".js")) return null;

  // Is this the corpus's code? A Write carries its content; an Edit only its
  // diff, so the file on disk (or the new text) says what it is.
  let code = "";
  if (event.tool_name === "Write") {
    code = event.tool_input?.content ?? "";
  } else if (event.tool_name === "Edit") {
    try {
      code = await readFile(filePath, "utf-8");
    } catch {
      code = event.tool_input?.new_string ?? "";
    }
  }
  if (!options.isCorpusCode(code, python)) return null;
  if (options.isProject !== undefined && !(await options.isProject(cwd, python))) return null;

  const marker = join(tmpdir(), `${options.markerPrefix}-${event.session_id}`);
  if (existsSync(marker)) return null;
  if (event.transcript_path && (await searchedInTranscript(event.transcript_path, options.searchTools))) {
    try {
      writeFileSync(marker, options.searchTools.join("\n"));
    } catch {
      /* best-effort */
    }
    return null;
  }

  return { decision: process.env[options.requireSearchEnv] === "deny" ? "deny" : "context", text: options.gateText };
}

/** The read reminder's configuration. */
export interface ReadReminderOptions {
  /** The reminder (`readText(...)`). */
  readText: string;
  /** Whether a Read, Grep or Glob reaches for the corpus (`corpusReadFor(scope)`). */
  isCorpusRead(tool: string, input: Record<string, unknown>): boolean;
}

/** East's reminder. */
export const EAST_READ_REMINDER: ReadReminderOptions = { readText: READ_TEXT, isCorpusRead: isExampleCorpusRead };

/**
 * The read reminder's answer to a Read, Grep or Glob: the reminder when it
 * reaches for the corpus, else nothing. Never a refusal.
 *
 * @param event - The PreToolUse event
 * @param options - The reminder's configuration
 * @returns The reply, or null
 */
export function preReadReminder(event: HookInput, options: ReadReminderOptions): SearchHookReply | null {
  return options.isCorpusRead(event.tool_name ?? "", event.tool_input ?? {}) ? { decision: "context", text: options.readText } : null;
}

/**
 * Writes a hook's reply to stdout, as the host reads it.
 *
 * @param hookEventName - The event the hook answers, e.g. `PreToolUse`
 * @param reply - The reply
 */
export function writeSearchHookReply(hookEventName: string, reply: SearchHookReply): void {
  if (reply.decision === "deny") writeHookDecision(hookEventName, "deny", reply.text);
  else writeHookOutput(hookEventName, reply.text);
}

/**
 * Runs the pre-write gate as a hook: reads the event from stdin, writes the
 * reply, if any, to stdout.
 *
 * @param options - The gate's configuration
 */
export async function runPreWriteGate(options: SearchGateOptions): Promise<void> {
  const reply = await preWriteGate(await readHookInput(), options);
  if (reply !== null) writeSearchHookReply("PreToolUse", reply);
}

/**
 * Runs the read reminder as a hook: reads the event from stdin, writes the
 * reply, if any, to stdout.
 *
 * @param options - The reminder's configuration
 */
export async function runPreReadReminder(options: ReadReminderOptions): Promise<void> {
  const reply = preReadReminder(await readHookInput(), options);
  if (reply !== null) writeSearchHookReply("PreToolUse", reply);
}
