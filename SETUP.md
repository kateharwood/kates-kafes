# Kate's Kafes — Setup

## 1. Google Maps API key

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project (or pick an existing one).
3. Enable **Maps JavaScript API**.
4. Create an API key under **APIs & Services → Credentials**.
5. Restrict the key:
   - **Application restrictions:** HTTP referrers
   - Add `http://localhost:3000/*` for local dev
   - Add your production domain later (e.g. `https://kateskafes.com/*`)
6. Copy the key:

```bash
cp js/config.example.js js/config.js
```

Edit `js/config.js` and paste your API key.

## 2. Run locally

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000).

## 3. Google Sheet (your mobile-friendly editor)

### Create the sheet

1. Go to [Google Sheets](https://sheets.google.com) → **Blank spreadsheet**.
2. Name it **Kate's Kafes**.
3. **File → Import → Upload** and choose `data/cafes.csv`.
4. Import location: **Replace current sheet**.

### Column guide

| Column | What to enter |
|--------|----------------|
| `name` | Cafe name |
| `lat` / `lng` | Leave as-is (auto-filled). Don't edit unless fixing a pin. |
| `rating` | `0`, `0.5`, `1`, `1.5`, `2`, `3`, or blank = not tried |
| `walk_mins` | Minutes walk from 7th & 2nd |
| `food` | Free text notes about food |
| `food_yes_or_no` | `Yes` or `No` for tried cafes; leave blank if not tried yet |
| `notes` | Free text |
| `maps_url` | Google Maps link |
| `status` | `active`, `closed`, or `unratable` |
| `auto_added` | `TRUE` only for auto-discovered cafes (future feature) |
| `tried` | `TRUE`/`FALSE` — optional; site derives this from rating |

**Rating scale:** 0 = never again · 1 = meh · 2 = would regularly go · 3 = a fave

### Publish for the website

1. **File → Share → Publish to web**
2. Choose the sheet tab → **Comma-separated values (.csv)**
3. Click **Publish** and copy the URL.
4. Paste it into `js/config.js` as `SHEET_CSV_URL`.

The site will load live data from your sheet. Until then, it uses `data/cafes.json`.

> Only you need edit access to the sheet. The published CSV link is read-only.

## 4. Deploy (Vercel — free)

1. Push this project to GitHub.
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → import the repo.
3. Before deploying, add **Environment Variables** (Project Settings → Environment Variables):

| Variable | Required | Notes |
|----------|----------|-------|
| `GOOGLE_MAPS_API_KEY` | Yes | Your Maps JavaScript API key |
| `SHEET_CSV_URL` | No | Published Google Sheet CSV URL |
| `HOME_LAT` | No | Defaults to `40.6706039` |
| `HOME_LNG` | No | Defaults to `-73.9782784` |

Apply to **Production**, **Preview**, and **Development** so all deploys work.

4. Deploy. Vercel runs `npm run build`, which generates `js/config.js` from those variables.
5. Add your Vercel URL to the Maps API key HTTP referrer restrictions, e.g.:

   ```
   https://your-project.vercel.app/*
   https://*.vercel.app/*
   ```

6. When you have a custom domain, add that URL to the key restrictions too.

> Locally you still use `js/config.js` (gitignored). On Vercel, config is generated at build time — never commit secrets.

## 5. Custom domain

Buy a domain (Namecheap, Google Domains, etc.) and connect it in Vercel → **Settings → Domains**.

## Stretch goal: auto-discover new cafes (not built yet)

Planned behavior:

- Scan weekly within ~25 min walk (~2 km) of 7th & 2nd St
- New places auto-append to sheet with `status=active`, blank rating, `auto_added=TRUE`
- Show as blue markers with dashed ring until you review

## Regenerate local data from Google Doc

If you update the source doc:

```bash
npm run generate-data
```

This refreshes `data/cafes.json` and `data/cafes.csv` from your [Coffee Shop Exploration doc](https://docs.google.com/document/d/1QWughEV5NUyN4jirjhx82u-4p9fp_7GiWigqgmC5cY0/edit?usp=sharing).
