# Blueprint: a creature that learns from its own body

**Status:** design only. Nothing in this document is built yet except the Lodestone reference code in `reference/lodestone.html`, which was run and checked (results in section 2).

**What we are building:** a spider living in a 3D world in the browser. It has a body with needs, senses, instincts, and a mind made of small readable numbers instead of a neural network. It learns what things do to it, learns new ways of moving when its body or the ground changes, can be talked to, can refuse, and can tell you truthfully why it did something. You can watch the world, or watch the world the way the spider currently perceives it.

---

## 1. The whole idea in six sentences

1. The creature only cares about one thing: **distress**, which is computed from its body levels (energy, injury, sickness, fatigue). Nobody gives it a score.
2. Everything it knows is stored in **records**. A record is one small belief about one thing: "sweet-smelling things: +14 energy, seen 7 times, very consistent".
3. One experience updates **many records at once**: the exact object, each of its features, the place, the movement it was doing. That is the "multiple states updated" idea.
4. Each record remembers at **two speeds** (long-run average and latest experience). When the two disagree, the creature knows the world changed, drops the old belief and gets curious again.
5. Behaviour is not a script. Every known place **pulls** on the creature according to how much distress it expects to remove there and how much it could learn. The strongest pull wins.
6. Movement works the same way: a gait is ~25 numbers, the creature keeps a **repertoire** of gaits with records of what each one actually does, tries small variations when it is safe, and keeps the ones that turn out better than expected.

Instinct is the same machinery with a head start: **an instinct is a record the creature is born with**, marked as low-confidence so real experience can overrule it quickly.

---

## 2. What Lodestone does, and how it differs from a neural network

### 2.1 Lodestone in plain words

The agent lives on a grid. Coloured shapes change its energy and integrity by hidden rules. Each step it does this:

| Step | What the code does | Function |
|---|---|---|
| Feel | Turns each body level into distress: zero when full, steep near empty | `phi` |
| File the experience | The touched object updates three records per body level: its exact kind, its colour, its shape | `learn` |
| Two-speed memory | Each record keeps `slow` (running average) and `fast` (latest). If they differ by more than the record's usual scatter, that is **dissent** | `observe` |
| Fold | Two dissents in a row: throw the old average away. If it was a well-established rule, mark everything older as "rumour" | `observe`, `learn` |
| Predict by vote | For any object, the kind, colour and shape records vote, weighted by how consistent each has been. A feature that never mattered abstains | `predict` |
| Be pulled | Each remembered cell gets a pull = expected distress removed + curiosity about the unknown, divided by distance. Strongest pull becomes the goal | `decide` |
| Stay alive | Never experiment when the worst thing it has ever felt could finish it off | `decide` (`safe`) |

The entire learned state is 20 keys of a few numbers each plus a map of what it last saw where.

### 2.2 Checked results

I extracted the core script and ran its experiment in Node: 40 worlds, 3,000 steps, hidden rules reshuffled at step 1,500.

| Agent | Alive at 1,500 | Alive at 3,000 | Median lifespan |
|---|---|---|---|
| Lodestone | 88% | 70% | 3,000+ |
| Without generalising (no colour/shape votes) | 78% | 33% | 1,579 |
| Without dissent (plain averages) | 93% | 28% | 1,595 |
| Eat the nearest thing | 0% | 0% | 37 |
| Random walk | 0% | 0% | 140 |

So both ideas earn their place: feature voting helps it learn faster, and dissent is what lets it survive the rule change. This is one small grid world; it says nothing yet about 3D bodies.

### 2.3 Versus a neural network

