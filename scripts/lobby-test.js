/**
 * Smoke test against a running server (`npm start` first).
 *
 * Connects 17 bots and checks Colyseus splits them 8 / 8 / 1 across lobbies, then
 * drives one bot around to confirm jumping and walking pay XP (only as many
 * jumps as the level allows per air-time, a few a second, and no more steps
 * than the boots can run), jump pads (free, bought, locked), levels, stage pads
 * (their anti-teleport check and boot doors), purchases, respawns, rebirth,
 * world doors and checkpoints work; that emotes and falls show on other
 * screens; that an account is only ever taken from a Boxity token Boxity
 * vouches for; and that a guest's progress survives leaving and coming back.
 *
 *   npm run test:lobbies            # ws://localhost:2567
 *   node scripts/lobby-test.js ws://my-host:2567
 */
import { Client } from '@colyseus/sdk'

import { CONFIG, ROOM_NAME } from '../src/shared/gameData.js'
import { checkpointOn, getLayout } from '../src/shared/layout.js'

const endpoint = process.argv[2] || 'ws://localhost:2567'
const BOTS = 17
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) process.exitCode = 1
}

const client = new Client(endpoint)
const rooms = []
for (let i = 0; i < BOTS; i += 1) {
  const room = await client.joinOrCreate(ROOM_NAME, { uid: `test:bot-${i}`, name: `Bot${i}` })
  room.onMessage('*', () => {})
  rooms.push(room)
}
await wait(300)

const byRoom = new Map()
for (const room of rooms) byRoom.set(room.roomId, (byRoom.get(room.roomId) || 0) + 1)
const sizes = [...byRoom.values()]
check('17 bots split into lobbies of at most 8', sizes.every((n) => n <= 8), `sizes ${sizes.join('/')}`)
check('three lobbies were created', byRoom.size === 3, `${byRoom.size} lobbies`)
check('first lobby is full', rooms[0].state.players.size === 8, `${rooms[0].state.players.size} players`)

// Bot 16 sits alone in the third lobby.
const bot = rooms[16]
const gains = []
const results = []
const rewards = []
const levelUps = []
bot.onMessage('gain', (m) => gains.push(m))
bot.onMessage('result', (m) => results.push(m))
bot.onMessage('reward', (m) => rewards.push(m))
bot.onMessage('levelup', (m) => levelUps.push(m))
const me = () => bot.state.players.get(bot.sessionId)
const lastResult = (action) => [...results].reverse().find((r) => r.action === action)
const move = (x, y, z, a = 0) => bot.send('move', { x, y, z, r: Math.PI, s: 16, a })
const jumps = () => gains.reduce((n, g) => n + g.jumps, 0)

const layout = getLayout()
const spawn = layout.spawn

// Jumping pays XP: one jump per air-time at level 0 (a second one before
// landing pays nothing), and landing gives the jump back.
gains.length = 0
move(spawn.x, 0.2, spawn.z)
await wait(100)
bot.send('jump')
await wait(60)
move(spawn.x, 3, spawn.z, 1)
await wait(60)
bot.send('jump')
await wait(700)
check('a jump pays XP, and one more than your level allows does not', jumps() === 1, `${jumps()} paid jumps, XP ${me().totalJump}`)
gains.length = 0
move(spawn.x, 0.2, spawn.z)
await wait(60)
bot.send('jump')
await wait(700)
check('landing gives your jump back', jumps() === 1, `${jumps()} paid jumps`)

// A macro: 30 jumps a second, landing in between each, pays no more than CONFIG.maxJumpRate a second.
gains.length = 0
const macroStart = Date.now()
for (let i = 0; i < 60; i += 1) {
  move(spawn.x, 0.2, spawn.z)
  bot.send('jump')
  await wait(33)
}
const macroSeconds = (Date.now() - macroStart) / 1000
await wait(700)
check('jump spam is capped', jumps() <= CONFIG.maxJumpRate * (macroSeconds + 1), `${jumps()} paid jumps in ${macroSeconds.toFixed(1)} s (cap ${CONFIG.maxJumpRate}/s)`)

