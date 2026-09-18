import { isValidGender, MAX_CHAT_IMAGE_LENGTH, isValidReportCategory, type ClientMessage } from "./protocol"

// The largest legitimate inbound frame is a 2,000,000-character image data
// URL plus its JSON envelope. Compression is disabled on the server.
export const MAX_WS_PAYLOAD = MAX_CHAT_IMAGE_LENGTH + 16_384
export const isWireId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_:.\-]{1,200}$/.test(v)
const string = (v: unknown, max: number) => typeof v === "string" && v.length <= max
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
const optional = (v: unknown, check: (v: unknown) => boolean) => v === undefined || check(v)

export function isClientMessage(v: unknown): v is ClientMessage {
  if (!object(v) || typeof v.type !== "string") return false
  const room = () => isWireId(v.roomId)
  const profile = () => optional(v.username, (s) => string(s, 24)) && optional(v.gender, isValidGender)
    && optional(v.profilePhoto, (s) => s === null || string(s, MAX_CHAT_IMAGE_LENGTH))
  switch (v.type) {
    case "hello": return string(v.ticket, 2048) && string(v.handle, 40) && profile()
    case "profile-update": return Number.isSafeInteger(v.revision) && Number(v.revision) > 0 && profile()
    case "friends-refresh": case "find": case "skip": case "leave": return true
    case "rtc-ready": case "typing": case "block": return room()
    case "mic-state": return room() && typeof v.micEnabled === "boolean"
    case "signal": {
      if (!room() || !object(v.data)) return false
      const d = v.data
      if (d.kind === "ice-restart-request") return true
      if (d.kind === "offer" || d.kind === "answer") return string(d.sdp, 65_536)
      if (d.kind !== "ice" || !object(d.candidate)) return false
      const c = d.candidate
      return optional(c.candidate, (s) => string(s, 4096))
        && optional(c.sdpMid, (s) => s === null || string(s, 256))
        && optional(c.sdpMLineIndex, (n) => n === null || (Number.isInteger(n) && Number(n) >= 0 && Number(n) <= 65535))
        && optional(c.usernameFragment, (s) => s === null || string(s, 256))
    }
    case "chat": return room() && isWireId(v.clientMessageId) && object(v.content)
      && ((v.content.kind === "text" && string(v.content.text, 500))
        || (v.content.kind === "image" && string(v.content.dataUrl, MAX_CHAT_IMAGE_LENGTH)))
    case "report": case "user-report": return (v.type === "report" ? room() : isWireId(v.targetUserId))
      && isValidReportCategory(v.category) && optional(v.details, (s) => string(s, 500))
    case "unblock": case "friend-block": case "match-invite": return isWireId(v.targetUserId)
    case "match-invite-respond": return isWireId(v.invitationId) && typeof v.accept === "boolean"
    case "friend-request": return isWireId(v.targetDisplayId)
    case "friend-respond": return isWireId(v.requestId) && typeof v.accept === "boolean"
    case "unfriend": case "friend-chat-read": case "friend-typing": return isWireId(v.friendshipId)
    case "friend-chat-send": return isWireId(v.friendshipId) && isWireId(v.clientMessageId) && string(v.text, 500)
      && optional(v.replyToId, (s) => s === null || isWireId(s))
    default: return false
  }
}
