/**
 * Deterministic world layout: a small lobby and a 20-stage escape course.
 *
 * Pure data, no three.js — the client turns it into meshes and colliders, the
 * server uses the same pads, jump pads, doors and stage bounds to validate
 * claims. Shared with the server (see the note at the top of gameData.js).
 *
 * Coordinates are studs, Y up. The lobby sits at z ∈ [0, 144]; the course runs
 * from its front opening towards -Z down a walled corridor over lava, like the
 * original: tall studded walls with columns, and a short walled corridor with
 * "Stage N" over its mouth into each stage. A stage starts with that corridor,
 * then its gate — one long jump from the corridor's end, sized from the
 * physics for exactly what the stage needs — then
 * flat platforms across the lava, and ends on a wide platform (the "plateau")
 * with a Return pad and a 2x Wins pad; the next stage's corridor starts at its
 * far edge — behind a door when it needs new boots or more rebirths.
 * Every stage is built the same way, for exactly its level and boots (see Course).
 */
import { BOOTS, EGGS, JUMP_PADS, PHYSICS, STAGES, WORLDS, WORLD_BY_ID, bootTier, levelForJumps, moveStats, mulberry32, worldOfStage } from './gameData.js'

export { mulberry32 }

/** The corridor's inner walls stand at x = ±CORRIDOR_HALF. */
export const CORRIDOR_HALF = 40
export const WALL_THICK = 4
export const LOBBY_HALF_X = 50
export const LOBBY_FRONT_Z = 0
export const LOBBY_BACK_Z = 144
/** Where the course starts: the far side of the lobby's front wall. */
export const COURSE_START_Z = -4
/** Each plateau sits this much higher than the one before. */
export const STAGE_RISE = 2
/** The lava sits this far below the surface you jump from. */
export const LAVA_DEPTH = 9
export const PLATEAU_LENGTH = 64
export const FINAL_PLATEAU_LENGTH = 90
/** The sea far below everything (scenery). */
export const SEA_Y = -46
export const SPAWN = Object.freeze({ x: 0, y: 0.2, z: 66, yaw: Math.PI })

/** While jump is held, the next jump fires when rising speed drops to this (see physics.js). */
export const AUTO_JUMP_FIRE_SPEED = 2.5

/**
 * Material keys per theme (the client maps each to a texture).
 *  top / face    platforms            plateau / plateauSide  stage-end floor and its sides
 *  wall / upper  corridor walls (upper = a second colour, from `upperAt` studs above the lava)
 *  band          the strip along the top of the walls      pillar  the columns
 *  pillarRise    how far the columns stand up above the walls
 *  stripes       bright strips along the platform edges
 *  liquid        the deadly floor
 *  spike         spike colour           laser   laser beam colour
 */
const theme = (t) => ({ plateauSide: t.face, pillar: t.band, upper: null, upperAt: 14, pillarRise: 0.6, stripes: true, ...t })

