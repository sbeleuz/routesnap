# RouteSnap

<div align="center">

**Download cycling routes as GPX files with one click** 🚴📍

A modern, lightweight Chrome extension that captures route data directly from
supported sites and exports complete tracks in GPX 1.1 format.

Designed to make adding further sites straightforward.

</div>

---

## Why?

Many cycling route sites host thousands of curated routes but **offer no built-in GPX export**.
RouteSnap fills that gap in seconds — no API keys, no complex setup, just click and download.

**Perfect for:**

- Importing routes into Garmin, Strava, Komoot, or any GPS app
- Offline navigation and route planning
- Backing up your favorite routes

> **Using Python?** See [scripts/README.md](./scripts/README.md) for the command-line tool.

---

## ✨ Features

- 🎯 **One-Click Download** — Open the popup on any supported route page and hit Download
- 📍 **Complete Data** — Preserves coordinates, elevation, and route title
- ⚡ **Passive Capture** — Intercepts requests the page already makes; no extra network calls, no auth tokens
- 🔒 **Privacy First** — Zero tracking, zero data collection, all processing is local
- 📦 **Lightweight** — No runtime dependencies, pure browser APIs
- 🔄 **Smart Naming** — Files auto-named from the route title
- 🌍 **Broad Browser Support** — Chrome 92+, Edge, Brave, Opera

---

## 🚀 Quick Start

### Installation

1. **Clone and navigate:**

   ```bash
   git clone https://github.com/sbeleuz/routesnap.git
   cd routesnap
   ```

2. **Build the extension:**

   ```bash
   npm install
   npm run build
   ```

   This creates the `dist/` folder with all extension files ready to load.

3. **Load into Chrome:**
   - Open `chrome://extensions/`
   - Enable **Developer mode** (toggle, top-right)
   - Click **Load unpacked**
   - Select the `dist/` folder → done ✓

4. **Use it:**
   - Visit any supported route page
   - Click the extension icon in the toolbar
   - Wait for route data to be captured, then click **Download GPX**
   - The GPX file saves to your Downloads folder

---

## 🔍 How It Works

### Data Flow

```
┌──────────────────────────────────────────────────────────────┐
│  Browser tab — site SPA                                      │
│                                                              │
│  adapters/interceptor-base.js      (MAIN world, shared)      │
│  adapters/<site>/interceptor.js    (MAIN world, site config) │
│  └─ wraps window.fetch before the page boots                 │
│     matches responses against site-defined URL rules         │
│     posts { site, dataType, data } via window.postMessage    │
└────────────────────────┬─────────────────────────────────────┘
                         │ window.postMessage
                         ▼
┌────────────────────────────────────────────────────────────────┐
│  content/index.js  (isolated world)                            │
│  Generic bridge — validates message envelope,                  │
│  forwards payload to background via chrome.runtime.sendMessage │
└────────────────────────┬───────────────────────────────────────┘
                         │ chrome.runtime.sendMessage
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  background/index.js  (service worker)                       │
│                                                              │
│  storeRouteData:                                             │
│   └─ looks up ADAPTERS[site].validate() → rejects bad data   │
│      writes to chrome.storage.session keyed by tabId         │
│                                                              │
│  downloadGPX (triggered by popup):                           │
│   └─ ADAPTERS[site].extractTitle()    → human-readable name  │
│      ADAPTERS[site].extractSegments() → [[lon,lat,ele], …]   │
│      background/gpx.js buildGpxDocument() → GPX XML string   │
│      chrome.downloads.download()      → file in Downloads/   │
└──────────────────────────────────────────────────────────────┘
```

### MAIN world vs isolated world

Chrome MV3 extensions can inject scripts into two worlds:

- **MAIN world** (`adapters/interceptor-base.js` + `adapters/<site>/interceptor.js`) — shares
  `window` with the page, so it can wrap `window.fetch` before the SPA boots. The page's
  Content-Security-Policy does _not_ block it. The shared base provides all the fetch-wrapping
  machinery; each site's interceptor supplies only its URL rules.
- **Isolated world** (`content/index.js`) — can call `chrome.runtime` APIs that are unavailable
  in the MAIN world. Acts as a secure relay between the page and the background worker.

### The interceptor base

`adapters/interceptor-base.js` exposes `window.__routeExtractorBase(config)`. It handles
everything that is the same across all sites:

- Wrapping `window.fetch` (with a bfcache-safe guard against double-installation)
- Skipping non-OK responses
- Cloning the response body so the page still receives the original
- Parsing JSON and posting `{ site, dataType, data }` via `window.postMessage`

Each site's interceptor only declares a `rules` array — an ordered list of
`{ predicate(url), dataType }` pairs. The first matching rule wins. The raw JSON blob
is forwarded as-is; no site-specific logic lives in the interceptor layer.

### The adapter builder

All site-specific knowledge about *what the captured data means* lives in
`adapters/<site>/builder.js`. This is where field names, coordinate order, response
shapes, and multi-response merging are handled — completely isolated from the capture
pipeline.

