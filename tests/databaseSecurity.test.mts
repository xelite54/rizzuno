import { test } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { PGlite } from "@electric-sql/pglite"
import { MIGRATIONS } from "../lib/migrations.ts"

test("append-only migrations secure effective privileges, future objects and validate integrity", async () => {
  const db = new PGlite()
  try {
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE TABLE schema_migrations(id text PRIMARY KEY, applied_at bigint NOT NULL);")
    const ids = MIGRATIONS.map(m => m.id)
    assert.deepEqual(ids, [...new Set(ids)].sort())
    for (const migration of MIGRATIONS.filter(m => m.id < "0013")) await db.exec(migration.sql)
    await db.exec(`GRANT ALL ON ALL TABLES IN SCHEMA public TO anon,authenticated,PUBLIC;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated;
      ALTER DEFAULT PRIVILEGES GRANT ALL ON SEQUENCES TO anon;
      CREATE FUNCTION public.test_exposed() RETURNS integer LANGUAGE sql AS 'SELECT 1';
      CREATE SEQUENCE public.test_exposed_sequence;`)
    for (const migration of MIGRATIONS.filter(m => m.id >= "0013")) await db.exec(`BEGIN; ${migration.sql} COMMIT;`)
    await db.exec(await readFile("scripts/verify-database-security.sql", "utf8"))
    await db.exec(`CREATE TABLE future_table(id integer); CREATE SEQUENCE future_sequence;
      CREATE FUNCTION future_function() RETURNS integer LANGUAGE sql AS 'SELECT 1';`)
    await db.exec(await readFile("scripts/verify-database-security.sql", "utf8"))
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET ROLE ${role}`)
      for (const sql of ["SELECT * FROM users", "INSERT INTO users(id,created_at) VALUES('attacker',0)", "UPDATE users SET created_at=1", "DELETE FROM users", "SELECT * FROM moderation_actions", "SELECT future_function()", "SELECT nextval('future_sequence')"]) {
        await assert.rejects(db.exec(sql), (error: { code?: string }) => error.code === "42501")
      }
      await db.exec("RESET ROLE")
    }
    await db.exec("INSERT INTO users(id,created_at) VALUES('server-check',0); UPDATE users SET created_at=1 WHERE id='server-check'; DELETE FROM users WHERE id='server-check';")
    await assert.rejects(db.exec("INSERT INTO blocks(id,blocker_id,blocked_id,created_at) VALUES('bad','a','a',0)"))
    await assert.rejects(db.exec("INSERT INTO user_posts(id,user_id,data_url,created_at) VALUES('bad','missing','ref',0)"))
  } finally { await db.close() }
})
