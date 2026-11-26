// Shared helpers for all pages. Needs i18n.js loaded first (for t()).
async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
  json(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
};

function timeAgo(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  const units = [[31536000, 'year'], [2592000, 'month'], [604800, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];
  for (const [secs, name] of units) {
    const n = Math.floor(s / secs);
    if (n >= 1) return t(n > 1 ? `{n} ${name}s ago` : `{n} ${name} ago`, { n });
  }
  return t('just now');
}

function formatDuration(sec) {
  if (!isFinite(sec) || !sec) return '';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = h ? String(m).padStart(2, '0') : m;
  return (h ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0');
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

const capitalize = (s) => s.replace(/(^|\s)\S/g, (c) => c.toUpperCase());

// 1234 -> "1.2K", 2500000 -> "2.5M"
function fmtCount(n) {
  n = n || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return String(n);
}

const topHeight = (v) => Math.max(0, ...(v.sources || []).map((s) => s.height || 0));

// Replaces text in static HTML marked with data-t / data-t-placeholder / data-t-aria.
function translatePage(root = document) {
  root.querySelectorAll('[data-t]').forEach((n) => (n.textContent = t(n.dataset.t || n.textContent.trim())));
  root.querySelectorAll('[data-t-placeholder]').forEach((n) => (n.placeholder = t(n.dataset.tPlaceholder)));
  root.querySelectorAll('[data-t-aria]').forEach((n) => n.setAttribute('aria-label', t(n.dataset.tAria)));
}

// ---------- Icons ----------
const S = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
  home: `<svg ${S}><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/></svg>`,
  search: `<svg ${S}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`,
  grid: `<svg ${S}><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>`,
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>',
  replay: `<svg ${S}><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>`,
  volOff: `<svg ${S}><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="m22 9-6 6M16 9l6 6"/></svg>`,
  volOn: `<svg ${S}><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>`,
  back10: `<svg ${S}><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><text x="12.5" y="15.5" font-size="7" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none" font-family="Arial, sans-serif">10</text></svg>`,
  fwd10: `<svg ${S}><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/><text x="11.5" y="15.5" font-size="7" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none" font-family="Arial, sans-serif">10</text></svg>`,
  settings: `<svg ${S}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  theater: `<svg ${S}><rect x="2" y="6" width="20" height="12" rx="2"/></svg>`,
  fs: `<svg ${S}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>`,
  fsExit: `<svg ${S}><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>`,
  cast: `<svg ${S}><path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"/><path d="M2 20h.01"/></svg>`,
  thumbUp: `<svg ${S}><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg>`,
  thumbDown: `<svg ${S}><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/></svg>`,
  share: `<svg ${S}><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98"/></svg>`,
  flag: `<svg ${S}><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/></svg>`,
  user: `<svg ${S}><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>`,
  logout: `<svg ${S}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/></svg>`,
  comment: `<svg ${S}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  close: `<svg ${S}><path d="M18 6 6 18M6 6l12 12"/></svg>`,
  copy: `<svg ${S}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  code: `<svg ${S}><path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/></svg>`,
  mail: `<svg ${S}><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>`,
  clock: `<svg ${S}><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`,
  chevL: `<svg ${S}><path d="m15 18-6-6 6-6"/></svg>`,
  chevR: `<svg ${S}><path d="m9 18 6-6-6-6"/></svg>`,
  info: `<svg ${S}><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>`,
};

function icon(name) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML = ICONS[name]; // static, trusted SVG strings only
  return span;
}

// ---------- Viewer accounts ----------
// auth.ready resolves once we know who is signed in (and their Continue Watching list).
const auth = {
  user: null,
  admin: false,
  progress: {},
  async load() {
    try {
      const r = await getJSON('/api/auth/me');
      this.user = r.user;
      this.admin = r.admin;
      if (this.user) this.progress = await getJSON('/api/me/progress').catch(() => ({}));
    } catch {}
  },
};
auth.ready = auth.load();

// Returns true if signed in; otherwise opens the sign-up window and returns false.
function requireSignIn(reason) {
  if (auth.user) return true;
  openAuthDialog('signup', reason);
  return false;
}

function openAuthDialog(mode = 'signin', reason = '') {
  const body = el('div', { class: 'auth' });
  function render() {
    if (mode === 'forgot') return renderForgot();
    const signup = mode === 'signup';
    const name = el('input', { type: 'text', name: 'name', autocomplete: 'name', maxlength: '30', required: '' });
    const email = el('input', { type: 'email', name: 'email', autocomplete: 'email', maxlength: '120', required: '' });
    const pass = el('input', { type: 'password', name: 'password', autocomplete: signup ? 'new-password' : 'current-password', minlength: '8', required: '' });
    const status = el('p', { class: 'status error', role: 'alert' });
    const submit = el('button', { class: 'btn wide', type: 'submit' }, signup ? 'Create account' : 'Sign in');
    const form = el('form', { class: 'auth-form' },
      ...(reason ? [el('p', { class: 'auth-reason' }, reason)] : []),
      ...(signup ? [el('label', { class: 'field' }, el('span', {}, 'Name'), name)] : []),
      el('label', { class: 'field' }, el('span', {}, 'Email'), email),
      el('label', { class: 'field' }, el('span', {}, 'Password'), pass, ...(signup ? [el('small', {}, 'At least 8 characters')] : [])),
      ...(signup ? [] : [forgotLink()]),
      status, submit);
    const switchBtn = el('button', { class: 'link-btn', type: 'button' }, signup ? 'Sign in' : 'Create one');
    switchBtn.onclick = () => { mode = signup ? 'signin' : 'signup'; render(); };
    form.onsubmit = async (e) => {
      e.preventDefault();
      submit.disabled = true;
      status.textContent = '';
      const payload = { email: email.value, password: pass.value, ...(signup ? { name: name.value } : {}) };
      try {
        const res = await fetch(signup ? '/api/auth/signup' : '/api/auth/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.');
        location.reload();
      } catch (err) {
        status.textContent = err.message;
        submit.disabled = false;
      }
    };
    body.replaceChildren(form, el('p', { class: 'auth-switch' }, signup ? 'Already have an account? ' : 'New here? ', switchBtn));
    const title = body.closest('.modal')?.querySelector('.modal-head h2');
    if (title) title.textContent = signup ? 'Create your account' : 'Sign in';
    (signup ? name : email).focus();
  }
  function forgotLink() {
    const b = el('button', { class: 'link-btn forgot', type: 'button' }, 'Forgot password?');
    b.onclick = () => { mode = 'forgot'; render(); };
    return b;
  }
  function setTitle(text) {
    const title = body.closest('.modal')?.querySelector('.modal-head h2');
    if (title) title.textContent = text;
  }
  function renderForgot() {
    setTitle('Reset your password');
    const email = el('input', { type: 'email', name: 'email', autocomplete: 'email', maxlength: '120', required: '' });
    const submit = el('button', { class: 'btn wide', type: 'submit' }, 'Send reset link');
    const status = el('p', { class: 'status', role: 'status' });
    const form = el('form', { class: 'auth-form' },
      el('p', { class: 'meta' }, "Enter the email you signed up with and we'll send you a link to choose a new password."),
      el('label', { class: 'field' }, el('span', {}, 'Email'), email),
      status, submit);
    form.onsubmit = async (e) => {
      e.preventDefault();
      submit.disabled = true;
      const res = await fetch('/api/auth/forgot', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.value }),
      }).catch(() => null);
      const data = res ? await res.json().catch(() => ({})) : {};
      if (!res || !res.ok) { status.textContent = 'Something went wrong. Try again.'; status.classList.add('error'); submit.disabled = false; return; }
      form.replaceChildren(el('div', { class: 'auth-done' },
        el('strong', {}, 'Check your email'),
        el('p', {}, data.emailEnabled
          ? `If an account exists for ${email.value}, a reset link is on its way. It works for 1 hour.`
          : `If an account exists for ${email.value}, the site owner can send you a reset link. Please contact them.`)));
    };
    const back = el('button', { class: 'link-btn', type: 'button' }, 'Back to sign in');
    back.onclick = () => { mode = 'signin'; render(); };
    body.replaceChildren(form, el('p', { class: 'auth-switch' }, back));
    email.focus();
  }
  const close = openModal(mode === 'signup' ? 'Create your account' : 'Sign in', body);
  render();
  return close;
}