// Standing still pays nothing.
gains.length = 0
for (let i = 0; i < 20; i += 1) {
  move(spawn.x, 0.2, spawn.z)
  await wait(50)
}
await wait(600)
check('standing still pays nothing', jumps() === 0, `${jumps()} jumps`)

// The free jump pad bounces you and pays at its rate (in the air too); a locked one doesn't.
const jumpPad = layout.jumpPads[0]
move(jumpPad.center[0], jumpPad.top + 2, jumpPad.center[1], 1)
await wait(200)
gains.length = 0
await wait(2200)
const padJumps = jumps()
check('the free jump pad pays jumps while you bounce on it', padJumps >= 3 && gains.every((g) => g.pad === jumpPad.rate), `${padJumps} jumps in ~2 s at ${jumpPad.rate}/s`)
const lockedPad = layout.jumpPads[1]
move(lockedPad.center[0], lockedPad.top + 2, lockedPad.center[1], 1)
await wait(800)
gains.length = 0
await wait(1200)
check('a jump pad not bought yet pays nothing', jumps() === 0, `${jumps()} jumps (costs ${lockedPad.id} Wins)`)
move(spawn.x, 0.2, spawn.z)
await wait(200)

// Walking pays XP: a step every CONFIG.stepStuds studs run at your boots' speed.
gains.length = 0
let wx = -20
for (let i = 0; i < 80; i += 1) {
  wx += 0.8
  move(wx, 0.2, spawn.z)
  await wait(50)
}
await wait(700)
const steps = jumps()
check('walking pays XP (steps)', steps >= 5, `${steps} steps for ${(80 * 0.8).toFixed(0)} studs (a step every ${CONFIG.stepStuds})`)
// Running faster than the boots allow pays no more steps than they could.
gains.length = 0
const sprintStart = Date.now()
for (let i = 0; i < 40; i += 1) {
  wx -= 3
  move(wx, 0.2, spawn.z)
  await wait(50)
}
const sprintSeconds = (Date.now() - sprintStart) / 1000
await wait(700)
// The server credits at most speed x time x 1.3 (+0.05 a move) studs, plus a step already part-run.
const stepCap = Math.ceil((16 * sprintSeconds * 1.3 + 40 * 0.05) / CONFIG.stepStuds) + 2
check("steps are capped at the boots' speed", jumps() <= stepCap && jumps() < (120 / CONFIG.stepStuds) * 0.6, `${jumps()} steps for 120 studs "run" in ${sprintSeconds.toFixed(1)} s at speed 16 (cap ${stepCap}, uncapped ${120 / CONFIG.stepStuds})`)

// XP levels you up: +1 jump at levels 4, 8, 12, 15...
const lastUp = levelUps.at(-1)
check('XP levels you up (and more jumps)', me().level >= 1 && lastUp && lastUp.to === me().level, `level ${me().level}, ${JSON.stringify(lastUp)}`)

// Teleporting straight onto Stage 1's Return pad must not pay.
const stage1 = layout.stages[0]
const pad = layout.pads.find((p) => p.stage === 1 && p.kind === 'return')
const padAt = [(pad.min[0] + pad.max[0]) / 2, pad.max[1], (pad.min[2] + pad.max[2]) / 2]
move(spawn.x, 0.2, 2)
await wait(120)
move(...padAt)
await wait(120)
bot.send('pad', { stage: 1, kind: 'return' })
await wait(250)
check('a teleport onto a pad is refused', lastResult('pad')?.code === 'invalid' && !rewards.length, JSON.stringify(lastResult('pad')))

