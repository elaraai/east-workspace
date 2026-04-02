# East Plugin: Context Injection via Hooks

## Problem

Claude Code and its subagents don't get East language context at the right moments:

1. **Subagents** (Explore, Plan, custom) get no East context — they don't know about East skills or the MCP search tool
2. **During reasoning** — when Claude is reading files, planning, or about to write code, there's no mechanism to inject relevant East docs based on what it's currently working on
3. **Context compaction** — East context injected early may be lost when the conversation is compressed
4. **Edit operations** — only contain the diff, not the full file, so checking `new_string` for `@elaraai/east` imports misses most East edits

## Current State

### Hooks implemented
| Hook | File | Purpose |
|------|------|---------|
| `SessionStart` | `dist/hooks/session-start.js` | Detect East project via `package.json`, announce available skills |
| `UserPromptSubmit` | `dist/hooks/prompt-submit.js` | Search index against user's prompt, inject matching examples |

### Other infrastructure
| Component | Purpose |
|-----------|---------|
| `lib/search.js` | MiniSearch index builder + result formatter (shared) |
| `mcp/search-server.js` | MCP tool `search_east_examples` — same search, available as a tool |
| `index.json` | Pre-built search index of all East examples |

## Claude Code's Inner Loop

```
User prompt
  → [UserPromptSubmit hook] ← we intercept here today
  → Claude thinks (no hook)
  → Claude calls tool
      → [PreToolUse hook] ← CAN INJECT additionalContext
      → tool executes
      → [PostToolUse hook] ← CAN INJECT additionalContext
  → Claude thinks (no hook)
  → Claude calls another tool...
  → ...
  → Claude stops
      → [Stop hook]
```

**Key insight**: There is no hook for Claude's thinking/reasoning steps. The only interception points are around tool calls. But since every action Claude takes is a tool call, `PreToolUse` on the right tools gives us effective coverage of the entire working process.

## Available Hooks for Context Injection

Every hook that supports `additionalContext` is a potential injection point. These fire in both the main thread AND subagents (the input includes `agent_id` when inside a subagent):

| Hook | Matcher | Fires in subagents? | `additionalContext`? | Frequency | Notes |
|------|---------|---------------------|---------------------|-----------|-------|
| `SessionStart` | `startup\|resume\|compact` | No | Yes | Once | Already implemented |
| `UserPromptSubmit` | (none) | No | Yes | Per user message | Already implemented |
| **`SubagentStart`** | agent type | Yes (fires when spawned) | **Yes** | Per subagent spawn | **Not implemented** |
| **`PreToolUse`** | tool name | **Yes** | **Yes** | Per tool call | **Not implemented** |
| **`PostToolUse`** | tool name | **Yes** | **Yes** | Per tool call | **Not implemented** |
| `PostToolUseFailure` | tool name | Yes | Yes | Per tool failure | Low priority |
| `Notification` | notification type | No | Yes | Rare | Not useful |

## Transcript Structure

Every hook receives `transcript_path` — a JSONL file containing the full conversation. This is our lookback window into what Claude has been doing.

### Entry types
| `type` | Content | Key fields |
|--------|---------|------------|
| `user` | User prompts + tool results | `.message.content` — raw string or array of `tool_result` blocks |
| `assistant` | Claude's responses | `.message.content[]` — `text`, `tool_use`, `thinking` blocks |
| `progress` | Hook/bash/agent progress | `.data.type` — `hook_progress`, `bash_progress`, `agent_progress` |
| `system` | Metadata | `turn_duration` etc |

### Useful transcript data for context decisions
- **`tool_use` blocks**: `.name`, `.id`, `.input` — for `Write` contains full file content, for `Edit` contains `file_path`/`old_string`/`new_string`, for `Read` contains `file_path`
- **`text` blocks**: Claude's reasoning — "I need to modify the East function...", "Let me look at the type definitions..."
- **`thinking` blocks**: Extended reasoning (when available)
- **Subagent transcripts**: Stored at `<session-id>/subagents/agent-<id>.jsonl`, same format

