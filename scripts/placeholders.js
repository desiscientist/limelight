// Adds or removes placeholder videos, for previewing how the site looks with lots of content.
// With TMDB_API_KEY in .env, placeholders use real movie and TV backdrops, titles and descriptions from TMDB
// (themoviedb.org; free for non-commercial projects, and the site footer shows the credit TMDB asks for).
// Without a key, plain generated clips are used instead.
//   npm run placeholders          -> add 55 placeholder videos
//   npm run placeholders -- 80    -> add 80
//   npm run placeholders:remove   -> delete every placeholder (your real uploads are untouched)
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ffmpegPath = require('ffmpeg-static');

const DATA_DIR = path.join(__dirname, '..', 'data');
const VIDEO_DIR = path.join(DATA_DIR, 'videos');
const DB_FILE = path.join(DATA_DIR, 'videos.json');
fs.mkdirSync(VIDEO_DIR, { recursive: true });

const load = () => { try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return []; } };
const save = (v) => { fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(v, null, 2)); fs.renameSync(DB_FILE + '.tmp', DB_FILE); };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rand = (min, max) => min + Math.random() * (max - min);

// Tags picked from words in each placeholder title.
const TAG_RULES = [
  [/vlog|day \d|routine|weekend|birthday|one year|q&a|comments|behind the scenes/i, ['vlog']],
  [/road trip|travel|journey|getaway|packing|train/i, ['travel']],
  [/walk|tour|exploring|market|old town|fort|temple|city|cafe|places/i, ['city', 'explore']],
  [/food|cook|chai|biryani|pancake|snack|butter chicken|breakfast/i, ['food', 'cooking']],
  [/mountain|trek|waterfall|snow|lake|river|camping|beach|ocean|sunset|sunrise|monsoon|rain|stars|sky|wildlife|safari/i, ['nature']],
  [/drone|timelapse|cinematic|b-roll|above|4k/i, ['cinematic']],
  [/javascript|coding|laptop|desk setup|camera|phone vs/i, ['tech']],
  [/learn|lesson|guide|how to|how i|tips|tricks|beginner|for beginners/i, ['tutorial']],
  [/edit|camera|cinematic|photo/i, ['filmmaking']],
  [/gym|workout|bike|surf|cricket/i, ['sports', 'fitness']],
  [/festival|kite|wedding|dance|celebration|lights/i, ['festival', 'celebration']],
  [/guitar|playlist|dance/i, ['music']],
  [/relax|ocean waves|night sky|rain/i, ['relaxing']],
  [/short film|last bus/i, ['short film']],
  [/bookshelf|repair|fixing|plant/i, ['diy']],
];
function tagsFor(title) {
  const tags = new Set();
  for (const [re, t] of TAG_RULES) if (re.test(title)) t.forEach((x) => tags.add(x));
  if (!tags.size) tags.add('vlog');
  return [...tags];
}

// Demo view and like counts so placeholders look like a busy site (placeholders only; real uploads start at 0).
// likeShare: fraction of votes that are likes (e.g. from a TMDB rating), otherwise random.
function fakeStats(likeShare) {
  const views = Math.round(Math.exp(rand(Math.log(2000), Math.log(2500000))));
  const votes = Math.round(views * rand(0.005, 0.03));
  const likes = Math.round(votes * (likeShare ?? rand(0.6, 0.98)));
  return { views, likes, dislikes: votes - likes, ...fakeHeat() };
}

// A plausible "most watched" curve: everyone sees the start, fewer reach the end, plus a couple of replayed moments.
function fakeHeat() {
  const peaks = [rand(15, 85), rand(15, 85)];
  const heat = Array.from({ length: 100 }, (_, i) => {
    let h = 100 * Math.exp(-i / 60);
    for (const p of peaks) h += 45 * Math.exp(-((i - p) ** 2) / 30);
    return Math.round(h * rand(0.9, 1.1));
  });
  return { heat, heatSessions: 50 };
}

