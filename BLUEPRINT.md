# Blueprint — 3D Consciousness Simulation

A creature lives in a small 3D world. Where it looks, what it notices, what it fears, what it wants, what it remembers and what it says all come out of interacting state updates, not scripts. The target is behavior that reads as conscious: it attends, reacts, learns, discovers things, and tells you about them in its own words. This document specifies the mechanisms.

## Contents

0. [The five laws](#0-the-five-laws)
1. [System map](#1-system-map)
2. [The engine: three formulas](#2-the-engine-three-formulas)
3. [The world](#3-the-world)
4. [The body](#4-the-body)
5. [Senses](#5-senses)
6. [Attention and the workspace](#6-attention-and-the-workspace)
7. [Appraisal and feelings](#7-appraisal-and-feelings)
8. [Memory](#8-memory)
9. [Drives, instincts and the mind](#9-drives-instincts-and-the-mind)
10. [Inner voice and language](#10-inner-voice-and-language)
11. [Four chains of events, start to finish](#11-four-chains-of-events-start-to-finish)
12. [Continuous learning and evolution](#12-continuous-learning-and-evolution)
13. [Realism layer](#13-realism-layer)
14. [Tech stack and repo layout](#14-tech-stack-and-repo-layout)
15. [Build order](#15-build-order)
16. [Starting numbers](#16-starting-numbers)
17. [Known failure modes](#17-known-failure-modes)
18. [Open decisions](#18-open-decisions)

---

## 0. The five laws

Every mechanism below follows from these. When a design question comes up later, these settle it.

1. **Everything is a state, and states change only through weighted updates.** There is no `if motion then look`. Motion adds weight toward looking; the outcome is sampled. Reflexes are the same thing with very heavy weights.
2. **The creature knows only what its senses delivered.** The world knows everything about itself. The creature's memory starts empty and fills only through seeing, smelling, hearing, tasting, touching, or being told (and "told" is stored as told, not as seen).
3. **One ontology defines the world, the senses and the language dataset.** Each object is described once. That description spawns it in 3D, sets how it looks, smells, sounds and tastes, carries its words, and generates the training data for talking about it. Nothing in the world can exist without being documented.
4. **Thoughts are causal.** A thought is an event that writes back into memory, drives and goals. "ill call it a leaf" is the act that creates the name.
5. **Every state can be inspected and saved.** Any moment of the creature's life can be paused, looked at and explained ("it looked there because motion 0.7 + novelty 0.5 beat everything else"), and its whole mind saves to a file so its life continues between sessions.

---

## 1. System map

```
            WORLD  (knows everything about itself)
   entities as part trees · smell / sound / light fields · weather · bugs
        │ stimuli                                         ▲ actions
        ▼                                                 │
   SENSES   eyes · nose · ears · tongue · skin · gut      │
        │ percepts ──── reflex path (fast, skips the mind) ┤
        ▼                                                 │
   ATTENTION   everything competes, one thing wins        │
        ▼                                                 │
   WORKSPACE   the one thing it is aware of right now,    │
               broadcast to every module below            │
        ├──► APPRAISAL    threat? food? new? worth it?    │
        ├──► MEMORY       episodes · concepts · links · words
        ├──► DRIVES       hunger thirst safety rest curiosity
        └──► INNER VOICE  thought ──► back into WORKSPACE  │
        ▼                                                 │
   MIND    weighs drives + appraisal + memory, picks a behavior
        ▼                                                 │
   MOTOR   eyes · head · legs · mouth · tongue · voice ───┘
```

Each module owns its own state and is updated separately, on its own clock. Each sense works as its own agent: it keeps its own state, decides what is worth reporting, and sends the brain an embedding, not raw data. The brain is where those embeddings meet the body's state and memory.

| Module | State it holds | Listens to | Sends |
|---|---|---|---|
| Eyes | gaze direction, mode (scan / fixate / pursue), target, interest, dwell | world, attention, mind (top-down goals) | visual percepts, gaze records |
| Nose | current smell mix, sniff gain | smell field | smell percepts |
| Ears | current sounds, direction estimates | sound events | sound percepts, startle signal |
| Tongue / mouth | what is in the mouth, taste reading | contact with objects | taste percepts |
| Skin | contacts, pain, temperature, wetness | physics | touch / pain percepts, withdrawal reflex |
| Gut (interoception) | energy, hydration, stomach contents, fatigue, health | body | drive signals, delayed reward / sickness |
| Attention | salience of every candidate | all senses, memory, drives | the winner |
| Workspace | current focus + ~4 working-memory items | attention | broadcast to all |
| Appraisal | arousal, valence, fear, curiosity | workspace, memory | stance toward the focus |
| Memory | episodes, concepts, associations, lexicon, place map | workspace, thoughts | recalls (which compete for attention too) |
| Drives | urgency of each need | gut, appraisal | pressure on behaviors |
| Mind | current behavior, goal, plan | drives, appraisal, memory | motor commands, thought triggers |
| Inner voice | thought queue, recent phrasing | workspace, mind | thoughts (words + structured record) |

**Two clocks.** A fast loop (60 Hz) runs the world, body, eyes and reflexes. A slow loop (10–20 Hz) runs attention, appraisal, drives and the mind. Thoughts and learning are event-driven.

---

## 2. The engine: three formulas

The whole creature is built from three small rules applied to named quantities. It behaves like a neural net, but every unit has a meaning you can read.

**Update.** Every internal quantity (gaze interest, arousal, fear, hunger, curiosity, the activation of each behavior) is a leaky value that drifts back to rest unless something pushes it:

```
x ← x + dt · ( −(x − rest) / τ  +  Σ w_j · input_j )  +  noise
```

`τ` is how fast it fades. `w_j` are the connection weights from other states. The noise is what keeps two identical situations from producing identical behavior.

**Choice.** Whenever something must be picked (where to look, what to do, which word to use), every option gets a score and one is sampled:

```
P(option i) = exp(score_i / T) / Σ_j exp(score_j / T)
```

`T` is temperature. High `T` is unpredictable, low `T` means the top option nearly always wins. `T` drops when a drive is urgent, so a starving creature is focused and a comfortable one wanders.

**Learning.** Weights change when an outcome is better or worse than expected, and only for connections that were recently active:

```
w ← w + rate · trace · (outcome − expected)
```

`trace` is a fading marker meaning "this was active a moment ago". That is how a smell from five seconds ago gets credit for the pain or the meal that follows.

Innate instincts are the starting values of the weights. Experience is how they move.

---

## 3. The world

### 3.1 Scale and scope

Start with a terrarium, not a planet: roughly a 20 m × 20 m patch, with the creature about 12 cm long. At that scale an ant is something it can put its face next to, a tree is enormous, and a pond is a lake. Density of detail matters more than area.

The creature does not see pixels. The 3D render is for the human watching. The creature perceives by querying the scene graph through a physical visibility model (field of view, distance, occlusion, light). This is what makes "embeddings inside objects" work, and it keeps perception cheap, controllable and explainable.

### 3.2 Entities are part trees

Every object is a tree of parts. Each node carries its own features, its own words, and the conditions under which it can be noticed.

```yaml
tree:
  words: [tree]
  size_m: 6.0
  coarse: {shape: tall_branching, colors: [green, brown]}
  smell: {sig: woody, strength: 0.2}
  affords: [shade, partial_shelter]
  parts:
    trunk:
      words: [trunk]
      size_m: 0.6
      parts:
        bark:
          words: [bark]
          attrs: {color: brown, texture: rough}
          needs: {angle: 4}                 # trunk must fill 4° of effective view
          details:
            cracks: {words: [cracks, lines], needs: {angle: 15}}
            feel:   {attr: {texture: rough}, needs: {touch: true}}
    branch:
      count: 12
      words: [branch]
      parts:
        leaf:
          count: 40
          words: [leaf]
          size_m: 0.05
          attrs: {color: green, shape: oval, texture: smooth}
          motion: flutter_in_wind
          taste: {sig: bitter, nutrition: 0.02}
          details:
            veins: {words: [veins, lines], needs: {angle: 10}}

ant:
  words: [ant]
  coarse_words: [bug]                       # what it can be called before fine parts resolve
  size_m: 0.005
  attrs: {color: black, shape: segmented}
  motion: crawl_trail
  parts:
    leg:
      count: 6
      words: [leg]
      size_m: 0.002
      details:
        hair: {words: [hair], needs: {angle: 3, dwell_s: 1.0}}
    antenna: {count: 2, words: [antenna, feeler]}
```

The world hands a node's words and features to the creature only when the creature's senses have resolved that node. A tree seen from across the map gives up "tree" and nothing else. The hair on the ant's leg is given up only to a creature whose eye is within about 4 cm of the leg, looking straight at it, in good light, for a second.

### 3.3 Embeddings

Each node has a feature vector assembled from what it physically is:

```
f(node) = [ color(3) | shape(8) | size(1) | texture(4) | motion(4) | kind-code(12) ]     32 numbers
```

- `color`, `shape`, `size`, `texture`, `motion` are real descriptors, so things that look alike are near each other.
- `kind-code` is a fixed random vector per kind. It stands in for all the fine visual detail not modeled explicitly, and it fades with distance, so far-away things are easier to confuse.

Other senses have their own small signatures on the same node:

| Sense | Signature dimensions |
|---|---|
| Smell | sweet, rot, green, earthy, floral, musky, sharp, wet |
| Sound | pitch, loudness, buzz/roughness, rhythm rate, duration, onset sharpness |
| Taste | sweet, bitter, sour, salty, savory, + mouth texture |
| Touch | hardness, roughness, temperature, wetness, sharpness |

**What the creature actually receives** is a percept embedding built only from the parts it currently resolves:

```
percept = resolution · f(whole)  +  Σ over resolved parts ( visible_share · f(part) )  +  noise · (1 − resolution)
```

So a tree from far away is a coarse "tall green-over-brown thing". Up close it becomes bark + branches + leaves, and the combination is what gets recognized as a tree (see 8.2).

### 3.4 Fields

| Field | How it is computed | What it does |
|---|---|---|
| Light | Sun angle from the day/night clock, shadow test toward the sun, darkness inside shelter | Scales visual acuity; no color below light 0.2; warmth |
| Smell | Per source: `strength · exp(−distance / reach)`, stronger downwind, boosted by wet ground, washed down by rain | Mixed signature at the nose |
| Sound | Discrete events with position, loudness, signature, duration; loudness falls with distance and is damped by obstacles | Arrives at each ear separately |
| Weather | Wind (direction, gusts), rain, temperature | Moves leaves (motion for the eyes), carries smell, wets things, drives shelter-seeking |
| Time | Tick → seconds → phase (dawn, day, dusk, night) → day count | Timestamps every memory |

### 3.5 What lives in it

| Category | First set | What it gives the creature |
|---|---|---|
| Plants | grass, tree, berry bush, flower, mushroom (one kind toxic), dead leaves | Motion in wind, part hierarchies to inspect, food to discover, a poison to learn from, smells |
| Bugs | ant, beetle, butterfly, wasp, worm, spider | Self-moving things to track, fine detail (legs, antennae, wings, hair), buzzing sounds, a sting to learn from |
| Light | sun, shade, dusk, night, glow of fireflies | Day rhythm, colors that disappear in the dark, reason to shelter |
| Water | pond, rain, puddles, dew | Drinking, wetness, water sound, depth to be wary of |
| Dirt | soil, mud, sand, rock | Digging, worms after rain, the smell of wet ground, footprints |
| Shelter | hollow log, burrow, leaf canopy | Safety, dryness, warmth, a sleeping place, a "home" to remember |
| Hazards | falling fruit, thorns, wasp, toxic mushroom, deep water | Things that move toward it and hurt, so avoidance can be learned |

Bugs are small agents with their own simple state (an ant follows a trail and carries crumbs, a butterfly drifts between flowers, a wasp patrols and stings when crowded). Their job is to be stimuli with consequences.

### 3.6 The player creature

You enter the world as a second creature that you control. There is no chat window or side channel: everything between you and the creature goes through the simulation.

- **It is an entity like any other.** It has a part tree in the ontology (head, eyes, ears, body, legs, hands or paws, fur), each part with its own embedding and words, so the creature can look at you, lock its gaze on you, notice your details and name you.
- **It has a smell signature.** You leave smell in the field like any source. How well the creature smells you depends on distance, wind and the strength of its nose.
- **Your voice is a sound event** at your position. The creature hears you only within range, more faintly with distance, and muffled behind obstacles. Out of range, it does not hear you at all.
- **You have consequences.** You can bring it food, block its path, startle it or stay calm near it. It learns values about you the same way it learns them about berries and wasps, so it can come to trust you, avoid you, or follow you around.

---

## 4. The body

| Part | Senses | Actions |
|---|---|---|
| Eyes ×2 | vision | saccade, fixate, pursue, blink, pupil |
| Ears ×2 | hearing | swivel toward sound |
| Nose | smell | sniff (raises gain for a moment) |
| Mouth + tongue | taste, mouth texture | lick, bite, chew, swallow, spit, drink |
| Skin | touch, pain, temperature, wetness | flinch |
| Legs ×4 | ground contact | walk, run, jump, dig, crouch |
| Head / neck | — | turn, tilt, lower to inspect |
| Voice | — | speak, small sounds |
| Stomach | fullness | digests over time |

**Internal variables** (all 0–1): energy, hydration, stomach fill, health, fatigue, body temperature, pain.

The stomach is a buffer. Eating fills it immediately (a fast "full" signal), and energy rises 20–60 seconds later as it digests. That delay is deliberate: it forces the learning system to connect a taste now with a payoff later, which is how real animals learn food.

---

## 5. Senses

### 5.1 Vision: what is seen and how well

Each tick the world returns every node that is inside the field of view (about 140° × 100°), not blocked (ray test), and lit. For each one:

```
angle      = 2 · atan( size / (2 · distance) )      how big it looks, in degrees
acuity     = 1 / (1 + off_center / 2.5°)            sharp at the gaze center, blurry at the edge
light      = sqrt(light_level)                      0 in the dark, 1 in daylight
effective  = angle · acuity · light · contrast
```

Three thresholds on `effective`:

| Effective angle | What the creature gets |
|---|---|
| ≥ 0.3° | **Detected**: something is there. Position, motion and rough size only. |
| ≥ 2° | **Identified**: shape, color (only if light > 0.2), coarse embedding. Recognition becomes possible. |
| ≥ the node's own `needs.angle` | **Detail**: child parts and fine details become noticeable. |

Worked examples at the gaze center in daylight:

- The 6 m tree is detectable from anywhere on the map.
- A 5 cm leaf is identifiable as its own thing within about 1.4 m.
- The hair on a 2 mm ant leg needs the leg at 3°, which means the eye within about 4 cm.
- The same things 10° off-center need to be five times closer, because acuity there is 0.2.

**Noticing takes time.** Being resolvable is not the same as being noticed. Once a detail is above threshold, it has a chance of being noticed each second:

```
chance per second = k · (effective / needed − 1), capped
```

Details that are barely resolvable need a long stare. Obvious ones register at once. When it fires, a `notice` event goes to the workspace and into memory. Because of this, two creatures walking different paths end up knowing different things about the same world.

### 5.2 Eye movement: scan, lock, track, release

**Eye state:** gaze direction, mode, target, interest, dwell time.

Every visible candidate gets a salience score, recomputed each slow tick:

| Term | Meaning | Starting weight |
|---|---|---|
| motion | speed across the visual field | 1.0 |
| looming | how fast it is growing (coming at me) | 1.5 |
| novelty | 1 − recognition score | 0.8 |
| centrality | closeness to the gaze center | 0.5 |
| contrast | stands out from the background | 0.3 |
| goal | matches a current need (hungry → food-like) | 0 to 1.5, scaled by the drive |
| learned value | how strongly it helped or hurt before | 1.0 |
| already-looked | recently fixated, fades over ~3 s | −1.0 |
| noise | — | small |

The weights are not constants. Arousal raises motion and looming. Hunger raises goal for food-like things. Fear raises learned value for threats. Experience shifts all of them (section 12).

**The cycle:**

1. **Scan.** With nothing locked, the eyes jump every 200–600 ms to a target sampled from the salience scores (the Choice formula). Small jitter and drift happen during each fixation. The eyes are never still.
2. **Lock.** A lock happens when the sampled winner's salience is above the lock threshold, or when something drifts within the capture radius (3° of center) with at least minimal salience. Motion makes a lock likely. It never makes it certain.
3. **Track.** A static target is fixated. A moving one is pursued smoothly at about 90% of its speed, with small catch-up jumps when the error grows. If the target is more than ~15° off-center the head turns too, lagging the eyes; past ~60° the body turns.
4. **Interest** is a leaky state that decides how long the lock lasts:

   ```
   interest ← interest + dt · ( −interest / τ_habituate + info_gain + motion_change + need_relevance )
   ```

   New details being noticed, changes in motion, and relevance to a current need refill it. Otherwise it drains. A leaf fluttering holds the gaze for a moment; a leaf doing the same thing for ten seconds does not.
5. **Release.** The gaze lets go when interest falls below the release threshold, when a competitor's salience beats the current target by a margin (interruption), or when a sampled maximum dwell runs out. The released target gets the already-looked penalty so the eyes do not snap straight back.

**Gaze record.** Every lock produces a measurement that is written to memory and updates the system:

```
{target, concept, start_time, duration, mode, what_was_resolved, what_was_noticed, why_released}
```

This raises familiarity with the concept, updates its prototype, and is the raw material for "i was looking at a leaf moving in the wind".

### 5.3 Smell

The nose reads a single mixed vector: the sum of every source's signature times its concentration at the nose, plus noise. Sniffing raises the gain briefly.

Smell has no direction. The creature finds a source by comparing concentration between successive sniffs as it moves, and turning toward increase. This produces the weaving, nose-down search path real animals show.

A smell percept contains the mixed vector, its strength, and the best-matching known concepts (compared against smell prototypes in memory). An unknown smell is a novelty event like an unknown sight.

### 5.4 Hearing

Each sound event reaches the two ears with slightly different loudness and timing. From that difference the creature estimates direction, with error that grows for quiet sounds. Front and back are ambiguous until the head turns, so it turns its head toward sounds. That behavior falls out of the mechanism.

- **Startle.** A sudden loud onset triggers a reflex before the mind is involved: freeze, orient, arousal spike. Appraisal happens afterward.
- **Habituation.** Repeated harmless sounds (wind in leaves, water) lose salience over time.
- **Your voice** comes from the player creature (3.6), so it is a sound event at your position: heard only within range, quieter with distance, muffled behind obstacles. Attention may shift to it, it may look toward you before answering, and if it is busy running from something the answer waits.

### 5.5 Mouth, tongue and taste

Edibility is not given. It is discovered with the mouth.

1. **Lick** returns the taste signature at a tiny dose.
2. A few taste reactions are innate (sweet is pleasant, bitter is unpleasant). These are the only built-in food knowledge and they are just starting weights.
3. The creature then bites or rejects, by weighted choice.
4. **Swallowing** puts food in the stomach. Energy arrives later (reward), or sickness arrives later (punishment).
5. The outcome is credited back to the taste, smell and look of the thing (8.4). Each concept keeps an edibility belief as a running count of good and bad outcomes.

When it is hungry and knows no food nearby, the weight on mouthing unknown things rises. Small, still, non-threatening objects get licked first.

### 5.6 Touch and pain

A collision produces a contact with force and location. Damage depends on force and on the object's hardness, sharpness and harm values. Damage produces pain and lowers health.

Pain triggers a **withdrawal reflex** on the fast path: move away along the contact direction, immediately. Then the slow path works out what caused it and learns (section 9.3).

Touch also resolves details vision cannot: `needs: {touch: true}` attributes like roughness, wetness and temperature.

### 5.7 Interoception

The body reports itself the same way the outside world does: energy, hydration, fullness, fatigue, temperature and pain all generate percepts that compete for attention. A hunger pang can win the workspace over a butterfly.

---

## 6. Attention and the workspace

All candidates compete in one arena: things seen, smelled and heard, body signals, recalled memories, and its own thoughts. Each has a salience. The winner enters the **workspace**.

The workspace holds one focus at a time, for at least 200–300 ms, plus about four fading working-memory items (what it was just looking at, its current goal, its last thought, a recent sound). Whatever is in the workspace is **broadcast** to every module on the next tick:

- memory records it,
- appraisal evaluates it,
- drives react to it,
- the inner voice may put it into words,
- the mind may act on it.

This broadcast is the chain of events: one thing in focus causes updates everywhere, and those updates create the next candidates.

The sequence of workspace contents over time is the creature's **stream of awareness**. It is logged, shown in the viewer, and is the answer to "what was it conscious of at 14:03:22?".

Pain, loud sounds and looming objects carry heavy weights so they break through whatever is in focus. Eyes and awareness usually agree but can come apart: looking at a leaf while the focus is a hunger pang gives the blank, absent stare.

---

## 7. Appraisal and feelings

When something enters the workspace, appraisal answers "what is this to me?" from memory:

```
novelty     = 1 − best recognition score
threat      = Σ_k similarity(this, k) · harm_value[k]  + looming + innate biases (big, fast, sudden)
food_value  = Σ_k similarity(this, k) · food_value[k]  × hunger
uncertainty = high when it has met this few times
```

Because values are summed over similar known things, something that merely resembles what hurt it before already feels somewhat dangerous.

These feed four feeling states (leaky values): **arousal**, **valence** (good/bad), **fear**, **curiosity**.

Appraisal then samples a **stance** toward the thing: ignore, watch, approach, inspect, taste, avoid, flee, freeze. This is the "did it take it as a threat, as normal, did it feel like engaging" step, and it is a weighted choice, not a rule.

Novelty feeds both curiosity and caution. The balance, set by temperament and current state, produces the hesitant stop-and-go approach to new things.

---

## 8. Memory

### 8.1 The stores

| Store | Holds | Lifetime |
|---|---|---|
| Sensory buffer | raw percepts | ~1 s |
| Working memory | focus + ~4 items | seconds |
| Episodic | events: what, where, when, with what cues, how it felt | decays; refreshed by recall; stronger if arousing or novel |
| Semantic (knowledge graph) | concepts and facts about them | long; strengthened by repetition and sleep |
| Associative | cue → outcome values (food, water, harm, safety) | long; fast to learn |
| Lexicon | word ↔ concept / attribute | long |
| Place map | coarse grid: what was seen where, when, and how the place felt | long |
| Procedural | behavior weights | long; slow to change |

**Episode record:**

```
{time, day, phase, place, focus_concept, instance, action, outcome,
 cues: {visual, smell, sound}, valence, arousal, strength, thought_ids}
```

**Fact (edge in the knowledge graph):**

```
{subject, relation, object, source, confidence, count, first_time, last_time}

relations: part_of · has_attr · found_at · edible · causes · smells_like · sounds_like · tastes_like · similar_to
source:    seen · smelled · heard · tasted · felt · told · inferred
```

The knowledge graph is the only place language can draw facts from.

### 8.2 Concepts and recognition

A concept is the creature's own category. It holds a prototype per sense (visual, smell, sound, taste, touch), the part-concepts it has seen belonging to it, a familiarity count, and a name if it has one.

Recognition compares the current percept to every known concept:

```
score_k = a · cosine(percept, prototype_k)  +  b · overlap(parts resolved now, parts known for k)
```

| Score | Result |
|---|---|
| ≥ 0.85 | Recognized. Prototype nudged toward this instance. |
| 0.60–0.85 | "Looks like a ___". Similarity thought possible; may become a new related concept. |
| < 0.60 | Novel. Novelty spike, curiosity up, naming instinct armed. |

Two things follow from the part-overlap term:

- A tree is recognized from far away by its coarse outline and from up close by "bark + branches + leaves together".
- A new combination of known parts is understood by analogy: leaves and branches but small and no trunk scores as "looks like a tree" and becomes its own concept (bush).

Percepts are noisy when the view is poor, so the creature sometimes gets it wrong ("i thought that was a stick"). Correcting on a closer look is a surprise event and a thought trigger.

Because every concept has a prototype per sense, any one sense can activate it. A smell alone can bring up the concept, its name, where it was found and what happened there.

### 8.3 The naming mechanism

1. The fixated node is resolved and recognition says **novel**.
2. Novelty raises curiosity, which refills gaze interest, so it keeps looking.
3. After 1–2 s of fixation the `NAME_IT` thought may fire (weighted, not guaranteed).
4. The world hands over the `words` embedded in the node it actually resolved, at the level it resolved it. A distant ant offers `coarse_words` ("bug"); an ant inspected closely offers "ant".
5. The creature picks one word by weighted choice. Once picked, it sticks: that is the creature's name for the thing from then on. Other listed words are still understood when you use them.
6. A concept is created: prototype = current percept, name = the picked word, first seen = here and now.
7. The thought is rendered ("what is this? .. i should give it a name so if i see it again ill remember it .. ill call it a leaf") and stored.
8. **Attribute pass.** For each attribute it resolved (color, shape, texture):
   - If another known concept shares that value, a comparison thought fires: "its the same color as grass .. so its green".
   - If the value is new, the attribute word is itself discovered from the node: "ill call this color green".

If the naming thought does not fire (the glance was too short), the thing is stored as an unnamed concept. On a later meeting it produces "i seen this before but idk what it is", and the chance of naming goes up.

Refinement creates taxonomy for free: when a thing first named "bug" is later resolved finely and named "ant", the graph records that an ant is a kind of bug.

**Innate vs. discovered vocabulary.** Function words, body words, feeling words and basic verbs (see, smell, eat, call, look, want) are innate. Every noun and attribute word belonging to the world is locked until discovered.

### 8.4 Association: how a smell brings back an event

Every perceived cue (a smell, a sight, a sound, a place) leaves a fading trace:

```
trace_cue(t) = exp( −(t − time_perceived) / τ )
```

When an outcome arrives (energy gained, thirst relieved, pain, sickness), every cue with a live trace gets credit, using the Learning formula:

```
value[cue, outcome_type] += rate · trace_cue · (outcome − expected_from_all_present_cues)
```

- Values are kept **per outcome type** (food, water, harm, safety), so the creature knows why something is good, which language needs ("it filled me up" vs "it stopped the thirst").
- Ordinary traces last about 5 s. Traces from things swallowed last minutes, so a sickness that arrives late is still blamed on the food.
- Harm learns fast (one bad experience is enough). Unlearning harm is slow and never complete.

Alongside the values, an episode is stored that binds the cues together with the time, place and outcome.

**Recall.** Later, a cue alone activates the concept through its prototype, retrieves the matching episodes by similarity, and reactivates the stored value as an expectation. The retrieved memory then competes for attention like any percept. If it wins, the creature is now aware of "that smell, the berries by the water, eating, feeling good" without having seen anything, and that awareness can trigger a thought and a behavior (go find it).

**Time.** Episodes carry timestamps and day phase. Elapsed time maps to words ("just now", "earlier", "last night", "a while back"). Repeated sequences are learned as expectations, so "the light goes orange, then it gets dark" becomes a reason to head for shelter before night.

### 8.5 Knowledge gating

The creature must never say what it has not discovered. Three layers enforce that:

1. **Facts.** The language system receives only facts retrieved from the creature's own memory.
2. **Words.** World vocabulary is masked. A discoverable word can be produced only if it is in the lexicon or was just said to the creature in the current conversation.
3. **Check.** Every reply is validated against memory before it is spoken. A failure falls back to a safe rendering.

Told facts are stored with `source: told` and are kept apart from seen facts. Being told something also creates a **pending check**: next time the creature meets that concept, top-down attention is biased toward the part in question.

| You say | It looks up | It answers |
|---|---|---|
| "do you know what a leaf is?" | lexicon → concept → facts | "yea i saw a leaf on a tree" |
| "did you know ants have hair on their legs?" (never looked closely) | no such fact | "nah i havent seen that yet" — stores it as told, adds a pending check |
| same question, later | fact present, source: told | "you told me that .. i still aint seen it myself" |
| same question, after inspecting an ant | fact present, source: seen | "yea i seen it .. little hairs all on the legs" |
| "whats a beetle?" (never met one) | word unknown | "idk what a beetle is .. i aint seen one" |
| "what does a berry taste like?" | tastes_like, if tasted | "sweet .. it filled me up" or "idk i never tasted one" |
| "why did you run?" | last flee episode and its cause | "that thing hit me before .. i aint tryna get hurt again" |

### 8.6 Forgetting and sleep

Episode strength decays over time and is boosted by recall. Arousing and novel events start stronger. Weak episodes eventually drop out, while the facts they produced remain in the knowledge graph, so it can know a berry is sweet without remembering every berry.

During sleep the strongest recent episodes are replayed: their facts are reinforced, their associations are firmed up, and weak traces are pruned. Sleep is where a day's experience becomes stable knowledge.

---

## 9. Drives, instincts and the mind

### 9.1 Drives

| Drive | Rises when | Relieved by |
|---|---|---|
| Hunger | energy low | eating |
| Thirst | hydration low | drinking |
| Safety | fear, pain, predicted harm | distance from threat, shelter |
| Rest | fatigue high, night | resting, sleep |
| Comfort | cold, wet, dark, exposed | shelter, sun, drying off |
| Curiosity | novelty present, or boredom (nothing unexpected for a while) | inspecting, discovering |

Urgency is nonlinear: a small deficit is a whisper, a large one dominates everything.

### 9.2 Behaviors and how one is chosen

Behaviors: wander, approach, inspect, follow-smell, orient-to-sound, taste, eat, drink, flee, freeze, hide, seek-shelter, rest, sleep, dig, speak.

Each behavior has an activation, computed every slow tick:

```
activation_b = Σ instinct_weight[b, drive] · drive
             + Σ percept_weight[b, feature] · feature
             + learned_value(b in this situation)
             + persistence bonus if b is already running
             + noise
```

One behavior is sampled by the Choice formula. The persistence bonus stops it from flip-flopping. When the top two are close, the creature hesitates, and that conflict can itself trigger a thought ("should i go closer ..").

**Instincts are the starting values of the weights.** A sample of the innate table:

| Drive | Pushes toward | Pushes against |
|---|---|---|
| Hunger | seek known food +1.0, taste unknown things +0.4, wander +0.3 | rest |
| Thirst | seek water +1.0 | — |
| Fear | flee +1.2, hide +0.8, freeze +0.6 | wander −1.0, inspect −0.8 |
| Curiosity | inspect +1.0, approach +0.6, wander +0.5 | rest |
| Fatigue | rest +1.0, seek shelter +0.5 | wander |
| Cold / dark / rain | seek shelter +0.8 | wander |

Each behavior picks its own target by scoring. Seek-food goes for the visible thing with the best food value for the distance; if nothing is visible it consults the place map ("berries were by the water") and walks there.

### 9.3 Learning from harm

The sequence for "something came at it, hit it, and hurt":

1. Contact produces pain and health loss.
2. Reflex: withdraw (fast path).
3. Credit: every cue with a live trace gains harm value — the look of the object, the looming, its sound, its smell, the place.
4. The episode is stored at high strength because arousal was high.
5. Next time, appraisal predicts harm from the cue alone. Fear rises before contact, flee activation crosses the line earlier, and the eyes weight that kind of object more heavily.
6. A successful dodge is rewarded by relief (harm was predicted and did not come), which strengthens dodging in that situation.
7. Repeated safe exposure lowers the harm value slowly, down to a floor. It stays a little wary.

Prevention is therefore not a rule. It is a prediction that pushes on behavior, and it adapts in both directions.

### 9.4 Learning from need

Reward is the reduction of a drive. Energy arriving while hungry is strongly positive; the same food when full is nearly nothing. This single signal trains food values, place values, behavior values and attention weights, so "stay fed" and "stay unhurt" shape everything else without being programmed as goals.

---

## 10. Inner voice and language

### 10.1 When it thinks: thought triggers

A thought is an instinctive expression fired by a state, at the moment the state occurs.

| Trigger | Fires when | Example |
|---|---|---|
| NOVELTY | fixated thing is unrecognized | "what is this?" |
| NAME_IT | novelty held long enough | "ill call it a leaf" |
| COMPARE | a resolved attribute matches a known concept | "its the same color as grass .. so its green" |
| NOTICE_DETAIL | a new part or detail is noticed | "oh it got lil lines on it" |
| RECOGNIZE | a known thing reappears after a gap | "thats a tree again" |
| SMELL_RECALL | a smell activates a memory with nothing in view | "i smell them berries .. where they at" |
| EXPRESS_VALUE | learned value of the current percept is strong | "mm that smells good" |
| PAIN | pain spike | "ow" |
| THREAT | harm predicted | "nah thats the thing that hit me" |
| DRIVE_RISING | a drive crosses a level | "im gettin hungry" |
| SATISFIED | a drive drops sharply | "that hit the spot" |
| SURPRISE | expectation violated | "hold on .. i thought that was a stick" |
| CONFLICT | top two behaviors nearly tied | "should i go closer .." |
| IDLE_RECALL | calm, nothing salient | "them berries was good tho" |
| TOLD_CONFIRMED | a pending check resolves | "oh you was right .. they do got hair on the legs" |

```
chance = talkativeness · sigmoid( gain · (intensity − threshold) ) · (1 − just_said_this)
```

Thinking takes time (a few words per second) and occupies the workspace while it happens, which dampens scanning. The creature visibly pauses to think.

"That smells good" is the model case. Nothing in the system knows what "good" means. The phrase is mapped to a state: sense = smell, learned value above a threshold. That value only exists because the smell was once followed by a reward.

### 10.2 What a thought is

Each thought has two forms:

```
structured:  {intent: NAME_IT, target: concept_17, label: "leaf", mood: curious, time: ...}
words:       "what is this? .. i should give it a name so if i see it again ill remember it .. ill call it a leaf"
```

The structured form is what changes the mind. The words are what you see and hear. On completion the thought **writes back**:

- NAME_IT commits the name to the lexicon.
- NOTICE_DETAIL and COMPARE add facts to the knowledge graph.
- THREAT raises avoidance for that concept.
- A plan thought sets a goal.
- Any thought that recalls a memory strengthens that memory.
- Every thought is itself stored as an episode, so it can later say "i was wondering what that was".

### 10.3 Talking with you

You talk to it as the player creature (3.6). Your words are a sound in the world, and its reply is a sound in the world.

```
you speak → sound event at your position → its ears (if in range)
          → competes for attention → if it wins: parsed into an intent
          → memory lookup → answer intent + retrieved facts
          → speak behavior competes with everything else it wants to do
          → rendered into words → gating check → spoken aloud at its position
```

Speaking is never automatic. It is a potential action like eating or fleeing (the `speak` behavior in 9.2). It can answer late, answer while doing something else, or not answer at all if something more urgent is going on.

Question types to support first: what have you seen, do you know X, did you know (claim), what is X like, where is X, when did you, how do you feel, what are you doing, why did you, do you like X, and plain statements that teach it something.

Parsing starts as rules over the closed world vocabulary. A word it has never grounded produces "whats a ___?".

### 10.4 The dataset, built from scratch

The dataset teaches how to say things. It does not teach facts. Facts come only from memory at runtime.

Four pieces:

1. **Ontology** (section 3.2): every entity, part, attribute and word.
2. **Intent catalog**: every thought trigger and every dialogue answer type, around 80 in total.
3. **Phrase bank**: each intent is a sequence of moves, and each move has many phrasings.

   ```
   NAME_IT = WONDER + DECIDE_TO_NAME + COMMIT

   WONDER:          "what is this?" | "hm whats that" | "i never seen this before" | "hold on .. whats this" | ...
   DECIDE_TO_NAME:  "i should give it a name so if i see it again ill remember it"
                  | "lemme name it so i dont forget" | "it need a name" | ...
   COMMIT:          "ill call it a {label}" | "this a {label}" | "{label} .. yea thats what im callin it" | ...
   ```

   Eight phrasings per move gives 512 ways to say one thought before any slot is filled. Phrasings are tagged by mood and intensity, so a scared creature and a calm one word the same intent differently.
4. **Generator**: samples a valid mind state from the ontology, picks an intent, renders it, and writes a row.

   ```json
   {"intent": "COMPARE", "mood": "curious",
    "facts": [["attr", "leaf", "color", "green"], ["shares_attr", "leaf", "grass", "color"]],
    "text": "im tryna really see what this is .. its the same color as grass .. so its green"}
   ```

Because rows are generated from the ontology, coverage is guaranteed: every object, part and detail has examples for every relevant intent. Adding a new object to the ontology adds it to the world and to the dataset in one step.

### 10.5 The small language model

The language model is not a separate chatbot bolted on. It reads the creature's state directly, so what it says is tied to what its senses and body are doing at that moment.

**Stage 1: the grammar speaks.** The phrase bank renders thoughts directly. It works from day one, it is the teacher for the model, and it stays as the fallback.

**Stage 2: pretraining on the world.** A small transformer is pretrained on text about everything in the environment, generated from the ontology: what trees are, what their parts are, what ants do, what berries taste like, how water behaves. This gives the model language and an understanding of the world's concepts and how they relate.

**Stage 3: thoughts conditioned on state.** Each sense agent and body system produces an embedding every slow tick:

| Source | Embedding carries |
|---|---|
| Vision | current focus percept, resolved parts, gaze mode |
| Smell, hearing, taste, touch | current percepts |
| Body | energy, hydration, pain, fatigue, temperature |
| Feelings | arousal, valence, fear, curiosity |
| Memory | retrieved episodes and facts, with their source (seen, told, ...) |
| Trigger | which thought trigger fired, and its intensity |

A small learned adapter per source turns its embedding into a few input tokens for the model. The model reads those tokens and writes the thought. Sight, smell, body and memory enter the model as signals, not as text descriptions of themselves.

**Training data is produced by the simulation itself.** Run the creature through many lives. At every thought trigger, log the full state embeddings and the grammar's rendering of that moment. That gives millions of (state → thought) pairs covering every object, part and situation the world contains. The model is fine-tuned on these.

**Knowing vs. having seen.** After pretraining, the model knows ants have hairy legs. Memory may say the creature has never seen that. The rule is that **anything stated as its own experience must come from the memory tokens**. Training enforces it: many rows give the model a question whose answer it knows from pretraining, alongside memory tokens that lack the fact, with the target reply "nah i havent seen that yet". The model learns that pretrained knowledge is not experience.

Pretrained knowledge still matters, because it is where emergence in conversation comes from. It lets the creature connect what it has seen to questions it was never trained on: asked "is a tree alive?", it can reason from what it has seen ("it got leaves that move .. and it be growin .. so i think so?"). That kind of reasoning is marked as a guess, never as something it saw.

**Observation updates expression at two speeds.**

- **Instantly:** memory updates as it observes, and the memory tokens change with it. What it saw a minute ago is already sayable.
- **Overnight:** during sleep (8.6), the model is lightly fine-tuned on that day's own logged thoughts and conversations, so its phrasing drifts to become its own over time.

**Safeguards.**

- **Slot shuffling in training.** A share of rows use deliberately wrong state (a purple leaf, a sweet rock). The model learns to follow its state and cannot fall back on what pretraining says leaves usually are.
- **Masked decoding.** World words that are not in its lexicon and were not just said to it cannot be emitted.
- **Validation.** Every reply is checked against memory before it is spoken (8.5).

### 10.6 Not sounding like a recording

- Combinatorial phrase bank (10.4).
- A recency penalty on recently used phrasings and openers.
- Sampling temperature tied to arousal.
- Mood-tagged phrasings.
- Detail selection varies: asked about a tree twice, it draws different remembered facts each time.
- Refractory periods so it does not narrate every glance.

---

## 11. Four chains of events, start to finish

### A. First tree, and a leaf in the wind

| Step | Module | What happens |
|---|---|---|
| 1 | Eyes | Scanning. A leaf flutters in the periphery: motion + novelty give it the top salience. Sampled as winner. |
| 2 | Eyes | Saccade, lock, pursuit. The head follows. |
| 3 | Workspace | The leaf becomes the focus and is broadcast. |
| 4 | Memory | Recognition score is low: novel. |
| 5 | Appraisal | Novelty high, threat low. Curiosity rises. Stance sampled: inspect. |
| 6 | Mind | Approaches. As it closes distance, branch, leaf and bark resolve as parts of the larger thing. |
| 7 | Inner voice | NAME_IT fires for the whole: "what is this? .. ill call it a tree". Then for the part in focus: "ill call it a leaf". |
| 8 | Inner voice | Attribute pass: "its the same color as grass .. so its green". |
| 9 | Memory | Concepts tree and leaf created; facts `leaf part_of tree`, `leaf has color green` stored as seen. Gaze record and episode written. |
| 10 | Eyes | Interest drains. Release. Already-looked penalty applied. Scanning resumes. |

Later: "do you know what a leaf is?" → "yea i saw a leaf on a tree". It never got close enough for the veins, so it will not mention them.

### B. Something falls and hits it

| Step | Module | What happens |
|---|---|---|
| 1 | Eyes | A fruit drops from above. Looming salience spikes; eyes lock. |
| 2 | Appraisal | First time: no harm value, mild caution only. It watches. |
| 3 | Skin | Impact. Pain, health loss. |
| 4 | Reflex | Withdraws immediately. |
| 5 | Memory | Harm value assigned to: looming fruit shape, the thud, the place under the tree. Strong episode stored. |
| 6 | Inner voice | "ow .. what was that" |
| 7 | Next time | The same looming shape now predicts harm. Fear rises before contact and it moves out of the way. Relief reinforces the dodge. |
| 8 | Longer term | It is warier under that tree, and its eyes flick upward more there. |

### C. Hunger, tasting, and a smell that means something

| Step | Module | What happens |
|---|---|---|
| 1 | Gut | Energy falls. Hunger rises and wins the workspace: "im gettin hungry". |
| 2 | Mind | No known food. Weight on tasting unknown things rises. It approaches a berry bush. |
| 3 | Nose | Picks up an unfamiliar sweet smell. Trace starts. |
| 4 | Mouth | Licks a berry: sweet (innately pleasant). Bites, swallows. |
| 5 | Gut | Half a minute later, energy rises. Reward. |
| 6 | Memory | Food value assigned to the berry's taste, smell and look. Edibility belief up. Episode: berries, by the water, in the afternoon. |
| 7 | Inner voice | "that hit the spot" |
| 8 | Days later | Downwind of a bush it cannot see, the smell alone activates the berry concept and the episode. EXPRESS_VALUE fires: "mm that smells good". It follows the smell upwind. |

### D. Told something it has not seen

| Step | Module | What happens |
|---|---|---|
| 1 | Ears | You: "did you know ants have hair on their legs?" |
| 2 | Memory | It knows ants (named one earlier, from a distance). No fact about leg hair. |
| 3 | Voice | "nah i havent seen that yet" |
| 4 | Memory | Stores the claim as told. Adds a pending check on ant legs. |
| 5 | Later | An ant crosses its view. The pending check boosts goal salience. It inspects: lowers its head, eye within a few centimeters, fixates a leg. |
| 6 | Eyes | After about a second the hair detail is noticed. |
| 7 | Inner voice | "oh you was right .. they do got hair on the legs" |
| 8 | Memory | The fact is now stored as seen. |

---

## 12. Continuous learning and evolution

**Within one life, everything below is always updating:**

| What changes | Driven by |
|---|---|
| Cue values (food, water, harm, safety) | outcomes, via traces |
| Concept prototypes and part lists | every recognition |
| Edibility beliefs | every taste |
| Attention weights | what turned out to matter after being looked at |
| Behavior values | drive reduction |
| Habituation | repetition without consequence |
| Lexicon and knowledge graph | discovery, thoughts, being told |
| Place map | everything, tagged with where |
| Long-term stability | sleep replay |

**Across lives (later stage).** The innate parameters form a genome: salience weights, the instinct table, temperament (curiosity, fearfulness, talkativeness), learning rates, sense ranges. A new creature is a mutated copy of a successful one. Memories do not transfer, but instincts do, so over generations the starting weights shift toward what kept ancestors fed and unhurt.

**Persistence.** The full mind state saves to disk. A creature's life continues across sessions, and you can talk to it tomorrow about what it found today.

---

## 13. Realism layer

Small things that make it read as alive. All are consequences of states already defined, not separate animations.

- Eyes never fully still: jumps, drift, jitter.
- Eyes lead, head follows, body follows last.
- Blinks every few seconds, fewer while staring, often during large gaze shifts.
- Pupils widen with arousal and in low light.
- Breathing rate follows arousal; sniffing comes in bursts.
- Ears swivel to a sound before the head turns.
- Startle, then freeze, then assess.
- Stop-and-go approach to unfamiliar things.
- Pauses while thinking.
- Mind-wandering when calm: memories surface on their own.
- Fatigue slows everything; sleep at night in a remembered shelter.
- No two runs alike, because of noise and sampling at every level.

---

## 14. Tech stack and repo layout

**Recommended:**

- **Simulation core in Python.** World, body, senses, mind, memory, grammar, dataset generator and model training all in one language. It runs headless on a fixed tick with a seed, so it can be tested automatically and run faster than real time (the creature can live a week overnight).
- **Viewer in the browser (Three.js)**, connected over a WebSocket. It renders the world and creature and shows the mind: gaze ray, salience bars, drive meters, current focus, thought stream and the knowledge graph. You move the player creature with the keyboard and speak through it with text or microphone. It also shows a discovery meter (facts found out of facts that exist in the ontology).
- **Ontology in YAML.** The single source of truth.
- **The mind does not depend on the renderer.** It takes percepts in and sends motor commands out, so the 3D side can later move to a game engine without touching the mind.

```
ontology/            entities, parts, attributes, words
sim/
  world/             scene graph, fields (light, smell, sound), weather, bug agents
  player/            the player creature: body, smell, voice, controls
  creature/
    body.py
    senses/          vision, smell, hearing, taste, touch, interoception
    attention.py     salience competition
    workspace.py     focus, working memory, broadcast, stream log
    appraisal.py
    drives.py
    mind.py          behavior selection, goals
    motor.py         eye / head / body controllers, reflexes
    memory/          episodic, semantic, associative, lexicon, places
    language/        intents, phrase bank, renderer, parser, gating, model wrapper
    learning.py      traces, value updates
    sleep.py         replay and consolidation
  save.py
dataset/             generator and outputs
lm/                  tiny transformer: train and run
viewer/              Three.js client
tests/               behavior tests
```

---

## 15. Build order

Each stage is usable on its own and has a test that defines "done".

| # | Build | Done when |
|---|---|---|
| 1 | Ontology loader, world tick, basic viewer. A few entities: ground, tree, bush, pond, ant. Creature as a simple body walking around. | It can be watched in a browser, and ten simulated minutes run headless in seconds. |
| 2 | Eyes: visibility model, salience, scan / lock / pursue / release, gaze overlay. | With nothing moving, fixations last 200–600 ms and spread over the scene. A butterfly crossing gets locked most of the time, not every time. After release the eyes do not snap back. |
| 3 | Body, drives, reflexes, mouth. Hunger, thirst, pain, tasting. | Left alone it gets hungry, tastes things, finds the berries and survives a day. Time-to-dodge a repeated hazard shortens. |
| 4 | Memory, concepts, naming, thought stream (grammar only). | First tree is named once. Second tree is recognized, not renamed. The knowledge graph holds only what it got close enough to notice. |
| 5 | Smell, hearing, association and recall. | The smell of hidden berries draws it in and triggers a recall thought. It turns toward sounds. After one sting it flinches at buzzing. |
| 6 | Player creature, dialogue and knowledge gating. | It hears you only within range and sometimes looks at you before answering. The ant-hair question flips from "havent seen that" to "yea i seen it" only after a close inspection. Across a thousand random questions, no answer contains an undiscovered word or fact. |
| 7 | World pretraining, sim-logged corpus, state-conditioned model. | Model replies pass the same no-leak test, phrasing rarely repeats, fallback to the grammar is rare, and it answers questions it was never trained on by reasoning from what it saw. |
| 8 | Day/night, weather, shelter, sleep and consolidation. | It heads for shelter before dark and remembers yesterday after sleeping. |
| 9 | Generations. | Later generations survive longer from birth than the first. |

Stages 1–4 are enough for the tree-and-leaf scenario end to end.

---

## 16. Starting numbers

All of these are starting points to be tuned by watching the creature.

| Parameter | Value |
|---|---|
| Fast loop / slow loop | 60 Hz / 15 Hz |
| Field of view | 140° × 100° |
| Acuity half-point | 2.5° off-center |
| Detect / identify thresholds | 0.3° / 2° effective |
| Color needs light above | 0.2 |
| Scan fixation length | 200–600 ms |
| Capture radius | 3° |
| Lock dwell | 1–8 s, governed by interest |
| Habituation time constant | 2–4 s |
| Already-looked penalty | fades over ~3 s |
| Pursuit gain | 0.9 |
| Head joins beyond | 15° off-center |
| Workspace minimum hold | 250 ms |
| Working memory | 4 items |
| Recognized / similar thresholds | 0.85 / 0.60 |
| Naming needs fixation of | 1–2 s |
| Cue trace | 5 s (swallowed things: 120 s) |
| Harm learning rate / unlearning rate | 0.5 / 0.02 |
| Food learning rate | 0.2 |
| Digestion delay | 20–60 s |
| Choice temperature | 0.3 calm, 0.1 urgent |

---

## 17. Known failure modes

| Problem | Guard |
|---|---|
| Flip-flopping between behaviors | Persistence bonus and a minimum commitment time |
| Narrating everything | Thought thresholds, refractory periods, one thought at a time |
| Saying things it never discovered | Three-layer gating (8.5) and the no-leak test in every build |
| Fear snowballing until it never leaves shelter | Harm values capped, slow unlearning, hunger eventually outweighs fear |
| Staring forever at one thing | Interest always drains; sampled maximum dwell |
| Too many tunable numbers | Every state is visible in the viewer; behavior tests catch regressions |

---

## 18. Open decisions

1. **Stack.** Python core with a browser viewer is the recommendation. A game engine for the 3D side is the alternative if visual fidelity becomes the priority early.
2. **The creature's form.** The blueprint assumes a small four-legged animal about 12 cm long with forward-facing eyes, movable ears, a nose and a tongue. Any body with those parts works.
3. **How much inner voice is shown.** Always-visible thought stream, or thoughts only when it speaks aloud.
4. **Voice.** The phrase bank will be written in the casual register used in the examples above unless a different one is wanted.
5. **How much pretrained knowledge may surface.** The design lets it reason from pretraining as long as it marks that as a guess. The stricter option is to allow only reasoning that starts from something it has seen.
