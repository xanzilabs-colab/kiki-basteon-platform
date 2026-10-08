// Kiki's local knowledge map.
// Data-first on purpose: plain strings make it easy to tune without code changes.

export type SenseKey = "see" | "feel" | "hear" | "smell" | "taste";
export const SETTINGS = [
  { id: "bedroom", name: "Bedroom", icon: "BedDouble", words: ["bedroom", "room", "bed", "sleeping"] },
  { id: "living", name: "Living room", icon: "Sofa", words: ["living", "lounge", "sitting room", "couch", "sofa", "tv room", "family room"] },
  { id: "kitchen", name: "Kitchen", icon: "CookingPot", words: ["kitchen", "cooking"] },
  { id: "library", name: "Library", icon: "Library", words: ["library", "study", "reading"] },
  { id: "classroom", name: "School or class", icon: "GraduationCap", words: ["class", "school", "lecture", "office", "campus", "university", "varsity"] },
  { id: "car", name: "Car or taxi", icon: "Car", words: ["car", "taxi", "bus", "train", "driving", "uber", "minibus", "kombi"] },
  { id: "outside", name: "Outside", icon: "Trees", words: ["outside", "garden", "yard", "park", "street", "road", "stoep", "outdoor", "balcony", "field", "bench"] },
] as const;
export type SettingId = (typeof SETTINGS)[number]["id"];

export type Entry = { label: string; w: number; alias: string[]; when?: "day" | "night" };
function P(list: string): Entry[] {
  return list.split(",").map((raw) => {
    const m = raw.trim().match(/^(.*?):(\d+)(?:@(day|night))?((?:\/[^/]+)*)$/);
    if (!m) return { label: raw.trim(), w: 5, alias: [] };
    return { label: m[1], w: Number(m[2]), alias: m[4].split("/").filter(Boolean), when: m[3] as Entry["when"] };
  });
}
const T = (o: Record<string, string>): Partial<Record<SenseKey, Entry[]>> => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, P(v)]));