if (process.argv[2] === 'retag') {
  const videos = load();
  let n = 0;
  for (const v of videos) {
    if (!v.placeholder) continue;
    v.tags = tagsFor(v.title.replace(/ \(Part \d+\)$/, ''));
    if (v.views === undefined) Object.assign(v, fakeStats());
    if (!v.heat) Object.assign(v, fakeHeat());
    n++;
  }
  save(videos);
  console.log(`Updated tags and stats for ${n} placeholder videos.`);
  process.exit(0);
}

if (process.argv[2] === 'remove') {
  const videos = load();
  const keep = videos.filter((v) => !v.placeholder);
  const bases = new Set(videos.filter((v) => v.placeholder).map((v) => path.parse(v.filename).name));
  // Each video's extra files (thumbnail, preview frames, streaming chunks) start with its file name + "_".
  for (const f of fs.readdirSync(VIDEO_DIR)) {
    const base = path.parse(f).name.split('_').slice(0, 2).join('_');
    if (bases.has(path.parse(f).name) || bases.has(base)) fs.rmSync(path.join(VIDEO_DIR, f), { force: true });
  }
  save(keep);
  console.log(`Removed ${videos.length - keep.length} placeholder videos. ${keep.length} real videos kept.`);
  process.exit(0);
}

const COUNT = Number(process.argv[2]) || 55;

const TITLES = [
  'Morning Walk Through the Old Town', 'How I Edit My Videos (Full Workflow)', 'Street Food Tour at Night',
  'Sunset Timelapse From the Rooftop', 'My Desk Setup in 2026', 'Cooking Butter Chicken From Scratch',
  'Rainy Day in the Mountains', 'Beginner Guitar Lesson #1', 'Unboxing My New Camera', 'A Day at the Beach',
  'Exploring an Abandoned Railway Station', 'Learn JavaScript in 20 Minutes', '5 Productivity Tips That Actually Work',
  'Road Trip Vlog: Day 1', 'Road Trip Vlog: Day 2', 'Road Trip Vlog: Day 3', 'Drone Shots Over the Lake',
  'Making Masala Chai the Right Way', 'Festival Lights at Night', 'My Morning Routine', 'Quick Bike Repair Guide',
  'Q&A: Answering Your Questions', 'Behind the Scenes of My Last Video', 'Trekking to the Waterfall',
  'Phone vs Camera: Which Is Better?', 'Late Night Coding Session', 'Visiting the Local Market',
  'Building a Bookshelf From Scratch', 'Train Journey Through the Countryside', 'First Time Trying Surfing',
  'Cricket Match Highlights With Friends', 'Monsoon Vibes', 'Plant Care for Beginners', 'Weekend Getaway',
  'Night Sky Full of Stars', 'How to Shoot Cinematic B-Roll', 'Exploring a Hidden Cafe', 'Gym Workout Routine',
  'Birthday Celebration Highlights', 'City Lights From Above', 'Travel Packing Tips', 'Learning to Cook Biryani',
  'Old Fort Walking Tour', 'Snow in the Hills', 'Simple Photo Editing Tricks', 'Evening Drive Playlist',
  'Wildlife Spotted on the Safari', 'Fixing My Old Laptop', 'Temple Visit at Sunrise', 'Wedding Dance Practice',
  'Ocean Waves, Relaxing 4K', 'Making Pancakes for Breakfast', 'Ranking Every Snack I Bought',
  'Answering Comments Live', 'Short Film: The Last Bus', 'One Year of Making Videos', 'Kite Festival 2025',
  'Camping by the River', 'My Favourite Places in the City', 'How I Learned Video Editing',
];
const DESCRIPTIONS = [
  'Thanks for watching! Let me know in the comments what you want to see next.',
  'Shot on my phone, edited in one evening.',
  'A short one this time. More coming soon.',
  'This was one of my favourite days so far.\n\nMusic: royalty free.',
  '',
  'Everything I used is listed below. Hope it helps!',
  'Part of an ongoing series.',
];
const PALETTES = [
  ['#ff6b6b', '#4d2c91'], ['#0ea5e9', '#14532d'], ['#f59e0b', '#7c2d12'], ['#22c55e', '#0f172a'],
  ['#e879f9', '#1e3a8a'], ['#f43f5e', '#f59e0b'], ['#06b6d4', '#a855f7'], ['#84cc16', '#0e7490'],
  ['#fb923c', '#be123c'], ['#64748b', '#0f172a'],
];

