/**
 * Rules test, no server needed: jumps per level and rebirth, speed per boots,
 * what each stage needs, what a rebirth resets (and keeps), XP and level-ups,
 * purchases (boots, jump pads, trails, perks, eggs), pets, migrating older
 * saves, Boxity ids and handing a guest's save to a new account.
 *
 *   npm run test:economy
 */
import {
  BOOTS,
  BOOT_BY_ID,
  PAD_BY_ID,
  SAVE_VERSION,
  STAGE_TABLE,
  bestBootTier,
  jumpsFor,
  levelForJumps,
  maxLevel,
  migrateProfile,
  padOpen,
  petsMult,
  speedFor,
  stageOpen,
  xpToNext,
} from '../src/shared/gameData.js'
import * as economy from '../src/game/economy.js'
import { accountUid, isGuestUid } from '../src/game/identity.js'
import { claimGuestSave, saveProfile } from '../src/store/profiles.js'

const { addXp, buy, equipBestPets, pets, rebirth } = economy

const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) process.exitCode = 1
}

const fresh = () => ({
  name: 'Test',
  level: 0,
  xp: 0,
  rebirths: 0,
  wins: 0,
  totalJump: 0,
  lifetimeLevels: 0,
  boot: 'starter',
  bootsOwned: 'starter',
  perkGain: 0,
  perkWins: 0,
  perkSpeed: 0,
  perkLuck: 0,
  perkSlots: 0,
  pets: '',
  petsEquipped: '',
  trail: 'white',
  trailsOwned: 'white',
  pass2xJump: false,
  pass2xWins: false,
  boostUntil: 0,
  bestStage: 0,
})
const noLimited = { left: () => 0, reserve: async () => false, release: async () => {} }

// Jumps come from levels; speed from boots.
check('level 0 has 1 jump', jumpsFor(0) === 1, `${jumpsFor(0)}`)
check('level 15 has 5 jumps', jumpsFor(15) === 5, `${jumpsFor(15)}`)
const thresholds = Array.from({ length: 16 }, (_, i) => i + 1).every((j) => jumpsFor(levelForJumps(j)) === j && (j === 1 || jumpsFor(levelForJumps(j) - 1) === j - 1))
check('levelForJumps is the first level with that many jumps', thresholds, Array.from({ length: 6 }, (_, i) => `${i + 1}j=L${levelForJumps(i + 1)}`).join(' '))
check('slippers run at 16, every pair is faster than the last', speedFor('starter') === 16 && BOOTS.every((b, i) => i === 0 || b.speed > BOOTS[i - 1].speed), BOOTS.map((b) => b.speed).join(','))
check('Swift Feet adds 4% a level', speedFor('starter', 5) === 19.2, `${speedFor('starter', 5)}`)
check('MAX level is 15 for everyone', [0, 1, 2, 3, 4, 5, 6, 7].every((r) => maxLevel(r) === 15), [0, 1, 2, 3, 4, 5, 6, 7].map(maxLevel).join(','))
check('every rebirth adds a jump for good', [0, 1, 2, 5].every((r) => jumpsFor(0, r) === 1 + r && jumpsFor(15, r) === 5 + r), [0, 1, 2, 5].map((r) => `r${r}: ${jumpsFor(0, r)}-${jumpsFor(15, r)}`).join(' '))
check("the first boots cost exactly Stage 1's Wins", BOOT_BY_ID.sneakers.price === STAGE_TABLE[0].wins, `${BOOT_BY_ID.sneakers.price} / ${STAGE_TABLE[0].wins}`)

// Every pair of boots (but the limited one) opens two stages; every stage's needs fit its rebirths.
check('every pair of boots below the limited one opens 2 stages', BOOTS.every((b) => b.limited || (b.stages && b.stages[1] - b.stages[0] === 1)), BOOTS.map((b) => `${b.id}:${b.stages?.join('-') ?? '-'}`).join(' '))
check('no stage needs more levels than its rebirths allow', STAGE_TABLE.every((s) => s.level <= maxLevel(s.rebirths)), STAGE_TABLE.map((s) => `L${s.level}/r${s.rebirths}`).join(' '))
const walker = fresh()
check('stage 3 needs Sneakers', !stageOpen(walker, 3) && stageOpen({ ...walker, bootsOwned: 'starter,sneakers' }, 3))
check('stage 11 needs Frost Boots and a rebirth', !stageOpen({ ...walker, bootsOwned: BOOTS.slice(0, 6).map((b) => b.id).join(',') }, 11) && stageOpen({ ...walker, rebirths: 1, bootsOwned: BOOTS.slice(0, 6).map((b) => b.id).join(',') }, 11))

