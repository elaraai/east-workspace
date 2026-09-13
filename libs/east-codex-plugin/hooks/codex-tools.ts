import { GATE_TEXT, READ_TEXT, isExampleCorpusRead } from "@elaraai/east-plugin/lib/search-guidance";
import { readFile } from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readHookInput, writeHookOutput, writeHookDecision } from '../lib/hook-io.js';
import { patchFiles, shellReadPaths } from '../lib/codex-tools.js';
import { writtenPaths } from '../lib/bash-writes.js';
import { reviewFile } from '../lib/review.js';
import { searchedInTranscript } from '../lib/transcript.js';

async function main() {
  const event = await readHookInput();
  const cwd = event.cwd || process.cwd();
  const input = event.tool_input ?? {};
  const command = typeof input.command === 'string' ? input.command : typeof input['cmd'] === 'string' ? input['cmd'] : '';
  const tool = event.tool_name ?? '';
  // Record the stable hook event, not the undocumented transcript wire format.
  const marker = join(tmpdir(), 'east-codex-search-' + createHash('sha256').update(event.session_id ?? '').digest('hex'));
  const post = event.hook_event_name === 'PostToolUse';
  if (post && tool.startsWith('mcp__') && /__(?:search_east_examples|get_east_example)$/.test(tool)) {
    if (event.tool_response?.['isError'] !== true) writeFileSync(marker, 'searched');
    return;
  }
  const patches = tool === 'apply_patch' ? patchFiles(command, cwd) : [];
  const shell = ['Bash', 'exec_command', 'shell_command'].includes(tool);
  const filePath = typeof input.file_path === 'string' ? resolve(cwd, input.file_path) : undefined;
  const paths = [...new Set([
    ...patches.filter(p => !p.deleted).map(p => p.path),
    ...(shell ? [...writtenPaths(command, cwd), ...shellReadPaths(command, cwd)] : []),
    ...(filePath ? [filePath] : []),
  ])];
  if (post) {
    const reviews = await Promise.all(paths.map(async path => {
      const text = await reviewFile(event.session_id, path);
      return text ? `### ${path}\n${text}` : '';
    }));
    if (reviews.some(Boolean)) writeHookOutput('PostToolUse', reviews.filter(Boolean).join('\n\n'));
    return;
  }
  const context: string[] = [];
  if (isExampleCorpusRead(tool, input) || (shell && /node_modules\/@elaraai(?:\/|\b)|\.examples\.tsx?/.test(command))) {
    context.push(READ_TEXT);
  }
  const writes = tool === 'apply_patch' ? patches.filter(p => !p.deleted) :
    shell ? writtenPaths(command, cwd).map(path => ({ path, originalPath: path, code: command })) :
    filePath && ['Edit', 'Write'].includes(tool) ? [{ path: filePath, originalPath: filePath, code: input.content ?? input.new_string ?? '' }] : [];
  let eastWrite = false;
  for (const file of writes) {
    if (!/\.(tsx?|js|py)$/.test(file.path)) continue;
    let old = '';
    try { old = await readFile(file.originalPath, 'utf8'); } catch { /* new file */ }
    if (/@elaraai\/east|(?:from|import)\s+east\b/.test(old + '\n' + file.code)) eastWrite = true;
  }
  if (eastWrite && !existsSync(marker) && !(event.transcript_path && await searchedInTranscript(event.transcript_path))) {
    const text = GATE_TEXT;
    if (process.env['EAST_REQUIRE_SEARCH'] === 'deny') { writeHookDecision('PreToolUse', 'deny', text); return; }
    context.push(text);
  }
  if (context.length) writeHookOutput('PreToolUse', context.join('\n\n'));
}
main().catch(error => { process.stderr.write(`East hook: ${String(error)}\n`); });
