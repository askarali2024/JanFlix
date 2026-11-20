/* ═══════════════════════════════════════════════════════════════
   JanFlix — SPA (vanilla JS, zero dependencies)
   ═══════════════════════════════════════════════════════════════ */

'use strict';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const state = {
  movies: [],
  progress: {},
  config: {},
  filter: 'all',
  search: '',
};

/* ── Helpers ─────────────────────────────────────────────────── */

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatRuntime(min) {
  if (!min) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

function progressPct(movie) {
  const p = state.progress[movie.id];
  if (!p || !p.duration) return 0;
  return (p.position / p.duration) * 100;
}

function isContinueWatching(movie) {
  const pct = progressPct(movie);
  return pct > 2 && pct < 95;
}

function toast(msg, ms = 3200) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, ms);
}

/** Deterministic pleasant gradient for offline fallback posters. */
function fallbackGradient(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  const a = `hsl(${h}, 45%, 28%)`;
  const b = `hsl(${(h + 55) % 360}, 50%, 16%)`;
  return `linear-gradient(150deg, ${a}, ${b})`;
}

const starSvg = '<svg viewBox="0 0 24 24" fill="#ffd166"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01z"/></svg>';

/* ── Data loading ────────────────────────────────────────────── */

async function loadMovies() {
  const res = await fetch('/api/movies');
  const data = await res.json();
  state.movies = data.movies || [];
  state.progress = data.progress || {};
  state.config = data.config || {};
  renderAll();
}

/* ── Filtering ────────────────────────────────────────────────── */

function visibleMovies() {
  let list = state.movies;

  if (state.filter === 'recent') {
    const cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;
    const recent = list.filter((m) => m.addedAt >= cutoff);
    list = (recent.length ? recent : [...list].sort((a, b) => b.addedAt - a.addedAt)).slice(0, 24);
  } else if (state.filter !== 'all' && state.filter !== 'movies') {
    list = list.filter((m) => (m.genres || []).some((g) => g === state.filter));
  }

  if (state.search) {
    const q = state.search.toLowerCase();
    list = list.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        String(m.year || '').includes(q) ||
        (m.genres || []).some((g) => g.toLowerCase().includes(q))
    );
  }
  return list;
}

/* ── Rendering ───────────────────────────────────────────────── */

function renderAll() {
  renderPills();
  renderContinueRow();
  renderGrid();
}

