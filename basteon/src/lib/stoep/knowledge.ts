// Kiki's "map" of the world: settings -> things you might notice, plus objects for the clue game.
// Edit and extend freely. Everything here is plain data, no AI involved.

export type SenseKey = "see" | "feel" | "hear" | "smell" | "taste";
export const SETTINGS = [
  { id: "bedroom", name: "Bedroom", icon: "BedDouble", words: ["bedroom", "room", "bed", "sleeping"] },
  { id: "living", name: "Living room", icon: "Sofa", words: ["living", "lounge", "sitting room", "couch", "sofa", "tv room", "family room"] },
  { id: "kitchen", name: "Kitchen", icon: "CookingPot", words: ["kitchen", "cooking"] },
  { id: "library", name: "Library", icon: "Library", words: ["library", "study", "reading"] },
  { id: "classroom", name: "School or class", icon: "GraduationCap", words: ["class", "school", "lecture", "office", "campus", "university", "varsity"] },
  { id: "car", name: "Car or taxi", icon: "Car", words: ["car", "taxi", "bus", "train", "driving", "uber", "minibus"] },
  { id: "outside", name: "Outside", icon: "Trees", words: ["outside", "garden", "yard", "park", "street", "road", "stoep", "outdoor", "balcony", "field", "bench"] },
] as const;
export type SettingId = (typeof SETTINGS)[number]["id"];

// ---------- Mode 1: what people tend to notice, per setting and sense ----------
// "label:weight/alias/alias@day" (or @night). Higher weight = more likely. No tag = any time.
export type Entry = { label: string; w: number; alias: string[]; when?: "day" | "night" };

function P(list: string): Entry[] {
  return list.split(",").map((raw) => {
    const m = raw.trim().match(/^(.*?):(\d+)(?:@(day|night))?((?:\/[^/]+)*)$/);
    if (!m) return { label: raw.trim(), w: 5, alias: [] };
    return { label: m[1], w: Number(m[2]), alias: m[4].split("/").filter(Boolean), when: m[3] as Entry["when"] };
  });
}

const T = (o: Record<string, string>): Partial<Record<SenseKey, Entry[]>> =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, P(v)]));

