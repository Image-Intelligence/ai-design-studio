import crypto from 'crypto'

// AES-256-GCM encryption for user-supplied provider API keys (ChatProviderKey).
// The data key is derived from CHAT_KEYS_SECRET (preferred) or ADMIN_PASSWORD
// (fallback — set everywhere already). NOTE: rotating whichever secret is in
// use makes previously stored keys undecryptable; users would re-enter them.

function dataKey(): Buffer | null {
  const secret = process.env.CHAT_KEYS_SECRET || process.env.ADMIN_PASSWORD
  if (!secret) return null
  return crypto.createHash('sha256').update(secret).digest()
}

export function keyCryptoAvailable(): boolean {
  return dataKey() !== null
}

// Format: base64(iv):base64(authTag):base64(ciphertext)
export function encryptKey(plain: string): string {
  const key = dataKey()
  if (!key) throw new Error('CHAT_KEYS_SECRET / ADMIN_PASSWORD not configured')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return `${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ct.toString('base64')}`
}

export function decryptKey(encrypted: string): string | null {
  try {
    const key = dataKey()
    if (!key) return null
    const [ivB64, tagB64, ctB64] = encrypted.split(':')
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8')
  } catch {
    return null // wrong secret / corrupted row — treat as no key
  }
}
