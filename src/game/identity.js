/**
 * Boxity identity.
 *
 * Signed-in players send their Boxity token in the join options; the server
 * asks Boxity who it belongs to (the same endpoint the SDK itself uses) and
 * never trusts an account id the client claims. Guests play under the
 * random id their browser keeps.
 */

const API_URL = (process.env.BLOXITY_API_URL || 'https://api.bloxity.io').replace(/\/$/, '')
const GAME_SLUG = process.env.BLOXITY_GAME_SLUG || process.env.BLOXITY_GAME_ID || '1-double-jump-escape'
const CACHE_MS = 10 * 60 * 1000
const TIMEOUT_MS = 6000

/** token -> { result, expires } */
const cache = new Map()

/** Boxity account ids may arrive bare or as "legion_<id>"; profiles use the bare id. */
export const bareUserId = (id) => String(id || '').replace(/^legion_/, '')

/** The profile id of a Boxity account. */
export const accountUid = (id) => `bx:${bareUserId(id)}`

/** A browser's own guest id (see playerUid on the client), or a smoke-test bot's. */
export const isGuestUid = (uid) => typeof uid === 'string' && /^(guest|test):[A-Za-z0-9_-]{3,64}$/.test(uid)

async function fetchVerified(url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) return null
  const body = await res.json().catch(() => null)
  if (!body || typeof body !== 'object' || body.valid === false) return null
  const user = 'user' in body && body.user ? body.user : body
  if (!user || !(user._id || user.id)) return null
  // Boxity guest accounts this browser played as before signing in (newest first).
  const carriedFrom = Array.isArray(body.carriedFrom) ? body.carriedFrom.map(bareUserId).filter(Boolean).slice(0, 5) : []
  return { user, carriedFrom }
}

/**
 * Asks Boxity whose token this is.
 * @returns {Promise<{ user: object, carriedFrom: string[] } | null>} null when it isn't valid (or Boxity can't be reached)
 */
export async function verifyBloxityToken(token) {
  if (typeof token !== 'string' || token.length < 10 || token.length > 8192) return null
  const hit = cache.get(token)
  if (hit && hit.expires > Date.now()) return hit.result

  const headers = { Authorization: `Bearer ${token}` }
  let result = null
  try {
    result = await fetchVerified(`${API_URL}/v1/auth/game-token/verify`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameSlug: GAME_SLUG }),
    })
    if (!result) result = await fetchVerified(`${API_URL}/v1/auth/me`, { headers })
  } catch (err) {
    console.warn('[identity] Boxity verification failed:', err.message)
    return null
  }
  if (result) {
    cache.set(token, { result, expires: Date.now() + CACHE_MS })
    if (cache.size > 5000) cache.delete(cache.keys().next().value)
  }
  return result
}