// XP and level-ups stop at MAX.
const p = fresh()
const up = addXp(p, xpToNext(0) + xpToNext(1) + 1)
check('XP levels you up', p.level === 2 && up?.from === 0 && up?.to === 2 && p.lifetimeLevels === 2, JSON.stringify(up))
addXp(p, 1e12)
check('levels stop at MAX', p.level === maxLevel(0) && p.xp === 0, `level ${p.level}`)

// Rebirth resets only level and XP.
const r = fresh()
Object.assign(r, { level: maxLevel(0), xp: 0, wins: 1234, bootsOwned: 'starter,sneakers', boot: 'sneakers', perkGain: 2, pets: 'bunny,kitty', petsEquipped: 'bunny,kitty', lifetimeLevels: 15, bestStage: 9, pass2xJump: true })
const before = { ...r }
const result = rebirth(r)
const reset = ['level', 'xp']
const kept = ['wins', 'bootsOwned', 'boot', 'perkGain', 'pets', 'petsEquipped', 'lifetimeLevels', 'bestStage', 'pass2xJump']
check('rebirth works at MAX (+1 jump, x2 XP)', result.ok && r.rebirths === 1 && result.mult === 2 && result.max === 15 && result.jumps === 2, JSON.stringify(result))
check('rebirth resets level and XP', reset.every((k) => r[k] === 0), reset.map((k) => `${k} ${r[k]}`).join(', '))
check('rebirth keeps Wins, boots, perks, pets, titles, stages, passes', kept.every((k) => r[k] === before[k]), kept.filter((k) => r[k] !== before[k]).join(', ') || 'all kept')
check('rebirth below MAX is refused', rebirth(fresh()).code === 'notReady')

// Buying.
const b = fresh()
b.wins = 1_000_000
check('boots are bought in order', (await buy(b, { cat: 'boot', id: 'bouncy' }, noLimited)).code === 'order')
for (const boot of BOOTS.slice(1, 4)) await buy(b, { cat: 'boot', id: boot.id }, noLimited)
check('each tier after the last (and worn)', b.boot === 'rocket' && bestBootTier(b) === 3, b.bootsOwned)
const perk = await buy(b, { cat: 'perk', id: 'slots' }, noLimited)
check('perks level up', perk.ok && b.perkSlots === 1, JSON.stringify(perk))
let hatched = 0
for (let i = 0; i < 10; i += 1) if ((await buy(b, { cat: 'egg', id: 'basic' }, noLimited)).code === 'hatched') hatched += 1
check('eggs hatch pets', hatched === 10 && b.pets.split(',').length === 10, b.pets)
check('the best pets are equipped (3 + 1 slot)', b.petsEquipped.split(',').length === 4 && petsMult(b) > 1, `${b.petsEquipped} = x${petsMult(b).toFixed(2)}`)
const firstPet = b.pets.split(',')[0]
pets(b, { op: 'delete', id: firstPet })
check('deleting a pet', b.pets.split(',').length === 9)
equipBestPets(b)
check('the step boost is gone', (await buy(b, { cat: 'stepBoost' }, noLimited)).code === 'unknown')
check('codes are gone', !('redeemCode' in economy))

// Jump pads: the first is free, two are sold for Wins (kept for good), the best come with rebirths.
const padder = { ...fresh(), wins: 25 }
check('the first jump pad is free', padOpen(padder, PAD_BY_ID.pad1))
check('the Super Pad is closed until bought', !padOpen(padder, PAD_BY_ID.pad2))
const padBuy = await buy(padder, { cat: 'pad', id: 'pad2' }, noLimited)
check('the Super Pad is bought with Wins', padBuy.ok && padder.wins === 25 - PAD_BY_ID.pad2.price && padOpen(padder, PAD_BY_ID.pad2), JSON.stringify(padBuy))
check('a pad is only bought once', (await buy(padder, { cat: 'pad', id: 'pad2' }, noLimited)).code === 'owned')
check('the Turbo Pad needs its Wins', (await buy(padder, { cat: 'pad', id: 'pad3' }, noLimited)).code === 'poor')
check('rebirth pads are not for sale', (await buy({ ...fresh(), wins: 1e6 }, { cat: 'pad', id: 'pad4' }, noLimited)).code === 'unknown' && padOpen({ ...fresh(), rebirths: 3 }, PAD_BY_ID.pad4))
rebirth(Object.assign(padder, { level: maxLevel(0) }))
check('bought pads stay through a rebirth', padder.rebirths === 1 && padOpen(padder, PAD_BY_ID.pad2))

// Trails open as you reach stages.
const trailer = { ...fresh(), wins: 1000 }
check('a trail is locked until its stage', (await buy(trailer, { cat: 'trail', id: 'sky' }, noLimited)).code === 'locked')
trailer.bestStage = 2
check('then it can be bought', (await buy(trailer, { cat: 'trail', id: 'sky' }, noLimited)).ok && trailer.trail === 'sky')

