import Anthropic from '@anthropic-ai/sdk';

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

/**
 * Counter that increments on every Anthropic API call. Used to give each
 * call a stable identifier in the logs so you can trace which client request
 * triggered it.
 */
let _anthropicCallCount = 0;

/**
 * Wrapper around `client().messages.create()` that logs every call.
 *
 * Each call prints a single line with:
 *   - sequential call number (since process start)
 *   - the caller label (e.g. "rankOutfits", "tagItemImage")
 *   - the model used
 *   - the route file that triggered it (extracted from the stack)
 *   - duration on completion
 *
 * If you suspect API leakage, grep pm2 logs for `[anthropic]` to see every
 * call in chronological order. Sudden bursts or unexpected sources will be
 * obvious.
 */
async function anthropicCall(
  label: string,
  params: Anthropic.MessageCreateParamsNonStreaming
): Promise<Anthropic.Message> {
  _anthropicCallCount++;
  const id = _anthropicCallCount;
  const route = inferCallerRoute();
  const t0 = Date.now();
  console.log(
    `[anthropic #${id}] CALL label=${label} model=${params.model} route=${route}`
  );
  try {
    const result = await client().messages.create(params);
    const duration = Date.now() - t0;
    const usage = result.usage;
    console.log(
      `[anthropic #${id}] DONE  label=${label} duration=${duration}ms in=${usage?.input_tokens ?? '?'}t out=${usage?.output_tokens ?? '?'}t`
    );
    return result;
  } catch (e: any) {
    console.error(
      `[anthropic #${id}] FAIL  label=${label} duration=${Date.now() - t0}ms error=${e?.message}`
    );
    throw e;
  }
}

/**
 * Walk the V8 stack trace and find the first frame outside this file. That
 * tells us which API route is making the call. Returns "<unknown>" if we
 * can't figure it out — better than crashing the request.
 */
function inferCallerRoute(): string {
  const stack = new Error().stack ?? '';
  const lines = stack.split('\n').slice(2); // skip "Error" line + this fn
  for (const line of lines) {
    // Look for app/api/.../route.ts or app/.../page.tsx
    const m = line.match(/\(([^)]*\/(app)\/[^)]+)\)/) ?? line.match(/\s+at\s+([^\s]*\/(app)\/[^\s]+)/);
    if (m && m[1]) {
      // Pull just the meaningful suffix: app/api/recommend/route.ts:LINE
      const path = m[1].replace(/^.*\/(?=app\/)/, '').replace(/\?.*$/, '');
      return path;
    }
    // Also accept lib/* callers (e.g. an internal helper that calls another)
    const libMatch = line.match(/\(([^)]*\/lib\/[^)]+)\)/);
    if (libMatch && libMatch[1]) {
      return libMatch[1].replace(/^.*\/(?=lib\/)/, '');
    }
  }
  return '<unknown>';
}

// Two-model setup:
//   FAST  = image tagging on upload + wishlist gap analysis (frequent, low-stakes)
//   SMART = outfit ranking + packing plans (aesthetic + multi-day reasoning)
// Each task can also be overridden individually via its own env var.
const FAST_MODEL     = process.env.ANTHROPIC_MODEL_FAST     ?? 'claude-haiku-4-5';
const SMART_MODEL    = process.env.ANTHROPIC_MODEL_SMART    ?? 'claude-sonnet-4-6';

const MODEL_TAG      = process.env.ANTHROPIC_MODEL_TAG      ?? FAST_MODEL;
const MODEL_WISHLIST = process.env.ANTHROPIC_MODEL_WISHLIST ?? FAST_MODEL;
const MODEL_RANK     = process.env.ANTHROPIC_MODEL_RANK     ?? SMART_MODEL;
const MODEL_PACKING  = process.env.ANTHROPIC_MODEL_PACKING  ?? SMART_MODEL;

/**
 * Extract and parse JSON from an LLM response. Handles:
 *   - Markdown fences ```json ... ```
 *   - Leading/trailing prose commentary
 *   - Multiple JSON blocks (picks the first well-formed one)
 *
 * This is more lenient than a bare JSON.parse because models sometimes
 * add preamble or trailing text despite "return only JSON" instructions.
 */
