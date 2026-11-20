# JanFlix 🎬

A lightweight, **self-hosted LAN movie & media streaming server** with a sleek, Netflix-inspired dark UI. Point it at folders of movies you already have — it streams them straight from disk with zero duplication, and family members can scan a QR code to watch on their phones or tablets.

```
   ┌─────────────────────────────────────────────────────────────────────┐
   │                        YOUR LOCAL NETWORK (LAN)                      │
   │                                                                       │
   │   📱 Phone        💻 Laptop          📺 Tablet      …family devices   │
   │      │                │                  │                            │
   │      └────────────────┼──────────────────┘                           │
   │                       │  http://<LAN-IP>:3000                        │
   │                       ▼                                              │
   │  ┌──────────────────────────────────────────────────────────────┐    │
   │  │                     JANFLIX SERVER (Node.js)                  │    │
   │  │                                                              │    │
   │  │   Express ─┬─ /            static SPA (HTML/CSS/vanilla JS) │    │
   │  │            ├─ /api/stream   Range requests → 206 Partial    │    │
   │  │            │                Content (smooth seek/scrub)      │    │
   │  │            ├─ /api/download  full-file download for trips    │    │
   │  │            ├─ /api/subtitles .srt → .vtt on the fly          │    │
   │  │            ├─ /api/progress  watch progress (every 10 s)     │    │
   │  │            ├─ /api/scan      background library rescan       │    │
   │  │            ├─ /api/qr       LAN QR code                     │    │
   │  │            └─ /api/movies   library + progress + config      │    │
   │  │                                                              │    │
   │  │   Scanner ──► parser.js   messy filenames → title/year/res   │    │
   │  │   TMDB*  ───► posters, backdrops, plots, ratings, genres     │    │
   │  │   ffmpeg* ─► Compatibility Stream (MKV audio → AAC)         │    │
   │  │                                                              │    │
   │  │   ./data  ─► library.json, progress.json, images/ (cache)   │    │
   │  └──────────────────────────────────────────────────────────────┘    │
   │                       │                                              │
   │                       ▼  direct disk streaming (no copies)           │
   │   /Volumes/Media/movies     /mnt/nas/films     …MEDIA_DIRS            │
   └─────────────────────────────────────────────────────────────────────┘

        * TMDB enrichment and the ffmpeg compatibility stream are optional.
          Without them JanFlix works 100% offline out of the box.
```

## ✨ Features

- **Zero duplication** — scans your existing folders in place, never copies or moves files
- **Smooth seeking** — HTTP `Range` / `206 Partial Content` streaming straight from disk
- **Smart filename parser** — `The.Odyssey.2026.1080p.WEBRip.x264.mp4` → *The Odyssey (2026, 1080p)*
- **Continue Watching** — cross-device resume; progress saves every 10 s while playing
- **Live search** — filters by title, genre or year as you type (`/` focuses the search bar)
- **Filter pills** — All / Movies / Recently Added + dynamic genre pills
- **Subtitles** — picks up matching `.srt` / `.vtt` sidecar files; `.srt` is converted to WebVTT on the fly
- **MKV compatibility stream** — if `ffmpeg` is installed, an optional toggle remuxes stubborn MKV audio to AAC for browser playback
- **TMDB enrichment (optional)** — posters, backdrop banners, synopsis, rating, runtime and genres, cached locally
- **Offline fallback posters** — generated gradient cards with title/year/resolution when no API key is set
- **QR code modal** — one scan and family devices are watching
- **Instant restarts** — metadata, cached art and progress live in a JSON store in `./data`
- **Downloads** — grab a movie for offline trips straight from the detail view

## 🚀 Quick start

```bash
# 1. Install (only Express + a QR library — minimal dependencies)
npm install

# 2. (Optional) configure
cp .env.example .env
#    edit MEDIA_DIRS to point at your movie folders

# 3. Add movies — just leave files where they are, e.g.:
mkdir -p movies
cp ~/Downloads/The.Odyssey.2026.1080p.WEBRip.x264.mp4 movies/

# 4. Run
npm start
```

