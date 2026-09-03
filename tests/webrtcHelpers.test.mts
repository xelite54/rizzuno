import { test } from "node:test"
import assert from "node:assert/strict"
import { sortUdpFirst } from "../hooks/useWebRTC.ts"

// Pure logic only — hooks/useWebRTC.ts itself needs a real browser
// (RTCPeerConnection, getUserMedia) to exercise beyond this; see that
// file's own doc comments for what wasn't (and can't be) covered here.

test("sortUdpFirst: a plain turn: url is left in place ahead of a turns: one", () => {
  assert.deepEqual(sortUdpFirst(["turns:relay.example.com:5349", "turn:relay.example.com:3478"]), [
    "turn:relay.example.com:3478",
    "turns:relay.example.com:5349",
  ])
})

test("sortUdpFirst: a turn: url already first stays first", () => {
  const urls = ["turn:relay.example.com:3478", "turns:relay.example.com:5349"]
  assert.deepEqual(sortUdpFirst(urls), urls)
})

test("sortUdpFirst: an explicit ?transport=tcp turn: url is treated the same as turns:", () => {
  assert.deepEqual(
    sortUdpFirst(["turn:relay.example.com:3478?transport=tcp", "turn:relay.example.com:3478?transport=udp"]),
    ["turn:relay.example.com:3478?transport=udp", "turn:relay.example.com:3478?transport=tcp"]
  )
})

test("sortUdpFirst: multiple udp-capable urls all stay ahead of multiple tcp-forced ones, relative order preserved within each group", () => {
  assert.deepEqual(
    sortUdpFirst([
      "turns:a.example.com:5349",
      "turn:b.example.com:3478",
      "turns:c.example.com:5349",
      "turn:d.example.com:3478",
    ]),
    ["turn:b.example.com:3478", "turn:d.example.com:3478", "turns:a.example.com:5349", "turns:c.example.com:5349"]
  )
})

test("sortUdpFirst: an all-udp list is unchanged", () => {
  const urls = ["turn:a.example.com:3478", "turn:b.example.com:3478"]
  assert.deepEqual(sortUdpFirst(urls), urls)
})

test("sortUdpFirst: an empty list stays empty", () => {
  assert.deepEqual(sortUdpFirst([]), [])
})

test("sortUdpFirst: does not mutate its input array", () => {
  const input = ["turns:a.example.com:5349", "turn:b.example.com:3478"]
  const copy = [...input]
  sortUdpFirst(input)
  assert.deepEqual(input, copy)
})
