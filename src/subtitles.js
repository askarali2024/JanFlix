/**
 * JanFlix — subtitle handling.
 * Finds .srt / .vtt sidecar files matching a movie, and converts
 * .srt to WebVTT on the fly for the HTML5 <track> element.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Find subtitle tracks for a movie file. Matches:
 *   Movie.2026.1080p.mkv  ->  Movie.2026.1080p.srt
 *                              Movie.2026.1080p.vtt
 *                              Movie.2026.1080p.en.srt
 *                              Movie.2026.1080p.de.vtt ...
 * @param {string} filePath absolute path of the video file
 * @returns {{ id: string, label: string, lang: string, ext: string }[]}
 */
function findSubtitleTracks(filePath) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, path.extname(filePath));
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }

  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${escaped}(?:\\.([A-Za-z]{2,3}))?\\.(srt|vtt)$`, 'i');

  const tracks = [];
  const seenLangs = new Set();
  for (const entry of entries) {
    const m = entry.match(re);
    if (!m) continue;
    const lang = (m[1] || '').toLowerCase();
    const ext = m[2].toLowerCase();
    const key = lang || 'default';
    if (seenLangs.has(key)) continue; // prefer the first (.srt vs .vtt)
    seenLangs.add(key);
    tracks.push({
      id: lang || 'default',
      label: lang ? lang.toUpperCase() : 'Subtitles',
      lang: lang || 'en',
      ext,
    });
  }
  return tracks;
}

/**
 * Convert an SRT string to WebVTT.
 * @param {string} srt
 * @returns {string}
 */
function srtToVtt(srt) {
  return (
    'WEBVTT\n\n' +
    srt
      .replace(/^\uFEFF/, '')
      .replace(/\r+/g, '')
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
  );
}

/**
 * Load a subtitle track for a movie and return WebVTT text.
 * @param {string} filePath video file path
 * @param {string} trackId track id from findSubtitleTracks
 * @returns {string|null} WebVTT contents, or null if unavailable
 */
function loadSubtitleVtt(filePath, trackId) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, path.extname(filePath));
  const candidates =
    trackId === 'default'
      ? [`${base}.vtt`, `${base}.srt`]
      : [`${base}.${trackId}.vtt`, `${base}.${trackId}.srt`];

  for (const name of candidates) {
    try {
      const raw = fs.readFileSync(path.join(dir, name), 'utf8');
      return name.toLowerCase().endsWith('.srt') ? srtToVtt(raw) : raw;
    } catch {
      // try next candidate
    }
  }
  return null;
}

module.exports = { findSubtitleTracks, srtToVtt, loadSubtitleVtt };