export const THINGS: Record<SettingId, Partial<Record<SenseKey, Entry[]>>> = {
  bedroom: T({
    see: "bed:9/mattress,pillow:8/pillows,blanket:7/duvet,curtain:7/curtains,window:6,wardrobe:6/closet,lamp:6,phone:7,mirror:6,book:5,charger:5/cable,body lotion:5/lotion,body spray:5/spray,perfume:5",
    feel: "blanket:8,bed:8,pillow:7,phone:6,clothes:6,carpet:4/rug,lotion bottle:5,book:4,air:4",
    hear: "traffic:6/cars,fan:6/ceiling fan,music:6/song/radio,voices:6/talking,tv:5,load shedding silence:5/silence/quiet,dog:4,birds:4@day,crickets:4@night,my breathing:5",
    smell: "perfume:8,body lotion:8/lotion,body spray:7/deodorant,shampoo:6,hair oil:5,vaseline:5,fabric softener:6/softener,laundry:6,orange peel:5,banana:4,guava:4,old books:3",
  }),
  living: T({
    see: "tv:9/television,couch:9/sofa,coffee table:7/table,curtains:6,plant:6,remote:6,bookshelf:6,speaker:5,window:6,phone:6,dog:4",
    feel: "couch:8/sofa,cushion:7,blanket:6,remote:6,phone:6,mug:5,table:5,floor:4",
    hear: "tv:8/television,voices:7,talking:7,music:6/song,fridge hum:4,fan:4,traffic:6,dog barking:4,kettle:4,children playing:4",
    smell: "coffee:6,tea:5,cooking:6,candle:4,air freshener:5,furniture polish:4,braai smoke:5,room spray:4",
  }),
  kitchen: T({
    see: "fridge:9/refrigerator,stove:9/oven,cupboard:8,counter:8,microwave:7,kettle:7,pot:6/pan,sink:7,tap:6,mug:6,bread:5,fruit bowl:6",
    feel: "counter:8,floor tile:6,kettle:5,mug:6,tap water:6,towel:4,pot handle:4,warm plate:4",
    hear: "kettle:8,fridge hum:8,sizzling:7,cutting board taps:5,water running:7,microwave beep:6,radio:5,music:5",
    smell: "coffee:7,rooibos tea:6/tea,braai smoke:7,boerewors:6,pap:6,vetkoek:5,onion:5,garlic:5,spice:6,curry:5,dish soap:5/sunlight soap/handy andy",
  }),
  library: T({
    see: "books:10/book,shelf:9/bookshelf,desk:7,chair:7,lamp:6,window:5,librarian:4,notebook:5,pen:5,computer:5",
    feel: "book:9,page:8,paper:7,desk:7,chair:6,pen:6,keyboard:5",
    hear: "whispering:8/voices,page turning:7,typing:6,footsteps:6,silence:7,aircon:5,chair scrape:4,cough:4",
    smell: "old paper:9/books,musty books:8,dust:6,cleaner:4,coffee:4",
  }),
  classroom: T({
    see: "whiteboard:9/board,desk:9,chair:8,teacher:7,book:7,window:6,clock:6,bag:6,pen:6,poster:5",
    feel: "pen:7,paper:7,desk:8,chair:7,bag:5,uniform:5",
    hear: "teacher voice:8/teacher,voices:8,talking:8,school bell:6,chair scrape:6,pencil writing:5,music from phone:4,laughing:5",
    smell: "marker:5/chalk,paper:4,cleaner:4,perfume:4,deodorant:4,lunch food:4",
  }),
  car: T({
    see: "dashboard:8,steering wheel:8,windscreen:7,traffic lights:6,other cars:8,driver:6,seatbelt:6,rear mirror:5,minibus taxi:5",
    feel: "seat:8,seatbelt:7,steering wheel:7,vibration:7,phone:5,aircon breeze:6,bag:4",
    hear: "engine hum:9,traffic:9,minibus taxi hooting:8/hoot/horn,taxi conductor calling:6,radio music:7,indicator tick:6,road rumble:6,wind noise:5,load shedding silence:3",
    smell: "fuel:8/petrol/diesel,air freshener:6,new car smell:5,food takeaway:4,perfume:4",
  }),
  outside: T({
    see: "trees:9,grass:8,sky:9,clouds:8,birds:8,dog:5,people:6,houses:6,streetlight:5@night,moon:6@night,stars:6@night,sun:8@day",
    feel: "wind:8,breeze:8,sun warmth:7@day,cool air:6@night,grass:6,ground:6,bench:4",
    hear: "birds:9@day,wind:8,traffic:7,voices:6,dog barking:6,children:5,music:4,crickets:7@night,generator hum:5/load shedding",
    smell: "grass:8,wet soil:7/rain/earth,flowers:6,braai smoke:7,exhaust:6,spaza food:5/fried dough/vetkoek,sea air:3",
  }),
};

export const TASTES: Entry[] = P("rooibos tea:9/tea,coffee:8,mint:7/toothpaste,gum:6,chocolate:7,sweet:7/sugar,citrus:6/orange,banana:5,guava:5,biltong:6,salty chips:6/chips,boerewors:5,pap:4,vetkoek:5,water:9,nothing:7");

export const DESCRIPTORS = [
  "fruity", "sweet", "sour", "floral", "smoky", "musty", "soapy", "spicy", "minty", "burnt", "fresh", "earthy",
  "sharp", "warm", "cold", "loud", "quiet", "rhythmic", "high-pitched", "deep", "rough", "smooth", "soft",
] as const;
export type Descriptor = (typeof DESCRIPTORS)[number];

export const SYNONYMS: Record<string, string> = {
  tune: "music", song: "music", beat: "music", radio: "music", voices: "voices", talking: "voices",
  couch: "sofa", lounge: "living room", kombi: "minibus taxi", hooter: "horn", hooting: "horn",
  scent: "perfume", fragrance: "perfume", deo: "deodorant", moisturiser: "body lotion", moisturizer: "body lotion",
  sunlight: "sunlight soap", handyandy: "handy andy", "handy andy": "handy andy", vaseline: "petroleum jelly",
};