| | Neural network | Records (Lodestone style) |
|---|---|---|
| Where knowledge lives | Spread across thousands to billions of weights; no single weight means anything | In named numbers you can print: "blue: +14 energy, n=7" |
| How it learns | Measure the error, nudge every weight a tiny step in the direction that reduces it (gradient descent), repeat over many examples | Update the one record the experience is about, at the moment it happens |
| Speed | Many examples | One or two experiences |
| When the world changes | Old and new blur together and it unlearns slowly | It notices the disagreement and drops the old rule |
| Generalising | Discovers its own features from raw data. This is its real strength | Only along features it is handed (colour, shape). This is its real limit |
| Reading its mind | Hard, an open research field | Trivial, the beliefs are the data structure |
| Raw pixels, open language | Yes | No |

The honest trade: a neural network **finds** the features; a record system is **given** them. Our design gets around this by having the world hand the creature feature vectors directly (section 4), so the mind stays small and readable. If we ever want it to see raw images, a network would supply features and this mind would sit on top of it unchanged.

### 2.4 About reinforcement learning

Your description, "if a reaction was good for it, make that reaction more likely", is the core rule of reinforcement learning (the "law of effect"). What makes standard RL feel narrow is how it is usually set up, and those are the parts we change:

| Usual RL setup | This design |
|---|---|
| One reward number defined by the programmer | Several body channels; "good" means distress went down |
| Train for millions of steps, then freeze | Learns for its whole life, during the life |
| Knowledge in a network | Knowledge in records |
| Change in the world looks like noise | Change is the main signal (dissent) |

The published name for the first row is *homeostatic reinforcement learning* (Keramati and Gutkin, 2014).

---

## 3. System map

```
                          YOU (words, placing objects, changing rules)
                                         |
  WORLD --------------------------------------------------------------+
  terrain + blobs (position, size, colour, feature vector, effects)   |
        |                                               ^             |
        v                                               | forces      |
  SENSES                                             PHYSICS          |
  sight, smell, touch (feet), body feel, hearing     body + 8 feet    |
        |                                               ^             |
        v                                               |             |
  +-----------------------------------------------------|----------+  |
  | MIND                                                |          |  |
  |                                                     |          |  |
  |  BODY STATE      channels: energy, integrity,       |          |  |
  |                  toxin, fatigue, leg health         |          |  |
  |                  modulators: arousal, sickness,     |          |  |
  |                  intoxication                       |          |  |
  |       |                                             |          |  |
  |       v                                             |          |  |
  |  RECORDS  <--- credit assignment (who caused        |          |  |
  |  beliefs about objects, features, places,           |          |  |
  |  gaits, your words          this body change?)      |          |  |
  |       |                                             |          |  |
  |       v                                             |          |  |
  |  PULLS  ->  goal  ->  wanted motion  ->  MOTOR  ----+          |  |
  |                                          skill repertoire      |  |
  |                                          pattern generator     |  |
  |                                          reflexes              |  |
  |       |                                                        |  |
  |       v                                                        |  |
  |  SPEECH (says what is salient, in a style set by its state)    |  |
  +----------------------------------------------------------------+  |
        |                                                             |
        v                                                             |
  INSPECTOR: gauges, pulls, beliefs, repertoire, event log, its view -+
```

Three loops run at different speeds:

| Loop | Rate | Does |
|---|---|---|
| Reflex | every physics tick (60/s) | pattern generator moves legs, reflexes correct slips and pain |
| Decision | about 5/s | sense, update records, compute pulls, choose goal and skill |
| Bout | every 1 to 2 s of movement | judge the gait just used, keep or discard the variation |

Body modulators drift slowly underneath all three.

---

## 4. World

**Everything is a blob.** A blob has a position, radius, colour, a **feature vector**, and hidden effects on the body. A flower is a cluster of blobs. Terrain is a height field with a feature vector per patch (slippery, rough, sticky, steep).

```ts
type Blob = {
  pos: Vec3; radius: number; color: RGB;
  features: Float32Array;   // 16 named numbers, see below
  effects: Effect[];        // hidden from the creature
};
type Effect = { channel: ChannelId; amount: number; delay: number; duration: number };
```

**Features are named in version 1** so every belief stays readable: hue (6 bins), brightness, size, roundness, moving, sweet smell, rot smell, bitter smell, texture, warmth, and a few spare. Later they can be learned embeddings.