function renderPills() {
  const genres = new Map();
  for (const m of state.movies) {
    for (const g of m.genres || []) genres.set(g, (genres.get(g) || 0) + 1);
  }
  const topGenres = [...genres.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map((e) => e[0]);

  const pills = ['all', 'movies', 'recent', ...topGenres];
  const labels = { all: 'All', movies: 'Movies', recent: 'Recently Added' };

  const html = pills
    .map((p) => `<button class="pill ${state.filter === p ? 'active' : ''}" data-filter="${p}">${labels[p] || p}</button>`)
    .join('');
  $('#pills').innerHTML = html;
  $$('#pills .pill').forEach((b) =>
    b.addEventListener('click', () => {
      state.filter = b.dataset.filter;
      renderPills();
      renderGrid();
    })
  );

  $('#libraryCount').textContent =
    state.movies.length === 0 ? '' : `${state.movies.length} title${state.movies.length === 1 ? '' : 's'}`;
}

function posterFallbackHtml(movie) {
  return `
    <div class="poster-fallback" style="background:${fallbackGradient(movie.title + (movie.year || ''))}">
      <div class="pf-title">${escapeHtml(movie.title)}</div>
      ${movie.year ? `<div class="pf-year">${movie.year}</div>` : ''}
    </div>`;
}

function renderContinueRow() {
  const items = state.movies
    .filter(isContinueWatching)
    .sort((a, b) => (state.progress[b.id].updatedAt || 0) - (state.progress[a.id].updatedAt || 0));

  const section = $('#continueSection');
  section.hidden = items.length === 0;
  if (!items.length) return;

  $('#continueRow').innerHTML = items
    .map((m) => {
      const pct = progressPct(m);
      const remaining = m.runtime ? Math.max(1, Math.round((m.runtime * (100 - pct)) / 100)) : null;
      return `
      <div class="cw-card" data-id="${m.id}">
        <div class="cw-thumb">
          ${m.backdropUrl
            ? `<img src="${m.backdropUrl}" alt="" loading="lazy">`
            : `<div class="cw-fallback" style="background:${fallbackGradient(m.title + (m.year || ''))}">${escapeHtml(m.title)}</div>`}
          <div class="cw-play"><span><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span></div>
          <div class="cw-resume">▶ RESUME</div>
        </div>
        <div class="cw-progress"><div class="cw-progress-bar" style="width:${pct}%"></div></div>
        <div class="cw-info">
          <div class="cw-title">${escapeHtml(m.title)}</div>
          <div class="cw-sub">${remaining ? `${remaining} min left · ` : ''}${Math.round(pct)}% watched</div>
        </div>
      </div>`;
    })
    .join('');

  $$('#continueRow .cw-card').forEach((c) =>
    c.addEventListener('click', () => openDetail(c.dataset.id))
  );
}

function renderGrid() {
  const list = visibleMovies();
  const grid = $('#grid');
  const empty = $('#emptyState');

  if (list.length === 0) {
    grid.innerHTML = '';
    empty.hidden = false;
    $('#emptyTitle').textContent = state.search
      ? `No results for “${state.search}”`
      : state.movies.length
        ? 'Nothing in this filter'
        : 'Your library is empty';
    $('#emptyHint').innerHTML = state.movies.length
      ? 'Try a different filter or search.'
      : 'Drop your video files into the configured media folder and hit <b>Scan Library</b>.';
    return;
  }
  empty.hidden = true;

  grid.innerHTML = list
    .map((m, i) => {
      const pct = progressPct(m);
      return `
      <div class="movie-card" data-id="${m.id}" style="animation-delay:${Math.min(i * 0.02, 0.4)}s" tabindex="0" role="button" aria-label="${escapeHtml(m.title)}">
        <div class="poster">
          ${m.posterUrl
            ? `<img src="${m.posterUrl}" alt="${escapeHtml(m.title)}" loading="lazy">`
            : posterFallbackHtml(m)}
          <div class="poster-hover"><span><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span></div>
          ${m.resolution ? `<span class="badge ${m.resolution === '4K' ? 'badge-4k' : ''}">${m.resolution}</span>` : ''}
          ${pct > 2 ? `<div class="progress-mini"><i style="width:${pct}%"></i></div>` : ''}
        </div>
        <div class="card-info">
          <div class="card-title" title="${escapeHtml(m.title)}">${escapeHtml(m.title)}</div>
          <div class="card-meta">
            ${m.year || ''}
            ${m.year && m.rating ? '·' : ''}
            ${m.rating ? `<span class="rate">${starSvg} ${m.rating}</span>` : ''}
          </div>
        </div>
      </div>`;
    })
    .join('');

  $$('#grid .movie-card').forEach((c) => {
    c.addEventListener('click', () => openDetail(c.dataset.id));
    c.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(c.dataset.id); }
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* ── Detail modal ─────────────────────────────────────────────── */

function openDetail(id) {
  const m = state.movies.find((x) => x.id === id);
  if (!m) return;

  $('#detailBackdrop').innerHTML = m.backdropUrl
    ? `<img src="${m.backdropUrl}" alt="">`
    : `<div style="position:absolute;inset:0;background:${fallbackGradient(m.title + (m.year || ''))}"></div>`;

  $('#detailTitle').textContent = m.title;

  const chips = [];
  if (m.year) chips.push(`<span class="meta-chip">${m.year}</span>`);
  if (m.rating) chips.push(`<span class="meta-chip star">★ ${m.rating}/10</span>`);
  if (m.resolution) chips.push(`<span class="meta-chip accent">${m.resolution}</span>`);
  for (const g of (m.genres || []).slice(0, 4)) chips.push(`<span class="meta-chip">${escapeHtml(g)}</span>`);
  if ((m.subtitles || []).length) chips.push(`<span class="meta-chip">CC · ${(m.subtitles || []).length} track(s)</span>`);
  $('#detailMeta').innerHTML = chips.join('');

  $('#detailOverview').textContent =
    m.overview || 'No synopsis available. (Set TMDB_API_KEY to fetch overviews, posters, ratings and genres automatically.)';

  const facts = [];
  facts.push(`File&nbsp;size <b>${formatBytes(m.fileSize)}</b>`);
  if (m.runtime) facts.push(`Runtime <b>${formatRuntime(m.runtime)}</b>`);
  if ((m.subtitles || []).length) facts.push(`Subtitles <b>${m.subtitles.map((s) => s.label).join(', ')}</b>`);
  facts.push(`Location <b title="${escapeHtml(m.filePath)}">${escapeHtml(m.fileName)}</b>`);
  const pct = progressPct(m);
  if (pct > 2) facts.push(`Watched <b>${Math.round(pct)}%</b>`);
  $('#detailFacts').innerHTML = facts.map((f) => `<span>${f}</span>`).join('');

  const hasProgress = pct > 2 && pct < 97;
  $('#detailPlayLabel').textContent = hasProgress ? `Resume · ${Math.round(pct)}%` : 'Play';
  $('#detailPlay').onclick = () => { closeDetail(); openPlayer(m); };

  const dl = $('#detailDownload');
  dl.href = `/api/download/${m.id}`;
  dl.onclick = () => toast('Download started — enjoy the trip! ✈️');

  const reset = $('#detailReset');
  reset.hidden = !(state.progress[m.id] && state.progress[m.id].position > 10);
  reset.onclick = async () => {
    await fetch(`/api/progress/${m.id}`, { method: 'DELETE' });
    delete state.progress[m.id];
    toast(`Progress cleared for “${m.title}”`);
    renderAll();
    openDetail(m.id);
  };

  $('#detailModal').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeDetail() {
  $('#detailModal').hidden = true;
  document.body.style.overflow = '';
}

/* ── Player ──────────────────────────────────────────────────── */

const player = {
  movie: null,
  timer: null,
  compat: false,
};

function openPlayer(movie, { resume = true } = {}) {
  player.movie = movie;
  player.compat = false;

  const video = $('#video');
  video.innerHTML = '';

  // Attach subtitle tracks (.srt converted on the fly server-side).
  for (const track of movie.subtitles || []) {
    const t = document.createElement('track');
    t.kind = 'subtitles';
    t.label = track.label;
    t.srclang = track.lang;
    t.src = `/api/subtitles/${movie.id}?t=${encodeURIComponent(track.id)}`;
    video.appendChild(t);
  }

  $('#playerTitle').textContent = `${movie.title}${movie.year ? ` (${movie.year})` : ''}`;
  updateCompatButton();
  setVideoSource(false);
  $('#player').hidden = false;
  document.body.style.overflow = 'hidden';

  const p = state.progress[movie.id];
  const seekTo = resume && p && p.position > 10 && progressPct(movie) < 95 ? p.position : 0;

  video.onloadedmetadata = () => {
    if (seekTo > 0 && Math.abs(video.currentTime - seekTo) > 2) {
      video.currentTime = seekTo;
      toast(`Resumed at ${fmtTime(seekTo)}`);
    }
  };

  // Auto-enable compatibility stream if the browser can't decode the file.
  video.onerror = () => {
    if (!player.compat && isMkv(movie) && state.config.ffmpeg) {
      toast('Browser can’t decode this audio — switching to Compatibility Stream…');
      const t = video.currentTime;
      player.compat = true;
      updateCompatButton();
      setVideoSource(true, t);
    }
  };

  video.onplay = startProgressTimer;
  video.onpause = saveProgressNow;
  video.onended = () => {
    saveProgressNow();
    clearInterval(player.timer);
  };
}

function isMkv(m) {
  return /\.mkv$/i.test(m.filePath || m.fileName || '');
}

function setVideoSource(compat, seekTo = 0) {
  const video = $('#video');
  const m = player.movie;
  video.src = `/api/stream/${m.id}${compat ? '?compat=1' : ''}`;
  if (seekTo > 0) {
    video.addEventListener(
      'loadedmetadata',
      () => { video.currentTime = seekTo; },
      { once: true }
    );
  }
  video.load();
  video.play().catch(() => { /* autoplay blocked — user taps play */ });
}

function updateCompatButton() {
  const btn = $('#compatBtn');
  const show = player.movie && isMkv(player.movie) && state.config.ffmpeg;
  btn.hidden = !show;
  btn.classList.toggle('on', player.compat);
  btn.textContent = `⚡ Compatibility Stream: ${player.compat ? 'On' : 'Off'}`;
}

$('#compatBtn').addEventListener('click', () => {
  const video = $('#video');
  const t = video.currentTime;
  player.compat = !player.compat;
  updateCompatButton();
  setVideoSource(player.compat, t);
  toast(player.compat ? 'Compatibility Stream on — audio remuxed to AAC' : 'Compatibility Stream off');
});

function startProgressTimer() {
  clearInterval(player.timer);
  player.timer = setInterval(saveProgressNow, 10000); // every 10s
}

function saveProgressNow() {
  const video = $('#video');
  const m = player.movie;
  if (!m || !video.currentTime || !video.duration || video.currentTime < 5) return;
  const payload = JSON.stringify({
    position: Math.floor(video.currentTime),
    duration: Math.floor(video.duration),
  });
  const url = `/api/progress/${m.id}`;
  if (navigator.sendBeacon) {
    navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
  } else {
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true });
  }
  state.progress[m.id] = {
    position: Math.floor(video.currentTime),
    duration: Math.floor(video.duration),
    updatedAt: Date.now(),
  };
}

function fmtTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function closePlayer() {
  saveProgressNow();
  clearInterval(player.timer);
  player.timer = null;
  const video = $('#video');
  video.pause();
  video.removeAttribute('src');
  video.load();
  $('#player').hidden = true;
  document.body.style.overflow = '';
  renderAll(); // refresh Continue Watching row
}

/* Auto-hide player top bar */
(() => {
  const el = $('#player');
  let hideT;
  el.addEventListener('mousemove', () => {
    el.classList.remove('hide-ui');
    clearTimeout(hideT);
    hideT = setTimeout(() => el.classList.add('hide-ui'), 2600);
  });
  el.addEventListener('mouseleave', () => el.classList.add('hide-ui'));
})();

/* ── Scan library ────────────────────────────────────────────── */

const scanBtn = $('#scanBtn');
const scanIcon = $('#scanIcon');

async function triggerScan() {
  scanIcon.classList.add('spinning');
  scanBtn.disabled = true;
  try {
    await fetch('/api/scan', { method: 'POST' });
    pollScanStatus();
  } catch {
    scanIcon.classList.remove('spinning');
    scanBtn.disabled = false;
    toast('Could not start scan');
  }
}

let scanPollT = null;
function pollScanStatus() {
  clearInterval(scanPollT);
  scanPollT = setInterval(async () => {
    try {
      const res = await fetch('/api/scan/status');
      const st = await res.json();
      if (!st.scanning && !st.enriching) {
        clearInterval(scanPollT);
        scanPollT = null;
        scanIcon.classList.remove('spinning');
        scanBtn.disabled = false;
        await loadMovies();
        const parts = [];
        if (st.lastScanAdded > 0) parts.push(`+${st.lastScanAdded} added`);
        if (st.lastScanRemoved > 0) parts.push(`−${st.lastScanRemoved} removed`);
        toast(parts.length ? `Scan complete — ${parts.join(', ')} · ${st.count} titles` : `Scan complete — ${st.count} titles`);
      }
    } catch { /* keep polling */ }
  }, 1200);
}

scanBtn.addEventListener('click', triggerScan);

/* ── QR modal ────────────────────────────────────────────────── */

$('#qrBtn').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/qr');
    const data = await res.json();
    $('#qrImage').src = data.qr;
    $('#qrUrl').textContent = data.url;
    const alt = (data.all || []).filter((u) => u !== data.url);
    $('#qrAlt').textContent = alt.length ? `Also reachable at: ${alt.join(' · ')}` : '';
    $('#qrModal').hidden = false;
  } catch {
    toast('Could not generate QR code');
  }
});

