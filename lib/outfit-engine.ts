import type { CandidateOutfit } from './anthropic';

export interface Item {
  id: string;
  category: string;
  sub_category: string | null;
  occupies_slots: string[];
  colors: string[];
  style_tags: string[];
  season_tags: string[];
  warmth_score: number | null;
  formality_score: number | null;
  brand: string | null;
  name: string | null;
}

export interface OutfitContext {
  temp_avg_f: number;
  precip_chance: number;
  season: 'spring' | 'summer' | 'fall' | 'winter';
  occasion: string | null;
}

/**
 * Filter items by suitability for the current context.
 *
 * The warmth-target heuristic was previously too strict — at 53°F (target 3),
 * a thick warmth-5 sweater would get filtered out, leaving the user with only
 * the lightest layers. Loosened to ±2 to keep more options on the table.
 */
export function filterForContext(items: Item[], ctx: OutfitContext): Item[] {
  const targetWarmth = warmthTarget(ctx.temp_avg_f);
  return items.filter((item) => {
    if (item.warmth_score != null) {
      if (Math.abs(item.warmth_score - targetWarmth) > 2) return false;
    }
    if (item.season_tags.length > 0 && !item.season_tags.includes(ctx.season)) {
      return false;
    }
    return true;
  });
}

function warmthTarget(tempF: number): number {
  if (tempF >= 80) return 1;
  if (tempF >= 65) return 2;
  if (tempF >= 50) return 3;
  if (tempF >= 35) return 4;
  return 5;
}

export function currentSeason(d = new Date()): 'spring' | 'summer' | 'fall' | 'winter' {
  const m = d.getMonth();
  if (m >= 2 && m <= 4) return 'spring';
  if (m >= 5 && m <= 7) return 'summer';
  if (m >= 8 && m <= 10) return 'fall';
  return 'winter';
}

// ---------------------------------------------------------------------------
// Style aesthetic groups
// ---------------------------------------------------------------------------
//
// We group style tags into broad aesthetic families. Mixing pieces from
// incompatible families (e.g. sporty + bohemian + romantic) produces the
// "three styles fighting" outfits we want to avoid. Pieces with shared
// family tags or no family tags are compatible.

type Aesthetic = 'sporty' | 'feminine' | 'casual' | 'edgy' | 'preppy' | 'bohemian' | 'formal';

const STYLE_TAG_AESTHETICS: Record<string, Aesthetic[]> = {
  sporty: ['sporty'],
  athleisure: ['sporty'],
  loungewear: ['sporty', 'casual'],
  workout: ['sporty'],
  romantic: ['feminine'],
  feminine: ['feminine'],
  parisian: ['feminine', 'casual'],
  bohemian: ['bohemian'],
  boho: ['bohemian'],
  vintage: ['bohemian', 'feminine'],
  preppy: ['preppy'],
  classic: ['preppy', 'formal'],
  workwear: ['preppy', 'formal'],
  formal: ['formal'],
  elevated: ['formal', 'preppy'],
  casual: ['casual'],
  minimalist: ['casual', 'formal'],
  edgy: ['edgy'],
  grunge: ['edgy'],
};

function getAesthetics(tags: string[]): Set<Aesthetic> {
  const out = new Set<Aesthetic>();
  for (const tag of tags) {
    const mapped = STYLE_TAG_AESTHETICS[tag.toLowerCase()];
    if (mapped) for (const a of mapped) out.add(a);
  }
  return out;
}

const INCOMPATIBLE_AESTHETIC_PAIRS: Array<[Aesthetic, Aesthetic]> = [
  ['sporty', 'feminine'],
  ['sporty', 'formal'],
  ['sporty', 'bohemian'],
  ['sporty', 'preppy'],
  ['formal', 'bohemian'],
  ['edgy', 'preppy'],
  ['edgy', 'formal'],
];

