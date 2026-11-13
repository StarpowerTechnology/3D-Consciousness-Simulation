// PHRASE BANK (blueprint 10.4). Each intent is a sequence of moves; each move has many phrasings,
// some tied to a mood. Slots in {braces} are filled only from the creature's own memory.

export type Bank = Record<string, Record<string, string[]>>; // move → mood|any → variants

export const BANK: Bank = {
  // ---------------------------------------------------------------- noticing and naming
  WONDER: {
    any: ['what is this?', 'hm whats that', 'i never seen this before', 'hold on .. whats this', 'ooh whats this right here', 'wait what is that', 'huh .. whats this thing', 'yo whats this'],
    scared: ['wait .. what is that', 'uh .. whats that'],
    curious: ['this look interesting', 'ooh this look interesting', 'what we got here'],
  },
  LOOK_CLOSE: {
    any: ['im tryna really see what this is', 'lemme get a better look', 'lemme look real close', 'i gotta see this up close'],
  },
  DESCRIBE: {
    any: ['its like {desc}', 'its {desc}', 'look like {desc}', 'kinda like {desc}', 'it got a shape like {desc}'],
  },
  DESCRIBE_PARTS: {
    any: ['with {parts}', 'and it got {parts}', 'and theres {parts}'],
  },
  DECIDE_NAME: {
    any: [
      'i should give it a name so if i see it again ill remember it', 'lemme name it so i dont forget', 'it need a name', 'i gotta call it somethin',
      'imma name it so i remember', 'i need a name for this',
    ],
  },
  COMMIT: {
    any: ['ill call this combination a {label}', 'ill call it a {label}', 'this a {label}', '{label} .. yea thats what im callin it', 'imma call it a {label}', 'its a {label}', 'ill call this a {label}'],
  },
  COMMIT_PLURAL: {
    any: ['ill call em {label}', 'imma call them {label}', 'them is {label}', '{label} .. thats what they are'],
  },
  COMMIT_PART: {
    any: ['ill call the {desc} a {label}', 'the {desc} .. thats a {label}', 'and the {desc} a {label}', 'that {desc} a {label}'],
  },
  COMMIT_PART_PLURAL: {
    any: ['and them {desc} {label}', 'ill call the {desc} {label}', 'the {desc} .. those {label}', 'them {desc} is {label}'],
  },
  COMPARE: {
    any: ['its the same color as the {ref} .. so its {color}', 'same color as the {ref} .. {color}', 'it be {color} like the {ref}', '{color} .. like the {ref}'],
  },
  NEW_COLOR: {
    any: ['its {color}', 'thats {color}', 'its all {color}'],
  },
  NOTICE_DETAIL: {
    any: ['oh it got {desc} {rel}', 'ooh theres {desc} {rel}', 'wait it got {desc} {rel}', 'look at that .. {desc} {rel}', 'hm {desc} {rel}'],
  },
  NOTICE_NAME: {
    any: ['ill call that a {label}', 'thats a {label}', 'call it a {label}'],
  },
  NOTICE_NAME_PLURAL: {
    any: ['ill call em {label}', 'thats {label}', 'them is {label}'],
  },
  RECOGNIZE: {
    any: ['thats a {label} again', 'oh another {label}', 'a {label}', 'theres a {label}', 'oh thats a {label}', 'i seen these before .. {label}'],
    scared: ['thats a {label} .. careful'],
  },
  UNNAMED_AGAIN: {
    any: ['i seen this before but idk what it is', 'this again .. i never named it', 'i know this thing but i aint got a name for it'],
  },
  REFINE: {
    any: ['oh it aint just a {coarse} .. its a {label}', 'wait this a {label} .. a kind of {coarse}', 'up close its a {label} .. thats a {coarse} kind'],
  },
  FEEL: {
    any: ['it feel {tex}', 'its {tex}', 'feel kinda {tex}', 'ooh {tex}'],
  },
  // ---------------------------------------------------------------- body and feelings
  PAIN: { any: ['ow', 'ow ow', 'ouch', 'aah', 'ow what was that'] },
  PAIN_CAUSE: { any: ['that {label} hit me', 'a {label} fell on me', 'that {label} hurt'] },
  THREAT: {
    any: ['nah thats the thing that hit me', 'nope .. {label}', 'i aint tryna get hit again', 'move move', 'not again', 'nah not that {label}'],
  },
  DODGE_OK: { any: ['phew', 'missed me', 'ha not this time', 'almost got me'] },
  STARTLE: { any: ['whoa', 'what was that', 'huh?', 'eek'] },
  HUNGRY: { any: ['im gettin hungry', 'my belly empty', 'i need somethin to eat', 'im hungry', 'i could eat'] },
  STARVING: { any: ['im so hungry', 'i really gotta eat', 'i need food bad'] },
  THIRSTY: { any: ['im thirsty .. i need some {label}', 'i need some {label}', 'my mouth dry .. where the {label} at'] },
  THIRSTY_UNKNOWN: { any: ['im thirsty', 'my mouth dry', 'i need somethin to drink'] },
  TIRED: { any: ['im gettin tired', 'im sleepy', 'i need to lay down'] },
  COLD: { any: ['its cold', 'im cold', 'brr'] },
  SATISFIED: { any: ['that hit the spot', 'mm thats better', 'ok im good now', 'that filled me up'] },
  QUENCHED: { any: ['ahh thats better', 'mm thats nice', 'ok not thirsty no more'] },
  SICK: { any: ['i dont feel good', 'my belly feel weird', 'ugh somethin i ate', 'i feel sick'] },
  SICK_CAUSE: { any: ['it was that {label}', 'that {label} made me sick', 'i aint eatin no {label} again'] },
  // ---------------------------------------------------------------- tasting
  LICK: { any: ['lemme taste it', 'lemme try it', 'i wonder if i can eat this', 'is this food?'] },
  TASTE_GOOD: { any: ['mm {taste}', 'ooh thats {taste}', 'that taste good', 'mm thats nice'] },
  TASTE_BAD: { any: ['ew {taste}', 'yuck', 'nah thats {taste}', 'bleh'] },
  TASTE_MEH: { any: ['hm dont taste like much', 'meh', 'not much taste'] },
  // ---------------------------------------------------------------- smell and recall
  SMELL_GOOD: { any: ['mm that smells good', 'ooh i smell somethin good', 'that smell good', 'mm somethin smell sweet'] },
  SMELL_RECALL: {
    any: ['i smell them {label} .. where they at', 'thats {label} i smell', 'smell like {label} round here', 'i know that smell .. {label}'],
  },
  SMELL_BAD: { any: ['that smell like {label} .. nah', 'i smell {label} .. i aint eatin that'] },
  SMELL_NEW: { any: ['what is that smell', 'hm somethin smell different', 'i smell somethin'] },
  HEAR_NEW: { any: ['what was that sound', 'you hear that?', 'hm what was that'] },
  IDLE_RECALL: {
    any: ['them {label} was good tho', 'i remember that {label}', 'i wonder where them {label} at', 'that {label} earlier was somethin'],
  },
  IDLE_HARM: { any: ['that {label} hit me earlier', 'i gotta watch out for {label}'] },
  CONFLICT: { any: ['should i go closer ..', 'hmm ..', 'idk about this', 'should i?'] },
  CHECK_TOLD: { any: ['lemme check if it really got {part}', 'you said it got {part} .. lemme see'] },
  TOLD_CONFIRMED: {
    any: ['oh you was right .. they do got {part}', 'ayy it really do got {part}', 'yup .. {part} .. you was right', 'i see the {part} now .. you was right'],
  },
  SHELTER: { any: ['its gettin dark', 'i should find somewhere to hide', 'i need somewhere safe'] },
  SLEEP: { any: ['night', 'imma sleep', 'im finna sleep'] },
  WAKE: { any: ['mm im up', 'mornin', 'ok im awake'] },

  // ---------------------------------------------------------------- answering
  AFFIRM: { any: ['yea', 'yea bro', 'yup', 'oh yea', 'yea i know', 'mhm'] },
  SAW_EVENT: {
    any: ['i saw a {label} {time}', 'i seen a {label} {time}', 'i saw one {time}', 'i found a {label} {time}', 'there was a {label} {time}'],
  },
  SAW_EVENT_PART: { any: ['i saw a {label} on a {whole} {time}', 'i seen a {label} on a {whole} {time}'] },
  DETAILS: { any: ['{details}', 'and i noticed {details}', 'i noticed {details}', '{details} too'] },
  NO_DETAIL: { any: ['i aint look at it that close tho', 'i aint get a real good look', 'i only seen it from far'] },
  UNKNOWN_WORD: {
    any: ['whats a {w}?', 'idk what a {w} is', 'i aint seen no {w}', 'a {w}? i never seen that', 'never heard of a {w}', 'i dont know what a {w} is .. i aint seen one'],
  },
  PART_EXPLAIN: {
    any: ['the {label} is {desc}', '{label} is {desc}', 'its {desc}', 'them {label} is {desc}'],
  },
  PART_UNNAMED: { any: ['i seen {desc} on it .. that what you mean?', 'there was {desc} on it .. is that it?'] },
  PART_NOT_SEEN: {
    any: ['i didnt notice that', 'i aint notice nothin like that on a {whole}', 'whats a {w}?', 'i never seen that before .. what is it', 'i aint seen no {w} on a {whole}'],
  },
  WHOLE_UNKNOWN: { any: ['i dont even know what a {whole} is', 'a {whole}? i aint seen one'] },
  TEACH_ACK: { any: ['oh word .. imma look next time i see one', 'aight ill look for it', 'oh fr? ill check', 'hm ok ill see if thats true'] },
  CLAIM_NOT_SEEN: { any: ['nah i havent seen that yet', 'for real? i aint seen that', 'nah i never noticed that', 'i aint seen that yet'] },
  CLAIM_TOLD: { any: ['you told me that .. i still aint seen it myself', 'yea you said that .. i aint seen it yet tho'] },
  CLAIM_SEEN: { any: ['yea i seen it .. {desc} all on the {part}', 'yea i noticed that .. {desc}', 'yup i seen {desc} on there'] },
  SEEN_LIST: { any: ['i seen {list}', 'umm {list}', 'lotta stuff .. {list}', 'i found {list}'] },
  SEEN_NOTHING: { any: ['not much yet', 'nothin really', 'i aint seen nothin yet'] },
  FEEL_ANS: { any: ['im {state}', 'kinda {state}', 'honestly {state}', '{state}'] },
  DOING_ANS: { any: ['{doing}', 'just {doing}', 'im {doing}'] },
  WHY_FLED: { any: ['that {label} hit me before .. i aint tryna get hurt again', 'cuz {label} hurt me last time', 'i got hit by a {label} .. i aint playin'] },
  WHY_UNKNOWN: { any: ['idk i just did', 'i aint even know', 'idk'] },
  LIKE_YES: { any: ['yea they good', 'yea i like {label}', 'mhm {label} good'] },
  LIKE_NO: { any: ['nah', 'nah {label} bad news', 'nah i dont like {label}'] },
  LIKE_UNKNOWN: { any: ['idk i never tried it', 'idk', 'i aint sure yet'] },
  TASTE_ANS: { any: ['{taste}', 'it taste {taste}', 'kinda {taste}'] },
  TASTE_ANS_FOOD: { any: ['{taste} .. it filled me up', '{taste} .. good to eat'] },
  TASTE_ANS_SICK: { any: ['{taste} .. but it made me sick'] },
  NEVER_TASTED: { any: ['idk i never tasted one', 'i aint tried it'] },
  SMELL_ANS: { any: ['it smell {smell}', 'kinda {smell}'] },
  FEEL_TOUCH_ANS: { any: ['it feel {tex}', 'its {tex}'] },
  NEVER_TOUCHED: { any: ['i aint touched one', 'idk i never touched it'] },
  WHERE_ANS: { any: ['over by the {landmark}', 'by the {landmark}', 'near the {landmark}', 'round the {landmark}'] },
  WHERE_UNKNOWN: { any: ['somewhere round here', 'idk i forgot where'] },
  LOOKS_LIKE: { any: ['kinda like a {other} .. {shared}', 'a {other} kinda .. {shared}', 'a lil like a {other} .. {shared}'] },
  LOOKS_LIKE_NONE: { any: ['nah not really', 'it dont look like nothin else i seen'] },
  GREET: { any: ['hey', 'yo', 'hi', 'wassup'] },
  GREET_NAME: { any: ['hey {name}', 'yo {name}', 'wassup {name}'] },
  NAME_ACK: { any: ['aight {name} .. ill remember that', 'ok {name}', '{name} .. got it'] },
  YOUR_NAME: { any: ['you {name}', 'thats {name}', 'youre {name}'] },
  NO_NAME: { any: ['idk you aint told me', 'you aint said'] },
  HUH: { any: ['huh?', 'wdym', 'i dont get it', 'what?', 'hm?'] },
  THANKS: { any: ['oh word', 'ok', 'aight'] },
  BUSY: { any: ['not now', 'hold on', 'wait'] },
};