**Hidden rules** map features to effects, generated from a seed as Lodestone does (for example "sweet things feed, one shape of sweet thing poisons 30 s later"). A button reshuffles them without telling the creature.

**Effects can be multiple and delayed.** One food can give +energy now, +toxin after 30 s, and +intoxication for 60 s. This is what makes credit assignment (section 7.3) necessary.

### Where Gaussian splatting fits

A Gaussian splat scene is millions of soft coloured blobs, each with a position, shape, colour and opacity. That is the same shape as our world data, which is why the world is defined as blobs from day one.

| Your idea | Status in research | Use here |
|---|---|---|
| Splats in video, moving over time | Exists: Dynamic 3D Gaussians (2023), 4D Gaussian Splatting (2024). The flickering-fire capture is this | Later: animated scenery |
| Embeddings attached to splats so things are detectable | Exists: LangSplat, Feature 3DGS (2024) attach language/vision features to each splat | This is our sense of sight: the eye reads feature vectors off blobs |
| Manipulating splat objects with physics | Exists: PhysGaussian (2024) | Later |
| The world going wavy and colour-shifted | Easy with blobs: move and recolour them by a formula | Section 11 |

Version 1 renders our own procedural blobs with a soft-blob shader. Loading real captured splat scenes (through a three.js splat library such as Spark or GaussianSplats3D) is a later milestone, and needs a way to get a feature vector per splat.

---

## 5. Body

**Why a spider first.** Eight legs means it stands stably without learning balance, so learning can focus on *how to move well*. Losing a leg is a clear, visible test of adaptation. A hummingbird needs flight physics; it can reuse this same mind later with a different body and motor layer.

### 5.1 Channels (the biology)

```ts
type Channel = { level: number;   // 0..100
                 distress(level): number;   // steep near the bad end
                 base: Record };  // learned: what does just waiting do to this?
```

| Channel | Gets worse by | Gets better by |
|---|---|---|
| Energy | time, movement (fast gaits cost more) | food |
| Integrity | falls, hazards, bad food | slow healing |
| Toxin | some foods, after a delay | time |
| Fatigue | hard movement | resting |
| Leg health ×8 | damage (you can injure a leg) | slow healing or never |

Total distress is the sum over channels. The creature learns for each channel whether waiting makes it worse (hunger) or better (injury), exactly as Lodestone's `base` record does.

### 5.2 Modulators (mood)

Slow global dials computed from the channels and recent events. They do not hold beliefs; they change how the rest of the system runs.

| Modulator | Rises when | Changes |
|---|---|---|
| Arousal | sudden distress, looming objects | faster gait, less exploration of new gaits, shorter speech |
| Sickness | toxin high | slower gait, low body, little appetite, little speech |
| Intoxication | certain foods | noisy perception, noisy leg timing, altered view, odd word choice |
| Contentment | all channels comfortable | play: tries new gaits, explores, talks more |

The link from each modulator to gait numbers is a small table of gains. These gains start as instincts and are tuned by the same learning rule as gaits (section 10.4).

### 5.3 Physics model

One rigid body (position, rotation, velocity, spin) plus eight feet.

- A foot is either **planted** (stance) or **in the air** (swing).
- A planted foot is a spring between its foothold and its hip. The spring holds the body up and pushes it along.
- Grip is limited: sideways force above `friction × load` makes the foot **slip**.
- Leg health scales how hard a leg can push.
- Energy cost = work done by the legs + a cost per swing.

This is simplified physics, written by us, deterministic, and fast enough to run thousands of lives headless. It is enough for speed, turning, backing up, slipping, tipping and limping to come out of the leg numbers rather than being scripted. Legs are drawn with inverse kinematics. Full jointed-motor physics (Rapier) is an optional later upgrade.

---

## 6. Senses