function parseJsonFromResponse<T>(raw: string): T {
  // Strip code fences if present
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

  // Fast path: is the whole thing already valid JSON?
  try {
    return JSON.parse(text) as T;
  } catch {
    // fall through to substring extraction
  }

  // Substring extraction: find the first { or [ and walk to its matching
  // close, respecting strings and nested braces. We don't use a regex
  // because JSON can legitimately contain braces inside string values.
  const startIdx = findFirst(text, ['{', '[']);
  if (startIdx === -1) {
    throw new Error(`No JSON found in response: ${text.slice(0, 200)}`);
  }

  const endIdx = findMatchingClose(text, startIdx);
  if (endIdx === -1) {
    throw new Error(`Unterminated JSON in response: ${text.slice(0, 200)}`);
  }

  const jsonStr = text.slice(startIdx, endIdx + 1);
  try {
    return JSON.parse(jsonStr) as T;
  } catch (e: any) {
    throw new Error(`Could not parse extracted JSON: ${e.message}. Text: ${jsonStr.slice(0, 200)}`);
  }
}

function findFirst(s: string, chars: string[]): number {
  for (let i = 0; i < s.length; i++) {
    if (chars.includes(s[i])) return i;
  }
  return -1;
}

function findMatchingClose(s: string, start: number): number {
  const openChar = s[start];
  const closeChar = openChar === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function extractText(message: any): string {
  return message.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('')
    .trim();
}

// =============================================================
// Image tagging
// =============================================================

export interface TaggedItem {
  category: 'shirt' | 'pants' | 'shoes' | 'purse' | 'dress' | 'outerwear' | 'accessory';
  sub_category: string;
  colors: string[];          // hex strings, primary first
  brand_guess: string | null;
  material: string | null;
  pattern: string | null;
  style_tags: string[];      // e.g. ['casual','preppy']
  season_tags: string[];     // subset of ['spring','summer','fall','winter']
  warmth_score: number;      // 1-5
  formality_score: number;   // 1-5
  name: string;              // short descriptive name
  notes: string | null;
}

const TAG_SYSTEM = `You are a wardrobe cataloging assistant. You will be given a photo of a single clothing item or accessory. Return only a JSON object with these fields:

{
  "category": "shirt" | "pants" | "shoes" | "purse" | "dress" | "outerwear" | "accessory",
  "sub_category": string (e.g. "silk blouse", "straight-leg jeans", "ankle boots", "tote"),
  "colors": string[] (hex codes, primary color first, max 3),
  "brand_guess": string | null (only if clearly visible, otherwise null),
  "material": string | null (e.g. "silk", "denim", "leather"),
  "pattern": string | null ("solid", "striped", "floral", etc.),
  "style_tags": string[] (e.g. ["casual","minimalist","elevated"]),
  "season_tags": string[] (subset of ["spring","summer","fall","winter"]),
  "warmth_score": integer 1-5 (1=hot weather, 5=deep winter),
  "formality_score": integer 1-5 (1=loungewear, 5=black tie),
  "name": string (short, under 40 chars),
  "notes": string | null (anything distinctive)
}

Return ONLY the JSON object, no preamble, no markdown fences.`;

export async function tagItemImage(imageBase64: string, mediaType: string): Promise<TaggedItem> {
  const message = await anthropicCall('tagItemImage', {
    model: MODEL_TAG,
    max_tokens: 800,
    system: TAG_SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType as any,
              data: imageBase64,
            },
          },
          { type: 'text', text: 'Catalog this item.' },
        ],
      },
    ],
  });

  const text = extractText(message);
  return parseJsonFromResponse<TaggedItem>(text);
}

// =============================================================
// Outfit ranking
// =============================================================

export interface CandidateOutfit {
  id: string;
  items: Array<{
    id: string;
    category: string;
    sub_category: string | null;
    colors: string[];
    style_tags: string[];
    warmth_score: number | null;
    formality_score: number | null;
    brand: string | null;
    name: string | null;
  }>;
}

export interface RankedOutfit {
  id: string;
  score: number;          // 0-100
  reasoning: string;      // one or two sentences
}

