// DIALOGUE (blueprint 10.3, 10.6): your words are a sound in the world; the answer is planned from memory only,
// then realized through the phrase bank. Detail follows measurement; time comes from the episode.
import type { Mind } from '../mind';
import type { Concept, Fact } from '../memory/memory';
import { wordForms } from '../memory/memory';
import { describe, isPlural, relationPhrase, TEXTURE_WORDS } from './innate';
import { timePhrase, listPhrase } from './voice';

const ART = '(?:a |an |the |some |them |those |these )?';
const W = '([a-z]+)';

function clean(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\bu\b/g, 'you')
    .replace(/\bur\b/g, 'your')
    .replace(/\bya\b/g, 'you')
    .replace(/\s+/g, ' ')
    .trim();
}

const stem = (w: string) => w.trim().split(' ').pop()!;

export class Dialogue {
  private lastUnknown: { word: string; on?: string } | null = null;
  private lastOffered: { part: Concept; word: string } | null = null;

  constructor(private m: Mind) {}

  private get v() { return this.m.voice; }
  private get mem() { return this.m.mem; }

  hear(raw: string, speaker: string, bearing: number): string | null {
    const s = clean(raw);
    if (!s) return null;
    void bearing;
    const tries: [RegExp, (g: string[]) => string | null][] = [
      [/^(?:yes|yea|yeah|yep|mhm|thats it|exactly|right)\b/, () => this.confirmOffer()],
      [/\b(?:my name is|im called|call me|i am|im) ([a-z]+)$/, (g) => this.nameMe(g[1], speaker)],
      [/\b(?:what is|whats) my name\b|\bwho am i\b|\bdo you know (?:who i am|my name)\b/, () => this.myName(speaker)],
      [new RegExp(`\\b(?:did you know|you know|guess what|fun fact)(?: that)? ${ART}${W} (?:have|has|got) ${ART}([a-z]+)(?: on (?:their|its|the|a|an|them) ([a-z]+))?`), (g) => this.claim(g[1], g[2], g[3])],
      [new RegExp(`\\b(?:what is|whats|what are|whatre) ${ART}([a-z]+) (?:on|of|in) ${ART}${W}`), (g) => this.askPart(g[1], g[2])],
      [new RegExp(`\\b(?:its|thats|it is|they are|theyre|its like|thats like) (?:something|the thing|a thing|the part|part of it|lines|the lines|a part)? ?(?:on|of|in|from) ${ART}${W}`), (g) => this.teach(g[1])],
      [new RegExp(`\\b(?:do you know|you know|ever seen|have you seen|did you see|you seen|you ever seen) (?:what )?${ART}${W}(?: is| are)?$`), (g) => this.askKnow(g[1])],
      [new RegExp(`\\bwhat (?:does|do|did) ${ART}${W} (taste|smell|feel) like`), (g) => this.askSense(g[1], g[2])],
      [new RegExp(`\\bwhere (?:is|are|did you see|did you find|you seen|was) ${ART}${W}`), (g) => this.askWhere(g[1])],
      [new RegExp(`\\b(?:does|do) ${ART}${W} look like anything|\\bwhat (?:does|do) ${ART}${W} look like`), (g) => this.askLooksLike(g[1] ?? g[2])],
      [new RegExp(`\\bdo you like ${ART}${W}`), (g) => this.askLike(g[1])],
      [/\bwhat (?:have|did|do) you (?:seen|see|find|found|notice|noticed|discover|discovered|learn|learned)\b|\bwhat you (?:seen|found)\b/, () => this.askSeen()],
      [/\bhow (?:are you|you doin|you doing|do you feel|you feel|are you feeling|you feelin)\b|\byou good\b|\byou ok\b/, () => this.askFeel()],
      [/\bwhat (?:are you|you|r you) (?:doin|doing|up to)\b/, () => this.askDoing()],
      [/\bwhy (?:did you|you|do you) (run|ran|flee|leave|move|jump|hide)/, () => this.askWhy()],
      [new RegExp(`\\b(?:what is|whats|what are|whatre|what) ${ART}${W}$`), (g) => this.askKnow(g[1])],
      [/^(?:hey|hi|yo|hello|wassup|sup|whats up|good morning|morning)\b/, () => this.greet(speaker)],
      [/\b(?:thanks|thank you|ty|cool|nice|ok|okay|aight|bet)\b/, () => this.v.move('THANKS', {})],
    ];
    for (const [re, fn] of tries) {
      const g = s.match(re);
      if (g) {
        const out = fn(g.map((x) => x ?? ''));
        if (out) return out;
      }
    }
    // a known name anywhere in the sentence: talk about it
    for (const w of s.split(' ')) {
      const c = this.mem.byWord(w);
      if (c && c.name) return this.askKnow(w);
    }
    return this.v.move('HUH', {});
  }

