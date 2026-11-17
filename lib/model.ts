// Launch Radar model: one sealed snapshot of the protocol universe in, one ranked board out.
//
// The board ranks protocols that record no token yet by what a token would be worth if the
// protocol's record stayed as it is. The value is anchored to the snapshot's own market, never
// to a hand-kept list of names:
//
//   multiple(category)  the median market-cap / TVL ratio of the snapshot's live-token protocols
//                       in the same category (at least MIN_PEERS of them, else the all-market
//                       median), clamped to [MULT_FLOOR, MULT_CAP]. It is what the market itself
//                       pays for one dollar of this kind of protocol's TVL.
//   momentum            1 + clamp(change_7d, -50, 100) / 100 x MOMENTUM_WEIGHT: a protocol whose
//                       TVL is compounding into a launch is worth more than a shrinking one.
//   endurance           0.70 + 0.30 x min(age_days, 1460) / 1460: the longer a protocol has run
//                       at size with no token, the more of its record a launch price can stand on.
//                       An unrecorded listing date scores a neutral UNKNOWN_ENDURANCE.
//   implied_value_usd   round(tvl_usd x multiple x momentum x endurance), at least 1.
//
// The board covers every slug on the snapshot's watchlist (the floor, never the ceiling) and
// every other rankable pre-token protocol in the snapshot: the radar ranks the whole pre-token
// field the snapshot carries, not a cut of it. A protocol is pre-token when its record carries
// no token (no market cap, no CoinGecko id, no symbol). Wrapped, staked, bridged and versioned
// products of tokens that already trade, and exchanges, are not launch candidates and are never
// ranked; live-token protocols are kept apart and shown at the market's own values.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label: the dashboard names it on every row's breakdown. */
export const MODEL_VERSION = 'launch-radar-2';

/** The model's constants, stated on the dashboard's model panel exactly as used here. */
export const MODEL = {
  min_peers: 4,
  mult_floor: 0.03,
  mult_cap: 1.5,
  momentum_weight: 0.35,
  momentum_floor: -50,
  momentum_cap: 100,
  endurance_floor: 0.7,
  endurance_range: 0.3,
  endurance_days: 1460,
  unknown_endurance: 0.85,
  live_rows: 30,
} as const;

/** One category's peer anchor: the median live multiple, and how many live peers set it. */
export interface PeerAnchor {
  category: string;
  peers: number;
  multiple: number;
}

/** The value model's three factors for one protocol. */
export interface ValueBreakdown {
  multiple: number;
  multiple_peers: number;
  multiple_scope: string;
  momentum_pct: number | null;
  momentum_factor: number;
  endurance_factor: number;
  age_days: number | null;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow extends ValueBreakdown {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  implied_value_usd: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  symbol: string | null;
}

/** Everything the dashboard renders, written beside the page as data.js. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: typeof MODEL;
  counts: { protocols: number; pre_token: number; live: number; watchlist: number; board: number };
  anchors: PeerAnchor[];
  global_anchor: PeerAnchor;
  rows: BoardRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when a date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a version of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** Categories that are products of a token that already trades, or an exchange, never a launch. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** A name that begins with an exchange's name is that exchange's product, not a launch candidate. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whether a protocol is a wrapped, staked, bridged or versioned product, or an exchange. */
export function isProduct(p: SnapshotProtocol): boolean {
  return (
    (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) ||
    VERSIONED.test(p.name) ||
    /\b(wrapped|staked|staking)\b/i.test(p.name) ||
    EXCHANGE_PREFIX.test(p.name)
  );
}

/** Whether the board may rank a protocol: pre-token and not a product of one that trades. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isProduct(p);
}

/** The median of a non-empty list, or null. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The peer anchors: for every category, the median market-cap / TVL of its live-token protocols
 * (a live peer records a market cap and a positive TVL), clamped to the model's band. The global
 * anchor is the median over every live peer in the snapshot.
 */
export function peerAnchors(snapshot: Snapshot): { byCategory: Map<string, PeerAnchor>; global: PeerAnchor } {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const list = ratios.get(key);
    if (list === undefined) ratios.set(key, [ratio]);
    else list.push(ratio);
  }
  const globalMedian = median(all) ?? 1;
  const global: PeerAnchor = {
    category: 'All categories',
    peers: all.length,
    multiple: round4(clamp(globalMedian, MODEL.mult_floor, MODEL.mult_cap)),
  };
  const byCategory = new Map<string, PeerAnchor>();
  for (const [category, list] of ratios) {
    const m = median(list);
    if (m === null) continue;
    byCategory.set(category, { category, peers: list.length, multiple: round4(clamp(m, MODEL.mult_floor, MODEL.mult_cap)) });
  }
  return { byCategory, global };
}

