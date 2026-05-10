#!/usr/bin/env node
/**
 * Feedback watcher — long-running.
 *
 * Polls data/feedback.db for:
 *   - new feedback rows
 *   - status changes on existing rows
 *   - new user replies on any feedback (so claude is woken on round-trip)
 *
 * Emits one JSON line per actionable event on stdout. Designed to be tailed
 * by the Monitor tool with a `grep` filter so each event becomes a chat
 * notification.
 *
 * Stop with SIGINT / SIGTERM. WAL mode is on so writes don't block reads.
 */
import Database from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const here = path.dirname(fileURLToPath(import.meta.url))
const dbPath = path.resolve(here, '..', 'data', 'feedback.db')

const args = process.argv.slice(2)
let pollMs = 1500
let includeActioned = false
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--poll-ms') { pollMs = Number(args[++i]) || 1500 }
  else if (args[i] === '--include-actioned') { includeActioned = true }
}

function waitForDb() {
  return new Promise((resolve) => {
    const tick = () => {
      if (fs.existsSync(dbPath)) return resolve()
      setTimeout(tick, 500)
    }
    tick()
  })
}

let lastMaxFeedbackId = 0
let lastMaxMessageId = 0
let lastDataVersion = -1n

function emit(event, payload) {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), event, ...payload }) + '\n')
}

async function main() {
  emit('starting', { dbPath, pollMs })
  await waitForDb()

  const db = new Database(dbPath, { readonly: true })
  db.pragma('journal_mode = WAL')

  // Wait briefly for the schema to settle. The vite plugin creates tables on
  // first request — if we beat it to the punch, queries fail.
  await waitForTables(db)

  // Catch up: any existing OPEN rows + any existing messages are emitted as
  // 'seed' events so claude sees the backlog on (re)start.
  const seedFeedback = db.prepare(
    includeActioned
      ? 'SELECT * FROM feedback ORDER BY id'
      : "SELECT * FROM feedback WHERE status = 'open' ORDER BY id"
  ).all()
  for (const r of seedFeedback) {
    emit('seed', { feedback: toCamelFeedback(r) })
  }
  lastMaxFeedbackId = seedFeedback.length ? seedFeedback[seedFeedback.length - 1].id : 0

  const seedMessages = db.prepare(
    'SELECT * FROM feedback_message ORDER BY id'
  ).all()
  for (const m of seedMessages) {
    emit('seed-message', { message: toCamelMessage(m) })
  }
  lastMaxMessageId = seedMessages.length ? seedMessages[seedMessages.length - 1].id : 0

  emit('ready', {
    backlogFeedback: seedFeedback.length,
    backlogMessages: seedMessages.length,
    lastFeedbackId: lastMaxFeedbackId,
    lastMessageId: lastMaxMessageId,
  })

  const dataVersionStmt = db.prepare('PRAGMA data_version')
  const knownStatus = new Map() // feedback_id → status
  for (const r of seedFeedback) knownStatus.set(r.id, r.status)

  const pollOnce = () => {
    const dvRow = dataVersionStmt.get()
    const dv = BigInt(dvRow.data_version)
    if (dv === lastDataVersion) return
    lastDataVersion = dv

    // 1) New feedback rows
    const fresh = db.prepare(
      includeActioned
        ? 'SELECT * FROM feedback WHERE id > ? ORDER BY id'
        : "SELECT * FROM feedback WHERE id > ? AND status = 'open' ORDER BY id"
    ).all(lastMaxFeedbackId)
    for (const r of fresh) {
      emit('new', { feedback: toCamelFeedback(r) })
      knownStatus.set(r.id, r.status)
      if (r.id > lastMaxFeedbackId) lastMaxFeedbackId = r.id
    }

    // 2) Status changes on previously-seen rows
    const all = db.prepare('SELECT id, status, resolution, actioned_at FROM feedback').all()
    for (const r of all) {
      const prev = knownStatus.get(r.id)
      if (prev !== undefined && prev !== r.status) {
        emit('status-change', {
          id: r.id,
          from: prev,
          to: r.status,
          resolution: r.resolution,
          actionedAt: r.actioned_at,
        })
        knownStatus.set(r.id, r.status)
      }
    }

    // 3) New messages (interesting subset: user replies)
    const newMessages = db.prepare(
      'SELECT m.*, f.location_id, f.kind, f.body AS feedback_body, f.status AS feedback_status FROM feedback_message m JOIN feedback f ON f.id = m.feedback_id WHERE m.id > ? ORDER BY m.id'
    ).all(lastMaxMessageId)
    for (const m of newMessages) {
      const event = m.author === 'user' ? 'user-reply' : 'claude-reply'
      emit(event, {
        message: toCamelMessage(m),
        feedback: {
          id: m.feedback_id,
          locationId: m.location_id,
          kind: m.kind,
          body: m.feedback_body,
          status: m.feedback_status,
        },
      })
      if (m.id > lastMaxMessageId) lastMaxMessageId = m.id
    }
  }

  const interval = setInterval(pollOnce, pollMs)

  const stop = (sig) => {
    emit('stopping', { signal: sig })
    clearInterval(interval)
    db.close()
    process.exit(0)
  }
  process.on('SIGINT',  () => stop('SIGINT'))
  process.on('SIGTERM', () => stop('SIGTERM'))
}

async function waitForTables(db) {
  for (let i = 0; i < 20; i++) {
    try {
      db.prepare('SELECT 1 FROM feedback LIMIT 1').get()
      db.prepare('SELECT 1 FROM feedback_message LIMIT 1').get()
      return
    } catch {
      await new Promise(r => setTimeout(r, 250))
    }
  }
}

function toCamelFeedback(row) {
  return {
    id: row.id,
    locationId: row.location_id,
    patternId: row.pattern_id,
    modeId: row.mode_id,
    kind: row.kind,
    body: row.body,
    status: row.status,
    resolution: row.resolution,
    createdAt: row.created_at,
    actionedAt: row.actioned_at,
  }
}

function toCamelMessage(row) {
  return {
    id: row.id,
    feedbackId: row.feedback_id,
    author: row.author,
    body: row.body,
    createdAt: row.created_at,
  }
}

main().catch((e) => {
  emit('error', { message: e instanceof Error ? e.message : String(e) })
  process.exit(1)
})
