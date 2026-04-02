export interface HookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode: string;
  hook_event_name: string;
  agent_id?: string;
  agent_type?: string;
  source?: string;
  model?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: {
    file_path?: string;
    content?: string;
    old_string?: string;
    new_string?: string;
    command?: string;
    prompt?: string;
    subagent_type?: string;
    [key: string]: unknown;
  };
  tool_response?: Record<string, unknown>;
  tool_use_id?: string;
}

export async function readHookInput(): Promise<HookInput> {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  return JSON.parse(input) as HookInput;
}

export function writeHookOutput(hookEventName: string, additionalContext: string): void {
  const output = {
    hookSpecificOutput: {
      hookEventName,
      additionalContext,
    },
  };
  process.stdout.write(JSON.stringify(output));
}