function openAccountMenu() {
  const out = el('button', { class: 'btn secondary wide', type: 'button' }, icon('logout'), 'Sign out');
  out.onclick = async () => { await fetch('/api/auth/logout', { method: 'POST' }); location.reload(); };
  const change = el('button', { class: 'btn secondary wide', type: 'button' }, 'Change password');
  const box = el('div', { class: 'account' },
    el('div', { class: 'account-row' }, el('span', { class: 'avatar big' }, auth.user.name[0].toUpperCase()),
      el('div', {}, el('div', { class: 'account-name' }, auth.user.name), el('div', { class: 'meta' }, 'Signed in'))),
    change, out);
  change.onclick = () => {
    const current = el('input', { type: 'password', autocomplete: 'current-password', required: '' });
    const next = el('input', { type: 'password', autocomplete: 'new-password', minlength: '8', required: '' });
    const status = el('p', { class: 'status', role: 'status' });
    const save = el('button', { class: 'btn wide', type: 'submit' }, 'Save new password');
    const form = el('form', { class: 'auth-form' },
      el('label', { class: 'field' }, el('span', {}, 'Current password'), current),
      el('label', { class: 'field' }, el('span', {}, 'New password'), next, el('small', {}, 'At least 8 characters. You will be signed out on other devices.')),
      status, save);
    form.onsubmit = async (e) => {
      e.preventDefault();
      save.disabled = true;
      const res = await fetch('/api/auth/change-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current: current.value, password: next.value }),
      }).catch(() => null);
      const data = res ? await res.json().catch(() => ({})) : {};
      if (res && res.ok) { form.replaceChildren(el('div', { class: 'auth-done' }, el('strong', {}, 'Password changed'), el('p', {}, 'Use your new password next time you sign in.'))); return; }
      status.textContent = data.error || 'Could not change your password. Try again.';
      status.classList.add('error');
      save.disabled = false;
    };
    change.replaceWith(form);
    current.focus();
  };
  openModal('Your account', box);
}

