/**
 * Deterministic world layout: a small lobby and a 20-stage escape course.
 *
 * Pure data, no three.js — the client turns it into meshes and colliders, the
 * server uses the same pads, trampolines and stage bounds to validate claims.
 * Shared with the server (see the note at the top of gameData.js).
 *
 * Coordinates are studs, Y up. The lobby sits at z ∈ [0, 96]; the course runs
 * from its front opening towards -Z down a walled corridor over lava. Each
 * stage is a row of stepping platforms, then its gate (a long gap or a tall
 * wall, sized from the physics for that stage's recommended build), then a
 * plateau with a Return pad and a 2x Wins pad.
 */
import { BOOTS, PHYSICS, STAGES, TRAMPOLINES, moveStats, mulberry32 } from './gameData.js'

export { mulberry32 }

/** The corridor's inner walls stand at x = ±CORRIDOR_HALF. */
export const CORRIDOR_HALF = 22
export const WALL_THICK = 4
export const LOBBY_HALF_X = 50
export const LOBBY_FRONT_Z = 0
export const LOBBY_BACK_Z = 96
/** Where the course starts: the far side of the lobby's front wall. */
export const COURSE_START_Z = -4
/** Each plateau sits this much higher than the one before. */
export const STAGE_RISE = 2
/** The lava sits this far below the surface you jump from. */
export const LAVA_DEPTH = 9
export const PLATEAU_LENGTH = 56
export const FINAL_PLATEAU_LENGTH = 90
export const TAKEOFF_LENGTH = 18
export const GATE_WALL_THICK = 6
/** The sea far below everything (scenery). */
export const SEA_Y = -46
export const SPAWN = Object.freeze({ x: 0, y: 0.2, z: 66, yaw: Math.PI })

/** While jump is held, the next jump fires when rising speed drops to this (see physics.js). */
export const AUTO_JUMP_FIRE_SPEED = 2.5

/**
 * Material keys per theme (the client maps each to a texture).
 *  top / face  stepping platforms     plateau  stage-end floor
 *  wall / band corridor walls (band = the bright strip along the top)
 *  liquid      the deadly floor       spike    spike colour   laser beam colour
 */
