import type { Plugin, ViteDevServer } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import Database, { type Database as DB } from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'

interface FeedbackRow {
  id: number
  location_id: string
  pattern_id: string | null
  mode_id: string | null
  kind: string
  body: string
  status: string
  resolution: string | null
  created_at: string
  actioned_at: string | null
}

interface MessageRow {
  id: number
  feedback_id: number
  author: 'claude' | 'user'
  body: string
  created_at: string
}

function toCamelFeedback(row: FeedbackRow, messages: MessageRow[] = []) {
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
    messages: messages.map(toCamelMessage),
  }
}

function toCamelMessage(row: MessageRow) {
  return {
    id: row.id,
    feedbackId: row.feedback_id,
    author: row.author,
    body: row.body,
    createdAt: row.created_at,
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk: Buffer) => (body += chunk.toString()))
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function attachMessages(db: DB, feedbacks: FeedbackRow[]) {
  if (feedbacks.length === 0) return []
  const ids = feedbacks.map(f => f.id)
  const placeholders = ids.map(() => '?').join(',')
  const messages = db
    .prepare(`SELECT * FROM feedback_message WHERE feedback_id IN (${placeholders}) ORDER BY created_at ASC`)
    .all(...ids) as MessageRow[]
  const byFeedback = new Map<number, MessageRow[]>()
  for (const m of messages) {
    let bucket = byFeedback.get(m.feedback_id)
    if (!bucket) {
      bucket = []
      byFeedback.set(m.feedback_id, bucket)
    }
    bucket.push(m)
  }
  return feedbacks.map(f => toCamelFeedback(f, byFeedback.get(f.id) ?? []))
}

