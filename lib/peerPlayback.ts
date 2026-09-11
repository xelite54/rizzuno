/** Carries exact remote ownership as well as element playback evidence. */
export type PeerPlaybackReport = {
  roomId: string
  stream: MediaStream
  track: MediaStreamTrack
  playing: boolean
  readyState: number
  videoWidth: number
  videoHeight: number
}
