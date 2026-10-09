/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Serializes a lease transition together with its repository side effects.
 * A host shares one coordinator between its routes and dispatcher. A
 * distributed host supplies the equivalent fencing at its storage boundary.
 */
export interface LeaseCoordinator {
  /** Runs a transition exclusively for one repository and lease. */
  run<T>(repo: string, leaseId: string, operation: () => Promise<T>): Promise<T>;
}

/**
 * Serializes transitions in a single hub without blocking unrelated leases.
 * Operations must not recursively acquire the same lease.
 * @example
 * const coordinator = new InMemoryLeaseCoordinator();
 * await coordinator.run(repo, leaseId, () => completeAttempt());
 */
export class InMemoryLeaseCoordinator implements LeaseCoordinator {
  private readonly tails = new Map<string, Promise<void>>();

  /**
   * Runs after prior transitions, even if a prior transition rejected.
   * @param repo - Repository alias
   * @param leaseId - Lease identity
   * @param operation - Transition and its side effects
   * @returns The operation's result
   */
  async run<T>(repo: string, leaseId: string, operation: () => Promise<T>): Promise<T> {
    const key = JSON.stringify([repo, leaseId]);
    const before = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const after = new Promise<void>((resolve) => { release = resolve; });
    this.tails.set(key, after);
    await before;
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(key) === after) this.tails.delete(key);
    }
  }
}

/** Runs unfenced operations for hosts whose backend supplies fencing. */
export const backendLeaseCoordinator: LeaseCoordinator = {
  run: (_repo, _leaseId, operation) => operation(),
};
