import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { suggestWishlist } from '@/lib/anthropic';

export async function POST(_req: NextRequest) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Summarize closet: counts per category + sampled items with key attributes
  const categoryCounts = await query<{ category: string; count: string }>(
    `SELECT category, count(*)::text FROM items WHERE user_id = $1 GROUP BY category`,
    [session.userId]
  );

  const samples = await query(
    `SELECT category, sub_category, name, brand, colors, style_tags, season_tags,
            formality_score, warmth_score, acquired_from
     FROM items WHERE user_id = $1
     ORDER BY random()
     LIMIT 60`,
    [session.userId]
  );

  const existingWishes = await query<{ description: string }>(
    `SELECT description FROM wishlist WHERE user_id = $1 AND acquired_at IS NULL`,
    [session.userId]
  );

  const summary = JSON.stringify(
    {
      counts_by_category: Object.fromEntries(
        categoryCounts.map((c) => [c.category, parseInt(c.count, 10)])
      ),
      sample_items: samples,
      existing_wishlist: existingWishes.map((w) => w.description),
    },
    null,
    2
  );

  try {
    const suggestions = await suggestWishlist(summary);
    return NextResponse.json({ suggestions });
  } catch (e: any) {
    console.error('wishlist-suggest error', e);
    return NextResponse.json({ error: 'suggestion failed', detail: e.message }, { status: 500 });
  }
}

export const runtime = 'nodejs';
export const maxDuration = 60;