Every builder must satisfy the `AdapterBuilder` interface defined in
`adapters/adapter-interface.js`. The interface is enforced in two complementary ways:

- **At authoring time** — each builder declares `@implements {AdapterBuilder}` in its
  module header and annotates each export with the matching `@type` tag, giving editors
  precise hover-documentation and signature checking.
- **At runtime** — `assertAdapterContract(site, adapter)` is called for every entry in
  the background's `ADAPTERS` map when the service worker starts. If a method is missing
  or exported under the wrong name, a descriptive error is thrown immediately — before
  any user interaction — rather than surfacing as a cryptic `TypeError` deep inside the
  download flow.

### Session storage

Captured data is written to `chrome.storage.session` (keyed by tab ID) immediately on
capture, not on demand. This means the GPX download works even if the service worker was
killed between capture and the user clicking the button — a common occurrence in MV3 where
workers are terminated after ~30 seconds of inactivity.

---

## ➕ Adding a New Site

Adding support for a new site requires touching **four files** and creating **two new
files**. No changes to the generic core are ever needed.

### Step 1 — Create the MAIN-world interceptor

Create `src/adapters/<site>/interceptor.js`. It only needs to call the shared base with
site-specific URL rules:

Each rule maps a URL predicate to a `dataType` string. Rules are evaluated in order;
a URL matches at most one rule. The `dataType` strings are opaque keys — choose whatever
makes sense for the site, as long as they match what `builder.js` expects.

### Step 2 — Create the builder (ES module)

Create `src/adapters/<site>/builder.js` implementing the `AdapterBuilder` interface
(`adapters/adapter-interface.js`). The module must export exactly these four functions:

| Export            | Signature                                    | Purpose                                                                                                                                             |
| ----------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validate`        | `(dataType, data) → string \| null`          | Returns an error string if data is structurally invalid, `null` if OK. Called before writing to session storage.                                    |
| `hasData`         | `(stored) → boolean`                         | Returns `true` when enough data has been captured for a GPX download. Used by the popup status check.                                               |
| `extractTitle`    | `(stored, routeId) → string`                 | Resolves the best human-readable route title with graceful fallbacks.                                                                               |
| `extractSegments` | `(stored) → Array<Array<[lon, lat, ele?]>>`  | Converts the site's data shape into the generic segment format consumed by `gpx.js`. Throws with a user-friendly message if data is not yet ready.  |

The `stored` object is the raw session-storage entry for the tab — it has a `site` field
plus one field per `dataType` captured by the interceptor (e.g. `stored.track`,
`stored.route`). The builder can merge, transform, or re-shape this data however it needs
to — the capture pipeline never looks inside the blobs.

Declare the implementation in the module header and annotate each export with its
matching callback type.

### Step 3 — Register the adapter in the background

Open `src/background/index.js`, import the new builder and add it to the `ADAPTERS` map
wrapped in `assertAdapterContract`. This validates the four required exports at
service-worker startup so a missing method is caught immediately rather than at download
time.

### Step 4 — Register the site in the popup

Open `src/popup/sites.js` and append an entry to the `SITES` array.

### Step 5 — Update the manifest

Open `public/manifest.json` and add:

1. **`host_permissions`** for the new site's domains.
2. **Two `content_scripts` entries** for the new site's URL pattern — one for the MAIN
   world (interceptor) and one for the isolated world (bridge):

`interceptor-base.js` must be listed before the site interceptor so that
`window.__routeExtractorBase` is defined when the site script runs.

### Step 6 — Build and test

```bash
npm run build
```

Reload the extension in `chrome://extensions/`, visit a route page on the new site, open
the popup, and verify the status changes from "Waiting…" to "Route data captured".

---

## 📋 Requirements

- **Browser:** Chrome 92+, Edge 92+, Brave, Opera, or any Chromium browser with Manifest V3 support
- **Node.js:** 14.0.0 or higher (for the build step only)

---

## ❓ FAQ

**Q: Why do I need `npm run build`?**  
A: The build step copies `src/` and `public/` into `dist/`, which is the folder Chrome loads.
It also generates PNG icons from SVG sources.

**Q: Is this legal?**  
A: RouteSnap uses publicly available APIs without authentication. Always respect each site's
terms of service before using or distributing an adapter.

**Q: Does it work with private or login-only routes?**  
A: If the browser tab can load the route (i.e. you are logged in), RouteSnap will capture the
same API responses the page makes. If the site returns an error, no data will be captured.

**Q: Can I add support for other sites?**  
A: Yes — that is exactly what the adapter architecture is designed for. Follow the
[Adding a New Site](#adding-a-new-site) guide above. The generic core never needs to change.

---

## 📄 License

This project is licensed under the **MIT License**. See [LICENSE](./LICENSE) for details.

---

<div align="center">

**Made with ♡ for cyclists**

</div>