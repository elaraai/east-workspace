#!/usr/bin/env node
// Mark feedback actioned. Usage: node scripts/feedback-resolve.mjs <id> "<resolution note>"
import Database from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const dbPath = path.resolve(here, '..', 'data', 'feedback.db')
const db = new Database(dbPath)

const id = process.argv[2]
const resolution = process.argv[3]

if (!id) {
  console.error('Usage: node scripts/feedback-resolve.mjs <id> "<resolution note>"')
  process.exit(1)
}

const row = db.prepare('SELECT * FROM feedback WHERE id = ?').get(id)
if (!row) {
  console.error(`Feedback #${id} not found`)
  process.exit(1)
}

const sets = ["status = 'actioned'", "actioned_at = datetime('now')"]
const params = []
if (resolution) {
  sets.push('resolution = ?')
  params.push(resolution)
}
params.push(id)

db.prepare(`UPDATE feedback SET ${sets.join(', ')} WHERE id = ?`).run(...params)

const after = db.prepare('SELECT * FROM feedback WHERE id = ?').get(id)
console.log(`✓ marked #${id} actioned`)
console.log(`  ${after.location_id} · ${after.kind}`)
if (resolution) console.log(`  → ${resolution}`)