| Sense | Reads | Gives the mind |
|---|---|---|
| Sight | blobs inside a forward cone, within range, not hidden | feature vector, direction, distance per blob |
| Smell | all nearby blobs, weighted by closeness | one blended smell vector, stronger = closer |
| Touch | each foot | planted or not, slip amount, ground features |
| Body feel | channels and their rates of change | "energy 42 and falling" |
| Body sense | leg phases, body speed, tilt | what the body actually did this bout |
| Hearing | your typed words | tokens (section 12) |

**Recognising things.** The mind keeps **prototypes**: a prototype is "a kind of thing I have met", stored as an average feature vector. A seen blob matches the nearest prototype if it is close enough, otherwise it becomes a new prototype. Prototypes play the role of Lodestone's "exact kind"; feature bins play the role of colour and shape.

---

## 7. Memory

### 7.1 The record

```ts
type Record = {
  n: number;        // how many experiences
  slow: number;     // long-run average: "what usually happens"
  fast: number;     // latest experience: "what just happened"
  spread: number;   // how much it normally varies
  dissent: number;  // how many times in a row fast and slow disagreed
  t: number;        // when last updated
  lag?: number;     // typical delay between cause and effect (new)
};
```

Update rule, ported directly from Lodestone's `observe`:

1. First experience: `slow = fast = observation`.
2. Otherwise set `fast = observation`. If `|fast − slow| > spread + margin`, add one to `dissent`, else reset it to zero.
3. Move `slow` and `spread` a step toward the new observation (step size shrinks as `n` grows, with a floor so it never stops moving).
4. If `dissent` reaches 2: **fold**. Reset the record to the new observation. If the record was well established, raise an **upheaval**: everything learned before now counts only as rumour.

### 7.2 What gets a record

| Record key | Belief | Example |
|---|---|---|
| prototype × channel | what this kind of thing does | "kind #4: energy +20" |
| feature bin × channel | what things with this feature do | "sweet smell: energy +14" |
| channel base | what waiting does | "energy: −0.3 per second" |
| skill × context × outcome | what this gait does here | "skill 7 on ice: 0.2 m/s forward, slips a lot" |
| place × channel | what this area does | "the wet corner: integrity −" |
| your words | what following you leads to | "doing what the voice said: distress went down" |

One experience touches many of these at once. Eating one berry updates the prototype record, a record per feature bin, the place record, and maybe the trust record, for every channel that moved.

### 7.3 Credit assignment: who caused this?

Immediate effects are easy: blame the thing just touched. Delayed effects need a short memory of recent suspects.

- Keep a **trace list**: the last things eaten or done, each with a strength that fades over a minute or so.
- When a channel changes by more than its base record predicts, that surplus is a **felt event**.
- Split the surplus among the traces, more to the recent and the unfamiliar.
- Each blamed record is updated, including its `lag`.

Wrong blame fixes itself: an innocent food gets blamed sometimes and not others, so its record becomes inconsistent (high `spread`) and loses voting weight. The true cause is blamed every time and becomes a confident record. Real animals do this; rats learn to avoid a taste after one sickness hours later (Garcia and Koelling, 1966).

### 7.4 Predicting by vote

To predict what a blob will do to a channel, the prototype record and each feature-bin record vote. As in Lodestone:

- weight = experience ÷ scatter, so consistent records count more
- records from before the last upheaval count only as rumour
- a feature that has never made a difference abstains
- there is always one standing vote for "nothing happens"
- **uncertainty** is high when the prototype is new and its least-known feature is unknown

This is how "a similar situation triggers a similar reaction": a new thing that shares features with an old one inherits the old one's expected effect, with honest uncertainty attached.

---

## 8. Instincts

| Instinct type | Implemented as | Example |
|---|---|---|
| Innate belief | a record filled in at birth, flagged as rumour | "sweet smell: energy +", "bitter smell: toxin +" |
| Innate reflex | fixed sense-to-motor rule with an adjustable gain | pain in a leg: lift it; foot slips: re-plant it |
| Innate gait | starting gait numbers | the alternating eight-leg walk |
| Innate mood link | starting modulator-to-gait gains | sick: move slower and lower |

