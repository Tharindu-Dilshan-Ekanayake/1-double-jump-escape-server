import { schema, t } from '@colyseus/schema'

/**
 * One player in a lobby. Transform fields are written by that client's `move`
 * messages; every stat below them is server-authoritative (see
 * src/shared/progression.js for what each one means).
 *
 * Owned lists are comma-separated strings and counters are JSON — the client
 * only ever reads them, and strings keep the patches small.
 */
export const PlayerState = schema(
  {
    name: t.string().default('Player'),
    /** Boxity account id and username (verified; '' for guests): friend-join notices, chat bubbles. */
    boxityId: t.string().default(''),
    username: t.string().default(''),
    /** Bloxity `{ equipped, proportions, pfp }` as JSON, so others render this avatar. */
    avatar: t.string().default(''),
    /** The Boxity emote playing (catalogue id, '' for none); emoteSeq ticks on each one. */
    emote: t.string().default(''),
    emoteSeq: t.uint16().default(0),

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
    /** Fallen (lava, spikes...): other clients play the poof until they're back. */
    dead: t.boolean().default(false),

    // Reset on rebirth.
    level: t.uint16().default(0),
    xp: t.number().default(0),

    // Kept for good.
    rebirths: t.uint32().default(0),
    wins: t.number().default(0),
    /** Every XP point ever gained (the Top XP board). */
    totalJump: t.number().default(0),
    /** Every level ever gained: titles and how you look. */
    lifetimeLevels: t.uint32().default(0),
    boot: t.string().default('starter'),
    bootsOwned: t.string().default('starter'),
    perkGain: t.uint8().default(0),
    perkWins: t.uint8().default(0),
    perkSpeed: t.uint8().default(0),
    perkLuck: t.uint8().default(0),
    perkSlots: t.uint8().default(0),
    /** Pets owned and equipped (pet ids, duplicates allowed). */
    pets: t.string().default(''),
    petsEquipped: t.string().default(''),
    /** Jump pads bought with Wins (pad ids); the free ones aren't listed. */
    padsOwned: t.string().default(''),
    trail: t.string().default('white'),
    trailsOwned: t.string().default('white'),
    pass2xJump: t.boolean().default(false),
    pass2xWins: t.boolean().default(false),
    /** 2x XP from gifts and AFK runs until this time (ms). */
    boostUntil: t.number().default(0),

    bestStage: t.uint8().default(0),
    /** Stars per stage, one digit each ('3210...'); see starsOf in gameData. */
    stars: t.string().default(''),
    /** `{ wins, jumps, runs, steps, falls }` lifetime counters. */
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
