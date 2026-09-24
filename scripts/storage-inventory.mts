import { closeDb, discoverOrphanedImages } from "../lib/db"
const offset = Number(process.argv[2] ?? 0)
try { console.log(JSON.stringify(await discoverOrphanedImages(offset))) }
finally { await closeDb() }
