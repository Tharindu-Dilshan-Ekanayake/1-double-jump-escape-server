import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { SAVE_VERSION } from '../shared/gameData.js'

/**
 * Player profiles and the limited-item stock.
 *
 * Two backends behind one small API:
 *
 *  - MongoDB when MONGODB_URI is set (Bloxity Legion injects it: an isolated
 *    database per game and channel). Pods come and go, so a profile is read from
 *    the database each time its player joins, changes are written back in
 *    batches every few seconds, and the leaderboards are a cached query.
 *  - JSON files in DATA_DIR otherwise (local development): everything lives in
 *    memory and is flushed to disk every few seconds (write-to-temp + rename, so
 *    a crash never leaves a half-written file).
 *
 * Every save carries `saveVersion` and `lastSeen`; loading an older version
 * is migrated by migrateProfile (shared/progression.js) when the player joins.
 * Guests are saved like accounts, under the id their browser keeps.
 */

const DATA_DIR = process.env.DATA_DIR || path.resolve('data')
const FILE = path.join(DATA_DIR, 'players.json')
const LIMITED_FILE = path.join(DATA_DIR, 'limited.json')
const MONGODB_URI = process.env.MONGODB_URI || ''
const FLUSH_INTERVAL_MS = 4000
const LEADERBOARD_REFRESH_MS = 30_000
const LIMITED_REFRESH_MS = 5000

/** Fields copied between a profile and the room's PlayerState. */
export const PERSISTED_FIELDS = [
  'name',
  'level',
  'xp',
  'rebirths',
  'wins',
  'totalJump',
  'lifetimeLevels',
  'boot',
  'bootsOwned',
  'perkGain',
  'perkWins',
  'perkSpeed',
  'perkLuck',
  'perkSlots',
  'pets',
  'petsEquipped',
  'padsOwned',
  'trail',
  'trailsOwned',
  'pass2xJump',
  'pass2xWins',
  'boostUntil',
  'bestStage',
  'stars',
  'counters',
  'dailyAt',
  'dailyStreak',
  'chestAt',
]

const LEADERBOARD_STATS = ['totalJump', 'wins', 'rebirths']

/** uid -> profile. File mode: every profile. Mongo mode: players seen by this pod. */
const profiles = new Map()
/** uids changed since the last flush. */
const dirty = new Set()
let flushing = null
let database = null
let collection = null
let mongoClient = null
let cachedBoards = emptyBoards()
/** item id -> sold (across every server). */
const limitedSold = new Map()
let limitedDirty = false

/** Smoke-test bots (scripts/lobby-test.js) play with `test:` uids and are never saved. */
const isTestUid = (uid) => uid.startsWith('test:')

function emptyBoards() {
  return Object.fromEntries(LEADERBOARD_STATS.map((stat) => [stat, []]))
}

/** Connects to MongoDB (or reads the JSON files). Call once before listening. */
export async function initProfiles() {
  if (MONGODB_URI) {
    const { MongoClient } = await import('mongodb')
    mongoClient = new MongoClient(MONGODB_URI, { maxPoolSize: 10 })
    await mongoClient.connect()
    database = mongoClient.db()
    collection = database.collection('profiles')
    await collection.createIndexes(LEADERBOARD_STATS.map((stat) => ({ key: { [stat]: -1 }, name: `top_${stat}` })))
    console.log('[profiles] using MongoDB')
    await refreshLeaderboards()
    await refreshLimited()
    setInterval(() => refreshLeaderboards().catch((err) => console.error('[profiles] leaderboards failed', err)), LEADERBOARD_REFRESH_MS).unref()
    setInterval(() => refreshLimited().catch((err) => console.error('[profiles] limited stock failed', err)), LIMITED_REFRESH_MS).unref()
  } else {
    loadFiles()
  }
  setInterval(flushProfiles, FLUSH_INTERVAL_MS).unref()
}

function loadFiles() {
  if (existsSync(FILE)) {
    try {
      const raw = JSON.parse(readFileSync(FILE, 'utf8'))
      for (const [uid, profile] of Object.entries(raw)) {
        if (isTestUid(uid)) dirty.add(uid)
        else profiles.set(uid, profile)
      }
      console.log(`[profiles] loaded ${profiles.size} profiles from ${FILE}`)
    } catch (err) {
      console.error(`[profiles] could not read ${FILE}; starting empty`, err)
    }
  }
  if (existsSync(LIMITED_FILE)) {
    try {
      for (const [id, sold] of Object.entries(JSON.parse(readFileSync(LIMITED_FILE, 'utf8')))) limitedSold.set(id, Number(sold) || 0)
    } catch (err) {
      console.error(`[profiles] could not read ${LIMITED_FILE}`, err)
    }
  }
}

/** The stored profile, or null for a first-time player. */
export async function loadProfile(uid) {
  if (isTestUid(uid)) return null
  // Unsaved changes made on this pod are the newest copy.
  if (!collection || dirty.has(uid)) return profiles.get(uid) || null
  const doc = await collection.findOne({ _id: uid })
  if (!doc) return null
  const { _id: _ignored, ...profile } = doc
  profiles.set(uid, profile)
  return profile
}

/** Copies the persisted fields of `state` (a PlayerState or plain object). */
export function saveProfile(uid, state, extra = {}) {
  if (isTestUid(uid)) return
  const previous = profiles.get(uid) || {}
  const now = Date.now()
  const next = { ...previous, ...extra, saveVersion: SAVE_VERSION, lastSeen: now, updatedAt: now }
  for (const field of PERSISTED_FIELDS) next[field] = state[field]
  profiles.set(uid, next)
  dirty.add(uid)
}

