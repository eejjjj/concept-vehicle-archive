# Concept Vehicle Archive

Ninebot concept vehicle digital archive — intro wind wall, module catalog, vehicle detail pages.

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
├── index.html          → L1 intro (wind wall)
├── index/              → redirects to ../
├── catalog/            → L2 module directory
├── 001/  002/          → L3 vehicle detail (open modules)
├── status/  access/    → L3 nav pages
├── assets/             → logo & media
├── css/style.css
├── fonts/              → Ninebot Display
├── js/                 → app, data, motion, intro-three
├── scripts/            → vendor setup (Three.js)
├── vendor/             → Three.js (auto-downloaded)
└── preview.sh
```

## Routes

| Level | Page | URL |
|-------|------|-----|
| L1 · Intro | Wind wall entrance | `/` |
| L2 · Catalog | Module directory (目录页) | `/catalog/` |
| L3 · Status | Archive status | `/status/` |
| L3 · Access | Access control | `/access/` |
| L3 · Module 1/9 | NINEBOT EMAX (CV-001) | `/001/` **LOCKED** |
| L3 · Module 2/9 | NINEBOT NEXT (CV-002) | `/002/` |
| L3 · Module 3–9 | Locked | — |

- `/` — intro only; click anywhere to enter the archive
- `/catalog/` — the catalog/directory page (module grid)
- Logo on any page → `/` (back to wind wall)
- **Catalog** nav → `/catalog/` · **Status** → `/status/` · **Access** → `/access/`
- Only **01/09** and **02/09** modules are open in the catalog grid
- **`/001/` is locked** — 3D book detail; do not change unless explicitly requested (see `.cursor/rules/lock-001-detail.mdc`)

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
