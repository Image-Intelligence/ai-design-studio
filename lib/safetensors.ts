/**
 * Is this a whole .safetensors file, and if not, what is it?
 *
 * The format is self-describing: 8 bytes of little-endian header length, that
 * many bytes of JSON, then the tensor data. Every tensor in the header carries
 * its byte range, so the largest end offset is exactly how long the file
 * should be. That makes "is this complete?" a measurement rather than a guess,
 * which matters because a partial download looks entirely normal from outside
 * — a 70 MB file tells you nothing about where the transfer stopped.
 *
 * Only the header is needed, so `buf` may be a prefix of the file as long as
 * `totalSize` says how long the whole thing is. That is what lets the server
 * check an object already in R2 by reading its first megabyte instead of
 * pulling 70 MB back out of storage.
 *
 * `reason` is written to be shown to a person. "Not a valid safetensors" sends
 * someone to re-download a file that was never the problem; naming what the
 * bytes actually are tells them what to do instead.
 */
export type SafetensorsVerdict = {
  complete: boolean
  /** How long the file should be. 0 when the header could not be read. */
  expected: number
  size: number
  reason?: string
  /** What the leading bytes look like, when they are not safetensors. */
  kind?: 'html' | 'zip' | 'plist' | 'gguf' | 'empty' | 'unknown'
}

/** Identify a file by its first bytes, so the error can say what it is. */
function sniff(b: Buffer): SafetensorsVerdict['kind'] {
  if (b.length === 0) return 'empty'
  const head = b.subarray(0, 8)
  const ascii = head.toString('latin1')
  if (/^\s*(<!doctype|<html|<\?xml)/i.test(b.subarray(0, 64).toString('latin1'))) return 'html'
  // PK\x03\x04 — a zip, which is what .ckpt/.pt are, and also what iOS hands
  // over when you pick a package rather than a file.
  if (ascii.startsWith('PK\x03\x04')) return 'zip'
  // An Apple binary property list: the metadata inside a Safari .download
  // bundle. Seeing this means the download is genuinely still in progress.
  if (ascii.startsWith('bplist0')) return 'plist'
  if (ascii.startsWith('GGUF')) return 'gguf'
  return 'unknown'
}

const DESCRIPTION: Record<NonNullable<SafetensorsVerdict['kind']>, string> = {
  html: 'This is a web page, not a model — the link needs a login, or it has expired.',
  zip: 'This is a zip archive (a .ckpt/.pt, or a folder iOS zipped up), not a .safetensors.',
  plist: 'This is a Safari download still in progress, not the finished file. Let it finish, or download it again.',
  gguf: 'This is a GGUF file, not a .safetensors.',
  empty: 'This file is empty.',
  unknown: 'This does not start like a .safetensors file.',
}

export function inspectSafetensors(
  buf: Buffer | Uint8Array,
  totalSize?: number,
): SafetensorsVerdict {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
  const size = totalSize ?? b.length

  if (b.length < 8) {
    return { complete: false, expected: 0, size, kind: 'empty', reason: DESCRIPTION.empty }
  }

  /*
   * Identify the file BEFORE trying to read a header out of it.
   *
   * A zip starts `PK\x03\x04\0\0\0\0`, which as a little-endian u64 is a
   * perfectly plausible header length of 67 MB — so parsing first produces
   * "the download stopped almost immediately" for a .ckpt that downloaded
   * fine. Any recognised signature is a better answer than any measurement.
   */
  const signature = sniff(b)
  if (signature && signature !== 'unknown') {
    return { complete: false, expected: 0, size, kind: signature, reason: DESCRIPTION[signature] }
  }

  const headerLen = Number(b.readBigUInt64LE(0))
  // An implausible length means these are not safetensors bytes at all, so say
  // what they are instead of blaming the download.
  if (!Number.isFinite(headerLen) || headerLen <= 0 || headerLen > 100_000_000) {
    const kind = sniff(b)
    return { complete: false, expected: 0, size, kind, reason: DESCRIPTION[kind!] }
  }
  // The header itself is missing bytes: truncated, and very early.
  if (size < 8 + headerLen) {
    return { complete: false, expected: 8 + headerLen, size, reason: 'The download stopped almost immediately.' }
  }
  // We were handed a prefix too short to contain the header we were promised.
  if (b.length < 8 + headerLen) {
    return { complete: false, expected: 0, size, reason: 'Could not read the whole header.' }
  }

  let header: Record<string, unknown>
  try {
    header = JSON.parse(b.subarray(8, 8 + headerLen).toString('utf8'))
  } catch {
    const kind = sniff(b)
    return {
      complete: false,
      expected: 0,
      size,
      kind,
      reason: kind === 'unknown' ? 'The file header is unreadable.' : DESCRIPTION[kind!],
    }
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
    : { complete: false, expected, size, reason: 'The download stopped early.' }
}