### Determining East context from transcript
Rather than checking the current tool input for `@elaraai/east` (which misses Edit diffs), we can:
1. Parse transcript backwards for recent `Read`/`Edit`/`Write` on `.ts` files
2. Check if any recent file paths are in an East project (we already know from `SessionStart`)
3. Extract recent `text`/`thinking` content as search queries
4. Or simplest: read the file at `tool_input.file_path` from disk and check for East imports

## Proposed New Hooks

### Priority 1: `SubagentStart` — Tell subagents about East

**Why**: Subagents start with zero East context. This is the single biggest gap.

**Fires**: When any subagent is spawned (Explore, Plan, Bash, custom agents).

**Logic**:
1. Check if this is an East project (read `package.json` from `cwd`)
2. Inject context telling the subagent about East and the MCP search tool

**Output example**:
```
This is an East project using @elaraai/east and @elaraai/east-node-std.

When working with East code, use the mcp__plugin_east_east-search__search_east_examples
tool to look up East API examples before writing or modifying East code. East is a
statically typed, expression-based language embedded in TypeScript — it has unique
patterns that differ from regular TypeScript.
```

**Matcher**: None (fire for all agent types) or `Explore|Plan` to target the most useful ones.

**Performance**: Fast — just reads `package.json` (cached). Fires only when subagents spawn (~34 times in a heavy session).

### Priority 2: `PreToolUse` on `Edit|Write` — Inject docs before code is written

**Why**: This is the last chance to inject relevant examples before Claude commits code to disk. Works in both main thread and subagents.

**Fires**: Before every `Edit` or `Write` tool call.

**Logic**:
1. Check if this is an East project (fast, cached)
2. Determine if this is an East file:
   - For `Write`: check `tool_input.content` for `@elaraai/east` imports
   - For `Edit`: read `tool_input.file_path` from disk, check for East imports
3. If East file: extract search terms from:
   - The code being written (`tool_input.content` or `tool_input.new_string`)
   - Recent `text`/`thinking` blocks from transcript (last 2-3 assistant messages)
4. Search index, inject relevant examples via `additionalContext`

**Performance**: ~255 Edit + ~25 Write calls in a heavy session. The East import check should exit fast for non-East files. Reading the file from disk for Edit is an extra I/O but the file was just read by Claude anyway (likely in OS cache). Index search is <10ms. Target: <50ms for non-East files, <200ms for East files.

**Timeout**: 3 seconds.

### Priority 3: `PreToolUse` on `Agent` — Search index against subagent prompt

**Why**: When Claude spawns a subagent, the prompt describes the task. We can search the index against it and inject relevant docs so the subagent has them from the start.

**Fires**: Before the `Agent` tool call.

**Input**: `tool_input.prompt` contains the full task description.

**Logic**:
1. Check if East project
2. Search index against `tool_input.prompt`
3. If good matches: inject via `additionalContext`

**Performance**: Low frequency (only fires when spawning subagents). Can afford a longer timeout.

**Note**: This complements `SubagentStart` — `SubagentStart` provides general East awareness, while `PreToolUse` on `Agent` provides task-specific examples.

### Priority 4: `PostToolUse` on `Edit|Write` — Correction loop

**Why**: After East code is written, scan for common mistakes and inject corrections. Claude sees the feedback and can fix immediately.

**Fires**: After every successful `Edit` or `Write`.

**Logic**:
1. Check if the written file is East code (read from disk, check imports)
2. Scan for known mistake patterns:
   - `East.IntegerType` instead of `IntegerType`
   - `new East.function` instead of `East.function`
   - Missing `$.return()` usage patterns
   - Wrong type annotations for bigint (should use `IntegerType`)
3. If mistakes found: return `additionalContext` with corrections
4. Optionally: return `decision: "block"` with `reason` to prompt Claude to fix it

**Performance**: Same frequency as PreToolUse on Edit|Write. Reading file from disk is fast.

