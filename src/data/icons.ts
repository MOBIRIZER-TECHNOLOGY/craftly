/**
 * Adapter between the `lucide` package and the design "Icons" library.
 *
 * - `loadIconIndex()` lazily imports lucide (its own chunk), turns the PascalCase icon table into
 *   a searchable, name-sorted index and memoises it.
 * - lucide exports every icon under several names (renamed icons keep their old name as an alias).
 *   Aliases share one drawing, so the index lists each drawing once; the other names are kept in
 *   `aliases` (and as tags), rank like id words in search and still resolve in `getIconSvg`, which
 *   keeps ids stored in older designs working.
 * - `searchIcons` is a pure function (no lucide import), ranking exact > prefix > contains over the
 *   id words and the tags, so it can be unit tested and reused in workers.
 */
import { iconNodeToSvg } from "@/core/svg";

export interface IconDef {
  /** kebab-case id, e.g. "arrow-up-right" */
  id: string;
  /** sentence-case title, e.g. "Arrow up right" */
  name: string;
  /** lower-case search words: id words, alias words and curated synonyms */
  tags: string[];
  /** former lucide names for the same drawing (kebab-case); optional, they rank like id words */
  aliases?: string[];
}

type IconNode = Array<[string, Record<string, string | number>]>;

export interface IconLibrary {
  /** one entry per drawing, sorted by id */
  index: IconDef[];
  /** every known id (including aliases) -> drawing */
  nodes: Map<string, IconNode>;
}

/* ------------------------------------------------------------------ names */

/**
 * "ArrowUpRight" -> "arrow-up-right", "Layers2" -> "layers-2", "AArrowDown" -> "a-arrow-down",
 * "Grid2X2" -> "grid-2x2", "Axis3D" -> "axis-3d".
 */
export function iconIdFromName(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/([A-Za-z])(\d)/g, "$1-$2")
    .replace(/(\d)([A-Z][a-z])/g, "$1-$2")
    .replace(/-([A-Z])([A-Z])$/, "-$1-$2")
    .toLowerCase()
    .replace(/(\d)-?x-?(\d)/g, "$1x$2");
}