export const THEMES = {
  starter: { top: 'grass', face: 'dirt', plateau: 'grassChecker', wall: 'stoneWall', band: 'stoneLight', liquid: 'lava', spike: '#9aa3b2', laser: 'red', sky: 'day' },
  brick: { top: 'lilacStud', face: 'lilacDark', plateau: 'redStud', wall: 'blueBrick', band: 'yellowStud', liquid: 'lava', spike: '#8a8fa3', laser: 'red', sky: 'day' },
  lava: { top: 'darkChecker', face: 'darkRock', plateau: 'lavaChecker', wall: 'darkRock', band: 'lavaChecker', liquid: 'lava', spike: '#3e3634', laser: 'yellow', sky: 'dusk' },
  desert: { top: 'sandTile', face: 'sandstone', plateau: 'yellowChecker', wall: 'sandstone', band: 'sand', liquid: 'quicksand', spike: '#c98a3a', laser: 'red', sky: 'warm' },
  shark: { top: 'poolTile', face: 'checkerBlue', plateau: 'redStud', wall: 'brownBrick', band: 'sand', liquid: 'lava', spike: '#7d8597', laser: 'red', sky: 'day' },
  ice: { top: 'ice', face: 'iceWall', plateau: 'snow', wall: 'iceWall', band: 'snow', liquid: 'icewater', spike: '#bfefff', laser: 'magenta', sky: 'cold' },
  candy: { top: 'candy', face: 'candyWall', plateau: 'candy', wall: 'candyWall', band: 'mintStud', liquid: 'chocolate', spike: '#ffffff', laser: 'red', sky: 'pink' },
  jungle: { top: 'jungleTile', face: 'mossStone', plateau: 'forestTop', wall: 'mossStone', band: 'jungleGrass', liquid: 'swamp', spike: '#6b4223', laser: 'yellow', sky: 'day' },
  neon: { top: 'neonFloor', face: 'neonWall', plateau: 'neonFloor', wall: 'neonWall', band: 'neonWall', liquid: 'neon', spike: '#ff3df2', laser: 'green', sky: 'night' },
  volcano: { top: 'magmaTile', face: 'darkRock', plateau: 'lavaChecker', wall: 'darkRock', band: 'magmaTile', liquid: 'lava', spike: '#2d2523', laser: 'yellow', sky: 'dusk' },
  cloud: { top: 'cloudWhite', face: 'cloudStone', plateau: 'goldWall', wall: 'cloudStone', band: 'cloudWhite', liquid: 'void', spike: '#ffd23a', laser: 'red', sky: 'bright' },
  toxic: { top: 'toxicTile', face: 'metal', plateau: 'hazardStripe', wall: 'metalDark', band: 'slimeFloor', liquid: 'slime', spike: '#5a6270', laser: 'green', sky: 'toxic' },
  haunted: { top: 'hauntedTile', face: 'hauntedStone', plateau: 'hauntedTile', wall: 'hauntedStone', band: 'hauntedGround', liquid: 'ghost', spike: '#55506a', laser: 'magenta', sky: 'night' },
  crystal: { top: 'crystalTile', face: 'crystalWall', plateau: 'crystalTile', wall: 'crystalWall', band: 'crystalTile', liquid: 'crystal', spike: '#e0d2ff', laser: 'magenta', sky: 'pink' },
  factory: { top: 'metal', face: 'hazardStripe', plateau: 'metal', wall: 'metalDark', band: 'hazardStripe', liquid: 'molten', spike: '#4c535e', laser: 'yellow', sky: 'warm' },
  sakura: { top: 'sakuraTile', face: 'woodWall', plateau: 'sakuraGrass', wall: 'woodWall', band: 'sakuraTile', liquid: 'lava', spike: '#ffb3dc', laser: 'red', sky: 'pink' },
  magma: { top: 'magmaTile', face: 'darkRock', plateau: 'magmaTile', wall: 'darkRock', band: 'lavaChecker', liquid: 'molten', spike: '#3a2622', laser: 'yellow', sky: 'dusk' },
  space: { top: 'spaceTile', face: 'metal', plateau: 'moonRock', wall: 'metalDark', band: 'spaceTile', liquid: 'void', spike: '#a3a8b4', laser: 'green', sky: 'space' },
  galaxy: { top: 'spaceTile', face: 'galaxyWall', plateau: 'galaxyWall', wall: 'galaxyWall', band: 'rainbowTile', liquid: 'void', spike: '#e0c4ff', laser: 'magenta', sky: 'space' },
  golden: { top: 'gold', face: 'goldWall', plateau: 'gold', wall: 'goldWall', band: 'gold', liquid: 'lava', spike: '#ffd447', laser: 'red', sky: 'bright' },
}

/* ---------------------------------------------------------------------------
 * Physics reach — exact for the game's controller (see physics.js), so the
 * course check, the client and the server all agree on what's possible.
 * ------------------------------------------------------------------------- */

export const jumpVelocity = (height) => Math.sqrt(2 * PHYSICS.gravity * height)

/** Highest a build climbs by holding jump (each jump fires just before the top of the last). */
export function climbHeight({ jumps, height }) {
  const g = PHYSICS.gravity
  const vj = jumpVelocity(height)
  const fire = AUTO_JUMP_FIRE_SPEED
  return ((vj * vj - fire * fire) / (2 * g)) * (jumps - 1) + (vj * vj) / (2 * g)
}

/** Longest gap a build clears, landing `rise` higher than it took off. */
export function gapReach(stats, rise = 0) {
  const { speed, jumps, height } = stats
  const g = PHYSICS.gravity
  const vj = jumpVelocity(height)
  const fire = AUTO_JUMP_FIRE_SPEED
  const maxFall = PHYSICS.maxFallSpeed
  const peak = climbHeight(stats)
  const freeFall = (maxFall * maxFall) / (2 * g)
  const drop = Math.max(0, peak - rise)
  const fall = drop <= freeFall ? Math.sqrt((2 * drop) / g) : maxFall / g + (drop - freeFall) / maxFall
  const time = ((vj - fire) / g) * (jumps - 1) + vj / g + fall
  return Math.min(speed, PHYSICS.maxMoveSpeed) * time
}