/**
 * Hands a guest's save to an account that has never played, once: the guest
 * save is marked `mergedInto` so it can never go to a second account.
 * Resolves the guest's profile, or null when there is none to take.
 */
export async function claimGuestSave(guestUid, accountUid) {
  if (isTestUid(guestUid)) return null
  if (collection) {
    // A guest who just left this pod may only be saved in memory so far.
    if (dirty.has(guestUid)) {
      await flushing
      await flushProfiles()
    }
    const result = await collection.findOneAndUpdate(
      { _id: guestUid, mergedInto: { $exists: false } },
      { $set: { mergedInto: accountUid } },
      { returnDocument: 'before' },
    )
    const doc = result?.value !== undefined ? result.value : result
    if (!doc) return null
    const { _id: _ignored, ...profile } = doc
    profiles.set(guestUid, { ...profile, mergedInto: accountUid })
    return profile
  }
  const guest = profiles.get(guestUid)
  if (!guest || guest.mergedInto) return null
  profiles.set(guestUid, { ...guest, mergedInto: accountUid })
  dirty.add(guestUid)
  return { ...guest }
}

/** Writes every changed profile out (to MongoDB or the JSON file). */
export async function flushProfiles() {
  if (flushing) return flushing
  if (!dirty.size && !limitedDirty) return undefined
  const uids = [...dirty]
  dirty.clear()
  const writeLimited = limitedDirty
  limitedDirty = false
  flushing = (async () => {
    try {
      if (collection) {
        const ops = uids
          .filter((uid) => profiles.has(uid))
          .map((uid) => ({ updateOne: { filter: { _id: uid }, update: { $set: profiles.get(uid) }, upsert: true } }))
        if (ops.length) await collection.bulkWrite(ops, { ordered: false })
      } else {
        mkdirSync(DATA_DIR, { recursive: true })
        if (uids.length) {
          const tmp = `${FILE}.tmp`
          await writeFile(tmp, JSON.stringify(Object.fromEntries(profiles)))
          await rename(tmp, FILE)
        }
        if (writeLimited) {
          const tmp = `${LIMITED_FILE}.tmp`
          await writeFile(tmp, JSON.stringify(Object.fromEntries(limitedSold)))
          await rename(tmp, LIMITED_FILE)
        }
      }
    } catch (err) {
      for (const uid of uids) dirty.add(uid)
      if (writeLimited) limitedDirty = true
      console.error('[profiles] save failed', err)
    } finally {
      flushing = null
    }
  })()
  return flushing
}

/** Saves what's left and closes the database (on shutdown). */
export async function closeProfiles() {
  await flushProfiles()
  await flushing
  await mongoClient?.close()
}

async function refreshLeaderboards() {
  const result = {}
  for (const stat of LEADERBOARD_STATS) {
    const rows = await collection
      .find({ [stat]: { $gt: 0 } }, { projection: { name: 1, [stat]: 1 } })
      .sort({ [stat]: -1 })
      .limit(10)
      .toArray()
    result[stat] = rows.map((p) => ({ name: p.name || 'Player', value: p[stat] || 0 }))
  }
  cachedBoards = result
}

/** Top 10 per stat across every saved profile. */
export function leaderboards() {
  if (collection) return cachedBoards
  const all = [...profiles.values()]
  const result = {}
  for (const stat of LEADERBOARD_STATS) {
    result[stat] = all
      .filter((p) => (p[stat] || 0) > 0)
      .sort((a, b) => (b[stat] || 0) - (a[stat] || 0))
      .slice(0, 10)
      .map((p) => ({ name: p.name || 'Player', value: p[stat] || 0 }))
  }
  return result
}

/* ---------------------------------------------------------------------------
 * Limited items: a fixed number exist across every server.
 * ------------------------------------------------------------------------- */

async function refreshLimited() {
  const docs = await database.collection('limited').find({}).toArray()
  for (const doc of docs) limitedSold.set(doc._id, doc.sold || 0)
}

/** How many of a limited item are still for sale. */
export const limitedLeft = (id, stock) => Math.max(0, stock - (limitedSold.get(id) || 0))

/** Takes one from the stock. Resolves false when it's sold out. */
export async function reserveLimited(id, stock) {
  if (collection) {
    const limited = database.collection('limited')
    try {
      const doc = await limited.findOneAndUpdate(
        { _id: id, sold: { $lt: stock } },
        { $inc: { sold: 1 } },
        { upsert: true, returnDocument: 'after' },
      )
      const sold = (doc?.value ?? doc)?.sold
      if (typeof sold === 'number') limitedSold.set(id, sold)
      return typeof sold === 'number' && sold <= stock
    } catch (err) {
      // A duplicate-key error here means the filter missed an existing, sold-out doc.
      if (err?.code !== 11000) console.error('[profiles] limited reserve failed', err)
      return false
    }
  }
  const sold = limitedSold.get(id) || 0
  if (sold >= stock) return false
  limitedSold.set(id, sold + 1)
  limitedDirty = true
  return true
}

/** Puts one back (a purchase that failed after reserving). */
export async function releaseLimited(id) {
  if (collection) {
    await database.collection('limited').updateOne({ _id: id, sold: { $gt: 0 } }, { $inc: { sold: -1 } })
  }
  limitedSold.set(id, Math.max(0, (limitedSold.get(id) || 0) - 1))
  limitedDirty = true
}
