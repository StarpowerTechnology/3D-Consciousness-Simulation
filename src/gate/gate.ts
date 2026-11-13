// THE GATE (blueprint 8.5, layer 3): every reply is checked before it is spoken.
// A discoverable world word can be produced only if it is in the creature's lexicon or was just said to it.
// The gate holds the world's vocabulary; the mind never sees it.

export interface GateResult { ok: boolean; text: string; offending: string[] }

export class Gate {
  violations: { t: number; text: string; offending: string[] }[] = [];
  constructor(private worldVocabulary: Set<string>) {}

  check(text: string, lexicon: Set<string>, heard: Set<string>, t = 0): GateResult {
    const words = text.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean);
    const offending = words.filter((w) => {
      const forms = [w, w.replace(/s$/, ''), w.replace(/es$/, ''), w + 's'];
      const isWorld = forms.some((f) => this.worldVocabulary.has(f));
      if (!isWorld) return false;
      return !forms.some((f) => lexicon.has(f) || heard.has(f));
    });
    if (offending.length) {
      this.violations.push({ t, text, offending });
      return { ok: false, text: 'hm .. nah never mind', offending };
    }
    return { ok: true, text, offending };
  }
}