function aestheticConflict(a: Set<Aesthetic>, b: Set<Aesthetic>): boolean {
  for (const [x, y] of INCOMPATIBLE_AESTHETIC_PAIRS) {
    if ((a.has(x) && b.has(y)) || (a.has(y) && b.has(x))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Color harmony
// ---------------------------------------------------------------------------

const NEUTRAL_COLORS = new Set([
  'white', 'cream', 'ivory', 'beige', 'tan', 'khaki', 'taupe', 'gray', 'grey',
  'black', 'navy', 'denim', 'silver', 'gold', 'brown',
]);

function isNeutral(color: string): boolean {
  return NEUTRAL_COLORS.has(color.toLowerCase());
}

function hasOnlyNeutrals(colors: string[]): boolean {
  return colors.length > 0 && colors.every(isNeutral);
}

/**
 * Count distinct non-neutral colors across an outfit. More than ~2 distinct
 * non-neutrals tends to look chaotic. This is a soft signal, not a hard rule.
 */
function distinctNonNeutralColors(items: Array<{ colors: string[] }>): number {
  const set = new Set<string>();
  for (const it of items) {
    for (const c of it.colors) {
      if (!isNeutral(c)) set.add(c.toLowerCase());
    }
  }
  return set.size;
}

// ---------------------------------------------------------------------------
// Coherence scoring
// ---------------------------------------------------------------------------
//
// Pre-Claude scoring: cheap heuristic that assigns each candidate outfit a
// coherence score. We use this to rank candidates BEFORE sending to Claude
// so we send only the most promising ones (saves tokens and gives Claude
// a tighter set to discriminate on).

interface ScoredCandidate {
  candidate: CandidateOutfit;
  score: number;
}

function coherenceScore(items: Item[]): number {
  let score = 100;

  // Aesthetic conflicts: -25 per conflicting pair
  const aesthetics = items.map((i) => getAesthetics(i.style_tags));
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (aestheticConflict(aesthetics[i], aesthetics[j])) {
        score -= 25;
      }
    }
  }

  // Color complexity: prefer outfits with one "hero" non-neutral and the rest
  // neutral, or two non-neutrals that share a tone story. Three+ distinct
  // non-neutral colors usually looks chaotic.
  const distinctColors = distinctNonNeutralColors(items);
  if (distinctColors === 0) score += 5; // all-neutrals look polished
  else if (distinctColors === 1) score += 10; // one hero color, classic
  else if (distinctColors === 2) score -= 5; // two non-neutrals — needs care
  else if (distinctColors >= 3) score -= 20; // chaotic

  // Pattern overload: rough proxy via sub_category strings containing
  // pattern words. We don't have a dedicated pattern field surfaced here,
  // so we fall back on item names.
  const patternedCount = items.filter((it) => isPatterned(it)).length;
  if (patternedCount >= 2) score -= 15;
  if (patternedCount >= 3) score -= 25;

  // Formality alignment: spread of formality scores within the outfit.
  // Mixing formality 1 (loungewear) with formality 4 (workwear) looks off.
  const formalities = items
    .map((i) => i.formality_score)
    .filter((f): f is number => f != null);
  if (formalities.length >= 2) {
    const min = Math.min(...formalities);
    const max = Math.max(...formalities);
    if (max - min >= 3) score -= 20;
    else if (max - min === 2) score -= 8;
  }

  return score;
}

function isPatterned(item: Item): boolean {
  const text = `${item.name ?? ''} ${item.sub_category ?? ''}`.toLowerCase();
  const PATTERN_WORDS = [
    'floral', 'print', 'striped', 'stripe', 'plaid', 'check',
    'paisley', 'graphic', 'patterned', 'leopard', 'rose', 'flower',
  ];
  return PATTERN_WORDS.some((w) => text.includes(w));
}

// ---------------------------------------------------------------------------
// Candidate generation
// ---------------------------------------------------------------------------
//
// Strategy:
//   1. Build a large pool of possible outfits
//   2. Score each via the heuristic above
//   3. Return the top N by score, NOT just the first N built
//
// This means Claude only sees the most promising ~12-15 candidates, and the
// "obviously bad" combinations (sporty hoodie over a romantic dress) get
// filtered out before they ever reach the AI.
//
// Outerwear is now context-dependent:
//   - Below 50°F: outerwear required on every candidate
//   - 50-60°F: outerwear is optional (mix of with-and-without candidates)
//   - 60°F+: outerwear excluded entirely

export function generateCandidates(
  items: Item[],
  ctx: OutfitContext,
  maxCandidates = 15
): CandidateOutfit[] {
  const shirts = items.filter((i) => i.category === 'shirt');
  const pants = items.filter((i) => i.category === 'pants');
  const shoes = items.filter((i) => i.category === 'shoes');
  const purses = items.filter((i) => i.category === 'purse');
  const dresses = items.filter(
    (i) => i.category === 'dress' || i.occupies_slots.includes('shirt')
  );
  const outerwear = items.filter((i) => i.category === 'outerwear');
  const accessories = items.filter((i) => i.category === 'accessory');

  let outerPool: Array<Item | null>;
  if (ctx.temp_avg_f < 50) {
    // Cold — require outerwear if available
    outerPool = outerwear.length ? outerwear.slice(0, 5) : [null];
  } else if (ctx.temp_avg_f < 60) {
    // Mild — let user decide; mix of with-and-without candidates
    outerPool = [null, ...outerwear.slice(0, 3)];
  } else {
    // Warm — no outerwear
    outerPool = [null];
  }

  const accPool: Array<Item | null> = [null, ...accessories.slice(0, 2)];
  const pursePool: Array<Item | null> = purses.length ? [null, ...purses.slice(0, 4)] : [null];
  const shoePool: Array<Item | null> = shoes.length ? shoes.slice(0, 6) : [null];

  // Build all combinations, then score and trim
  const all: ScoredCandidate[] = [];
  let cId = 0;
  const buildCandidate = (pieces: Array<Item | null>) => {
    const filtered = pieces.filter((p): p is Item => !!p);
    if (filtered.length < 2) return;
    const candidate: CandidateOutfit = {
      id: `c${cId++}`,
      items: filtered.map((p) => ({
        id: p.id,
        category: p.category,
        sub_category: p.sub_category,
        colors: p.colors,
        style_tags: p.style_tags,
        warmth_score: p.warmth_score,
        formality_score: p.formality_score,
        brand: p.brand,
        name: p.name,
      })),
    };
    all.push({ candidate, score: coherenceScore(filtered) });
  };

  // Generate combos. We cap the per-category slice to limit explosion.
  for (const sh of shoePool) {
    for (const pu of pursePool) {
      for (const out of outerPool) {
        for (const acc of accPool) {
          // Dress combos
          for (const d of dresses.slice(0, 8)) {
            buildCandidate([d, sh, pu, out, acc]);
          }
          // Shirt + pants combos
          for (const s of shirts.slice(0, 6)) {
            for (const p of pants.slice(0, 6)) {
              buildCandidate([s, p, sh, pu, out, acc]);
            }
          }
        }
      }
    }
  }

  // Sort by coherence score and take top N
  all.sort((a, b) => b.score - a.score);
  return all.slice(0, maxCandidates).map((s) => s.candidate);
}
