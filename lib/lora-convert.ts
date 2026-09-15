import { inspectSafetensors } from '@/lib/safetensors'

/**
 * Convert a kohya-style LoRA to the diffusers/PEFT layout fal loads.
 *
 * Trainers disagree about what to call the two matrices. Diffusers and PEFT
 * write `lora_A.weight` / `lora_B.weight`; kohya's sd-scripts, OneTrainer and
 * most of the tooling around them write `lora_down.weight` / `lora_up.weight`
 * plus a scalar `alpha` per module.
 *
 * fal's loaders take the PEFT names. Handed a kohya file they do not fail —
 * they match nothing, load nothing, and return a picture of the base model.
 * The job succeeds, the bill is the same, and the only evidence is that the
 * character is missing, which reads as "the LoRA is weak" rather than "the
 * LoRA was ignored". A 70 MB file that silently does nothing is a worse
 * failure than one that is rejected, so this converts rather than refuses.
 *
 * The weights themselves are untouched. `alpha` exists because kohya scales a
 * module by alpha/rank, and PEFT expresses the same thing in its config; when
 * they are equal — which is the default in every trainer that writes these —
 * the factor is 1 and the conversion is purely a rename. When they differ, the
 * factor is folded into lora_B, which is the same arithmetic the loader would
 * have done.
 */

export type LoraFormat = 'peft' | 'kohya' | 'unknown'

type TensorInfo = { dtype: string; shape: number[]; data_offsets: [number, number] }

/** Read the header without copying the tensor data. */
function readHeader(buf: Buffer): { header: Record<string, TensorInfo>; meta: unknown; start: number } {
  const headerLen = Number(buf.readBigUInt64LE(0))
  const parsed = JSON.parse(buf.subarray(8, 8 + headerLen).toString('utf8'))
  const { __metadata__, ...tensors } = parsed
  return { header: tensors as Record<string, TensorInfo>, meta: __metadata__, start: 8 + headerLen }
}

export function detectLoraFormat(buf: Buffer): LoraFormat {
  try {
    const { header } = readHeader(buf)
    const keys = Object.keys(header)
    if (keys.some(k => k.endsWith('.lora_A.weight') || k.endsWith('.lora_B.weight'))) return 'peft'
    if (keys.some(k => k.endsWith('.lora_down.weight') || k.endsWith('.lora_up.weight'))) return 'kohya'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

/** A BF16 value is the top 16 bits of the f32 with the same value. */
function scaleInPlace(block: Buffer, dtype: string, factor: number): boolean {
  if (factor === 1) return true
  if (dtype === 'BF16') {
    const f = Buffer.alloc(4)
    for (let i = 0; i + 1 < block.length; i += 2) {
      f.writeUInt16LE(0, 0)
      f.writeUInt16LE(block.readUInt16LE(i), 2)
      f.writeFloatLE(f.readFloatLE(0) * factor, 0)
      block.writeUInt16LE(f.readUInt16LE(2), i)
    }
    return true
  }
  if (dtype === 'F32') {
    for (let i = 0; i + 3 < block.length; i += 4) block.writeFloatLE(block.readFloatLE(i) * factor, i)
    return true
  }
  // F16 needs half-float encoding, which this runtime has no primitive for.
  // Refusing beats writing weights that are quietly the wrong magnitude.
  return false
}

/** The scalar in a 1-element alpha tensor. */
function readScalar(block: Buffer, dtype: string): number | null {
  if (dtype === 'BF16') {
    const f = Buffer.alloc(4)
    f.writeUInt16LE(block.readUInt16LE(0), 2)
    return f.readFloatLE(0)
  }
  if (dtype === 'F32') return block.readFloatLE(0)
  if (dtype === 'F64') return block.readDoubleLE(0)
  return null
}

export type ConversionResult =
  | { converted: true; buffer: Buffer; modules: number; rescaled: number }
  | { converted: false; reason: string }

export function convertKohyaToPeft(input: Buffer): ConversionResult {
  const whole = inspectSafetensors(input)
  if (!whole.complete) return { converted: false, reason: whole.reason ?? 'Not a complete .safetensors' }

  const { header, meta, start } = readHeader(input)

  // alpha/rank per module, so the factor can be folded into lora_B.
  const alphaOf = new Map<string, number>()
  for (const [key, info] of Object.entries(header)) {
    if (!key.endsWith('.alpha')) continue
    const [s, e] = info.data_offsets
    const v = readScalar(input.subarray(start + s, start + e), info.dtype)
    if (v !== null) alphaOf.set(key.slice(0, -'.alpha'.length), v)
  }

  const out: Record<string, TensorInfo> = {}
  const blocks: Buffer[] = []
  let offset = 0
  let modules = 0
  let rescaled = 0

  for (const [key, info] of Object.entries(header)) {
    if (key.endsWith('.alpha')) continue // expressed in the weights instead

    const isDown = key.endsWith('.lora_down.weight')
    const isUp = key.endsWith('.lora_up.weight')
    const renamed = isDown ? key.replace(/\.lora_down\.weight$/, '.lora_A.weight')
      : isUp ? key.replace(/\.lora_up\.weight$/, '.lora_B.weight')
      : key
    if (isDown) modules++

    const [s, e] = info.data_offsets
    const block = Buffer.from(input.subarray(start + s, start + e)) // copied: may be scaled

    if (isUp) {
      const moduleName = key.slice(0, -'.lora_up.weight'.length)
      const alpha = alphaOf.get(moduleName)
      // lora_B is [out, rank]; lora_A is [rank, in]. The small dimension is
      // the rank in both.
      const rank = Math.min(...info.shape)
      if (alpha !== undefined && rank > 0 && alpha !== rank) {
        if (!scaleInPlace(block, info.dtype, alpha / rank)) {
          return {
            converted: false,
            reason: `This LoRA needs rescaling (alpha ${alpha}, rank ${rank}) in ${info.dtype}, which is not supported.`,
          }
        }
        rescaled++
      }
    }

    out[renamed] = { dtype: info.dtype, shape: info.shape, data_offsets: [offset, offset + block.length] }
    blocks.push(block)
    offset += block.length
  }

  if (modules === 0) return { converted: false, reason: 'No LoRA weights found in this file.' }

  const headerObj: Record<string, unknown> = { ...out }
  if (meta) headerObj.__metadata__ = meta
  const json = Buffer.from(JSON.stringify(headerObj), 'utf8')
  // The header is padded to an 8-byte boundary, as the reference writer does.
  const pad = (8 - (json.length % 8)) % 8
  const headerBytes = Buffer.concat([json, Buffer.alloc(pad, 0x20)])
  const len = Buffer.alloc(8)
  len.writeBigUInt64LE(BigInt(headerBytes.length))

  return { converted: true, buffer: Buffer.concat([len, headerBytes, ...blocks]), modules, rescaled }
}
