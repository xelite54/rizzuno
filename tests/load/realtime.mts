/** Local-only load model: real Redis/gateway/coordinator/tickets, fixture DB.
 * No external endpoint is accepted. Use the separate DB benchmark for SQL. */
import { fork, spawn } from "node:child_process"
import { createServer } from "node:net"
import { createClient } from "redis"
import { WebSocket } from "ws"
import { mintTicket } from "../../lib/realtimeTicket.ts"

const levels = (process.env.LOAD_LEVELS ?? "100,500,1000").split(",").map(Number)
const cap = process.env.LOAD_ALLOW_LARGE === "1" ? 10_000 : 1000
if (levels.some(n => !Number.isInteger(n) || n < 2 || n > cap || n % 2)) throw new Error("Invalid load levels: even values up to cap required")
if (process.env.LOAD_TARGET_URL || process.env.DATABASE_URL) throw new Error("Local harness refuses external targets or database credentials")
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve,ms))
const percentile = (values: number[]) => {
  const sorted = [...values].sort((a,b)=>a-b)
  return { samples: sorted.length, p50: sorted[Math.ceil(sorted.length*.5)-1] ?? null, p95: sorted[Math.ceil(sorted.length*.95)-1] ?? null, p99: sorted[Math.ceil(sorted.length*.99)-1] ?? null }
}
const listener = createServer(); await new Promise<void>(r => listener.listen(0,"127.0.0.1",r))
const redisPort = (listener.address() as {port:number}).port; await new Promise<void>(r=>listener.close(()=>r()))
const redisProcess=spawn(process.env.REDIS_SERVER_BIN??"redis-server",["--bind","127.0.0.1","--port",String(redisPort),"--save","","--appendonly","no"],{stdio:"ignore"})
redisProcess.on("error",()=>{ console.error("Local Redis unavailable"); process.exitCode=1 })
const redis=createClient({url:`redis://127.0.0.1:${redisPort}`,socket:{reconnectStrategy:()=>100}}); redis.on("error",()=>{})
const children: ReturnType<typeof fork>[]=[]
const allSockets: WebSocket[]=[]
const watchdog=setTimeout(()=>{for(const c of children)c.kill("SIGKILL"); redisProcess.kill("SIGKILL"); process.exit(1)},240_000)
process.env.REALTIME_TICKET_SECRET="load-only-secret-not-for-production"
try {
  await redis.connect()
  const ports:number[]=[]
  const cpu:number[]=[],memory:number[]=[],queue:number[]=[],lag:number[]=[]
  for(let i=0;i<2;i++) {
    const child=fork("tests/helpers/clusterProcess.mts",{execArgv:["--import","tsx","--experimental-test-module-mocks"],env:{...process.env,NODE_ENV:"production",REDIS_URL:`redis://127.0.0.1:${redisPort}`},stdio:["ignore","pipe","inherit","ipc"]});children.push(child)
    let lines=""
    child.stdout!.on("data", data=>{ lines+=data.toString(); const entries=lines.split("\n"); lines=entries.pop()!; for(const line of entries) {try {const event=JSON.parse(line); if(event.event==="realtime.stream_lag")lag.push(event.fields.durationMs)}catch{ /* no raw logs */ }} })
    let lastCpu=0,lastAt=performance.now()
    child.on("message",(m: {metrics?:{cpuMicros:number;memoryBytes:number;snapshot:{queue:unknown[]}}})=>{if(m.metrics){const now=performance.now();cpu.push((m.metrics.cpuMicros-lastCpu)/((now-lastAt)*1000)*100);lastCpu=m.metrics.cpuMicros;lastAt=now;memory.push(m.metrics.memoryBytes);queue.push(m.metrics.snapshot.queue.length)}})
    ports.push(await new Promise<number>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("gateway startup timeout")),10000);child.once("message",(m:{port:number})=>{clearTimeout(timer);resolve(m.port)})}))
  }
  await delay(3200)
  for(const concurrency of levels) {
    cpu.length=memory.length=queue.length=lag.length=0
    const wsLatency:number[]=[],authLatency:number[]=[],matches:number[]=[],skipLatency:number[]=[],redisLatency:number[]=[]
    let opened=0,authenticated=0,dropped=0,failed=0,reconnected=0,intentionalClose=false
    const active: {ws:WebSocket;id:string;gender:"male"|"female";findAt:number;skipAt:number;room:string|null}[]=[]
    const sampler=setInterval(()=>{for(const c of children)c.send("metrics");const start=performance.now();void redis.ping().then(()=>redisLatency.push(performance.now()-start))},1000)
    for(let index=0;index<concurrency;index++) {
      const start=performance.now(),id=`load-${concurrency}-${index}`
      const ws=new WebSocket(`ws://127.0.0.1:${ports[index%2]}/ws`);allSockets.push(ws)
      const entry={ws,id,gender:(index%2?"female":"male") as "male"|"female",findAt:0,skipAt:0,room:null as string|null}; active.push(entry)
      ws.on("error",()=>{failed++})
      ws.on("close",()=>{if(!intentionalClose)dropped++})
      ws.on("open",()=>{opened++;wsLatency.push(performance.now()-start);ws.send(JSON.stringify({type:"hello",ticket:mintTicket(id),handle:id,gender:entry.gender,profilePhoto:null}))})
      ws.on("message",raw=>{
        const m=JSON.parse(raw.toString())
        if(m.type==="ready"){authenticated++;authLatency.push(performance.now()-start);entry.findAt=performance.now();ws.send('{"type":"find"}')}
        if(m.type==="matched") {entry.room=m.roomId;matches.push(performance.now()-entry.findAt);if(entry.skipAt) {skipLatency.push(performance.now()-entry.skipAt);entry.skipAt=0}ws.send(JSON.stringify({type:"rtc-ready",roomId:m.roomId}))}
        if(m.type==="peer-left") {entry.room=null;entry.findAt=performance.now();ws.send('{"type":"find"}')}
        if(m.type==="match-failed"||m.type==="error")failed++
      })
      await delay(10) // 100 new sockets/s; bounded ramp rather than a burst.
    }
    await delay(5000)
    for(const c of active)if(c.ws.readyState===1){c.skipAt=c.findAt=performance.now();c.ws.send('{"type":"skip"}')}
    await delay(6000)
    // Measure authenticated reconnect, not just reopening TCP.
    const first=active[0]; if(first.ws.readyState===1){first.ws.terminate();const ws=new WebSocket(`ws://127.0.0.1:${ports[0]}/ws`);allSockets.push(ws);ws.on("error",()=>{failed++});ws.on("open",()=>ws.send(JSON.stringify({type:"hello",ticket:mintTicket(first.id),handle:first.id,gender:first.gender,profilePhoto:null})));ws.on("message",raw=>{if(JSON.parse(raw.toString()).type==="ready")reconnected++})}
    await delay(2000)
    intentionalClose=true
    for(const ws of allSockets)ws.terminate()
    clearInterval(sampler)
    console.log(JSON.stringify({concurrency,backend:"fixture-database",opened,authenticated,connectionSuccess:opened/concurrency,authenticationSuccess:authenticated/concurrency,droppedSockets:dropped,expectedDisconnects:1,reconnectSuccess:reconnected,matchFailures:failed,wsMs:percentile(wsLatency),authMs:percentile(authLatency),searchToMatchMs:percentile(matches),skipRequeueMs:percentile(skipLatency),redisMs:percentile(redisLatency),coordinatorCpuPercent:percentile(cpu),processRssBytes:percentile(memory),queueDepth:percentile(queue),eventStreamLagMs:percentile(lag),postgresMs:null,dbConnectionCount:null}))
    if(opened!==concurrency||authenticated!==concurrency||failed||dropped>1||reconnected!==1)process.exitCode=1
    await delay(1000)
  }
} finally {clearTimeout(watchdog);for(const ws of allSockets)ws.terminate();for(const c of children)c.kill("SIGTERM");if(redis.isOpen)redis.destroy();redisProcess.kill("SIGTERM")}
