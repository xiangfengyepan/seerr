# Feature: "Available" tab — exploration notes

## Navigation / routing architecture
- **Sidebar / nav:** `src/components/Layout/Sidebar/index.tsx`. Tabs are declared in the
  `SidebarLinks: SidebarLinkProps[]` array (href, `messagesKey`, `svgIcon`, `activeRegExp`,
  optional `requiredPermission`). Labels come from `menuMessages` (react-intl) defined in the
  same file. Both the mobile and desktop nav map over this array.
- **Routing:** Next.js **pages router** (`src/pages/*`). A tab is a page file that renders a
  component. Thin page files just render a component, e.g.
  `src/pages/requests/index.tsx` -> `<RequestList />`,
  `src/pages/discover/watchlist.tsx` -> `<DiscoverWatchlist />`.
- **Auth:** the whole app is wrapped by `Layout` (in `src/pages/_app.tsx`); every page except
  login/setup requires an authenticated user. A new page under `src/pages` inherits this — no
  extra wiring needed.

## Media status model
- `server/constants/media.ts` `enum MediaStatus`:
  `UNKNOWN=1, PENDING=2, PROCESSING=3, PARTIALLY_AVAILABLE=4, AVAILABLE=5, BLOCKLISTED=6, DELETED=7`.
  Confirmed: **AVAILABLE = 5, PARTIALLY_AVAILABLE = 4** (series that are only partly downloaded).
- `enum MediaType { MOVIE='movie', TV='tv' }`.

## Existing media API + reusable components
- **Endpoint:** `GET /api/v1/media` (`server/routes/media.ts`). Supports
  `filter=available|partial|allavailable|processing|pending`, `sort=modified|mediaAdded`,
  `take`, `skip`. Returns `MediaResultsResponse` = `{ pageInfo, results: Media[] }` where each
  `Media` row carries `tmdbId`, `tvdbId`, `mediaType`, `status`, `mediaAddedAt`.
  `filter=allavailable` = `status IN (AVAILABLE, PARTIALLY_AVAILABLE)`.
  It did **not** support a `mediaType` filter -> added one (see below).
- **Cards:** `src/components/TitleCard/TmdbTitleCard.tsx` takes `{ id, tmdbId, tvdbId, type }`
  and lazily fetches full TMDB details itself — perfect for rendering raw `Media` rows.
  `src/components/Discover/RecentlyAddedSlider` already does exactly
  `/api/v1/media?filter=allavailable&...` -> `TmdbTitleCard`.
- **Grid + infinite scroll:** `src/components/Common/ListView` renders the `cards-vertical`
  grid; `src/hooks/useVerticalScroll.ts` drives infinite scroll. `useSWRInfinite` is the
  pagination primitive (see `MediaSlider`). The generic `useDiscover` hook expects the TMDB
  `BaseSearchResult` shape, which the media endpoint does not return, so the new component uses
  `useSWRInfinite<MediaResultsResponse>` directly against `/api/v1/media`.

## What was implemented
- **Backend (reused + extended):** added an optional `mediaType=movie|tv` query param to
  `GET /api/v1/media` in `server/routes/media.ts` (folds into the existing `whereClause`). This
  was the only backend change — everything else reuses the existing endpoint.
- **Frontend:**
  - `src/components/AvailableMedia/index.tsx` — the page component. Fetches
    `/api/v1/media?filter=allavailable&sort=mediaAdded&mediaType=<all|movie|tv>` via
    `useSWRInfinite`, renders `TmdbTitleCard`s in the standard `cards-vertical` grid with
    `useVerticalScroll` infinite scroll, and an All / Movies / Series `<select>` filter
    (persisted to localStorage).
  - `src/pages/available/index.tsx` — Next.js page -> `<AvailableMedia />`.
  - `src/components/Layout/Sidebar/index.tsx` — new "Available" nav entry (CheckCircleIcon,
    route `/available`).
  - i18n: reuses `globalMessages` (all/movies/tvshows/available/noresults) plus new keys in
    `src/i18n/locale/en.json` (`components.Layout.Sidebar.available`,
    `components.AvailableMedia.*`).