/** "arrow-up-right" -> "Arrow up right" */
export function iconTitle(id: string): string {
  const words = id.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Accepts "heart", "Heart", "ArrowRight", "arrow_right" or "arrow right". */
function normalizeId(raw: string): string {
  const s = raw.trim();
  if (/[A-Z]/.test(s) && !/[-_\s]/.test(s)) return iconIdFromName(s);
  return s.toLowerCase().replace(/[\s_]+/g, "-");
}

/**
 * Old lucide names that were superseded (shape moved to the front, "alert" -> "exclamation-point",
 * "edit" -> "pen" ...). When several names share a drawing, the one matching the fewest of these
 * is shown, which selects lucide's current name for ~93% of the alias groups; the rest is cosmetic
 * because every alias stays searchable.
 */
const LEGACY_NAME = [
  /-(circle|square|triangle|octagon|diamond|cloud)(-\d)?$/,
  /(^|-)chart(-(horizontal|big|square))*(-\d)?$/,
  /alert|warning|help(?!ing)|question(?!-mark)/,
  /edit|signature|sidebar|inactive/,
  /[a-z]-\d$/,
];

function pickPrimary(ids: string[]): string {
  const penalty = (id: string) => LEGACY_NAME.reduce((n, re) => n + (re.test(id) ? 1 : 0), 0);
  const words = (id: string) => id.split("-").length;
  return ids.slice().sort((a, b) => penalty(a) - penalty(b) || words(b) - words(a) || (a < b ? 1 : -1))[0];
}

/* ------------------------------------------------------------------ synonyms */

/** Curated extra search words for popular icons (keys are lucide ids or aliases). */
export const ICON_SYNONYMS: Readonly<Record<string, string>> = {
  heart: "love like favourite favorite romance valentine care social",
  star: "favourite favorite rating review award bookmark",
  house: "home building property main start",
  user: "person profile account avatar member human",
  users: "people group team community members social",
  "user-plus": "add friend invite signup register",
  "user-round": "person profile avatar account",
  "circle-user": "account profile avatar person",
  mail: "email envelope message inbox letter",
  phone: "call telephone mobile contact",
  smartphone: "mobile phone device cell app",
  tablet: "ipad device screen mobile",
  laptop: "computer notebook device work",
  monitor: "screen display desktop computer",
  keyboard: "typing keys input computer",
  mouse: "cursor click pointer computer",
  printer: "print paper office document",
  camera: "photo photography picture snapshot",
  image: "picture photo gallery photograph",
  "image-plus": "add picture photo upload",
  video: "movie film record clip camera",
  film: "movie cinema video reel",
  music: "audio song note melody sound",
  headphones: "audio music listen podcast sound",
  mic: "microphone record voice audio podcast",
  "volume-2": "sound speaker audio loud music",
  podcast: "audio broadcast radio show",
  radio: "broadcast audio music fm",
  tv: "television screen watch video",
  play: "start video music media go",
  pause: "stop wait media hold",
  search: "find magnifier magnifying lookup zoom",
  settings: "gear cog preferences options config tools",
  "sliders-horizontal": "adjust controls filter settings mixer",
  funnel: "filter sort refine narrow",
  bell: "notification alert alarm ring reminder",
  "alarm-clock": "alarm wake time reminder",
  calendar: "date schedule event day planner month",
  clock: "time watch hour timer",
  timer: "stopwatch countdown time",
  hourglass: "wait time loading sand",
  "map-pin": "location place marker gps address pin",
  map: "location directions navigate atlas travel",
  compass: "navigate direction explore north travel",
  globe: "world earth international web planet global social",
  plane: "flight airplane travel trip fly airport",
  car: "vehicle drive auto transport automobile",
  bus: "transport public transit vehicle",
  bike: "bicycle cycling ride transport sport",
  ship: "boat sea cruise ocean transport",
  truck: "delivery shipping transport cargo vehicle",
  tent: "camping outdoor adventure nature",
  backpack: "bag travel hiking school luggage",
  luggage: "suitcase travel baggage trip",
  anchor: "ship harbor marine nautical",
  binoculars: "explore search look watch nature",
  lock: "secure security private password protected",
  "lock-open": "unlock open security unsecured access",
  key: "password access security unlock",
  shield: "security protection safe guard privacy defense",
  fingerprint: "biometric identity security touch",
  check: "tick done ok complete success yes",
  "circle-check": "success complete done approved verified correct",
  x: "close cancel remove delete cross no",
  "circle-x": "error cancel close failed wrong",
  plus: "add new create increase more",
  minus: "remove subtract decrease less",
  trash: "delete bin garbage remove rubbish waste",
  pencil: "edit write draw modify pen",
  "pen-tool": "vector draw design bezier illustration",
  paintbrush: "paint art draw brush design",
  brush: "paint art design clean",
  palette: "colour color paint art design theme",
  copy: "duplicate clone clipboard",
  clipboard: "paste copy board tasks list",
  download: "save get import arrow",
  upload: "send publish export arrow",
  "share-2": "send social network export",
  link: "url chain hyperlink connect",
  "external-link": "open new window launch outbound",
  eye: "view show visible watch preview",
  "eye-off": "hide hidden invisible private",
  menu: "hamburger navigation bars list",
  ellipsis: "more dots options menu",
  "arrow-right": "next forward direction go",
  "arrow-left": "back previous direction return",
  "arrow-up": "top increase direction up",
  "arrow-down": "bottom decrease direction down",
  "chevron-right": "next forward expand arrow",
  "chevron-down": "dropdown expand arrow more",
  "refresh-cw": "reload sync update refresh repeat",
  "rotate-ccw": "undo reset back restore",
  maximize: "fullscreen expand enlarge resize",
  move: "drag arrows reposition pan",
  crop: "trim cut frame resize image",
  scan: "camera frame capture focus",
  "qr-code": "scan barcode code payment",
  power: "on off shutdown switch energy",
  "log-in": "sign in enter login access",
  "log-out": "sign out exit logout leave",
  wifi: "wireless internet signal network connection",
  bluetooth: "wireless connect device pair",
  signal: "bars network reception mobile",
  battery: "power charge energy level",
  "battery-charging": "power charge energy plug",
  plug: "power electric connect socket",
  zap: "lightning bolt power energy electric fast",
  sun: "weather day light bright sunny summer",
  moon: "night dark sleep weather theme",
  sunrise: "morning dawn weather day",
  sunset: "evening dusk weather night",
  cloud: "weather sky storage online",
  "cloud-rain": "weather rain storm wet forecast",
  snowflake: "winter cold weather snow ice",
  wind: "weather air breeze windy",
  thermometer: "temperature weather hot cold health",
  rainbow: "weather colour color sky pride",
  umbrella: "rain weather protection insurance",
  flame: "fire hot burn trending popular",
  droplet: "water liquid drop rain weather",
  leaf: "nature plant eco green organic",
  "tree-pine": "nature forest plant outdoor christmas",
  flower: "nature plant bloom garden spring",
  mountain: "nature hiking landscape outdoor peak",
  coffee: "cup mug drink cafe tea food",
  utensils: "food restaurant cutlery dining eat",
  pizza: "food slice italian meal fast",
  apple: "fruit food healthy fresh",
  cherry: "fruit food sweet berry",
  carrot: "vegetable food healthy veggie",
  egg: "food breakfast chicken",
  drumstick: "food chicken meat meal",
  croissant: "food bakery pastry breakfast french",
  cookie: "food biscuit snack sweet dessert",
  cake: "birthday dessert food party celebration",
  "ice-cream-cone": "dessert food sweet summer",
  beer: "drink bar alcohol pub food",
  wine: "drink glass alcohol bar food",
  soup: "food bowl meal hot dish",
  salad: "food healthy vegetable bowl meal",
  "party-popper": "celebration confetti party event birthday",
  gift: "present box surprise birthday celebration",
  "shopping-cart": "shop buy store basket checkout ecommerce shopping",
  "shopping-bag": "shop buy retail store purchase shopping",
  store: "shop market retail building business shopping",
  tag: "label price sale category shopping",
  receipt: "bill invoice payment shopping money",
  "credit-card": "payment pay bank card money shopping",
  wallet: "money payment cash purse finance",
  banknote: "money cash dollar currency bill",
  coins: "money cash currency change finance",
  "piggy-bank": "money savings finance bank",
  "dollar-sign": "money price currency usd finance",
  "circle-dollar-sign": "money price currency coin finance",
  percent: "discount sale rate math offer",
  bookmark: "save favourite favorite saved read later",
  flag: "report mark country milestone goal",
  award: "prize badge winner achievement medal",
  trophy: "winner champion prize cup success game",
  crown: "king queen royal premium vip winner",
  medal: "award winner prize achievement rank",
  target: "goal aim focus bullseye objective",
  rocket: "launch startup space boost fast",
  lightbulb: "idea light creative bright tip",
  sparkles: "magic ai new shine stars effects",
  "wand-sparkles": "magic wizard effects auto enhance",
  gem: "diamond jewel premium luxury value",
  diamond: "shape gem jewel premium",
  scissors: "cut trim craft tools",
  ruler: "measure length size design tools",
  layers: "stack levels arrange design",
  "layout-dashboard": "dashboard grid panels overview app",
  list: "bullets items menu todo",
  table: "grid data spreadsheet rows columns",
  "chart-bar": "graph statistics analytics data report chart",
  "chart-line": "graph analytics trend data growth chart",
  "chart-pie": "graph statistics share data report chart",
  "trending-up": "growth increase rise analytics profit chart",
  "trending-down": "decline decrease fall loss analytics chart",
  activity: "pulse heartbeat monitor analytics health chart",
  bug: "insect error debug issue software",
  code: "programming developer html brackets software",
  terminal: "console command line shell developer",
  cpu: "processor chip hardware computer",
  database: "storage data server records",
  server: "hosting data hardware network",
  "gamepad-2": "game controller play video gaming",
  dices: "game random chance luck board",
  puzzle: "game piece plugin extension solve",
  joystick: "game controller arcade play",
  building: "office city company architecture",
  school: "education college university learning",
  hospital: "health medical clinic emergency building",
  hammer: "tool tools build construction fix repair",
  wrench: "tool tools fix repair settings maintenance",
  construction: "build work warning road tools",
  info: "information help about details",
  "circle-question-mark": "help support question faq",
  "triangle-alert": "warning danger caution error attention",
  "circle-alert": "warning error attention important",
  "message-circle": "chat comment talk conversation bubble social",
  "message-square": "chat comment text note bubble social",
  send: "submit paper plane message share",
  inbox: "mail messages tray incoming",
  paperclip: "attachment attach file clip",
  file: "document paper page",
  "file-text": "document text page article note",
  folder: "directory files storage organize",
  archive: "box storage backup save old",
  book: "read library study notebook novel",
  "book-open": "read study library learn pages",
  "graduation-cap": "education school university degree graduate",
  newspaper: "news article press media blog",
  quote: "citation blockquote testimonial speech",
  languages: "translate language international text",
  smile: "happy face emoji good mood",
  frown: "sad face emoji bad unhappy",
  "thumbs-up": "like approve good agree social",
  "thumbs-down": "dislike disapprove bad social",
  hand: "stop palm gesture wave",
  handshake: "deal agreement partnership business",
  baby: "child kid infant family",
  dog: "pet animal puppy",
  cat: "pet animal kitten",
  bird: "animal fly tweet nature",
  fish: "animal sea food water",
  "paw-print": "pet animal dog cat footprint",
  bed: "sleep hotel bedroom rest home",
  bath: "bathroom shower clean tub home",
  sofa: "couch furniture living room home",
  lamp: "light furniture desk home lighting",
  "door-open": "entrance exit enter room home",
  armchair: "furniture chair seat living home",
  "heart-pulse": "health heartbeat medical cardiology",
  stethoscope: "doctor medical health clinic",
  pill: "medicine drug health pharmacy",
  syringe: "vaccine injection medical health",
  microscope: "science lab research biology",
  "flask-conical": "science chemistry lab experiment",
  atom: "science physics chemistry molecule",
  brain: "mind intelligence think ai",
  dumbbell: "fitness gym exercise sport workout health",
  bot: "robot ai assistant chatbot",
  megaphone: "announce marketing promote speaker",
  "at-sign": "email mention address social",
  hash: "hashtag number pound social",
  "id-card": "identity badge profile card",
  notebook: "notes journal diary paper",
  "sticky-note": "memo note reminder postit",
  pin: "pushpin attach location mark",
  shirt: "clothes fashion tshirt wear",
  glasses: "eyewear vision reading style",
  watch: "time wrist smartwatch clock",
  gauge: "speed meter dashboard performance",
};

/** Quick-search chips for the Icons panel; each returns a healthy number of icons. */
export const ICON_SUGGESTIONS: string[] = [
  "arrow",
  "heart",
  "star",
  "user",
  "home",
  "mail",
  "phone",
  "camera",
  "music",
  "food",
  "shopping",
  "calendar",
  "chart",
  "cloud",
  "weather",
  "map",
  "lock",
  "settings",
  "check",
  "social",
  "health",
  "money",
  "tools",
  "game",
];

/* ------------------------------------------------------------------ library */

/**
 * Pure: builds the index and the id -> drawing table from lucide's `icons` record.
 * Names sharing one drawing (aliases) become a single entry.
 */
export function buildIconLibrary(raw: Record<string, IconNode>): IconLibrary {
  const groups = new Map<IconNode, string[]>();
  for (const key of Object.keys(raw)) {
    const node = raw[key];
    const id = iconIdFromName(key);
    const ids = groups.get(node);
    if (!ids) groups.set(node, [id]);
    else if (!ids.includes(id)) ids.push(id);
  }

  const nodes = new Map<string, IconNode>();
  const index: IconDef[] = [];
  for (const [node, ids] of groups) {
    const free = ids.filter((id) => !nodes.has(id));
    if (!free.length) continue;
    const primary = pickPrimary(free);
    const ordered = [primary, ...free.filter((id) => id !== primary)];
    const words = new Set<string>();
    for (const id of ordered) for (const w of id.split("-")) if (w) words.add(w);
    for (const id of ordered) for (const w of (ICON_SYNONYMS[id] ?? "").split(" ")) if (w) words.add(w);
    for (const id of free) nodes.set(id, node);
    const def: IconDef = { id: primary, name: iconTitle(primary), tags: [...words] };
    if (ordered.length > 1) def.aliases = ordered.slice(1);
    index.push(def);
  }
  index.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { index, nodes };
}

let libraryPromise: Promise<IconLibrary> | null = null;

function loadLibrary(): Promise<IconLibrary> {
  if (!libraryPromise) {
    libraryPromise = import("lucide")
      .then((mod) => {
        const m = mod as unknown as { icons?: Record<string, IconNode>; default?: { icons?: Record<string, IconNode> } };
        const raw = m.icons ?? m.default?.icons;
        if (!raw) throw new Error("lucide did not export an icons table");
        return buildIconLibrary(raw);
      })
      .catch((err) => {
        libraryPromise = null; // allow a retry after a failed chunk load
        throw err;
      });
  }
  return libraryPromise;
}

/** All icons (one per drawing), sorted by id. The array is shared and memoised: do not mutate it. */
export async function loadIconIndex(): Promise<IconDef[]> {
  return (await loadLibrary()).index;
}

/** Standalone 24x24 stroke `<svg>` (stroke="currentColor") for an id or any lucide alias, or null. */
export async function getIconSvg(id: string): Promise<string | null> {
  const lib = await loadLibrary();
  const nodes = lib.nodes.get(id) ?? lib.nodes.get(normalizeId(id));
  return nodes ? iconNodeToSvg(nodes) : null;
}

/* ------------------------------------------------------------------ search */

function queryTokens(query: string): string[] {
  return query
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Match strength of one word: exact > prefix > contains. */
const strength = (w: string, token: string, exact: number, prefix: number, contains: number) =>
  w === token ? exact : w.startsWith(token) ? prefix : w.includes(token) ? contains : 0;

interface Fields {
  idWords: string[];
  aliasWords: string[];
  tags: string[];
}

/** Best score of one query word against id words, former names and tags (0 = no match). */
function wordScore(token: string, f: Fields): number {
  let best = 0;
  for (let i = 0; i < f.idWords.length; i++) {
    let s = strength(f.idWords[i], token, 90, 60, 30);
    if (s && i === 0) s += 6;
    if (s > best) best = s;
  }
  for (const w of f.aliasWords) best = Math.max(best, strength(w, token, 80, 52, 26));
  for (const t of f.tags) best = Math.max(best, strength(t, token, 55, 36, 14));
  return best;
}

function iconScore(icon: IconDef, tokens: string[], joined: string): number {
  const fields: Fields = {
    idWords: icon.id.split("-"),
    aliasWords: icon.aliases ? icon.aliases.flatMap((a) => a.split("-")) : [],
    tags: icon.tags,
  };
  let total = 0;
  for (const token of tokens) {
    let s = wordScore(token, fields);
    if (token.length > 3 && token.endsWith("s")) s = Math.max(s, Math.floor(wordScore(token.slice(0, -1), fields) * 0.9));
    if (!s) return 0; // every word of the query has to match something
    total += s;
  }
  if (icon.id === joined) total += 200;
  else if (icon.aliases?.includes(joined)) total += 150;
  else if (icon.id.startsWith(joined)) total += 40;
  return total;
}

/**
 * Ranks icons for a free-text query: every word must match, exact words beat prefixes beat
 * substrings, id words beat tags, and shorter ids (the "basic" icons) come first on ties.
 * An empty query returns the first `limit` icons of the index.
 */
export function searchIcons(index: IconDef[], query: string, limit = 120): IconDef[] {
  const tokens = queryTokens(query);
  if (!tokens.length) return index.slice(0, limit);
  const joined = tokens.join("-");
  const hits: Array<{ icon: IconDef; score: number; words: number; order: number }> = [];
  for (let i = 0; i < index.length; i++) {
    const score = iconScore(index[i], tokens, joined);
    if (score > 0) hits.push({ icon: index[i], score, words: index[i].id.split("-").length, order: i });
  }
  hits.sort((a, b) => b.score - a.score || a.words - b.words || a.order - b.order);
  return hits.slice(0, limit).map((h) => h.icon);
}