  // ---------------------------------------------------------------- answers

  /** "do you know what a leaf is?" — the answer's detail depends on how it met the thing. */
  askKnow(word: string): string | null {
    const w = stem(word);
    const c = this.mem.byWord(w);
    if (!c) {
      this.lastUnknown = { word: w };
      const told = this.mem.about('w:' + w);
      if (told.length) return this.v.join(this.v.move('UNKNOWN_WORD', { w }), 'you told me about it tho');
      return this.v.move('UNKNOWN_WORD', { w });
    }
    const label = c.name ?? w;
    const eps = this.mem.episodesOf(c.id).filter((e) => e.kind !== 'thought');
    const first = eps[0];
    const ep = eps.length && this.m.rng.chance(0.5) ? eps[eps.length - 1] : first;
    const now = this.m.stamp;
    const when = ep ? timePhrase(ep.stamp, now) : timePhrase(c.first, now);
    const whole = this.mem.wholesOf(c.id).find((k) => k.name);
    const saw = whole && this.m.rng.chance(0.7) ? this.v.move('SAW_EVENT_PART', { label, whole: whole.name, time: when }) : this.v.move('SAW_EVENT', { label, time: when });
    const details = this.detailsOf(c);
    const affirm = this.m.rng.chance(0.8) ? this.v.move('AFFIRM', {}) : null;
    if (!details.length) {
      const glance = c.maxAngle < 4 && !c.touched;
      return this.v.join(affirm, saw, glance && this.m.rng.chance(0.6) ? this.v.move('NO_DETAIL', {}) : null);
    }
    return this.v.join(affirm, saw, this.v.move('DETAILS', { details: listPhrase(details) }));
  }

  /** A sampled subset of what was actually measured: colour, parts with relations, feel, taste. */
  private detailsOf(c: Concept): string[] {
    const out: string[] = [];
    const color = this.mem.about(c.id, 'has_color').find((f) => this.mem.witnessed(f))?.o;
    if (color && this.m.rng.chance(0.85)) out.push(`its ${color}`);
    const parts = this.mem.partsOf(c.id).filter((p) => p.name);
    const shuffled = parts.sort(() => this.m.rng.next() - 0.5).slice(0, 2);
    for (const p of shuffled) {
      // prefer how the part sits on THIS thing; a relation learned on another kind of thing comes last
      const partIds = new Set(this.mem.partsOf(c.id).map((k) => k.id));
      const rank = (f: Fact) => (f.o === c.id ? 0 : partIds.has(f.o) ? 1 : 2);
      const rel = this.mem.about(p.id).filter((f) => f.r.startsWith('rel:') && rank(f) < 2).sort((a, b) => rank(a) - rank(b))[0];
      const relTo = rel ? (rel.o === c.id ? 'it' : rel.o === 'ground' ? 'ground' : 'the ' + (this.mem.concepts.get(rel.o)?.name ?? 'it')) : 'it';
      const plural = isPlural(p.props.looks) || p.name!.endsWith('s');
      const rp = rel ? ' ' + relationPhrase(rel.r.slice(4), relTo) : '';
      out.push(`${plural ? 'got' : 'got a'} ${p.name}${rp}`.replace('got a stem goin through it', 'got a stem goin through it'));
    }
    const tex = c.touch.texture && TEXTURE_WORDS[c.touch.texture];
    if (tex && this.m.rng.chance(0.7)) out.push(`it felt ${tex}`);
    const taste = this.mem.about(c.id, 'tastes')[0]?.o;
    if (taste && this.m.rng.chance(0.7)) out.push(`it taste ${taste}`);
    if (this.m.foodValue(c) > 0.2 && this.m.rng.chance(0.5)) out.push('its good to eat');
    if (this.m.harmValue(c) > 0.3) out.push('it hurt me');
    return out;
  }

