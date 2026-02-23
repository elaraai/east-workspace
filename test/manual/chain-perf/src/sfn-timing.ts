/**
 * Step Functions execution history timing analysis.
 *
 * Fetches SFN execution history events and computes per-step durations,
 * grouped by loop iteration (each iteration processes one batch of ready tasks).
 */

import {
  SFNClient,
  GetExecutionHistoryCommand,
  ListExecutionsCommand,
  type HistoryEvent,
} from '@aws-sdk/client-sfn';

const sfn = new SFNClient({});

/** Per-step timing within one iteration of the dataflow loop. */
export interface StepTiming {
  step: string;
  durationMs: number;
}

/** Timing breakdown for one loop iteration. */
export interface IterationTiming {
  iteration: number;
  steps: StepTiming[];
  totalMs: number;
}

/** Full execution timing result. */
export interface ExecutionTiming {
  executionArn: string;
  iterations: IterationTiming[];
  totalMs: number;
  /** Time from execution start to first GetGraphState entry */
  startupMs: number;
  /** Time for the final Finalize step */
  finalizeMs: number;
}

/**
 * Known top-level state names in the dataflow state machine.
 * States within the Map iterator (DispatchTaskState, ExecuteTaskState, etc.)
 * appear as nested events.
 */
const LOOP_STATES = [
  'GetReadyState',
  'CheckReadyTasks',
  'DispatchTasksMap',
  'AfterMapLoop',
  'ApplyResultsState',
  'ApplyTreeUpdatesState',
];

const FINALIZE_STATES = [
  'PrepareFinalizeSuccess',
  'PrepareFinalizeFailure',
  'FinalizeSuccessState',
  'FinalizeFailureState',
];

/**
 * Find the most recent dataflow execution for a given repo/workspace.
 */
export async function findLatestExecution(
  stateMachineArn: string,
  repo: string,
  workspace: string,
): Promise<string | null> {
  const prefix = `dataflow-${repo}-${workspace}-`;
  const result = await sfn.send(new ListExecutionsCommand({
    stateMachineArn,
    maxResults: 20,
    statusFilter: 'SUCCEEDED',
  }));

  const match = result.executions?.find(e => e.name?.startsWith(prefix));
  return match?.executionArn ?? null;
}

/**
 * Fetch and analyze execution history for a Step Functions execution.
 *
 * Groups events into iterations of the main loop:
 *   GetReady → CheckReadyTasks → DispatchTasksMap → AfterMapLoop → ApplyResults → ApplyTreeUpdates
 *
 * The first iteration also includes GetGraphState before the loop starts.
 */
