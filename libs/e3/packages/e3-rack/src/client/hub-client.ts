/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { none, type ValueTypeOf } from '@elaraai/east';
import { hubSocketPath, rackHome } from '../paths.js';
import { ApproveRackType, CancelLeaseResultType, CreateLeaseResultType, CreateLeaseType, EmptyType,
  HubConfigType, HubEnrollResultType, HubEnrollType, HubHelloType, HubStatusType, OpenSessionResultType, OpenSessionType,
  RemoveRackResultType, SessionPollResultType, SessionPollType, type CreateLease, type HubConfig, type OpenSession } from '../protocol/control.js';
import { RackRegistrationType } from '../protocol/registration.js';
import { socketRequest } from './local-http.js';

/**
 * Calls the typed control API of the single user-wide hub.
 * Use connectHub to discover/start the process and negotiate its protocol.
 * @example
 * const client = new HubClient();
 * console.log(await client.status());
 */
export class HubClient {
  /** Private control socket or Windows pipe. */
  readonly socketPath: string;
  /** @param home - The shared state home whose hub to call */
  constructor(readonly home = rackHome()) { this.socketPath = hubSocketPath(home); }

  /** Reads the fixed version handshake within the caller's startup deadline. */
  hello(timeoutMs = 30000): Promise<ValueTypeOf<typeof HubHelloType>> {
    return socketRequest(this.socketPath, 'POST', '/v1/hello', { responseType: HubHelloType, timeoutMs });
  }
  /** Reads listener readiness, attached sessions and fleet capacity. */
  status(): Promise<ValueTypeOf<typeof HubStatusType>> { return socketRequest(this.socketPath, 'GET', '/v1/status', { responseType: HubStatusType }); }
  /** Mints a one-time enrollment token for the configured private-network listener. */
  enroll(request: ValueTypeOf<typeof HubEnrollType> = { label: none, ttlMinutes: none }): Promise<ValueTypeOf<typeof HubEnrollResultType>> {
    return socketRequest(this.socketPath, 'POST', '/v1/enroll', { requestType: HubEnrollType, body: request, responseType: HubEnrollResultType });
  }
  /** Revokes an enrolled rack and ends work it still holds. */
  removeRack(id: string): Promise<ValueTypeOf<typeof RemoveRackResultType>> {
    return socketRequest(this.socketPath, 'DELETE', `/v1/racks/${encodeURIComponent(id)}`, { responseType: RemoveRackResultType });
  }
  /** Approves exactly the boot the operator inspected; refuses a newer reboot. */
  approveRack(id: string, bootId: string): Promise<ValueTypeOf<typeof RackRegistrationType>> {
    return socketRequest(this.socketPath, 'POST', `/v1/racks/${encodeURIComponent(id)}/approve`, { requestType: ApproveRackType, body: { bootId }, responseType: RackRegistrationType });
  }
  /** Reads the effective hub configuration. */
  getConfig(): Promise<HubConfig> { return socketRequest(this.socketPath, 'GET', '/v1/config', { responseType: HubConfigType }); }
  /** Persists configuration and rebinds a changed rack listener. */
  setConfig(config: HubConfig): Promise<HubConfig> {
    return socketRequest(this.socketPath, 'POST', '/v1/config', { requestType: HubConfigType, body: config, responseType: HubConfigType });
  }
  /** Refuses new sessions and exits after existing sessions finish. */
  async drain(): Promise<void> { await socketRequest(this.socketPath, 'POST', '/v1/drain', { responseType: EmptyType }); }
  /** Cancels active work and gracefully exits the hub. */
  async stop(): Promise<void> { await socketRequest(this.socketPath, 'POST', '/v1/stop', { responseType: EmptyType }); }
  /** Registers a live repository data endpoint; RackSession owns its lifecycle. */
  openSession(request: OpenSession): Promise<ValueTypeOf<typeof OpenSessionResultType>> {
    return socketRequest(this.socketPath, 'POST', '/v1/sessions', { requestType: OpenSessionType, body: request, responseType: OpenSessionResultType });
  }
  /** Ends a session, transferring shared leases before its data endpoint closes. */
  async closeSession(id: string): Promise<void> { await socketRequest(this.socketPath, 'DELETE', this.path(id), { responseType: EmptyType }); }
  /** Submits or attaches to a task/unit lease of the session's repository. */
  createLease(id: string, request: CreateLease): Promise<ValueTypeOf<typeof CreateLeaseResultType>> {
    return socketRequest(this.socketPath, 'POST', `${this.path(id)}/leases`, { requestType: CreateLeaseType, body: request, responseType: CreateLeaseResultType });
  }
  /** Unsubscribes one session; only its final subscription cancels the lease. */
  cancelLease(id: string, leaseId: string): Promise<ValueTypeOf<typeof CancelLeaseResultType>> {
    return socketRequest(this.socketPath, 'POST', `${this.path(id)}/leases/${encodeURIComponent(leaseId)}/cancel`, { responseType: CancelLeaseResultType });
  }
  /** Polls ordered updates and refreshes the session's liveness. */
  events(id: string, after: bigint, waitMs = 20000, signal?: AbortSignal): Promise<ValueTypeOf<typeof SessionPollResultType>> {
    return socketRequest(this.socketPath, 'POST', `${this.path(id)}/events`, { requestType: SessionPollType,
      body: { after, waitMs: BigInt(waitMs) }, responseType: SessionPollResultType, timeoutMs: 25000, signal });
  }
  private path(id: string): string { return `/v1/sessions/${encodeURIComponent(id)}`; }
}
