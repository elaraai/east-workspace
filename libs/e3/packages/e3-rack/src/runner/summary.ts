/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { ranLocally, type RackPlacementEvent } from './rack-body.js';

/** What a run's rack work came to. */
export interface RackRunSummary {
  /** The work racks claimed, by rack, in the order each first claimed some */
  readonly placed: ReadonlyArray<{ readonly rackLabel: string; readonly tasks: number; readonly units: number }>;
  /** The tries of transfers that failed and were followed by another */
  readonly transfersRetried: number;
  /** The work a rack was to run that this machine ran after all */
  readonly ranLocally: number;
}

/**
 * Counts a run's placement events into its summary.
 *
 * @example
 * const tally = new RackTally();
 * tally.add(event);
 * console.log(describeRackSummary(tally.take()));
 */
export class RackTally {
  private placed = new Map<string, { tasks: number; units: number }>();
  private transfersRetried = 0;
  private ranLocally = 0;

  /**
   * Counts one event.
   * @param event - A placement event of the run
   */
  add(event: RackPlacementEvent): void {
    if (event.kind === 'retried') { this.transfersRetried++; return; }
    if (event.where === 'rack') {
      const rack = this.placed.get(event.rackLabel) ?? { tasks: 0, units: 0 };
      if (event.role === 'task') rack.tasks++; else rack.units++;
      this.placed.set(event.rackLabel, rack);
    } else if (ranLocally(event)) this.ranLocally++;
  }

  /**
   * Takes what was counted since the last take: a session that serves several
   * runs, as a watch's does, sums each one up on its own.
   * @returns The summary
   */
  take(): RackRunSummary {
    const summary = { placed: [...this.placed].map(([rackLabel, counts]) => ({ rackLabel, ...counts })),
      transfersRetried: this.transfersRetried, ranLocally: this.ranLocally };
    this.placed = new Map(); this.transfersRetried = 0; this.ranLocally = 0;
    return summary;
  }
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * A run's rack work as the line a run ends with.
 *
 * @param summary - The run's summary
 * @returns Such as `Rack summary: 100 units on rack-a · 2 transfers retried ·
 *   0 ran locally`, or undefined when no work went to a rack or came back
 *   from one
 *
 * @example
 * const line = describeRackSummary(rack.takeSummary());
 * if (line !== undefined) console.log(line);
 */
export function describeRackSummary(summary: RackRunSummary): string | undefined {
  if (summary.placed.length === 0 && summary.ranLocally === 0 && summary.transfersRetried === 0) return undefined;
  const placed = summary.placed.map((rack) =>
    `${[rack.tasks > 0 ? count(rack.tasks, 'task') : '', rack.units > 0 ? count(rack.units, 'unit') : ''].filter(Boolean).join(' and ')} on ${rack.rackLabel}`);
  return `Rack summary: ${[...(placed.length > 0 ? placed : ['nothing ran on a rack']),
    `${count(summary.transfersRetried, 'transfer')} retried`, `${summary.ranLocally} ran locally`].join(' · ')}`;
}