// A believable run: walk from the lobby to the pad at running speed, along
// the platforms (so a respawn has somewhere to go).
const landing = stage1.platforms.find((p) => p.entry)
move(spawn.x, 0.2, 2)
await wait(400)
for (let zz = 2; zz > padAt[2]; zz -= 1.2) {
  const on = stage1.platforms.find((p) => zz <= p.z0 && zz >= p.z1)
  const y = zz < stage1.plateauZ0 ? stage1.floorY : on ? on.y : 0.2
  const xx = zz < stage1.plateauZ0 ? padAt[0] * Math.min(1, (stage1.plateauZ0 - zz) / (stage1.plateauZ0 - padAt[2])) : 0
  move(xx, y, zz, on || zz < stage1.plateauZ0 || zz > -4 ? 0 : 1)
  await wait(55)
}
move(...padAt)
await wait(100)
bot.send('pad', { stage: 1, kind: 'return' })
await wait(250)
check('a real run onto the Return pad pays Wins', rewards.length === 1 && me().wins >= 1, `wins ${me().wins}, best stage ${me().bestStage}`)
check('the stage counts as reached', me().bestStage === 1)
const double = layout.pads.find((p) => p.stage === 1 && p.kind === 'double')
move((double.min[0] + double.max[0]) / 2, double.max[1], (double.min[2] + double.max[2]) / 2)
await wait(1700)
bot.send('pad', { stage: 1, kind: 'double' })
await wait(250)
check('the 2x pad needs the 2x Wins pass', lastResult('pad')?.code === 'needPass', JSON.stringify(lastResult('pad')))

// Stage 3 is behind a door that needs Sneakers: its pads refuse you without them.
const pad3 = layout.pads.find((p) => p.stage === 3 && p.kind === 'return')
move((pad3.min[0] + pad3.max[0]) / 2, pad3.max[1], (pad3.min[2] + pad3.max[2]) / 2)
await wait(1700)
bot.send('pad', { stage: 3, kind: 'return' })
await wait(250)
check('a stage behind a boot door pays nothing without the boots', lastResult('pad')?.code === 'locked' && lastResult('pad')?.boot === 'sneakers', JSON.stringify(lastResult('pad')))
check('the boot door is on the course', layout.doors.some((d) => d.stage === 3 && d.bootId === 'sneakers'))

// Falling: respawn on a platform this run stood on, and only there.
const far = stage1.platforms.at(-1)
const farSpot = checkpointOn(stage1.platforms[2], 0)
bot.send('respawn', { ...farSpot, x: farSpot.x + 30 })
await wait(200)
check('a respawn anywhere else is refused', lastResult('respawn')?.code === 'invalid', JSON.stringify(lastResult('respawn')))
const spot = checkpointOn(landing, 0)
bot.send('respawn', spot)
await wait(200)
check('a respawn on a platform you stood on works', lastResult('respawn')?.ok === true, JSON.stringify(lastResult('respawn')))
check('(far platform exists)', Boolean(far))

// Buying: boots in order (Stage 1's Wins buy the first pair); pads and perks need Wins.
bot.send('buy', { cat: 'boot', id: 'bouncy' })
await wait(200)
check('boots are bought in order', lastResult('buy')?.code === 'order', JSON.stringify(lastResult('buy')))
bot.send('code', { code: 'RELEASE' })
await wait(200)
check('codes are gone (and an old client sending one stays connected)', !lastResult('code') && bot.connection.isOpen, JSON.stringify(lastResult('code')))
bot.send('buy', { cat: 'boot', id: 'sneakers' })
await wait(200)
check("Stage 1's Wins buy the first boots, and they're worn", me().boot === 'sneakers' && me().bootsOwned.includes('sneakers'), `wins ${me().wins}`)
bot.send('buy', { cat: 'pad', id: 'pad2' })
await wait(200)
check('a jump pad for Wins needs the Wins', lastResult('buy')?.code === 'poor', JSON.stringify(lastResult('buy')))
bot.send('buy', { cat: 'perk', id: 'speed' })
await wait(200)
check('a perk without enough Wins is refused', lastResult('buy')?.code === 'poor', JSON.stringify(lastResult('buy')))
bot.send('buy', { cat: 'egg', id: 'galaxy' })
await wait(200)
check('a locked egg is refused', lastResult('buy')?.code === 'locked', JSON.stringify(lastResult('buy')))
bot.send('equip', { cat: 'boot', id: 'starter' })
await wait(200)
check('owned boots can be re-equipped', me().boot === 'starter')

// Rebirth needs MAX level.
bot.send('rebirth')
await wait(200)
check('rebirth is refused before MAX level', lastResult('rebirth')?.code === 'notReady')

