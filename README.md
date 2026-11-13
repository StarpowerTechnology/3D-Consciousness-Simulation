# 3D-Consciousness-Simulation

A system designed to exhibit the behavior of consciousness within a 3d environment.
Designed by Starpower

A small creature lives in a 40 m world of meadows and forest, starting in a 16 m clearing. It looks around, locks its eyes on things, gets curious, names what it discovers, learns what is food and what hurts, remembers where things are, and talks about what it has actually seen. You enter the world as a second creature and talk to it by being near it.

The full design is in [BLUEPRINT.md](BLUEPRINT.md). This is the MVP prototype described there.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:5173. Everything runs in the browser; there is nothing else to install.

### Watching it

- **Watching:** pick who to watch: the creature, you (the visitor), any ant or butterfly. `Tab` cycles. Clicking an ant or butterfly in the view starts watching it.
- **Views:** *Follow* (orbit it), *Its eyes* (see through its eyes, sharp where it looks and blurred at the edges), *Free* (fly anywhere), *You 1st / 3rd* (walk as the visitor).
- **Layout:** one view, side by side, or picture in picture, with any second view you choose.
- **◎ Measure:** on the eye view, tracking brackets on everything its eyes are measuring, labelled with its own word for it (or `?` and how it would describe it), how clearly it sees it, how far, and how strongly it pulls the eye. What it is locked onto is highlighted.
- **Timeline:** the last 8 minutes are recorded. Drag the bar or press `←` to go back; the world pauses while you review the past, and the thought stream and Mind panel rewind with it. Play to replay; when it catches up it carries on live. *LIVE* jumps to now.
- **Panels:** the thought stream and the Mind panel minimize to slim rails (`‹ ›`), and remember how you left them.

### Keys

| Key | Does |
|---|---|
| `1`–`5` | Main view: its eyes, follow, you 1st, you 3rd, free |
| `L` | Layout: one view, side by side, picture in picture |
| `O` | Measurement overlay on the eye view |
| `Tab` | Watch the next creature |
| `P`, `←` `→`, `[` `]` | Play/pause, 10 s back/forward, speed |
| `WASD`, `Space`, `Shift` | Move (you, or the free camera), jump, run |
| `E` / `F` | Pick up or drop a leaf or nut / throw it |
| `Enter` | Talk. Your words are a sound at your position: it only hears you when you are close enough |
| click | Inspect anything: its part tree, with what the creature has measured highlighted |
| `K` | What the creature knows (its knowledge graph, with the source of every fact) |
| `R` / `H` / `?` | Raw saccades / hide panels / all keys |

### Things to try

- Watch the left panel while it explores. It describes things before it names them: *"its like a lil round flat green thing with a skinny line goin through it .. ill call it a leaf .. ill call the skinny line a stem"*.
- Walk up to it (`4`), then ask *"do you know what a leaf is?"*. How much detail it gives depends on how closely it looked: a glance, a lock, an inspection, a touch.
- Ask *"what is a vein on a leaf?"*, *"did you know ants have hair on their legs?"*, *"what have you seen?"*, *"does a tree look like anything?"*, *"what does a berry taste like?"*, *"my name is …"*.
- Tell it something it hasn't seen. It stores it as *told*, not *seen*, and checks the next time it gets the chance.
- Throw a nut near it (`E` to pick one up under the nut tree, `F` to throw).
- Leave it alone. It gets hungry, finds the berries, gets thirsty, finds the water, and heads for the hollow log when it gets dark.

## Headless

The same simulation runs without rendering, faster than real time:

```bash
npm run headless -- --minutes 10 --seed 2
```

```bash
npm run headless -- --minutes 6 --seed 2 --say "200:do you know what a leaf is?" --say "230:what have you seen?"
```

Add `--behaviors` to print behavior changes, `--facts` to dump the knowledge graph at the end.

## Tests

```bash
npm test
```

The tests are the "done when" checks from the blueprint's build order: the eyes keep moving and spread over the scene; things are named once and recognized after that; facts come only from measurement; a berry eaten now gives energy later; told is not the same as seen; and across 400 questions no answer contains a word for something it never discovered. A separate check enforces that the mind imports nothing from the engine:

```bash
npm run check:layers
```

## How it's built

Every layer talks to the next only through a narrow interface, so motion and rendering can be replaced by a higher-fidelity version without touching the mind (blueprint 14.1).

| Layer | Code | What it does |
|---|---|---|
| Ontology | `ontology/world.yaml` | Every entity as a part tree: looks, relations, colour, texture, smell, touch, taste, sound, materials, words. The world, the senses and the gate read it. The mind never does. |
| World | `src/world/` | Terrain, Rapier physics, light/wind/smell/sound fields, plant generators, ant and butterfly agents, falling nuts, day and night |
| Body | `src/body/` | The creature's physical body and biology (energy, hydration, digestion, pain, fatigue), motor intents, reflexes, and procedural motion: saccades, pursuit, vergence, blinks, head lag, gaits with planted feet, ears, tail |
| Senses | `src/senses/` | Vision with acuity, light and occlusion, resolving parts only when close enough; smell without direction; two-ear hearing with error; touch and taste |
| Contract | `src/protocol/types.ts` | `PerceptFrame` in, `MotorIntent` out: the only connection between body and mind |
| Mind | `src/mind/` | Attention and gaze, workspace, appraisal and feelings, drives, behavior choice, memory (concepts, knowledge graph with sources, episodes, associations), learning, thought triggers, phrase bank, dialogue |
| Gate | `src/gate/` | Checks every spoken reply against what the creature has discovered |
| Render | `src/render/`, `src/app/` | Three.js scene, fur, eyes, plants, water, sky, the five cameras, foveated eye view, HUD, inspector |

Every quantity in the mind is a named state pushed by weighted inputs, and every decision is sampled, so no two runs are the same. Seeds make any run repeatable.

## Not built yet

From the blueprint's build order: the state-conditioned language model (stage 7; the creature speaks through its combinatorial phrase bank today), weather and rain, the wasp, generations (stage 9), and saving a creature's mind between sessions. The creature and visitor are procedural models made in code; the blueprint's art pipeline (sculpted, rigged models) would replace them in the render layer only.
