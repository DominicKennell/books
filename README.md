# DOMEVO Books (flat layout)

All files sit in one folder, so they upload to GitHub by drag and drop.

Files: index.html (the app), engine.js, catalog.js (150-book SAMPLE), build-catalog.js (builds the real catalogue), catalog.yml (monthly refresh), books.html (everything in one file, opens by double-click).

## Put it live
1. GitHub: new repository > "Add file" > "Upload files" > drag in index.html, engine.js, catalog.js, build-catalog.js, README.md. Commit.
2. Add the refresh workflow: "Add file" > "Create new file". In the name box type exactly `.github/workflows/catalog.yml` (typing the slashes makes the folders). Paste in the contents of catalog.yml from this folder. Commit.
3. Actions tab > "Refresh book catalogue" > Run workflow. It downloads Open Library's dumps, builds the real catalogue (about 15,000 books, with covers) and commits catalog.js. Then it refreshes monthly.
4. Settings > Pages > deploy from the main branch. Your site is live.

## Caveats
- The builder is tested on mock dumps, not the real files. If the first run fails or the book count is wrong, send the log.
- Check Open Library's terms before charging; keep the footer credit.