export function feedbackPlugin(): Plugin {
  let db: DB

  return {
    name: 'east-ui-patterns-showcase:feedback',

    configureServer(server: ViteDevServer) {
      const dbPath = path.resolve(server.config.root, 'data/feedback.db')
      fs.mkdirSync(path.dirname(dbPath), { recursive: true })
      db = new Database(dbPath)
      db.pragma('journal_mode = WAL')
      db.pragma('foreign_keys = ON')
      db.exec(`
        CREATE TABLE IF NOT EXISTS feedback (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          location_id  TEXT NOT NULL,
          pattern_id   TEXT,
          mode_id      TEXT,
          kind         TEXT NOT NULL,
          body         TEXT NOT NULL,
          status       TEXT NOT NULL DEFAULT 'open',
          resolution   TEXT,
          created_at   TEXT NOT NULL DEFAULT (datetime('now')),
          actioned_at  TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_feedback_status   ON feedback(status);
        CREATE INDEX IF NOT EXISTS idx_feedback_location ON feedback(location_id);
        CREATE INDEX IF NOT EXISTS idx_feedback_pattern  ON feedback(pattern_id);

        CREATE TABLE IF NOT EXISTS feedback_message (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          feedback_id INTEGER NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
          author      TEXT NOT NULL CHECK (author IN ('claude', 'user')),
          body        TEXT NOT NULL,
          created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_feedback_message_feedback_id ON feedback_message(feedback_id);
      `)

      server.middlewares.use('/api/feedback', async (req, res, next) => {
        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          // pathname examples: '', '/42', '/42/messages', '/42/messages/7'
          const segments = url.pathname.replace(/^\/|\/$/g, '').split('/').filter(Boolean)
          const idMatch  = segments[0]?.match(/^\d+$/) ? segments[0] : null
          const isMessages = idMatch && segments[1] === 'messages'
          const messageId = isMessages && segments[2]?.match(/^\d+$/) ? segments[2] : null
          const method = req.method ?? 'GET'

          // ── /api/feedback (list) ───────────────────────────────────────
          if (method === 'GET' && !idMatch) {
            const status = url.searchParams.get('status')
            const locationId = url.searchParams.get('locationId')
            const patternId = url.searchParams.get('patternId')
            const modeId = url.searchParams.get('modeId')

            const where: string[] = []
            const params: (string | null)[] = []
            if (status) { where.push('status = ?'); params.push(status) }
            if (locationId) { where.push('location_id = ?'); params.push(locationId) }
            if (patternId) { where.push('pattern_id = ?'); params.push(patternId) }
            if (modeId) { where.push('mode_id = ?'); params.push(modeId) }
            const sql = `SELECT * FROM feedback${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC`
            const rows = db.prepare(sql).all(...params) as FeedbackRow[]
            return sendJson(res, 200, attachMessages(db, rows))
          }

          // ── /api/feedback/:id (single) ─────────────────────────────────
          if (method === 'GET' && idMatch && !isMessages) {
            const row = db.prepare('SELECT * FROM feedback WHERE id = ?').get(idMatch) as FeedbackRow | undefined
            if (!row) return sendJson(res, 404, { error: 'not found' })
            return sendJson(res, 200, attachMessages(db, [row])[0])
          }

          // ── /api/feedback (create) ─────────────────────────────────────
          if (method === 'POST' && !idMatch) {
            const raw = await readBody(req)
            const data = JSON.parse(raw) as { locationId: string; patternId?: string; modeId?: string; kind: string; body: string }
            if (!data.locationId || !data.kind || !data.body) {
              return sendJson(res, 400, { error: 'locationId, kind, body required' })
            }
            const result = db.prepare(`
              INSERT INTO feedback (location_id, pattern_id, mode_id, kind, body)
              VALUES (?, ?, ?, ?, ?)
            `).run(data.locationId, data.patternId ?? null, data.modeId ?? null, data.kind, data.body)
            const row = db.prepare('SELECT * FROM feedback WHERE id = ?').get(result.lastInsertRowid) as FeedbackRow
            return sendJson(res, 201, attachMessages(db, [row])[0])
          }

          // ── /api/feedback/:id (update) ─────────────────────────────────
          if (method === 'PATCH' && idMatch && !isMessages) {
            const raw = await readBody(req)
            const data = JSON.parse(raw) as { status?: string; resolution?: string }
            const sets: string[] = []
            const params: (string | null)[] = []
            if (data.status !== undefined) {
              sets.push('status = ?'); params.push(data.status)
              if (data.status === 'actioned') sets.push("actioned_at = datetime('now')")
              if (data.status === 'open') sets.push('actioned_at = NULL')
            }
            if (data.resolution !== undefined) {
              sets.push('resolution = ?'); params.push(data.resolution)
            }
            if (sets.length === 0) return sendJson(res, 400, { error: 'no fields to update' })
            params.push(idMatch)
            db.prepare(`UPDATE feedback SET ${sets.join(', ')} WHERE id = ?`).run(...params)
            const row = db.prepare('SELECT * FROM feedback WHERE id = ?').get(idMatch) as FeedbackRow | undefined
            if (!row) return sendJson(res, 404, { error: 'not found' })
            return sendJson(res, 200, attachMessages(db, [row])[0])
          }

          // ── /api/feedback/:id (delete) ─────────────────────────────────
          if (method === 'DELETE' && idMatch && !isMessages) {
            db.prepare('DELETE FROM feedback WHERE id = ?').run(idMatch)
            res.statusCode = 204
            res.end()
            return
          }

          // ── /api/feedback/:id/messages (list) ──────────────────────────
          if (method === 'GET' && isMessages && !messageId) {
            const rows = db.prepare(
              'SELECT * FROM feedback_message WHERE feedback_id = ? ORDER BY created_at ASC'
            ).all(idMatch) as MessageRow[]
            return sendJson(res, 200, rows.map(toCamelMessage))
          }

          // ── /api/feedback/:id/messages (create) ────────────────────────
          if (method === 'POST' && isMessages && !messageId) {
            const raw = await readBody(req)
            const data = JSON.parse(raw) as { author: 'claude' | 'user'; body: string }
            if (!data.author || !data.body) {
              return sendJson(res, 400, { error: 'author and body required' })
            }
            if (data.author !== 'claude' && data.author !== 'user') {
              return sendJson(res, 400, { error: 'author must be "claude" or "user"' })
            }
            const exists = db.prepare('SELECT id FROM feedback WHERE id = ?').get(idMatch)
            if (!exists) return sendJson(res, 404, { error: 'parent feedback not found' })
            const result = db.prepare(`
              INSERT INTO feedback_message (feedback_id, author, body)
              VALUES (?, ?, ?)
            `).run(idMatch, data.author, data.body)
            const row = db.prepare('SELECT * FROM feedback_message WHERE id = ?').get(result.lastInsertRowid) as MessageRow
            return sendJson(res, 201, toCamelMessage(row))
          }

          // ── /api/feedback/:id/messages/:mid (delete) ───────────────────
          if (method === 'DELETE' && isMessages && messageId) {
            db.prepare('DELETE FROM feedback_message WHERE id = ? AND feedback_id = ?').run(messageId, idMatch)
            res.statusCode = 204
            res.end()
            return
          }

          next()
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          sendJson(res, 500, { error: message })
        }
      })
    },

    closeBundle() {
      db?.close()
    },
  }
}
