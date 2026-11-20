/**
 * JanFlix — recursive library scanner.
 * Walks MEDIA_DIRS looking for video files >= MIN_FILE_SIZE, parses their
 * names, merges them with any previously stored metadata (TMDB info,
 * posters, etc.) and never copies, moves or modifies the source files.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseFileName } = require('./parser');
const { findSubtitleTracks } = require('./subtitles');

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.webm', '.mov', '.avi', '.m4v']);
const MIN_FILE_SIZE = 50 * 1024 * 1024; // 50 MB — skips samples & trailers

function stableId(filePath) {
  return crypto.createHash('md5').update(filePath).digest('hex').slice(0, 12);
}

/** Recursively collect video files under a directory. */
function walk(dir, out, depth = 0) {
  if (depth > 12) return; // sanity guard against symlink loops
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out, depth + 1);
    } else if (entry.isFile() && VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
}

/**
 * Scan all media directories and rebuild the library array.
 * Existing entries (matched by id) keep their TMDB metadata.
 *
 * @param {object} opts
 * @param {string[]} opts.mediaDirs absolute media directories
 * @param {object[]} opts.existing previously stored movie list
 * @returns {{ movies: object[], added: number, removed: number, enrichedCandidates: object[] }}
 */
function scanLibrary({ mediaDirs, existing }) {
  const existingById = new Map(existing.map((m) => [m.id, m]));
  const found = new Map();

  for (const dir of mediaDirs) {
    const abs = path.resolve(dir);
    if (!fs.existsSync(abs)) continue;
    const files = [];
    walk(abs, files);
    for (const filePath of files) {
      let stat;
      try {
        stat = fs.statSync(filePath);
      } catch {
        continue;
      }
      if (stat.size < MIN_FILE_SIZE) continue;

      const id = stableId(filePath);
      if (found.has(id)) continue;

      const fileName = path.basename(filePath);
      const { title, year, resolution } = parseFileName(fileName);

      const prev = existingById.get(id);
      const movie = {
        id,
        title: (prev && prev.title) || title,
        year,
        resolution,
        filePath,
        fileName,
        dir: path.dirname(filePath),
        fileSize: stat.size,
        modifiedAt: Math.floor(stat.mtimeMs),
        addedAt: (prev && prev.addedAt) || Date.now(),
        // preserved metadata from a previous scan / TMDB enrichment
        overview: prev?.overview || null,
        rating: prev?.rating || null,
        runtime: prev?.runtime || null,
        genres: prev?.genres || [],
        tmdbId: prev?.tmdbId || null,
        posterUrl: prev?.posterUrl || null,
        backdropUrl: prev?.backdropUrl || null,
      };
      found.set(id, movie);
    }
  }

  // Detect new movies that still need TMDB enrichment.
  const enrichedCandidates = [...found.values()].filter(
    (m) => !m.tmdbId && !m.posterUrl
  );

  const removed = existing.filter((m) => !found.has(m.id)).length;

  return {
    movies: [...found.values()].sort((a, b) => a.title.localeCompare(b.title)),
    added: found.size - (existing.length - removed),
    removed,
    enrichedCandidates,
  };
}

module.exports = { scanLibrary, VIDEO_EXTENSIONS, MIN_FILE_SIZE };
