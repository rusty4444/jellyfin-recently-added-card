/**
 * Jellyfin Recently Added Card
 * Custom Lovelace card that displays the latest movies and TV shows from Jellyfin
 * with interleaved movie/show/movie/show cycling and cinematic transitions.
 *
 * Adapted from plex-recently-added-card by Perplexity Computer.
 */

class JellyfinRecentlyAddedCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._items = [];
    this._currentIndex = 0;
    this._cycleTimer = null;
    this._config = {};
    this._userId = null; // cached userId
    this._trailerCache = {}; // tmdbId → YouTube URL or null
  }

  setConfig(config) {
    if (!config.jellyfin_url) throw new Error('Please define jellyfin_url');
    if (!config.api_key) throw new Error('Please define api_key');

    this._config = {
      jellyfin_url: config.jellyfin_url,
      api_key: config.api_key,
      user_id: config.user_id || null,
      movies_count: config.movies_count || 5,
      shows_count: config.shows_count || 5,
      cycle_interval: config.cycle_interval || 8,
      title: config.title !== undefined ? config.title : 'Recently Added',
      ...config,
    };

    // Pre-seed cached userId from config if provided
    if (this._config.user_id) {
      this._userId = this._config.user_id;
    }

    // Apply fixed-height class if fill_height is disabled
    if (this._config.fill_height === false) {
      this.classList.add('fixed-height');
    } else {
      this.classList.remove('fixed-height');
    }

    this._render();
    this._fetchData();
  }

  set hass(hass) {
    this._hass = hass;
  }

  // ── Image URL helpers ────────────────────────────────────────────────────

  _posterUrl(itemId) {
    const base = this._config.jellyfin_url.replace(/\/$/, '');
    const key = this._config.api_key;
    return `${base}/Items/${itemId}/Images/Primary?maxWidth=400&quality=90&api_key=${key}`;
  }

  _backdropUrl(itemId) {
    const base = this._config.jellyfin_url.replace(/\/$/, '');
    const key = this._config.api_key;
    return `${base}/Items/${itemId}/Images/Backdrop?maxWidth=800&quality=80&api_key=${key}`;
  }

  // ── User ID resolution ───────────────────────────────────────────────────

  async _resolveUserId() {
    if (this._userId) return this._userId;

    const base = this._config.jellyfin_url.replace(/\/$/, '');
    const key = this._config.api_key;

    const resp = await fetch(`${base}/Users?api_key=${key}`, {
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) throw new Error(`Failed to fetch users: HTTP ${resp.status}`);
    const users = await resp.json();
    if (!Array.isArray(users) || users.length === 0) throw new Error('No Jellyfin users found');

    this._userId = users[0].Id;
    return this._userId;
  }

  // ── Data fetching ────────────────────────────────────────────────────────

  async _fetchData() {
    try {
      const base = this._config.jellyfin_url.replace(/\/$/, '');
      const key = this._config.api_key;
      const moviesCount = this._config.movies_count;
      const showsCount = this._config.shows_count;

      const userId = await this._resolveUserId();

      const headers = {
        'X-MediaBrowser-Token': key,
        Accept: 'application/json',
      };

      // ── Fetch recently added movies ──────────────────────────────────────
      const moviesResp = await fetch(
        `${base}/Users/${userId}/Items/Latest` +
          `?IncludeItemTypes=Movie` +
          `&Limit=${moviesCount * 2}` +
          `&Fields=Overview,Genres,OfficialRating,CommunityRating,RunTimeTicks,DateCreated,ProviderIds` +
          `&EnableImageTypes=Primary,Backdrop`,
        { headers }
      );
      if (!moviesResp.ok) throw new Error(`Movies fetch failed: HTTP ${moviesResp.status}`);
      const moviesRaw = await moviesResp.json();
      const moviesArr = Array.isArray(moviesRaw) ? moviesRaw : [];

      // Sort by DateCreated descending and take top N
      moviesArr.sort(
        (a, b) =>
          (Date.parse(b.DateCreated) || 0) - (Date.parse(a.DateCreated) || 0)
      );
      const movies = moviesArr.slice(0, moviesCount);

      // ── Fetch recently added episodes ────────────────────────────────────
      const showsResp = await fetch(
        `${base}/Users/${userId}/Items/Latest` +
          `?IncludeItemTypes=Episode` +
          `&Limit=${showsCount * 6}` +
          `&Fields=Overview,Genres,OfficialRating,CommunityRating,RunTimeTicks,DateCreated,SeriesName,SeasonName,IndexNumber,ParentIndexNumber,SeriesId` +
          `&EnableImageTypes=Primary,Backdrop`,
        { headers }
      );
      if (!showsResp.ok) throw new Error(`Shows fetch failed: HTTP ${showsResp.status}`);
      const showsRaw = await showsResp.json();
      const showsArr = Array.isArray(showsRaw) ? showsRaw : [];

      // Sort by DateCreated descending
      showsArr.sort(
        (a, b) =>
          (Date.parse(b.DateCreated) || 0) - (Date.parse(a.DateCreated) || 0)
      );

      // Deduplicate by SeriesName — keep only the most recent episode per show
      const seenShows = new Set();
      const uniqueShows = [];
      for (const item of showsArr) {
        const showName = item.SeriesName || item.Name;
        if (!seenShows.has(showName)) {
          seenShows.add(showName);
          uniqueShows.push(item);
        }
        if (uniqueShows.length >= showsCount) break;
      }

      // ── Map movies to display items ──────────────────────────────────────
      const movieItems = movies.map((item) => {
        const genres = Array.isArray(item.Genres) ? item.Genres.join(', ') : '';
        const subtitle = [
          item.ProductionYear,
          item.OfficialRating,
          genres,
        ]
          .filter(Boolean)
          .join(' · ');

        const rating = item.CommunityRating
          ? Math.round(item.CommunityRating * 10) / 10
          : null;
        const duration = item.RunTimeTicks
          ? Math.round(item.RunTimeTicks / 600000000)
          : null;
        const addedAt = item.DateCreated
          ? Date.parse(item.DateCreated) / 1000
          : 0;

        // Check if the item actually has a Backdrop image; fall back to Primary
        const hasBackdrop =
          Array.isArray(item.ImageTags)
            ? false // ImageTags is an object for items; check differently
            : item.BackdropImageTags && item.BackdropImageTags.length > 0;

        const artUrl = hasBackdrop
          ? this._backdropUrl(item.Id)
          : this._posterUrl(item.Id);

        const tmdbId = (item.ProviderIds?.Tmdb || item.ProviderIds?.tmdb || '').trim();
        const imdbId = (item.ProviderIds?.Imdb || item.ProviderIds?.imdb || '').trim();

        return {
          title: item.Name,
          subtitle,
          type: 'movie',
          typeLabel: 'Movie',
          rating,
          duration,
          summary: item.Overview || '',
          thumb: this._posterUrl(item.Id),
          art: artUrl,
          addedAt,
          tmdbId,
          imdbId,
          trailerUrl: null, // null = not yet fetched; '' = fetched but none found
        };
      });

      // ── Map TV episodes to display items ─────────────────────────────────
      const tvDisplayItems = uniqueShows.map((item) => {
        const season = item.ParentIndexNumber != null
          ? String(item.ParentIndexNumber).padStart(2, '0')
          : '??';
        const episode = item.IndexNumber != null
          ? String(item.IndexNumber).padStart(2, '0')
          : '??';
        const subtitle = `S${season}E${episode} · ${item.Name}`;

        const rating = item.CommunityRating
          ? Math.round(item.CommunityRating * 10) / 10
          : null;
        const duration = item.RunTimeTicks
          ? Math.round(item.RunTimeTicks / 600000000)
          : null;
        const addedAt = item.DateCreated
          ? Date.parse(item.DateCreated) / 1000
          : 0;

        // Use SeriesId for series-level images
        const seriesId = item.SeriesId || item.Id;

        // Check whether the series has a Backdrop image
        const hasSeriesBackdrop =
          item.ParentBackdropItemId != null ||
          (item.BackdropImageTags && item.BackdropImageTags.length > 0);

        const artUrl = hasSeriesBackdrop
          ? this._backdropUrl(seriesId)
          : this._posterUrl(seriesId);

        return {
          title: item.SeriesName || item.Name,
          subtitle,
          type: 'tv',
          typeLabel: 'TV Show',
          rating,
          duration,
          summary: item.Overview || '',
          thumb: this._posterUrl(seriesId),
          art: artUrl,
          addedAt,
          seriesId: item.SeriesId || null,
          seasonNumber: item.ParentIndexNumber || null,
          trailerUrl: null,
        };
      });

      // ── Interleave: movie, show, movie, show, … ──────────────────────────
      const interleaved = [];
      const maxLen = Math.max(movieItems.length, tvDisplayItems.length);
      for (let i = 0; i < maxLen; i++) {
        if (i < movieItems.length) interleaved.push(movieItems[i]);
        if (i < tvDisplayItems.length) interleaved.push(tvDisplayItems[i]);
      }

      this._items = interleaved;
      this._currentIndex = 0;
      this._updateDisplay();
      this._startCycle();
    } catch (err) {
      console.warn('Jellyfin Recently Added Card: Fetch error', err);
      const errEl = this.shadowRoot.querySelector('.error-msg');
      if (errEl) {
        errEl.textContent = `Could not connect to Jellyfin: ${err.message}`;
        errEl.style.display = 'block';
      }
    }
  }

  // ── Cycling ──────────────────────────────────────────────────────────────

  _startCycle() {
    if (this._cycleTimer) clearInterval(this._cycleTimer);
    if (this._items.length <= 1) return;

    this._cycleTimer = setInterval(() => {
      this._currentIndex = (this._currentIndex + 1) % this._items.length;
      this._updateDisplay();
    }, this._config.cycle_interval * 1000);
  }

  // ── Display update ───────────────────────────────────────────────────────

  _updateDisplay() {
    if (!this._items.length) return;
    const item = this._items[this._currentIndex];
    const root = this.shadowRoot;

    // Background art — crossfade transition
    const bgEl = root.querySelector('.bg-art');
    const bgNew = root.querySelector('.bg-art-next');
    if (bgNew) {
      const artSrc = item.art || item.thumb;
      if (artSrc) {
        bgNew.style.backgroundImage = `url(${artSrc})`;
      }
      bgNew.classList.add('active');
      setTimeout(() => {
        if (bgEl && artSrc) bgEl.style.backgroundImage = `url(${artSrc})`;
        bgNew.classList.remove('active');
      }, 800);
    }

    // Poster — fade in after image loads
    const posterEl = root.querySelector('.poster');
    if (posterEl && item.thumb) {
      posterEl.style.opacity = '0';
      const img = new Image();
      img.onload = () => {
        posterEl.src = img.src;
        posterEl.style.opacity = '1';
      };
      img.onerror = () => {
        // If poster fails, keep faded — don't break layout
        posterEl.style.opacity = '0.3';
      };
      img.src = item.thumb;
    }

    // Text elements
    const titleEl = root.querySelector('.item-title');
    const subtitleEl = root.querySelector('.item-subtitle');
    const typeEl = root.querySelector('.item-type');
    const ratingEl = root.querySelector('.item-rating');
    const summaryEl = root.querySelector('.item-summary');
    const dotsEl = root.querySelector('.dots');
    const counterEl = root.querySelector('.counter');

    if (titleEl) titleEl.textContent = item.title;
    if (subtitleEl) subtitleEl.textContent = item.subtitle;
    if (typeEl) {
      typeEl.textContent = item.typeLabel;
      typeEl.className = `item-type ${item.type}`;
    }
    if (ratingEl) {
      if (item.rating != null) {
        ratingEl.textContent = `★ ${item.rating}`;
        ratingEl.style.display = 'inline-block';
      } else {
        ratingEl.style.display = 'none';
      }
    }
    if (summaryEl) {
      summaryEl.textContent = item.summary;
    }

    // Dots — gold for movies, Jellyfin blue for TV
    if (dotsEl) {
      dotsEl.innerHTML = this._items
        .map((it, i) => {
          const colorClass = it.type === 'movie' ? 'movie' : 'tv';
          const activeClass = i === this._currentIndex ? 'active' : '';
          return `<span class="dot ${colorClass} ${activeClass}"></span>`;
        })
        .join('');
    }

    // Counter
    if (counterEl) {
      counterEl.textContent = `${this._currentIndex + 1} / ${this._items.length}`;
    }

    // Trailer button — show for movies and TV shows; lazy-fetch trailer URL
    const trailerBtn = root.querySelector('.trailer-btn');
    if (trailerBtn) {
      trailerBtn.classList.remove('visible');
      trailerBtn.onclick = null;

      const showTrailerBtn = (url) => {
        if (url && this._items[this._currentIndex] === item) {
          trailerBtn.classList.add('visible');
          trailerBtn.onclick = (e) => { e.stopPropagation(); this._playTrailer(url); };
        }
      };

      if (item.trailerUrl) {
        showTrailerBtn(item.trailerUrl);
      } else if (item.trailerUrl === null) {
        // Not yet fetched — determine fetch method
        let fetchPromise;
        if (item.type === 'movie' && (item.tmdbId || item.imdbId)) {
          fetchPromise = this._fetchTrailer(item.tmdbId, item.imdbId);
        } else if (item.type === 'tv' && item.seriesId) {
          fetchPromise = this._fetchTvTrailer(item.seriesId, item.seasonNumber);
        }
        if (fetchPromise) {
          fetchPromise.then((url) => {
            item.trailerUrl = url || undefined;
            showTrailerBtn(url);
          });
        }
      }
    }

    // Time ago
    const timeEl = root.querySelector('.time-ago');
    if (timeEl && item.addedAt) {
      const now = Date.now() / 1000;
      const diff = now - item.addedAt;
      let timeStr;
      if (diff < 3600) timeStr = `${Math.round(diff / 60)}m ago`;
      else if (diff < 86400) timeStr = `${Math.round(diff / 3600)}h ago`;
      else timeStr = `${Math.round(diff / 86400)}d ago`;
      timeEl.textContent = timeStr;
    }
  }

  // ── Trailer helpers ────────────────────────────────────────────────────────

  async _fetchTvTrailer(seriesId, seasonNumber) {
    const cacheKey = `tv_${seriesId}_${seasonNumber}`;
    if (cacheKey in this._trailerCache) return this._trailerCache[cacheKey];
    if (!this._config.tmdb_api_key) return null;

    const tmdbToken = this._config.tmdb_api_key;
    const tmdbHeaders = {
      Authorization: `Bearer ${tmdbToken}`,
      Accept: 'application/json',
    };

    try {
      const base = this._config.jellyfin_url.replace(/\/$/, '');
      const key = this._config.api_key;
      const userId = await this._resolveUserId();

      // Step 1: Fetch series metadata from Jellyfin to get TMDB ID
      const seriesResp = await fetch(
        `${base}/Users/${userId}/Items/${seriesId}?Fields=ProviderIds&api_key=${key}`,
        { headers: { Accept: 'application/json' } }
      );
      if (!seriesResp.ok) throw new Error(`Jellyfin series metadata HTTP ${seriesResp.status}`);
      const seriesData = await seriesResp.json();
      const tmdbId = (seriesData.ProviderIds?.Tmdb || seriesData.ProviderIds?.tmdb || '').trim();
      if (!tmdbId) {
        this._trailerCache[cacheKey] = null;
        return null;
      }

      // Step 2: Try season-specific trailer first
      let youtubeUrl = null;
      if (seasonNumber) {
        try {
          const seasonResp = await fetch(
            `https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNumber}/videos?language=en-US`,
            { headers: tmdbHeaders }
          );
          if (seasonResp.ok) {
            const seasonVidData = await seasonResp.json();
            const vids = seasonVidData.results || [];
            const trailer = vids.find(v => v.type === 'Trailer' && v.site === 'YouTube' && v.official) ||
                            vids.find(v => v.type === 'Trailer' && v.site === 'YouTube') ||
                            vids.find(v => v.site === 'YouTube');
            if (trailer) youtubeUrl = `https://www.youtube.com/watch?v=${trailer.key}`;
          }
        } catch (e) { /* fall through to series-level */ }
      }

      // Step 3: Fall back to series-level trailer
      if (!youtubeUrl) {
        const seriesVidResp = await fetch(
          `https://api.themoviedb.org/3/tv/${tmdbId}/videos?language=en-US`,
          { headers: tmdbHeaders }
        );
        if (seriesVidResp.ok) {
          const seriesVidData = await seriesVidResp.json();
          const vids = seriesVidData.results || [];
          const trailer = vids.find(v => v.type === 'Trailer' && v.site === 'YouTube' && v.official) ||
                          vids.find(v => v.type === 'Trailer' && v.site === 'YouTube') ||
                          vids.find(v => v.site === 'YouTube');
          if (trailer) youtubeUrl = `https://www.youtube.com/watch?v=${trailer.key}`;
        }
      }

      this._trailerCache[cacheKey] = youtubeUrl;
      return youtubeUrl;
    } catch (err) {
      console.warn('Jellyfin Recently Added Card: TV trailer fetch error', err);
      this._trailerCache[cacheKey] = null;
      return null;
    }
  }

  async _fetchTrailer(tmdbId, imdbId) {
    if (!this._config.tmdb_api_key) return null;

    // Resolve TMDB ID from IMDB ID if needed
    let resolvedTmdbId = tmdbId;
    if (!resolvedTmdbId && imdbId) {
      const cacheKey = `imdb:${imdbId}`;
      if (cacheKey in this._trailerCache) return this._trailerCache[cacheKey];
      try {
        const findResp = await fetch(
          `https://api.themoviedb.org/3/find/${imdbId}?external_source=imdb_id`,
          {
            headers: {
              Authorization: `Bearer ${this._config.tmdb_api_key}`,
              Accept: 'application/json',
            },
          }
        );
        if (findResp.ok) {
          const findData = await findResp.json();
          const movieResult = findData.movie_results && findData.movie_results[0];
          if (movieResult) resolvedTmdbId = String(movieResult.id);
        }
      } catch (e) {
        console.warn('Jellyfin Card: TMDB find lookup failed', e);
      }
      if (!resolvedTmdbId) {
        this._trailerCache[cacheKey] = null;
        return null;
      }
    }

    if (!resolvedTmdbId) return null;

    const cacheKey = `tmdb:${resolvedTmdbId}`;
    if (cacheKey in this._trailerCache) return this._trailerCache[cacheKey];

    try {
      const resp = await fetch(
        `https://api.themoviedb.org/3/movie/${resolvedTmdbId}/videos?language=en-US`,
        {
          headers: {
            Authorization: `Bearer ${this._config.tmdb_api_key}`,
            Accept: 'application/json',
          },
        }
      );
      if (!resp.ok) {
        this._trailerCache[cacheKey] = null;
        return null;
      }
      const data = await resp.json();
      const videos = Array.isArray(data.results) ? data.results : [];

      // Prefer: official YouTube trailer > any YouTube trailer > any YouTube video
      const youtubeVideos = videos.filter((v) => v.site === 'YouTube');
      const officialTrailer = youtubeVideos.find(
        (v) => v.type === 'Trailer' && v.official
      );
      const anyTrailer = youtubeVideos.find((v) => v.type === 'Trailer');
      const anyYoutube = youtubeVideos[0];

      const best = officialTrailer || anyTrailer || anyYoutube || null;
      const url = best ? `https://www.youtube.com/watch?v=${best.key}` : null;

      this._trailerCache[cacheKey] = url;
      // Also cache under the imdb key to avoid double-lookups
      if (imdbId && !tmdbId) {
        this._trailerCache[`imdb:${imdbId}`] = url;
      }
      return url;
    } catch (e) {
      console.warn('Jellyfin Card: TMDB videos fetch failed', e);
      this._trailerCache[cacheKey] = null;
      return null;
    }
  }

  _getYouTubeId(url) {
    if (!url) return null;
    const match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([-\w]{11})/);
    return match ? match[1] : null;
  }

  _playTrailer(url) {
    const ytId = this._getYouTubeId(url);
    if (!ytId) return;

    // Pause cycling
    if (this._cycleTimer) {
      clearInterval(this._cycleTimer);
      this._cycleTimer = null;
    }

    // Create fullscreen overlay on document.body
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.92);z-index:99999;display:flex;align-items:center;justify-content:center;cursor:pointer;';

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:relative;width:90vw;max-width:960px;aspect-ratio:16/9;background:#000;border-radius:8px;overflow:hidden;';

    const playerDiv = document.createElement('div');
    playerDiv.id = 'yt-trailer-player-' + Date.now();
    playerDiv.style.cssText = 'width:100%;height:100%;';
    wrapper.appendChild(playerDiv);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'position:absolute;top:8px;right:8px;width:36px;height:36px;border-radius:50%;background:rgba(0,0,0,0.7);border:1px solid rgba(255,255,255,0.3);color:#fff;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:100001;';
    wrapper.appendChild(closeBtn);

    overlay.appendChild(wrapper);
    document.body.appendChild(overlay);

    const self = this;
    const close = () => {
      if (self._ytPlayer) { try { self._ytPlayer.destroy(); } catch(e) {} self._ytPlayer = null; }
      overlay.remove();
      self._startCycle();
    };
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); close(); });
    overlay.addEventListener('click', close);
    wrapper.addEventListener('click', (e) => e.stopPropagation());

    // Load YouTube IFrame API and create player
    const initPlayer = () => {
      self._ytPlayer = new YT.Player(playerDiv.id, {
        width: '100%',
        height: '100%',
        videoId: ytId,
        playerVars: {
          autoplay: 1,
          controls: 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          enablejsapi: 1,
          origin: window.location.origin
        }
      });
    };

    if (window.YT && window.YT.Player) {
      initPlayer();
    } else {
      // Load the YouTube IFrame API script
      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);
      }
      const check = setInterval(() => {
        if (window.YT && window.YT.Player) {
          clearInterval(check);
          initPlayer();
        }
      }, 100);
      setTimeout(() => clearInterval(check), 10000);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  _render() {
    const title = this._config.title;

    // Official Jellyfin logo — nested triangles with brand gradient
    const jellyfinLogo = `
      <svg class="jellyfin-logo" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512" aria-label="Jellyfin">
        <defs>
          <linearGradient id="jf-grad" gradientUnits="userSpaceOnUse" x1="126" y1="219" x2="458" y2="411">
            <stop offset="0%" stop-color="#aa5cc3"/><stop offset="100%" stop-color="#00a4dc"/>
          </linearGradient>
        </defs>
        <path fill="url(#jf-grad)" d="M190.56 329.07c8.63 17.3 122.4 17.12 130.93 0 8.52-17.1-47.9-119.78-65.46-119.8-17.57 0-74.1 102.5-65.47 119.8z"/>
        <path fill="url(#jf-grad)" d="M58.75 417.03c25.97 52.15 368.86 51.55 394.55 0S308.93 56.08 256.03 56.08c-52.92 0-223.25 308.8-197.28 360.95zm68.04-45.25c-17.02-34.17 94.6-236.5 129.26-236.5 34.67 0 146.1 202.7 129.26 236.5-16.83 33.8-241.5 34.17-258.52 0z"/>
      </svg>`;

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          height: 100%;
          --card-bg: #1a1a1a;
          --card-border: rgba(255,255,255,0.06);
          --text-primary: #f0f0f0;
          --text-secondary: #999;
          --text-dim: #666;
          --accent-gold: #c9a73b;
          --accent-movie: #c9a73b;
          --accent-tv: #00A4DC;
        }

        ha-card {
          height: 100%;
          box-sizing: border-box;
          position: relative;
          background: var(--card-bg) !important;
          border-radius: 12px;
          overflow: hidden;
          border: 1px solid var(--card-border) !important;
        }

        :host(.fixed-height) {
          height: auto;
        }

        :host(.fixed-height) ha-card {
          height: auto;
          min-height: 300px;
        }

        :host(.fixed-height) .card {
          position: relative;
          min-height: 300px;
        }

        :host(.fixed-height) .content {
          min-height: 300px;
        }

        .card {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: var(--card-bg);
          overflow: hidden;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }

        /* Background art with blur */
        .bg-art, .bg-art-next {
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background-size: cover;
          background-position: center;
          filter: blur(20px) brightness(0.3);
          transform: scale(1.1);
          transition: opacity 0.8s ease;
        }
        .bg-art-next {
          opacity: 0;
        }
        .bg-art-next.active {
          opacity: 1;
        }

        /* Dark overlay */
        .bg-overlay {
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background: linear-gradient(
            135deg,
            rgba(0,0,0,0.7) 0%,
            rgba(0,0,0,0.4) 50%,
            rgba(0,0,0,0.7) 100%
          );
        }

        /* Content */
        .content {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 1;
          padding: 20px;
          display: flex;
          flex-direction: column;
        }

        /* Header */
        .header {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 14px;
        }

        .header-title {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 15px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-secondary);
        }

        .jellyfin-logo {
          width: 20px;
          height: 20px;
          flex-shrink: 0;
          display: inline-block;
          vertical-align: middle;
        }

        .counter {
          font-size: 13px;
          color: var(--text-dim);
          font-variant-numeric: tabular-nums;
        }

        /* Main area */
        .main {
          display: flex;
          gap: 20px;
          flex: 1;
          min-height: 0;
        }

        /* Poster */
        .poster-wrap {
          flex-shrink: 0;
          width: auto;
          aspect-ratio: 2/3;
          height: 100%;
          border-radius: 6px;
          overflow: hidden;
          box-shadow: 0 4px 20px rgba(0,0,0,0.5);
          background: #111;
          position: relative;
        }

        .poster {
          width: 100%;
          height: 100%;
          object-fit: cover;
          transition: opacity 0.5s ease;
        }

        .poster-shimmer {
          position: absolute;
          inset: 0;
          background: linear-gradient(
            90deg,
            transparent 0%,
            rgba(255,255,255,0.03) 50%,
            transparent 100%
          );
          animation: shimmer 2s infinite;
        }

        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }

        /* Info */
        .info {
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
          min-width: 0;
          gap: 8px;
        }

        .item-type {
          display: inline-block;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          padding: 5px 12px;
          border-radius: 3px;
          width: fit-content;
        }

        .item-type.movie {
          background: rgba(201, 167, 59, 0.15);
          color: var(--accent-movie);
        }

        .item-type.tv {
          background: rgba(0, 164, 220, 0.15);
          color: var(--accent-tv);
        }

        .item-title {
          font-size: 28px;
          font-weight: 700;
          color: var(--text-primary);
          line-height: 1.2;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }

        .item-subtitle {
          font-size: 17px;
          color: var(--text-secondary);
          line-height: 1.3;
        }

        .meta-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .item-rating {
          font-size: 16px;
          font-weight: 600;
          color: var(--accent-gold);
        }

        .time-ago {
          font-size: 15px;
          color: var(--text-dim);
        }

        .item-summary {
          font-size: 16px;
          color: var(--text-dim);
          line-height: 1.5;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 6;
          -webkit-box-orient: vertical;
          margin-top: 2px;
        }

        /* Dots — color-coded */
        .dots {
          display: flex;
          justify-content: center;
          gap: 6px;
          padding-top: 16px;
          flex-shrink: 0;
        }

        .dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: rgba(255,255,255,0.15);
          transition: all 0.3s ease;
        }

        .dot.movie {
          background: rgba(201, 167, 59, 0.25);
        }

        .dot.tv {
          background: rgba(0, 164, 220, 0.25);
        }

        .dot.active.movie {
          background: var(--accent-movie);
          box-shadow: 0 0 6px rgba(201, 167, 59, 0.4);
          width: 18px;
          border-radius: 3px;
        }

        .dot.active.tv {
          background: var(--accent-tv);
          box-shadow: 0 0 6px rgba(0, 164, 220, 0.4);
          width: 18px;
          border-radius: 3px;
        }

        /* Trailer button */
        .trailer-btn {
          display: none;
          align-items: center;
          justify-content: center;
          gap: 6px;
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.2);
          color: #ddd;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          padding: 8px 16px;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s ease;
          min-width: 100px;
          min-height: 38px;
        }

        .trailer-btn:hover {
          background: rgba(255, 255, 255, 0.2);
          color: #fff;
        }

        .trailer-btn.visible {
          display: inline-flex;
        }

        .trailer-btn svg {
          width: 16px;
          height: 16px;
          fill: currentColor;
        }

        /* Trailer embed container */
        .trailer-container {
          display: none;
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 10;
          background: #000;
          align-items: center;
          justify-content: center;
        }

        .trailer-container.active {
          display: flex;
        }

        .trailer-container iframe {
          width: 100%;
          height: 100%;
          border: none;
        }

        .trailer-close {
          position: absolute;
          top: 8px;
          right: 8px;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: rgba(0, 0, 0, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.3);
          color: #fff;
          font-size: 18px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 11;
          transition: background 0.2s;
        }

        .trailer-close:hover {
          background: rgba(255, 255, 255, 0.2);
        }

        /* Error */
        .error-msg {
          display: none;
          text-align: center;
          padding: 20px;
          color: #cc4444;
          font-size: 12px;
        }

        /* Loading */
        .loading {
          text-align: center;
          padding: 40px 20px;
          color: var(--text-dim);
          font-size: 12px;
        }
      </style>

      <ha-card>
        <div class="card">
          <div class="bg-art"></div>
          <div class="bg-art-next"></div>
          <div class="bg-overlay"></div>

          <div class="trailer-container" id="trailerContainer">
            <button class="trailer-close" id="trailerClose">✕</button>
            <iframe id="trailerFrame" allow="autoplay; encrypted-media" allowfullscreen></iframe>
          </div>

          <div class="content">
            ${title ? `
            <div class="header">
              <span class="header-title">
                ${jellyfinLogo}
                ${title}
              </span>
              <button class="trailer-btn" id="trailerBtn">
                <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                Trailer
              </button>
              <span class="counter"></span>
            </div>
            ` : ''}

            <div class="error-msg"></div>

            <div class="main">
              <div class="poster-wrap">
                <img class="poster" src="" alt="">
                <div class="poster-shimmer"></div>
              </div>
              <div class="info">
                <span class="item-type"></span>
                <div class="item-title">Loading...</div>
                <div class="item-subtitle"></div>
                <div class="meta-row">
                  <span class="item-rating"></span>
                  <span class="time-ago"></span>
                </div>
                <div class="item-summary"></div>
              </div>
            </div>

            <div class="dots"></div>
          </div>
        </div>
      </ha-card>
    `;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  getCardSize() {
    return 4;
  }

  static getStubConfig() {
    return {
      jellyfin_url: 'http://192.168.1.100:8096',
      api_key: 'YOUR_JELLYFIN_API_KEY',
      // user_id: 'YOUR_USER_ID',  // optional — auto-detected from first user
      movies_count: 5,
      shows_count: 5,
      cycle_interval: 8,
      title: 'Recently Added',
      fill_height: true,
    };
  }

  static getConfigForm() {
    return {
      schema: [
        {
          name: 'jellyfin_url',
          required: true,
          selector: { text: {} },
        },
        {
          name: 'api_key',
          required: true,
          selector: { text: { type: 'password' } },
        },
        {
          name: 'user_id',
          selector: { text: {} },
        },
        {
          type: 'grid',
          name: '',
          schema: [
            {
              name: 'movies_count',
              selector: { number: { min: 1, max: 20, mode: 'box' } },
            },
            {
              name: 'shows_count',
              selector: { number: { min: 1, max: 20, mode: 'box' } },
            },
          ],
        },
        {
          type: 'grid',
          name: '',
          schema: [
            {
              name: 'cycle_interval',
              selector: { number: { min: 3, max: 60, mode: 'box', unit_of_measurement: 'seconds' } },
            },
            {
              name: 'title',
              selector: { text: {} },
            },
          ],
        },
        {
          name: 'tmdb_api_key',
          selector: { text: { type: 'password' } },
        },
        {
          name: 'fill_height',
          selector: { boolean: {} },
        },
      ],
      computeLabel: (schema) => {
        const labels = {
          jellyfin_url: 'Jellyfin Server URL',
          api_key: 'API Key',
          user_id: 'User ID',
          movies_count: 'Number of Movies',
          shows_count: 'Number of TV Shows',
          cycle_interval: 'Cycle Interval',
          title: 'Card Title',
          tmdb_api_key: 'TMDB API Key (for trailers)',
          fill_height: 'Fill Container Height',
        };
        return labels[schema.name] || schema.name;
      },
      computeHelper: (schema) => {
        const helpers = {
          jellyfin_url: 'e.g. http://192.168.1.100:8096',
          api_key: 'Jellyfin Dashboard → API Keys',
          user_id: 'Optional — auto-detected if left blank',
          tmdb_api_key: 'Optional — enables trailer button. Get a free key at themoviedb.org',
          fill_height: 'Enable if your card has proper height. Disable if the card appears collapsed/too short.',
        };
        return helpers[schema.name] || undefined;
      },
    };
  }

  disconnectedCallback() {
    if (this._cycleTimer) {
      clearInterval(this._cycleTimer);
      this._cycleTimer = null;
    }
  }
}

customElements.define('jellyfin-recently-added-card', JellyfinRecentlyAddedCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'jellyfin-recently-added-card',
  name: 'Jellyfin Recently Added',
  description: 'Auto-cycling display of recently added Jellyfin media — movies and TV shows.',
});
