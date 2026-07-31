# Concept Vehicle Archive

Ninebot concept vehicle digital archive — intro wind wall and vehicle detail pages.

## Online preview (GitHub Pages)

After pushing to GitHub, enable **Settings → Pages → Deploy from branch `main` / root**, then visit:

`https://eejjjj.github.io/concept-vehicle-archive/`

Paths auto-detect the repo prefix (`/concept-vehicle-archive/`) on GitHub Pages; local preview uses `/`.

## Local preview

```bash
cd "/Users/wangyizhen/Desktop/202607_档案馆/concept-vehicle-archive"
bash preview.sh
# open http://localhost:8765/
```

Or without the script:

```bash
cd "/Users/wangyizhen/Desktop/202607_档案馆/concept-vehicle-archive"
python3 -m http.server 8765
```

## Project structure

```
concept-vehicle-archive/
├── index.html          → L1 · Index intro (正交正面风动片)
├── og/                 → legacy perspective intro (not linked from site)
├── index/              → redirects to ../
├── front/              → redirects to ../
├── catalog/            → redirects to ../
├── isometric/          → redirects to ../
├── emax/  next/        → L2 · Vehicle detail (open modules)
├── 001/  002/          → redirects to emax / next
├── access/             → Access control
├── status/             → legacy page (not in main nav)
├── assets/             → logo & media
├── css/style.css
├── fonts/              → Ninebot Display
├── js/                 → app, data, motion, intro-three-front
├── scripts/            → vendor setup (Three.js)
├── vendor/             → Three.js (auto-downloaded)
└── preview.sh
```

## Routes

| Level | Page | URL |
|-------|------|-----|
| L1 · Index | Front-facing orthographic wind wall | `/` |
| L2 · EMAX | NINEBOT EMAX (CV-001) | `/emax/` **LOCKED book** |
| L2 · NEXT | NINEBOT NEXT (CV-002) | `/next/` |
| L2 · Access | Access control | `/access/` |
| Legacy · OG | Perspective wind wall | `/og/` (direct URL only) |

### Navigation

- Logo on any page → `/` (back to Index wind wall)
- Header nav on detail pages: **EMAX** → `/emax/` · **NEXT** → `/next/` · **Access** → `/access/`
- `/001/` redirects to `/emax/` · `/002/` redirects to `/next/`
- `/front/`, `/catalog/`, `/isometric/` redirect to `/`
- **`/emax/` book detail** — do not change unless explicitly requested (see `.cursor/rules/lock-001-detail.mdc`)

Do **not** open HTML directly (`file://`) — Three.js modules require HTTP.

## Push to GitHub

```bash
cd concept-vehicle-archive
git add .
git commit -m "Initial commit: concept vehicle archive"
git branch -M main
git remote add origin https://github.com/<your-username>/concept-vehicle-archive.git
git push -u origin main
```

Then: **GitHub repo → Settings → Pages → Source: main / (root)**.