  /** "what is a vein on a leaf?" */
  askPart(partWord: string, wholeWord: string): string | null {
    const pw = stem(partWord), ww = stem(wholeWord);
    const whole = this.mem.byWord(ww);
    const part = this.mem.byWord(pw);
    if (!whole) return this.v.move('WHOLE_UNKNOWN', { whole: ww });
    if (part && (this.mem.has(part.id, 'part_of', whole.id) || this.mem.partsOf(whole.id).includes(part))) {
      const rel = this.mem.about(part.id).find((f) => f.r.startsWith('rel:'));
      const relTo = rel ? (rel.o === whole.id ? 'the ' + whole.name : rel.o === 'ground' ? 'ground' : 'the ' + (this.mem.concepts.get(rel.o)?.name ?? whole.name)) : 'the ' + whole.name;
      const plural = isPlural(part.props.looks);
      const desc = (plural ? 'them ' : 'the ') + describe(part.props.looks, undefined, undefined, false) + (rel ? ' ' + relationPhrase(rel.r.slice(4), relTo) : '');
      return this.v.move('PART_EXPLAIN', { label: part.name, desc });
    }
    // it saw something there but never gave it a name
    const unnamed = this.mem.partsOf(whole.id).find((p) => !p.name);
    if (unnamed) {
      this.lastOffered = { part: unnamed, word: pw };
      const desc = describe(unnamed.props.looks, undefined, undefined, true);
      return this.v.move('PART_UNNAMED', { desc });
    }
    this.lastUnknown = { word: pw, on: whole.id };
    return this.v.move('PART_NOT_SEEN', { w: pw, whole: whole.name });
  }

  private confirmOffer(): string | null {
    if (!this.lastOffered) return null;
    const { part, word } = this.lastOffered;
    this.lastOffered = null;
    part.name = word;
    this.mem.remember(this.m.stamp, 'told', { concept: part.id, text: word });
    return this.v.join('oh word', `so thats a ${word}`);
  }

  /** "its something on a leaf" — told, not seen; it will look next time. */
  teach(onWord: string): string | null {
    if (!this.lastUnknown) return null;
    const ow = stem(onWord);
    const whole = this.mem.byWord(ow);
    const w = this.lastUnknown.word;
    this.mem.add('w:' + w, 'part_of', whole?.id ?? 'w:' + ow, 'told', this.m.t);
    this.mem.pendingChecks.push({ concept: whole?.id, word: ow, part: w, t: this.m.t });
    this.lastUnknown = null;
    if (!whole) return this.v.join(this.v.move('TEACH_ACK', {}), `i aint seen a ${ow} yet either`);
    return this.v.move('TEACH_ACK', {});
  }

  /** "did you know ants have hair on their legs?" */
  claim(subjWord: string, partWord: string, onWord?: string): string | null {
    const sw = stem(subjWord);
    const subj = this.mem.byWord(sw);
    if (!subj) return this.v.move('UNKNOWN_WORD', { w: sw });
    const target = onWord ? this.findPart(subj, onWord) ?? subj : subj;
    const part = this.findPart(target, partWord);
    if (part) {
      const f = this.mem.get(part.id, 'part_of', target.id);
      if (this.mem.witnessed(f) || this.m.noticed.size && f && !f.sources.has('told')) {
        const desc = describe(part.props.looks, undefined, undefined, false).replace(/^some /, '');
        return this.v.move('CLAIM_SEEN', { desc: 'lil ' + desc, part: onWord ? stem(onWord) : sw });
      }
    }
    // already told before?
    const key = 'w:' + stem(partWord);
    if (this.mem.facts.has(this.mem.key(key, 'part_of', target.id))) return this.v.move('CLAIM_TOLD', {});
    this.mem.add(key, 'part_of', target.id, 'told', this.m.t);
    this.mem.pendingChecks.push({ concept: target.id, word: sw, part: stem(partWord), t: this.m.t });
    if (onWord && target === subj) this.mem.pendingChecks.push({ concept: subj.id, word: sw, part: stem(onWord), t: this.m.t });
    return this.v.move('CLAIM_NOT_SEEN', {});
  }

  private findPart(whole: Concept, word: string): Concept | undefined {
    const forms = wordForms(stem(word));
    return this.mem.partsOf(whole.id).find((p) => (p.name && forms.includes(p.name)) || [...p.aliases].some((a) => forms.includes(a)));
  }