export async function getExecutionTiming(executionArn: string): Promise<ExecutionTiming> {
  // Fetch all history events (paginated)
  const events: HistoryEvent[] = [];
  let nextToken: string | undefined;
  do {
    const result = await sfn.send(new GetExecutionHistoryCommand({
      executionArn,
      maxResults: 1000,
      nextToken,
    }));
    if (result.events) events.push(...result.events);
    nextToken = result.nextToken;
  } while (nextToken);

  if (events.length === 0) {
    throw new Error('No events found for execution');
  }

  // Build a map of state enter/exit times
  interface StateSpan {
    name: string;
    enteredAt: number;
    exitedAt?: number;
  }

  const spans: StateSpan[] = [];
  const pendingStates = new Map<number, StateSpan>(); // eventId → span

  // Track execution start time
  const executionStartTime = events[0]?.timestamp?.getTime() ?? 0;
  let executionEndTime = executionStartTime;

  for (const event of events) {
    const ts = event.timestamp?.getTime() ?? 0;
    executionEndTime = Math.max(executionEndTime, ts);

    if (event.type === 'TaskStateEntered' || event.type === 'PassStateEntered' ||
        event.type === 'MapStateEntered' || event.type === 'ChoiceStateEntered' ||
        event.type === 'WaitStateEntered') {
      const detail = event.stateEnteredEventDetails;
      if (detail?.name) {
        pendingStates.set(event.id!, {
          name: detail.name,
          enteredAt: ts,
        });
      }
    }

    if (event.type === 'TaskStateExited' || event.type === 'PassStateExited' ||
        event.type === 'MapStateExited' || event.type === 'ChoiceStateExited' ||
        event.type === 'WaitStateExited') {
      const detail = event.stateExitedEventDetails;
      if (detail?.name) {
        // Find the matching entry — match by name, take the most recent unfinished one
        for (const [id, span] of pendingStates) {
          if (span.name === detail.name && !span.exitedAt) {
            span.exitedAt = ts;
            spans.push(span);
            pendingStates.delete(id);
            break;
          }
        }
      }
    }
  }

  // Group spans into iterations
  // The pattern is: GetGraphState (once) then repeating GetReadyState → ... → ApplyTreeUpdatesState
  const iterations: IterationTiming[] = [];
  let currentIteration: StepTiming[] = [];
  let iterationNum = 0;
  let startupMs = 0;
  let finalizeMs = 0;

  // Sort spans by entry time
  spans.sort((a, b) => a.enteredAt - b.enteredAt);

  for (const span of spans) {
    const duration = (span.exitedAt ?? span.enteredAt) - span.enteredAt;

    if (span.name === 'GetGraphState') {
      startupMs = duration;
      continue;
    }

    if (FINALIZE_STATES.includes(span.name)) {
      finalizeMs += duration;
      continue;
    }

    if (!LOOP_STATES.includes(span.name) && span.name !== 'IsAllComplete') {
      continue;
    }

    // GetReadyState marks the start of a new iteration
    if (span.name === 'GetReadyState') {
      if (currentIteration.length > 0) {
        const total = currentIteration.reduce((s, st) => s + st.durationMs, 0);
        iterations.push({ iteration: iterationNum, steps: currentIteration, totalMs: total });
        iterationNum++;
      }
      currentIteration = [];
    }

    currentIteration.push({ step: span.name, durationMs: duration });
  }

  // Push final iteration
  if (currentIteration.length > 0) {
    const total = currentIteration.reduce((s, st) => s + st.durationMs, 0);
    iterations.push({ iteration: iterationNum, steps: currentIteration, totalMs: total });
  }

  return {
    executionArn,
    iterations,
    totalMs: executionEndTime - executionStartTime,
    startupMs,
    finalizeMs,
  };
}

/**
 * Format execution timing as a readable table.
 */
export function formatTimingTable(timing: ExecutionTiming, label: string): string {
  const lines: string[] = [];
  lines.push(`\n=== ${label} ===`);
  lines.push('');

  // Determine iteration columns
  const numIterations = timing.iterations.length;
  const colWidth = 14;

  // Header
  const header = 'Step'.padEnd(24) + timing.iterations.map((it) =>
    `Iter ${it.iteration}`.padStart(colWidth)
  ).join('');
  lines.push(header);
  lines.push('─'.repeat(24 + numIterations * colWidth));

  // GetGraph (only in first effective iteration)
  if (timing.startupMs > 0) {
    const row = 'GetGraph'.padEnd(24) + `${timing.startupMs}ms`.padStart(colWidth) +
      ''.padStart((numIterations - 1) * colWidth);
    lines.push(row);
  }

  // Collect all unique step names across iterations
  const allSteps = [...new Set(timing.iterations.flatMap(it => it.steps.map(s => s.step)))];

  for (const stepName of allSteps) {
    const row = stepName.padEnd(24) + timing.iterations.map((it) => {
      const step = it.steps.find(s => s.step === stepName);
      return step ? `${step.durationMs}ms`.padStart(colWidth) : '-'.padStart(colWidth);
    }).join('');
    lines.push(row);
  }

  lines.push('─'.repeat(24 + numIterations * colWidth));

  // Per-iteration totals
  const totalsRow = 'Iteration total'.padEnd(24) + timing.iterations.map((it) =>
    `${it.totalMs}ms`.padStart(colWidth)
  ).join('');
  lines.push(totalsRow);

  // Finalize
  if (timing.finalizeMs > 0) {
    lines.push(`Finalize`.padEnd(24) + `${timing.finalizeMs}ms`.padStart(colWidth));
  }

  lines.push('');
  lines.push(`Total wall time: ${timing.totalMs}ms`);

  // Summary stats
  if (numIterations > 1) {
    // Skip first iteration for per-task average (it includes GetGraph overhead)
    const loopIterations = timing.iterations.slice(1);
    if (loopIterations.length > 0) {
      const avgLoop = Math.round(loopIterations.reduce((s, it) => s + it.totalMs, 0) / loopIterations.length);
      lines.push(`Per-task loop avg (iter 1+): ${avgLoop}ms`);
    }
  }

  return lines.join('\n');
}