function background(w, h, dur) {
  const size = `${w}x${h}`;
  const kind = pick(['gradients', 'gradients', 'gradients', 'mandelbrot', 'life', 'testsrc2']);
  const [c0, c1] = pick(PALETTES);
  switch (kind) {
    case 'mandelbrot': return `mandelbrot=s=${size}:rate=15:start_scale=${rand(1, 3).toFixed(2)}`;
    case 'life': return `life=s=${w / 4}x${h / 4}:rate=15:ratio=0.2:mold=10:life_color=${c0}:death_color=${c1},scale=${size}:flags=neighbor`;
    case 'testsrc2': return `testsrc2=s=${size}:rate=15`;
    default: return `gradients=s=${size}:rate=15:c0=${c0}:c1=${c1}:speed=${rand(0.005, 0.03).toFixed(3)}:type=${pick(['linear', 'radial', 'circular', 'spiral'])}`;
  }
}

function makeVideo(file, title, w, h, dur) {
  const textFile = path.join(os.tmpdir(), `ph_${crypto.randomUUID()}.txt`);
  fs.writeFileSync(textFile, title);
  const esc = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:');
  const font = esc('C:/Windows/Fonts/segoeuib.ttf');
  // Shrink long titles so they always fit inside the frame width.
  const fontSize = Math.round(Math.min(Math.min(w, h) / 14, (w * 0.85) / (title.length * 0.55)));
  const vf = [
    `drawtext=fontfile='${font}':textfile='${esc(textFile)}':fontcolor=white:fontsize=${fontSize}` +
      `:box=1:boxcolor=black@0.45:boxborderw=18:x=(w-text_w)/2:y=(h-text_h)/2`,
    `drawtext=fontfile='${font}':text='PLACEHOLDER':fontcolor=white@0.6:fontsize=${Math.round(fontSize / 2)}:x=20:y=20`,
  ].join(',');
  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-t', String(dur), '-i', background(w, h, dur),
    '-f', 'lavfi', '-t', String(dur), '-i', `sine=frequency=${Math.round(rand(200, 500))}:sample_rate=44100,volume=0.05`,
    '-vf', vf, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', '-shortest', file,
  ];
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args, { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => {
      fs.rmSync(textFile, { force: true });
      code === 0 ? resolve() : reject(new Error(err));
    });
  });
}

// ---------- TMDB placeholders ----------
const TMDB_KEY = (process.env.TMDB_API_KEY || '').trim();

// Works with either kind of TMDB key: the short "API Key" or the long "API Read Access Token".
async function tmdb(pathname, params = {}) {
  const url = new URL('https://api.themoviedb.org/3' + pathname);
  const headers = { accept: 'application/json' };
  if (TMDB_KEY.length > 40) headers.Authorization = 'Bearer ' + TMDB_KEY;
  else url.searchParams.set('api_key', TMDB_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers });
  if (res.status === 401) throw new Error('TMDB did not accept the key. Check TMDB_API_KEY in .env.');
  if (!res.ok) throw new Error(`TMDB ${pathname} answered ${res.status}`);
  return res.json();
}