/** The anchor one protocol is priced from: its category's when it has enough peers, else the global one. */
function anchorFor(p: SnapshotProtocol, anchors: { byCategory: Map<string, PeerAnchor>; global: PeerAnchor }): PeerAnchor & { scope: string } {
  const own = p.category === null ? undefined : anchors.byCategory.get(p.category);
  if (own !== undefined && own.peers >= MODEL.min_peers) return { ...own, scope: `category ${own.category}` };
  return { ...anchors.global, scope: 'all-market median' };
}

/** The three factors and the implied value one protocol gets, all from the snapshot's figures. */
export function valueOf(p: SnapshotProtocol, asOf: string, anchors: { byCategory: Map<string, PeerAnchor>; global: PeerAnchor }): ValueBreakdown & { implied: number } {
  const anchor = anchorFor(p, anchors);
  const age = ageDays(asOf, p.listed_at);
  const momentumPct = p.change_7d === null ? null : clamp(p.change_7d, MODEL.momentum_floor, MODEL.momentum_cap);
  const momentumFactor = 1 + ((momentumPct ?? 0) / 100) * MODEL.momentum_weight;
  const enduranceFactor =
    age === null ? MODEL.unknown_endurance : MODEL.endurance_floor + (Math.min(age, MODEL.endurance_days) / MODEL.endurance_days) * MODEL.endurance_range;
  const implied = Math.max(1, Math.round(p.tvl_usd * anchor.multiple * momentumFactor * enduranceFactor));
  return {
    multiple: anchor.multiple,
    multiple_peers: anchor.peers,
    multiple_scope: anchor.scope,
    momentum_pct: momentumPct,
    momentum_factor: round4(momentumFactor),
    endurance_factor: round4(enduranceFactor),
    age_days: age,
    implied,
  };
}

// ---------------------------------------------------------------- farm plans

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The fee wording for a chain family: the same step costs differently on Solana, Bitcoin and EVM chains. */
function feeWording(chain: string): string {
  if (chain === 'Solana') return 'under $1 of SOL in fees';
  if (chain === 'Bitcoin') return 'about $2 to $5 of BTC in fees';
  return 'about $2 to $4 of gas';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 250_000_000) return 100;
  if (p.tvl_usd >= 50_000_000) return 75;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get the longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core action and its second qualifying action, in words a farmer can follow. */
function actionsFor(p: SnapshotProtocol, capital: number, chain: string): { core: string; second: string } {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return {
      core: `Supply $${capital} of USDC to ${name} on ${chain} as collateral and leave the deposit open.`,
      second: `Borrow about $${Math.round(capital / 3)} against the deposit and repay it once, so the wallet shows both sides of the market.`,
    };
  }
  if (c.includes('dex') || c.includes('liquidity')) {
    return {
      core: `Provide $${capital} of liquidity to ${name}'s highest-volume pool on ${chain} and keep the position open.`,
      second: `Route one swap of about $${Math.round(capital / 2)} through ${name} each week instead of an aggregator.`,
    };
  }
  if (c.includes('derivative') || c.includes('option') || c.includes('perpetual')) {
    return {
      core: `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`,
      second: `Close and reopen the hedge once a week so the account shows recurring, two-sided activity.`,
    };
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return {
      core: `Deposit $${capital} into one of ${name}'s curated vaults on ${chain} and keep the vault shares.`,
      second: `Move about $${Math.round(capital / 4)} into a second vault on the same curator so the wallet is not a one-click account.`,
    };
  }
  if (c.includes('rwa')) {
    return {
      core: `Subscribe $${capital} to ${name}'s yield-bearing asset on ${chain} and hold the position.`,
      second: `Let one full yield period settle, then add about $${Math.round(capital / 4)} more so the holding grows over time.`,
    };
  }
  if (c.includes('prediction')) {
    return {
      core: `Fund $${capital} on ${name} and take one position in its most liquid market.`,
      second: `Settle that market and take a position in the next one, so the account has a settled history.`,
    };
  }
  if (c.includes('insurance')) {
    return {
      core: `Buy $${capital} of cover from ${name} on ${chain} for a position you actually hold.`,
      second: `Renew the cover when it lapses so the policy history runs unbroken into any snapshot.`,
    };
  }
  if (c.includes('launchpad')) {
    return {
      core: `Register the wallet on ${name} and commit $${capital} to its next open round on ${chain}.`,
      second: `Hold whatever the round allocates for at least 30 days instead of selling on the first day.`,
    };
  }
  if (c.includes('chain')) {
    return {
      core: `Bridge $${capital} of USDC to ${chain} and hold a working balance in the chain's own apps.`,
      second: `Make one transfer and one app deposit on ${chain} each week so the wallet reads as a resident, not a passer-by.`,
    };
  }
  if (c.includes('privacy')) {
    return {
      core: `Deposit $${capital} into ${name} on ${chain} and make one shielded transfer to your own second wallet.`,
      second: `Keep the shielded balance for the hold period and withdraw in two parts, not one.`,
    };
  }
  return {
    core: `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`,
    second: `Add about $${Math.round(capital / 4)} more after the first week so the position grows instead of sitting static.`,
  };
}