Because innate beliefs are ordinary records, a world where sweet things are poison will overrule the instinct after two bad experiences.

---

## 9. Deciding what to do

Every candidate target gets a pull:

```
pull = ( expected distress removed            (from records, section 7.4)
       + CURIOSITY × uncertainty × urgency    (only if trying it is safe)
       + trust × instruction match            (if you asked for it, section 12)
       ) ÷ (1 + travel cost ÷ REACH)
```

Candidates are remembered blobs, unexplored directions, places not checked for a while, and "stay here and rest". Things expected to hurt push instead of pull. Travel cost comes from the creature's own gait records (how fast and how costly it currently moves), so an injured spider judges far things as farther.

The winning target becomes a **wanted motion**: a direction and speed in the body's frame, handed to the motor layer. The pull breakdown is stored each decision so the inspector and the speech system can show exactly why it chose what it chose.

---

## 10. Movement and motor learning

### 10.1 Pattern generator

Each leg has a clock. A gait is the set of numbers that drives the clocks:

| Numbers | Count |
|---|---|
| step frequency | 1 |
| share of the cycle each foot is planted | 1 |
| step height, body height | 2 |
| timing offset of each leg against leg 1 | 7 |
| stride direction and length per leg (2 numbers each) | 16 |

About 27 numbers. Real insects and spiders use circuits like this, called central pattern generators.

Walking backward is not programmed anywhere. It is simply the region of this number space where strides point the other way. Sideways walking, turning on the spot and limping gaits are other regions.

### 10.2 Skills and the repertoire

```ts
type Skill = {
  theta: Float32Array;                 // the ~27 gait numbers
  outcome: Map<ContextKey, {           // what it actually does, per context
    forward: Record; sideways: Record; turn: Record;
    energyPerSec: Record; slip: Record }>;
};
```

Context = ground features under the feet + which legs work + mood bins. Outcomes for an untried context are predicted by vote across similar contexts, as in section 7.4.

The repertoire is a grid of **niches**: 8 movement directions × 3 speeds, plus turn-left and turn-right in place. It keeps the best known skill per niche. Keeping skills because they are *different*, not only because they are better, is what lets backward and sideways gaits survive long enough to become useful. This is the "quality diversity" idea (MAP-Elites, Mouret and Clune 2015). A six-legged robot using a repertoire like this adapted to a broken leg in about two minutes (Cully et al., *Nature* 2015).

### 10.3 Choosing a skill

```
score = how well its predicted motion matches the wanted motion
      − energy cost − slip risk
      + curiosity × uncertainty about this skill here
```

Backing away from a threat wins over turning around when the records say backing is quicker. Nobody writes that rule.

### 10.4 Learning within a bout

Every 1 to 2 seconds of movement:

1. Run the chosen skill with a small random variation added to its numbers.
2. Measure the bout: progress along the wanted motion, energy spent, slipping.
3. Update the skill's outcome records for this context.
4. If the result beat the record's expectation by a clear margin, move the skill's numbers toward the variation. If the varied gait lands in a different niche and is the best there, save it as a new skill.
5. Grow the variation size when variations keep helping, shrink it when they keep hurting.

This is "the reaction was good, so make it more likely", applied to 27 named numbers with no network. The standard names are *evolution strategy* or *perturbation learning*.

### 10.5 Play, and what happens after injury

- **Play.** When content and safe, the creature tries larger variations on purpose. This fills the repertoire before it is needed, the way young animals do. When aroused or in need it uses what it knows.
- **Injury or new ground.** The current skill stops producing what its record predicted. The record dissents, folds, and uncertainty rises. Curiosity about gaits reopens automatically and the creature searches again, starting from skills whose records in similar contexts look best.

### 10.6 Reflexes

Fast fixed rules under the gait: re-plant a slipping foot, lift a hurting leg, freeze on a sudden looming shape, right the body when tilted. Their gains are tuned by the same bout rule.

