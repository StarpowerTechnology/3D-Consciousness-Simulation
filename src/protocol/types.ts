// THE CONTRACT (blueprint 14.1). The only things that cross between the body and the mind.
// The mind receives PerceptFrames and sends MotorIntents. Nothing else connects them.
// No engine, physics or render type may appear in this file.

export const PROTOCOL_VERSION = 1;

/** Innate perceptual primitives. The creature can always describe with these. */
export type Looks = string; // e.g. 'round_flat', 'skinny_line', 'tall_branching'

export type ResolveLevel = 'detected' | 'identified' | 'detail';

export interface Relation {
  type: string; // runs_through, branches_from, attached_to, sticks_out_of, on_top_of, inside, touching, around
  to: string; // instance id of the related node, or 'ground'
}

/** One thing the eyes currently deliver. Only resolved properties are present. */
export interface VisualPercept {
  node: string; // tracking handle for "that thing there" (object permanence while visible)
  parent?: string; // set when this was resolved as a part of a larger thing
  level: ResolveLevel;
  angleDeg: number; // how big it looks
  offCenterDeg: number; // from the current gaze direction
  bearingDeg: number; // left(−)/right(+) of the body heading
  elevationDeg: number;
  distance: number; // rough, from stereo and size
  light: number; // 0..1 light on it
  speedDps: number; // angular speed across the view, degrees/second
  loomingDps: number; // how fast it is growing, degrees/second
  falling: boolean; // moving downward fast
  selfMoving: boolean; // moves on its own (an animal), as opposed to being blown
  margin: number; // effective angle / angle needed to see it at all (≥1 when present)
  needDwell: number; // seconds of fixation needed before this detail can be noticed
  embedding: number[]; // percept embedding from resolved properties only (blueprint 3.3)
  props?: { looks?: Looks; color?: string; texture?: string; sizeWord?: string };
  words?: string[]; // words the world offers for this node at the resolved level
  relation?: Relation; // how it sits relative to its parent, once resolved
}

export interface SmellPercept {
  mix: number[]; // 8 dims: sweet, rot, green, earthy, floral, musky, sharp, wet
  strength: number;
}

export interface SoundPercept {
  id: number;
  sig: number[]; // 6 dims: pitch, loudness, buzz, rhythm, duration, onset
  loudness: number; // at the ears, 0..1
  bearingDeg: number; // estimated, noisy
  onset: boolean; // started this frame
  speech?: { text: string; speaker: string }; // words are heard as words
}

export interface TouchPercept {
  node: string;
  force: number;
  where: 'nose' | 'body' | 'paw' | 'mouth';
  props: { texture?: string; hardness?: string; temperature?: string; wetness?: string };
  bearingDeg: number;
}

export interface TastePercept {
  node: string;
  sig: number[]; // 5 dims: sweet, bitter, sour, salty, savory
  texture?: string;
  swallowed: boolean;
}

export interface BodyState {
  energy: number;
  hydration: number;
  stomach: number;
  health: number;
  fatigue: number;
  temperature: number; // 0 cold .. 1 hot, 0.5 comfortable
  pain: number;
  nausea: number;
  wet: number;
}

export interface Proprio {
  pos: { x: number; z: number }; // path integration: where it is in its own coordinates
  headingDeg: number;
  speed: number;
  gazeNode?: string; // what the eyes are actually on right now
  mouthBusy: boolean;
  reach: Record<string, boolean>; // nodes currently within mouth/nose reach
  inShelter: boolean;
}

export interface TimeSense {
  t: number; // world seconds
  day: number;
  hour: number; // 0..24, felt through the light
  ambientLight: number;
}

export interface PerceptFrame {
  v: number;
  frame: number;
  time: TimeSense;
  vision: VisualPercept[];
  smell: SmellPercept;
  sounds: SoundPercept[];
  touch: TouchPercept[];
  taste: TastePercept[];
  body: BodyState;
  proprio: Proprio;
  startle: number; // reflex already fired with this strength (fast path)
}

export type GazeMode = 'scan' | 'fixate' | 'pursue';
export type LocoMode = 'idle' | 'wander' | 'approach' | 'flee' | 'heading' | 'turn';
export type MouthAction = 'none' | 'sniff' | 'nose' | 'lick' | 'bite' | 'drink';

export interface MotorIntent {
  v: number;
  gaze: { mode: GazeMode; target?: string; yawDeg?: number; pitchDeg?: number };
  locomotion: {
    mode: LocoMode;
    target?: string; // node to approach / flee from
    pos?: { x: number; z: number }; // place to go
    headingDeg?: number;
    speed: number; // 0..1 of top speed
    stopAt?: number; // metres from target
  };
  posture: { crouch: number; earsBearingDeg?: number; earsFlat: number; tailUp: number; headDown: number };
  mouth: { action: MouthAction; target?: string };
  face: { pupil: number; squint: number };
  voice?: { say: string; loudness: number };
  reflex: { withdrawGain: number; startleThreshold: number };
  sleep: boolean;
}

/** What the mind publishes for the viewer. One-way, read-only. Never feeds back. */
export interface MindReport {
  focus?: { kind: string; label: string; node?: string };
  behavior: string;
  stance?: string;
  drives: Record<string, number>;
  feelings: Record<string, number>;
  gaze: { mode: GazeMode; target?: string; interest: number };
  salience: { node: string; label: string; score: number }[];
  thoughts: ThoughtRecord[]; // new since last report
  speech: string[]; // said aloud since last report
}

export interface ThoughtRecord {
  t: number;
  intent: string;
  text: string;
  mood: string;
  aloud: boolean;
}