const FIRST_BUILD = { level: 1, boot: 'starter', rebirths: 0 }
const buildStats = (def) => moveStats(def.level, def.boot, def.rebirths)

/** The reference build for stage `index` (1-based); index 0 is a brand new player. */
export const stageBuild = (index) => buildStats(index > 0 ? STAGES[index - 1] : FIRST_BUILD)

/**
 * Size of stage `index`'s gate: comfortably inside what its reference build
 * can do, and (where the builds differ enough) beyond the build before it.
 * Walls are measured in climb height, gaps in reach.
 */
export function gateSize(index) {
  const def = STAGES[index - 1]
  const cur = stageBuild(index)
  const prev = stageBuild(index - 1)
  const wall = def.gate === 'wall'
  const c = wall ? climbHeight(cur) : gapReach(cur, STAGE_RISE)
  const p = wall ? climbHeight(prev) : gapReach(prev, STAGE_RISE)
  const safe = wall ? 0.93 : 0.87
  return round(Math.min(safe * c, Math.max(1.04 * p, p + 0.5 * (c - p))))
}

const round = (v) => Math.round(v * 100) / 100

/* ---------------------------------------------------------------------------
 * Layout
 * ------------------------------------------------------------------------- */

let cached = null

/** Builds (once) and returns the full layout. */
export function getLayout() {
  if (!cached) cached = buildLayout()
  return cached
}

export function buildLayout() {
  const layout = {
    boxes: [],
    pads: [],
    triggers: [],
    stages: [],
    signs: [],
    decor: [],
    lasers: [],
    sweepers: [],
    spikes: [],
    trampolines: [],
    bootStands: [],
    leaderboards: [],
    doors: [],
    sharks: [],
    spawn: SPAWN,
    chest: null,
    checkpointDoor: null,
    trailsStand: null,
    courseEndZ: 0,
  }

  /** Adds an axis-aligned box. `zone` groups geometry for culling (0 = lobby, k = stage k). */
  const box = (x0, x1, y0, y1, z0, z1, mat, opts = {}) => {
    const b = {
      min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)],
      max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)],
      mat,
      solid: opts.solid ?? true,
      visible: opts.visible ?? true,
      zone: opts.zone ?? 0,
    }
    if (opts.door) b.door = opts.door
    layout.boxes.push(b)
    return b
  }

  buildLobby(layout, box)
  buildCourse(layout, box)
  return layout
}

function trigger(layout, kind, data, x0, x1, z0, z1, y0 = -1, y1 = 12) {
  layout.triggers.push({ kind, ...data, min: [Math.min(x0, x1), y0, Math.min(z0, z1)], max: [Math.max(x0, x1), y1, Math.max(z0, z1)] })
}

/* ---------------------------------------------------------------------------
 * Lobby: small and cute. Boots on the left, trampolines on the right,
 * leaderboards at the back, the course through the front gate.
 * ------------------------------------------------------------------------- */

const BOOT_ROWS = [
  { x: -24, base: 0, zs: [78, 66, 54, 42, 30, 18] },
  { x: -40, base: 2.4, zs: [72, 60, 48, 36, 24] },
]
const TRAMP_X = 31
const TRAMP_ZS = [80, 67, 54, 41, 28, 15]
export const TRAMP_RADIUS = 4.2
export const TRAMP_TOP = 1.4
/** Bounce height on a trampoline (studs). */
export const TRAMP_BOUNCE = 11

