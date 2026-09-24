import { closeDb, purgeRetentionBatch } from "../lib/db"
try { console.log(JSON.stringify(await purgeRetentionBatch())) }
finally { await closeDb() }
