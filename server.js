/**
 * ████ JanFlix ████
 * A lightweight, self-hosted LAN movie & media streaming server.
 *
 *   - Express serves a static Netflix-inspired SPA from ./public
 *   - Video files are streamed straight from disk with HTTP Range
 *     support (206 Partial Content) so seeking/scrubbing is smooth
 *   - Metadata, cached posters and watch progress live in ./data (JSON)
 *   - Optional TMDB enrichment when TMDB_API_KEY is set
 *   - Optional ffmpeg "Compatibility Stream" for MKV audio fallback
 *   - Zero file duplication: the library is scanned in place
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const express = require('express');
const QRCode = require('qrcode');

const { JsonStore } = require('./src/store');
const { scanLibrary } = require('./src/scanner');
const { findSubtitleTracks, loadSubtitleVtt } = require('./src/subtitles');
const { enrichMovie } = require('./src/tmdb');

/* ────────────────────────────────────────────────────────────────
 * Configuration (environment + .env file)
 * ──────────────────────────────────────────────────────────────── */

function loadEnvFile() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let value = m[2];
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(m[1] in process.env)) process.env[m[1]] = value;
    }
  } catch {
    /* no .env — that's fine */
  }
}
loadEnvFile();

const PORT = parseInt(process.env.PORT || '3000', 10);
const MEDIA_DIRS = (process.env.MEDIA_DIRS || './movies')
  .split(',')
  .map((d) => d.trim())
  .filter(Boolean)
  .map((d) => path.resolve(__dirname, d));
const DATA_DIR = path.resolve(__dirname, process.env.DATA_DIR || './data');
const TMDB_API_KEY = process.env.TMDB_API_KEY || '';

/* ────────────────────────────────────────────────────────────────
 * Data store (library + progress) — instant startup, no re-fetch
 * ──────────────────────────────────────────────────────────────── */

const store = new JsonStore(DATA_DIR);
let library = store.load('library', { movies: [] }).movies;
let progress = store.load('progress', {});

function saveLibrary() {
  store.set('library', { movies: library });
  store.save('library');
}
function saveProgress() {
  store.set('progress', progress);
  store.save('progress');
}

/* ────────────────────────────────────────────────────────────────
 * ffmpeg detection (optional MKV compatibility stream)
 * ──────────────────────────────────────────────────────────────── */

function detectFfmpeg() {
  try {
    const out = require('child_process')
      .execSync('ffmpeg -version', { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 })
      .toString();
    return /ffmpeg version/i.test(out);
  } catch {
    return false;
  }
}
const FFMPEG_AVAILABLE = detectFfmpeg();

/* ────────────────────────────────────────────────────────────────
 * Scan state + background rescans / enrichment
 * ──────────────────────────────────────────────────────────────── */

const scanState = {
  scanning: false,
  enriching: false,
  lastScan: null,
  lastScanAdded: 0,
  lastScanRemoved: 0,
};

function movieById(id) {
  return library.find((m) => m.id === id);
}

async function runScan() {
  if (scanState.scanning) return;
  scanState.scanning = true;

  let result;
  try {
    result = scanLibrary({ mediaDirs: MEDIA_DIRS, existing: library });
    library = result.movies;
    saveLibrary();
    scanState.lastScan = Date.now();
    scanState.lastScanAdded = result.added;
    scanState.lastScanRemoved = result.removed;
  } catch (err) {
    console.error('[janflix] scan failed:', err);
  } finally {
    scanState.scanning = false;
  }

  // Optional TMDB enrichment for movies we haven't looked up yet.
  if (TMDB_API_KEY && result && result.enrichedCandidates.length > 0) {
    scanState.enriching = true;
    console.log(
      `[janflix] enriching ${result.enrichedCandidates.length} new movie(s) from TMDB…`
    );
    for (const movie of result.enrichedCandidates) {
      await enrichMovie(movie, TMDB_API_KEY, store.imagesDir);
      saveLibrary();
    }
    scanState.enriching = false;
    console.log('[janflix] TMDB enrichment complete.');
  }
}

/* ────────────────────────────────────────────────────────────────
 * Express app
 * ──────────────────────────────────────────────────────────────── */

const app = express();
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(store.imagesDir, { maxAge: '30d', immutable: true }));

const MIME = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
};

/* Library listing: movies + progress + capabilities in one call. */
app.get('/api/movies', (req, res) => {
  res.json({
    movies: library.map((m) => ({
      ...m,
      subtitles: findSubtitleTracks(m.filePath),
    })),
    progress,
    config: {
      tmdb: !!TMDB_API_KEY,
      ffmpeg: FFMPEG_AVAILABLE,
    },
  });
});

/* Trigger a background rescan. */
app.post('/api/scan', (req, res) => {
  runScan(); // fire and forget
  res.json({ ok: true, started: true });
});

app.get('/api/scan/status', (req, res) => {
  res.json({ ...scanState, count: library.length });
});