// Migrating a version-1 save (levels 1-15, trampolines, goals, Spring Boots).
const v1 = { name: 'Old', level: 15, xp: 512, totalJump: 99999, wins: 777, rebirths: 2, boot: 'rocket', bootsOwned: 'starter,bouncy,spring,rocket', tramps: 't1,t3', trail: 'fire', trailsOwned: 'white,fire', goal: 12, goalTarget: 0, bestStage: 12, stars: '33221', pass2xWins: true }
const m1 = migrateProfile(v1)
check('a v1 save becomes the current version', m1.saveVersion === SAVE_VERSION)
check('Wins (plus the Spring Boots paid back), rebirths, boots, stages, stars, trails and passes carry over', m1.wins === 777 + 120 && m1.rebirths === 2 && m1.boot === 'rocket' && m1.bootsOwned === 'starter,bouncy,rocket' && m1.bestStage === 12 && m1.stars === '33221' && m1.trail === 'fire' && m1.pass2xWins, `wins ${m1.wins}, boots ${m1.bootsOwned}`)
check('the level maps onto the new curve (old 15 = new 14)', m1.level === 14 && m1.xp === 0, `level ${m1.level}`)
check('lifetime levels count the old rebirths', m1.lifetimeLevels === 2 * 15 + 14, `${m1.lifetimeLevels}`)
check('trampolines and goals are dropped; perks and pets start empty', m1.tramps === undefined && m1.goal === undefined && m1.perkGain === 0 && m1.pets === '')

// Migrating a version-2 save (walking XP, step boost, Fast Learner, Spring Boots).
const v2 = { saveVersion: 2, name: 'Walker', level: 9, xp: 30, wins: 100, rebirths: 0, boot: 'spring', bootsOwned: 'starter,sneakers,bouncy,spring', stepBoost: 3, perkXp: 2, perkGain: 1 }
const m2 = migrateProfile(v2)
const refund = 8 + 9 + 11 + 60 + 126 + 120
check('a v2 save is paid back for the step boost, Fast Learner and Spring Boots', m2.wins === 100 + refund && m2.stepBoost === undefined && m2.perkXp === undefined, `wins ${m2.wins} (+${m2.wins - 100}, expected +${refund})`)
check('Spring Boots wearers get Bouncy Boots on, and keep the rest', m2.boot === 'bouncy' && m2.bootsOwned === 'starter,sneakers,bouncy' && m2.level === 9 && m2.perkGain === 1, `${m2.boot} / ${m2.bootsOwned}`)

// Version 4: the Super and Turbo Pads came with rebirths 1 and 2; they keep them.
const pads4 = [0, 1, 2].map((rebirths) => migrateProfile({ saveVersion: 4, rebirths, level: 3 }).padsOwned)
check('a v4 save keeps the pads its rebirths had opened', pads4.join('|') === '|pad2|pad2,pad3', pads4.join(' | '))

const bad = migrateProfile({ saveVersion: 3, level: 9999, rebirths: -3, wins: Number.NaN, perkGain: 99, boot: 'diamond', bootsOwned: 'starter,nonsense' })
check('out-of-range numbers are clamped, and unowned boots come off', bad.rebirths === 0 && bad.level === maxLevel(0) && bad.wins === 0 && bad.perkGain === 10 && bad.boot === 'starter' && bad.bootsOwned === 'starter', JSON.stringify({ level: bad.level, rebirths: bad.rebirths, wins: bad.wins, perkGain: bad.perkGain, boot: bad.boot, owned: bad.bootsOwned }))

// Boxity ids: accounts come only from a verified token; guests keep their browser's id.
check('Boxity accounts are bx:<id>', accountUid('legion_abc123') === 'bx:abc123' && accountUid('abc123') === 'bx:abc123')
check('guest ids are recognised (and nothing else)', isGuestUid('guest:4f1c-77aa-90') && isGuestUid('test:bot-0') && !isGuestUid('bx:abc123') && !isGuestUid('guest:') && !isGuestUid('anon:x'))

// A first-time account takes a guest's save, once.
saveProfile('guest:carry-test', { ...fresh(), wins: 42, level: 5 })
const carried = await claimGuestSave('guest:carry-test', 'bx:new-account')
check("a new account takes over a guest's save", carried?.wins === 42 && carried?.level === 5, JSON.stringify({ wins: carried?.wins, level: carried?.level }))
check('the same guest save never goes to a second account', (await claimGuestSave('guest:carry-test', 'bx:other-account')) === null)

console.log(process.exitCode ? '\nSome checks failed.' : '\nAll checks passed.')