Then open **http://localhost:3000** (or the LAN URL printed in the console) and hit **Scan Library**.

> Files smaller than **50 MB** are ignored automatically (skips samples and trailers).
> Supported formats: `.mp4` `.mkv` `.webm` `.mov` `.avi` `.m4v`

### Watch on phones & tablets

Tap the **QR** button in the header, scan the code with any device on the same Wi-Fi, and you're watching. No app install needed — it's just a website on your LAN.

## ⚙️ Configuration

All configuration is via environment variables (or a `.env` file — see `.env.example`):

| Variable       | Default    | Description                                                                 |
| -------------- | ---------- | --------------------------------------------------------------------------- |
| `PORT`         | `3000`     | Port the web UI and API are served on.                                       |
| `MEDIA_DIRS`   | `./movies` | Comma-separated list of folders to scan (recursive). Absolute or relative. |
| `DATA_DIR`     | `./data`   | Where the JSON database, cached posters and progress are stored.            |
| `TMDB_API_KEY` | *(unset)*  | Optional [TMDB](https://www.themoviedb.org/settings/api) key. Unset = fully offline mode with generated fallback posters. |

Example:

```bash
MEDIA_DIRS="/mnt/nas/films,/Volumes/Media/classics" PORT=8080 npm start
```

### Optional: TMDB metadata

1. Create a free account at [themoviedb.org](https://www.themoviedb.org/) and grab an API key
2. Put `TMDB_API_KEY=your_key` in `.env`
3. Rescan — JanFlix fetches and **caches** posters, backdrops, plots, ratings, runtimes and genres into `./data` (one fetch ever, restarts are instant and offline)

### Optional: MKV compatibility streams

If some `.mkv` files play video but have no audio in the browser (typically AC-3 / E-AC-3 tracks), install `ffmpeg` on the host:

```bash
# macOS
brew install ffmpeg
# Debian/Ubuntu
sudo apt install ffmpeg
```

JanFlix detects it automatically and shows a **⚡ Compatibility Stream** toggle in the player. It also switches over by itself if the browser reports a decode error.

### Subtitles

Drop a subtitle file next to the movie with a matching name:

```
movies/The.Odyssey.2026.1080p.WEBRip.x264.mp4
movies/The.Odyssey.2026.1080p.WEBRip.x264.srt      ← used automatically
movies/The.Odyssey.2026.1080p.WEBRip.x264.en.srt   ← or with a language tag
movies/The.Odyssey.2026.1080p.WEBRip.x264.de.vtt   ← .vtt works natively too
```

`.srt` files are converted to WebVTT on the fly — nothing to rename or install.

## 🗂 Project structure

```
JanFlix/
├── server.js          # Express app: streaming, API routes, QR, ffmpeg compat
├── src/
│   ├── parser.js      # messy release filename → title / year / resolution
│   ├── scanner.js     # recursive folder scan (>= 50 MB videos only)
│   ├── subtitles.js   # sidecar subtitle discovery + srt→vtt conversion
│   ├── tmdb.js        # optional TMDB enrichment (uses built-in https only)
│   └── store.js       # tiny atomic JSON persistence in DATA_DIR
├── public/
│   ├── index.html     # static SPA
│   ├── style.css      # dark theme (#0f111a / #181b28 / #6366f1)
│   └── app.js         # UI logic — vanilla JS, zero dependencies
├── data/              # created at runtime: library.json, progress.json, images/
└── movies/            # default media folder (configure via MEDIA_DIRS)
```

## 📝 Notes

- Watch progress counts as **Continue Watching** between 2 % and 95 % — pause on the TV, resume on the phone.
- Scans run in the background; the UI keeps working while a scan (and optional TMDB enrichment) is in progress.
- The library is keyed by file path, so renaming a file makes it a "new" movie (and re-fetches metadata if TMDB is enabled).
- Everything is served from your own machine — nothing leaves your LAN except optional TMDB API calls when a key is set.