---

## 11. Altered perception

Intoxication is a modulator from 0 to 1. One set of distortion functions feeds two places:

| Fed into | Effect |
|---|---|
| The creature's senses | hues rotate, sizes pulse, positions wobble. It can misrecognise things and mis-aim |
| The "creature's view" renderer | the same hue rotation and wobble applied to the blobs on screen, plus ground ripple |

Because both use the same functions, the wavy picture you see is a picture of what it is computing with, not decoration. Leg timing gets noisier and speech changes too. Records written while perception is noisy come out less consistent, so they carry less weight afterwards.

The inspector can show three views: the true world, the world as currently sensed, and the remembered map (what it believes is where, with unknown areas fogged).

---

## 12. Talking

No language model. The spider's life is small, so the language is small and every word is tied to something measurable.

### 12.1 Understanding you

- A **lexicon** of about 150 words, each mapped to a verb, a feature, a channel, or a place: `go`, `stop`, `eat`, `avoid`, `red`, `sweet`, `flower`, `hungry`, `why`, `how`.
- A simple pattern parser turns "go towards the red flower" into `{ approach, features: [red, flower] }`.
- An instruction is **not a command**. It becomes one more term in the pull formula, scaled by **trust**.
- **Trust is a record.** If following you reduced distress, your words pull harder next time. If you sent it to the flower that made it sick, they pull less.

So it can refuse, and the refusal has a readable reason: another pull was stronger.

### 12.2 Speaking

1. **What is sayable.** Each decision produces a list of facts with a salience: strongest need, current goal, last surprise, a belief that just folded, the reason an instruction lost.
2. **When.** It speaks on a surprise, a need crossing a threshold, a goal change, or a question.
3. **How.** A small grammar generates the sentence one token at a time. At each step the grammar lists the allowed next tokens and the creature's state sets their weights. That is the "sample what is possible in this moment" step, done with a grammar instead of a network.
4. **Mood.** Modulators change the weights: sick means short and flat, aroused means clipped, content means longer, intoxicated means loose word choice.

### 12.3 Explaining itself

"Why did you go there?" is answered from the stored pull breakdown: "Energy is low. Blue ones fed me seven times. The red one is closer but it made me sick." This is a true account, because the explanation and the decision are the same numbers.

### 12.4 Limits

It can only talk about its own world, with the words in its lexicon. Open conversation would need a language model; one could later be added as an interpreter that turns free text into the parser's structures, leaving the mind unchanged.

---

## 13. The inspector

| Panel | Shows |
|---|---|
| View switch | true world / as sensed / remembered map |
| Body | channel gauges, modulator dials, leg health |
| Pulls | top five pulls with each term of the formula |
| Beliefs | per prototype and per feature: expected effect on each channel, certainty bar, touched / inferred / instinct / rumour |
| Repertoire | the niche grid, coloured by quality, current skill highlighted, newly discovered skills flagged |
| Log | "what just changed its mind" |
| Chat | talk to it |
| Tools | add an object, reshuffle hidden rules, injure a leg, change ground to ice, wipe memory, speed, save or load a mind as JSON |

---

## 14. Stack and layout

TypeScript, Three.js, Vite, Vitest. No machine-learning libraries.

The rule that matters: **`core/` has no browser code and no randomness except a seeded generator.** The same mind runs in the browser to watch and in Node to run thousands of lives for experiments, with identical results.

```
src/
  core/
    rng.ts            seeded random numbers
    record.ts         the two-speed record and its update rule
    features.ts       feature vectors, bins, prototypes
    world.ts          terrain, blobs, effects, hidden rules
    body.ts           channels, modulators, legs
    physics.ts        rigid body and foot contact
    senses.ts
    beliefs.ts        vote prediction, trace list, credit assignment
    drives.ts         distress, pulls, goal
    motor/            cpg.ts, skills.ts, learn.ts, reflexes.ts
    language/         lexicon.ts, parse.ts, speak.ts
    creature.ts       wires the three loops together
  view/               scene, blob renderer and distortion shader, spider legs, inspector
  experiments/        headless runs and comparisons
tests/
docs/BLUEPRINT.md
reference/lodestone.html
```