  askSense(word: string, sense: string): string | null {
    const c = this.mem.byWord(stem(word));
    if (!c) return this.v.move('UNKNOWN_WORD', { w: stem(word) });
    if (sense === 'taste') {
      const t = this.mem.about(c.id, 'tastes')[0]?.o;
      if (!t) return this.v.move('NEVER_TASTED', {});
      if (this.m.sickValue(c) > 0.2) return this.v.move('TASTE_ANS_SICK', { taste: t });
      if (this.m.foodValue(c) > 0.15) return this.v.move('TASTE_ANS_FOOD', { taste: t });
      return this.v.move('TASTE_ANS', { taste: t });
    }
    if (sense === 'feel') {
      const t = c.touch.texture && TEXTURE_WORDS[c.touch.texture];
      return t ? this.v.move('FEEL_TOUCH_ANS', { tex: t }) : this.v.move('NEVER_TOUCHED', {});
    }
    if (!c.smell) return 'idk i aint smelled it close';
    const dims = ['sweet', 'rotten', 'fresh', 'like dirt', 'like flowers', 'musky', 'sharp', 'wet'];
    const i = c.smell.indexOf(Math.max(...c.smell));
    return this.v.move('SMELL_ANS', { smell: dims[i] });
  }

  askWhere(word: string): string | null {
    const c = this.mem.byWord(stem(word));
    if (!c) return this.v.move('UNKNOWN_WORD', { w: stem(word) });
    const s = c.sightings[c.sightings.length - 1];
    if (!s) return this.v.move('WHERE_UNKNOWN', {});
    let best: Concept | undefined, bd = 3;
    for (const k of this.mem.concepts.values()) {
      if (k === c || !k.name || k.isPart) continue;
      for (const q of k.sightings) {
        const d = Math.hypot(q.x - s.x, q.z - s.z);
        if (d < bd) { bd = d; best = k; }
      }
    }
    return best ? this.v.move('WHERE_ANS', { landmark: best.name }) : this.v.move('WHERE_UNKNOWN', {});
  }

  /** Structural comparison (blueprint 8.2): shared measured parts and relations. */
  askLooksLike(word: string): string | null {
    const c = this.mem.byWord(stem(word));
    if (!c) return this.v.move('UNKNOWN_WORD', { w: stem(word) });
    const motif = (k: Concept) => {
      const out = new Set<string>();
      for (const f of this.mem.about(k.id)) if (f.r.startsWith('rel:') && this.mem.witnessed(f)) out.add(`${f.r}:${f.o === 'ground' ? 'ground' : 'x'}`);
      for (const p of this.mem.partsOf(k.id)) {
        for (const f of this.mem.about(p.id)) if (f.r.startsWith('rel:')) out.add(`part:${p.props.looks}:${f.r}`);
        if (p.props.looks) out.add(`part:${p.props.looks}`);
      }
      if (k.props.color) out.add('color:' + k.props.color);
      return out;
    };
    const mine = motif(c);
    let best: Concept | undefined, bs = 0, shared: string[] = [];
    for (const k of this.mem.concepts.values()) {
      if (k === c || !k.name || k.isPart !== c.isPart) continue;
      const theirs = motif(k);
      const sh = [...mine].filter((x) => theirs.has(x));
      if (sh.length > bs) { bs = sh.length; best = k; shared = sh; }
    }
    if (!best || bs < 1) return this.v.move('LOOKS_LIKE_NONE', {});
    const words: string[] = [];
    for (const s of shared) {
      if (s.startsWith('rel:sticks_out_of:ground')) words.push('stickin out the ground');
      else if (s.startsWith('part:') && s.split(':').length === 2) {
        const l = s.split(':')[1];
        if (l === 'oval_flat') words.push('got leafs on it');
        else words.push(`got ${describe(l, undefined, undefined, true)}`);
      } else if (s.startsWith('color:')) words.push(`both ${s.slice(6)}`);
    }
    const uniq = [...new Set(words)].slice(0, 2);
    return this.v.move('LOOKS_LIKE', { other: best.name, shared: uniq.length ? 'it ' + listPhrase(uniq) : 'they kinda the same' });
  }