### Priority 5: `PreToolUse` on `Read` — Remind about MCP search tool

**Why**: When Claude reads an East file, remind it that the MCP search tool exists for looking up API patterns.

**Fires**: Before every `Read` tool call.

**Logic**:
1. Check if East project
2. Check if `tool_input.file_path` ends with `.ts` and is in the project
3. Inject a lightweight reminder about the search tool

**Performance**: **High frequency** (~339 Read calls in a heavy session). Must be extremely fast. Exit immediately for non-`.ts` files. For `.ts` files, inject a one-liner reminder — don't read the file or search the index.

**Timeout**: 2 seconds.

**Risk**: This may be too noisy. Consider only injecting on the first Read of a `.ts` file per session, or only when the file contains East imports (requires reading the file).

## Proposed hooks.json

```json
{
  "description": "East plugin hooks for project detection and documentation search",
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/hooks/session-start.js\"",
            "timeout": 5
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/hooks/prompt-submit.js\"",
            "timeout": 5
          }
        ]
      }
    ],
    "SubagentStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/hooks/subagent-start.js\"",
            "timeout": 5
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/hooks/pre-write.js\"",
            "timeout": 3
          }
        ]
      },
      {
        "matcher": "Agent",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/hooks/pre-agent.js\"",
            "timeout": 5
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/hooks/post-write.js\"",
            "timeout": 3
          }
        ]
      }
    ]
  }
}
```

## Shared Utilities

All hooks need common capabilities. These should be extracted into shared modules:

### `lib/east-project.js` — Project detection (cached)
```js
// Check if cwd is an East project, return detected skills
// Cache result per cwd to avoid repeated package.json reads
export function isEastProject(cwd): { isEast: boolean, skills: string[] }
```

### `lib/transcript.js` — Transcript parsing
```js
// Read last N entries from transcript JSONL (read from end of file)
export function readRecentTranscript(transcriptPath, count): TranscriptEntry[]

// Extract recent assistant reasoning (text + thinking blocks)
export function extractRecentReasoning(entries): string

// Extract recent file paths from Read/Edit/Write tool calls
export function extractRecentFiles(entries): string[]
```

### `lib/search.js` — Search index (existing)
Already implemented. Used by hooks and MCP server.

### `lib/stdin.js` — Hook input parsing
```js
// Parse JSON from stdin (common to all hooks)
export function readHookInput(): HookInput
```

## Performance Budget

| Hook | Max latency | Calls per session (heavy) | Total overhead |
|------|------------|--------------------------|----------------|
| SessionStart | 500ms | 1 | 0.5s |
| UserPromptSubmit | 200ms | ~40 | 8s |
| SubagentStart | 200ms | ~34 | 7s |
| PreToolUse Edit\|Write | 200ms | ~280 | 56s |
| PreToolUse Agent | 300ms | ~34 | 10s |
| PostToolUse Edit\|Write | 200ms | ~280 | 56s |

**Key optimization**: Early exit. Every hook should check "is this an East project?" first and `process.exit(0)` immediately if not. For PreToolUse on Edit|Write, check if the file is East code and exit if not. Most calls should complete in <20ms.

**Node.js cold start**: Each hook invocation spawns a new Node.js process. This has ~30-50ms overhead. For high-frequency hooks (PreToolUse on Edit|Write), consider:
- Keeping the hook logic minimal
- Pre-loading the search index via `import` (bundled with esbuild)
- Avoiding unnecessary file I/O

## Implementation Order

1. **Shared utilities** — `lib/east-project.js`, `lib/transcript.js`, `lib/stdin.js`
2. **`SubagentStart`** — biggest gap, simple implementation
3. **`PreToolUse` on `Agent`** — complements SubagentStart with task-specific docs
4. **`PreToolUse` on `Edit|Write`** — inject docs before code writing
5. **`PostToolUse` on `Edit|Write`** — correction loop (optional, evaluate if Pre is sufficient)
6. **`PreToolUse` on `Read`** — lightweight reminder (optional, evaluate noise level)