// ---------- Navigation ----------
// Top bar: logo on the left (it goes home), then a search field and the account button on the right.
// See-through over the banner, solid black once the page scrolls.
// The search page uses this same field for live results; on other pages Enter opens the results.
function topSearchField() {
  const input = el('input', { type: 'search', name: 'q', placeholder: 'Search', 'aria-label': 'Search videos',
    autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search' });
  const clear = el('button', { class: 'top-find-clear', type: 'button', 'aria-label': 'Clear search', hidden: '' }, icon('close'));
  const form = el('form', { class: 'top-find', role: 'search', action: '/' }, icon('search'), input, clear);
  const sync = () => { clear.hidden = !input.value; };
  input.addEventListener('input', sync);
  clear.onclick = () => {
    input.value = '';
    sync();
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (form.dataset.live) return; // the search page already shows results as you type
    const q = input.value.trim();
    location.href = q ? '/?q=' + encodeURIComponent(q) : '/?view=search';
  });
  form.sync = sync;
  return form;
}

function renderSidebar() {
  const accountBtn = el('button', { class: 'top-account', type: 'button' }, 'Sign In');
  accountBtn.onclick = () => (auth.user ? openAccountMenu() : openAuthDialog('signin'));
  auth.ready.then(() => {
    if (!auth.user) return;
    accountBtn.classList.add('signed-in');
    accountBtn.replaceChildren(el('span', { class: 'avatar' }, auth.user.name[0].toUpperCase()));
    accountBtn.title = 'Your account';
    accountBtn.setAttribute('aria-label', 'Your account');
  });

  const nav = el('nav', { class: 'topbar', 'aria-label': 'Main' },
    el('a', { class: 'top-logo', href: '/' }, el('span', { class: 'logo-mark' }), el('span', { class: 'site-name' })),
    el('div', { class: 'top-right' }, topSearchField(), accountBtn));
  document.body.prepend(nav);
  // Scrolling down tucks the bar away; any scroll up brings it straight back.
  // It always shows near the top of the page and while you're using the search field.
  let lastY = window.scrollY;
  const sync = () => {
    const y = Math.max(0, window.scrollY);
    nav.classList.toggle('scrolled', y > 8);
    const typing = nav.contains(document.activeElement) && document.activeElement.tagName === 'INPUT';
    if (y < nav.offsetHeight || typing) nav.classList.remove('tucked');
    else if (y > lastY + 4) nav.classList.add('tucked');
    else if (y < lastY - 4) nav.classList.remove('tucked');
    if (Math.abs(y - lastY) > 4) lastY = y;
  };
  window.addEventListener('scroll', sync, { passive: true });
  nav.addEventListener('focusin', () => nav.classList.remove('tucked')); // e.g. tabbing to it with the keyboard
  sync();
}

const siteConfig = getJSON('/api/config').catch(() => ({}));
async function applySiteName() {
  try {
    const { siteName } = await siteConfig;
    if (!siteName) return '';
    document.querySelectorAll('.site-name').forEach((n) => (n.textContent = siteName));
    if (!document.title || document.title === 'Videos') document.title = siteName;
    return siteName;
  } catch { return ''; }
}

// ---------- Continue watching (signed-in viewers only; saved on the server) ----------
const watchHistory = {
  position(id) { return auth.user ? auth.progress[id] || null : null; },
  save(id, time, duration) {
    if (!auth.user || !duration) return;
    if (time < Math.min(5, duration * 0.1) || time > duration - Math.min(10, duration * 0.1)) delete auth.progress[id];
    else auth.progress[id] = { t: Math.floor(time), d: Math.floor(duration), at: Date.now() };
    fetch('/api/me/progress', {
      method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, t: time, d: duration }),
    }).catch(() => {});
  },
  finish(id, duration) { this.save(id, duration, duration); },
  // Videos started but not finished, most recent first.
  inProgress(videos) {
    if (!auth.user) return [];
    const byId = new Map(videos.map((v) => [v.id, v]));
    return Object.entries(auth.progress)
      .sort((a, b) => b[1].at - a[1].at)
      .map(([id]) => byId.get(id))
      .filter(Boolean);
  },
};