// Popular and trending movies and shows, mixed together, each with a wide backdrop picture and a description.
async function tmdbItems(count, skip) {
  const [mg, tg] = await Promise.all([tmdb('/genre/movie/list'), tmdb('/genre/tv/list')]);
  const genres = { movie: new Map(mg.genres.map((g) => [g.id, g.name])), tv: new Map(tg.genres.map((g) => [g.id, g.name])) };
  const lists = [
    ['movie', '/trending/movie/week'], ['tv', '/trending/tv/week'], ['movie', '/movie/popular'],
    ['tv', '/tv/popular'], ['movie', '/movie/top_rated'], ['tv', '/tv/top_rated'],
  ];
  const out = [];
  const seen = new Set(skip);
  for (let page = 1; page <= 5 && out.length < count; page++) {
    const results = await Promise.all(lists.map(([type, p]) => tmdb(p, { page }).then((r) => r.results.map((x) => ({ ...x, type })))));
    // Take one from each list in turn so movies and shows stay mixed.
    for (let k = 0; k < 20 && out.length < count; k++) {
      for (const list of results) {
        const x = list[k];
        if (!x || !x.backdrop_path || !x.overview || x.adult || seen.has(x.type + x.id)) continue;
        seen.add(x.type + x.id);
        const names = (x.genre_ids || []).map((id) => genres[x.type].get(id)).filter(Boolean);
        out.push({
          tmdbId: x.id,
          type: x.type,
          title: x.title || x.name,
          description: x.overview,
          date: x.release_date || x.first_air_date,
          rating: x.vote_count >= 20 ? x.vote_average / 10 : null,
          backdrop: x.backdrop_path,
          tags: [...new Set([x.type === 'tv' ? 'series' : 'movie', ...names.flatMap((n) => n.toLowerCase().split(' & '))])],
        });
        if (out.length >= count) break;
      }
    }
  }
  return out;
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Picture download failed (${res.status})`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

// A silent 480p clip that slowly pans across the backdrop picture.
function makeClipFromImage(image, file, dur) {
  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-loop', '1', '-framerate', '24', '-t', String(dur), '-i', image,
    '-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=44100:cl=stereo',
    '-vf', `scale=1000:-2,crop=854:480:(iw-ow)*t/${dur}:(ih-oh)/2,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-r', '24',
    '-c:a', 'aac', '-b:a', '48k', '-movflags', '+faststart', '-shortest', file,
  ];
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args, { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err))));
  });
}

async function makeTmdbPlaceholders() {
  const existing = load().filter((v) => v.source === 'tmdb').map((v) => v.tmdbType + v.tmdbId);
  console.log('Getting movies and shows from TMDB...');
  const items = await tmdbItems(COUNT, existing);
  let done = 0;
  const made = [];
  async function worker() {
    while (items.length) {
      const it = items.shift();
      const base = `ph_${crypto.randomUUID()}`;
      const poster = `${base}_poster.jpg`;
      const filename = `${base}.mp4`;
      const dur = Math.round(rand(30, 150));
      try {
        await download('https://image.tmdb.org/t/p/w1280' + it.backdrop, path.join(VIDEO_DIR, poster));
        await makeClipFromImage(path.join(VIDEO_DIR, poster), path.join(VIDEO_DIR, filename), dur);
      } catch (e) {
        fs.rmSync(path.join(VIDEO_DIR, poster), { force: true });
        fs.rmSync(path.join(VIDEO_DIR, filename), { force: true });
        console.error(`\nSkipped "${it.title}": ${e.message.split('\n')[0]}`);
        continue;
      }
      const released = it.date ? new Date(it.date).getTime() : NaN;
      made.push({
        id: crypto.randomBytes(6).toString('base64url'),
        title: it.title,
        description: it.description,
        tags: it.tags,
        ...fakeStats(it.rating ?? undefined),
        filename,
        mimetype: 'video/mp4',
        size: fs.statSync(path.join(VIDEO_DIR, filename)).size,
        // Upload date = release date (never in the future), so "Newest" lists the latest releases first.
        createdAt: new Date(Math.min(Date.now(), isNaN(released) ? Date.now() - rand(0, 730) * 86400000 : released)).toISOString(),
        width: 854,
        height: 480,
        duration: dur,
        webFriendly: true,
        processing: 'done',
        poster,
        posterVersion: 1,
        customPoster: true,
        placeholder: true,
        source: 'tmdb',
        tmdbId: it.tmdbId,
        tmdbType: it.type,
      });
      process.stdout.write(`\rMade ${++done} placeholder videos`);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(4, os.cpus().length)) }, worker));
  return made;
}