function buildLobby(layout, box) {
  const hx = LOBBY_HALF_X
  const front = LOBBY_FRONT_Z
  const back = LOBBY_BACK_Z
  const wallH = 10
  const open = 14
  const inf = 3000

  // Floor, the gate passage, and the lawn the lobby sits on.
  box(-hx, hx, -3, 0, front, back, 'lobbyFloor')
  box(-open, open, -3, 0, COURSE_START_Z, front, 'lobbyPath')
  box(-260, 260, SEA_Y, -0.6, back + 4, 260, 'lawn', { solid: false })
  for (const side of [-1, 1]) {
    box(side * (hx + 4), side * 260, SEA_Y, -0.6, -160, back + 4, 'lawn', { solid: false })
  }
  // Path from the spawn to the gate, and the spawn pad.
  box(-6, 6, 0, 0.06, front, 58, 'lobbyPath', { solid: false })
  box(-7, 7, 0, 0.2, SPAWN.z - 7, SPAWN.z + 7, 'spawn')

  // Low cute walls with a white cap; invisible barriers keep you in.
  const wall = (x0, x1, z0, z1) => {
    box(x0, x1, -3, wallH, z0, z1, 'lobbyWall')
    box(x0 - 0.4, x1 + 0.4, wallH, wallH + 1, z0 - 0.4, z1 + 0.4, 'lobbyTrim', { solid: false })
    box(x0, x1, wallH, inf, z0, z1, 'none', { visible: false })
  }
  wall(-hx - 4, -hx, front - 4, back + 4)
  wall(hx, hx + 4, front - 4, back + 4)
  wall(-hx, hx, back, back + 4)
  wall(-hx, -open, front - 4, front)
  wall(open, hx, front - 4, front)
  // Gate towers either side of the opening.
  for (const side of [-1, 1]) {
    box(side * open - 3, side * open + 3, -3, wallH + 8, front - 5, front + 1, 'lobbyTower')
    box(side * open - 3.5, side * open + 3.5, wallH + 8, wallH + 9, front - 5.5, front + 1.5, 'lobbyTrim', { solid: false })
  }
  layout.signs.push({ kind: 'gate', pos: [0, wallH + 7, front - 2] })

  // Boots shop: two rows, the back one on a raised step.
  box(-hx, -34, 0, 2.4, 14, 82, 'stageStep')
  box(-34, -32.6, 0, 1.2, 14, 82, 'stageStep')
  let i = 0
  for (const row of BOOT_ROWS) {
    for (const z of row.zs) {
      const boot = BOOTS[i]
      i += 1
      if (!boot) continue
      box(row.x - 3.2, row.x + 3.2, row.base, row.base + 1, z - 3.2, z + 3.2, 'pedestal')
      layout.bootStands.push({ boot: boot.id, pos: [row.x, row.base + 1, z] })
      trigger(layout, 'boot', { id: boot.id }, row.x - 5, row.x + 5, z - 5.5, z + 5.5, row.base - 1, row.base + 9)
    }
  }
  layout.signs.push({ kind: 'title', text: 'BOOTS', color: '#3fa8ff', pos: [-hx + 0.6, 17, 48], rotY: Math.PI / 2, size: 9 })

  // Trampolines along the right wall.
  TRAMPOLINES.forEach((tramp, k) => {
    const z = TRAMP_ZS[k]
    box(TRAMP_X - TRAMP_RADIUS, TRAMP_X + TRAMP_RADIUS, 0, TRAMP_TOP, z - TRAMP_RADIUS, z + TRAMP_RADIUS, 'none', { visible: false })
    layout.trampolines.push({ id: tramp.id, mult: tramp.mult, center: [TRAMP_X, z], top: TRAMP_TOP, radius: TRAMP_RADIUS })
    trigger(layout, 'tramp', { id: tramp.id }, TRAMP_X - 6.5, TRAMP_X + 6.5, z - 6.2, z + 6.2, -1, 40)
  })
  layout.signs.push({ kind: 'title', text: 'TRAMPOLINES', color: '#ff5fb0', pos: [hx - 0.6, 17, 48], rotY: -Math.PI / 2, size: 8, sub: 'Automatically increases your Jump!' })

  // Leaderboards along the back, facing the spawn.
  const boards = [
    { stat: 'totalJump', title: 'Top Jump', subtitle: 'Most Jump', color: '#2f8cff', x: -22 },
    { stat: 'wins', title: 'Top Wins', subtitle: 'Most Wins', color: '#ff9a1f', x: 0 },
    { stat: 'rebirths', title: 'Top Rebirths', subtitle: 'Most Rebirths', color: '#b45cff', x: 22 },
  ]
  for (const board of boards) {
    layout.leaderboards.push({ ...board, pos: [board.x, 0, back - 5], rotY: Math.PI })
    box(board.x - 7.5, board.x + 7.5, 0, 22, back - 6.2, back - 3.8, 'none', { visible: false })
  }

  // Teleport-to-checkpoint door (front left), trails stand and free chest (front right).
  layout.checkpointDoor = { pos: [-30, 0, front + 0.6] }
  box(-36, -24, 0, 12, front, front + 1.2, 'none', { visible: false })
  trigger(layout, 'checkpoint', {}, -36, -24, front + 1.2, front + 8)

  layout.trailsStand = { pos: [23, 0, 6] }
  box(19, 27, 0, 7, 3, 9, 'none', { visible: false })
  trigger(layout, 'trails', {}, 17, 29, 9, 14)

  layout.chest = { pos: [41, 0, 6] }
  box(38.8, 43.2, 0, 3, 3.8, 8.2, 'none', { visible: false })
  trigger(layout, 'chest', {}, 36, 46, 8.2, 14)

  layout.decor.push({ kind: 'lobby', halfX: hx, front, back, wallH })
}

