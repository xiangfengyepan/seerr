# Interactive Search + Grab — Phase 1 notes

Fork feature: replace/augment the request flow with an **interactive search +
grab** model. When a user requests a title, the fork searches the indexers via
Radarr/Sonarr, shows the real releases (parsed into video quality, audio
language(s), audio codec/channels, size), lets the user filter with dropdowns
(video quality = strict gate; audio language = best-effort, never hide on
unknown; audio quality/codec), pick individual TV episodes, and grab a specific
release.

This document covers **Phase 1**: codebase exploration + backend endpoints. The
frontend plan is at the end (not implemented this phase).

---

## 1. How a request currently flows (end to end)

### Frontend (request modal)

- `src/components/RequestModal/index.tsx` — dispatcher; renders the right modal
  by media type.
- `src/components/RequestModal/MovieRequestModal.tsx` — movie request. Loads
  `/api/v1/movie/:tmdbId` (SWR), posts to `POST /api/v1/request` in
  `sendRequest()` (line ~79-100). Uses `axios` directly and `mutate(...)` to
  refresh the request list/count. Advanced options come from
  `RequestModal/AdvancedRequester`.
- `src/components/RequestModal/TvRequestModal.tsx` — TV request. Holds
  `selectedSeasons: number[]` state (line ~80). Season list is built by
  `getAllSeasons()` (line ~238) / `getAllRequestedSeasons()` (line ~248);
  toggling is `toggleSeason()` (line ~282), `isSelectedSeason()` (line ~279).
  It renders a table of seasons with checkboxes; **there is currently no
  per-episode granularity** — the smallest unit is a whole season.
  `sendRequest()` posts `seasons` (array or `'all'`) to `POST /api/v1/request`.
- `src/components/RequestModal/AdvancedRequester/index.tsx` — advanced options
  (server, quality profile, root folder, language profile, tags, user). Fetches
  server details from `GET /api/v1/service/radarr/:id` and
  `/api/v1/service/sonarr/:id`. Produces a `RequestOverrides` object that the
  modal folds into the request body (`serverId`, `profileId`, `rootFolder`,
  `languageProfileId`, `tags`, `userId`).

### Backend (request route + entity)

- `server/routes/request.ts`
  - `POST /` (line ~303) → `MediaRequest.request(req.body, req.user)` then 201.
    Error mapping: `RequestPermissionError`/`QuotaRestrictedError` → 403,
    `DuplicateMediaRequestError` → 409, `NoSeasonsAvailableError` → 202,
    `BlocklistedMediaError` → 403.
  - `GET /` (line ~32) — lists requests, and (line ~185-215) it already
    instantiates `SonarrAPI`/`RadarrAPI` per configured server to fetch
    `getProfiles()` and map profile names / `canRemove`.
  - `PUT /:requestId` (line ~460), `POST /:requestId/approve` &
    `/:requestId/decline` (line ~633/663, `MANAGE_REQUESTS` gated),
    `DELETE /:requestId` (line ~601).
  - Router mounted in `server/routes/index.ts` at `/request` behind
    `isAuthenticated()`.
- `server/entity/MediaRequest.ts`
  - `static request()` (line ~47) — builds the `MediaRequest` (+ `SeasonRequest`
    rows for TV). **Auto-approval** decided by permissions: `AUTO_APPROVE`,
    `AUTO_APPROVE_MOVIE`/`AUTO_APPROVE_TV` (or `_4K_` variants), or
    `MANAGE_REQUESTS` → status `APPROVED`, else `PENDING` (line ~380-430 movie,
    ~490-540 TV). Stores `serverId`, `profileId`, `rootFolder`,
    `languageProfileId`, `tags` overrides on the row.
  - Entity columns: `status`, `media`, `requestedBy`, `is4k`, `serverId`,
    `profileId`, `rootFolder`, `languageProfileId`, `tags`, `seasons`, etc.
    (line ~549-649). Lifecycle hooks `@AfterInsert`/`@AfterUpdate` fire
    notifications only.