export type Zone = "ceiling" | "wall" | "floor" | "surface" | "window" | "body" | "air";
export type Posture = "lying" | "sitting" | "standing";
export type Flag = "moves" | "light" | "soft" | "noisy" | "warm" | "big" | "cold" | "alive" | "far" | "food" | "fresh" | "steady" | "speech";
export type Color = "white" | "brown" | "black" | "green" | "blue";
export type Obj = {
  label: string;
  senses: SenseKey[];
  at: SettingId[];
  any: boolean;
  zone: Zone;
  flags: Flag[];
  colors: Color[];
  postures: Posture[];
  descriptors: Descriptor[];
  alias: string[];
};

const IN = ["bedroom", "living", "kitchen", "library", "classroom"] as const;
const list = (s: string | undefined) => (!s || s === "-" ? [] : s.split(",").map((x) => x.trim()).filter(Boolean));

// label|senses|settings|zone|flags|colors|postures|descriptors|aliases
function O(row: string): Obj {
  const [label, senses, at, zone, flags, colors, postures, descriptors, alias] = row.split("|");
  const places = list(at).flatMap((p) => (p === "in" ? [...IN] : [p]));
  return {
    label,
    senses: list(senses) as SenseKey[],
    any: places.includes("any"),
    at: places.filter((p) => p !== "any") as SettingId[],
    zone: zone as Zone,
    flags: list(flags) as Flag[],
    colors: list(colors) as Color[],
    postures: list(postures) as Posture[],
    descriptors: list(descriptors) as Descriptor[],
    alias: list(alias),
  };
}