export const THEMES = {
  // The hand-built stages, in the original's colours.
  brick: theme({ top: 'lilacChecker', face: 'lilacChecker', plateau: 'stoneTile', plateauSide: 'stoneBrick', wall: 'lilacWall', upper: 'yellowStud', upperAt: 26, band: 'yellowStud', pillar: 'navyStud', pillarRise: 7, stripes: false, liquid: 'lava', spike: '#8e92a6', laser: 'red', sky: 'day' }),
  red: theme({ top: 'safeBlue', face: 'safeBlue', plateau: 'stoneTile', plateauSide: 'stoneBrick', wall: 'lavenderWall', band: 'lavenderWall', pillar: 'navyStud', pillarRise: 7, stripes: false, liquid: 'lava', spike: '#8e92a6', laser: 'red', sky: 'day' }),
  lava: theme({ top: 'lilacChecker', face: 'lilacChecker', plateau: 'stoneTile', plateauSide: 'stoneBrick', wall: 'brownBrick', band: 'tanStud', pillar: 'tanStud', liquid: 'lava', spike: '#8e92a6', laser: 'red', sky: 'day' }),
  shark: theme({ top: 'charcoalChecker', face: 'charcoalChecker', plateau: 'stoneTile', plateauSide: 'stoneBrick', wall: 'brownBrick', band: 'tanStud', pillar: 'tanStud', liquid: 'lava', spike: '#7d8194', laser: 'red', sky: 'day' }),
  spike: theme({ top: 'navyChecker', face: 'navyChecker', plateau: 'stoneTile', plateauSide: 'stoneBrick', wall: 'brownBrick', band: 'tanStud', pillar: 'tanStud', liquid: 'lava', spike: '#6f7386', laser: 'red', sky: 'day' }),
  // Generated stages.
  ice: theme({ top: 'ice', face: 'iceWall', plateau: 'snow', wall: 'iceWall', band: 'snow', liquid: 'icewater', spike: '#bfefff', laser: 'magenta', sky: 'cold' }),
  candy: theme({ top: 'candy', face: 'candyWall', plateau: 'candy', wall: 'candyWall', band: 'mintStud', liquid: 'chocolate', spike: '#ffffff', laser: 'red', sky: 'pink' }),
  jungle: theme({ top: 'jungleTile', face: 'mossStone', plateau: 'forestTop', wall: 'mossStone', band: 'jungleGrass', liquid: 'swamp', spike: '#6b4223', laser: 'yellow', sky: 'day' }),
  neon: theme({ top: 'neonFloor', face: 'neonWall', plateau: 'neonFloor', wall: 'neonWall', band: 'neonWall', liquid: 'neon', spike: '#ff3df2', laser: 'green', sky: 'night' }),
  volcano: theme({ top: 'magmaTile', face: 'darkRock', plateau: 'lavaChecker', wall: 'darkRock', band: 'magmaTile', liquid: 'lava', spike: '#2d2523', laser: 'yellow', sky: 'dusk' }),
  cloud: theme({ top: 'cloudWhite', face: 'cloudStone', plateau: 'goldWall', wall: 'cloudStone', band: 'cloudWhite', liquid: 'void', spike: '#ffd23a', laser: 'red', sky: 'bright' }),
  toxic: theme({ top: 'toxicTile', face: 'metal', plateau: 'hazardStripe', wall: 'metalDark', band: 'slimeFloor', liquid: 'slime', spike: '#5a6270', laser: 'green', sky: 'toxic' }),
  haunted: theme({ top: 'hauntedTile', face: 'hauntedStone', plateau: 'hauntedTile', wall: 'hauntedStone', band: 'hauntedGround', liquid: 'ghost', spike: '#55506a', laser: 'magenta', sky: 'night' }),
  crystal: theme({ top: 'crystalTile', face: 'crystalWall', plateau: 'crystalTile', wall: 'crystalWall', band: 'crystalTile', liquid: 'crystal', spike: '#e0d2ff', laser: 'magenta', sky: 'pink' }),
  factory: theme({ top: 'metal', face: 'hazardStripe', plateau: 'metal', wall: 'metalDark', band: 'hazardStripe', liquid: 'molten', spike: '#4c535e', laser: 'yellow', sky: 'warm' }),
  sakura: theme({ top: 'sakuraTile', face: 'woodWall', plateau: 'sakuraGrass', wall: 'woodWall', band: 'sakuraTile', liquid: 'lava', spike: '#ffb3dc', laser: 'red', sky: 'pink' }),
  magma: theme({ top: 'magmaTile', face: 'darkRock', plateau: 'magmaTile', wall: 'darkRock', band: 'lavaChecker', liquid: 'molten', spike: '#3a2622', laser: 'yellow', sky: 'dusk' }),
  space: theme({ top: 'spaceTile', face: 'metal', plateau: 'moonRock', wall: 'metalDark', band: 'spaceTile', liquid: 'void', spike: '#a3a8b4', laser: 'green', sky: 'space' }),
  galaxy: theme({ top: 'spaceTile', face: 'galaxyWall', plateau: 'galaxyWall', wall: 'galaxyWall', band: 'rainbowTile', liquid: 'void', spike: '#e0c4ff', laser: 'magenta', sky: 'space' }),
  golden: theme({ top: 'gold', face: 'goldWall', plateau: 'gold', wall: 'goldWall', band: 'gold', liquid: 'lava', spike: '#ffd447', laser: 'red', sky: 'bright' }),
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

/** How a player who just meets stage `index` (1-based) moves: its jumps, in its boots. Index 0 is a brand new player. */
export const stageBuild = (index) => (index > 0 ? moveStats(STAGES[index - 1].level, STAGES[index - 1].boot, 0, STAGES[index - 1].rebirths) : moveStats(0))

/** The fewest jumps that clear `gap` studs, landing `rise` higher, at `speed`. */
export function jumpsForGap(gap, rise = 0, speed = 16) {
  for (let jumps = 1; jumps <= 60; jumps += 1) if (gapReach({ jumps, speed, height: moveStats(0).height }, rise) >= gap) return jumps
  return 60
}

/**
 * A gap that needs exactly `build`'s jumps at its speed: one jump fewer falls
 * short by 2% or more (and so does anything under `lo`), the build itself
 * clears it with 4% to spare; inside that, `share` of its reach where it fits.
 */
export function gapNeeding(build, rise = 0, share = 0.75, lo = 0) {
  const reach = gapReach(build, rise)
  const fewer = build.jumps > 1 ? gapReach({ ...build, jumps: build.jumps - 1 }, rise) * 1.02 : 0
  return round(Math.min(reach / 1.04, Math.max(fewer, lo, reach * share)))
}

/** 0 on the first stage up to 1 on the last: how far along the course difficulty is. */
export const stageRamp = (index) => (index - 1) / Math.max(1, STAGES.length - 1)

/**
 * Length of stage `index`'s gate (the long jump in, from the end of its
 * corridor). Like every gap in the stage it needs exactly the stage's jumps,
 * and when the stage brings new boots, the boots before can't make it either
 * (see gapNeeding); a comfortable share of the reach (74% on stage 1 up to 84%
 * on the last) where that fits.
 */
export function gateSize(index) {
  const build = stageBuild(index)
  const before = STAGES[index - 2]
  const def = STAGES[index - 1]
  const slower = before && before.boot !== def.boot ? gapReach({ ...build, speed: moveStats(0, before.boot).speed }, STAGE_RISE) * 1.02 : 0
  return gapNeeding(build, STAGE_RISE, 0.74 + 0.1 * stageRamp(index), slower)
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
    bootStands: [],
    leaderboards: [],
    /** Jump pads: { id, rate, rebirths, center: [x, z], half, top }. */
    jumpPads: [],
    eggStands: [],
    /** Breaking bridges: { id, min, max, zone } (the boxes carry `bridge: id`). */
    bridges: [],
    shopStand: null,
    plaza: null,
    /** Doors across the course: { stage, boot (tier), rebirths, y, z, halfWidth }. */
    doors: [],
    /** Doors between worlds: { world, rebirths, pos, rotY, zone }. */
    worldDoors: [],
    /** Each world's lobby: the WORLDS entry plus { spawn, lobbyMin, lobbyMax, regionMax } (z). */
    worlds: [],
    sharks: [],
    /** Red floors that kill on touch (Stage 2): { min, max, zone }. */
    killZones: [],
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
    if (opts.bridge) b.bridge = opts.bridge
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
 * Lobby: an open park behind a castle gate. Low hedges all round (with the
 * gardens beyond), the tall gate wall in front with "Stage 1" over the way
 * out. From the spawn plaza in the middle: the boots gallery down the left
 * (one row from the slippers at the back to the best pair by the gate), the
 * jump pads on the right, and at the back the pet eggs, the World 2 portal,
 * the Wins Shop and the leaderboards.
 * ------------------------------------------------------------------------- */

/** The boots gallery: one row along the left, slippers at the back, the best pair nearest the gate. */
export const BOOT_ROW = Object.freeze({ x: -34, z0: 112, step: 9.2, top: 1.2 })
/** Jump pads: a 2x3 grid right of the spawn (pad 1 nearest it); each is square, `PAD_HALF` across, its top at `PAD_TOP`. */
export const PAD_HALF = 4.6
export const PAD_TOP = 1.2
const PAD_SPOTS = [
  [21, 78],
  [36, 78],
  [21, 62],
  [36, 62],
  [21, 46],
  [36, 46],
]
/** The plaza round the spawn (a painted circle). */
export const PLAZA = Object.freeze({ x: 0, z: 66, radius: 15 })
/** Half the width of the gates out of a world's lobby (and of the corridor into its first stage). */
export const GATE_OPEN = 22

function buildLobby(layout, box) {
  const hx = LOBBY_HALF_X
  const front = LOBBY_FRONT_Z
  const back = LOBBY_BACK_Z
  const wallH = 24
  const hedge = 4.5
  const open = GATE_OPEN
  const inf = 3000

  // Floor, the gate passage, and the lawn the lobby sits on.
  box(-hx, hx, -3, 0, front, back, 'lobbyFloor')
  box(-open, open, -3, 0, COURSE_START_Z, front, 'lobbyPath')
  box(-260, 260, SEA_Y, -0.6, back + 4, 360, 'lawn', { solid: false })
  for (const side of [-1, 1]) box(side * (hx + 4), side * 260, SEA_Y, -0.6, -160, back + 4, 'lawn', { solid: false })
  // Zone floors (paint, a hair above the floor): the boots gallery, the jump
  // pads and the back of the lobby.
  box(-hx, -26, 0, 0.04, 8, 108, 'bootsZone', { solid: false })
  box(13, hx, 0, 0.04, 36, 88, 'padZone', { solid: false })
  box(-hx, hx, 0, 0.04, 108, back, 'backZone', { solid: false })
  // White chevrons from the spawn plaza to the gate, and the spawn pad.
  box(-6, 6, 0, 0.06, front, PLAZA.z - PLAZA.radius, 'chevronPath', { solid: false })
  box(-7, 7, 0, 0.2, SPAWN.z - 7, SPAWN.z + 7, 'spawn')
  layout.plaza = { ...PLAZA }

  // Low hedges round the sides and back (you can see the gardens over them);
  // invisible barriers keep you in.
  const hedgeWall = (x0, x1, z0, z1) => {
    box(x0, x1, -3, hedge, z0, z1, 'hedge')
    box(x0, x1, hedge, inf, z0, z1, 'none', { visible: false })
  }
  hedgeWall(-hx - 4, -hx, front, back + 4)
  hedgeWall(hx, hx + 4, front, back + 4)
  hedgeWall(-hx, hx, back, back + 4)
  // The gate wall in front: tall stone with a gold cap, towers either side of
  // the way out and "Stage 1" floating over it.
  const gateWall = (x0, x1) => {
    box(x0, x1, -3, wallH, front - 4, front, 'gateWall')
    box(x0 - 0.4, x1 + 0.4, wallH, wallH + 1.2, front - 4.4, front + 0.4, 'gold', { solid: false })
    box(x0, x1, wallH, inf, front - 4, front, 'none', { visible: false })
  }
  gateWall(-hx - 4, -open)
  gateWall(open, hx + 4)
  for (const side of [-1, 1]) box(side * open - 3, side * open + 3, -3, wallH + 4, front - 5, front + 1, 'lobbyTower')
  layout.signs.push({ kind: 'gate', pos: [0, 16, front + 1.12] })

  // The boots gallery: a raised walk with a pedestal per pair, in shop order.
  const { x: bx, z0: bz0, step, top } = BOOT_ROW
  const bz1 = bz0 - step * (BOOTS.length - 1)
  box(bx - 6, bx + 6, 0, top, bz1 - 6, bz0 + 6, 'galleryFloor')
  BOOTS.forEach((boot, i) => {
    const z = round(bz0 - i * step)
    layout.bootStands.push({ boot: boot.id, tier: i, pos: [bx, top, z] })
    box(bx - 2.6, bx + 2.6, top, top + 1.4, z - 2.6, z + 2.6, 'none', { visible: false })
    trigger(layout, 'boot', { id: boot.id }, bx + 2.6, bx + 11, z - step / 2, z + step / 2, -1, 10)
  })
  layout.signs.push({ kind: 'title', text: 'BOOTS', color: '#3fa8ff', pos: [-hx + 0.6, 13.5, (bz0 + bz1) / 2], rotY: Math.PI / 2, size: 7, sub: 'Every pair opens 2 new stages!' })

  // Jump pads: stand on one and it bounces you (AFK training).
  JUMP_PADS.forEach((pad, k) => {
    const [x, z] = PAD_SPOTS[k]
    box(x - PAD_HALF, x + PAD_HALF, 0, PAD_TOP, z - PAD_HALF, z + PAD_HALF, 'none', { visible: false })
    layout.jumpPads.push({ id: pad.id, rate: pad.rate, rebirths: pad.rebirths, center: [x, z], half: PAD_HALF, top: PAD_TOP })
    trigger(layout, 'jumpPad', { id: pad.id }, x - PAD_HALF - 1.5, x + PAD_HALF + 1.5, z - PAD_HALF - 1.5, z + PAD_HALF + 1.5, -1, 14)
  })
  layout.signs.push({ kind: 'title', text: 'JUMP PADS', color: '#3fd16b', pos: [hx - 0.6, 13.5, 62], rotY: -Math.PI / 2, size: 7, sub: 'Stand on one to train (AFK)!' })

  // Pet eggs at the back left, the Wins Shop at the back right.
  EGGS.forEach((egg, k) => {
    const x = -38 + k * 12
    const z = 122
    layout.eggStands.push({ egg: egg.id, pos: [x, 0, z] })
    box(x - 3, x + 3, 0, 6.5, z - 3, z + 3, 'none', { visible: false })
    trigger(layout, 'egg', { id: egg.id }, x - 5, x + 5, z - 9, z - 3, -1, 10)
  })
  layout.shopStand = { pos: [30, 0, 122] }
  box(23, 37, 0, 8, 119, 125, 'none', { visible: false })
  trigger(layout, 'winsShop', {}, 22, 38, 110, 119, -1, 10)

  // The back: the World 2 portal in the middle, leaderboards either side, all facing the spawn.
  addWorldDoor(layout, 2, [0, 0, back - 1.6])
  const boards = [
    { stat: 'totalJump', title: 'Top XP', subtitle: 'Most XP', color: '#2f8cff', x: -38 },
    { stat: 'wins', title: 'Top Wins', subtitle: 'Most Wins', color: '#ff9a1f', x: -21 },
    { stat: 'rebirths', title: 'Top Rebirths', subtitle: 'Most Rebirths', color: '#b45cff', x: 21 },
  ]
  for (const board of boards) {
    layout.leaderboards.push({ ...board, pos: [board.x, 0, back - 5], rotY: Math.PI })
    box(board.x - 7.5, board.x + 7.5, 0, 22, back - 6.2, back - 3.8, 'none', { visible: false })
  }
  layout.worlds.push({ ...WORLDS[0], spawn: SPAWN, lobbyMin: COURSE_START_Z, lobbyMax: Infinity, regionMax: Infinity })

  // Teleport-to-checkpoint door (front left), trails stand and free chest (front right).
  layout.checkpointDoor = { pos: [-30, 0, front + 0.6] }
  box(-36, -24, 0, 12, front, front + 1.2, 'none', { visible: false })
  trigger(layout, 'checkpoint', {}, -36, -24, front + 1.2, front + 8)

  layout.trailsStand = { pos: [23, 0, 7] }
  box(19, 27, 0, 7, 4, 10, 'none', { visible: false })
  trigger(layout, 'trails', {}, 17, 29, 10, 15)

  layout.chest = { pos: [41, 0, 7] }
  box(38.8, 43.2, 0, 3, 4.8, 9.2, 'none', { visible: false })
  trigger(layout, 'chest', {}, 36, 46, 9.2, 15)

  layout.decor.push({ kind: 'lobby', halfX: hx, front, back, wallH, hedge, open, bootRow: { x: bx, z0: bz0, z1: bz1 }, pads: PAD_SPOTS })
}

/* ---------------------------------------------------------------------------
 * Course
 *
 * Every stage is built the same way, simple and roomy, scaled to the build
 * it's for:
 *  - it's all about jumping far, never high: each stage starts with its
 *    corridor and its gate, one long jump that needs exactly the stage's jumps
 *    and boots, and the rest is flat;
 *  - after the gate come two or three big platforms, most of the corridor
 *    wide and about a second and a half of running long, and every gap
 *    between them needs the stage's jumps too (see gapNeeding): one jump
 *    fewer can't make any of them;
 *  - the Wins pads are at the very end of the stage, right before the next
 *    stage's corridor;
 *  - nothing else in the way: lava below, sharks in Shark Bay, red floors in
 *    Stage 2, spikes in the lava on Stage 1 and in Spike Field.
 * The platforms come as wide rows straight ahead or big islands.
 * ------------------------------------------------------------------------- */


/** Columns stand along the corridor walls this often, sticking out this far. */
export const PILLAR_OUT = 1.2
const PILLAR_WIDTH = 3.2
const PILLAR_SPACING = 22
/** Every stage starts with a short corridor this long and this wide (half), walls this high above its floor. */
export const ENTRY_LENGTH = 18
export const ENTRY_HALF = 13
export const ENTRY_WALL = 9
const C = CORRIDOR_HALF
/** Platforms keep this far in from the walls (clear of the columns). */
const EDGE = C - PILLAR_OUT - 0.6

/** How each stage's platforms are laid out (see PATTERNS). */
const STAGE_PATTERNS = ['steps', 'redSteps', 'island', 'rows', 'islands', 'rows', 'island', 'rows', 'islands', 'rows', 'island', 'rows', 'islands', 'rows', 'island', 'rows', 'islands', 'rows', 'island', 'rows']
/** Platform width, as a share of the corridor: nearly all of it, still most of it by the end. */
const widthShare = (index) => 0.95 - 0.15 * stageRamp(index)

function buildCourse(layout, box) {
  const rng = mulberry32(20261015)
  let zStart = COURSE_START_Z
  let prevTop = 0
  let before = null

  STAGES.forEach((def, i) => {
    const index = i + 1
    const zone = index
    const theme = THEMES[def.theme]
    const world = worldOfStage(index)
    const isFinal = index === STAGES.length
    const worldEnd = index === world.lastStage
    // A new world starts in its own lobby, past the wall at the end of the one before.
    if (index === world.firstStage && world.id > 1) zStart = buildHub(layout, box, world, zStart - 4, prevTop)
    const stage = {
      index,
      name: def.name,
      theme: def.theme,
      wins: def.wins,
      level: def.level,
      boot: def.boot,
      rebirths: def.rebirths,
      gateSize: gateSize(index),
      pattern: STAGE_PATTERNS[i] || 'slabs',
      zone,
      zStart,
      prevTop,
      lavaY: prevTop - LAVA_DEPTH,
      platforms: [],
      /** Every hop after the long jump in, which the build before this stage must make easily (course check). */
      jumps: [],
    }

    // --- The way in: a short corridor; the long jump starts where it ends.
    const kit = stageKit(layout, box, stage, theme)
    addEntry(layout, box, stage, theme, def, before, index === world.firstStage)

    // --- The long jump in and the platforms (sets plateauZ0 and floorY).
    buildObstacles(kit, stage, rng)

    // --- The end of the stage: the Return and 2x Wins pads, with a clear lane
    // between them to run up for the next stage's long jump off the far edge.
    const top = stage.floorY
    const plateauLength = isFinal ? FINAL_PLATEAU_LENGTH : PLATEAU_LENGTH
    const plateauZ1 = stage.plateauZ0 - plateauLength
    stage.plateauZ1 = plateauZ1
    kit.block(-C, C, stage.plateauZ0, plateauZ1, top, theme.plateau, theme.plateauSide, false)
    stage.plateau = { x0: -C, x1: C, y: top, z0: stage.plateauZ0, z1: plateauZ1, plateau: true }
    const padZ = isFinal ? stage.plateauZ0 - 22 : plateauZ1 + 20
    stage.checkpoint = { x: 0, y: top + 0.2, z: padZ + 14, yaw: Math.PI }
    layout.stages.push(stage)

    for (const pad of [
      { kind: 'return', x0: -24, x1: -8, mat: 'returnPad' },
      { kind: 'double', x0: 8, x1: 24, mat: 'doublePad' },
    ]) {
      box(pad.x0, pad.x1, top - 0.5, top + 0.3, padZ - 6, padZ + 6, pad.mat, { zone })
      layout.pads.push({ stage: index, kind: pad.kind, wins: def.wins, min: [pad.x0, top, padZ - 6], max: [pad.x1, top + 0.3, padZ + 6] })
      layout.signs.push({ kind: 'padLabel', pad: pad.kind, wins: def.wins, pos: [(pad.x0 + pad.x1) / 2, top + 6.6, padZ], zone })
    }

    // --- Corridor walls (with columns and a band along the top) and the lava.
    const sideTop = round(Math.max(top, prevTop) + 40)
    stage.sideTop = sideTop
    const split = theme.upper ? round(stage.lavaY + theme.upperAt) : null
    for (const side of [-1, 1]) {
      const xi = side * C
      const xo = side * (C + WALL_THICK)
      if (split) {
        box(xi, xo, SEA_Y, split, plateauZ1, zStart, theme.wall, { zone })
        box(xi, xo, split, sideTop - 3, plateauZ1, zStart, theme.upper, { zone })
      } else {
        box(xi, xo, SEA_Y, sideTop - 3, plateauZ1, zStart, theme.wall, { zone })
      }
      box(xi, xo, sideTop - 3, sideTop, plateauZ1, zStart, theme.band, { zone })
      box(xi, xo, sideTop, 3000, plateauZ1, zStart, 'none', { visible: false, zone })
      // Columns, flush with the band on top.
      for (let z = zStart - PILLAR_SPACING / 2; z > plateauZ1 + 2; z -= PILLAR_SPACING) {
        box(xi, xi - side * PILLAR_OUT, stage.lavaY - 6, sideTop + theme.pillarRise, z - PILLAR_WIDTH / 2, z + PILLAR_WIDTH / 2, theme.pillar, { zone })
      }
    }
    box(-C, C, stage.lavaY - 6, stage.lavaY, plateauZ1, zStart, `liquid_${theme.liquid}`, { zone })

    if (isFinal) {
      // The end of the course: a golden wall, a trophy and the way out.
      box(-C - WALL_THICK, C + WALL_THICK, SEA_Y, sideTop, plateauZ1 - 4, plateauZ1, theme.wall, { zone })
      stage.trophy = [0, top, plateauZ1 + 22]
      layout.signs.push({ kind: 'escaped', pos: [0, top + 30, plateauZ1 + 10], zone })
    } else if (worldEnd) {
      // The end of this world: a wall, and how to get to the next one.
      box(-C - WALL_THICK, C + WALL_THICK, SEA_Y, sideTop, plateauZ1 - 4, plateauZ1, theme.wall, { zone })
      const next = WORLD_BY_ID[world.id + 1]
      layout.signs.push({ kind: 'worldEnd', world: world.id, next: next.id, rebirths: next.rebirths, pos: [0, top + 13.5, plateauZ1 + 5], zone })
    }

    addHazards(layout, kit, stage, rng)
    layout.decor.push({ kind: 'stage', index, zone })

    before = stage
    zStart = plateauZ1
    prevTop = top
  })

  layout.courseEndZ = zStart
}

/** A world's lobby: this far past the wall at the end of the world before, this long, walls this high. */
const HUB_GAP = 40
const HUB_LENGTH = 92
const HUB_WALL = 24
const HUB_OPEN = GATE_OPEN

/**
 * The lobby of a world after the first: a walled plaza at the height the world
 * before ended, with a spawn pad, the door back to World 1 on its back wall
 * and its first stage's gate at the front. Returns where that stage starts.
 */
function buildHub(layout, box, world, zTop, y) {
  const zone = world.firstStage
  const back = round(zTop - HUB_GAP)
  const front = round(back - HUB_LENGTH)
  const courseStart = front - 4
  const base = y - 10

  // Floor (and the passage through the gate), the spawn pad and a path of chevrons.
  box(-C, C, base, y, front, back, 'w2Floor', { zone })
  box(-HUB_OPEN, HUB_OPEN, base, y, courseStart, front, 'w2Floor', { zone })
  const spawn = { x: 0, y: round(y + 0.2), z: round(back - 26), yaw: Math.PI }
  box(-7, 7, y, y + 0.2, spawn.z - 7, spawn.z + 7, 'gold', { zone })
  box(-6, 6, y, y + 0.06, front, spawn.z - 7, 'chevronPath', { solid: false, zone })

  // Walls with a gold cap; invisible barriers keep you in.
  const wall = (x0, x1, z0, z1) => {
    box(x0, x1, base, y + HUB_WALL, z0, z1, 'w2Wall', { zone })
    // The cap overhangs the wall, but stops where it meets a side wall's cap
    // (overlapping caps would flicker).
    const capX0 = x0 >= -C && x0 - 0.4 < -C + 0.4 ? -C + 0.4 : x0 - 0.4
    const capX1 = x1 <= C && x1 + 0.4 > C - 0.4 ? C - 0.4 : x1 + 0.4
    box(capX0, capX1, y + HUB_WALL, y + HUB_WALL + 1.2, z0 - 0.4, z1 + 0.4, 'gold', { zone, solid: false })
    box(x0, x1, y + HUB_WALL, 3000, z0, z1, 'none', { visible: false, zone })
  }
  wall(-C - WALL_THICK, -C, front - 4, back + 4)
  wall(C, C + WALL_THICK, front - 4, back + 4)
  wall(-C, C, back, back + 4)
  wall(-C, -HUB_OPEN, front - 4, front)
  wall(HUB_OPEN, C, front - 4, front)

  // The gate: gold columns, "Stage N" over the opening, the world's name above.
  for (const side of [-1, 1]) box(side * HUB_OPEN - 3, side * HUB_OPEN + 3, base, y + HUB_WALL + 2, front - 5, front + 1, 'w2Pillar', { zone })
  layout.signs.push({ kind: 'gate', text: `Stage ${world.firstStage}`, pos: [0, y + 16, front + 1.12], zone })
  layout.signs.push({ kind: 'title', text: world.name.toUpperCase(), color: '#b98bff', pos: [0, y + HUB_WALL + 6, front - 2], rotY: 0, size: 9, sub: 'Bigger stages, bigger Wins!', zone })

  addWorldDoor(layout, 1, [0, y, back - 1.6], zone)
  layout.decor.push({ kind: 'hub', world: world.id, zone, y, front, back })
  layout.worlds.push({ ...world, spawn, lobbyMin: courseStart, lobbyMax: back + 4, regionMax: back + 4 })
  return courseStart
}

/**
 * A door across the course at `z` (floor `y`, `halfWidth` either side of the
 * middle) into stage `index`: solid until you own its boots and have its
 * rebirths (see physics.js and the server's checks).
 */
function addDoor(layout, box, index, y, z, halfWidth, zone, height = 42) {
  const def = STAGES[index - 1]
  const need = { boot: bootTier(def.boot), rebirths: def.rebirths }
  box(-halfWidth, halfWidth, y, 3000, z - 0.6, z + 0.6, 'none', { visible: false, zone, door: need })
  layout.doors.push({ stage: index, boot: need.boot, bootId: def.boot, rebirths: need.rebirths, y, z, halfWidth, height, zone })
}

/** True when a player with these rebirths and best boots tier may pass a door. */
export const doorOpen = (door, rebirths, bootTierOwned) => rebirths >= (door.rebirths ?? 0) && bootTierOwned >= (door.boot ?? 0)

/** A door to world `id` on a back wall at `pos` (facing -Z), with its "Press E" zone in front. */
function addWorldDoor(layout, id, pos, zone = 0) {
  layout.worldDoors.push({ world: id, rebirths: WORLD_BY_ID[id].rebirths, pos, rotY: Math.PI, zone })
  trigger(layout, 'world', { id }, pos[0] - 7, pos[0] + 7, pos[2] - 9, pos[2], pos[1] - 1, pos[1] + 12)
}

/**
 * The way into `stage`: a short corridor (ENTRY_LENGTH long; ENTRY_HALF either
 * side of the middle, or as wide as the lobby gate for a world's first stage)
 * at the height of the floor before it, between low blocks in the stage's own
 * colours, with "Stage N" and what the stage needs over its mouth. Its long
 * jump starts where the corridor ends (`gateZ`). A door across the mouth when
 * the stage needs new boots or more rebirths than the one before. (Stage 1's
 * mouth is the lobby gate, which has its own sign.)
 */
function addEntry(layout, box, stage, theme, def, before, firstOfWorld) {
  const { zone, zStart: z0, prevTop: y } = stage
  const half = firstOfWorld ? GATE_OPEN : ENTRY_HALF
  const z1 = round(z0 - ENTRY_LENGTH)
  const bottom = stage.lavaY - 6
  const top = round(y + ENTRY_WALL)
  stage.gateZ = z1
  stage.entry = { z0, z1, y, half, top }
  // The floor, and a block either side up to the corridor's walls.
  if (theme.plateau === theme.plateauSide) box(-half, half, bottom, y, z1, z0, theme.plateau, { zone })
  else {
    box(-half, half, bottom, y - 1, z1, z0, theme.plateauSide, { zone })
    box(-half, half, y - 1, y, z1, z0, theme.plateau, { zone })
  }
  for (const side of [-1, 1]) {
    box(side * half, side * C, bottom, top - 1.2, z1, z0, theme.wall, { zone })
    box(side * half, side * C, top - 1.2, top, z1, z0, theme.band, { zone })
    // Frames either side of the mouth and the way out, standing a little
    // proud of the walls (no faces shared with them) and no higher.
    for (const z of [z0, z1]) box(side * (half - 0.5), side * (half + 2.4), bottom, top + 0.4, z - 1.3, z + 1.3, theme.pillar, { zone })
  }
  if (stage.index > 1) {
    layout.signs.push({ kind: 'stageTitle', index: stage.index, text: `Stage ${stage.index}`, pos: [0, top + 7.6, z0 + 1.6], zone })
    layout.signs.push({ kind: 'stageNeeds', index: stage.index, jumps: def.jumps, boot: def.boot, rebirths: def.rebirths, pos: [0, top + 2.2, z0 + 1.9], zone })
  }
  if (before && (before.boot !== def.boot || before.rebirths < def.rebirths)) addDoor(layout, box, stage.index, y, z0, half, zone, ENTRY_WALL)
}

/**
 * Building blocks for one stage. Blocks stand in the lava; `jump` records the
 * hop between two of them for the course check.
 */
function stageKit(layout, box, stage, theme) {
  const zone = stage.zone
  const kit = {
    layout,
    /** A block x0..x1 from z0 back (towards -Z) to z1, standing in the lava with its top at `top`. */
    block(x0, x1, z0, z1, top, mat = theme.top, side = theme.face, record = true) {
      const bottom = stage.lavaY - 6
      if (side === mat) box(x0, x1, bottom, top, z1, z0, mat, { zone })
      else {
        box(x0, x1, bottom, top - 1, z1, z0, side, { zone })
        box(x0, x1, top - 1, top, z1, z0, mat, { zone })
      }
      const pl = { x0, x1, y: top, z0, z1 }
      if (record) stage.platforms.push(pl)
      if (record && theme.stripes) {
        // A bright strip along the near and far edges: easy to see where to land and take off.
        for (const [a, b] of [
          [z0 - 0.05, z0 - 1.2],
          [z1 + 1.2, z1 + 0.05],
        ]) {
          box(x0 + 0.05, x1 - 0.05, top, top + 0.06, b, a, 'edgeStripe', { zone, solid: false })
        }
      }
      return pl
    },
    /** Records the hop from `a` to `b` (edge to edge) for the course check. */
    jump(a, b) {
      const across = Math.max(0, b.x0 - a.x1, a.x0 - b.x1)
      const along = Math.max(0, a.z1 - b.z0)
      b.gap = round(Math.hypot(across, along))
      b.gapFrom = a.z1
      stage.jumps.push({ gap: b.gap, rise: round(b.y - a.y) })
      return b
    },
    /** A red floor block: solid, but touching its top kills (see hazards.js). */
    killBlock(x0, x1, z0, z1, top) {
      box(x0, x1, stage.lavaY - 6, top, z1, z0, 'killRed', { zone })
      layout.killZones.push({ min: [x0, top - 0.6, z1], max: [x1, top + 0.5, z0], zone })
    },
    /**
     * A breaking bridge from `a` to `b` (along -Z): planks that shake, then
     * fall a moment after you step on them, and come back a few seconds later.
     */
    bridge(a, b, x0, x1) {
      const length = a.z1 - b.z0
      const count = Math.max(2, Math.round(length / 4))
      const plank = length / count
      for (let k = 0; k < count; k += 1) {
        const z0 = round(a.z1 - k * plank - 0.15)
        const z1 = round(a.z1 - (k + 1) * plank + 0.15)
        const id = layout.bridges.length + 1
        box(x0, x1, b.y - 1, b.y, z1, z0, 'bridgePlank', { zone, bridge: id })
        layout.bridges.push({ id, min: [x0, b.y - 1, z1], max: [x1, b.y, z0], zone })
      }
    },
    spike(x, z, h, r = 1.7, y = stage.lavaY - 1) {
      layout.spikes.push({ x: round(x), y: round(y), z: round(z), r, h: round(h), zone })
    },
  }
  return kit
}

/* ---------------------------------------------------------------------------
 * Platform layouts. Each returns the platforms in order as "slots", flat
 * unless they say otherwise (the course is about jumping far, not high):
 *   x      [left, right] as a share of the half-width (-1 = left wall, 1 = right)
 *   len    length, times the stage's platform length
 *   gap    gap before it, times the stage's hop
 *   rise   a small step up from the one before (studs)
 * They come after the stage's landing and before its plateau, which a
 * layout can lift a little more with `stage.endRise`.
 * ------------------------------------------------------------------------- */

/** A slot `w` wide (share of the corridor) centred at `c` (-1..1), kept inside the walls. */
function lane(w, c = 0) {
  const half = Math.min(1, w)
  const centre = Math.max(-1 + half, Math.min(1 - half, c))
  return [round(centre - half), round(centre + half)]
}

const PATTERNS = {
  /**
   * Stage 1, like the original: big blocks down the middle of the lava, each a
   * little higher and narrower than the last, up to a raised stone plateau,
   * with spikes standing in the lava either side (see addHazards).
   */
  steps(stage) {
    stage.endRise = 2.5
    stage.besideSpikes = true
    // The lava sits close under the blocks here.
    stage.lavaY = round(stage.prevTop - 4)
    return [
      { x: lane(0.66), rise: 1.5, len: 1.5, gap: 0.8 },
      { x: lane(0.54, -0.04), rise: 1.5, len: 1.2 },
      { x: lane(0.44, 0.04), rise: 1.5, len: 1.1 },
      { x: lane(0.36), rise: 1.5, len: 1 },
    ]
  },
  /**
   * Stage 2, like the original: a staircase from wall to wall where every step
   * starts with a red strip (touch it and you die) and ends with a blue safe
   * strip. Jump the red, land on the blue: four safe strips (the landing is
   * the first) and four red ones, the last right before the plateau.
   */
  redSteps(stage) {
    stage.wallToWall = true
    stage.redGaps = true
    stage.wallSpikes = false
    stage.endRise = 2
    return Array.from({ length: 3 }, () => ({ x: [-1, 1], rise: 2, len: 0.75, gap: 1.4 }))
  },
  /** Wide slabs straight ahead. */
  rows(stage, rng, { count, width }) {
    return Array.from({ length: count }, () => ({ x: lane(width, (rng() * 2 - 1) * (1 - width) * 0.3) }))
  },
  /** Big islands down the middle. */
  islands(stage, rng, { count, width }) {
    return Array.from({ length: count }, (_, k) => ({ x: lane(Math.max(0.6, width * 0.75), (rng() * 2 - 1) * 0.1), len: k % 2 ? 1 : 1.2 }))
  },
  /** One big island in the middle of the pit. */
  island() {
    return [{ x: lane(0.7), len: 1.7 }]
  },
}

/**
 * Lays out a stage: its gate (one long jump from the edge of the stage before,
 * or the lobby, to a big landing), its platforms (see PATTERNS), all flat, and
 * where its plateau starts.
 */
function buildObstacles(kit, stage, rng) {
  const { index, prevTop, zone } = stage
  const build = stageBuild(index)
  // Every gap after the gate needs the stage's jumps too (a comfortable 72% of the reach where that fits).
  const hop = (rise = 0) => gapNeeding(build, rise, 0.72)
  const runLength = (scale = 1) => round(Math.max(22, build.speed * (1.3 + 0.3 * rng())) * scale)
  const y = round(prevTop + STAGE_RISE)
  const slots = PATTERNS[stage.pattern](stage, rng, { count: 2 + (index % 2), width: widthShare(index) })
  // Platforms keep clear of the columns, unless the layout is a floor from wall to wall.
  const span = stage.wallToWall ? C : EDGE

  // The gate: the long jump from the end of the entry corridor, onto a full-width landing.
  const landZ0 = round(stage.gateZ - stage.gateSize)
  const landing = kit.block(-span, span, landZ0, round(landZ0 - runLength(1.3)), y)
  landing.entry = true
  landing.gap = stage.gateSize
  landing.gapFrom = stage.gateZ
  if (index <= 3) {
    // Over the gap, under the "Stage N" sign: how to make it, on the first stages.
    kit.layout.signs.push({ kind: 'gapSign', jumps: STAGES[index - 1].jumps, pos: [0, prevTop + 8, round(stage.gateZ - stage.gateSize * 0.5)], zone, first: index === 1 })
  }

  let last = landing
  let z = landing.z1
  let top = y
  for (const slot of slots) {
    const rise = slot.rise || 0
    top = round(top + rise)
    const x0 = round(slot.x[0] * span)
    const x1 = round(slot.x[1] * span)
    const z0 = round(z - hop(rise))
    // Stage 2: the gap is a red floor at the new height instead of lava.
    if (stage.redGaps) kit.killBlock(x0, x1, z, z0, top)
    last = kit.jump(last, kit.block(x0, x1, z0, round(z0 - runLength(slot.len ?? 1)), top))
    z = last.z1
  }

  // The plateau (the end of the stage) starts one more gap on.
  const endRise = stage.endRise || 0
  stage.plateauZ0 = round(z - hop(endRise))
  stage.floorY = round(top + endRise)
  if (stage.redGaps) kit.killBlock(-span, span, z, stage.plateauZ0, stage.floorY)
  stage.jumps.push({ gap: round(z - stage.plateauZ0), rise: round(stage.floorY - top) })
}

/* ---------------------------------------------------------------------------
 * Hazards, coming in gently and always leaving a wide clear lane
 * ------------------------------------------------------------------------- */

function addHazards(layout, kit, stage, rng) {
  const { platforms, zone } = stage

  // Stage 1: tall grey spikes standing in the lava either side of the blocks.
  if (stage.besideSpikes) {
    for (const pl of platforms) {
      if (pl.entry) continue
      for (const side of [-1, 1]) {
        const edge = side < 0 ? pl.x0 : pl.x1
        const count = 1 + Math.floor(rng() * 2)
        for (let k = 0; k < count; k += 1) {
          const x = edge + side * (3.5 + rng() * 7)
          if (Math.abs(x) > C - 3) continue
          const z = pl.z0 - (pl.z0 - pl.z1) * ((k + 0.5) / count + (rng() - 0.5) * 0.3)
          kit.spike(x, z, pl.y - (stage.lavaY - 1) + 2.5 + rng() * 2.5, 1.6 + rng() * 0.5)
        }
      }
    }
  }

  // Spike Field: a row of spikes standing up out of the lava in every gap.
  if (stage.theme === 'spike') {
    platforms.forEach((pl, k) => {
      const from = platforms[k - 1]
      if (!from || !pl.gap) return
      const x0 = Math.max(from.x0, pl.x0) + 1.5
      const x1 = Math.min(from.x1, pl.x1) - 1.5
      const tip = Math.max(from.y, pl.y) + 3
      for (let x = x0; x <= x1; x += 4) kit.spike(x, (from.z1 + pl.z0) / 2, tip - (stage.lavaY - 1), 1.6)
    })
  }

  // Shark Bay: sharks leaping straight up out of the long jump in, either side of the middle.
  if (stage.theme === 'shark') {
    for (const side of [-1, 1]) {
      layout.sharks.push({ x0: side * 22, x1: side * 22, z: round(stage.gateZ - stage.gateSize * 0.6), y: stage.lavaY, height: 25, period: 5.2, air: 0.45, phase: side > 0 ? 0.6 : 3, size: 1, zone })
    }
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
  const length = stage.gateZ - (stage.plateauZ0 - 14)
  const speed = stageBuild(stage.index).speed
  return Math.round((2 * length) / speed + 6)
}

/** The world whose lobby or stages contain z. */
export function worldAt(layout, z) {
  for (let i = layout.worlds.length - 1; i > 0; i -= 1) if (z <= layout.worlds[i].regionMax) return layout.worlds[i]
  return layout.worlds[0]
}

/** True inside a world's lobby (and its gate passage). */
export const inLobby = (z) => getLayout().worlds.some((w) => z > w.lobbyMin && z <= w.lobbyMax)

/** Where "go home" goes from z: the spawn of the world you're in. */
export const homeFor = (z) => worldAt(getLayout(), z).spawn

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

/** How high a jump pad bounces you (studs), and the most it lets you rise above it and still count. */
export const PAD_BOUNCE_HEIGHT = 5
const PAD_REACH = PAD_BOUNCE_HEIGHT + 2

/** The jump pad a player at (x, y, z) is on or bouncing over, if any. */
export function padAt(layout, x, y, z) {
  for (const pad of layout.jumpPads) {
    if (Math.abs(x - pad.center[0]) > pad.half || Math.abs(z - pad.center[1]) > pad.half) continue
    if (y >= pad.top - 0.6 && y <= pad.top + PAD_REACH) return pad
  }
  return null
}

/**
 * The platform (or a stage's end, its plateau) under (x, y, z): { stage,
 * platform, index } where index is its place in the stage (-1 for the
 * plateau), or null.
 */
export function platformAt(layout, x, y, z) {
  const stage = stageAt(layout, z)
  if (!stage) return null
  const under = (p) => x >= p.x0 - 0.5 && x <= p.x1 + 0.5 && z <= p.z0 + 0.5 && z >= p.z1 - 0.5 && Math.abs(y - p.y) < 1.5
  if (under(stage.plateau)) return { stage, platform: stage.plateau, index: -1 }
  const index = stage.platforms.findIndex(under)
  return index >= 0 ? { stage, platform: stage.platforms[index], index } : null
}

/** Where falling sends you back to on a platform: just past its near edge, in line with where you landed. */
export function checkpointOn(platform, x) {
  return { x: Math.round(Math.max(platform.x0 + 2, Math.min(platform.x1 - 2, x)) * 10) / 10, y: platform.y + 0.2, z: platform.z0 - 3, yaw: Math.PI }
}

/**
 * The jump ahead of a checkpoint platform: { gap, rise, jumps, level } — the
 * jumps it needs at `speed` and the first level (after `rebirths` rebirths)
 * that has them, which is above 15 when only a rebirth can give them — or
 * null when there's nothing left to jump.
 */
export function jumpAhead(layout, found, speed = 16, rebirths = 0) {
  if (!found) return null
  const { stage, index } = found
  let next
  let from = found.platform
  if (index === -1) {
    next = layout.stages[stage.index]?.platforms.find((p) => p.entry)
    if (!next) return null
  } else {
    next = stage.platforms[index + 1] ?? stage.plateau
    if (next === stage.plateau) next = { ...stage.plateau, gap: round(from.z1 - stage.plateauZ0) }
  }
  if (!next.gap) return null
  const rise = Math.max(0, next.y - from.y)
  const jumps = jumpsForGap(next.gap * 1.02, rise, speed)
  return { gap: next.gap, rise, jumps, level: levelForJumps(jumps, rebirths) }
}

/** Where the checkpoint door sends someone whose best stage is `best`. */
export function checkpointFor(layout, best) {
  const stage = layout.stages[Math.min(best, layout.stages.length) - 1]
  return stage ? stage.checkpoint : null
}

/** 0 in the lobby up to the number of stages at the end: where a player is on the course. */
export function courseProgress(layout, z) {
  if (inLobby(z)) return worldAt(layout, z).firstStage - 1
  const stage = stageAt(layout, z)
  if (!stage) return layout.stages.length
  if (z <= stage.plateauZ0) return stage.index
  const span = stage.zStart - stage.plateauZ0
  const t = span > 0 ? (stage.zStart - z) / span : 1
  return stage.index - 1 + Math.max(0, Math.min(1, t))
}