// ---------- Video helpers ----------
function previewSrc(v) {
  return v.sources && v.sources.length > 1 ? v.sources[v.sources.length - 1].url : v.url;
}
function heroSrc(v) {
  const r = (v.sources || []).filter((s) => !s.original)
    .sort((a, b) => Math.abs(a.height - 720) - Math.abs(b.height - 720))[0];
  return r ? r.url : v.url;
}

// "1957 • 1:45 • Added 3 weeks ago". The year is the film's release year, left out when it isn't known.
function metaLine(v, durationOverride) {
  const added = timeAgo(v.createdAt);
  const bits = [v.year ? String(v.year) : '', formatDuration(durationOverride || v.duration), added && 'Added ' + added]
    .filter(Boolean);
  const out = [];
  bits.forEach((b, i) => { if (i) out.push(el('span', { class: 'dot' })); out.push(el('span', {}, b)); });
  return out;
}

// Only load a fallback preview when it is about to scroll into view.
const lazyObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    if (!e.target.src) e.target.src = e.target.dataset.src;
    lazyObserver.unobserve(e.target);
  }
}, { rootMargin: '300px' });

// Cover image (or a frame from the video if there's no cover yet) + resume bar + hover preview.
function thumbMedia(v, card) {
  const wrap = document.createDocumentFragment();
  if (v.poster) {
    wrap.append(el('img', { class: 'thumb-img', src: v.poster, alt: '', loading: 'lazy', decoding: 'async' }));
  } else {
    const still = el('video', { class: 'thumb-img', preload: 'metadata', muted: '', playsinline: '', disablepictureinpicture: '' });
    still.dataset.src = previewSrc(v) + '#t=1';
    still.muted = true;
    lazyObserver.observe(still);
    wrap.append(still);
  }
  const p = watchHistory.position(v.id);
  if (p && p.d && p.t > 5) {
    wrap.append(el('div', { class: 'resume-bar' }, el('div', { style: `width:${Math.min(100, (p.t / p.d) * 100)}%` })));
  }
  attachHoverPreview(card, v);
  return wrap;
}

