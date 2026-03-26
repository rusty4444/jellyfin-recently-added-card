# Jellyfin Recently Added Card

A custom Home Assistant Lovelace card that shows your recently added movies and TV shows from Jellyfin. Auto-cycles through items with poster art, blurred background, synopsis, ratings, and color-coded indicators.

[![HACS](https://img.shields.io/badge/HACS-Custom-blue)](https://github.com/hacs/integration)
![Platform](https://img.shields.io/badge/Platform-Home_Assistant-blue)

<p align="center">
  <img src="screenshots/recently-added.jpg" alt="Jellyfin Recently Added Card" width="600">
</p>

## Features

- Displays the 5 most recently added movies and 5 most recently added TV shows from Jellyfin
- Interleaved cycling — alternates between movies and TV shows
- Poster art with blurred background transitions
- Synopsis, ratings, genre, and "time ago" for each item
- Color-coded dots — gold for movies, blue for TV shows
- Connects directly to your Jellyfin server via its API
- Deduplicates TV shows — only shows the most recent entry per series
- **Trailers** — tap the trailer button on movies and TV shows to watch YouTube trailers (requires a free TMDB API key)

---

## Install via HACS (Recommended)

1. Open **HACS** in Home Assistant
2. Click the three dots (top right) → **Custom repositories**
3. Enter `https://github.com/rusty4444/jellyfin-recently-added-card` and select **Dashboard** as the category
4. Click **Add**
5. Search for "Jellyfin Recently Added Card" in HACS and click **Install**
6. Restart Home Assistant

The Lovelace resource will be registered automatically.

## Install Manually

1. Download `jellyfin-recently-added-card.js` from the [latest release](https://github.com/rusty4444/jellyfin-recently-added-card/releases/latest)
2. Place it in your `<config>/www/` directory
3. Go to **Settings → Dashboards** → three dots (top right) → **Resources**
4. Click **Add Resource**
5. URL: `/local/jellyfin-recently-added-card.js`
6. Type: **JavaScript Module**

---

## Configuration

Add a **Manual card** to your dashboard with this YAML:

```yaml
type: custom:jellyfin-recently-added-card
jellyfin_url: http://YOUR_JELLYFIN_IP:8096
api_key: YOUR_JELLYFIN_API_KEY
user_id: YOUR_JELLYFIN_USER_ID
movies_count: 5
shows_count: 5
cycle_interval: 8
title: Recently Added
tmdb_api_key: YOUR_TMDB_READ_ACCESS_TOKEN  # Optional: enables trailer button for movies
```

For best results, set the card to span the full width of a section and give it plenty of vertical space (e.g., 8+ grid rows).

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `jellyfin_url` | string | **Required** | Your Jellyfin server URL (e.g., `http://192.168.1.100:8096`) |
| `api_key` | string | **Required** | Your Jellyfin API key (see below) |
| `user_id` | string | optional | Your Jellyfin user ID (see below — leave blank to auto-detect the first user) |
| `movies_count` | number | `5` | Number of recently added movies to display |
| `shows_count` | number | `5` | Number of recently added TV shows to display |
| `cycle_interval` | number | `8` | Seconds between cycling to the next item |
| `title` | string | `"Recently Added"` | Header text (set to empty string to hide) |
| `tmdb_api_key` | string | Empty (trailers disabled) | TMDB Read Access Token — enables the trailer button on movies |

---

## How to Get Your Jellyfin API Key

1. Open the Jellyfin web interface and log in as an administrator
2. Go to **Dashboard** → **API Keys**
3. Click **+** to create a new API key
4. Give it a name (e.g., "Home Assistant Card") and click **OK**
5. Copy the generated key and use it as `api_key` in your card config

---

## How to Find Your User ID

**Option A — From the Jellyfin dashboard:**
1. Go to **Dashboard** → **Users**
2. Click on your user
3. The user ID is the long string at the end of the URL (e.g., `.../Users/abc123def456...`)

**Option B — Auto-detect:**
Leave `user_id` blank in your card config and the card will automatically use the first user returned by your Jellyfin server.

---

## How It Works

- Connects directly to the Jellyfin API using your server URL and API key
- Fetches recently added movies and TV episodes from your Jellyfin library
- Deduplicates TV shows so you only see one entry per series (the most recent)
- Interleaves movies and shows for variety (movie, show, movie, show...)
- Pre-loads poster and background art for smooth transitions

---

## Trailers

Tap the **Trailer** button on any movie or TV show to watch its YouTube trailer. This feature requires a free TMDB (The Movie Database) API key.

For **movies**, the card looks up the movie trailer directly from TMDB.

For **TV shows**, the card tries to find the best available trailer in this order:
1. Season-specific trailer (e.g., the Season 2 trailer)
2. Series trailer (the main show trailer)
3. If no trailer is found on TMDB, the button is hidden for that item

The card uses Jellyfin's `ProviderIds` (TMDB and IMDB IDs included in each item's metadata) to look up trailers via the TMDB API.

### How to get a TMDB Read Access Token

1. Create a free account at [themoviedb.org](https://www.themoviedb.org/signup)
2. Go to [Settings → API](https://www.themoviedb.org/settings/api)
3. Request an API key (select "Developer" and fill in basic info — any values work for personal use)
4. Once approved, copy the **Read Access Token** (the long string starting with `eyJ...`) — not the shorter API Key
5. Add it to your card config as `tmdb_api_key`

The card uses TMDB to look up movie trailers by matching the media's TMDB ID. Trailer results are cached so each movie is only looked up once.

---

## Troubleshooting

- **Card not appearing after install**: Clear your browser cache, or append `?v=2` to the resource URL in Settings → Dashboards → Resources
- **No items showing**: Double-check your `jellyfin_url` and `api_key`. Make sure the Jellyfin server is reachable from the device viewing the dashboard and that the API key is valid.
- **CORS errors in browser console**: Jellyfin must be reachable from the same network as the device viewing the dashboard. Ensure the port (default 8096) is not blocked by a firewall.
- **Wrong user's library showing**: Set `user_id` explicitly to your own user ID instead of relying on auto-detection.

---

## Related

- [jellyfin-now-showing](https://github.com/rusty4444/jellyfin-now-showing) — a cinema-style "Now Showing" marquee display for Jellyfin playback
- [plex-recently-added-card](https://github.com/rusty4444/plex-recently-added-card) — the Plex version of this project
- [kodi-recently-added-card](https://github.com/rusty4444/kodi-recently-added-card) — the Kodi version of this project
- [emby-recently-added-card](https://github.com/rusty4444/emby-recently-added-card) / [emby-now-showing](https://github.com/rusty4444/emby-now-showing) — Emby versions

---

## Credits

Built by Sam Russell — AI used in development.

YouTube trailer embedding approach adapted from [ha-youtubevideocard](https://github.com/loryanstrant/ha-youtubevideocard) by [loryanstrant](https://github.com/loryanstrant).
