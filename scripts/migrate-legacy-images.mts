import { Pool } from "pg"
import { databaseConfig } from "../lib/dbConfig"
import { moderateImage } from "../lib/imageModeration"
import { storeApprovedImage } from "../lib/imageStorage"
import { closeDb, cleanupUnreferencedStoredImage } from "../lib/db"

/** Explicit operator invocation only; never runs at startup. Bounded, resumable
 * keyset scan, compare-and-swap update. A rejection/failure leaves the old value. */
const apply = process.argv.includes("--apply")
const limit = Number(process.env.IMAGE_MIGRATION_LIMIT ?? 100)
if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid IMAGE_MIGRATION_LIMIT")
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required")
const pool = new Pool(databaseConfig(process.env.DATABASE_URL))
let migrated = 0, failed = 0, detected = 0
try {
  for (const [table, column, surface] of [["users", "profile_photo", "profile_photo"], ["user_posts", "data_url", "post"]] as const) {
    let cursor = ""
    while (detected < limit) {
      const { rows } = await pool.query(`SELECT id, ${table === "users" ? "id" : "user_id"} AS user_id, ${column} AS image FROM ${table} WHERE ${column} LIKE 'data:image/%' AND id>$1 ORDER BY id LIMIT 1`, [cursor])
      if (!rows.length) break
      const row = rows[0]; cursor = row.id; detected++
      if (!apply) continue
      let reference: string | undefined
      try {
        const result = await moderateImage({ userId: row.user_id, dataUrl: row.image, surface })
        reference = await storeApprovedImage(result)
        // Full upload + read-back verification completed before old bytes replaced.
        const update = await pool.query(`UPDATE ${table} SET ${column}=$1 WHERE id=$2 AND ${column}=$3`, [reference,row.id,row.image])
        migrated += update.rowCount ?? 0
      } catch { failed++ }
      finally { await cleanupUnreferencedStoredImage(reference) }
    }
  }
  console.log(JSON.stringify({ apply, detected, migrated, failed }))
  if (failed) process.exitCode = 1
} finally { await pool.end(); await closeDb() }