/* ---------------------------------------------------------------------------
 * Course
 * ------------------------------------------------------------------------- */

/** The first stage with each hazard. */
export const FIRST_SPIKE_STAGE = 2
export const FIRST_LASER_STAGE = 4
export const FIRST_SWEEPER_STAGE = 8
export const FIRST_GATE_LASER_STAGE = 9

function buildCourse(layout, box) {
  const C = CORRIDOR_HALF
  const rng = mulberry32(20261012)
  let zStart = COURSE_START_Z
  let prevTop = 0

  STAGES.forEach((def, i) => {
    const index = i + 1
    const zone = index
    const theme = THEMES[def.theme]
    const isFinal = index === STAGES.length
    const top = index * STAGE_RISE
    const lavaY = prevTop - LAVA_DEPTH
    const prev = stageBuild(index - 1)
    const prevClimb = climbHeight(prev)
    const gate = gateSize(index)

    // --- Stepping platforms: easy for the build before this stage.
    const riseMax = round(Math.min(0.4 * prevClimb, 2 + 0.6 * index))
    const gapCap = Math.min(0.5 * gapReach(prev, riseMax), 8 + 2.2 * index)
    const count = 3 + Math.floor(index / 3)
    const platforms = []
    let z = zStart
    let lastX = [-C, C]
    for (let k = 0; k < count; k += 1) {
      const gap = round(gapCap * (0.55 + 0.45 * rng()))
      const len = round(10 + rng() * 8 + index * 0.4)
      const width = round(Math.min(2 * C - 4, 14 + rng() * 14 + (index < 6 ? 6 : 0)))
      // Overlap the previous platform by at least 8 studs so the jump is straight ahead.
      const lo = Math.max(-C + 1 + width / 2, lastX[0] + 8 - width / 2)
      const hi = Math.min(C - 1 - width / 2, lastX[1] - 8 + width / 2)
      const roll = rng()
      const cx = round(lo <= hi ? lo + (hi - lo) * roll : Math.max(-C + 1 + width / 2, Math.min(C - 1 - width / 2, (lastX[0] + lastX[1]) / 2)))
      const y = round(prevTop + (rng() * 2 - 1) * riseMax * 0.5)
      const z0 = z - gap
      const z1 = z0 - len
      const x0 = cx - width / 2
      const x1 = cx + width / 2
      box(x0, x1, lavaY - 6, y - 1, z1, z0, theme.face, { zone })
      box(x0, x1, y - 1, y, z1, z0, theme.top, { zone })
      platforms.push({ x0, x1, y, z0, z1, gapFrom: z, gap })
      lastX = [x0, x1]
      z = z1
    }

    // --- Take-off platform, full width, at the previous plateau's height.
    const takeoffGap = round(gapCap * 0.6)
    const takeoffZ0 = z - takeoffGap
    const gateZ = takeoffZ0 - TAKEOFF_LENGTH
    box(-C, C, lavaY - 6, prevTop - 1, gateZ, takeoffZ0, theme.face, { zone })
    box(-C, C, prevTop - 1, prevTop, gateZ, takeoffZ0, theme.top, { zone })
    platforms.push({ x0: -C, x1: C, y: prevTop, z0: takeoffZ0, z1: gateZ, gapFrom: z, gap: takeoffGap, takeoff: true })

    // --- The gate.
    let plateauZ0
    let wallTop = 0
    if (def.gate === 'wall') {
      wallTop = prevTop + gate
      plateauZ0 = gateZ - GATE_WALL_THICK
      box(-C, C, lavaY - 6, wallTop, plateauZ0, gateZ, theme.wall, { zone })
      box(-C, C, wallTop - 1, wallTop, plateauZ0, gateZ, theme.band, { zone, solid: false })
      layout.signs.push({ kind: 'climbWall', level: def.level, height: gate, pos: [0, prevTop + Math.min(gate * 0.5, 14), gateZ + 0.06], zone, first: index === 2 })
    } else {
      plateauZ0 = gateZ - gate
      layout.signs.push({ kind: 'gapSign', level: def.level, pos: [0, prevTop + 7, gateZ - 0.5], zone, first: index === 1 })
    }

    // --- Plateau with the Return and 2x Wins pads.
    const plateauLength = isFinal ? FINAL_PLATEAU_LENGTH : PLATEAU_LENGTH
    const plateauZ1 = plateauZ0 - plateauLength
    box(-C, C, lavaY - 6, top - 1, plateauZ1, plateauZ0, theme.face, { zone })
    box(-C, C, top - 1, top, plateauZ1, plateauZ0, theme.plateau, { zone })
    const padZ = plateauZ0 - 14

    const stage = {
      index,
      name: def.name,
      theme: def.theme,
      wins: def.wins,
      level: def.level,
      boot: def.boot,
      rebirths: def.rebirths,
      gate: def.gate,
      gateSize: gate,
      zone,
      zStart,
      gateZ,
      plateauZ0,
      plateauZ1,
      floorY: top,
      prevTop,
      lavaY,
      wallTop,
      platforms,
      checkpoint: { x: 0, y: top + 0.2, z: plateauZ1 + 9, yaw: Math.PI },
    }
    layout.stages.push(stage)

    for (const pad of [
      { kind: 'return', x0: -17, x1: -5, mat: 'returnPad' },
      { kind: 'double', x0: 5, x1: 17, mat: 'doublePad' },
    ]) {
      box(pad.x0, pad.x1, top - 0.5, top + 0.3, padZ - 5, padZ + 5, pad.mat, { zone })
      layout.pads.push({ stage: index, kind: pad.kind, wins: def.wins, min: [pad.x0, top, padZ - 5], max: [pad.x1, top + 0.3, padZ + 5] })
      layout.signs.push({ kind: 'padLabel', pad: pad.kind, wins: def.wins, pos: [(pad.x0 + pad.x1) / 2, top + 6.2, padZ], zone })
    }
    layout.signs.push({ kind: 'stageTitle', index, text: `Stage ${index}`, sub: def.name, theme: def.theme, pos: [0, top + 19, plateauZ0 - 4], zone })

    // --- Corridor walls (with a bright band along the top) and the lava.
    const sideTop = Math.max(top + 34, wallTop + 26)
    stage.sideTop = sideTop
    for (const side of [-1, 1]) {
      const xi = side * C
      const xo = side * (C + WALL_THICK)
      box(xi, xo, SEA_Y, sideTop - 5, plateauZ1, zStart, theme.wall, { zone })
      box(xi, xo, sideTop - 5, sideTop, plateauZ1, zStart, theme.band, { zone })
      box(xi, xo, sideTop, 3000, plateauZ1, zStart, 'none', { visible: false, zone })
    }
    box(-C, C, lavaY - 6, lavaY, plateauZ1, zStart, `liquid_${theme.liquid}`, { zone })

    if (isFinal) {
      // The end of the course: a golden wall, a trophy and the way out.
      box(-C - WALL_THICK, C + WALL_THICK, SEA_Y, sideTop, plateauZ1 - 4, plateauZ1, theme.wall, { zone })
      stage.trophy = [0, top, plateauZ1 + 22]
      layout.signs.push({ kind: 'escaped', pos: [0, top + 30, plateauZ1 + 10], zone })
    } else {
      // "RECOMMENDED LEVEL X" for the next stage, and its rebirth door.
      const next = STAGES[index]
      layout.signs.push({ kind: 'recommend', stage: index + 1, level: next.level, boot: next.boot, rebirths: next.rebirths, pos: [-13, top, plateauZ1 + 3], zone })
      if (next.rebirths > 0) {
        box(-C, C, top, 3000, plateauZ1 - 0.6, plateauZ1 + 0.6, 'none', { visible: false, zone, door: next.rebirths })
        layout.doors.push({ stage: index + 1, rebirths: next.rebirths, y: top, z: plateauZ1 })
      }
    }

    addHazards(layout, stage, rng)
    if (def.theme === 'shark') addSharks(layout, stage, rng)
    layout.decor.push({ kind: 'stage', index, zone })

    zStart = plateauZ1
    prevTop = top
  })

  layout.courseEndZ = zStart
}