- `server/subscriber/MediaRequestSubscriber.ts` — **this is where requests are
  actually pushed to Radarr/Sonarr.** TypeORM entity subscriber:
  - `sendToRadarr(entity)` (line ~183) runs when
    `status === APPROVED && type === MOVIE`. Resolves the Radarr server
    (default non-4K vs 4K, or `entity.serverId` override), root folder, quality
    profile (`activeProfileId` or `entity.profileId` override), tags (+ per-user
    tag if `tagRequests`). Builds `RadarrMovieOptions` and calls
    `radarr.addMovie(...)` with `searchNow: !preventSearch`. On success stores
    `externalServiceId`/`serviceId` on `Media`; on failure marks request
    `FAILED`.
  - `sendToSonarr(entity)` (line ~477) — analogous for TV.
  - `afterInsert` (line ~1012) and `afterUpdate` (line ~1051) call
    `sendToRadarr`/`sendToSonarr`. Net effect: **a request only reaches
    Radarr/Sonarr once it is APPROVED** (immediately if auto-approved, otherwise
    when an admin approves it). Search relies on Radarr/Sonarr auto-search.

### Radarr/Sonarr API client wrappers

- `server/api/externalapi.ts` — base HTTP client (`ExternalAPI`): wraps axios,
  adds `get`/`post`/`getRolling` with node-cache, `removeCache`. `this.axios` is
  available to subclasses for raw calls.
- `server/api/servarr/base.ts` — `ServarrBase` extends `ExternalAPI`. Static
  `buildUrl(settings, path)` → `http(s)://host:port{baseUrl}{path}`. Common
  methods: `getSystemStatus`, `getProfiles` (`/qualityProfile`),
  `getRootFolders` (`/rootfolder`), `getQueue`, `getTags`, `createTag`,
  `runCommand` (`POST /command`). Constructor reads API key + timeout.
- `server/api/servarr/radarr.ts` — `RadarrAPI`. Existing: `getMovies`,
  `getMovie`, `getMovieByTmdbId` (`/movie/lookup?term=tmdb:ID`), `addMovie`
  (add/update, sets monitored + optional search), `searchMovie`
  (`MoviesSearch` command), `removeMovie`, `clearCache`.
- `server/api/servarr/sonarr.ts` — `SonarrAPI`. Existing: `getSeries`,
  `getSeriesById`, `getSeriesByTitle`, `getSeriesByTvdbId`
  (`/series/lookup?term=tvdb:ID`), `addSeries`, `getLanguageProfiles`,
  `searchSeries` (`MissingEpisodeSearch`), `getEpisodes` (`/episode?seriesId`),
  `monitorEpisodes` (`PUT /episode/monitor`), `buildSeasonList`, `removeSeries`,
  `clearCache`.
- Instantiation pattern everywhere:
  `new RadarrAPI({ apiKey: s.apiKey, url: RadarrAPI.buildUrl(s, '/api/v3') })`.

### Where server config + quality profiles live

- `server/lib/settings/index.ts` — `DVRSettings` (line ~68) base for
  `RadarrSettings` (adds `minimumAvailability`) and `SonarrSettings` (adds
  `seriesType`, `enableSeasonFolders`, `activeLanguageProfileId`,
  `monitorNewItems`, anime variants). Key fields: `id`, `hostname`, `port`,
  `apiKey`, `useSsl`, `baseUrl`, `activeProfileId`, `activeDirectory` (root
  folder), `tags`, `is4k`, `isDefault`, `preventSearch`, `tagRequests`.
  Accessed via `getSettings().radarr` / `.sonarr` (arrays).
- `server/routes/service.ts` — exposes servers to the frontend:
  `GET /service/radarr` & `/service/sonarr` (list), and
  `GET /service/radarr/:id` & `/service/sonarr/:id` (server + `profiles` +
  `rootFolders` + `tags` [+ `languageProfiles`]). Response shapes in
  `server/interfaces/api/serviceInterfaces.ts`.

### Existing TV season-selection code (extension point for per-episode)

- Backend already has episode granularity available:
  `SonarrAPI.getEpisodes(seriesId)` returns Sonarr `EpisodeResult[]` (each has
  internal `id`, `seasonNumber`, `episodeNumber`, `hasFile`, `monitored`), and
  `monitorEpisodes(episodeIds)`. Sonarr's release search supports
  `?episodeId=` (single episode) and `?seriesId=&seasonNumber=` (whole season).
