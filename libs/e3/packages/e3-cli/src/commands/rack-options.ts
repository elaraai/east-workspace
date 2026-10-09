/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { loadPolicy, type RackPlacementEvent } from '@elaraai/e3-rack';

/** Rack flags shared by dataflow run and watch. */
export interface RackFlags {
  /** Enables or disables rack routing for this invocation. */
  rack?: boolean;
  /** Disables capacity spill; infrastructure fallback remains available. */
  rackOnly?: boolean;
}

/** Rejects rack flags on remote repository URLs before resolving credentials. */
export function refuseRemoteRack(repo: string, flags: RackFlags): void {
  if (/^https?:\/\//.test(repo) && (flags.rack !== undefined || flags.rackOnly)) {
    throw new Error('rack delegation applies to local repositories — a server decides where its own tasks run');
  }
  if (flags.rackOnly && flags.rack === false) throw new Error('--rack-only and --no-rack cannot be combined');
}

/** Resolves the invocation override, then the repository's enabled policy. */
export async function rackEnabled(repo: string, flags: RackFlags): Promise<boolean> {
  if (flags.rackOnly) return true;
  if (flags.rack !== undefined) return flags.rack;
  try { return (await loadPolicy(repo)).enabled; } catch (error) {
    console.warn(`Rack policy: ${error instanceof Error ? error.message : String(error)}; running locally`);
    return false;
  }
}

/** Prints task placement; existing split progress already describes units. */
export function printRackPlacement(event: RackPlacementEvent): void {
  if (event.role === 'unit') return;
  if (event.where === 'rack') console.log(`  [RACK] ${event.taskName} → ${event.rackLabel}`);
  else if (event.reason === 'spill' || event.reason.startsWith('fallback:') || event.reason.startsWith('no-rack-for-tier:')) {
    console.log(`  [LOCAL] ${event.taskName} (${event.reason})`);
  }
}
