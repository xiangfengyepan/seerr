/**
 * Shared shape returned by the interactive-search endpoints. A single release
 * parsed from Radarr/Sonarr into the fields the UI filters on.
 *
 * Parsing philosophy:
 *  - videoQuality/source come from the *arr `quality` field (reliable, this is
 *    what the profile gate uses), so this is the STRICT filter dimension.
 *  - audioLanguages / audioCodec / audioChannels are BEST-EFFORT parses from
 *    the release title plus the *arr `languages` field. When we cannot parse a
 *    language, we return an empty array (never a fabricated "Unknown" gate) so
 *    the frontend can choose to still show the release rather than hide it.
 */
export interface ParsedRelease {
  guid: string;
  indexerId: number;
  indexer: string;
  title: string;
  /** e.g. "2160p", "1080p", "720p", "480p", or "Unknown". */
  videoQuality: string;
  /** e.g. "Bluray", "Remux", "WEB-DL", "WEBRip", "HDTV", "DVD", or "Unknown". */
  source: string;
  /** Raw *arr quality profile name for this release (e.g. "Bluray-1080p"). */
  qualityName: string;
  /**
   * Best-effort list of audio languages (e.g. ["English", "Spanish"]).
   * May be empty when nothing could be parsed — do NOT treat empty as a
   * filter-excluded value.
   */
  audioLanguages: string[];
  /** Best-effort audio codec (e.g. "EAC3", "DTS-HD MA", "TrueHD") or null. */
  audioCodec: string | null;
  /** Best-effort channel layout (e.g. "5.1", "7.1", "2.0") or null. */
  audioChannels: string | null;
  sizeBytes: number;
  seeders: number | null;
  /** Download protocol ("torrent" | "usenet") when known. */
  protocol: string | null;
  /** True when *arr flagged the release as rejected (kept, not hidden). */
  rejected: boolean;
  rejectionReasons: string[];
  /** The publish age in hours, when *arr provides it. */
  ageHours: number | null;
}

export interface InteractiveSearchResponse {
  serverId: number;
  mediaType: 'movie' | 'tv';
  results: ParsedRelease[];
}

export interface ReleaseEpisode {
  /** Sonarr internal episode id — needed to run a per-episode search/grab. */
  id: number;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  airDate?: string;
  hasFile: boolean;
  monitored: boolean;
}

export interface InteractiveSearchTvResponse extends InteractiveSearchResponse {
  seriesId: number;
  seasonNumber?: number;
  episodes?: ReleaseEpisode[];
}

import type { MediaRequest } from '@server/entity/MediaRequest';

export interface GrabReleaseResponse {
  grabbed: boolean;
  /** When a non-auto-approve user grabs, we do not push yet. */
  pendingApproval: boolean;
  message: string;
  /**
   * The PENDING MediaRequest created for a non-privileged grab, carrying the
   * chosen release so an admin approval grabs that exact release. Absent when a
   * privileged user grabbed immediately.
   */
  request?: MediaRequest;
}
