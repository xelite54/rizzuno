// Operator-only, explicit operation. Does not deploy application code.
import { Pool } from "pg"
import { readFile } from "node:fs/promises"
import { databaseConfig } from "../lib/dbConfig"
import { MIGRATIONS } from "../lib/migrations"
if (!process.argv.includes("--apply")) throw new Error("Explicit --apply required")
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required")
const pool = new Pool(databaseConfig(process.env.DATABASE_URL))
const client = await pool.connect().catch(async () => {
  console.error("Database connection failed; verify credentials, network and trusted CA without disabling TLS verification.")
  await pool.end(); process.exit(1)
})
try {
  for (const migration of MIGRATIONS.filter(m => /^001[34]_/.test(m.id))) {
    await client.query("BEGIN")
    await client.query("SET LOCAL lock_timeout='5s'")
    const claimed = await client.query("INSERT INTO schema_migrations(id,applied_at) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id",[migration.id,Date.now()])
    if(claimed.rowCount) await client.query(migration.sql)
    await client.query("COMMIT")
    console.log(JSON.stringify({migration:migration.id, applied:Boolean(claimed.rowCount)}))
  }
  await client.query(await readFile("scripts/verify-database-security.sql","utf8"))
  console.log("Database security and constraints verified through server pg connection")
} catch {
  await client.query("ROLLBACK").catch(()=>{})
  console.error("Database hardening failed; current migration rolled back. Inspect safely with the operator.")
  process.exitCode=1
} finally { client.release();await pool.end() }