// Plays a silent preview while the mouse rests on a card.
// Where each hover preview was stopped, so hovering again carries on from there
// (even after the cards are redrawn, e.g. when changing pages). Plays to the end, then loops.
const previewPositions = new Map();
function attachHoverPreview(card, v) {
  let timer, video;
  card.addEventListener('mouseenter', () => {
    timer = setTimeout(() => {
      const box = card.querySelector('.thumb-box');
      if (!box) return;
      if (!video) {
        video = el('video', { class: 'thumb-preview', muted: '', loop: '', playsinline: '', disablepictureinpicture: '', preload: 'auto' });
        video.muted = true;
        video.src = previewSrc(v);
        const saved = previewPositions.get(v.id);
        if (saved) video.addEventListener('loadedmetadata', () => { if (saved < video.duration) video.currentTime = saved; }, { once: true });
        video.addEventListener('playing', () => card.classList.add('playing'));
        box.append(video);
      }
      video.play().catch(() => {});
    }, 450);
  });
  card.addEventListener('mouseleave', () => {
    clearTimeout(timer);
    card.classList.remove('playing');
    if (video) {
      video.pause();
      if (video.currentTime > 0) previewPositions.set(v.id, video.currentTime);
    }
  });
}

// Landscape tile used on the home page and search page.
function tile(v) {
  const a = el('a', { class: 'tile', href: '/watch?v=' + encodeURIComponent(v.id) });
  const top = topHeight(v);
  // Picture on top (with length + HD badge), title and details underneath.
  a.append(
    el('div', { class: 'tile-media thumb-box' },
      thumbMedia(v, a),
      ...(top >= 720 ? [el('span', { class: 'badge-hd' }, top >= 2160 ? '4K' : 'HD')] : []),
      el('span', { class: 'tile-dur' }, formatDuration(v.duration)),
      el('span', { class: 'tile-play' }, icon('play'))),
    // Under the poster: just the movie's name.
    el('div', { class: 'tile-body' }, el('div', { class: 'tile-title' }, v.title)));
  attachTilt(a);
  return a;
}

// ---------- 3D effects ----------
// Only on devices with a real mouse, and never for people who asked their device for less motion.
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const can3D = !reduceMotion && matchMedia('(hover: hover) and (pointer: fine)').matches;

// Tilts a card toward the mouse and moves a soft shine with it (CSS reads --rx, --ry, --gx, --gy).
function attachTilt(card, max = 9) {
  if (!can3D) return;
  let frame = 0, last = null;
  card.addEventListener('pointermove', (e) => {
    last = e;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const r = card.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (last.clientX - r.left) / r.width));
      const y = Math.min(1, Math.max(0, (last.clientY - r.top) / r.height));
      card.style.setProperty('--ry', ((x - 0.5) * 2 * max).toFixed(2) + 'deg');
      card.style.setProperty('--rx', ((0.5 - y) * 2 * max).toFixed(2) + 'deg');
      card.style.setProperty('--gx', (x * 100).toFixed(1) + '%');
      card.style.setProperty('--gy', (y * 100).toFixed(1) + '%');
    });
  });
  card.addEventListener('pointerleave', () => {
    card.style.setProperty('--rx', '0deg');
    card.style.setProperty('--ry', '0deg');
  });
}