$('#qrCopy').addEventListener('click', async () => {
  const url = $('#qrUrl').textContent;
  try {
    await navigator.clipboard.writeText(url);
    toast('LAN address copied to clipboard');
  } catch {
    toast(url);
  }
});

/* ── Search / modal wiring ───────────────────────────────────── */

const searchInput = $('#searchInput');
searchInput.addEventListener('input', () => {
  state.search = searchInput.value.trim();
  $('#searchClear').hidden = !state.search;
  renderGrid();
});
$('#searchClear').addEventListener('click', () => {
  searchInput.value = '';
  state.search = '';
  $('#searchClear').hidden = true;
  renderGrid();
  searchInput.focus();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('#player').hidden) closePlayer();
    else if (!$('#detailModal').hidden) closeDetail();
    else if (!$('#qrModal').hidden) $('#qrModal').hidden = true;
  }
  if (e.key === '/' && document.activeElement !== searchInput) {
    e.preventDefault();
    searchInput.focus();
  }
});

$$('[data-close]').forEach((el) =>
  el.addEventListener('click', () => {
    const modal = el.closest('.modal');
    if (modal) modal.hidden = true;
    if (!($('#player').hidden)) return;
    document.body.style.overflow = '';
  })
);

$('#playerClose').addEventListener('click', closePlayer);
window.addEventListener('beforeunload', () => { if (!$('#player').hidden) saveProgressNow(); });

/* ── Boot ────────────────────────────────────────────────────── */

(async function init() {
  await loadMovies();
  // If the server is mid-scan on page load, follow along.
  try {
    const st = await (await fetch('/api/scan/status')).json();
    if (st.scanning || st.enriching) {
      scanIcon.classList.add('spinning');
      scanBtn.disabled = true;
      pollScanStatus();
    }
  } catch { /* ignore */ }
})();