export async function rankOutfits(
  candidates: CandidateOutfit[],
  context: {
    temp_avg_f: number;
    summary: string;
    precip_chance: number;
    occasion: string | null;
  },
  topN = 3
): Promise<RankedOutfit[]> {
  const system = `You are styling a curated wardrobe for a young woman in her early 20s — college student, taste-conscious, leans Parisian-feminine and casually elevated. She values pieces that look pulled together without being fussy.

Your job: rank the candidate outfits and return ALL of them (sorted best-first), each with an honest score and reasoning.

Score the outfits on a 0-100 quality scale. Treat the score as a percentage match to "what a thoughtful stylist would actually pick for this person on this day":
  - 90-100: Truly excellent. Coherent aesthetic, clean color story, weather-appropriate, the kind of outfit she'd be happy to be photographed in.
  - 75-89: Solid. Works well, no obvious flaws, but not exciting.
  - 60-74: Acceptable. Some weakness — a slight aesthetic mismatch, a not-quite-right color, etc.
  - 40-59: Wearable but flawed. Don't recommend unless options are limited.
  - 0-39: Bad. Aesthetic clash, inappropriate for context, or chaotic styling.

Use the FULL range. If only one or two candidates are genuinely good, the rest should score below 75. We will display the top 3 by default but may show more if multiple genuinely score ≥ 90.

Style criteria for a good outfit:
- Coherent aesthetic — don't mix sporty with feminine, or bohemian with formal
- Clean color story — typically one "hero" color or two that share a tone (warm-and-cream, all-cool-tones, etc.) with the rest as neutrals
- At most ONE patterned/printed piece. Two prints clash unless intentionally style-mixed.
- Suits the actual context: athleisure pants don't belong on a casual-day outfit unless paired with intentional athleisure styling. Loungewear stays at home.
- Layers make sense: don't pair a delicate cardigan with a sporty hoodie; that's two outerwear-types fighting.

Reject (low score) outfits that:
- Mix three or more aesthetics
- Pair a sportswear hoodie with a feminine/floral/romantic shirt or skirt
- Combine multiple busy prints
- Layer two clearly-different outerwear types
- Include yoga/workout pants for non-athleisure occasions

Weather context: ${Math.round(context.temp_avg_f)}°F, ${context.summary}${context.precip_chance > 30 ? `, ${context.precip_chance}% precip` : ''}${context.occasion ? `. Occasion: ${context.occasion}` : ''}

CRITICAL — reasoning must be self-contained:
The user only ever sees ONE outfit's reasoning at a time, so each reasoning string MUST stand alone. Do NOT reference other candidate IDs (no "c61", "c12", "outfit 3", etc.). Do NOT compare to other candidates ("same problem as c61", "less versatile than the smocked dress"). Each reasoning explains why THIS outfit works (or doesn't) using only the pieces visible in this outfit and the weather/occasion context.

Be specific and honest. If something is "off" name it directly — if a top reads more "going out" than "casual day," say that, but don't compare to a different candidate.

Return ONLY a JSON array of ALL candidates ranked best-first, no preamble:
[
  { "id": "<outfit id>", "score": <0-100 integer>, "reasoning": "<one or two natural sentences, self-contained>" }
]`;

  const user = JSON.stringify({ context, candidates }, null, 2);

  const message = await anthropicCall('rankOutfits', {
    model: MODEL_RANK,
    max_tokens: 2500, // larger because we now ask for all candidates ranked, not just top N
    system,
    messages: [{ role: 'user', content: user }],
  });

  const text = extractText(message);
  return parseJsonFromResponse<RankedOutfit[]>(text);
}

// =============================================================
// Wishlist gap analysis
// =============================================================

export interface WishlistSuggestion {
  description: string;
  category: string;
  reason: string;
  brand_suggestions: string[];
  price_range: string;
  priority: number; // 1-5
}

