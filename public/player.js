// Custom video player. Needs i18n.js + common.js. Uses hls.js (if loaded) for "Auto" quality.
//
// createPlayer(box, video, {
//   v,            video object from the API
//   startAt,      seconds to start from (from ?t= or the resume position)
//   onTheater,    called when theater button / "t" is pressed (omit to hide the button)
//   getNext,      returns the next video for autoplay (omit to disable autoplay)
// })
function createPlayer(box, video, { v, startAt = 0, onTheater, getNext }) {
  const sources = v.sources;
  video.controls = false;
  video.disablePictureInPicture = true;
  box.classList.add('vp');
  box.tabIndex = 0;

  const fmt = (s) => formatDuration(s) || '0:00';
  const setIcon = (b, name) => b.replaceChildren(icon(name));
  const btn = (name, label, cls = '') => {
    const b = el('button', { class: 'vp-btn ' + cls, type: 'button', 'aria-label': label, title: label });
    setIcon(b, name);
    return b;
  };

  // ---------- Build the controls ----------
  const bigPlay = el('button', { class: 'vp-big', type: 'button', 'aria-label': t('Play') }, icon('play'));
  const spinner = el('div', { class: 'vp-spinner' });
  const buffered = el('div', { class: 'vp-buffered' });
  const played = el('div', { class: 'vp-played' });
  const handle = el('div', { class: 'vp-handle' });
  const heat = el('div', { class: 'vp-heat' });
  const previewImg = el('div', { class: 'vp-preview-img' });
  const previewTime = el('div', { class: 'vp-preview-time' });
  const preview = el('div', { class: 'vp-preview' }, previewImg, previewTime);
  const progress = el('div', { class: 'vp-progress', 'aria-label': t('Seek') },
    heat, el('div', { class: 'vp-rail' }, buffered, played), handle, preview);

  const playBtn = btn('play', t('Play') + ' (k)');
  const backBtn = btn('back10', t('Back 10 seconds') + ' (j)', 'vp-skip');
  const fwdBtn = btn('fwd10', t('Forward 10 seconds') + ' (l)', 'vp-skip');
  const muteBtn = btn('volOn', t('Mute') + ' (m)');
  const vol = el('input', { class: 'vp-vol', type: 'range', min: '0', max: '1', step: '0.05', 'aria-label': t('Volume') });
  const time = el('span', { class: 'vp-time' }, '0:00 / 0:00');
  const hdBadge = el('span', { class: 'vp-hd' });
  const gear = btn('settings', t('Settings'), 'vp-gear');
  gear.append(hdBadge);
  const castBtn = btn('cast', t('Cast to TV'));
  const theaterBtn = btn('theater', t('Theater mode') + ' (t)', 'vp-theater');
  const fsBtn = btn('fs', t('Fullscreen') + ' (f)');
  const menu = el('div', { class: 'vp-menu', hidden: '' });
  const upNext = el('div', { class: 'vp-upnext', hidden: '' });

  const canCast = (video.remote && typeof video.remote.prompt === 'function') || typeof video.webkitShowPlaybackTargetPicker === 'function';
  const controls = el('div', { class: 'vp-controls' }, progress,
    el('div', { class: 'vp-bar' },
      playBtn, backBtn, fwdBtn,
      el('div', { class: 'vp-volwrap' }, muteBtn, vol),
      time, el('div', { class: 'vp-spacer' }),
      ...(canCast ? [castBtn] : []), gear, ...(onTheater ? [theaterBtn] : []), fsBtn));
  box.append(bigPlay, spinner, controls, menu, upNext);

  // ---------- Play / pause ----------
  const toggle = () => (video.paused ? video.play().catch(() => {}) : video.pause());
  let clickTimer;
  video.addEventListener('click', () => {
    clearTimeout(clickTimer);
    clickTimer = setTimeout(toggle, 200); // wait to see if it's a double-click
  });
  video.addEventListener('dblclick', () => { clearTimeout(clickTimer); toggleFullscreen(); });
  bigPlay.onclick = toggle;
  playBtn.onclick = toggle;

  video.addEventListener('play', () => {
    box.classList.add('playing', 'started');
    box.classList.remove('ended');
    hideUpNext();
    setIcon(playBtn, 'pause');
    playBtn.setAttribute('aria-label', t('Pause') + ' (k)');
    poke();
  });
  video.addEventListener('pause', () => {
    box.classList.remove('playing');
    setIcon(playBtn, 'play');
    playBtn.setAttribute('aria-label', t('Play') + ' (k)');
    showControls();
  });
  video.addEventListener('waiting', () => box.classList.add('loading'));
  ['playing', 'canplay', 'pause', 'error'].forEach((e) => video.addEventListener(e, () => box.classList.remove('loading')));

  // ---------- Time and progress ----------
  function updateTime() {
    const d = video.duration || 0;
    const pct = d ? (video.currentTime / d) * 100 : 0;
    played.style.width = pct + '%';
    handle.style.left = pct + '%';
    time.textContent = `${fmt(video.currentTime)} / ${fmt(d)}`;
  }
  function updateBuffered() {
    const d = video.duration;
    if (!d || !video.buffered.length) return;
    let end = 0;
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= video.currentTime + 0.5) end = Math.max(end, video.buffered.end(i));
    }
    buffered.style.width = (end / d) * 100 + '%';
  }
  video.addEventListener('timeupdate', () => { updateTime(); updateBuffered(); });
  video.addEventListener('loadedmetadata', updateTime);
  video.addEventListener('progress', updateBuffered);

  const ratioAt = (e) => {
    const r = progress.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  let dragging = false;
  const seekTo = (e) => {
    if (!video.duration) return;
    video.currentTime = ratioAt(e) * video.duration;
    updateTime();
  };

  // Preview picture above the progress bar (from the storyboard image).
  const sb = v.storyboard;
  if (sb) {
    previewImg.style.backgroundImage = `url("${sb.url}")`;
    previewImg.style.backgroundSize = `${sb.cols * 160}px ${sb.rows * 90}px`;
  } else {
    previewImg.hidden = true;
  }
  function showPreview(e) {
    const r = ratioAt(e);
    const secs = r * (video.duration || v.duration || 0);
    previewTime.textContent = fmt(secs);
    if (sb) {
      const i = Math.min(sb.count - 1, Math.floor(secs / sb.interval));
      previewImg.style.backgroundPosition = `-${(i % sb.cols) * 160}px -${Math.floor(i / sb.cols) * 90}px`;
    }
    // Keep the bubble inside the player.
    const width = progress.clientWidth, half = (sb ? 168 : 60) / 2;
    preview.style.left = Math.min(width - half, Math.max(half, r * width)) + 'px';
  }

  progress.addEventListener('pointerdown', (e) => {
    dragging = true;
    progress.setPointerCapture(e.pointerId);
    box.classList.add('seeking');
    seekTo(e);
  });
  progress.addEventListener('pointermove', (e) => {
    showPreview(e);
    if (dragging) seekTo(e);
  });
  const endDrag = () => { dragging = false; box.classList.remove('seeking'); };
  progress.addEventListener('pointerup', endDrag);
  progress.addEventListener('pointercancel', endDrag);

  // "Most watched" curve above the progress bar.
  if (v.heat) {
    const n = v.heat.length;
    const pts = v.heat.map((h, i) => `${((i + 0.5) / n) * 100},${(30 - h * 26).toFixed(1)}`);
    heat.innerHTML = `<svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><path d="M0,30 L${pts.join(' L')} L100,30 Z"/></svg>`;
    heat.title = t('Most watched parts');
  } else {
    heat.hidden = true;
  }

  const skip = (s) => { video.currentTime = Math.min(video.duration || 0, Math.max(0, video.currentTime + s)); poke(); };
  backBtn.onclick = () => skip(-10);
  fwdBtn.onclick = () => skip(10);

  // ---------- Volume (remembered between visits) ----------
  video.volume = Math.min(1, Math.max(0, Number(store.get('vp-volume', '1')) || 0));
  video.muted = store.get('vp-muted', '0') === '1';
  function syncVolume() {
    const silent = video.muted || video.volume === 0;
    setIcon(muteBtn, silent ? 'volOff' : 'volOn');
    muteBtn.setAttribute('aria-label', t(silent ? 'Unmute' : 'Mute') + ' (m)');
    vol.value = silent ? 0 : video.volume;
    vol.style.setProperty('--fill', vol.value * 100 + '%');
    store.set('vp-volume', String(video.volume));
    store.set('vp-muted', video.muted ? '1' : '0');
  }
  vol.addEventListener('input', () => { video.volume = Number(vol.value); video.muted = video.volume === 0; });
  muteBtn.onclick = () => {
    video.muted = !video.muted;
    if (!video.muted && video.volume === 0) video.volume = 0.5;
  };
  video.addEventListener('volumechange', syncVolume);
  syncVolume();

  // ---------- Fullscreen and theater ----------
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (box.requestFullscreen) box.requestFullscreen().catch(() => {});
    else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen(); // iPhone
  }
  fsBtn.onclick = toggleFullscreen;
  document.addEventListener('fullscreenchange', () => {
    const on = document.fullscreenElement === box;
    box.classList.toggle('fs', on);
    setIcon(fsBtn, on ? 'fsExit' : 'fs');
    fsBtn.setAttribute('aria-label', t(on ? 'Exit fullscreen' : 'Fullscreen') + ' (f)');
  });
  theaterBtn.onclick = () => onTheater && onTheater();

  // ---------- Auto-hide controls while playing ----------
  let hideTimer;
  function showControls() { box.classList.remove('idle'); clearTimeout(hideTimer); }
  function poke() {
    showControls();
    hideTimer = setTimeout(() => {
      if (!video.paused && menu.hidden && !dragging) box.classList.add('idle');
    }, 2500);
  }
  box.addEventListener('pointermove', poke);
  box.addEventListener('pointerleave', () => { if (!video.paused && menu.hidden) box.classList.add('idle'); });

  // ---------- Quality: "auto" (streaming) or one exact file ----------
  const hlsOk = !!(v.hls && window.Hls && window.Hls.isSupported());
  let hls = null;
  let mode = 'mp4';   // 'auto' or 'mp4'
  let index = 0;      // which MP4 source when mode === 'mp4'
  const qualityTag = (h) => (h >= 2160 ? '4K' : h >= 720 ? 'HD' : '');

  function restoreAfterSwitch(keep) {
    if (!keep) return;
    video.addEventListener('loadedmetadata', () => {
      video.currentTime = keep.time;
      video.playbackRate = keep.rate;
      if (keep.playing) video.play().catch(() => {});
    }, { once: true });
  }
  const snapshot = () => ({ time: video.currentTime, rate: video.playbackRate, playing: !video.paused });

  function loadMp4(i, keepPosition) {
    const keep = keepPosition ? snapshot() : null;
    if (hls) { hls.destroy(); hls = null; }
    mode = 'mp4';
    index = i;
    video.src = sources[i].url;
    hdBadge.textContent = qualityTag(sources[i].height || 0);
    restoreAfterSwitch(keep);
  }

  function autoLabel() {
    const lvl = hls && hls.levels[hls.currentLevel];
    return lvl ? `${t('Auto')} (${Math.min(lvl.width, lvl.height)}p)` : t('Auto');
  }
  function loadAuto(keepPosition) {
    const keep = keepPosition ? snapshot() : null;
    if (hls) hls.destroy();
    mode = 'auto';
    hls = new Hls({ capLevelToPlayerSize: true, startLevel: -1 });
    hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
      const lvl = hls.levels[data.level];
      hdBadge.textContent = lvl ? qualityTag(Math.min(lvl.width, lvl.height)) : '';
      if (!menu.hidden) renderMenu();
    });
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal) loadMp4(0, true); // streaming failed: fall back to the original file
    });
    hls.loadSource(v.hls);
    hls.attachMedia(video);
    restoreAfterSwitch(keep);
  }

  // Default is the original file, unless the viewer chose something else before.
  const pref = store.get('quality', 'original');
  if (pref === 'auto' && hlsOk) mode = 'auto';
  else if (pref !== 'original' && pref !== 'auto') {
    const fit = sources.findIndex((s) => !s.original && s.height <= Number(pref));
    if (fit !== -1) index = fit;
  } else if (!v.webFriendly && sources.length > 1) {
    index = 1; // the original can't play in browsers; use the full-resolution copy
  }

  // If an MP4 version fails to play in this browser, fall back to the next one.
  video.addEventListener('error', () => {
    if (mode === 'mp4' && index + 1 < sources.length) loadMp4(index + 1, true);
  });

  // ---------- Cast to TV ----------
  castBtn.onclick = () => {
    // TVs need a plain file, not the chunked stream.
    if (mode === 'auto') loadMp4(0, true);
    if (video.remote && typeof video.remote.prompt === 'function') {
      video.remote.prompt().catch((err) => {
        if (err && err.name !== 'AbortError') toast(t('No TV or Chromecast found on your network.'));
      });
    } else if (video.webkitShowPlaybackTargetPicker) {
      video.webkitShowPlaybackTargetPicker();
    }
  };

  // ---------- Settings menu ----------
  const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const speedLabel = (r) => (r === 1 ? t('Normal') : r + 'x');
  let page = 'main';
  let autoplay = store.get('autoplay', '1') === '1';

  function renderMenu() {
    const row = (label, value, go) => {
      const b = el('button', { class: 'vp-mrow', type: 'button' }, el('span', {}, label), el('span', { class: 'vp-mval' }, value + '  ›'));
      b.onclick = () => { page = go; renderMenu(); };
      return b;
    };
    const back = (label) => {
      const b = el('button', { class: 'vp-mback', type: 'button' }, '‹  ' + label);
      b.onclick = () => { page = 'main'; renderMenu(); };
      return b;
    };
    const option = (label, active, onPick, tag) => {
      const b = el('button', { class: 'vp-mopt' + (active ? ' active' : ''), type: 'button' },
        el('span', {}, label, ...(tag ? [el('sup', { class: 'vp-mtag' }, tag)] : [])));
      b.onclick = () => { onPick(); closeMenu(); };
      return b;
    };
    const currentQuality = mode === 'auto' ? autoLabel() : sources[index].label;

    if (page === 'quality') {
      const opts = sources.map((s, i) => option(s.label, mode === 'mp4' && i === index, () => {
        store.set('quality', s.original ? 'original' : String(s.height));
        if (mode !== 'mp4' || i !== index) loadMp4(i, true);
      }, qualityTag(s.height || 0)));
      if (hlsOk) {
        opts.unshift(option(mode === 'auto' ? autoLabel() : t('Auto'), mode === 'auto', () => {
          store.set('quality', 'auto');
          if (mode !== 'auto') loadAuto(true);
        }));
      }
      menu.replaceChildren(back(t('Quality')), ...opts);
    } else if (page === 'speed') {
      menu.replaceChildren(back(t('Playback speed')), ...SPEEDS.map((r) =>
        option(speedLabel(r), video.playbackRate === r, () => (video.playbackRate = r))));
    } else {
      const items = [row(t('Playback speed'), speedLabel(video.playbackRate), 'speed')];
      if (sources.length > 1 || hlsOk) items.unshift(row(t('Quality'), currentQuality, 'quality'));
      if (getNext) {
        const ap = el('button', { class: 'vp-mrow', type: 'button', role: 'switch', 'aria-checked': String(autoplay) },
          el('span', {}, t('Autoplay next video')), el('span', { class: 'switch' + (autoplay ? ' on' : '') }));
        ap.onclick = () => { setAutoplay(!autoplay); renderMenu(); };
        items.push(ap);
      }
      menu.replaceChildren(...items);
    }
  }
  function closeMenu() { menu.hidden = true; gear.classList.remove('open'); poke(); }
  gear.onclick = () => {
    if (!menu.hidden) return closeMenu();
    page = 'main';
    renderMenu();
    menu.hidden = false;
    gear.classList.add('open');
    showControls();
  };
  menu.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', (e) => { if (!menu.hidden && !gear.contains(e.target)) closeMenu(); });

  // ---------- Autoplay next ----------
  const autoplayListeners = [];
  function setAutoplay(on) {
    autoplay = on;
    store.set('autoplay', on ? '1' : '0');
    autoplayListeners.forEach((fn) => fn(on));
  }
  let countdown = null;
  function hideUpNext() { clearInterval(countdown); countdown = null; upNext.hidden = true; }
  video.addEventListener('ended', () => {
    box.classList.add('ended');
    showControls();
    const next = getNext && getNext();
    if (!next) return;
    const go = () => { location.href = '/watch?v=' + encodeURIComponent(next.id); };
    const counter = el('span', { class: 'vp-count' });
    const playNow = el('button', { class: 'vp-un-play', type: 'button' }, icon('play'), t('Play now'));
    const cancel = el('button', { class: 'vp-un-cancel', type: 'button' }, t('Cancel'));
    const replay = el('button', { class: 'vp-un-cancel', type: 'button' }, icon('replay'), t('Replay'));
    playNow.onclick = go;
    replay.onclick = () => { hideUpNext(); video.currentTime = 0; video.play().catch(() => {}); };
    const thumb = el('div', { class: 'vp-un-thumb' },
      next.poster ? el('img', { src: next.poster, alt: '' }) : el('div', {}),
      el('span', { class: 'tile-dur' }, formatDuration(next.duration)));
    upNext.replaceChildren(
      el('div', { class: 'vp-un-label' }, t('Up next'), ' ', counter),
      thumb,
      el('div', { class: 'vp-un-title' }, next.title),
      el('div', { class: 'vp-un-actions' }, ...(autoplay ? [cancel, playNow] : [replay, playNow])));
    upNext.hidden = false;
    if (autoplay) {
      let left = 8;
      counter.textContent = t('in {n}s', { n: left });
      cancel.onclick = () => { hideUpNext(); upNext.hidden = false; counter.textContent = ''; cancel.replaceWith(replay); };
      countdown = setInterval(() => {
        left--;
        counter.textContent = t('in {n}s', { n: left });
        if (left <= 0) { clearInterval(countdown); go(); }
      }, 1000);
    }
  });

  // ---------- Resume + "most watched" tracking ----------
  let lastSave = 0;
  const watched = new Set();
  video.addEventListener('timeupdate', () => {
    const d = video.duration;
    if (!d) return;
    watched.add(Math.min(99, Math.floor((video.currentTime / d) * 100)));
    if (Date.now() - lastSave > 10000) {
      lastSave = Date.now();
      watchHistory.save(v.id, video.currentTime, d);
    }
  });
  // Continue Watching is only saved for signed-in viewers (watchHistory ignores everyone else).
  const saveNow = () => { if (video.duration) watchHistory.save(v.id, video.currentTime, video.duration); };
  video.addEventListener('pause', () => { if (!video.ended) saveNow(); });
  video.addEventListener('ended', () => watchHistory.finish(v.id, video.duration));
  window.addEventListener('pagehide', saveNow);
  function sendHeat() {
    if (!watched.size) return;
    const body = new Blob([JSON.stringify({ b: [...watched] })], { type: 'application/json' });
    navigator.sendBeacon(`/api/videos/${encodeURIComponent(v.id)}/heat`, body);
    watched.clear();
  }
  window.addEventListener('pagehide', sendHeat);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') sendHeat(); });

  // ---------- Keyboard shortcuts ----------
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, .modal') || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const actions = {
      ' ': toggle, k: toggle,
      f: toggleFullscreen,
      t: () => onTheater && onTheater(),
      m: () => muteBtn.onclick(),
      arrowleft: () => skip(-5), arrowright: () => skip(5),
      j: () => skip(-10), l: () => skip(10),
      arrowup: () => { video.muted = false; video.volume = Math.min(1, video.volume + 0.1); },
      arrowdown: () => { video.volume = Math.max(0, video.volume - 0.1); },
      escape: () => { if (!menu.hidden) closeMenu(); },
    };
    if (!actions[k]) return;
    if (k === ' ' && e.target.closest('button, a')) return; // let Space activate buttons and links
    e.preventDefault();
    actions[k]();
    poke();
  });

  // ---------- Start ----------
  if (mode === 'auto') loadAuto(false); else loadMp4(index, false);
  if (startAt > 0) {
    video.addEventListener('loadedmetadata', () => { video.currentTime = Math.min(startAt, Math.max(0, video.duration - 1)); }, { once: true });
  }

  return {
    video,
    setTheater(on) { theaterBtn.classList.toggle('active', on); },
    get autoplay() { return autoplay; },
    setAutoplay,
    onAutoplayChange(fn) { autoplayListeners.push(fn); },
  };
}
