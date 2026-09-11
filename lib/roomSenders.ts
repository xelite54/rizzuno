/**
 * addTrack creates sendrecv transceivers that an incoming offer can reuse.
 * Pre-created addTransceiver transceivers are NOT reusable by the answerer:
 * its camera would stay on an unassociated sender while a new receiver is
 * negotiated. Keep these senders for the entire room; switches only replace.
 */
export function createRoomSenders(pc: RTCPeerConnection) {
  let video: RTCRtpSender | null = null
  let audio: RTCRtpSender | null = null
  const group = new MediaStream()

  return {
    async sync(videoTrack: MediaStreamTrack | null, audioTrack: MediaStreamTrack | null, micEnabled: boolean) {
      const liveVideo = videoTrack?.readyState === "live" ? videoTrack : null
      const liveAudio = audioTrack?.readyState === "live" ? audioTrack : null
      if (!video && liveVideo) video = pc.addTrack(liveVideo, group)
      if (!audio && liveAudio) {
        // Even muted-at-match needs a reusable audio transceiver. Disable
        // capture before adding, then detach before advertising rtc-ready.
        liveAudio.enabled = micEnabled
        audio = pc.addTrack(liveAudio, group)
      }
      const desiredAudio = micEnabled ? liveAudio : null
      await Promise.all([
        video && video.track !== liveVideo ? video.replaceTrack(liveVideo) : undefined,
        audio && audio.track !== desiredAudio ? audio.replaceTrack(desiredAudio) : undefined,
      ])
      return Boolean(video && audio && video.track === liveVideo && liveVideo?.enabled)
    },
    get video() { return video },
    get audio() { return audio },
  }
}