- Frontend season selection is entirely in `TvRequestModal.tsx` (`selectedSeasons`
  state + season table). Per-episode UI will hang off each season row.

### Auth / permission middleware

- `server/middleware/auth.ts` — `checkUser` (session or `X-API-Key`/`X-API-User`)
  and `isAuthenticated(permissions?, options?)` returning 403 if
  `!req.user.hasPermission(...)`.
- `server/lib/permissions.ts` — `Permission` enum: `ADMIN`, `MANAGE_REQUESTS`,
  `REQUEST`, `AUTO_APPROVE`, `AUTO_APPROVE_MOVIE`, `AUTO_APPROVE_TV`,
  `REQUEST_4K*`, etc.

---

## 2. Backend implemented this phase

### New files

- `server/interfaces/api/interactiveSearchInterfaces.ts` — response/DTO types:
  `ParsedRelease`, `InteractiveSearchResponse`, `InteractiveSearchTvResponse`,
  `ReleaseEpisode`, `GrabReleaseResponse`.
- `server/utils/releaseParser.ts` — best-effort parsing helpers +
  `parseRelease(release)` that maps a raw Radarr/Sonarr release to
  `ParsedRelease`.
- `server/routes/interactiveSearch.ts` — the routes (below).

### Modified files

- `server/api/servarr/radarr.ts` — added `RadarrRelease` interface, `getReleases(movieId)`
  (`GET /release?movieId=`), `grabRelease({guid,indexerId})` (`POST /release`),
  and `ensureMovie(...)` (lookup; if not in library, `POST /movie` **unmonitored,
  no search** on the given profile).
- `server/api/servarr/sonarr.ts` — added `SonarrRelease` interface,
  `getReleasesBySeason({seriesId,seasonNumber})`, `getReleasesByEpisode(episodeId)`,
  `grabRelease({guid,indexerId})`, and `ensureSeries(...)` (lookup; if not in
  library, `POST /series` unmonitored, all seasons unmonitored, no search).
- `server/routes/index.ts` — mounts the router at `/api/v1/release` behind
  `isAuthenticated()`.

### Endpoints (all under `/api/v1/release`, `isAuthenticated()` at mount, plus
`Permission.REQUEST` per handler)

| Method & path | Purpose |
| --- | --- |
| `GET /release/movie/:tmdbId?serverId=` | Ensure the movie exists in Radarr (add unmonitored on a permissive profile if needed), run Radarr release search, return parsed releases. |
| `GET /release/tv/:tvdbId?season=&serverId=` | Ensure the series exists in Sonarr, run season release search, **and** return the season's episodes (with Sonarr `episodeId`s) for per-episode drill-down. |
| `GET /release/tv/:tvdbId/episode/:episodeId?serverId=` | Per-episode release search (`episodeId` from the season response). |
| `POST /release/grab` | Grab a chosen release. Body `{ mediaType, serverId?, guid, indexerId }`. |

### Parsed release shape (`ParsedRelease`)

```ts
{
  guid: string;
  indexerId: number;
  indexer: string;
  title: string;
  videoQuality: string;      // "2160p" | "1080p" | "720p" | "480p" | "Unknown"  (STRICT gate)
  source: string;            // "Bluray" | "Remux" | "WEB-DL" | "WEBRip" | "HDTV" | "DVD" | "Unknown"
  qualityName: string;       // raw *arr quality name, e.g. "Bluray-1080p"
  audioLanguages: string[];  // best-effort; [] means UNKNOWN (do NOT hide the release)
  audioCodec: string | null; // best-effort: EAC3, AC3, DTS-HD MA, TrueHD, Atmos, AAC, FLAC, ...
  audioChannels: string | null; // best-effort: "5.1", "7.1", "2.0"
  sizeBytes: number;
  seeders: number | null;
  protocol: string | null;   // "torrent" | "usenet"
  rejected: boolean;         // *arr rejection flag (kept, shown greyed — not filtered out)
  rejectionReasons: string[];
  ageHours: number | null;
}
```

- **Video quality/source** come from the *arr `quality` field (reliable) — this
  is the strict filter dimension. Remux is detected from the title (arr models it
  as a modifier, not a source).
