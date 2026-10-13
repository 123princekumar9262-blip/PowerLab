import { inflateSync } from 'node:zlib'

/**
 * A minimal PNG decoder for the browser checks (8-bit RGB / RGBA, non-interlaced — what Playwright's screenshots
 * are). Returns { width, height, channels, data }.
 */
export function decodePng(buf) {
  let pos = 8
  let width = 0
  let height = 0
  let channels = 4
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const body = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      const colorType = body[9]
      channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
      if (!channels || body[8] !== 8 || body[12] !== 0) throw new Error('decodePng: only 8-bit RGB/RGBA non-interlaced')
    } else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const data = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const out = data.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? data.subarray((y - 1) * stride, y * stride) : null
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? out[i - channels] : 0
      const b = prev ? prev[i] : 0
      const c = prev && i >= channels ? prev[i - channels] : 0
      let v = src[i]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      out[i] = v & 255
    }
  }
  return { width, height, channels, data }
}

/** Fraction of pixels whose colour differs from the most common colour (the empty background) by more than `tol`. */
export function drawnFraction(png, tol = 24) {
  const { data, channels, width, height } = png
  const counts = new Map()
  for (let i = 0; i < data.length; i += channels * 7) {
    const k = (data[i] >> 3) * 1024 + (data[i + 1] >> 3) * 32 + (data[i + 2] >> 3)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const bgKey = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  const bg = [((bgKey >> 10) & 31) << 3, ((bgKey >> 5) & 31) << 3, (bgKey & 31) << 3]
  let n = 0
  for (let i = 0; i < data.length; i += channels) if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > tol) n++
  return n / (width * height)
}