// World doors: World 2 needs a rebirth; World 1 is always open.
bot.send('world', { id: 2 })
await wait(200)
check('the World 2 door needs a rebirth', lastResult('world')?.code === 'locked', JSON.stringify(lastResult('world')))
await wait(1100)
bot.send('world', { id: 1 })
await wait(200)
check('the World 1 door takes you to its lobby', lastResult('world')?.ok === true && lastResult('world').z === layout.worlds[0].spawn.z, JSON.stringify(lastResult('world')))
// (World doors and the checkpoint door share a short cooldown.)
await wait(2100)

// Checkpoint door: go to the best stage's plateau.
bot.send('checkpoint', {})
await wait(200)
const cp = lastResult('checkpoint')
check('the checkpoint door sends you to your best stage', cp?.ok && cp.stage === 1, JSON.stringify(cp))

// Two players in one lobby see each other's emotes and falls.
const [a, b] = rooms
const aState = () => b.state.players.get(a.sessionId)
const seqBefore = aState().emoteSeq
a.send('emote', { id: '000000000000000000000e01' })
await wait(300)
check("an emote shows on other players' screens", aState().emote === '000000000000000000000e01' && aState().emoteSeq !== seqBefore, `${aState().emote} #${aState().emoteSeq}`)
a.send('emote', { id: 'not an emote!' })
await wait(300)
check('a malformed emote id is not passed on', aState().emote === '', JSON.stringify(aState().emote))
a.send('move', { x: spawn.x, y: 0.2, z: spawn.z, r: 0, s: 0, a: 0, d: 1 })
await wait(300)
const fell = aState().dead
a.send('move', { x: spawn.x, y: 0.2, z: spawn.z, r: 0, s: 0, a: 0, d: 0 })
await wait(300)
check('a fall shows on other screens, and the respawn too', fell === true && aState().dead === false)

for (const room of rooms) await room.leave()

// Accounts only come from a Boxity token that Boxity vouches for.
const claimer = await client.joinOrCreate(ROOM_NAME, { uid: 'bx:someone-else', name: 'Faker' })
claimer.onMessage('*', () => {})
await wait(300)
const faker = claimer.state.players.get(claimer.sessionId)
check('a bx: uid without a token is not that account', faker.boxityId === '' && faker.username === '', JSON.stringify({ boxityId: faker.boxityId }))
await claimer.leave()
let refused = null
try {
  const r = await client.joinOrCreate(ROOM_NAME, { token: 'not-a-real-boxity-token', uid: 'bx:someone-else', name: 'Faker' })
  await r.leave()
} catch (err) {
  refused = err
}
check('a token Boxity does not vouch for is refused', refused?.code === 401, `${refused?.code} ${refused?.message ?? ''}`)

// A guest's progress is saved: leave and come back.
const guest = `guest:save-test-${Date.now().toString(36)}`
let room = await client.joinOrCreate(ROOM_NAME, { uid: guest, name: 'SaveTest' })
room.onMessage('*', () => {})
await wait(300)
for (let i = 0; i < 6; i += 1) {
  room.send('move', { x: 0, y: 0.2, z: spawn.z, r: 0, s: 0, a: 0 })
  room.send('jump')
  await wait(250)
}
await wait(600)
const before = room.state.players.get(room.sessionId)
const saved = { wins: before.wins, xp: before.totalJump, level: before.level }
await room.leave()
await wait(300)
room = await client.joinOrCreate(ROOM_NAME, { uid: guest, name: 'SaveTest' })
room.onMessage('*', () => {})
await wait(300)
const after = room.state.players.get(room.sessionId)
check('a guest keeps their progress after leaving', after.wins === saved.wins && after.totalJump === saved.xp && after.level === saved.level, `${JSON.stringify(saved)} -> wins ${after.wins}, xp ${after.totalJump}, level ${after.level}`)
await room.leave()

console.log(`\n(${CONFIG.luckyChance * 100}% of jumps are lucky, so XP varies a little.)`)
console.log(process.exitCode ? '\nSome checks failed.' : '\nAll checks passed.')
process.exit()
