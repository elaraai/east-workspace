/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { createServer, connect, type Server, type Socket } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

/** Configures the faults of a {@link SlowLink}. */
export interface SlowLinkOptions {
  /** Where the link leads: a hub's rack listener. */
  target: { host: string; port: number };
  /** Holds every byte this long, in each direction; none by default. */
  delayMs?: number;
  /** Carries at most this many bytes a second in each direction, shared by
   *  every connection through it, as a link's capacity is; no limit by default. */
  bytesPerSecond?: number;
}

/** What one direction of a connection still has to carry. */
interface Lane {
  queue: Array<{ bytes: Buffer; at: number }>;
  queued: number;
  ended: boolean;
  running: boolean;
}

/**
 * A link between a rack agent and its source that is slow, far and unreliable:
 * a TCP relay that holds every byte for a delay, carries no more than a rate,
 * and can drop a connection part-way through a body. It relays bytes it does
 * not read, so TLS passes through it as through any tunnel.
 *
 * @remarks
 * A connection's close travels as its bytes do: it reaches the other end one
 * delay after it was made, and bytes sent meanwhile to the end that closed are
 * lost, as on a real link. An agent that reuses a connection its source has
 * just closed sees what it would there: a connection reset.
 *
 * @example
 * const link = await SlowLink.open({ target: { host: '127.0.0.1', port }, delayMs: 50, bytesPerSecond: 512 * 1024 });
 * const agent = await TestRackAgent.enroll(`https://127.0.0.1:${link.port}`, token, { certificateSha256 });
 * await link.close();
 */
export class SlowLink {
  /** The connections opened through the link so far. */
  connections = 0;
  /** The connections the link has dropped part-way, at {@link cutAfter}'s word. */
  cuts = 0;
  /** The bytes the link has carried so far, each way. */
  readonly carried = { towardsAgent: 0, towardsSource: 0 };
  private readonly open = new Set<Socket>();
  private cut: number | undefined;
  /** When each direction of the link is next free to carry a slice. */
  private readonly free = { towardsAgent: 0, towardsSource: 0 };

  private constructor(private readonly server: Server, private readonly options: SlowLinkOptions,
    /** The local port the link listens on, on the loopback. */
    readonly port: number) {}

  /**
   * Opens a link on a free loopback port.
   * @param options - Where it leads and how slow it is
   * @returns The listening link
   */
  static async open(options: SlowLinkOptions): Promise<SlowLink> {
    for (const [name, value] of [['delayMs', options.delayMs ?? 0], ['bytesPerSecond', options.bytesPerSecond ?? 1]] as const) {
      if (!Number.isFinite(value) || value < 0 || (name === 'bytesPerSecond' && value <= 0)) throw new RangeError(`A slow link's ${name} must be positive`);
    }
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('A slow link needs a network address');
    const link = new SlowLink(server, options, address.port);
    server.on('connection', (near) => link.relay(near));
    return link;
  }

  /**
   * Drops the next connection that has carried this many bytes towards the
   * agent: both ends are destroyed, mid-body when the body is longer.
   * @param bytes - The bytes carried before the drop
   */
  cutAfter(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError('A slow link cuts after a whole number of bytes');
    this.cut = bytes;
  }

  private relay(near: Socket): void {
    this.connections++;
    const far = connect(this.options.target);
    for (const socket of [near, far]) {
      this.open.add(socket);
      socket.once('close', () => { this.open.delete(socket); });
      socket.on('error', () => {}); // a reset is the link's business, seen by the other end as its close
    }
    let towardsAgent = 0;
    const carry = (from: Socket, to: Socket, counts: boolean): void => {
      const lane: Lane = { queue: [], queued: 0, ended: false, running: false };
      const run = async (): Promise<void> => {
        if (lane.running) return;
        lane.running = true;
        try {
          for (;;) {
            const next = lane.queue.shift();
            if (next === undefined) break;
            const wait = next.at - Date.now();
            if (wait > 0) await delay(wait);
            // The rate is the link's, shared by its connections: each slice
            // books the direction for the time it takes, behind the slices
            // booked before it, so connections take turns.
            const rate = this.options.bytesPerSecond;
            const slice = rate === undefined ? next.bytes.length : Math.max(1, Math.ceil(rate / 100));
            for (let offset = 0; offset < next.bytes.length; offset += slice) {
              const part = next.bytes.subarray(offset, offset + slice);
              if (rate !== undefined) {
                const direction = counts ? 'towardsAgent' : 'towardsSource';
                const at = Math.max(Date.now(), this.free[direction]);
                this.free[direction] = at + part.length / rate * 1000;
                if (at > Date.now()) await delay(at - Date.now());
              }
              if (to.destroyed || to.writableEnded) {
                // Bytes for an end that has closed are lost, and their sender
                // learns it as a reset.
                from.destroy();
                return;
              }
              if (counts) {
                towardsAgent += part.length;
                if (this.cut !== undefined && towardsAgent > this.cut) {
                  this.cut = undefined;
                  this.cuts++;
                  near.destroy(); far.destroy();
                  return;
                }
              }
              this.carried[counts ? 'towardsAgent' : 'towardsSource'] += part.length;
              to.write(part);
            }
            lane.queued -= next.bytes.length;
            if (lane.queued < 256 * 1024) from.resume();
          }
          if (lane.ended && !to.destroyed) to.end();
        } finally {
          lane.running = false;
        }
        if (lane.queue.length > 0) void run();
      };
      from.on('data', (bytes: Buffer) => {
        lane.queue.push({ bytes, at: Date.now() + (this.options.delayMs ?? 0) });
        lane.queued += bytes.length;
        // The sender is held to the link's rate, as a full link holds it.
        if (lane.queued >= 256 * 1024) from.pause();
        void run();
      });
      const finish = (): void => {
        if (lane.ended) return;
        lane.ended = true;
        // The close arrives one delay after it was made, behind the bytes
        // before it.
        lane.queue.push({ bytes: Buffer.alloc(0), at: Date.now() + (this.options.delayMs ?? 0) });
        void run();
      };
      from.once('end', finish);
      from.once('close', finish);
    };
    carry(near, far, false);
    carry(far, near, true);
  }

  /** Closes the link and every connection through it. */
  async close(): Promise<void> {
    for (const socket of this.open) socket.destroy();
    await new Promise<void>((resolve) => { this.server.close(() => resolve()); });
  }
}