/**
 * A protocol's farm plan: six steps, each an action with what it costs and how long it takes,
 * derived from the protocol's own record (category, first chain, TVL tier, age). No name is
 * special-cased; two protocols with the same record shape get the same plan shape.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const fees = feeWording(chain);
  const { core, second } = actionsFor(p, capital, chain);
  const steps = [
    `Set up one fresh wallet for ${p.name} alone and keep its seed phrase offline, never in a screenshot or a cloud note. Cost: ${fees} for the first funding transaction. Time: 10 minutes.`,
    `${core} Cost: $${capital} of capital plus ${fees}. Time: 15 minutes to set up.`,
    `${second} Cost: ${fees} per action. Time: 10 minutes.`,
    `Repeat one qualifying action every week (a deposit, a swap, a vote or a renewal) so no weekly snapshot of the protocol misses the wallet. Cost: about $2 a week in fees. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days; a position opened and closed inside one week is the pattern points programs filter out first. Cost: the $${capital} stays in the position. Time: ${hold} days.`,
    `Before withdrawing, check ${p.name}'s own points or rewards page and claim only from the link it publishes; never pay a third party to claim for you. Cost: nothing to check. Time: 10 minutes, then 10 minutes to unwind.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

// ---------------------------------------------------------------- the board

/** The protocols the board ranks, strongest first, with ranks 1..n and every watchlist slug covered. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const anchors = peerAnchors(snapshot);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => ({ p, v: valueOf(p, snapshot.as_of, anchors) }));
  scored.sort((a, b) => b.v.implied - a.v.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const watchlist = new Set(snapshot.watchlist);
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    on_watchlist: watchlist.has(s.p.slug),
    age_days: s.v.age_days,
    multiple: s.v.multiple,
    multiple_peers: s.v.multiple_peers,
    multiple_scope: s.v.multiple_scope,
    momentum_pct: s.v.momentum_pct,
    momentum_factor: s.v.momentum_factor,
    endurance_factor: s.v.endurance_factor,
    implied_value_usd: s.v.implied,
    farm_steps: farmSteps(s.p, s.v.age_days),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's already-trading view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, MODEL.live_rows)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      symbol: p.symbol,
    }));
}

/** Everything the dashboard renders, from the snapshot: the board, the live set and the anchors. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const anchors = peerAnchors(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model: MODEL,
    counts: {
      protocols: snapshot.protocols.length,
      pre_token: snapshot.protocols.filter(isPreToken).length,
      live: snapshot.protocols.filter((p) => !isPreToken(p)).length,
      watchlist: snapshot.watchlist.length,
      board: board.length,
    },
    anchors: [...anchors.byCategory.values()].sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1)),
    global_anchor: anchors.global,
    rows: board,
    live: liveRows(snapshot),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: size, coverage, ranks, order, steps, values. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100 to 4000`;
  const valid = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const r of board) {
    if (!valid.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
    if (seen.has(r.slug)) return `${r.slug} appears twice`;
    seen.add(r.slug);
    if (typeof r.name !== 'string' || r.name.length === 0) return `${r.slug} has no name`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `rank ${i + 1} outranks rank ${i} on implied value`;
  }
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) {
    return 'every row shares one implied value: a board that ranks nothing by value is not a ranking';
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
