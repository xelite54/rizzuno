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

/** Background tabs may stop presenting frames even while RTP is healthy. */
export function playbackHasStalled(visible: boolean, now: number, lastProgress: number): boolean {
  return visible && now - lastProgress > 5000
}