// ---------- Free-poster placeholders (no key needed) ----------
// Real films whose posters are free to use: public-domain classics and Blender's Creative Commons open movies.
// Posters come from Wikimedia Commons, which only hosts freely licensed files; each one's licence is checked
// and saved so the watch page can credit it. Descriptions come from Wikipedia (CC BY-SA).
const FREE_FILMS = [
  ['Night_of_the_Living_Dead', ['horror', 'classic']], ['Nosferatu', ['horror', 'classic', 'silent']],
  ['Metropolis_(1927_film)', ['sci-fi', 'classic', 'silent']], ['The_General_(1926_film)', ['comedy', 'action', 'silent']],
  ['Safety_Last!', ['comedy', 'silent']], ['The_Kid_(1921_film)', ['comedy', 'drama', 'silent']],
  ['The_Cabinet_of_Dr._Caligari', ['horror', 'mystery', 'silent']], ['The_Phantom_of_the_Opera_(1925_film)', ['horror', 'romance', 'silent']],
  ['Charade_(1963_film)', ['thriller', 'romance', 'comedy']], ['His_Girl_Friday', ['comedy', 'romance']],
  ['Plan_9_from_Outer_Space', ['sci-fi', 'horror']], ['The_Little_Shop_of_Horrors', ['comedy', 'horror']],
  ['House_on_Haunted_Hill', ['horror', 'mystery']], ['Carnival_of_Souls', ['horror', 'mystery']],
  ['The_Last_Man_on_Earth_(1964_film)', ['sci-fi', 'horror']], ['Detour_(1945_film)', ['crime', 'noir']],
  ['D.O.A._(1950_film)', ['crime', 'noir', 'thriller']], ['Royal_Wedding', ['musical', 'romance']],
  ['McLintock!', ['western', 'comedy']], ["Gulliver's_Travels_(1939_film)", ['animation', 'family', 'adventure']],
  ['A_Trip_to_the_Moon', ['sci-fi', 'adventure', 'silent']], ['The_Great_Train_Robbery_(1903_film)', ['western', 'action', 'silent']],
  ['Sherlock_Jr.', ['comedy', 'mystery', 'silent']], ['The_Gold_Rush', ['comedy', 'adventure', 'silent']],
  ['Battleship_Potemkin', ['drama', 'history', 'silent']], ['The_Lost_World_(1925_film)', ['adventure', 'sci-fi', 'silent']],
  ['The_Thief_of_Bagdad_(1924_film)', ['adventure', 'fantasy', 'silent']], ['Steamboat_Willie', ['animation', 'family', 'comedy']],
  ['Wings_(1927_film)', ['war', 'drama', 'silent']], ['Sunrise:_A_Song_of_Two_Humans', ['drama', 'romance', 'silent']],
  ['The_Man_with_the_Golden_Arm', ['drama', 'crime']], ['Kansas_City_Confidential', ['crime', 'noir']],
  ['The_Hitch-Hiker', ['thriller', 'noir']], ['Scarlet_Street', ['crime', 'noir', 'drama']],
  ['The_Stranger_(1946_film)', ['thriller', 'noir']], ['Penny_Serenade', ['drama', 'romance']],
  ['Beat_the_Devil_(film)', ['comedy', 'adventure']], ['The_Terror_(1963_film)', ['horror', 'mystery']],
  ['Teenagers_from_Outer_Space', ['sci-fi']], ['The_Hunchback_of_Notre_Dame_(1923_film)', ['drama', 'romance', 'silent']],
  ['Big_Buck_Bunny', ['animation', 'comedy', 'open movie']], ['Sintel', ['animation', 'fantasy', 'open movie']],
  ['Tears_of_Steel', ['sci-fi', 'action', 'open movie']], ['Elephants_Dream', ['animation', 'sci-fi', 'open movie']],
  ['Cosmos_Laundromat', ['animation', 'fantasy', 'open movie']], ['Sprite_Fright', ['animation', 'horror', 'comedy', 'open movie']],
  ['Spring_(2019_film)', ['animation', 'fantasy', 'open movie']], ['Caminandes', ['animation', 'comedy', 'open movie']],
];
const WIKI_HEADERS = { 'User-Agent': 'PersonalVideoSiteDemo/1.0 (personal portfolio project)', accept: 'application/json' };