- **Audio codec/channels/language** are scraped best-effort from the release
  title; language also uses the *arr `languages` field. `languages` entries named
  `"Unknown"` are dropped so they never become filter values. When nothing is
  parsed, `audioLanguages` is `[]` — the frontend must treat empty as "unknown"
  and still show the release (per the spec: language filter is best-effort).

### How grab works & the approval model

`POST /release/grab` mirrors the existing auto-approval model. `canAutoGrab()`
checks `MANAGE_REQUESTS | AUTO_APPROVE | AUTO_APPROVE_MOVIE/TV` (OR):

- **Privileged user** → the release is pushed immediately via
  `RadarrAPI.grabRelease` / `SonarrAPI.grabRelease` (`POST /api/v3/release`),
  returns `{ grabbed: true, pendingApproval: false }`.
- **Non-privileged user** → returns `202 { grabbed: false, pendingApproval:
  true }` and does **not** push. This is the seam where a later phase will
  persist the chosen release GUID onto a `MediaRequest` for an admin to approve
  (see "Uncertain / follow-up").

### Permissive "Any" profile

`resolvePermissiveProfileId()` prefers a quality profile literally named `"Any"`
(case-insensitive) from `getProfiles()`, else the server's configured
`activeProfileId`, else the first profile / id `1`. This avoids hardcoding id 1
while defaulting to the *arr "Any" profile so any user-chosen release passes the
profile gate. API keys/URLs are always read from `getSettings()` — nothing is
hardcoded.

### Verification

- `tsc --project server/tsconfig.json --noEmit` → **exit 0, no errors**.
- `eslint` on all new/changed files → **exit 0, clean**.
- Full Next/Docker build intentionally NOT run (out of scope; node engine on
  this box is v24 vs the repo's expected ^22.19.0 — pnpm scripts need
  `--config.engine-strict=false`, tsc/eslint were run via `./node_modules/.bin`).

---

## 3. Frontend implementation plan (Phase 2 — NOT implemented here)

### New shared building block

Create `src/components/RequestModal/InteractiveSearch/index.tsx` (+ a
`ReleaseRow` subcomponent). Responsibilities:

1. **Fetch releases** with SWR:
   - Movie: `useSWR<InteractiveSearchResponse>('/api/v1/release/movie/${tmdbId}${serverId ? `?serverId=${serverId}` : ''}')`.
   - TV season: `/api/v1/release/tv/${tvdbId}?season=${n}`.
   - TV episode: `/api/v1/release/tv/${tvdbId}/episode/${episodeId}`.
   Import the response types from `@server/interfaces/api/interactiveSearchInterfaces`
   (the client already imports server types this way, e.g. `SeasonRequest`).
   Show a spinner while loading (indexer searches are slow — 10-30s; set a long
   SWR timeout and a clear "searching indexers…" state).

