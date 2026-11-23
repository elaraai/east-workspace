/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { none, readBeast2Type, type ValueTypeOf } from '@elaraai/east';
import { hubSocketPath, rackHome } from '../paths.js';
import { ApproveRackType, AttachLeaseResultType, CancelLeaseResultType, CreateLeaseResultType, CreateLeaseType, EmptyType, EndScopeType, FetchCostRequestType,
  FetchCostResultType,
  HubConfigType, HubEnrollResultType, HubEnrollType, HubHelloType, HubStatusType, OpenSessionResultType, OpenSessionType,
  RemoveRackResultType, SessionPollResultType, SessionPollType, TierManifestRequestType, TierManifestResultType,
  type CreateLease, type HubConfig, type OpenSession } from '../protocol/control.js';
import { RackRegistrationType, RackSecurityPolicyType, type RackSecurityPolicy } from '../protocol/registration.js';
import { BEAST2_CONTENT_TYPE } from '@elaraai/e3-types';
import { socketRequest, socketStream } from './local-http.js';

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
  /**
   * Whether the hub answers its hello in the envelope every reply had before
   * replies lost it: a variant of an `error` and a `success`, which only a hub
   * of an earlier release sends. A hello that does not read for another cause,
   * cut short or of a later release, is not.
   * @param timeoutMs - The caller's deadline for the answer
   * @returns Whether it does
   */
  async answersInEnvelope(timeoutMs = 30000): Promise<boolean> {
    const response = await socketStream(this.socketPath, 'POST', '/v1/hello', { headers: { 'content-type': BEAST2_CONTENT_TYPE }, timeoutMs });
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response) {
      size += (chunk as Buffer).length;
      if (size > 64 * 1024) { response.destroy(); return false; }
      chunks.push(chunk as Buffer);
    }
    let root;
    try {
      root = readBeast2Type(Buffer.concat(chunks));
    } catch {
      return false;
    }
    if (root.type !== 'Variant') return false;
    const cases = new Set(root.value.map((entry) => entry.name));
    return cases.size === 2 && cases.has('error') && cases.has('success');
  }
  /** Reads listener readiness, attached sessions and fleet capacity. */
  status(): Promise<ValueTypeOf<typeof HubStatusType>> { return socketRequest(this.socketPath, 'GET', '/v1/status', { responseType: HubStatusType }); }
  /**
   * Reads a tier image's manifest, as a rack that boots the tier reported it.
   * @param digest - The manifest's digest, `sha256:<hex>`
   * @returns The manifest's text, or null when no rack the hub hears reports it
   */
  async tierManifest(digest: string): Promise<string | null> {
    const text = await socketRequest(this.socketPath, 'POST', '/v1/tier-manifests', { requestType: TierManifestRequestType, body: { digest }, responseType: TierManifestResultType });
    return text.type === 'some' ? text.value : null;
  }
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
  /** Reads whether a rack's boots after its first need approval before it is leased work. */
  getSecurityPolicy(): Promise<RackSecurityPolicy> {
    return socketRequest(this.socketPath, 'GET', '/v1/security', { responseType: RackSecurityPolicyType });
  }
  /** Sets whether a rack's boots after its first need approval; a rack already admitted keeps its approved boot. */
  setSecurityPolicy(policy: RackSecurityPolicy): Promise<RackSecurityPolicy> {
    return socketRequest(this.socketPath, 'POST', '/v1/security', { requestType: RackSecurityPolicyType, body: policy, responseType: RackSecurityPolicyType });
  }
  /** Reads the effective hub configuration. */
  getConfig(): Promise<HubConfig> { return socketRequest(this.socketPath, 'GET', '/v1/config', { responseType: HubConfigType }); }
  /** Persists configuration and rebinds a changed rack listener. */
  setConfig(config: HubConfig): Promise<HubConfig> {
    return socketRequest(this.socketPath, 'POST', '/v1/config', { requestType: HubConfigType, body: config, responseType: HubConfigType });
  }
  /** Refuses new sessions and exits after existing sessions finish. */
  async drain(): Promise<void> { await socketRequest(this.socketPath, 'POST', '/v1/drain', { responseType: EmptyType }); }
  /**
   * Asks a hub whose replies this e3 cannot read to drain: one from before
   * replies lost their envelope. Its answer is not read, only that it answered.
   */
  async drainUnread(): Promise<void> {
    const response = await socketStream(this.socketPath, 'POST', '/v1/drain', { headers: { 'content-type': BEAST2_CONTENT_TYPE }, timeoutMs: 5000 });
    response.resume();
  }
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
  /** Attaches to identical work already queued or held, or answers none; it queues nothing. */
  attachLease(id: string, request: CreateLease): Promise<ValueTypeOf<typeof AttachLeaseResultType>> {
    return socketRequest(this.socketPath, 'POST', `${this.path(id)}/leases/attach`, { requestType: CreateLeaseType, body: request, responseType: AttachLeaseResultType });
  }
  /** Unsubscribes one session; only its final subscription cancels the lease. */
  cancelLease(id: string, leaseId: string): Promise<ValueTypeOf<typeof CancelLeaseResultType>> {
    return socketRequest(this.socketPath, 'POST', `${this.path(id)}/leases/${encodeURIComponent(leaseId)}/cancel`, { responseType: CancelLeaseResultType });
  }
  /**
   * Of each rack the hub has served: its link's rate, and which of these
   * objects of the session's repository it holds.
   * @param id - The session
   * @param hashes - The objects
   * @returns Each rack's link and holdings
   */
  fetchCosts(id: string, hashes: readonly string[]): Promise<ValueTypeOf<typeof FetchCostResultType>> {
    return socketRequest(this.socketPath, 'POST', `${this.path(id)}/fetch-costs`, { requestType: FetchCostRequestType, body: { hashes: [...hashes] }, responseType: FetchCostResultType });
  }
  /** Ends a split scope the session's leases named: the racks it was granted to let what they kept of it go. */
  async endScope(id: string, scope: string): Promise<void> {
    await socketRequest(this.socketPath, 'POST', `${this.path(id)}/scopes/end`, { requestType: EndScopeType, body: { scope }, responseType: EmptyType });
  }
  /** Polls ordered updates and refreshes the session's liveness. */
  events(id: string, after: bigint, waitMs = 20000, signal?: AbortSignal): Promise<ValueTypeOf<typeof SessionPollResultType>> {
    return socketRequest(this.socketPath, 'POST', `${this.path(id)}/events`, { requestType: SessionPollType,
      body: { after, waitMs: BigInt(waitMs) }, responseType: SessionPollResultType, timeoutMs: 25000, signal });
  }
  private path(id: string): string { return `/v1/sessions/${encodeURIComponent(id)}`; }
}