// One request at a time, politely spaced; waits and retries when Wikipedia says "too many requests".
let wikiChain = Promise.resolve();
function wiki(url, binary = false) {
  const run = wikiChain.then(async () => {
    for (let attempt = 0; ; attempt++) {
      await new Promise((r) => setTimeout(r, 400));
      const res = await fetch(url, { headers: WIKI_HEADERS });
      if (res.ok) return binary ? Buffer.from(await res.arrayBuffer()) : res.json();
      if ((res.status === 429 || res.status >= 500) && attempt < 5) {
        const wait = (Number(res.headers.get('retry-after')) || 2 ** attempt * 2) * 1000;
        await new Promise((r) => setTimeout(r, Math.min(wait, 60000)));
        continue;
      }
      throw new Error(`${res.status} from ${new URL(url).host}`);
    }
  });
  wikiChain = run.catch(() => {});
  return run;
}

// Title, description and a freely licensed poster for one Wikipedia article, or null if its picture isn't free.
async function freeFilm(article) {
  const sum = await wiki('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(article));
  const src = sum.originalimage && sum.originalimage.source;
  if (!src || !src.includes('/wikipedia/commons/')) return null; // not on Commons = not a free file
  // e.g. https://upload.wikimedia.org/wikipedia/commons/a/ab/Poster.jpg
  const clean = src.split('?')[0];
  const m = clean.match(/\/wikipedia\/commons\/([0-9a-f])\/([0-9a-f]{2})\/([^/]+)$/);
  if (!m) return null;
  const [, a, ab, name] = m;
  // Big originals are fetched as a 1280px-wide copy (Wikimedia's standard thumbnail address).
  const big = (sum.originalimage.width || 0) > 1280 && !/\.svg$/i.test(name);
  const year = (String(sum.description || '').match(/\b(18|19|20)\d\d\b/) || [])[0];
  return {
    title: sum.title.replace(/\s*\((\d{4} )?film\)$/, ''), // "Charade (1963 film)" -> "Charade"
    description: sum.extract,
    year,
    image: big ? `https://upload.wikimedia.org/wikipedia/commons/thumb/${a}/${ab}/${name}/1280px-${name}` : clean,
    // Commons only hosts freely licensed files; the exact licence and author are on the file's page.
    credit: { license: 'Free licence (Wikimedia Commons)', author: '', file: 'https://commons.wikimedia.org/wiki/File:' + name, article: sum.content_urls.desktop.page },
  };
}

// 1280x720 thumbnail: the poster centred over a blurred, darkened copy of itself.
function makeWideArt(input, output) {
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', input, '-filter_complex',
    '[0]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,boxblur=28:4,eq=brightness=-0.22[bg];' +
    '[0]scale=1280:720:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2',
    '-frames:v', '1', '-q:v', '3', output];
  return runFfmpeg(args);
}

