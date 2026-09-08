export function resolveRealtimeAccount(previous: string | undefined, current: string | undefined, status: string) {
  if (status === "unauthenticated") return undefined
  return current || (status === "loading" ? previous : undefined)
}

export function canSearch(roomId: string | null) { return roomId === null }
export function isCurrentRoom(roomId: string | null, incoming: string) { return roomId !== null && roomId === incoming }

export function retainRealtime(admittedAccount: string | undefined, account: string | undefined, legal: string, hydrated: boolean, onboarded: boolean) {
  if (!account || legal === "required") return false
  if (legal === "accepted" && hydrated && onboarded) return true
  return admittedAccount === account && (legal === "checking" || legal === "error" || !hydrated)
}