---

## 15. Build order

Each milestone ends with something you can see and a test that can fail. Target numbers are goals to tune toward, not results.

| # | Build | You see | Test |
|---|---|---|---|
| 0 | Project scaffold, seeded RNG, `record.ts` ported from Lodestone | empty scene | unit tests: a record dissents, folds, and raises an upheaval on the same inputs as Lodestone |
| 1 | Terrain, rigid body, eight feet, pattern generator with the instinct gait, drawn legs | a spider walking | same seed gives the same path; steady forward speed |
| 2 | Bout learning, repertoire, play | repertoire grid filling in; it starts backing up and sidestepping | after play, backward and sideways niches are filled though never programmed; after losing a leg, forward speed recovers most of the way; a no-learning copy does not recover |
| 3 | Channels, blobs with hidden effects, prototypes, vote prediction, pulls | it forages, avoids, explores | survival curves over held-out seeds with a mid-life rule change, against no-generalising, no-dissent, greedy and random versions |
| 4 | Delayed and multiple effects, trace list | it gets sick, then avoids the cause | learns to avoid a food whose sickness arrives 30 s later within about three exposures; innocent foods are not avoided long-term |
| 5 | Modulators, intoxication, the three views | the world goes wavy from its point of view and its walking degrades | sensed features differ from true ones by the expected amount; behaviour recovers afterwards |
| 6 | Lexicon, parser, trust record, speech | you tell it to go somewhere; it goes, or refuses and says why | follows when no pull conflicts; refuses a target it learned is harmful; trust moves after good and bad advice |
| 7 | Inspector polish, save and load minds | full instrument panel | a saved mind reloads and behaves identically |
| 8 | Stretch: real splat scenes with features, hummingbird body, a second creature, jointed physics | | |

Milestones 2 and 3 are independent and can be built in either order. Milestone 2 carries the most risk, so it comes first.

---

## 16. Risks and open questions

1. **Noisy bouts.** A gait variation can look good because the ground happened to be easy. Mitigation: compare against the record for that context, require a margin, repeat before keeping.
2. **Simplified physics may be too forgiving or too harsh** for interesting gaits to appear. We find out in milestone 2; the fallback is jointed physics.
3. **Hand-made features.** The creature can only generalise along features we give it. This is the price of having no network.
4. **Tuning constants.** Lodestone has about ten hand-set constants; this will have several times that. Rule: tune on one set of seeds, report on another.
5. **Ambiguous blame.** When many things were eaten before a sickness, it needs more exposures to sort out the cause.
6. **Language is narrow by design.**
7. **What this is not.** The system shows behaviours associated with awareness: it monitors itself, is surprised, reports its own state. That is not evidence that it experiences anything, and the project should describe itself accordingly.

---

## 17. Where each idea shows up in a computer science degree

| Topic | Where it is used here |
|---|---|
| Data structures: arrays, maps, queues | record tables, trace list, path search |
| Statistics: averages, variance | every record; `spread` is a running variance-like measure |
| Linear algebra: vectors, dot products | feature similarity, physics, gait numbers |
| Physics: forces, torque, springs | the body |
| Calculus: derivatives, gradients | how neural networks learn; needed to understand the contrast in section 2.3 |
| Reinforcement learning (Sutton and Barto's textbook is free online) | pulls, credit assignment, exploration versus exploitation |
| Optimisation: evolution strategies | bout learning |
| Computer graphics: shaders | blob rendering, distortion |
| Parsing and grammars | the language layer |

Terms worth searching: homeostatic reinforcement learning, central pattern generator, eligibility trace, conditioned taste aversion, evolution strategy, MAP-Elites, change-point detection, feature 3D Gaussian splatting.
