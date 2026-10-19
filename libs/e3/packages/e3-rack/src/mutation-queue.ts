/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/** Serializes a store's mutations; failed mutations do not poison the queue. @internal */
export class MutationQueue {
  private tail: Promise<unknown> = Promise.resolve();

  /** Runs the operation after every preceding operation has settled. */
  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined);
    return result;
  }

  /** Waits for all operations already queued. */
  async idle(): Promise<void> { await this.tail; }
}
