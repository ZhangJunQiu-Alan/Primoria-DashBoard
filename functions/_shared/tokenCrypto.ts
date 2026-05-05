import { HttpError } from './http'

function base64UrlEncode(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function getAesKey(secret: string) {
  if (!secret.trim()) throw new HttpError(500, 'TOKEN_ENCRYPTION_KEY is not configured')
  const encoded = new TextEncoder().encode(secret)
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptToken(token: string | null | undefined, secret: string | undefined) {
  if (!token) return null
  if (!secret) throw new HttpError(500, 'TOKEN_ENCRYPTION_KEY is not configured')

  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await getAesKey(secret)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(token)
  )

  return `${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(ciphertext))}`
}

export async function decryptToken(payload: string | null | undefined, secret: string | undefined) {
  if (!payload) return null
  if (!secret) throw new HttpError(500, 'TOKEN_ENCRYPTION_KEY is not configured')

  const [ivPart, ciphertextPart] = payload.split('.')
  if (!ivPart || !ciphertextPart) throw new HttpError(500, 'Stored OAuth token is invalid')

  const key = await getAesKey(secret)
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlDecode(ivPart) },
    key,
    base64UrlDecode(ciphertextPart)
  )

  return new TextDecoder().decode(plaintext)
}