export async function suggestWishlist(closetSummary: string): Promise<WishlistSuggestion[]> {
  const baseSystem = `You analyze a user's wardrobe and suggest 3-6 high-quality pieces that would fill real gaps.

The user's philosophy:
- Curating a high-quality, long-lasting wardrobe. No fast fashion (no SHEIN, Temu, Zara, H&M, etc.) UNLESS the piece is thrifted.
- Quality brands like Everlane, Quince, Reformation, Sezane, Madewell (select), Jenni Kayne, Filippa K, Cuyana, ARKET, COS (select), and similar. Investment pieces matter.
- For items that are well-suited to thrifting (denim, leather, wool coats, vintage bags, premium brands secondhand on sites like The RealReal, Vestiaire Collective, or Poshmark), prefer that over buying new.
- Focus on versatile pieces that work across many outfits.

Return ONLY a JSON array:
[
  {
    "description": string (specific: "silk midi slip skirt in bone or champagne"),
    "category": "shirt" | "pants" | "shoes" | "purse" | "dress" | "outerwear" | "accessory",
    "reason": string (one or two sentences explaining the gap it fills),
    "brand_suggestions": string[] (2-4 real brands, noting "thrifted" or "secondhand" where appropriate),
    "price_range": string (e.g. "$80-$150 new, under $50 thrifted"),
    "priority": integer 1-5 (5 = biggest gap)
  }
]`;

  // First attempt with the normal prompt
  try {
    const message = await anthropicCall('suggestWishlist', {
      model: MODEL_WISHLIST,
      max_tokens: 1500,
      system: baseSystem,
      messages: [{ role: 'user', content: closetSummary }],
    });
    const text = extractText(message);
    return parseJsonFromResponse<WishlistSuggestion[]>(text);
  } catch (firstError: any) {
    // Claude may have asked for more context instead of returning JSON —
    // common when the closet is sparse or empty. Retry once with a more
    // permissive prompt that instructs it to make reasonable assumptions
    // and always return JSON no matter what.
    console.warn('wishlist-suggest first attempt failed, retrying with fallback prompt', firstError.message);

    const fallbackSystem = `${baseSystem}

IMPORTANT OVERRIDES FOR THIS RESPONSE:
- The wardrobe data may be sparse, empty, or very limited. Do not ask for more information.
- Do your best with whatever data is provided. Make reasonable assumptions about what a curated wardrobe typically needs.
- If the closet is empty or nearly empty, suggest foundational wardrobe staples that work for any curated closet (well-fitting jeans, a quality white shirt, good leather boots, a timeless dress, a structured bag, etc.).
- Suggestions do not need to be perfect matches to existing pieces — they just need to be thoughtful recommendations for a high-quality curated wardrobe.
- You MUST return a JSON array matching the schema above. No commentary, no questions, no prose explanations, no markdown code fences. ONLY the JSON array.`;

    const message = await anthropicCall('suggestWishlist:retry', {
      model: MODEL_WISHLIST,
      max_tokens: 1500,
      system: fallbackSystem,
      messages: [{ role: 'user', content: closetSummary }],
    });
    const text = extractText(message);
    return parseJsonFromResponse<WishlistSuggestion[]>(text);
  }
}

// =============================================================
// Product search — given a wishlist idea, use web search to find
// real buyable products. Returns Claude's final text + structured
// product data extracted from search result citations.
// =============================================================

export interface FoundProduct {
  title: string;
  brand: string | null;
  price: string | null;
  url: string;
  source: string; // e.g. "everlane.com" — the domain, for display
  notes: string | null;
}

export interface ProductSearchResult {
  products: FoundProduct[];
  summary: string; // brief intro from Claude
  searched_queries: string[]; // what Claude actually searched
}

// Mass-market fast fashion domains — blocked from wishlist product searches
// to steer Claude toward quality/sustainable sources.
const BLOCKED_FAST_FASHION_DOMAINS = [
  'shein.com',
  'temu.com',
  'fashionnova.com',
  'prettylittlething.com',
  'boohoo.com',
  'missguided.com',
  'romwe.com',
  'zaful.com',
  'nastygal.com',
  'yesstyle.com',
  'cider.com',
  'urbanic.com',
  // Amazon fashion lives on amazon.com but mixes with non-fashion; leaving it
  // allowed for now since blocking all of amazon.com would starve searches.
];

