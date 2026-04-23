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
 */
export function filterForContext(items: Item[], ctx: OutfitContext): Item[] {
  const targetWarmth = warmthTarget(ctx.temp_avg_f);
  return items.filter((item) => {
    // Warmth: allow +/- 1 of target. Items with no warmth score pass.
    if (item.warmth_score != null) {
      if (Math.abs(item.warmth_score - targetWarmth) > 1) return false;
    }
    // Season: if item has season tags, it must include the current season.
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

/**
 * Generate candidate outfits. Each outfit is either:
 *   shirt + pants + shoes + purse   (classic)
 *   dress-slot-item + shoes + purse (dress / jumpsuit)
 * Plus optional outerwear if cold, plus optional accessory.
 *
 * We cap combinations to avoid explosion on large closets.
 */
export function generateCandidates(
  items: Item[],
  ctx: OutfitContext,
  maxCandidates = 40
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

  const needsOuter = ctx.temp_avg_f < 55;
  const outerPool: Array<Item | null> = needsOuter
    ? outerwear.length
      ? outerwear
      : [null]
    : [null];
  const accPool: Array<Item | null> = accessories.length ? [null, ...accessories.slice(0, 3)] : [null];
  const pursePool: Array<Item | null> = purses.length ? purses : [null];

  const candidates: CandidateOutfit[] = [];
  let id = 0;
  const push = (pieces: Array<Item | null>) => {
    const filtered = pieces.filter((p): p is Item => !!p);
    if (filtered.length < 2) return;
    candidates.push({
      id: `c${id++}`,
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
    });
  };

  outer: for (const sh of shoes.length ? shoes : [null]) {
    for (const pu of pursePool) {
      for (const out of outerPool) {
        for (const acc of accPool) {
          // Dress combos
          for (const d of dresses.slice(0, 10)) {
            push([d, sh, pu, out, acc]);
            if (candidates.length >= maxCandidates) break outer;
          }
          // Shirt + pants combos
          for (const s of shirts.slice(0, 8)) {
            for (const p of pants.slice(0, 8)) {
              push([s, p, sh, pu, out, acc]);
              if (candidates.length >= maxCandidates) break outer;
            }
          }
        }
      }
    }
  }

  return candidates;
}
