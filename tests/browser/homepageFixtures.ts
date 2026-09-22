// Only service boundaries are fixtures. MatchStage and its entire control tree
// render unchanged, including real React effects, Motion, and responsive CSS.
import { useSyncExternalStore } from "react"
const noop = () => {}
const asyncNoop = async () => ({})
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const peer = { displayId: "fixture-peer", handle: "Peer", username: "peer", gender: "female", profilePhoto: null }
export const scenarios = ["initial-loading", "signed-out", "idle", "auth-refresh", "legal-checking", "legal-required", "profile-loading", "camera-off", "searching", "matched", "skipped", "reconnecting", "restricted", "presence", "paused"]
let current = "initial-loading"
let revision = 0
export function setScenario(value: string) { current = value; revision++; listeners.forEach(listener => listener()) }
function useScenario() { useSyncExternalStore(subscribe, () => revision, () => 0); return current }
export function useSession() {
  const state = useScenario()
  return { data: ["initial-loading", "signed-out"].includes(state) ? null : { user: { id: "fixture-account", name: "Fixture" } }, status: state === "signed-out" ? "unauthenticated" : ["initial-loading", "auth-refresh"].includes(state) ? "loading" : "authenticated", update: asyncNoop }
}
export const signIn = asyncNoop
export const signOut = asyncNoop
export function useLegalAcceptance() {
  const state = useScenario()
  return { status: state === "legal-checking" ? "checking" : state === "legal-required" ? "required" : "accepted", errorCode: null, accept: async () => true, retry: noop, requireAcceptance: noop }
}
export function useMyProfile() {
  const state = useScenario()
  return { handle: "Fixture", username: state === "profile-loading" ? "" : "fixture", gender: "male", profilePhoto: null, profileHydrated: state !== "profile-loading", bio: "", posts: [], setUsername: noop, setGender: noop, setBio: noop, updateProfilePhoto: asyncNoop, addPost: asyncNoop, removePost: asyncNoop }
}
let media: MediaStream | null = null
export function setMedia(value: MediaStream) { media = value }
export function useLocalMedia() {
  const state = useScenario()
  const available = !["camera-off", "initial-loading"].includes(state)
  return { localStream: available ? media : null, videoTrack: available ? media?.getVideoTracks()[0] : null, audioTrack: available ? media?.getAudioTracks()[0] : null, status: available ? "granted" : "unavailable", micEnabled: true, toggleMic: noop }
}
export function useMatchmaking() {
  const state = useScenario()
  return {
    realtimeReady: !["reconnecting", "initial-loading"].includes(state), activeOnAnotherDevice: false, retryRealtimeConnection: noop,
    state: state === "matched" ? "active" : state === "skipped" ? "queue-pending" : state === "searching" ? "searching" : state === "paused" ? "paused" : "idle",
    roomId: state === "matched" ? `room-${revision}` : null, callExpiresAt: null, peer: state === "matched" ? peer : null,
    restriction: state === "restricted" ? { reason: "connection_failed" } : null,
    canMatchChat: state === "matched", peerMicEnabled: true, peerTyping: false, remoteStream: null,
    onlineCount: revision, messages: [], history: [], friends: [], friendRequestsReceived: [], blockedUsers: [], matchInvitations: [],
    friendActionState: new Map(), friendMessages: new Map(), peerFriendTyping: new Map(), friendToastRequestId: null, matchInviteError: null,
    reportRemoteVideoPlaying: noop, findMatch: noop, resumeMatching: noop, leaveQueueOnly: noop, skip: noop, pauseMatching: noop, sendChat: noop, notifyTyping: noop, report: noop, block: noop, unblockUser: noop, sendFriendRequestTo: noop, respondToFriendRequest: noop, unfriend: noop, blockFriendAccount: noop, reportUser: noop, dismissFriendToast: noop, inviteFriendToMatch: noop, respondToMatchInvitation: noop, sendFriendChatMessage: noop, markFriendChatRead: noop, notifyFriendTyping: noop,
  }
}
export { ImageModerationRejectedError } from "../../hooks/useMyProfile"
