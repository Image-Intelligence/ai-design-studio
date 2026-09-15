/**
 * Is this buffer a whole .safetensors file?
 *
 * The format is self-describing: 8 bytes of little-endian header length, that
 * many bytes of JSON, then the tensor data. Every tensor in the header carries
 * its byte range, so the largest end offset is exactly how long the file
 * should be. That makes "is this complete?" a measurement rather than a guess,
 * which matters because a partial download looks entirely normal from outside
 * — a 70 MB file tells you nothing about where the transfer stopped.
 *
 * The same check runs in the browser before an upload (see
 * inspectSafetensors in portal-v2) and here for anything the server fetches.
 */
export type SafetensorsVerdict = { complete: boolean; expected: number; size: number; reason?: string }

export function inspectSafetensors(buf: Buffer | Uint8Array): SafetensorsVerdict {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
  const size = b.length
  if (size < 8) return { complete: false, expected: 0, size, reason: 'File is empty or truncated' }

  const headerLen = Number(b.readBigUInt64LE(0))
  // An implausible length means the bytes are not a safetensors at all — an
  // HTML error page saved under the right extension is the usual culprit.
  if (!Number.isFinite(headerLen) || headerLen <= 0 || headerLen > 100_000_000) {
    return { complete: false, expected: 0, size, reason: 'Not a readable .safetensors file' }
  }
  if (size < 8 + headerLen) {
    return { complete: false, expected: 8 + headerLen, size, reason: 'Truncated inside the header' }
  }

  let header: Record<string, unknown>
  try {
    header = JSON.parse(b.subarray(8, 8 + headerLen).toString('utf8'))
  } catch {
    return { complete: false, expected: 0, size, reason: 'The header is not valid JSON' }
  }

  let end = 0
  for (const [k, v] of Object.entries(header)) {
    if (k === '__metadata__') continue
    const offs = (v as { data_offsets?: unknown })?.data_offsets
    if (Array.isArray(offs) && typeof offs[1] === 'number') end = Math.max(end, offs[1])
  }

  const expected = 8 + headerLen + end
  return size >= expected
    ? { complete: true, expected, size }
    : { complete: false, expected, size, reason: 'The download stopped early' }
}
