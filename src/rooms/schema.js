import { schema, t } from '@colyseus/schema'

/**
 * One player in a lobby. Transform fields are written by that client's `move`
 * messages; every stat below them is server-authoritative.
 *
 * Owned lists are comma-separated strings and counters are JSON — the client
 * only ever reads them, and strings keep the patches small.
 */
export const PlayerState = schema(
  {
    name: t.string().default('Player'),
    /** Bloxity `{ equipped, proportions, pfp }` as JSON, so others render this avatar. */
    avatar: t.string().default(''),

    x: t.float32().default(0),
    y: t.float32().default(0),
    z: t.float32().default(0),
    /** Facing (yaw, radians). */
    r: t.float32().default(0),
    /** Horizontal speed, drives the run cycle on other screens. */
    s: t.float32().default(0),
    air: t.boolean().default(false),
    /** Increments on every mid-air jump; other clients play a flip when it changes. */
    flips: t.uint16().default(0),

    level: t.uint16().default(1),
    xp: t.number().default(0),
    totalJump: t.number().default(0),
    wins: t.number().default(0),
    rebirths: t.uint32().default(0),

    boot: t.string().default('starter'),
    bootsOwned: t.string().default('starter'),
    /** Owned trampolines, e.g. "t1,t3". */
    tramps: t.string().default('t1'),
    trail: t.string().default('white'),
    trailsOwned: t.string().default('white'),
    pass2xJump: t.boolean().default(false),
    pass2xWins: t.boolean().default(false),
    /** 2x Jump from gifts and codes runs until this time (ms). */
    boostUntil: t.number().default(0),

    bestStage: t.uint8().default(0),
    goal: t.uint16().default(0),
    /** Target of the current endless goal (0 for scripted ones). */
    goalTarget: t.number().default(0),
    /** `{ wins, jumps, runs, deaths }` lifetime counters that goals read. */
    counters: t.string().default('{}'),

    dailyAt: t.number().default(0),
    dailyStreak: t.uint8().default(0),
    chestAt: t.number().default(0),
    /** When this session started (playtime gifts count from here). */
    sessionAt: t.number().default(0),
    /** Gift indexes claimed this session, e.g. "0,1,2". */
    gifts: t.string().default(''),
  },
  'PlayerState',
)

export const EscapeState = schema(
  {
    players: t.map(PlayerState),
    /** Abyssal Hydra Boots left across every server. */
    hydraLeft: t.number().default(0),
  },
  'EscapeState',
)
