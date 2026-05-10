#!/usr/bin/env node
// List feedback rows. Usage: node scripts/feedback-list.mjs [open|actioned|wontfix|all]
import Database from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const dbPath = path.resolve(here, '..', 'data', 'feedback.db')
const db = new Database(dbPath, { readonly: true })

const status = process.argv[2] ?? 'open'
const where = status === 'all' ? '' : 'WHERE status = ?'
const params = status === 'all' ? [] : [status]
const rows = db.prepare(`SELECT * FROM feedback ${where} ORDER BY created_at DESC`).all(...params)

if (rows.length === 0) {
  console.log(`(no ${status} feedback)`)
  process.exit(0)
}

for (const r of rows) {
  console.log('─'.repeat(72))
  console.log(`#${r.id}  [${r.kind.toUpperCase()}]  ${r.location_id}`)
  console.log(`  status: ${r.status}    created: ${r.created_at}${r.actioned_at ? `    actioned: ${r.actioned_at}` : ''}`)
  console.log()
  console.log(r.body.split('\n').map(l => '  ' + l).join('\n'))
  if (r.resolution) {
    console.log()
    console.log('  ✓ ' + r.resolution.split('\n').join('\n    '))
  }
  console.log()
}
console.log(`(${rows.length} ${status})`)
