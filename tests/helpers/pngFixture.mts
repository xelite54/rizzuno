import { deflateSync } from "node:zlib"

/**
 * Builds a real, minimal, valid PNG (uncompressed-content but validly
 * zlib-wrapped, 8-bit RGB, no filtering) at whatever size is asked for —
 * used by the image-moderation tests so they exercise
 * lib/imageModeration/imageValidation.ts's actual magic-byte + `image-size`
 * decode path against real bytes, not a hand-waved fake "looks like a PNG"
 * string. Every pixel is opaque black; content doesn't matter here, only
 * that the container is genuinely well-formed.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buf) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, "ascii")
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([length, typeBuf, data, crc])
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * `pixelRows` lets a test claim an enormous `height` in IHDR (exactly what
 * a decompression-bomb-style upload would do) without this helper actually
 * allocating/deflating a real buffer that size — image-size (like every
 * real PNG decoder) reads width/height straight from the fixed IHDR chunk,
 * never from how much IDAT data is actually present, so a tiny IDAT behind
 * a huge declared height is exactly the shape of file this is meant to let
 * validateAndDecodeImage's dimension check reject. Defaults to `height`
 * (a real, fully-formed image) when omitted.
 */
export function buildPngBytes(width: number, height: number, pixelRows = height): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: RGB (no alpha)
  ihdr[10] = 0 // compression method
  ihdr[11] = 0 // filter method
  ihdr[12] = 0 // interlace method

  // One filter-type byte (0 = none) per scanline, followed by 3 bytes/pixel.
  const raw = Buffer.alloc(pixelRows * (1 + width * 3))
  const idat = deflateSync(raw)

  return Buffer.concat([PNG_SIGNATURE, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0))])
}

export function buildPngDataUrl(width: number, height: number): string {
  return `data:image/png;base64,${buildPngBytes(width, height).toString("base64")}`
}
