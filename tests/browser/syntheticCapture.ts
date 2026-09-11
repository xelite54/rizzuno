/** Deterministic camera/microphone fixtures; all tracks and RTP are real browser media. */
export function installSyntheticCapture(side: "a" | "b") {
  Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async (constraints: MediaStreamConstraints) => {
    const stream = new MediaStream()
    if (constraints.video) {
      const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 240
      const context = canvas.getContext("2d")!
      let frame = 0
      const paint = () => {
        context.fillStyle = side === "a" ? "#ff0000" : "#0000ff"; context.fillRect(0, 0, 320, 240)
        context.fillStyle = "white"; context.fillRect((frame++ * 8) % 280, 180, 10, 20)
      }
      paint()
      const timer = setInterval(paint, 1000 / 15)
      const track = canvas.captureStream(15).getVideoTracks()[0]
      const stop = track.stop.bind(track)
      track.stop = () => { clearInterval(timer); stop() }
      stream.addTrack(track)
    }
    if (constraints.audio) {
      const context = new AudioContext()
      const destination = context.createMediaStreamDestination()
      const oscillator = context.createOscillator(); oscillator.frequency.value = side === "a" ? 440 : 660
      const gain = context.createGain(); gain.gain.value = 0.01
      oscillator.connect(gain); gain.connect(destination); oscillator.start(); void context.resume()
      const track = destination.stream.getAudioTracks()[0]
      const stop = track.stop.bind(track)
      track.stop = () => { stop(); if (context.state !== "closed") void context.close().catch(() => {}) }
      stream.addTrack(track)
    }
    return stream
  } })
  Object.defineProperty(navigator.mediaDevices, "enumerateDevices", { configurable: true, value: async () => [{ kind: "videoinput", deviceId: "synthetic-camera" }] })
}
