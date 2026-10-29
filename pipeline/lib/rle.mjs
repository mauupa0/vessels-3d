// Row-wise run-length coding of a label volume: per x-row, (label, run length) pairs, run length as a LEB128 varint.
export function rleEncode(labels, dims) {
  const out = []
  const rows = dims[1] * dims[2]
  for (let r = 0; r < rows; r++) {
    const base = r * dims[0]
    let i = 0
    while (i < dims[0]) {
      const v = labels[base + i]
      let j = i + 1
      while (j < dims[0] && labels[base + j] === v) j++
      out.push(v)
      let n = j - i
      while (n >= 0x80) { out.push((n & 0x7f) | 0x80); n >>>= 7 }
      out.push(n)
      i = j
    }
  }
  return Uint8Array.from(out)
}

export function rleDecode(bytes, dims) {
  const labels = new Uint8Array(dims[0] * dims[1] * dims[2])
  let o = 0
  let p = 0
  while (p < bytes.length) {
    const v = bytes[p++]
    let n = 0
    let shift = 0
    for (;;) {
      const b = bytes[p++]
      n |= (b & 0x7f) << shift
      if (b < 0x80) break
      shift += 7
    }
    labels.fill(v, o, o + n)
    o += n
  }
  return labels
}