export const THINGS: Record<SettingId, Partial<Record<SenseKey, Entry[]>>> = {
  bedroom: T({
    see: "bed:9/mattress,pillow:7/pillows,blanket:7/duvet/sheets,curtains:8/curtain,wardrobe:7/closet,ceiling fan:6/fan,window:8,lamp:6/light,phone:7,mirror:5,poster:5/posters,clothes:6,door:7,ceiling:5,carpet:4/rug,wall:6/walls,desk:4,charger:4/cable,sunlight:6@day,moon:3@night,dark:4@night",
    feel: "blanket:8/duvet,pillow:8,bed:7/mattress/sheets,phone:6,clothes:6/pyjamas,carpet:4/rug/floor,hair:3,air:3/breeze",
    hear: "fan:7/ceiling fan,traffic:6/cars,birds:5@day/bird,crickets:4@night/cricket,my breathing:5/breathing,phone:4/notification,voices:5/people talking,tv:4/television,music:4/radio,silence:4/quiet,dog:4/dog barking,wind:3",
    smell: "laundry:6/fresh laundry/clean clothes,perfume:5/deodorant,dust:3,sheets:4/pillow,candle:3,coffee:3",
  }),
  living: T({
    see: "tv:9/television,couch:9/sofa,coffee table:6/table,curtains:7/curtain,window:7,lamp:6/light,plant:6/plants,remote:5,carpet:5/rug,wall:5,bookshelf:5/shelf,cushions:5/cushion/pillow,phone:6,door:5,fan:4/ceiling fan,photos:4/picture/frame",
    feel: "couch:8/sofa,cushion:7/pillow,blanket:6,remote:5,phone:6,carpet:4/floor/rug,clothes:5,cup:4/mug",
    hear: "tv:8/television,traffic:5/cars,voices:6/people talking/talking,fridge:4/humming,footsteps:5,music:5/radio,fan:4,birds:3@day,dog:4,clock:3/ticking,silence:3",
    smell: "food:5/cooking,coffee:5/tea,candle:4/air freshener,cleaning:4/polish,dust:3",
  }),
  kitchen: T({
    see: "fridge:9/refrigerator,stove:8/oven/cooker,kettle:7,sink:8/tap,cupboards:7/cupboard,plates:6/dishes/plate,cups:6/mug/cup,table:6,window:6,microwave:6,pots:5/pot/pan,food:5,bin:4/trash,light:5,towel:4",
    feel: "countertop:6/counter/table,floor:5/tiles,cup:6/mug,water:5/tap,fridge handle:3,clothes:4,towel:4,warm air:3",
    hear: "fridge hum:8/fridge/humming,kettle:7,tap running:6/water/tap,cooking:6/sizzling,microwave:5,footsteps:4,radio:4/music,clock:3,dishes:5/plates/clinking",
    smell: "food:8/cooking,coffee:6/tea,bread:5/toast,soap:4/dish soap,spices:4/spice,onions:4/onion,garlic:3",
  }),
  library: T({
    see: "books:10/book,shelves:9/shelf/bookshelf,tables:7/table/desk,chairs:7/chair,lamp:6/lights,people:6,window:5,computer:6/laptop,librarian:4,carpet:4/floor,ceiling:3,pen:3/notebook,stairs:3,poster:3,sign:3",
    feel: "book:8,page:7/paper,desk:7/table,chair:7,pen:5,laptop:5/keyboard,floor:3,phone:4",
    hear: "whispers:7/whispering/voices/talking,pages turning:6/pages,footsteps:6,typing:6/keyboard,silence:6/quiet,coughing:5/cough,chairs:4,air conditioner:4/ac/aircon,printer:3,phone:3",
    smell: "old books:9/books/paper/book,coffee:4,dust:5,carpet:3,cleaning:3",
  }),
  classroom: T({
    see: "whiteboard:9/board/chalkboard,desks:9/desk,chairs:8/chair,teacher:6,books:7/book,windows:6/window,clock:7,bags:5/bag/backpack,pens:6/pen,posters:5/poster,door:5",
    feel: "pen:7,desk:8,chair:7,paper:7/page,uniform:6/clothes,bag:4",
    hear: "talking:8/voices/people talking,chairs scraping:6,pens scratching:4/writing,teacher:7/teacher's voice,bell:5,footsteps:5,laughing:4,clock ticking:3",
    smell: "chalk:5/marker,paper:4,floor polish:3/cleaner,food:3",
  }),
  car: T({
    see: "road:9,windscreen:6/window/windshield,dashboard:7,steering wheel:7/wheel,other cars:8/cars/car/traffic,trees:6/tree,buildings:6/building,seats:6/seat,phone:5,sky:6/clouds,seatbelt:5,mirror:5/rear view mirror,driver:5,traffic lights:5/robot/traffic light,billboards:3/sign",
    feel: "seat:8,seatbelt:6,steering wheel:5/wheel,phone:5,vibration:6/engine,air:5/aircon/ac,window:4,bag:4,clothes:3",
    hear: "engine:9/car engine,traffic:8/cars,radio:6/music,indicator:5/clicking,wind:5,people talking:6/voices/talking,hooting:5/horn/hoot,tyres:4/road,phone:3,aircon:4/ac",
    smell: "car:6/air freshener/new car,fuel:5/petrol/diesel,perfume:3,food:4,leather:3,rain:2",
  }),
  outside: T({
    see: "trees:9/tree,sky:9/clouds/cloud,grass:8/lawn,birds:7/bird,houses:6/house/buildings,wall:6/fence,cars:6/car,sun:7@day/sunlight,moon:5@night,stars:5@night/star,plants:6/flowers/flower,path:5/road/pavement,people:5,dog:4,lights:4@night/streetlight",
    feel: "wind:8/breeze,sun:6@day/warmth,ground:7/floor/grass,air:6,bench:4/seat,clothes:5,cool air:4@night,phone:4,hair:3",
    hear: "birds:9@day/bird,wind:8,traffic:7/cars,people:6/voices,dog:6/barking,leaves:6/rustling,crickets:7@night/insects,footsteps:4,music:3,rain:3,children:3/kids",
    smell: "grass:7/cut grass/lawn,flowers:6/flower/plants,earth:5/soil/dirt,rain:4,smoke:4/braai/fire,exhaust:3/fuel,food:3",
  }),
};