/** Spikes on the stepping platforms, lasers across their gaps, sweepers on the wide ones. */
function addHazards(layout, stage, rng) {
  const { index, platforms, zone } = stage
  const prev = stageBuild(index - 1)
  const laserReach = Math.min(Math.max(climbHeight(prev) * 0.45, 7), 22)
  platforms.forEach((pl, k) => {
    if (pl.takeoff) return
    const len = pl.z0 - pl.z1
    const width = pl.x1 - pl.x0

    // Spikes: a row across one side of the platform, leaving a clear lane.
    if (index >= FIRST_SPIKE_STAGE && rng() < 0.45 + index * 0.02 && width >= 14) {
      const lane = 7
      const leftLane = rng() < 0.5
      const from = leftLane ? pl.x0 + lane : pl.x0 + 1.5
      const to = leftLane ? pl.x1 - 1.5 : pl.x1 - lane
      const zc = pl.z1 + len * (0.35 + 0.3 * rng())
      for (let x = from; x <= to; x += 2.8) {
        layout.spikes.push({ x: round(x), y: pl.y, z: round(zc), r: 1.2, h: 3.2, zone })
      }
    }

    // A sweeper bar spinning over the wider platforms.
    if (index >= FIRST_SWEEPER_STAGE && len >= 14 && width >= 18 && rng() < 0.55) {
      layout.sweepers.push({
        center: [round((pl.x0 + pl.x1) / 2), pl.y + 2.4, round((pl.z0 + pl.z1) / 2)],
        radius: round(Math.min(width, len) / 2 - 0.6),
        speed: (1.1 + index * 0.05) * (k % 2 ? -1 : 1),
        phase: rng() * Math.PI * 2,
        zone,
      })
    }

    // Lasers bobbing across the gap in front of this platform.
    if (index >= FIRST_LASER_STAGE && pl.gap >= 6 && rng() < 0.5) {
      layout.lasers.push({
        z: round(pl.z0 + pl.gap / 2),
        yMin: pl.y + 0.8,
        yMax: pl.y + laserReach,
        speed: 0.9 + index * 0.05,
        phase: rng() * Math.PI * 2,
        color: THEMES[stage.theme].laser,
        zone,
      })
    }
  })

  // Lasers across the big gaps of later gap stages.
  if (stage.gate === 'gap' && index >= FIRST_GATE_LASER_STAGE) {
    const count = 1 + Math.floor(index / 6)
    const reach = Math.min(Math.max(climbHeight(stageBuild(index)) * 0.3, 12), 45)
    for (let k = 0; k < count; k += 1) {
      layout.lasers.push({
        z: round(stage.gateZ - stage.gateSize * ((k + 1) / (count + 1))),
        yMin: stage.prevTop + 0.8,
        yMax: stage.prevTop + reach,
        speed: 0.8 + index * 0.04,
        phase: rng() * Math.PI * 2,
        color: THEMES[stage.theme].laser,
        zone,
      })
    }
  }
}

