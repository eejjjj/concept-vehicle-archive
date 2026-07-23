# Concept Vehicle Archive

Ninebot concept vehicle digital archive — intro wind wall, module catalog, vehicle detail pages.

## Online preview (GitHub Pages)

After pushing to GitHub, enable **Pages → Deploy from branch `main` / root**, then visit:

`https://<your-username>.github.io/concept-vehicle-archive/`

Add `?reset=1` to force the intro wind wall:

`https://<your-username>.github.io/concept-vehicle-archive/?reset=1`

## Local preview

```bash
bash preview.sh
# open http://localhost:8765/index.html?reset=1
```

Do **not** open `index.html` directly (`file://`) — Three.js modules require HTTP.

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