// Taste is memory or imagination, so it never depends on the setting.
export const TASTES: Entry[] = P(
  "tea:9/rooibos tea,coffee:8,water:9,toothpaste:6/mint,chocolate:7,bread:5/toast,something sweet:6/sweet/sugar/candy,something salty:5/salty/salt/chips,fruit:6/apple/orange/banana,nothing:6/nothing much/nothing really,milk:4,juice:5,gum:4,rice:3,something spicy:3/spicy,honey:3,biltong:3",
);

// ---------- Mode 2: objects Kiki can guess from clues ----------
export type Zone = "ceiling" | "wall" | "floor" | "surface" | "window" | "body" | "air";
export type Posture = "lying" | "sitting" | "standing";
export type Flag = "moves" | "light" | "soft" | "noisy" | "warm" | "big" | "cold" | "alive" | "far" | "food" | "fresh" | "steady" | "speech";
export type Color = "white" | "brown" | "black" | "green" | "blue";
export type Obj = {
  label: string; senses: SenseKey[]; at: SettingId[]; any: boolean; zone: Zone;
  flags: Flag[]; colors: Color[]; postures: Posture[]; alias: string[];
};

const IN = ["bedroom", "living", "kitchen", "library", "classroom"];
const list = (s: string | undefined) => (!s || s === "-" ? [] : s.split(","));

// label|senses|settings|zone|flags|colors|postures|aliases   ("-" = none, "in" = all indoor rooms, "any" = anywhere)
function O(row: string): Obj {
  const [label, senses, at, zone, flags, colors, postures, alias] = row.split("|");
  const places = list(at).flatMap((p) => (p === "in" ? IN : [p]));
  return {
    label, senses: list(senses) as SenseKey[], any: places.includes("any"),
    at: places.filter((p) => p !== "any") as SettingId[], zone: zone as Zone,
    flags: list(flags) as Flag[], colors: list(colors) as Color[], postures: list(postures) as Posture[], alias: list(alias),
  };
}

