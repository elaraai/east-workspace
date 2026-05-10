#!/usr/bin/env node
// Post a Claude reply to feedback. Usage:
//   node scripts/feedback-reply.mjs <id> "<reply body>"
import Database from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const dbPath = path.resolve(here, '..', 'data', 'feedback.db')
const db = new Database(dbPath)

const id = process.argv[2]
const body = process.argv[3]

if (!id || !body) {
  console.error('Usage: node scripts/feedback-reply.mjs <id> "<reply body>"')
  process.exit(1)
}

const parent = db.prepare('SELECT * FROM feedback WHERE id = ?').get(id)
if (!parent) {
  console.error(`Feedback #${id} not found`)
  process.exit(1)
}

const result = db.prepare(`
  INSERT INTO feedback_message (feedback_id, author, body)
  VALUES (?, 'claude', ?)
`).run(id, body)

console.log(`✓ posted reply on feedback #${id} (message ${result.lastInsertRowid})`)
console.log(`  ${parent.location_id} · ${parent.kind}`)
console.log(`  → ${body.length > 80 ? body.slice(0, 80) + '…' : body}`)
