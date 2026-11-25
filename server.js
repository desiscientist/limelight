const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { probe, plan, transcode, makePoster, makeStoryboard, makeHlsVariant } = require('./media');

const PORT = Number(process.env.PORT) || 3001;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SITE_NAME = process.env.SITE_NAME || 'Limelight';
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 4096;

// Bump this when processing gains a new step, so existing videos get the new files too.
const ASSETS_VERSION = 2;
const HEAT_BUCKETS = 100;

if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 8) {
  console.error('ADMIN_PASSWORD must be set (at least 8 characters). Copy .env.example to .env and edit it.');
  process.exit(1);
}

// ---------- Storage ----------
const DATA_DIR = path.join(__dirname, 'data');
const VIDEO_DIR = path.join(DATA_DIR, 'videos');
const TMP_DIR = path.join(DATA_DIR, 'tmp');
const DB_FILE = path.join(DATA_DIR, 'videos.json');
const REPORTS_FILE = path.join(DATA_DIR, 'reports.json');
const SEARCHES_FILE = path.join(DATA_DIR, 'searches.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const COMMENTS_FILE = path.join(DATA_DIR, 'comments.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const MAX_FEATURED = 5;
fs.mkdirSync(VIDEO_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function saveJson(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}
const loadVideos = () => loadJson(DB_FILE, []);
const saveVideos = (videos) => saveJson(DB_FILE, videos);

function updateVideo(id, fn) {
  const videos = loadVideos();
  const v = videos.find((x) => x.id === id);
  if (!v) return null;
  fn(v);
  saveVideos(videos);
  return v;
}

// Accepts "Travel, #vlog, road trip" or an array; returns clean, unique, lowercase tags.
function normalizeTags(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(',');
  const tags = [];
  for (const raw of list) {
    const t = String(raw).toLowerCase().replace(/^#+/, '').replace(/[^\p{L}\p{N} &+-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 30);
    if (t && !tags.includes(t)) tags.push(t);
  }
  return tags.slice(0, 20);
}

const mediaUrl = (filename) => '/media/' + encodeURIComponent(filename);
const baseName = (v) => path.parse(v.filename).name;
const videoPath = (file) => path.join(VIDEO_DIR, file);

// Simple per-key limiter: allow `max` actions per `windowMs`.
const limits = new Map();
function allow(key, max, windowMs) {
  const now = Date.now();
  const rec = limits.get(key);
  if (!rec || rec.resetAt < now) {
    if (limits.size > 50000) limits.clear();
    limits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (rec.count >= max) return false;
  rec.count++;
  return true;
}

function publicHeat(v) {
  if (!v.heat || (v.heatSessions || 0) < 3) return null;
  const max = Math.max(...v.heat);
  return max ? v.heat.map((x) => Math.round((x / max) * 100) / 100) : null;
}

function publicVideo(v, admin = false) {
  const short = v.width ? Math.min(v.width, v.height) : null;
  const sources = [
    { label: short ? `Original (${short}p)` : 'Original', height: short, url: mediaUrl(v.filename), original: true },
    ...(v.renditions || []).map((r) => ({ label: `${r.height}p`, height: r.height, url: mediaUrl(r.filename) })),
  ];
  const sb = v.storyboard;
  return {
    id: v.id,
    title: v.title,
    description: v.description,
    tags: v.tags || [],
    year: v.year || null,
    credit: v.credit || null,
    createdAt: v.createdAt,
    size: v.size,
    mimetype: v.mimetype,
    duration: v.duration,
    width: v.width,
    height: v.height,
    url: mediaUrl(v.filename),
    webFriendly: v.webFriendly !== false,
    sources,
    poster: v.poster ? mediaUrl(v.poster) + '?v=' + (v.posterVersion || 1) : null,
    customPoster: !!v.customPoster,
    storyboard: sb ? { url: mediaUrl(sb.filename), interval: sb.interval, count: sb.count, cols: sb.cols, rows: sb.rows, width: sb.width, height: sb.height } : null,
    hls: v.hls ? mediaUrl(v.hls) : null,
    hlsLevels: v.hlsLevels || [],
    heat: publicHeat(v),
    views: v.views || 0,
    likes: v.likes || 0,
    dislikes: v.dislikes || 0,
    processing: v.processing === 'done' || v.processing === 'failed' ? null : (progress.get(v.id) || { label: 'queued', pct: 0 }),
  };
}

// ---------- Processing (one video at a time) ----------
const progress = new Map(); // id -> { label, pct }
const queue = [];
let busy = false;

function enqueue(id) {
  if (!queue.includes(id)) queue.push(id);
  pump();
}

async function pump() {
  if (busy || !queue.length) return;
  busy = true;
  const id = queue.shift();
  try {
    await processVideo(id);
  } catch (err) {
    console.error(`Processing ${id} failed:`, err.message);
    updateVideo(id, (v) => (v.processing = 'failed'));
  } finally {
    progress.delete(id);
    busy = false;
    pump();
  }
}

function removeVideoFiles(v) {
  const base = baseName(v);
  for (const f of fs.readdirSync(VIDEO_DIR)) {
    if (f === v.filename || f.startsWith(base + '_')) fs.rm(videoPath(f), { force: true }, () => {});
  }
}

function defaultPosterTime(duration) {
  if (!duration) return 0;
  return Math.min(Math.max(duration * 0.1, 0.5), Math.max(0, duration - 0.2));
}

async function processVideo(id) {
  const v = loadVideos().find((x) => x.id === id);
  if (!v) return;
  const input = videoPath(v.filename);
  const info = await probe(input);
  updateVideo(id, (x) => Object.assign(x, {
    width: info.width, height: info.height, duration: info.duration, webFriendly: info.webFriendly,
  }));
  const base = baseName(v);
  const short = Math.min(info.width, info.height);
  const stillExists = () => loadVideos().find((x) => x.id === id);

  // 1. Lower-quality versions
  for (const h of plan(info)) {
    const current = stillExists();
    if (!current) return removeVideoFiles(v); // deleted while processing
    if ((current.renditions || []).some((r) => r.height === h)) continue; // already made

    const out = `${base}_${h}p.mp4`;
    const tmp = videoPath(`${base}_${h}p.part.mp4`);
    progress.set(id, { label: `${h}p`, pct: 0 });
    await transcode(input, tmp, h, info, info.duration, (pct) => progress.set(id, { label: `${h}p`, pct }));
    fs.renameSync(tmp, videoPath(out));
    const size = fs.statSync(videoPath(out)).size;
    const saved = updateVideo(id, (x) => {
      x.renditions = (x.renditions || []).filter((r) => r.height !== h);
      x.renditions.push({ height: h, filename: out, size });
      x.renditions.sort((a, b) => b.height - a.height);
    });
    if (!saved) return removeVideoFiles(v);
  }

  let current = stillExists();
  if (!current) return removeVideoFiles(v);
  const renditions = current.renditions || [];
  const smallest = renditions.length ? videoPath(renditions[renditions.length - 1].filename) : input;

  // 2. Cover image (unless you uploaded your own)
  progress.set(id, { label: 'thumbnail', pct: 0 });
  if (!current.customPoster) {
    await makePoster(input, videoPath(`${base}_poster.jpg`), defaultPosterTime(info.duration));
  }

  // 3. Preview frames for the progress bar
  progress.set(id, { label: 'preview frames', pct: 0 });
  const sb = await makeStoryboard(smallest, videoPath(`${base}_sb.jpg`), info.duration);

  // 4. Streaming version for "Auto" quality: each H.264 file is cut into chunks (no re-encoding).
  progress.set(id, { label: 'streaming', pct: 0 });
  const dims = (h) => (info.height > info.width
    ? [h, Math.round((h * info.height) / info.width / 2) * 2]
    : [Math.round((h * info.width) / info.height / 2) * 2, h]);
  const variants = renditions.map((r) => ({ file: videoPath(r.filename), height: r.height, size: r.size, original: false, res: dims(r.height) }));
  const originalUsable = info.codec === 'h264' && !info.rotated && info.pixFmt === 'yuv420p' && !variants.some((x) => x.height === short);
  if (originalUsable) variants.unshift({ file: input, height: short, size: current.size, original: true, res: [info.width, info.height] });

  let master = null;
  if (variants.length) {
    const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-INDEPENDENT-SEGMENTS'];
    for (const [i, variant] of variants.entries()) {
      const prefix = `${base}_hls_${variant.height}`;
      await makeHlsVariant(variant.file, videoPath(prefix));
      const bandwidth = Math.max(100000, Math.ceil(((variant.size * 8) / (info.duration || 1)) * 1.1));
      lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${variant.res[0]}x${variant.res[1]}`, `${prefix}.m3u8`);
      progress.set(id, { label: 'streaming', pct: Math.round(((i + 1) / variants.length) * 100) });
    }
    master = `${base}_hls.m3u8`;
    fs.writeFileSync(videoPath(master), lines.join('\n') + '\n');
  }

  const saved = updateVideo(id, (x) => {
    if (!x.customPoster) {
      x.poster = `${base}_poster.jpg`;
      x.posterVersion = (x.posterVersion || 0) + 1;
    }
    x.storyboard = { filename: `${base}_sb.jpg`, ...sb };
    x.hls = master;
    x.hlsLevels = variants.map((vr) => ({ height: vr.height, original: vr.original }));
    x.assets = ASSETS_VERSION;
    x.processing = 'done';
  });
  if (!saved) removeVideoFiles(v);
}

// ---------- Admin sessions ----------
const SESSION_COOKIE = 'admin_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const sessions = new Map(); // token -> expiresAt

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isAdmin(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp) return false;
  if (exp < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  res.status(401).json({ error: 'Not logged in' });
}

function passwordMatches(input) {
  const a = crypto.createHash('sha256').update(String(input)).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

// ---------- Upload handling ----------
// The upload form sends the video plus an optional "thumbnail" image.
const IMAGE_TYPES = /^image\/(jpeg|png|webp)$/;
const MAX_THUMB_BYTES = 15 * 1024 * 1024;
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, file.fieldname === 'thumbnail' ? TMP_DIR : VIDEO_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
      cb(null, crypto.randomUUID() + ext);
    },
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 2 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'video' && file.mimetype.startsWith('video/')) cb(null, true);
    else if (file.fieldname === 'thumbnail' && IMAGE_TYPES.test(file.mimetype)) cb(null, true);
    else cb(new Error(file.fieldname === 'thumbnail' ? 'Thumbnail must be a JPG, PNG or WebP image' : 'Only video files are allowed'));
  },
});

const imageUpload = multer({
  dest: TMP_DIR,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Use a JPG, PNG or WebP image'));
  },
});

// ---------- App ----------
const app = express();
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json());

// tmdb / commons: true when any video's pictures came from TMDB or Wikimedia Commons, so pages show the credit they ask for.
app.get('/api/config', (req, res) => { const all = loadVideos(); res.json({ siteName: SITE_NAME, tmdb: all.some((v) => v.source === 'tmdb'), commons: all.some((v) => v.source === 'commons') }); });

app.get('/api/videos', (req, res) => {
  const videos = loadVideos().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const admin = isAdmin(req);
  res.json(videos.map((v) => publicVideo(v, admin)));
});

app.get('/api/videos/:id', (req, res) => {
  const v = loadVideos().find((x) => x.id === req.params.id);
  if (!v) return res.status(404).json({ error: 'Video not found' });
  const user = currentUser(req);
  res.json({ ...publicVideo(v, isAdmin(req)), myVote: (user && v.voters && v.voters[user.id]) || 'none' });
});

// ---------- Viewer accounts ----------
// Sign-in cookies are signed with a secret kept in data/secret.key, so people stay signed in across restarts.
if (!fs.existsSync(SECRET_FILE)) fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString('hex'));
const SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();
const USER_COOKIE = 'user_session';
const USER_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const loadUsers = () => loadJson(USERS_FILE, []);
const saveUsers = (users) => saveJson(USERS_FILE, users);
const hmac = (text) => crypto.createHmac('sha256', SECRET).update(text).digest('base64url');

function signToken(user) {
  const body = Buffer.from(JSON.stringify({ uid: user.id, v: user.tokenVersion || 0, exp: Date.now() + USER_TTL_MS })).toString('base64url');
  return body + '.' + hmac(body);
}
function currentUser(req) {
  const token = parseCookies(req)[USER_COOKIE];
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = hmac(body);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
  if (!p || p.exp < Date.now()) return null;
  const user = loadUsers().find((u) => u.id === p.uid);
  return user && (user.tokenVersion || 0) === p.v ? user : null;
}
function requireUser(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Please sign in first' });
  req.user = user;
  next();
}
function setUserCookie(req, res, user) {
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${USER_COOKIE}=${signToken(user)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${USER_TTL_MS / 1000}${secure}`);
}
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
function checkPassword(password, stored) {
  const [, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const a = Buffer.from(crypto.scryptSync(password, salt, 64).toString('hex'));
  const b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const publicUser = (u) => (u ? { id: u.id, name: u.name } : null);

app.post('/api/auth/signup', (req, res) => {
  // Only successful sign-ups count towards the limit (5 new accounts per hour per network).
  const signupKey = 'signup|' + req.ip;
  const signupRec = limits.get(signupKey);
  if (signupRec && signupRec.resetAt > Date.now() && signupRec.count >= 5) return res.status(429).json({ error: 'Too many accounts created. Try again later.' });
  const name = String(req.body?.name || '').replace(/\s+/g, ' ').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (name.length < 2 || name.length > 30) return res.status(400).json({ error: 'Name must be 2 to 30 characters.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 8 || password.length > 200) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const users = loadUsers();
  if (users.some((u) => u.email === email)) return res.status(409).json({ error: 'An account with this email already exists. Sign in instead.' });
  const user = { id: crypto.randomBytes(8).toString('base64url'), name, email, pass: hashPassword(password), createdAt: new Date().toISOString(), progress: {} };
  users.push(user);
  saveUsers(users);
  allow(signupKey, 5, 60 * 60 * 1000);
  setUserCookie(req, res, user);
  res.status(201).json({ user: publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const key = 'userlogin|' + req.ip;
  const rec = limits.get(key);
  if (rec && rec.resetAt > Date.now() && rec.count >= 10) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const user = loadUsers().find((u) => u.email === email);
  if (!user || !checkPassword(String(req.body?.password || ''), user.pass)) {
    allow(key, 10, 15 * 60 * 1000);
    return res.status(401).json({ error: 'Wrong email or password.' });
  }
  setUserCookie(req, res, user);
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${USER_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => res.json({ user: publicUser(currentUser(req)), admin: isAdmin(req) }));

// ---------- Password reset + change ----------
// Email is optional: set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and MAIL_FROM in .env to send reset emails.
// Without them, reset links are printed in the server console and you can create them from /admin.
const RESET_TTL_MS = 60 * 60 * 1000;
const mailer = process.env.SMTP_HOST
  ? require('nodemailer').createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    })
  : null;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const siteUrl = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');

// Creates a one-time link valid for 1 hour. Only a hash of the token is stored.
function createResetLink(req, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const users = loadUsers();
  const u = users.find((x) => x.id === userId);
  if (!u) return null;
  u.reset = { hash: sha256(token), exp: Date.now() + RESET_TTL_MS };
  saveUsers(users);
  return `${siteUrl(req)}/reset?token=${token}`;
}

app.post('/api/auth/forgot', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  // Always the same answer, so nobody can use this to find out who has an account.
  const reply = () => res.json({ ok: true, emailEnabled: !!mailer });
  if (!allow('forgot|' + req.ip, 5, 60 * 60 * 1000) || !allow('forgot|' + email, 3, 60 * 60 * 1000)) return reply();
  const user = loadUsers().find((u) => u.email === email);
  if (!user) return reply();
  const link = createResetLink(req, user.id);
  if (!mailer) {
    console.log(`[password reset] ${user.email}: ${link}`);
    return reply();
  }
  try {
    await mailer.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to: user.email,
      subject: `Reset your ${SITE_NAME} password`,
      text: `Hi ${user.name},\n\nSomeone asked to reset the password for your ${SITE_NAME} account.\n` +
        `Open this link within 1 hour to choose a new password:\n\n${link}\n\nIf this wasn't you, ignore this email. Your password won't change.`,
    });
  } catch (err) {
    console.error('Could not send reset email:', err.message, '- link:', link);
  }
  reply();
});

app.post('/api/auth/reset', (req, res) => {
  if (!allow('reset|' + req.ip, 10, 15 * 60 * 1000)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  const hash = sha256(String(req.body?.token || ''));
  const password = String(req.body?.password || '');
  if (password.length < 8 || password.length > 200) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const users = loadUsers();
  const u = users.find((x) => x.reset && x.reset.hash === hash);
  if (!u || u.reset.exp < Date.now()) return res.status(400).json({ error: 'This reset link has expired or was already used. Ask for a new one.' });
  u.pass = hashPassword(password);
  u.tokenVersion = (u.tokenVersion || 0) + 1; // signs out every other device
  delete u.reset;
  saveUsers(users);
  setUserCookie(req, res, u);
  res.json({ user: publicUser(u) });
});

app.post('/api/auth/change-password', requireUser, (req, res) => {
  if (!checkPassword(String(req.body?.current || ''), req.user.pass)) return res.status(400).json({ error: 'Your current password is wrong.' });
  const password = String(req.body?.password || '');
  if (password.length < 8 || password.length > 200) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  const users = loadUsers();
  const u = users.find((x) => x.id === req.user.id);
  u.pass = hashPassword(password);
  u.tokenVersion = (u.tokenVersion || 0) + 1; // signs out every other device
  delete u.reset;
  saveUsers(users);
  setUserCookie(req, res, u);
  res.json({ ok: true });
});

// Admin: list viewers and create a reset link to send someone yourself.
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const comments = loadComments();
  res.json(loadUsers().map((u) => ({
    id: u.id, name: u.name, email: u.email, createdAt: u.createdAt,
    comments: comments.filter((c) => c.userId === u.id).length,
  })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
});
app.post('/api/admin/users/:uid/reset-link', requireAdmin, (req, res) => {
  const link = createResetLink(req, req.params.uid);
  if (!link) return res.status(404).json({ error: 'User not found' });
  res.json({ link, expiresInMinutes: RESET_TTL_MS / 60000 });
});

// ---------- Continue watching (signed-in viewers only, works across devices) ----------
app.get('/api/me/progress', requireUser, (req, res) => res.json(req.user.progress || {}));
app.post('/api/me/progress', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(204).end();
  const id = String(req.body?.id || '');
  const t = Number(req.body?.t), d = Number(req.body?.d);
  if (!id || !isFinite(t) || !isFinite(d) || d <= 0 || !loadVideos().some((v) => v.id === id)) return res.status(400).json({ error: 'Bad progress' });
  const users = loadUsers();
  const u = users.find((x) => x.id === user.id);
  u.progress = u.progress || {};
  if (t < Math.min(5, d * 0.1) || t > d - Math.min(10, d * 0.1)) delete u.progress[id]; // barely started or finished
  else u.progress[id] = { t: Math.floor(t), d: Math.floor(d), at: Date.now() };
  // Keep the 100 most recent.
  u.progress = Object.fromEntries(Object.entries(u.progress).sort((a, b) => b[1].at - a[1].at).slice(0, 100));
  saveUsers(users);
  res.json({ ok: true });
});

// ---------- Comments ----------
const loadComments = () => loadJson(COMMENTS_FILE, []);
const saveComments = (c) => saveJson(COMMENTS_FILE, c);
function publicComment(c, user, admin) {
  return { id: c.id, name: c.userName, text: c.text, createdAt: c.createdAt, mine: !!user && c.userId === user.id, canDelete: admin || (!!user && c.userId === user.id) };
}

app.get('/api/videos/:id/comments', (req, res) => {
  const user = currentUser(req), admin = isAdmin(req);
  const list = loadComments().filter((c) => c.videoId === req.params.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(list.map((c) => publicComment(c, user, admin)));
});

app.post('/api/videos/:id/comments', requireUser, (req, res) => {
  if (!allow('comment|' + req.user.id, 10, 10 * 60 * 1000)) return res.status(429).json({ error: 'You are commenting too fast. Wait a few minutes.' });
  if (!loadVideos().some((v) => v.id === req.params.id)) return res.status(404).json({ error: 'Video not found' });
  const text = String(req.body?.text || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 2000);
  if (!text) return res.status(400).json({ error: 'Write something first.' });
  const comments = loadComments();
  const c = { id: crypto.randomBytes(6).toString('base64url'), videoId: req.params.id, userId: req.user.id, userName: req.user.name, text, createdAt: new Date().toISOString() };
  comments.push(c);
  saveComments(comments);
  res.status(201).json(publicComment(c, req.user, isAdmin(req)));
});

app.delete('/api/comments/:cid', (req, res) => {
  const user = currentUser(req), admin = isAdmin(req);
  const comments = loadComments();
  const c = comments.find((x) => x.id === req.params.cid);
  if (!c) return res.status(404).json({ error: 'Comment not found' });
  if (!admin && !(user && c.userId === user.id)) return res.status(403).json({ error: 'You can only delete your own comments' });
  saveComments(comments.filter((x) => x.id !== c.id));
  res.json({ ok: true });
});

// ---------- Views, ratings and watch heatmap ----------
app.post('/api/videos/:id/view', (req, res) => {
  if (!allow('view|' + req.ip + '|' + req.params.id, 1, 30 * 60 * 1000)) return res.json({ ok: true, counted: false });
  const v = updateVideo(req.params.id, (x) => (x.views = (x.views || 0) + 1));
  if (!v) return res.status(404).json({ error: 'Video not found' });
  res.json({ ok: true, counted: true, views: v.views || 0 });
});

// One like or dislike per account. Send { to: 'up' | 'down' | 'none' }.
app.post('/api/videos/:id/vote', requireUser, (req, res) => {
  const to = ['up', 'down', 'none'].includes(req.body?.to) ? req.body.to : 'none';
  const field = { up: 'likes', down: 'dislikes' };
  const v = updateVideo(req.params.id, (x) => {
    x.voters = x.voters || {};
    const from = x.voters[req.user.id] || 'none';
    if (field[from]) x[field[from]] = Math.max(0, (x[field[from]] || 0) - 1);
    if (field[to]) x[field[to]] = (x[field[to]] || 0) + 1;
    if (to === 'none') delete x.voters[req.user.id];
    else x.voters[req.user.id] = to;
  });
  if (!v) return res.status(404).json({ error: 'Video not found' });
  res.json({ likes: v.likes || 0, dislikes: v.dislikes || 0, myVote: v.voters[req.user.id] || 'none' });
});

// Which parts of the video were watched: a list of bucket numbers (0-99).
app.post('/api/videos/:id/heat', (req, res) => {
  if (!allow('heat|' + req.ip + '|' + req.params.id, 3, 30 * 60 * 1000)) return res.json({ ok: true });
  const buckets = [...new Set((Array.isArray(req.body?.b) ? req.body.b : [])
    .map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < HEAT_BUCKETS))];
  if (!buckets.length) return res.json({ ok: true });
  const v = updateVideo(req.params.id, (x) => {
    if (!Array.isArray(x.heat) || x.heat.length !== HEAT_BUCKETS) x.heat = new Array(HEAT_BUCKETS).fill(0);
    for (const b of buckets) x.heat[b]++;
    x.heatSessions = (x.heatSessions || 0) + 1;
  });
  if (!v) return res.status(404).json({ error: 'Video not found' });
  res.json({ ok: true });
});

// ---------- Reports from viewers ----------
const REPORT_REASONS = ['broken', 'wrong-info', 'inappropriate', 'copyright', 'other'];
app.post('/api/videos/:id/report', (req, res) => {
  if (!allow('report|' + req.ip, 5, 60 * 60 * 1000)) return res.status(429).json({ error: 'Too many reports. Try again later.' });
  const v = loadVideos().find((x) => x.id === req.params.id);
  if (!v) return res.status(404).json({ error: 'Video not found' });
  const reason = REPORT_REASONS.includes(req.body?.reason) ? req.body.reason : 'other';
  const message = String(req.body?.message || '').trim().slice(0, 1000);
  const reports = loadJson(REPORTS_FILE, []);
  reports.unshift({ id: crypto.randomBytes(6).toString('base64url'), videoId: v.id, videoTitle: v.title, reason, message, createdAt: new Date().toISOString() });
  saveJson(REPORTS_FILE, reports.slice(0, 500));
  res.json({ ok: true });
});
app.get('/api/reports', requireAdmin, (req, res) => res.json(loadJson(REPORTS_FILE, [])));
app.delete('/api/reports/:rid', requireAdmin, (req, res) => {
  saveJson(REPORTS_FILE, loadJson(REPORTS_FILE, []).filter((r) => r.id !== req.params.rid));
  res.json({ ok: true });
});

// ---------- Popular searches ----------
// Only searches that actually find a video are counted, so nobody can push random text into the list.
function searchMatches(q, videos) {
  const words = q.split(/\s+/).filter(Boolean);
  return videos.some((v) => {
    const hay = (v.title + ' ' + (v.tags || []).join(' ') + ' ' + v.description).toLowerCase();
    return words.every((w) => hay.includes(w.replace(/^#/, '')));
  });
}
app.post('/api/searches', (req, res) => {
  const q = String(req.body?.q || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60);
  if (q.length < 2 || !allow('search|' + req.ip + '|' + q, 1, 60 * 60 * 1000) || !allow('searches|' + req.ip, 30, 60 * 60 * 1000)) {
    return res.json({ ok: true });
  }
  if (!searchMatches(q, loadVideos())) return res.json({ ok: true });
  const counts = loadJson(SEARCHES_FILE, {});
  counts[q] = (counts[q] || 0) + 1;
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 1000);
  saveJson(SEARCHES_FILE, Object.fromEntries(entries));
  res.json({ ok: true });
});
app.get('/api/searches/popular', (req, res) => {
  const videos = loadVideos();
  const top = Object.entries(loadJson(SEARCHES_FILE, {}))
    .sort((a, b) => b[1] - a[1])
    .filter(([q]) => searchMatches(q, videos))
    .slice(0, 8)
    .map(([q]) => q);
  res.json(top);
});

// ---------- Admin login ----------
app.get('/api/me', (req, res) => res.json({ admin: isAdmin(req) }));

app.post('/api/login', (req, res) => {
  const ip = req.ip;
  const key = 'login|' + ip;
  const rec = limits.get(key);
  if (rec && rec.resetAt > Date.now() && rec.count >= 5) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  if (!passwordMatches(req.body?.password ?? '')) {
    allow(key, 5, 15 * 60 * 1000);
    return res.status(401).json({ error: 'Wrong password' });
  }
  limits.delete(key);
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  const secure = req.secure ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure}`
  );
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  sessions.delete(parseCookies(req)[SESSION_COOKIE]);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

// ---------- Home page banner: up to 5 videos you pick, in your order ----------
// With none picked, the home page shows the 5 newest uploads instead.
function featuredIds() {
  const existing = new Set(loadVideos().map((v) => v.id));
  return (loadJson(SETTINGS_FILE, {}).featured || []).filter((id) => existing.has(id)).slice(0, MAX_FEATURED);
}
app.get('/api/featured', (req, res) => res.json({ ids: featuredIds(), max: MAX_FEATURED }));
app.put('/api/featured', requireAdmin, (req, res) => {
  if (!Array.isArray(req.body?.ids)) return res.status(400).json({ error: 'Send a list of video ids' });
  const existing = new Set(loadVideos().map((v) => v.id));
  const ids = [...new Set(req.body.ids.map(String))].filter((id) => existing.has(id));
  if (ids.length > MAX_FEATURED) return res.status(400).json({ error: `You can feature up to ${MAX_FEATURED} videos` });
  saveJson(SETTINGS_FILE, { ...loadJson(SETTINGS_FILE, {}), featured: ids });
  res.json({ ids, max: MAX_FEATURED });
});

// ---------- Managing videos (admin only) ----------
app.post('/api/videos', requireAdmin, (req, res) => {
  upload.fields([{ name: 'video', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }])(req, res, async (err) => {
    const videoFile = req.files?.video?.[0];
    const thumbFile = req.files?.thumbnail?.[0];
    const discard = (f) => f && fs.rm(f.path, { force: true }, () => {});
    if (err) {
      discard(videoFile); discard(thumbFile);
      const msg = err.code === 'LIMIT_FILE_SIZE' ? `File is larger than ${MAX_UPLOAD_MB} MB` : err.message;
      return res.status(400).json({ error: msg });
    }
    if (!videoFile) { discard(thumbFile); return res.status(400).json({ error: 'No video file received' }); }
    if (thumbFile && thumbFile.size > MAX_THUMB_BYTES) {
      discard(videoFile); discard(thumbFile);
      return res.status(400).json({ error: 'Thumbnail image must be under 15 MB' });
    }
    req.file = videoFile;

    const title = String(req.body.title || '').trim().slice(0, 200) ||
      path.parse(req.file.originalname).name.slice(0, 200);
    const description = String(req.body.description || '').trim().slice(0, 5000);

    const video = {
      id: crypto.randomBytes(6).toString('base64url'),
      title,
      description,
      tags: normalizeTags(req.body.tags),
      filename: req.file.filename,
      mimetype: req.file.mimetype,
      size: req.file.size,
      createdAt: new Date().toISOString(),
    };
    // Your own thumbnail, if you picked one. If the image can't be read, an automatic one is made instead.
    let thumbWarning = null;
    if (thumbFile) {
      const poster = `${path.parse(video.filename).name}_poster.jpg`;
      try {
        await makePoster(thumbFile.path, videoPath(poster), 0);
        Object.assign(video, { poster, posterVersion: 1, customPoster: true });
      } catch {
        thumbWarning = 'The thumbnail image could not be read, so an automatic one will be used. You can change it any time.';
      }
      discard(thumbFile);
    }
    const videos = loadVideos();
    videos.push(video);
    saveVideos(videos);
    enqueue(video.id);
    res.status(201).json({ ...publicVideo(video), thumbWarning });
  });
});

app.patch('/api/videos/:id', requireAdmin, (req, res) => {
  const v = updateVideo(req.params.id, (x) => {
    if (typeof req.body.title === 'string' && req.body.title.trim()) x.title = req.body.title.trim().slice(0, 200);
    if (typeof req.body.description === 'string') x.description = req.body.description.trim().slice(0, 5000);
    if (req.body.tags !== undefined) x.tags = normalizeTags(req.body.tags);
  });
  if (!v) return res.status(404).json({ error: 'Video not found' });
  res.json(publicVideo(v));
});

// Custom cover image: upload a picture ("image"), pick a moment ({ time }), or go back to automatic ({ reset: true }).
app.post('/api/videos/:id/thumbnail', requireAdmin, (req, res) => {
  imageUpload.single('image')(req, res, async (err) => {
    const cleanup = () => req.file && fs.rm(req.file.path, { force: true }, () => {});
    if (err) return res.status(400).json({ error: err.message });
    const v = loadVideos().find((x) => x.id === req.params.id);
    if (!v) { cleanup(); return res.status(404).json({ error: 'Video not found' }); }
    const out = videoPath(`${baseName(v)}_poster.jpg`);
    const reset = req.body?.reset === true || req.body?.reset === 'true';
    try {
      if (req.file) await makePoster(req.file.path, out, 0);
      else if (reset) await makePoster(videoPath(v.filename), out, defaultPosterTime(v.duration));
      else if (req.body?.time !== undefined && isFinite(Number(req.body.time))) {
        const t = Math.min(Math.max(0, Number(req.body.time)), Math.max(0, (v.duration || 0) - 0.1));
        await makePoster(videoPath(v.filename), out, t);
      } else return res.status(400).json({ error: 'Send an image, a time, or reset' });
    } catch (e) {
      return res.status(500).json({ error: 'Could not create the thumbnail' });
    } finally {
      cleanup();
    }
    const updated = updateVideo(v.id, (x) => {
      x.poster = `${baseName(x)}_poster.jpg`;
      x.posterVersion = (x.posterVersion || 0) + 1;
      x.customPoster = !reset;
    });
    res.json(publicVideo(updated));
  });
});

app.delete('/api/videos/:id', requireAdmin, (req, res) => {
  const videos = loadVideos();
  const idx = videos.findIndex((x) => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Video not found' });
  const [removed] = videos.splice(idx, 1);
  saveVideos(videos);
  removeVideoFiles(removed);
  saveComments(loadComments().filter((c) => c.videoId !== removed.id));
  const settings = loadJson(SETTINGS_FILE, {});
  if ((settings.featured || []).includes(removed.id)) {
    saveJson(SETTINGS_FILE, { ...settings, featured: settings.featured.filter((id) => id !== removed.id) });
  }
  res.json({ ok: true });
});

// Video files (express.static supports Range requests, so seeking works).
app.use('/media', express.static(VIDEO_DIR, { fallthrough: false, maxAge: '7d' }));

app.get('/watch', (req, res) => res.sendFile(path.join(__dirname, 'public', 'watch.html')));
app.get('/reset', (req, res) => res.sendFile(path.join(__dirname, 'public', 'reset.html')));
app.get('/embed/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'embed.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.use(express.static(path.join(__dirname, 'public')));

// On startup: clear half-finished files, then process any video that still needs it.
for (const f of fs.readdirSync(VIDEO_DIR)) {
  if (f.endsWith('.part.mp4')) fs.rmSync(videoPath(f), { force: true });
}
for (const f of fs.readdirSync(TMP_DIR)) fs.rmSync(path.join(TMP_DIR, f), { force: true });
for (const v of loadVideos()) {
  if (v.processing === 'failed') continue;
  if (v.processing !== 'done' || (v.assets || 0) < ASSETS_VERSION) enqueue(v.id);
}

app.listen(PORT, () => {
  console.log(`${SITE_NAME} running at http://localhost:${PORT}`);
  console.log(`Upload page: http://localhost:${PORT}/admin`);
});