// Sections tip forward into place the first time they scroll into view.
const revealObserver = 'IntersectionObserver' in window && !reduceMotion
  ? new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); revealObserver.unobserve(e.target); }
    }, { rootMargin: '0px 0px -8% 0px' })
  : null;
function reveal(node) {
  if (!revealObserver) return node;
  node.classList.add('reveal');
  revealObserver.observe(node);
  return node;
}

// Horizontal scrolling row with heading, "View all" link and arrows.
function rail(title, items, href) {
  const track = el('div', { class: 'rail-track' }, ...items);
  const left = el('button', { class: 'rail-arrow left', type: 'button', 'aria-label': t('Scroll left') }, icon('chevL'));
  const right = el('button', { class: 'rail-arrow right', type: 'button', 'aria-label': t('Scroll right') }, icon('chevR'));
  left.onclick = () => track.scrollBy({ left: -track.clientWidth * 0.9, behavior: 'smooth' });
  right.onclick = () => track.scrollBy({ left: track.clientWidth * 0.9, behavior: 'smooth' });
  const updateArrows = () => {
    left.hidden = track.scrollLeft < 5;
    right.hidden = track.scrollLeft + track.clientWidth >= track.scrollWidth - 5;
  };
  track.addEventListener('scroll', updateArrows, { passive: true });
  window.addEventListener('resize', updateArrows);
  requestAnimationFrame(updateArrows);
  return el('section', { class: 'rail' },
    el('div', { class: 'rail-head' }, el('h2', {}, href ? el('a', { class: 'rail-link', href }, title, icon('chevR')) : title)),
    el('div', { class: 'rail-body' }, left, track, right));
}

function tagCounts(videos) {
  const counts = new Map();
  for (const v of videos) for (const tg of v.tags || []) counts.set(tg, (counts.get(tg) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

// ---------- Rankings ----------
const ageDays = (v) => Math.max(0, (Date.now() - new Date(v.createdAt)) / 86400000);
const SORTS = {
  newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
  oldest: (a, b) => a.createdAt.localeCompare(b.createdAt),
  views: (a, b) => (b.views || 0) - (a.views || 0),
  // Likes count more when there are more votes: (likes + 1) / (votes + 2)
  rating: (a, b) => ((b.likes + 1) / (b.likes + b.dislikes + 2)) - ((a.likes + 1) / (a.likes + a.dislikes + 2)) || (b.views || 0) - (a.views || 0),
  longest: (a, b) => (b.duration || 0) - (a.duration || 0),
  shortest: (a, b) => (a.duration || 0) - (b.duration || 0),
};

// ---------- Modal + toast ----------
function openModal(title, body) {
  const closeBtn = el('button', { class: 'modal-x', type: 'button', 'aria-label': t('Close') }, icon('close'));
  const dialog = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    el('div', { class: 'modal-head' }, el('h2', {}, title), closeBtn), body);
  const back = el('div', { class: 'modal-back' }, dialog);
  const prevFocus = document.activeElement;
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); prevFocus?.focus?.(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  closeBtn.onclick = close;
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey, true);
  (document.fullscreenElement || document.body).append(back);
  (dialog.querySelector('input, textarea, button:not(.modal-x)') || closeBtn).focus();
  return close;
}

function toast(message, actions = [], ms = 6000) {
  document.querySelector('.toast')?.remove();
  const box = el('div', { class: 'toast', role: 'status' }, el('span', {}, message));
  for (const [label, fn] of actions) {
    const b = el('button', { type: 'button' }, label);
    b.onclick = () => { fn(); box.remove(); };
    box.append(b);
  }
  (document.fullscreenElement || document.body).append(box);
  setTimeout(() => box.remove(), ms);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = el('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text; document.body.append(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  }
}
