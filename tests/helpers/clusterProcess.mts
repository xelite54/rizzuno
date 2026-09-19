import "./dbMock.mts"
import { createServer } from "node:http"
import { createClusterGateway } from "../../server/clusterGateway.ts"
import { createRizzunoWebSocketServer, configureRealtimeCluster, realtimeSnapshot, resetRealtimeState } from "../../server/ws-server.ts"

const http = createServer((_req,res) => { res.writeHead(cluster.ready() ? 200 : 503); res.end() })
const cluster = await createClusterGateway(async backend => {
  resetRealtimeState()
  await configureRealtimeCluster(backend)
  const server = createRizzunoWebSocketServer()
  return { server, snapshot: realtimeSnapshot, stop: () => { server.close(); resetRealtimeState() } }
})
http.on("upgrade", (req,socket,head) => cluster.server.handleUpgrade(req,socket,head, ws => cluster.server.emit("connection",ws,req)))
http.listen(0,"127.0.0.1", () => process.send?.({ port: (http.address() as { port: number }).port }))
process.on("SIGTERM", () => { void cluster.close().finally(() => http.close(() => process.exit(0))) })
process.on("message", message => {
  if (message === "metrics") process.send?.({ metrics: { cpuMicros: process.cpuUsage().user + process.cpuUsage().system, memoryBytes: process.memoryUsage().rss, snapshot: realtimeSnapshot() } })
})