/* Save watch progress (called every 10s while playing). */
app.post('/api/progress/:id', (req, res) => {
  const { id } = req.params;
  const { position, duration } = req.body || {};
  if (!movieById(id)) return res.status(404).json({ error: 'unknown movie' });
  const pos = Number(position);
  const dur = Number(duration);
  if (!Number.isFinite(pos) || pos < 0) return res.status(400).json({ error: 'bad position' });
  progress[id] = {
    position: pos,
    duration: Number.isFinite(dur) ? dur : progress[id]?.duration || 0,
    updatedAt: Date.now(),
  };
  saveProgress();
  res.json({ ok: true });
});

/* Delete watch progress (e.g. "start over"). */
app.delete('/api/progress/:id', (req, res) => {
  delete progress[req.params.id];
  saveProgress();
  res.json({ ok: true });
});

/* Subtitles as WebVTT (srt converted on the fly). */
app.get('/api/subtitles/:id', (req, res) => {
  const movie = movieById(req.params.id);
  if (!movie) return res.status(404).end();
  const vtt = loadSubtitleVtt(movie.filePath, req.query.t || 'default');
  if (vtt === null) return res.status(404).end();
  res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
  res.send(vtt);
});

/* ── Video streaming with Range support ─────────────────────── */

app.get('/api/stream/:id', (req, res) => {
  const movie = movieById(req.params.id);
  if (!movie || !fs.existsSync(movie.filePath)) {
    return res.status(404).json({ error: 'not found' });
  }

  const ext = path.extname(movie.filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';
  const compat = req.query.compat === '1';

  /* Compatibility Stream: remux/transcode audio to AAC for browsers
     that can't decode MKV audio (e.g. AC-3 / E-AC-3). */
  if (compat) {
    if (!FFMPEG_AVAILABLE) {
      return res.status(400).json({ error: 'ffmpeg not available on host' });
    }
    res.status(200);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cache-Control', 'no-store');
    const ffmpeg = spawn('ffmpeg', [
      '-loglevel', 'error',
      '-i', movie.filePath,
      '-map', '0:v:0',
      '-map', '0:a:0?',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-f', 'mp4',
      '-movflags', 'frag_keyframe+empty_moov',
      'pipe:1',
    ]);
    ffmpeg.stdout.pipe(res);
    ffmpeg.stderr.on('data', (d) => process.stderr.write(d));
    const cleanup = () => { try { ffmpeg.kill('SIGKILL'); } catch { /* noop */ } };
    res.on('close', cleanup);
    ffmpeg.on('error', () => res.end());
    return;
  }

  /* Direct disk streaming with 206 Partial Content for smooth seeking. */
  const stat = fs.statSync(movie.filePath);
  const range = req.headers.range;

  if (!range) {
    res.writeHead(200, {
      'Content-Length': stat.size,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    });
    return fs.createReadStream(movie.filePath).pipe(res);
  }

  const m = range.match(/bytes=(\d*)-(\d*)/);
  let start = m && m[1] ? parseInt(m[1], 10) : 0;
  let end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
  if (start >= stat.size) {
    return res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end();
  }
  end = Math.min(end, stat.size - 1);
  if (start > end) [start, end] = [end, start];

  res.writeHead(206, {
    'Content-Range': `bytes ${start}-${end}/${stat.size}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1,
    'Content-Type': contentType,
  });
  fs.createReadStream(movie.filePath, { start, end }).pipe(res);
});

/* Download for offline viewing. */
app.get('/api/download/:id', (req, res) => {
  const movie = movieById(req.params.id);
  if (!movie || !fs.existsSync(movie.filePath)) {
    return res.status(404).json({ error: 'not found' });
  }
  const stat = fs.statSync(movie.filePath);
  const ext = path.extname(movie.filePath).toLowerCase();
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  res.setHeader('Content-Length', stat.size);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(movie.fileName)}`
  );
  fs.createReadStream(movie.filePath).pipe(res);
});

/* LAN info + QR code so family can scan & watch on phones. */
function lanUrl() {
  const interfaces = os.networkInterfaces();
  let ip = null;
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ip = iface.address;
        break;
      }
    }
    if (ip) break;
  }
  return `http://${ip || 'localhost'}:${PORT}`;
}

app.get('/api/qr', async (req, res) => {
  try {
    const url = lanUrl();
    const qr = await QRCode.toDataURL(url, {
      width: 320,
      margin: 2,
      color: { dark: '#0f111aff', light: '#ffffffff' },
    });
    res.json({ url, qr });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not found' });
  next();
});

/* SPA fallback */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ────────────────────────────────────────────────────────────────
 * Boot
 * ──────────────────────────────────────────────────────────────── */

http.createServer(app).listen(PORT, () => {
  console.log('');
  console.log('  ████ JanFlix ████');
  console.log(`  Streaming:   ${lanUrl()}`);
  console.log(`  Library:    ${MEDIA_DIRS.join(', ')}`);
  console.log(`  Data:        ${DATA_DIR}`);
  console.log(`  Movies:      ${library.length}`);
  console.log(`  TMDB:        ${TMDB_API_KEY ? 'enabled' : 'disabled (offline mode)'}`);
  console.log(`  ffmpeg:      ${FFMPEG_AVAILABLE ? 'available (compat streams on)' : 'not found (compat streams off)'}`);
  console.log('');
  // Rescan in the background; the stored library is served instantly.
  runScan();
});