  askLike(word: string): string | null {
    const c = this.mem.byWord(stem(word));
    if (!c) return this.v.move('UNKNOWN_WORD', { w: stem(word) });
    if (this.m.foodValue(c) > 0.15) return this.v.move('LIKE_YES', { label: c.name });
    if (this.m.harmValue(c) > 0.2 || this.m.sickValue(c) > 0.2) return this.v.move('LIKE_NO', { label: c.name });
    return this.v.move('LIKE_UNKNOWN', {});
  }

  askSeen(): string | null {
    const named = this.mem.named().filter((c) => !c.isPart || this.m.rng.chance(0.4));
    if (!named.length) return this.v.move('SEEN_NOTHING', {});
    const pick = named.sort((a, b) => b.last.t + b.familiarity * 10 - (a.last.t + a.familiarity * 10) + (this.m.rng.next() - 0.5) * 60).slice(0, 4);
    const items = pick.map((c) => (isPlural(c.props.looks) || c.name!.endsWith('s') ? `some ${c.name}` : `a ${c.name}`));
    return this.v.move('SEEN_LIST', { list: listPhrase(items) });
  }

  askFeel(): string | null {
    const d = this.m.drives, f = this.m.frame.body, fl = this.m.feelings;
    const states: string[] = [];
    if (f.pain > 0.2) states.push('hurtin a lil');
    if (f.nausea > 0.2) states.push('kinda sick');
    if (d.hunger > 0.5) states.push('hungry');
    if (d.thirst > 0.5) states.push('thirsty');
    if (d.rest > 0.6) states.push('tired');
    if (fl.fear > 0.4) states.push('kinda scared');
    if (!states.length) states.push(fl.curiosity > 0.5 ? 'good .. just lookin at stuff' : 'good');
    return this.v.move('FEEL_ANS', { state: listPhrase(states.slice(0, 2)) });
  }

  askDoing(): string | null {
    const b = this.m.behavior;
    const t = b.target ? this.m.conceptOfNode(b.target) : undefined;
    const map: Record<string, string> = {
      wander: 'lookin around', inspect: t?.name ? `checkin out this ${t.name}` : 'checkin this out', taste: 'tryna see if i can eat this', eat: 'eatin',
      drink: 'gettin a drink', seek: b.data.want === 'food' ? 'lookin for somethin to eat' : 'lookin for somethin to drink', follow_smell: 'followin a smell',
      flee: 'gettin away', freeze: 'stayin still', rest: 'restin', sleep: 'sleepin', listen: 'listenin to you', shelter: 'goin somewhere safe',
    };
    return this.v.move('DOING_ANS', { doing: map[b.name] ?? 'just chillin' });
  }

  askWhy(): string | null {
    const fled = [...this.mem.episodes].reverse().find((e) => e.kind === 'fled');
    const c = fled?.concept ? this.mem.concepts.get(fled.concept) : undefined;
    if (c?.name && this.m.harmValue(c) > 0.1) return this.v.move('WHY_FLED', { label: c.name });
    const hurt = [...this.mem.episodes].reverse().find((e) => e.kind === 'hurt' && e.concept);
    const hc = hurt?.concept ? this.mem.concepts.get(hurt.concept) : undefined;
    if (hc?.name) return this.v.move('WHY_FLED', { label: hc.name });
    return this.v.move('WHY_UNKNOWN', {});
  }

  private speakerConcept(speaker: string): Concept | undefined {
    return this.m.conceptOfNode(speaker);
  }

  greet(speaker: string): string | null {
    const c = this.speakerConcept(speaker);
    const n = this.mem.about('speaker:' + speaker, 'named')[0]?.o;
    if (n) return this.v.move('GREET_NAME', { name: n });
    void c;
    return this.v.move('GREET', {});
  }

  nameMe(name: string, speaker: string): string | null {
    if (['hungry', 'tired', 'good', 'ok', 'fine', 'here', 'back', 'not', 'just'].includes(name)) return null;
    for (const f of this.mem.about('speaker:' + speaker, 'named')) this.mem.facts.delete(this.mem.key(f.s, f.r, f.o));
    this.mem.add('speaker:' + speaker, 'named', name, 'told', this.m.t);
    const c = this.speakerConcept(speaker);
    if (c) c.aliases.add(name);
    return this.v.move('NAME_ACK', { name });
  }

  myName(speaker: string): string | null {
    const n = this.mem.about('speaker:' + speaker, 'named')[0]?.o;
    return n ? this.v.move('YOUR_NAME', { name: n }) : this.v.move('NO_NAME', {});
  }
}

export type { Fact };