export const OBJECTS: Obj[] = [
  "music|hear|any|air|noisy,speech,steady|-|-|rhythmic,high-pitched,deep,loud|song,tune,beat,radio",
  "voices|hear|any|air|noisy,speech,alive|-|-|rhythmic,deep,loud|talking,people talking,conversation",
  "engine hum|hear|car|air|noisy,steady,far|-|-|deep,rhythmic|engine,car engine",
  "minibus taxi hooting|hear|car,outside|air|noisy,far,moves|-|-|loud,sharp,high-pitched|taxi hoot,horn,hooter",
  "indicator tick|hear|car|air|noisy,steady|-|-|rhythmic,high-pitched|indicator,clicking",
  "generator hum|hear|outside,bedroom,living|air|noisy,steady,far|-|-|deep,rhythmic|inverter,generator",
  "load shedding silence|hear|any|air|steady|-|-|quiet|silence,quiet",
  "ceiling fan|see,hear,feel|bedroom,living,classroom|ceiling|moves,noisy,steady,big|white|-|rhythmic,quiet|fan",
  "air conditioner|hear,feel|in,car|wall|noisy,cold,steady|white|-|cold,quiet|ac,aircon",
  "birds|see,hear|outside,bedroom,living|air|moves,noisy,alive,far|-|-|high-pitched,rhythmic|bird,birds chirping",
  "crickets|hear|outside,bedroom|air|noisy,steady,far|-|-|high-pitched,rhythmic|insects",
  "dog barking|hear|outside,living,bedroom|air|noisy,moves,alive,far|-|-|loud,sharp|dog",
  "rain|see,hear,smell|outside,bedroom,living,car|air|moves,noisy,cold,far,fresh|-|-|fresh,earthy,quiet|raining",
  "wind|feel,hear|outside,car|air|moves,cold,far,noisy|-|-|fresh,quiet|breeze",
  "my breathing|hear,feel|any|body|alive,steady,warm|-|-|rhythmic,warm,quiet|breathing,breath",
  "footsteps|hear|in,outside|floor|moves,noisy,alive|-|-|rhythmic,deep|steps,walking",
  "television|see,hear|living,bedroom|wall|light,noisy,big,speech|black|-|loud,rhythmic|tv,screen",
  "phone|see,feel,hear|any|body|light,noisy|black|-|smooth,sharp|cellphone,mobile",
  "laptop|see,feel,hear|any|surface|light,noisy,warm,steady|black|-|smooth,warm|computer,pc",
  "clock|see,hear|in|wall|moves,noisy,steady|white,black|-|rhythmic|watch,wall clock,tick",
  "kettle|see,hear,feel,smell|kitchen,living|surface|noisy,warm,food|white,black|-|warm,sharp|tea kettle",
  "fridge|see,hear,feel|kitchen|floor|big,noisy,cold,steady|white|-|cold,deep|refrigerator",
  "stove|see,hear,smell,feel|kitchen|surface|warm,noisy,food|black|-|warm,burnt,smoky|oven,cooker",
  "braai smoke|smell,see|outside,kitchen,living|air|food,warm,far|brown|-|smoky,burnt,earthy|smoke,braai",
  "boerewors|smell,taste,see|kitchen,outside|surface|food,warm|brown|-|smoky,spicy,salty|sausage",
  "pap|smell,taste,see|kitchen|surface|food,warm|white|-|warm,smooth|maize porridge",
  "vetkoek|smell,taste,see|kitchen,outside|surface|food,warm|brown|-|warm,earthy,salty|fried dough",
  "biltong|smell,taste,see|kitchen,living,car|surface|food|-|brown|-|salty,earthy,sharp|dried meat",
  "rooibos tea|smell,taste,see|kitchen,living,bedroom|surface|food,warm|brown|-|sweet,earthy,warm|tea",
  "coffee|smell,taste,see|kitchen,living,bedroom|surface|food,warm|brown|-|burnt,earthy,warm|espresso,cappuccino",
  "spice pot|smell,see|kitchen|surface|food|brown|-|spicy,sharp|spices,curry",
  "onion|smell,see,taste|kitchen|surface|food|white,brown|-|sharp,sour|onions",
  "garlic|smell,taste,see|kitchen|surface|food|white|-|sharp,spicy|garlic clove",
  "orange peel|smell,taste,see|kitchen,bedroom,living,outside|surface|food|orange|-|fruity,sweet,fresh|orange,naartjie",
  "banana|smell,taste,see|kitchen,bedroom,living|surface|food|yellow|-|fruity,sweet|bananas",
  "guava|smell,taste,see|kitchen,outside|surface|food|green|-|fruity,sweet|guavas",
  "fruit bowl|see,smell|kitchen,living|surface|food|green|-|fruity,sweet,fresh|fruit",
  "perfume|smell,see,feel|bedroom,living,classroom|air|fresh|white|-|floral,fruity,sweet,sharp|fragrance,scent",
  "body lotion|smell,feel,see|bedroom,bathroom,living|body|soft|white|-|floral,fruity,sweet,smooth|lotion,moisturiser,moisturizer",
  "body spray|smell,see|bedroom,classroom,living|air|fresh|-|-|fruity,floral,sharp|deodorant,deo",
  "shampoo|smell,feel,see|bedroom|body|fresh,soft|white|-|floral,fruity,soapy,smooth|hair shampoo",
  "vaseline|smell,feel,see|bedroom,living|body|soft|white|-|smooth,soapy|petroleum jelly",
  "sunlight soap|smell,feel,see|kitchen,bedroom,living|surface|fresh|white|-|soapy,fresh,sharp|sunlight,dish soap",
  "handy andy|smell,see|kitchen,bedroom,living,classroom|surface|fresh|white|-|soapy,sharp|handyandy,cleaner",
  "fabric softener|smell,see|bedroom,living|air|fresh|blue|-|soapy,sweet,fresh|softener,laundry",
  "clean laundry|smell,feel,see|bedroom,living|body|soft,fresh|white|-|soapy,fresh,sweet|fresh laundry,washed clothes",
  "old books|smell,see,feel|library,classroom,bedroom|surface|-|brown|-|musty,earthy|book smell,old paper",
  "dusty shelf|smell,see,feel|library,bedroom,living|surface|-|brown|-|musty,earthy,rough|dust",
  "floor polish|smell|classroom,library,living|floor|fresh|white|-|soapy,sharp|polish",
  "candle|smell,see|living,bedroom|surface|light,warm|white|-|sweet,floral,smoky|scented candle",
  "room spray|smell|living,bedroom|air|fresh|-|-|floral,sweet,sharp|air freshener",
  "book|see,feel,smell|library,bedroom,living,classroom|surface|-|brown|-|musty,rough|books",
  "bookshelf|see|living,library,bedroom,classroom|wall|big|brown|-|rough|shelf,shelves",
  "desk|see,feel|classroom,library,bedroom|surface|big|brown|-|rough,smooth|table",
  "chair|see,feel|in|floor|big|brown|-|rough|seat",
  "sofa|see,feel|living|floor|soft,big|brown,blue|-|soft,smooth|couch",
  "bed|see,feel|bedroom|floor|soft,big|white|-|soft,smooth,warm|mattress",
  "blanket|see,feel|bedroom,living|body|soft,warm,big|blue,green,white|-|soft,warm,smooth|duvet,cover",
  "pillow|see,feel|bedroom,living|body|soft|white|-|soft,smooth|cushion,pillows",
  "curtain|see,feel|bedroom,living|window|soft,big|white,blue|-|soft,smooth|curtains",
  "window|see,feel|in,car|window|big,light|white|-|cold,smooth|windows",
  "mirror|see,feel|bedroom,living|wall|big|white|-|smooth,cold|",
  "poster|see|bedroom,classroom,library|wall|-|blue,green|-|smooth|posters",
  "whiteboard|see,smell|classroom|wall|big|white|-|sharp,smooth|board",
  "marker pen|smell,see,feel|classroom|body|noisy|blue,black|-|sharp|marker",
  "pen|see,feel|classroom,library,bedroom|body|-|blue,black|-|smooth,sharp|pencil",
  "notebook|see,feel,smell|classroom,library,bedroom|surface|-|white|-|rough,musty|exercise book",
  "backpack|see,feel,smell|classroom,car|body|big|black,brown|-|rough,musty|bag",
  "dashboard|see,feel|car|surface|light|black|-|smooth|dash",
  "steering wheel|see,feel|car|body|-|black|-|rough,smooth|wheel",
  "seatbelt|see,feel|car|body|-|black|-|rough|belt",
  "car seat|see,feel|car|floor|soft,big|black,brown|-|soft,smooth|seat",
  "air freshener|smell,see|car|air|fresh|-|-|sweet,fruity|freshener",
  "fuel|smell|car|air|-|-|-|sharp,burnt|petrol,diesel",
  "traffic|hear,see|car,outside,living,bedroom|air|noisy,moves,far,steady|-|-|deep,loud|cars,road noise",
  "road rumble|hear,feel|car|floor|noisy,moves,steady|-|-|deep,rhythmic|tyres,tires",
  "trees|see,hear,smell|outside,car|air|big,alive|green|-|fresh,earthy|tree",
  "grass|see,feel,smell|outside|floor|soft,fresh|green|-|fresh,earthy,soft|lawn",
  "flowers|see,smell|outside,living,bedroom|air|alive|green|-|floral,sweet,fresh|flower",
  "wet soil|smell,feel|outside|floor|cold|brown|-|earthy,fresh,musty|earth,dirt",
  "bench|see,feel|outside|floor|big|brown|-|rough|park bench",
  "streetlight|see|outside|air|light,big|white|-|sharp|street light",
  "moon|see|outside,car|ceiling|light,big|white|-|quiet|",
  "stars|see|outside|ceiling|light|white|-|quiet|star",
  "sunlight|see,feel|outside,bedroom,living,classroom|window|light,warm|white|-|warm|sun",
  "spaza chips|taste,smell,see|outside,car,living|surface|food|brown|-|salty,spicy|chips",
  "mint gum|taste,smell|car,classroom,outside|body|food|white|-|minty,sweet,fresh|gum",
  "toothpaste|taste,smell,feel|bedroom|body|fresh|white|-|minty,sharp,cold|mint",
  "water|taste,feel|any|body|cold|white|-|fresh|",
  "silence|hear|any|air|steady|-|-|quiet|quiet",
  "laughter|hear|living,classroom,outside|air|noisy,alive|-|-|high-pitched,loud|laughing",
  "children playing|hear|outside,living|air|noisy,alive,moves,far|-|-|rhythmic,high-pitched|kids",
  "keyboard typing|hear,feel|library,classroom,bedroom|surface|noisy,steady|-|-|rhythmic,sharp|typing",
  "page turning|hear,feel|library,classroom|surface|moves,noisy|-|-|rough,quiet|pages",
].map(O);