export const OBJECTS: Obj[] = [
  "ceiling fan|see,hear|bedroom,living,classroom|ceiling|moves,noisy,big,steady|white|lying,sitting|fan",
  "ceiling light|see|in|ceiling|light|white|lying,sitting|light,bulb,lights",
  "curtains|see,feel|bedroom,living|window|soft,big|white,blue|-|curtain",
  "window|see|in,car|window|light,big|-|-|windows",
  "mirror|see|bedroom,living|wall|big|-|-|-",
  "poster|see|bedroom,classroom,library|wall|-|blue|-|posters",
  "clock|see,hear|in|wall|noisy,moves,steady|white,black|-|wall clock,watch",
  "television|see,hear|living,bedroom|wall|light,noisy,big,speech|black|sitting,lying|tv,screen",
  "bookshelf|see|living,library,bedroom,classroom|wall|big|brown|-|shelf,shelves",
  "books|see,feel,smell|library,bedroom,living,classroom|surface|-|brown|-|book",
  "lamp|see|bedroom,living,library|surface|light,warm|-|-|light",
  "plant|see,smell|living,bedroom,kitchen,library|surface|fresh|green|-|plants,flower",
  "blanket|see,feel|bedroom,living|body|soft,warm,big|-|lying,sitting|duvet,cover",
  "pillow|see,feel|bedroom,living|body|soft|white|lying,sitting|pillows,cushion",
  "phone|see,feel,hear|any|body|light,noisy|black|-|cellphone,mobile,iphone",
  "laptop|see,feel,hear|any|surface|light,noisy,warm,steady|black|-|computer,pc",
  "mug|see,feel,smell|in|surface|warm,food|white|-|cup,coffee cup,tea cup",
  "kettle|see,hear|kitchen,living|surface|noisy,warm|-|standing,sitting|-",
  "fridge|see,hear|kitchen|floor|big,noisy,cold,steady|white|-|refrigerator",
  "stove|see,hear,smell|kitchen|surface|warm,noisy,food|black|standing|oven,cooker",
  "whiteboard|see|classroom|wall|big|white|sitting|board",
  "desk|see,feel|classroom,library,bedroom|floor|big|brown|sitting|table",
  "chair|see,feel|in|floor|-|brown|sitting|-",
  "dashboard|see|car|surface|light|black|sitting|-",
  "steering wheel|see,feel|car|body|-|black|sitting|wheel",
  "car engine|hear|car|air|noisy,moves,steady|-|sitting|engine",
  "traffic|hear|car,outside,living,bedroom|air|noisy,moves,far,steady|-|-|cars,road noise",
  "tree|see|outside|air|big,alive|green|standing,sitting|trees",
  "sky|see|outside,car|ceiling|big|blue|standing,sitting|clouds,cloud",
  "grass|see,feel,smell|outside|floor|soft,fresh|green|standing,sitting|lawn",
  "birds|see,hear|outside,bedroom,living|air|moves,noisy,alive,far|-|-|bird",
  "wind|feel,hear|outside,car|air|moves,cold,far,noisy|-|-|breeze",
  "rain|see,hear,smell|outside,bedroom,living,car|air|moves,noisy,cold,far,fresh|-|-|raining",
  "floor|see,feel|any|floor|big|brown|-|ground,carpet,rug,tiles",
  "hair|feel|any|body|soft,alive|brown,black|-|my hair",
  "clothes|feel,see|any|body|soft|-|-|shirt,jersey,hoodie,jeans",
  "hands|see,feel|any|body|warm,alive|-|-|fingers,hand",
  "remote|feel,see|living,bedroom|surface|-|black|sitting,lying|remote control",
  "keys|feel,hear|any|body|noisy,cold|-|-|key",
  "pen|feel,see|classroom,library,bedroom|body|-|blue,black|sitting|pencil",
  "coffee|smell|in|air|warm,food|brown|-|tea,hot drink",
  "cooking|smell,hear|kitchen,living|air|warm,noisy,food|-|-|food",
  "soap|smell|in,car|air|fresh|-|-|laundry,detergent",
  "old paper|smell|library|air|-|brown|-|paper,books",
  "fuel|smell|car|air|-|-|-|petrol,diesel",
  "my breathing|hear,feel|any|body|noisy,warm,alive,steady|-|-|breathing,breath",
  "footsteps|hear|in,outside|floor|moves,noisy,alive|-|-|steps,walking",
  "voices|hear|any|air|noisy,alive,speech|-|-|talking,people,conversation",
  "music|hear|any|air|noisy,speech|-|-|song,radio",
  "air conditioner|hear,feel|in,car|wall|noisy,cold,steady|white|-|aircon,ac",
  "dog|hear,see|outside,living,bedroom|floor|moves,noisy,soft,alive,far|brown|-|dog barking",
  "bed|see,feel|bedroom|floor|soft,big|white|lying,sitting|mattress,sheets",
  "sofa|see,feel|living|floor|soft,big|brown|sitting,lying|couch",
  "door|see|any|wall|big|brown,white|-|-",
].map(O);