export async function findProductsForSuggestion(suggestion: {
  description: string;
  category: string;
  reason?: string | null;
  brand_suggestions?: string[];
  price_range?: string | null;
}): Promise<ProductSearchResult> {
  const system = `You are helping curate a high-quality wardrobe. When given a wishlist idea, search the web to find 3-6 specific real products that match.

Priorities, in order:
1. Quality and longevity over trend chasing
2. Secondhand / thrifted options (The RealReal, Vestiaire Collective, Poshmark, Depop, eBay) when the piece is well-suited to thrifting (denim, leather, wool coats, designer bags)
3. Well-made mid-range brands (Everlane, Quince, Reformation, Sezane, Cuyana, ARKET, COS, Filippa K, Jenni Kayne)
4. Classic investment pieces from premium brands when the budget supports it

Search strategy:
- Run 2-4 targeted searches combining the item description with "thrifted", "secondhand", or specific quality brands
- Prefer direct product pages (everlane.com/products/..., therealreal.com/products/...) over listicles or magazine roundups
- If something looks like fast-fashion slop (synthetic, $15, trend-y), skip it

After searching, respond with ONLY a JSON object in this shape (no preamble, no markdown):
{
  "summary": string (one sentence intro, e.g. "Here are a few secondhand options..."),
  "products": [
    {
      "title": string (concise product name),
      "brand": string | null,
      "price": string | null (e.g. "$148" or "$80 (secondhand)"),
      "url": string (direct link to the product page),
      "source": string (just the domain, e.g. "everlane.com"),
      "notes": string | null (one short line about why this one fits)
    }
  ]
}

CRITICAL: Do NOT wrap any text in <cite> tags or include any citation markup inside the JSON string values. Write plain text only. The URL field is already the source attribution.`;

  const userPrompt = `Find specific products for this wishlist idea:

Description: ${suggestion.description}
Category: ${suggestion.category}
${suggestion.reason ? `Why needed: ${suggestion.reason}\n` : ''}${suggestion.brand_suggestions?.length ? `Brand hints: ${suggestion.brand_suggestions.join(', ')}\n` : ''}${suggestion.price_range ? `Budget: ${suggestion.price_range}\n` : ''}
Search the web and return 3-6 concrete products.`;

  const message = await anthropicCall('findProductsForSuggestion', {
    model: MODEL_WISHLIST,
    max_tokens: 4000,
    system,
    messages: [{ role: 'user', content: userPrompt }],
    tools: [
      {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 5,
        blocked_domains: BLOCKED_FAST_FASHION_DOMAINS,
      } as any,
    ],
  });

  // Parse the final text block. Web search responses interleave server_tool_use,
  // web_search_tool_result, and text blocks — we want just the text.
  const text = extractText(message);

  // Track which queries Claude actually ran, for display
  const searched_queries: string[] = [];
  for (const block of (message.content as any[])) {
    if (block.type === 'server_tool_use' && block.name === 'web_search') {
      const q = block.input?.query;
      if (q) searched_queries.push(q);
    }
  }

  try {
    const parsed = parseJsonFromResponse<{ summary: string; products: FoundProduct[] }>(text);
    return {
      summary: stripCitations(parsed.summary ?? ''),
      products: (parsed.products ?? []).map((p) => ({
        title: stripCitations(p.title),
        brand: p.brand ? stripCitations(p.brand) : null,
        price: p.price ? stripCitations(p.price) : null,
        url: p.url,
        source: p.source ? stripCitations(p.source) : p.source,
        notes: p.notes ? stripCitations(p.notes) : null,
      })),
      searched_queries,
    };
  } catch (e: any) {
    // If Claude refused to return JSON (possible with long search results),
    // return an empty product list with the raw text as summary so the UI
    // can at least show what came back.
    console.warn('product search parse failed, returning raw text', e);
    return {
      summary: stripCitations(text.slice(0, 300)),
      products: [],
      searched_queries,
    };
  }
}

/**
 * Strip citation markup that Claude injects around cited text when web search
 * is enabled. The model wraps cited phrases in <cite index="...">...</cite>
 * tags; we want the text content without the tags. Also handles a few edge
 * cases: self-closing cite tags, malformed tags, and doubled spaces left by
 * removed tags.
 */
function stripCitations(s: string): string {
  if (!s) return s;
  return s
    // Remove closing tag + its content's surrounding markup: <cite index="0">text</cite> -> text
    .replace(/<cite[^>]*?>([\s\S]*?)<\/cite>/gi, '$1')
    // Remove any stray opening tags that didn't get a matching close
    .replace(/<cite[^>]*?>/gi, '')
    // Remove any stray close tags
    .replace(/<\/cite>/gi, '')
    // Collapse doubled whitespace the removals may have left
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// =============================================================
// Packing mode
// =============================================================

export interface PackingPlan {
  selected_item_ids: string[];
  day_outfits: Array<{
    date: string;
    outfit_item_ids: string[];
    reasoning: string;
  }>;
  packing_notes: string;
}

export async function planPacking(
  closetJson: string,
  tripContext: {
    destination: string;
    days: Array<{ date: string; temp_min_f: number; temp_max_f: number; summary: string; precip_chance: number }>;
    occasions: string[];
  }
): Promise<PackingPlan> {
  const system = `You are a packing assistant. Given a user's closet and a trip forecast, pick a minimal set of versatile items that can mix-and-match across the trip, and propose a specific outfit for each day.

Prioritize: versatility (pieces that work in multiple outfits), weather appropriateness, and the listed occasions. Keep the total item count lean. It is fine to wear the same bottom or shoes multiple times.

Return ONLY a JSON object:
{
  "selected_item_ids": string[],
  "day_outfits": [
    { "date": "YYYY-MM-DD", "outfit_item_ids": string[], "reasoning": "<one or two sentences>" }
  ],
  "packing_notes": "<brief, natural note about the overall approach>"
}`;

  const user = JSON.stringify({ trip: tripContext, closet: JSON.parse(closetJson) });

  const message = await anthropicCall('planPacking', {
    model: MODEL_PACKING,
    max_tokens: 2500,
    system,
    messages: [{ role: 'user', content: user }],
  });

  const text = extractText(message);
  return parseJsonFromResponse<PackingPlan>(text);
}
