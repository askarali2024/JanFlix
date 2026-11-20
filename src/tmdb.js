/**
 * JanFlix — optional TMDB metadata enrichment.
 * Fetches poster, backdrop, overview, rating, runtime and genres from
 * themoviedb.org, downloads images once into DATA_DIR/images and caches
 * everything in library.json so restarts are instant and offline.
 *
 * Uses only Node's built-in https module — no extra dependencies.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const TMDB_API = 'api.themoviedb.org';
const TMDB_IMG = 'image.tmdb.org';

function httpGetBuffer(url, redirectsLeft = 3) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));
        return resolve(httpGetBuffer(res.headers.location, redirectsLeft - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
  });
}

async function httpGetJson(url) {
  const buf = await httpGetBuffer(url);
  return JSON.parse(buf.toString('utf8'));
}

/**
 * Search TMDB for a movie.
 * @returns {Promise<object|null>} TMDB movie details or null
 */
async function searchMovie(apiKey, title, year) {
  const params = new URLSearchParams({ api_key: apiKey, query: title });
  if (year) params.set('year', year);
  const search = await httpGetJson(`https://${TMDB_API}/3/search/movie?${params}`);
  if (!search.results || search.results.length === 0) {
    // Retry without the year — release years often differ.
    if (year) return searchMovie(apiKey, title, null);
    return null;
  }
  return search.results[0];
}

async function getMovieDetails(apiKey, tmdbId) {
  return httpGetJson(`https://${TMDB_API}/3/movie/${tmdbId}?api_key=${apiKey}`);
}

/**
 * Enrich a movie object with TMDB metadata.
 * Downloads poster + backdrop into imagesDir.
 * @returns {Promise<boolean>} true when the movie was enriched
 */
async function enrichMovie(movie, apiKey, imagesDir) {
  try {
    const hit = await searchMovie(apiKey, movie.title, movie.year);
    if (!hit || !hit.id) return false;
    const details = await getMovieDetails(apiKey, hit.id);

    const posterUrl =
      details.poster_path
        ? `/images/${movie.id}-poster${path.extname(details.poster_path) || '.jpg'}`
        : null;
    const backdropUrl =
      details.backdrop_path
        ? `/images/${movie.id}-backdrop${path.extname(details.backdrop_path) || '.jpg'}`
        : null;

    if (details.poster_path) {
      const buf = await httpGetBuffer(`https://${TMDB_IMG}/t/p/w500${details.poster_path}`);
      fs.writeFileSync(path.join(imagesDir, path.basename(posterUrl)), buf);
    }
    if (details.backdrop_path) {
      const buf = await httpGetBuffer(`https://${TMDB_IMG}/t/p/w1280${details.backdrop_path}`);
      fs.writeFileSync(path.join(imagesDir, path.basename(backdropUrl)), buf);
    }

    movie.tmdbId = details.id;
    movie.title = details.title || movie.title;
    movie.year = (details.release_date && parseInt(details.release_date.slice(0, 4), 10)) || movie.year;
    movie.overview = details.overview || null;
    movie.rating = details.vote_average ? Math.round(details.vote_average * 10) / 10 : null;
    movie.runtime = details.runtime || null;
    movie.genres = (details.genres || []).map((g) => g.name);
    movie.posterUrl = posterUrl;
    movie.backdropUrl = backdropUrl;
    return true;
  } catch (err) {
    console.warn(`[janflix] TMDB enrichment failed for "${movie.title}": ${err.message}`);
    return false;
  }
}

module.exports = { enrichMovie };