// Test video: a slow zoom into the artwork, with silent audio.
function makeZoomClip(image, file, dur) {
  return runFfmpeg(['-y', '-hide_banner', '-loglevel', 'error',
    '-loop', '1', '-framerate', '24', '-t', String(dur), '-i', image,
    '-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=44100:cl=stereo',
    '-vf', `scale=w='trunc(960*(1+0.12*t/${dur})/2)*2':h=-2:eval=frame,crop=960:540,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-r', '24',
    '-c:a', 'aac', '-b:a', '48k', '-movflags', '+faststart', '-shortest', file]);
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args, { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err))));
  });
}

async function makeFreePosterPlaceholders() {
  const have = new Set(load().filter((v) => v.source === 'commons').map((v) => v.title));
  const films = FREE_FILMS.slice(0, COUNT);
  console.log(`Getting free posters for ${films.length} films from Wikimedia Commons...`);
  let done = 0, skipped = 0;
  const made = [];
  async function worker() {
    while (films.length) {
      const [article, tags] = films.shift();
      const base = `ph_${crypto.randomUUID()}`;
      const raw = path.join(os.tmpdir(), `${base}_raw`);
      const poster = `${base}_poster.jpg`;
      const filename = `${base}.mp4`;
      const dur = Math.round(rand(25, 75));
      try {
        const film = await freeFilm(article);
        if (!film || have.has(film.title)) { skipped++; continue; }
        fs.writeFileSync(raw, await wiki(film.image, true));
        await makeWideArt(raw, path.join(VIDEO_DIR, poster));
        await makeZoomClip(path.join(VIDEO_DIR, poster), path.join(VIDEO_DIR, filename), dur);
        made.push({
          id: crypto.randomBytes(6).toString('base64url'),
          title: film.title,
          description: film.description,
          tags: [...tags, ...(film.year ? [film.year.slice(0, 3) + '0s'] : [])],
          ...fakeStats(),
          filename,
          mimetype: 'video/mp4',
          size: fs.statSync(path.join(VIDEO_DIR, filename)).size,
          createdAt: new Date(Date.now() - rand(0, 730) * 86400000).toISOString(),
          width: 960,
          height: 540,
          duration: dur,
          webFriendly: true,
          processing: 'done',
          poster,
          posterVersion: 1,
          customPoster: true,
          placeholder: true,
          source: 'commons',
          year: film.year || null,
          credit: film.credit,
        });
        process.stdout.write(`\rMade ${++done} placeholder videos`);
      } catch (e) {
        skipped++;
        fs.rmSync(path.join(VIDEO_DIR, poster), { force: true });
        fs.rmSync(path.join(VIDEO_DIR, filename), { force: true });
        console.error(`\nSkipped ${article}: ${e.message.split('\n')[0]}`);
      } finally {
        fs.rmSync(raw, { force: true });
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  if (skipped) console.log(`\n(${skipped} films skipped: no free poster, or already added)`);
  return made;
}

// ---------- Chosen titles from TMDB ----------
// npm run placeholders:titles -- "Avengers: Doomsday" "Dune: Part Three" --feature
// Looks each title up on TMDB (newest matching release first), uses its official portrait poster,
// description, genres and year, and with --feature puts them in the home page banner.
async function findTmdbMovie(query, genres) {
  const { results = [] } = await tmdb('/search/movie', { query, include_adult: 'false' });
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const q = norm(query);
  const candidates = results.filter((x) => x.poster_path && !x.adult);
  if (!candidates.length) return null;
  // Prefer an exact title match, then the newest release, then the most popular.
  const year = (x) => Number((x.release_date || '').slice(0, 4)) || 0;
  candidates.sort((a, b) => (norm(b.title) === q) - (norm(a.title) === q) || year(b) - year(a) || b.popularity - a.popularity);
  const x = candidates[0];
  const names = (x.genre_ids || []).map((id) => genres.get(id)).filter(Boolean);
  const y = year(x);
  return {
    tmdbId: x.id,
    title: x.title,
    description: x.overview || '',
    year: y ? String(y) : null,
    poster: x.poster_path,
    tags: [...new Set([...names.flatMap((n) => n.toLowerCase().split(' & ')), ...(y ? [String(y).slice(0, 3) + '0s'] : [])])],
  };
}

async function makeTmdbTitlePlaceholders(queries, feature) {
  if (!TMDB_KEY) throw new Error('This needs a TMDB key. Add TMDB_API_KEY=... to .env (free at themoviedb.org → Settings → API).');
  const genres = new Map((await tmdb('/genre/movie/list')).genres.map((g) => [g.id, g.name]));
  const have = new Set(load().filter((v) => v.source === 'tmdb').map((v) => String(v.tmdbId)));
  const made = [];
  for (const [i, query] of queries.entries()) {
    const base = `ph_${crypto.randomUUID()}`;
    const raw = path.join(os.tmpdir(), `${base}_raw.jpg`);
    const poster = `${base}_poster.jpg`;
    const filename = `${base}.mp4`;
    const dur = Math.round(rand(40, 90));
    try {
      const film = await findTmdbMovie(query, genres);
      if (!film) { console.log(`Not found on TMDB: "${query}"`); continue; }
      if (have.has(String(film.tmdbId))) { console.log(`Already added: ${film.title}`); continue; }
      await download('https://image.tmdb.org/t/p/w780' + film.poster, raw);
      await makeWideArt(raw, path.join(VIDEO_DIR, poster));
      await makeZoomClip(path.join(VIDEO_DIR, poster), path.join(VIDEO_DIR, filename), dur);
      made.push({
        id: crypto.randomBytes(6).toString('base64url'),
        title: film.title,
        description: film.description,
        tags: film.tags,
        ...fakeStats(),
        filename,
        mimetype: 'video/mp4',
        size: fs.statSync(path.join(VIDEO_DIR, filename)).size,
        // Newest first, in the order given, so they lead "All Videos".
        createdAt: new Date(Date.now() - i * 60000).toISOString(),
        width: 960,
        height: 540,
        duration: dur,
        webFriendly: true,
        processing: 'done',
        poster,
        posterVersion: 1,
        customPoster: true,
        placeholder: true,
        source: 'tmdb',
        tmdbId: film.tmdbId,
        tmdbType: 'movie',
        year: film.year,
      });
      console.log(`Added: ${film.title}${film.year ? ` (${film.year})` : ''}`);
    } catch (e) {
      fs.rmSync(path.join(VIDEO_DIR, poster), { force: true });
      fs.rmSync(path.join(VIDEO_DIR, filename), { force: true });
      console.error(`Skipped "${query}": ${e.message.split('\n')[0]}`);
    } finally {
      fs.rmSync(raw, { force: true });
    }
  }
  if (feature && made.length) {
    const file = path.join(DATA_DIR, 'settings.json');
    const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    settings.featured = made.slice(0, 5).map((v) => v.id);
    fs.writeFileSync(file, JSON.stringify(settings, null, 2));
    console.log(`Home page banner now shows: ${made.slice(0, 5).map((v) => v.title).join(', ')}`);
  }
  return made;
}

// ---------- Generated placeholders (no TMDB key) ----------
async function makeGeneratedPlaceholders() {
  const titles = [...TITLES].sort(() => Math.random() - 0.5);
  const jobs = Array.from({ length: COUNT }, (_, i) => {
    const portrait = Math.random() < 0.15;
    return {
      title: titles[i % titles.length] + (i >= titles.length ? ` (Part ${Math.floor(i / titles.length) + 1})` : ''),
      w: portrait ? 360 : 640,
      h: portrait ? 640 : 360,
      dur: Math.round(Math.random() < 0.8 ? rand(6, 40) : rand(60, 120)),
      // Spread upload dates over the last two years.
      createdAt: new Date(Date.now() - rand(0, 730) * 86400000).toISOString(),
    };
  });

  let done = 0;
  const made = [];
  async function worker() {
    while (jobs.length) {
      const j = jobs.shift();
      const filename = `ph_${crypto.randomUUID()}.mp4`;
      await makeVideo(path.join(VIDEO_DIR, filename), j.title, j.w, j.h, j.dur);
      made.push({
        id: crypto.randomBytes(6).toString('base64url'),
        title: j.title,
        description: pick(DESCRIPTIONS),
        tags: tagsFor(j.title.replace(/ \(Part \d+\)$/, '')),
        ...fakeStats(),
        filename,
        mimetype: 'video/mp4',
        size: fs.statSync(path.join(VIDEO_DIR, filename)).size,
        createdAt: j.createdAt,
        width: j.w,
        height: j.h,
        duration: j.dur,
        webFriendly: true,
        processing: 'done',
        placeholder: true,
      });
      process.stdout.write(`\rMade ${++done}/${COUNT} placeholder videos`);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(4, os.cpus().length)) }, worker));
  return made;
}

(async () => {
  // "titles": the films named after it, from TMDB. Otherwise, with a TMDB key: today's movies and shows.
  // Without: free-poster classics. "--plain": generated clips only.
  const made = process.argv[2] === 'titles'
    ? await makeTmdbTitlePlaceholders(process.argv.slice(3).filter((a) => !a.startsWith('--')), process.argv.includes('--feature'))
    : TMDB_KEY ? await makeTmdbPlaceholders()
    : process.argv.includes('--plain') ? await makeGeneratedPlaceholders()
    : await makeFreePosterPlaceholders();
  const videos = load();
  videos.push(...made);
  save(videos);
  console.log(`\nDone: added ${made.length}. Restart the server so it builds their previews. Remove them any time with: npm run placeholders:remove`);
})().catch((e) => { console.error('\nFailed:', e.message); process.exit(1); });
