import englishWords from "an-array-of-english-words";

const STARTER_WORDS = `
able about above abuse actor adapt admit adopt adult after again agent agree ahead alarm album alert alien align alike alive allow alone along alter among angel anger angle angry apart apple apply arena argue arise array aside asset audio avoid award aware awful
beach began begin begun being below bench birth black blame blank blast blend bless blind block blood bloom board boost booth bound brain brand brave bread break brick brief bring broad broke brown brush build bunch burst buyer
cabin cable camera camp canal carry catch cause chain chair charm chart chase cheap check chest chief child chill china claim class clean clear clerk clock close cloth cloud coach coast could count court cover craft crash cream crime cross crowd crown crude curve cycle
daily dance dated dealt death debut decade delay depth devil diary dirty doubt dozen draft drama dream dress drink drive drove dying
eager early earth eight elder elect elite empty enemy enjoy enter entry equal error event every exact exist extra
faith false fancy fault favor feast fence fewer fiber field fifth fifty fight final first fixed flame flash fleet floor focus force forth forty found frame fresh front fruit fully funny
giant given glass globe glory going grace grade grain grand grant grass great green greet grief gross group grown guard guess guest guide guilt
habit happy heart heavy hello hence honey horse hotel house human ideal image index inner input issue joint judge known label labor large laser later laugh layer learn least leave legal level light limit local logic loose lower lucky lunch lying
magic major maker march match maybe mayor meant media metal might minor minus model money month moral motor mount mouse mouth movie music
naked named nation native naval newly night noble noise north noted novel nurse occur ocean offer often order other ought owner paint panel paper party peace phase phone photo piece pilot pitch place plain plane plant plate point pound power press price pride prime print prior prize proof proud prove proxy pulse punch queen quick quiet quite quote
radio raise range rapid ratio reach react ready refer right rival river rough round route royal ruler rural scale scene scope score sense serve seven shade shake shall shame shape share sharp sheet shelf shell shift shine shirt shock shoot short shown sight since skill sleep slice slide slope small smart smell smile smoke solid solve sorry sound south space spare speak speed spend spent spice spicy split spoke sport staff stage stand start state steam steel stick still stock stone stood store storm story strip stuck study stuff style sugar suite super sweet table taken taste teach thank their theme there these thick thing think third those three threw throw tight times tired title today token topic total touch tough tower track trade train treat trend trial tribe trick tried truck truly trust truth twice under union unity until upper upset urban usage useful usual valid value video visit vital vivid voice waste watch water wheel where which while white whole whose woman women world worry worth would write wrong wrote
`;

export const LINKUP_WORDS = new Set([
  ...englishWords.filter((word) => /^[a-z]{3,15}$/.test(word)),
  ...STARTER_WORDS.trim().toLowerCase().split(/\s+/),
]);
