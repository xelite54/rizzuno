import { installSyntheticCapture } from "./syntheticCapture"
import { StrictMode, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { useLocalMedia } from "../../hooks/useLocalMedia"
import { useMatchmaking } from "../../hooks/useMatchmaking"
import { retainRealtime } from "../../lib/realtimeLifecycle"
import { SelfPanel } from "../../components/match/SelfPanel"
import { VideoTile } from "../../components/match/VideoTile"

const peers: RTCPeerConnection[] = []
const sockets: WebSocket[] = []
const events: { event: string; details: Record<string, unknown> }[] = []
const NativePeer = window.RTCPeerConnection
window.RTCPeerConnection = class extends NativePeer {
  constructor(config?: RTCConfiguration) { super(config); peers.push(this) }
  // Force audio-first delivery through real received tracks. The delayed
  // video event must publish a new React stream binding and reach playback.
  set ontrack(handler: ((event: RTCTrackEvent) => void) | null) {
    super.ontrack = handler ? event => {
      if (event.track.kind === "video") setTimeout(() => handler.call(this, event), 100)
      else handler.call(this, event)
    } : null
  }
  get ontrack() { return super.ontrack }

}
const NativeSocket = window.WebSocket
window.WebSocket = class extends NativeSocket {
  constructor(url: string | URL, protocols?: string | string[]) { super(url, protocols); sockets.push(this) }
}
const nativeLog = console.log
console.log = (...args) => {
  if (typeof args[0] === "string" && args[0].startsWith("webrtc:")) events.push({ event: args[0], details: args[1] })
  nativeLog(...args)
}
const account = new URLSearchParams(location.search).get("account") ?? "browser-a"
installSyntheticCapture(account === "browser-a" ? "a" : "b")
let ticketAccount = account
const nativeFetch = window.fetch.bind(window)
window.fetch = (input, init) => {
  if (input === "/api/realtime/ticket") return nativeFetch(`/api/realtime/ticket?account=${ticketAccount}`, init)
  return nativeFetch(input, init)
}
let blockAudio = false
let blockVideo = false
const nativePlay = HTMLMediaElement.prototype.play
HTMLMediaElement.prototype.play = function () {
  if (this.getAttribute("data-video-role") === "peer" && (blockVideo || (blockAudio && !this.muted))) return Promise.reject(new DOMException("test autoplay restriction", "NotAllowedError"))
  return nativePlay.call(this)
}

function App() {
  const local = useLocalMedia()
  const [activeAccount, setActiveAccount] = useState(account)
  const [hydration, setHydration] = useState(true)
  const [signedIn, setSignedIn] = useState(true)
  const [renderCount, setRenderCount] = useState(0)
  const enabled = retainRealtime(activeAccount, signedIn ? activeAccount : undefined, hydration ? "accepted" : "checking", hydration, hydration)
  const match = useMatchmaking(enabled, local.videoTrack, local.audioTrack, local.micEnabled, activeAccount, activeAccount, activeAccount === "browser-a" ? "male" : "female", null, signedIn ? activeAccount : undefined)
  useEffect(() => {
    const interval = setInterval(() => setRenderCount(n => n + 1), 250)
    return () => clearInterval(interval)
  }, [])
  useEffect(() => {
    const sample = (role: string) => {
      const video = document.querySelector<HTMLVideoElement>(`video[data-video-role="${role}"]`)
      if (!video) return null
      const canvas = document.createElement("canvas"); canvas.width = 1; canvas.height = 1
      const context = canvas.getContext("2d")!
      if (video.readyState >= 2) context.drawImage(video, 0, 0, 1, 1)
      return { playing: !video.paused && video.readyState >= 2 && video.videoWidth > 0, width: video.videoWidth, height: video.videoHeight, time: video.currentTime,
        muted: video.muted, correctStream: video.srcObject === (role === "self" ? local.localStream : match.remoteStream), rgb: [...context.getImageData(0, 0, 1, 1).data].slice(0, 3) }
    }
    Object.assign(window, { harness: {
      interruptTransport: (state: "disconnected" | null) => {
        const pc = peers.findLast(p => p.connectionState !== "closed")!
        if (state) Object.defineProperty(pc, "connectionState", { configurable: true, value: state })
        else Reflect.deleteProperty(pc, "connectionState")
        pc.dispatchEvent(new Event("connectionstatechange"))
      },
      find: match.findMatch, skip: match.skip, pause: match.pauseMatching, mute: local.toggleMic,
      invite: (target: string) => match.inviteFriendToMatch(target),
      changeAccount: (value: string) => { ticketAccount = value; setActiveAccount(value) },
      accept: () => { const invite = match.matchInvitations.find(i => i.direction === "incoming"); if (invite) match.respondToMatchInvitation(invite.id, true) },
      hydrate: (value: boolean) => setHydration(value), signOut: () => setSignedIn(false),
      blockAudio: (value: boolean) => { blockAudio = value }, blockVideo: (value: boolean) => { blockVideo = value },
      switchCamera: async () => { const devices = await navigator.mediaDevices.enumerateDevices(); await local.selectCamera(devices.find(d => d.kind === "videoinput")!.deviceId) },
      endCaptureAndResume: () => { local.videoTrack?.stop(); local.audioTrack?.stop(); document.dispatchEvent(new Event("visibilitychange")) },
      snapshot: async () => {
        const pc = peers.findLast(p => p.connectionState !== "closed")
        const stats = pc ? await pc.getStats() : null
        let incomingFrames = 0; let outgoingFrames = 0
        stats?.forEach(s => { if (s.kind === "video" && s.type === "inbound-rtp") incomingFrames += s.framesDecoded ?? 0; if (s.kind === "video" && s.type === "outbound-rtp") outgoingFrames += s.framesSent ?? 0 })
        return { state: match.state, roomId: match.roomId, ready: match.realtimeReady, status: local.status, renderCount, micEnabled: local.micEnabled,
          invitations: match.matchInvitations.map(i => ({ direction: i.direction })), inviteError: match.matchInviteError,
          pcCount: peers.length, openPeers: peers.filter(p => p.connectionState !== "closed").length,
          socketCount: sockets.length, openSockets: sockets.filter(s => s.readyState === WebSocket.OPEN).length,
          iceState: pc?.iceConnectionState, connectionState: pc?.connectionState, transceivers: pc?.getTransceivers().map(t => ({ kind: t.receiver.track.kind, direction: t.direction, currentDirection: t.currentDirection, associated: t.mid !== null })),
          senderMatchesLocal: Boolean(local.videoTrack && pc?.getSenders().some(s => s.track === local.videoTrack)),
          audioSenderAttached: Boolean(pc?.getSenders().some(s => s.track?.kind === "audio")),
          receiverMatchesRemote: Boolean(match.remoteStream?.getVideoTracks()[0] && pc?.getReceivers().some(r => r.track === match.remoteStream!.getVideoTracks()[0])),
          separateStreams: Boolean(match.remoteStream && local.localStream && match.remoteStream !== local.localStream && !match.remoteStream.getTracks().some(t => local.localStream!.getTracks().includes(t))),
          self: sample("self"), peer: sample("peer"), incomingFrames, outgoingFrames, events,
        }
      },
    } })
  })
  return <main data-render-count={renderCount}>
    <div style={{ width: 320, height: 240, position: "relative" }}><SelfPanel localStream={local.localStream} status={local.status} /></div>
    <div style={{ width: 320, height: 240, position: "relative" }}><VideoTile role="peer" remoteStream={match.remoteStream} roomId={match.roomId} onPlaybackReady={match.reportRemoteVideoPlaying} /></div>
  </main>
}
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>)
