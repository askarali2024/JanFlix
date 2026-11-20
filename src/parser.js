/**
 * JanFlix — release filename parser.
 * Turns messy scene/release filenames into clean { title, year, resolution }.
 *
 * Examples:
 *   The.Odyssey.2026.1080p.WEBRip.x264.mp4  -> { The Odyssey, 2026, 1080p }
 *   dune_part_two_2023_2160p.mkv          -> { Dune Part Two, 2023, 4K }
 *   Some Movie (2024) [BluRay].avi        -> { Some Movie, 2024, null }
 */

'use strict';

// Tokens that mark the end of the "clean title" part of a filename.
const QUALITY_TOKENS = new Set([
  'webrip', 'web-dl', 'webdl', 'web', 'blu-ray', 'bluray', 'brrip', 'bdrip',
  'dvdrip', 'dvdscr', 'hdrip', 'hdtv', 'camrip', 'cam', 'hdts', 'telesync',
  'ts', 'tc', 'x264', 'x265', 'h264', 'h265', 'hevc', 'avc', 'xvid', 'divx',
  'aac', 'aac2', 'ac3', 'eac3', 'dts', 'dts-hd', 'truehd', 'atmos', 'flac',
  'mp3', '10bit', '8bit', 'hdr', 'hdr10', 'dolby', 'vision', 'remux', 'proper',
  'repack', 'extended', 'unrated', 'imax', 'multi', 'dubbed', 'dub', 'subbed',
  'subs', 'complete', 'internal', 'limited', 'ch', 'dts-hdma',
]);

// Bare digit tokens are NOT quality markers on their own, otherwise
// titles like "2 Guns" or "Ocean's 8" would be cut short.
const BARE_DIGITS = new Set(['1', '2', '5', '7', '8']);
const RES_TOKEN = /^(2160p|1080[pi]|720[pi]|480[pi]|360[pi])$/i;
const QUALITY_PREFIX =
  /^(webrip|web-?dl|bluray|brrip|bdrip|dvdrip|hdtv|hdrip|x264|x265|h264|h265|hevc|aac|ac3|eac3|dts)/i;

const RES_PATTERNS = [
  { re: /(?:2160p|3840x\d+|\buhd\b|\b4k\b)/i, label: '4K' },
  { re: /1080[pi]/i, label: '1080p' },
  { re: /720[pi]/i, label: '720p' },
  { re: /480[pi]/i, label: '480p' },
  { re: /360[pi]/i, label: '360p' },
];

function detectResolution(base) {
  for (const p of RES_PATTERNS) {
    if (p.re.test(base)) return p.label;
  }
  return null;
}

/**
 * Split a filename's non-extension part into clean tokens,
 * handling '.', '_', '-', ' ' and bracket groupings as separators.
 */
function tokenize(base) {
  return base
    .replace(/\.[({[]/g, ' ') // ".(" at token boundaries
    .replace(/[)}\]]/g, ' ')
    .replace(/[._]+/g, ' ')
    .split(/[\s\-]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Find indices of all "year-like" tokens (1900–2099). */
function findYearIndices(tokens) {
  const exact = [];
  for (let i = 0; i < tokens.length; i++) {
    if (/^(?:19|20)\d{2}$/.test(tokens[i])) exact.push(i);
  }
  if (exact.length) return exact;
  // Year glued to other text, e.g. "(2026" or "[2026,"
  const glued = [];
  for (let i = 0; i < tokens.length; i++) {
    if (/(?:19|20)\d{2}/.test(tokens[i])) glued.push(i);
  }
  return glued;
}

/** Find the first token that is a release-quality keyword or resolution. */
function findQualityIndex(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].toLowerCase();
    if (RES_TOKEN.test(t)) return i;
    if (QUALITY_TOKENS.has(t) && !BARE_DIGITS.has(t)) return i;
  }
  // Fuzzy: catch "webrip1080p", "x264-CMRG" style glued tokens
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].toLowerCase();
    if (QUALITY_PREFIX.test(t) && t.length > 3) return i;
  }
  return -1;
}

/**
 * Parse a movie filename.
 * @param {string} fileName e.g. "The.Odyssey.2026.1080p.WEBRip.x264.mp4"
 * @returns {{ title: string, year: number|null, resolution: string|null }}
 */
function parseFileName(fileName) {
  const base = fileName.replace(/\.[^.]+$/, '');
  const resolution = detectResolution(base);
  const tokens = tokenize(base);

  let title = '';
  let year = null;

  const yearIndices = findYearIndices(tokens);
  const qualityIdx = findQualityIndex(tokens);

  // Release years conventionally come after the title, so prefer the LAST
  // year-like token that isn't leading (handles "Blade Runner 2049 2017"
  // and "2001 A Space Odyssey 1968" correctly).
  let yearIdx = -1;
  for (let i = yearIndices.length - 1; i >= 0; i--) {
    if (yearIndices[i] > 0) { yearIdx = yearIndices[i]; break; }
  }
  if (yearIdx === -1 && yearIndices.length) yearIdx = yearIndices[0]; // leading year

  if (yearIdx >= 0) {
    const m = tokens[yearIdx].match(/((?:19|20)\d{2})/);
    if (m) year = parseInt(m[1], 10);
  }

  let cut = tokens.length;
  if (yearIdx > 0) cut = Math.min(cut, yearIdx);
  if (qualityIdx > 0) cut = Math.min(cut, qualityIdx);

  // Filename starts with the year: "2026.Some.Movie.1080p.mp4" — drop it
  // from the title since it's already captured as the year.
  const start = yearIdx === 0 ? 1 : 0;

  title = tokens.slice(start, cut).join(' ').trim();
  if (!title && start === 1) title = tokens.slice(0, cut).join(' ').trim();

  // Nothing left? Fall back to the whole cleaned base name.
  if (!title) title = tokens.join(' ').trim() || base;

  return { title, year, resolution };
}

module.exports = { parseFileName, detectResolution };
