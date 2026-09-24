/** Real remote WS/account/database control-plane probe; does NOT simulate media. */
import { readFile } from "node:fs/promises"
import { WebSocket } from "ws"
import { stagingTargets } from "./stagingGuard.mts"
const {web,ws} = stagingTargets()
const readiness=await fetch(new URL('/api/staging/ready',web),{headers:{'x-staging-probe':process.env.STAGING_PROBE_SECRET!},redirect:'error',signal:AbortSignal.timeout(10_000)})
if (!readiness.ok || (await readiness.json()).environment!=='staging') throw new Error('Target did not attest staging; no sockets opened')
// Tickets must come from normal authenticated staging ticket issuance. Never
// accept AUTH_SECRET/REALTIME_TICKET_SECRET or mint identities in this harness.
if (process.env.AUTH_SECRET || process.env.REALTIME_TICKET_SECRET || process.env.DATABASE_URL) throw new Error('Harness refuses signing keys or database credentials')
const tickets: unknown=JSON.parse(await readFile(process.env.STAGING_TICKETS_FILE ?? '', 'utf8'))
if (!Array.isArray(tickets) || tickets.length<4 || tickets.length>100 || tickets.length%2 || tickets.some(value=>typeof value!=='string' || value.length>4096)) throw new Error('Supply 4–100 fresh authenticated staging tickets, an even count')
const sockets:WebSocket[]=[]
const timers: ReturnType<typeof setTimeout>[]=[]
let ready=0,matches=0,reports=0,errors=0
const connectedAt=performance.now(),latencies:number[]=[]
const deadline=setTimeout(()=>{for(const socket of sockets)socket.terminate();console.error('Staging probe deadline exceeded');process.exitCode=1},60_000)
try {
  await Promise.all(tickets.map((ticket,index)=>new Promise<void>((resolve,reject)=>{
    const socket=new WebSocket(ws,{origin:web.origin,handshakeTimeout:10_000});sockets.push(socket)
    let matched=false,completed=false
    const timeout=setTimeout(()=>reject(new Error('Staging client failed to complete report/rematch')),45_000);timers.push(timeout)
    socket.once('error',reject)
    socket.once('close',()=>{if(!completed)reject(new Error('Unexpected staging disconnect'))})
    socket.once('open',()=>socket.send(JSON.stringify({type:'hello',ticket,handle:`staging-${index}`,gender:index%2?'female':'male',profilePhoto:null})))
    socket.on('message',data=>{
      const message=JSON.parse(data.toString())
      if(message.type==='error'){errors++;reject(new Error(`Staging server rejected client: ${message.code ?? 'unknown'}`))}
      if(message.type==='ready'){ready++;socket.send(JSON.stringify({type:'find'}))}
      if(message.type==='matched') {
        matches++;latencies.push(performance.now()-connectedAt)
        if(!matched){matched=true;if(message.initiator)socket.send(JSON.stringify({type:'report',roomId:message.roomId,category:'other',details:'Authorized staging load probe; synthetic test accounts only'}))}
        else { completed=true;clearTimeout(timeout);resolve() }
      }
      if(message.type==='reported'){reports++;socket.send(JSON.stringify({type:'skip'}))}
      if(message.type==='peer-left' || message.type==='match-failed')socket.send(JSON.stringify({type:'find'}))
    })
  })))
  latencies.sort((a,b)=>a-b)
  if(ready!==tickets.length || reports<tickets.length/2 || errors)throw new Error('Incomplete staging coverage')
  console.log(JSON.stringify({environment:'staging',clients:tickets.length,ready,matches,reports,errors,matchP95Ms:latencies[Math.ceil(latencies.length*.95)-1],mediaTested:false,turnTested:false}))
} finally {clearTimeout(deadline);for(const timer of timers)clearTimeout(timer);for(const socket of sockets)socket.terminate()}
