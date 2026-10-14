#!/usr/bin/env node
'use strict';
/* Builds catalog.js (the book data the page loads) from Open Library's monthly bulk dump files.
   https://openlibrary.org/developers/dumps
   Usage:
     node tools/build-catalog.js --works ol_dump_works.txt.gz --authors ol_dump_authors.txt.gz \
        --ratings ol_dump_ratings.txt.gz --reading-log ol_dump_reading-log.txt.gz --out catalog.js [--max 15000] [--min-pop 25]
   Files may be .gz or plain text. Everything is streamed, so memory stays modest. */
const fs = require('fs');
const zlib = require('zlib');
const readline = require('readline');


// ---- duplicates ----------------------------------------------------------------------------------------------------
// Open Library has many "works" for one book (editions, translations, series-numbered titles, name spellings).
// Two records count as the same book when their trimmed titles match and they share an author surname.
const ALIAS = { 'nineteen eighty four': '1984', 'harry potter and the sorcerers stone': 'harry potter and the philosophers stone' };
const titleKey = (t) => { const k = titleKey0(t); return ALIAS[k] || k; };
const titleKey0 = (t) => String(t).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[\(\[].*?[\)\]]/g, ' ')            // "(Dune Chronicles, #1)", "[large print]"
  .split(/\s*(?::|;|\s[-\u2013\u2014]\s)/)[0]      // drop subtitles
  .replace(/[\u2019']/g, '').replace(/^(the|a|an)\s+/, '').replace(/&/g, 'and')
  .replace(/[^a-z0-9]+/g, ' ').trim();
const surname = (a) => { const w = String(a).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((x) => x.length > 1); return w.length ? w[w.length - 1] : ''; };
function dedupe(recs) {                              // recs sorted by popularity, best first: the first copy wins
  const seen = new Map(), out = [];
  for (const r of recs) {
    const tk = titleKey(r.title); if (!tk) continue;
    const sn = [...new Set(r.authors.map(surname).filter(Boolean))];
    const hit = sn.map((x) => seen.get(tk + '|' + x)).find(Boolean);
    if (hit) { if (!hit.cover && r.cover) hit.cover = r.cover; if (!hit.desc && r.desc) hit.desc = r.desc; if (!hit.year && r.year) hit.year = r.year; continue; }
    sn.forEach((x) => seen.set(tk + '|' + x, r)); out.push(r);
  }
  return out;
}

// ---- reading dump files --------------------------------------------------------------------------------------------
async function* lines(file) {
  let stream = fs.createReadStream(file);
  if (/\.gz$/i.test(file)) stream = stream.pipe(zlib.createGunzip());
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) if (line) yield line;
}
const wkey = (cols) => { for (const c of cols) { const m = /^\/works\/(OL\d+W)$/.exec(c); if (m) return m[1]; } return null; };

// ---- subjects -> broad genres --------------------------------------------------------------------------------------
// First match wins the order; a book keeps up to 4 genres. Fiction/non-fiction fallbacks are added at the end.
const GENRE_RULES = [
  ['Science Fiction', /science fiction|sci-fi|cyberpunk|space opera|space flight|first contact|alien|robots|artificial intelligence|time travel|space warfare|virtual reality|post-apocalyptic/],
  ['Fantasy', /fantasy|wizard|magic|dragons|fairies|mythology|witches|necromancer|fairy tale|supernatural|vampires|elves|sorcery/],
  ['Dystopian', /dystopia|totalitarian|post-apocalyptic/],
  ['Mystery & Crime', /mystery|detective|murder|crime|private investigators|police|whodunit|noir/],
  ['Thriller', /thriller|espionage|spy stories|suspense|conspiracies|psychological fiction/],
  ['Horror', /horror|haunted|ghosts|gothic|monsters|occult|zombies/],
  ['Romance', /romance|love stories|courtship/],
  ['Historical Fiction', /historical fiction|world war|napoleonic|tudors|middle ages|french revolution|civil war|holocaust|ancient (rome|greece)/],
  ['Classics', /classic literature|classics|victorian|nineteenth century/],
  ['Young Adult', /young adult|teenagers|juvenile fiction|coming of age|boarding schools|high schools/],
  ["Children's", /children's|picture books|juvenile literature|fairy tales|bedtime/],
  ['Adventure', /adventure|pirates|voyages|survival|sea stories|exploration|quests/],
  ['Humor', /humor|humour|satire|comedy|funny/],
  ['Biography & Memoir', /biography|memoir|autobiograph|diaries|personal narratives/],
  ['History', /^history|world history|civilization|military history|ancient history|\bwars?\b(?! and peace)/],
  ['Science & Nature', /^science$|popular works|physics|biology|evolution|astronomy|cosmology|genetics|medicine|nature|ecology|mathematics/],
  ['Psychology & Self-Help', /psychology|self-help|self-improvement|habit|motivation|happiness|mindfulness|personal growth|success/],
  ['Business & Economics', /business|economics|entrepreneur|management|leadership|finance|marketing|innovation|startups/],
  ['Philosophy & Religion', /philosophy|stoicism|ethics|religion|spirituality|theology|meaning/],
  ['Contemporary Fiction', /contemporary fiction|literary fiction|domestic fiction|family life|friendship/],
];
// Tags that say nothing about the book, plus library/admin labels.
const JUNK = /^(accessible book|protected daisy|in library|large type books|lending library|open library staff picks|reading level|new york times bestseller|nyt|award|fiction|general|english|english language|literature|books|novel|novels|specimens|translations|plays|spanish|french|texts|large print|internet archive wishlist|popular works|juvenile fiction|juvenile literature|fiction, general|biography|history|science|romance|mystery|fantasy|horror|thriller|classic literature|classics|humor|philosophy|psychology|business|economics|self-help|young adult fiction|children's fiction|science fiction|detective and mystery stories|historical fiction|dystopias|love stories|adventure|short stories|autobiography|memoirs|contemporary fiction|gothic fiction|post-apocalyptic fiction|biography & autobiography|fiction in english|reading|study and teaching|criticism and interpretation)$|^(nyt:|award:|reading level|series:|collectionid:|lccn|dewey|in library|ebooks)/i;
const FICTION = /fiction|novel|stories|fantasy|mystery|romance|thriller|horror|dystopia/i;

const clean = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').replace(/^[\s"'(]+|[\s"')\.,;:]+$/g, '').trim();
function genresOf(subjects) {
  const text = subjects.map(clean);
  const hits = [];
  for (const [g, re] of GENRE_RULES) {
    const n = text.filter((t) => re.test(t)).length;
    if (n) hits.push([g, n]);
  }
  // keep rule order priority but prefer genres matched by more tags
  hits.sort((a, b) => b[1] - a[1] || GENRE_RULES.findIndex((r) => r[0] === a[0]) - GENRE_RULES.findIndex((r) => r[0] === b[0]));
  // a book tagged as fiction is not a science or history book just because it mentions ecology or war
  const isFiction = text.some((t) => /fiction|novel|stories/.test(t));
  const NONFIC = new Set(['Science & Nature', 'History', 'Business & Economics', 'Psychology & Self-Help', 'Biography & Memoir']);
  const out = hits.filter((h) => !(isFiction && NONFIC.has(h[0]))).slice(0, 4).map((h) => h[0]);
  if (!out.length) out.push(text.some((t) => FICTION.test(t)) ? 'Fiction' : 'Non-fiction');
  return out;
}
function describe(d) {
  let t = typeof d === 'string' ? d : d && typeof d.value === 'string' ? d.value : '';
  t = t.split(/\r?\n-{3,}/)[0].replace(/\[([^\]]+)\]\[\d+\]/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\(\[source\][^)]*\)/gi, '').replace(/https?:\/\/\S+/g, '').replace(/[*_#>`]/g, '').replace(/\s+/g, ' ').trim();
  return t;
}
const year = (d) => { const m = /(-?\d{3,4})/.exec(String(d || '')); const y = m ? parseInt(m[1], 10) : 0; return y > 0 && y < 2100 ? y : 0; };

async function build(o) {
  const log = o.log || (() => {});
  const max = o.max || 15000, minPop = o.minPop == null ? 25 : o.minPop, descLen = o.descLen == null ? 240 : o.descLen;

  // 1. popularity: ratings and shelving counts per work
  const rate = new Map(), want = new Map();
  if (o.ratings) {
    let n = 0;
    for await (const line of lines(o.ratings)) {
      const cols = line.split('\t'), k = wkey(cols); if (!k) continue;
      const r = cols.map(Number).find((x, i) => i > 0 && x >= 1 && x <= 5 && Number.isInteger(x));
      if (!r) continue;
      const a = rate.get(k) || [0, 0]; a[0] += 1; a[1] += r; rate.set(k, a); n++;
    }
    log(`ratings: ${n} rows, ${rate.size} works`);
  }
  if (o.readingLog) {
    let n = 0;
    for await (const line of lines(o.readingLog)) {
      const cols = line.split('\t'), k = wkey(cols); if (!k) continue;
      const shelf = cols.find((c) => /want to read|currently reading|already read/i.test(c)) || '';
      const w = /want to read/i.test(shelf) ? 1 : /already read/i.test(shelf) ? 1.5 : /currently/i.test(shelf) ? 1 : 0;
      if (w) { want.set(k, (want.get(k) || 0) + w); n++; }
    }
    log(`reading log: ${n} rows, ${want.size} works`);
  }
  const pop = new Map();
  for (const [k, v] of want) pop.set(k, v);
  for (const [k, [n]] of rate) pop.set(k, (pop.get(k) || 0) + 3 * n);
  const chosen = [...pop.entries()].filter(([, p]) => p >= minPop).sort((a, b) => b[1] - a[1]).slice(0, Math.round(max * 1.25));   // a margin: some works will be dropped later (no title or author)
  const wanted = new Set(chosen.map(([k]) => k));
  log(`candidates by popularity: ${wanted.size}`);

  // 2. the works themselves
  const works = new Map(); const authorKeys = new Set();
  for await (const line of lines(o.works)) {
    const t1 = line.indexOf('\t'), t2 = line.indexOf('\t', t1 + 1);
    const key = line.slice(t1 + 1, t2).replace('/works/', '');
    if (!wanted.has(key)) continue;
    let d; try { d = JSON.parse(line.slice(line.lastIndexOf('\t') + 1)); } catch (e) { continue; }
    if (!d.title) continue;
    const ak = (d.authors || []).map((a) => a && a.author && a.author.key && a.author.key.replace('/authors/', '')).filter(Boolean).slice(0, 3);
    if (!ak.length) continue;
    ak.forEach((a) => authorKeys.add(a));
    works.set(key, { d, ak });
  }
  log(`works found: ${works.size}`);

  // 3. author names
  const names = new Map();
  for await (const line of lines(o.authors)) {
    const t1 = line.indexOf('\t'), t2 = line.indexOf('\t', t1 + 1);
    const key = line.slice(t1 + 1, t2).replace('/authors/', '');
    if (!authorKeys.has(key)) continue;
    try { const d = JSON.parse(line.slice(line.lastIndexOf('\t') + 1)); const nm = d.name || d.personal_name; if (nm) names.set(key, nm.trim()); } catch (e) { /* skip */ }
  }

  // 4. assemble records, then prune tags by how many books share them
  let recs = [];
  for (const [key, { d, ak }] of works) {
    const authors = ak.map((a) => names.get(a)).filter(Boolean);
    if (!authors.length) continue;
    const r = rate.get(key) || [0, 0];
    recs.push({
      key, title: String(d.title).replace(/\s+/g, ' ').trim().slice(0, 120), authors, year: year(d.first_publish_date),
      subjects: (d.subjects || []).map(String), people: [...(d.subject_people || []), ...(d.subject_places || [])].map(String),
      desc: describe(d.description).slice(0, descLen), cover: Array.isArray(d.covers) ? (d.covers.find((c) => c > 0) || 0) : 0,
      n: r[0], avg: r[0] ? r[1] / r[0] : 0, pop: pop.get(key) || 0,
    });
  }
  recs.sort((a, b) => b.pop - a.pop);
  const before = recs.length; recs = dedupe(recs).slice(0, max);
  log(`duplicates removed: ${before - Math.min(before, recs.length)} (before trimming to ${max})`);
  const N = recs.length;
  const df = (get) => { const m = new Map(); for (const r of recs) for (const t of new Set(get(r))) m.set(t, (m.get(t) || 0) + 1); return m; };
  const tags = recs.map((r) => r.subjects.map(clean).filter((t) => t && t.length <= 40 && !JUNK.test(t)));
  const tagDf = new Map(); for (const ts of tags) for (const t of new Set(ts)) tagDf.set(t, (tagDf.get(t) || 0) + 1);
  const ppl = recs.map((r) => r.people.map((p) => p.trim()).filter((p) => p && p.length <= 40));
  const pplDf = new Map(); for (const ps of ppl) for (const p of new Set(ps)) pplDf.set(p, (pplDf.get(p) || 0) + 1);
  const maxDf = Math.max(12, N * 0.04);

  const seen = new Set(); const books = [];
  recs.forEach((r, i) => {
    const sig = clean(r.title) + '|' + clean(r.authors[0]); if (seen.has(sig)) return; seen.add(sig);
    const themes = [...new Set(tags[i])].filter((t) => tagDf.get(t) >= 2 && tagDf.get(t) <= maxDf).sort((a, b) => tagDf.get(b) - tagDf.get(a)).slice(0, 10);
    const cast = [...new Set(ppl[i])].filter((p) => pplDf.get(p) >= 2).sort((a, b) => pplDf.get(b) - pplDf.get(a)).slice(0, 6);
    const adj = (r.n * (r.avg || 3.7) + 20 * 3.7) / (r.n + 20);      // shrink thin ratings toward the average (out of 5)
    const rating = Math.round(adj * 2 * 10) / 10;                    // out of 10, like the film version
    books.push([r.key, r.title, r.year, r.authors, genresOf(r.subjects), themes, cast, rating, Math.round(r.pop), r.cover, r.desc]);
  });
  return { books, stats: { requested: max, built: books.length, tagsKept: books.reduce((s, b) => s + b[5].length, 0) } };
}

const toJs = (res, source) => 'window.BOOKS_CATALOG=' + JSON.stringify({
  v: 1, built: new Date().toISOString().slice(0, 10), source: source || 'Open Library', count: res.books.length,
  cols: ['key', 'title', 'year', 'authors', 'genres', 'themes', 'people', 'rating', 'pop', 'cover', 'desc'], books: res.books,
}) + ';\n';

module.exports = { build, toJs, genresOf, clean, describe, dedupe, titleKey };

if (require.main === module) {
  const a = process.argv.slice(2), arg = (n) => { const i = a.indexOf('--' + n); return i >= 0 ? a[i + 1] : undefined; };
  const need = ['works', 'authors'].filter((n) => !arg(n));
  if (need.length) { console.error('Missing --' + need.join(', --')); process.exit(1); }
  build({ works: arg('works'), authors: arg('authors'), ratings: arg('ratings'), readingLog: arg('reading-log'), max: Number(arg('max')) || 15000, minPop: arg('min-pop') == null ? 25 : Number(arg('min-pop')), log: (m) => console.error(m) })
    .then((res) => { fs.writeFileSync(arg('out') || 'catalog.js', toJs(res)); console.error(`Wrote ${arg('out') || 'catalog.js'}: ${res.books.length} books`); })
    .catch((e) => { console.error(e); process.exit(1); });
}