2. **Three filter dropdowns** (headless-ui `Listbox`, matching existing
   `AdvancedRequester` styling), computing option lists from the fetched results:
   - **Video quality** — STRICT gate: options are the distinct `videoQuality`
     values; a release is shown only if it matches the selected quality (and
     `source` if a source sub-filter is added).
   - **Audio language** — BEST-EFFORT: options are distinct values across all
     `audioLanguages`. Filtering must **never hide a release whose
     `audioLanguages` is empty** (unknown). i.e. `selected === 'any' ||
     release.audioLanguages.length === 0 || release.audioLanguages.includes(selected)`.
   - **Audio quality/codec** — options from distinct `audioCodec`
     (optionally combined with `audioChannels`); apply like the language filter
     (don't hide `null` codec unless the user explicitly narrows).

3. **Release list** — render filtered `ParsedRelease[]` as rows:
   title, `videoQuality`+`source` badge, `qualityName`, audio
   language chips, `audioCodec`/`audioChannels`, humanized `sizeBytes`
   (reuse the existing bytes formatter), `seeders`, `indexer`, and age.
   Rejected releases (`rejected === true`) shown greyed with a tooltip listing
   `rejectionReasons` (still selectable — do not filter out). Each row has a
   **Grab** button.

4. **Grab action** — `axios.post('/api/v1/release/grab', { mediaType, serverId,
   guid, indexerId })`. On `200 grabbed` → success toast + close/refresh
   (`mutate` the request list like the modals do). On `202 pendingApproval` →
   info toast ("sent for approval"). Surface errors via the existing toast
   pattern.

### Wiring into the existing modals

- **MovieRequestModal.tsx**: add an "Interactive search" affordance (a toggle or
  a secondary button beside the primary Request button). When engaged, render
  `<InteractiveSearch mediaType="movie" tmdbId={tmdbId} serverId={selectedServer}
  />` in place of / below the standard request confirmation. Reuse the server
  chosen in `AdvancedRequester` (pass its `serverId` so the search hits the same
  Radarr instance). Keep the classic request path intact as a fallback.
- **TvRequestModal.tsx**: extend the season table.
  - Keep `selectedSeasons` behavior for the classic path.
  - Add an **expand** control per season row that, when opened, calls the TV
    season endpoint and renders `<InteractiveSearch mediaType="tv" tvdbId={...}
    season={n} />`. The response's `episodes[]` (each with Sonarr `id`) powers a
    **per-episode selector**: a nested list where each episode has its own
    "search releases" toggle → `GET /release/tv/:tvdbId/episode/:episodeId`, and
    the release rows grab that episode's release. This is the new per-episode
    granularity (today the smallest unit is a whole season).
  - Add a small `selectedEpisodes` state map (`{ [seasonNumber]: episodeId[] }`)
    if batch per-episode grabbing is desired later.

### Types & utilities to reuse

- Response types from `@server/interfaces/api/interactiveSearchInterfaces`.
- Existing byte/size + duration humanizers already used in the app
  (`humanize-duration` is a dep; there is a bytes formatter in the UI utils).
- `Listbox`/`Transition` from `@headlessui/react` and `@heroicons/react` icons,
  consistent with `AdvancedRequester`.

### Suggested build order (Phase 2)

1. `InteractiveSearch` component with fetching + release list (no filters).
2. Add the three filter dropdowns.
3. Grab button + toasts + list refresh.
4. Movie modal integration.
5. TV season integration, then per-episode drill-down.

---

## 4. Blocked / uncertain / follow-ups

- **Approval workflow for grabs is a seam, not fully wired.** Non-privileged
  grabs currently return `202 pendingApproval` without persisting anything. To
  truly match "request → admin approves → it downloads", Phase 2/3 should store
  the chosen release (`guid`, `indexerId`, `serverId`, movie/episode ids) on a
  `MediaRequest` (new nullable columns + migration) and push the grab from the
  `MediaRequestSubscriber` when the request flips to `APPROVED` — reusing
  `grabRelease` instead of `addMovie/addSeries`'s auto-search.
- **A title must exist in Radarr/Sonarr before a release search.** Confirmed:
  `GET /api/v3/release` needs a `movieId`/`seriesId`/`episodeId`, so the movie
  endpoint calls `ensureMovie` and the TV endpoint calls `ensureSeries` (both
  add **unmonitored, no auto-search** so nothing downloads until an explicit
  grab). Side effect: interactive-searching a title adds it (unmonitored) to the
  *arr library even if the user never grabs. Acceptable for the fork; a cleanup
  job could remove never-grabbed unmonitored adds later.
- **"Any" profile id 1 assumption** is avoided in code (we look up a profile
  named "Any"), but the permissive-profile requirement is a Radarr/Sonarr
  configuration step — the *arr servers must actually have an "Any"/permissive
  profile, otherwise release rejections will still occur (they're returned with
  `rejected: true` + reasons rather than hidden, which the UI surfaces).
- **Audio language parsing limits.** Language is best-effort from title tokens +
  the *arr `languages` field, which itself is often just `["English"]` or
  `["Unknown"]`. Many releases will parse to `[]`; per spec these are shown, not
  hidden. Codec/channel parsing is regex-based and will miss unusual naming.
- **Environment note.** This box runs Node v24; the repo expects ^22.19.0.
  `pnpm <script>` fails the engine check — use `--config.engine-strict=false`
  for install, and run `tsc`/`eslint` via `./node_modules/.bin/*` (as done for
  verification). No `pnpm build`/Docker build was run (out of scope).