/** Sharks circling in the lava of Shark Bay (scenery, like the original). */
function addSharks(layout, stage, rng) {
  for (let k = 0; k < 4; k += 1) {
    layout.sharks.push({
      z: round(stage.zStart - (stage.zStart - stage.gateZ) * (0.2 + 0.6 * rng())),
      y: stage.lavaY,
      range: 14 + rng() * 4,
      speed: 0.6 + rng() * 0.4,
      phase: rng() * Math.PI * 2,
      zone: stage.zone,
    })
  }
}

/* ---------------------------------------------------------------------------
 * Queries shared by client physics and server validation
 * ------------------------------------------------------------------------- */

/**
 * Par time (seconds) for the third star: from entering the stage to its Return
 * pad, about twice what the stage's recommended build needs, plus a little
 * to climb or line up.
 */
export function stagePar(stage) {
  const length = stage.zStart - (stage.plateauZ0 - 14)
  const speed = stageBuild(stage.index).speed
  return Math.round((2 * length) / speed + 6 + (stage.gate === 'wall' ? 4 : 0))
}

/** True inside the lobby (and its gate passage). */
export const inLobby = (z) => z > COURSE_START_Z

/** The stage whose stretch of course contains z, or null in the lobby. */
export function stageAt(layout, z) {
  for (const stage of layout.stages) {
    if (z <= stage.zStart && z >= stage.plateauZ1) return stage
  }
  return null
}

