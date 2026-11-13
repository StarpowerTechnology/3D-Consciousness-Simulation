// INNATE VOCABULARY (blueprint 8.3): function words, body words, feelings, basic verbs and perceptual primitives.
// The creature can always describe what it measured with these. It can only NAME what it has named.

export interface ShapeWords { adj: string[]; noun: string; plural?: boolean; tail?: string }

export const LOOKS: Record<string, ShapeWords> = {
  round: { adj: ['round'], noun: 'thing' },
  round_flat: { adj: ['round', 'flat'], noun: 'thing' },
  oval_flat: { adj: ['round', 'flat'], noun: 'thing' },
  skinny_line: { adj: ['skinny'], noun: 'line' },
  thin_lines: { adj: ['thin'], noun: 'lines', plural: true },
  line: { adj: ['long'], noun: 'line' },
  thick_line: { adj: ['thick'], noun: 'line' },
  tall_branching: { adj: ['tall'], noun: 'thing', tail: 'with arms comin off it' },
  bushy: { adj: ['round', 'bushy'], noun: 'thing' },
  lumpy: { adj: ['lumpy'], noun: 'thing' },
  dome: { adj: ['round'], noun: 'top' },
  segmented: { adj: ['lil'], noun: 'thing', tail: 'made outta pieces' },
  pointy_lines: { adj: ['skinny', 'pointy'], noun: 'things', plural: true },
  flat_wide: { adj: ['flat', 'wide'], noun: 'thing' },
  tube_hollow: { adj: ['long', 'hollow'], noun: 'thing' },
  tiny_hairs: { adj: ['tiny'], noun: 'hairs', plural: true },
  flat_shiny: { adj: ['flat', 'shiny'], noun: 'thing' },
  furry_body: { adj: ['big', 'furry'], noun: 'thing' },
  dots: { adj: ['tiny'], noun: 'dots', plural: true },
  topped_stalk: { adj: ['skinny'], noun: 'thing', tail: 'with somethin bright on top' },
  flat_layers: { adj: ['flat'], noun: 'layers', plural: true },
};

export const RELATIONS: Record<string, (x: string) => string> = {
  runs_through: () => 'goin through it',
  branches_from: (x) => `comin off ${x}`,
  attached_to: (x) => `stuck on ${x}`,
  sticks_out_of: (x) => `stickin out the ${x === 'ground' ? 'ground' : x}`,
  on_top_of: (x) => (x === 'it' ? 'all on it' : `on top of ${x}`),
  inside: (x) => `inside ${x}`,
  touching: (x) => `layin on the ${x === 'ground' ? 'ground' : x}`,
  around: (x) => `all around ${x}`,
};

export const COLORS = ['green', 'brown', 'red', 'yellow', 'purple', 'white', 'black', 'gray', 'blue', 'orange'];
export const TEXTURE_WORDS: Record<string, string> = {
  smooth: 'smooth', rough: 'rough', fuzzy: 'fuzzy', shiny: 'shiny', wet: 'wet', hard: 'hard', soft: 'soft', rubbery: 'rubbery', firm: 'firm',
  juicy: 'juicy', damp: 'damp', cool: 'cool', cold: 'cold', warm: 'warm', tiny: 'tiny',
};

/** Words the creature is born with. Everything else must be discovered. */
export const INNATE_WORDS = new Set(
  `a an the this that these those it its im i me my you your u we they them em he she his her what whats where when why how who
   is are was were be been am got get gotta have has had do does did dont didnt aint idk not no nah yea yeah yes ok aight okay word
   and or but so if then like kinda lil little big tiny tall short long skinny thin thick flat round wide hollow lumpy bushy pointy
   furry shiny smooth rough fuzzy soft hard firm wet dry cold cool warm juicy damp rubbery juicy sweet bitter sour salty savory
   line lines thing things stuff pieces piece top bottom side middle inside outside around through off on in out of to from with
   up down over under by near here there everywhere somewhere ground sky light dark sun night day morning today yesterday earlier
   now just while ago bit before again too also still yet ever never always one two some all any more much lot lotta
   see saw seen look looked lookin looking watch watchin smell smelled smellin smells taste tasted tastes tastin feel felt feelin
   eat ate eatin drink drank hear heard hit hurt run ran call called name named remember forgot know knew think thought wonder
   want need tryna try find found go went goin come comin came stay sit lay layin sleep sleepin hide hidin give make made said say tell told
   hungry thirsty tired scared good bad nice gross okay fine happy sick hurt ow ooh oh hm hmm huh mm ayy yo hey hi bro
   head eye eyes ear ears nose mouth tongue leg legs paw paws tail body fur hair hairs belly back
   color colors red green brown yellow purple white black gray blue orange dots layers arms made outta sticking stickin
   going comin coming growin growing movin moving walkin flyin crawlin blowin wind wavin
   same different kind other another first last next real really very pretty mad lowkey highkey fr deadass for sure
   gonna wanna lemme imma ill youre theyre thats theres whos itd id ive youve isnt wasnt cant wont should could would might
   thank thanks friend place spot`.split(/\s+/).filter(Boolean),
);

export interface PartView {
  looks?: string;
  color?: string;
  relation?: string;
  relTo?: string; // already rendered: 'it', a name, or 'ground'
  name?: string;
}

/** A noun phrase from measured primitives: "a lil round green flat thing". */
export function describe(looks: string | undefined, color?: string, sizeWord?: string, article = true): string {
  const s = LOOKS[looks ?? 'lumpy'] ?? LOOKS.lumpy;
  const words: string[] = [];
  if (sizeWord && sizeWord !== 'big' && !s.adj.includes(sizeWord)) words.push(sizeWord);
  if (sizeWord === 'big' && !s.adj.includes('big')) words.push('big');
  words.push(...s.adj);
  if (color) words.push(color);
  words.push(s.noun);
  let out = words.join(' ');
  if (s.tail) out += ' ' + s.tail;
  if (!article) return out;
  if (s.plural) return `some ${out}`;
  return (/^[aeiou]/.test(out) ? 'an ' : 'a ') + out;
}

export function isPlural(looks?: string): boolean {
  return !!LOOKS[looks ?? '']?.plural;
}

/** "a skinny line goin through it", "thin lines comin off the skinny line" */
export function describePart(p: PartView, withArticle = true): string {
  const np = describe(p.looks, p.color === undefined ? undefined : undefined, undefined, withArticle);
  const rel = p.relation && RELATIONS[p.relation] ? ' ' + RELATIONS[p.relation](p.relTo ?? 'it') : '';
  return `${np}${rel}`;
}

export function relationPhrase(type: string | undefined, to: string): string {
  if (!type || !RELATIONS[type]) return '';
  return RELATIONS[type](to);
}
