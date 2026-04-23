# Wardrobe

Personal wardrobe PWA. Self-hosted, private, curated.

- **URL:** https://wardrobe.virginiaholland.art
- **Server path:** `/home/virginiaholland-wardrobe/htdocs/wardrobe.virginiaholland.art/`
- **Process manager:** pm2
- **Port:** 3000 (reverse-proxied by CloudPanel nginx)

---

## Where to configure things (quick reference)

| Thing | Where |
|---|---|
| Which emails can sign in | `lib/allowlist.json` |
| API keys, DB URL, AUTH_SECRET, session length | `.env` (copy from `.env.example`) |
| Home location for weather | `.env` → `DEFAULT_LATITUDE` / `DEFAULT_LONGITUDE` (already set to 11773 Beacon Hill Dr) |
| nginx config | CloudPanel → Sites → wardrobe.virginiaholland.art → Vhost (paste from `deploy/nginx-vhost.conf`) |

---

## One-time server setup

### 1. Node 22

Already installed per your server conventions (`~/local/node`). Confirm:

```bash
node -v   # should be v22.x
npm -v
```

### 2. Postgres database

```bash
sudo -u postgres psql <<'SQL'
CREATE USER wardrobe WITH PASSWORD 'REPLACE_WITH_STRONG_PASSWORD';
CREATE DATABASE wardrobe OWNER wardrobe;
GRANT ALL PRIVILEGES ON DATABASE wardrobe TO wardrobe;
SQL
```

Schema is applied automatically via `npm run migrate` below. If Postgres is on port 5433 (your Gamjo pattern), update `DATABASE_URL` accordingly. Default below assumes 5432.

### 3. pm2

```bash
npm i -g pm2
```

### 4. CloudPanel site

In CloudPanel, create a new **Reverse Proxy** site:
- Domain: `wardrobe.virginiaholland.art`
- Reverse proxy URL: `http://127.0.0.1:3000`

Then open the site's **Vhost** tab and paste the contents of `deploy/nginx-vhost.conf` over the default. CloudPanel will fill in the `{{...}}` template variables on save.

**Do not enable Basic Auth on this site** — it breaks the PWA flow (same issue you hit on Gamjo).

---

## Deploying the code

```bash
cd /home/virginiaholland-wardrobe/htdocs/wardrobe.virginiaholland.art/

# 1. Unzip the source here

# 2. Configure secrets
cp .env.example .env
nano .env
# - Set AUTH_SECRET: openssl rand -base64 48
# - Set DATABASE_URL, RESEND_API_KEY, EMAIL_FROM, ANTHROPIC_API_KEY
# - APP_ROOT already set to this directory
# - DEFAULT_LATITUDE/LONGITUDE already set to the Plymouth address

# 3. Edit the email allowlist
nano lib/allowlist.json
# Replace the example emails with Virginia's and yours

# 4. Install, migrate, build
npm install
npm run migrate
npm run build

# 5. Start with pm2
pm2 start npm --name wardrobe -- start
pm2 save
pm2 startup   # run the command it prints once

# Verify
curl -I http://127.0.0.1:3000
pm2 logs wardrobe --lines 50
```

Visit https://wardrobe.virginiaholland.art, enter an allowlisted email, get the 6-digit code, sign in. Good for 90 days.

---

## Filesystem layout after deploy

```
/home/virginiaholland-wardrobe/htdocs/wardrobe.virginiaholland.art/
├── .next/                    # build output (created by npm run build)
├── app/                      # source
├── components/
├── lib/
│   └── allowlist.json        # ← edit to control who can sign in
├── migrations/
│   └── 001_initial.sql
├── public/
│   └── icons/                # PWA icons, already generated
├── scripts/
│   ├── migrate.js
│   └── generate-icons.js
├── storage/                  # ← user data, never commit
│   └── images/
│       ├── items/<userId>/<id>.jpg
│       ├── items-nobg/<userId>/<id>.png
│       ├── thumbs/<userId>/<id>.jpg
│       ├── wears/<userId>/<id>.jpg
│       └── wishlist/<userId>/<id>.jpg
├── deploy/
│   └── nginx-vhost.conf
├── .env                      # ← secrets, never commit
├── package.json
└── README.md
```

Images are never served directly by nginx. Every image request goes through `/api/images/[...path]`, which verifies the session cookie and enforces per-user ownership on the requested file path.

---

## .env reference

Values you must fill in:

```
AUTH_SECRET=                   # openssl rand -base64 48
DATABASE_URL=                  # e.g. postgres://wardrobe:PASS@localhost:5432/wardrobe
RESEND_API_KEY=                # from resend.com
EMAIL_FROM="Wardrobe <no-reply@virginiaholland.art>"
ANTHROPIC_API_KEY=             # from console.anthropic.com
```

Already-correct defaults:

```
APP_ROOT=/home/virginiaholland-wardrobe/htdocs/wardrobe.virginiaholland.art
APP_URL=https://wardrobe.virginiaholland.art
DEFAULT_LATITUDE=42.36669326272332
DEFAULT_LONGITUDE=-83.4927024486844
DEFAULT_TIMEZONE=America/Detroit
SESSION_DAYS=90
ANTHROPIC_MODEL=claude-opus-4-7
```

---

## Day-to-day commands

```bash
pm2 logs wardrobe           # tail logs
pm2 restart wardrobe        # restart
npm run migrate             # apply new migrations
npm run build && pm2 restart wardrobe   # ship a code change
```

---

## Auth

- Email + 6-digit code. No passwords.
- Allowed emails live in `lib/allowlist.json`. Any email not on the list gets the same "check your email" response but never receives a code.
- Rate limit: 5 code requests per email per hour.
- Session is a JWT in an httpOnly secure cookie, 90-day sliding expiration.

To add or remove users, edit `lib/allowlist.json` and run `pm2 restart wardrobe`.

---

## AI behavior

- **Auto-tagging on upload**: image is sent to Claude which returns category, colors, style/season tags, warmth and formality scores, and a short name. Everything is editable before saving.
- **Outfit ranking**: rule-based candidate generator filters by weather and season, then Claude picks and explains the top 3.
- **Wishlist suggestions**: closet composition is summarized and sent to Claude with the "no fast fashion unless thrifted" philosophy baked into the system prompt. Suggestions favor quality brands and call out when thrifting is the better move.
- **Packing mode**: destination forecast + occasion tags → Claude picks a versatile set of items and outfits them day by day.

---

## Dress substitution

Dresses occupy both the shirt and pants slots (stored in `items.occupies_slots` as `['shirt','pants']`). The outfit engine treats each outfit as either one dress-slot item OR one shirt + one pants, never both. Same mechanism handles jumpsuits or coord sets.