/** True when a player at (x, y, z) has dropped into the lava. */
export function inLava(layout, x, y, z) {
  const stage = stageAt(layout, z)
  return Boolean(stage) && y <= stage.lavaY + 0.6
}

/** True when standing on stage `stage`'s plateau (past the gate). */
export function onPlateau(stage, y, z) {
  return Boolean(stage) && z <= stage.plateauZ0 - 2 && z >= stage.plateauZ1 && y >= stage.floorY - 0.5
}

export function insideBox(b, x, y, z, margin = 0) {
  return (
    x >= b.min[0] - margin &&
    x <= b.max[0] + margin &&
    y >= b.min[1] - margin &&
    y <= b.max[1] + margin &&
    z >= b.min[2] - margin &&
    z <= b.max[2] + margin
  )
}

/** The trampoline whose column contains (x, z) while at or above its top, if any. */
export function trampolineAt(layout, x, y, z) {
  for (const t of layout.trampolines) {
    const dx = x - t.center[0]
    const dz = z - t.center[1]
    if (dx * dx + dz * dz > t.radius * t.radius) continue
    if (y >= t.top - 0.6 && y <= t.top + TRAMP_BOUNCE + 8) return t
  }
  return null
}

/** Where the checkpoint door sends someone whose best stage is `best`. */
export function checkpointFor(layout, best) {
  const stage = layout.stages[Math.min(best, layout.stages.length) - 1]
  return stage ? stage.checkpoint : null
}

/** 0 in the lobby up to the number of stages at the end: where a player is on the course. */
export function courseProgress(layout, z) {
  if (inLobby(z)) return 0
  const stage = stageAt(layout, z)
  if (!stage) return layout.stages.length
  if (z <= stage.plateauZ0) return stage.index
  const span = stage.zStart - stage.plateauZ0
  const t = span > 0 ? (stage.zStart - z) / span : 1
  return stage.index - 1 + Math.max(0, Math.min(1, t))
}
