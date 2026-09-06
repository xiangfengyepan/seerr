import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import TheMovieDb from '@server/api/themoviedb';
import type {
  GrabReleaseResponse,
  InteractiveSearchResponse,
  InteractiveSearchTvResponse,
  ReleaseEpisode,
} from '@server/interfaces/api/interactiveSearchInterfaces';
import { Permission } from '@server/lib/permissions';
import {
  getSettings,
  type RadarrSettings,
  type SonarrSettings,
} from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { parseRelease } from '@server/utils/releaseParser';
import { Router } from 'express';

const interactiveSearchRoutes = Router();

/**
 * Resolve which Radarr server to use: an explicit serverId, otherwise the
 * default non-4K server.
 */
const resolveRadarrSettings = (
  serverId?: number
): RadarrSettings | undefined => {
  const settings = getSettings();
  if (serverId !== undefined && !Number.isNaN(serverId)) {
    return settings.radarr.find((r) => r.id === serverId);
  }
  return (
    settings.radarr.find((r) => r.isDefault && !r.is4k) ?? settings.radarr[0]
  );
};

const resolveSonarrSettings = (
  serverId?: number
): SonarrSettings | undefined => {
  const settings = getSettings();
  if (serverId !== undefined && !Number.isNaN(serverId)) {
    return settings.sonarr.find((s) => s.id === serverId);
  }
  return (
    settings.sonarr.find((s) => s.isDefault && !s.is4k) ?? settings.sonarr[0]
  );
};

/**
 * Pick a permissive quality profile so any user-chosen release is accepted.
 * Prefers a profile literally named "Any", then the configured active profile,
 * then the *arr default of id 1.
 */
const resolvePermissiveProfileId = (
  profiles: { id: number; name: string }[],
  fallbackId: number
): number => {
  const anyProfile = profiles.find((p) => p.name.toLowerCase() === 'any');
  if (anyProfile) {
    return anyProfile.id;
  }
  if (fallbackId) {
    return fallbackId;
  }
  return profiles[0]?.id ?? 1;
};

/**
 * Interactive search for a MOVIE by TMDB id.
 * GET /release/movie/:tmdbId?serverId=
 */
interactiveSearchRoutes.get<
  { tmdbId: string },
  InteractiveSearchResponse,
  never,
  { serverId?: string }
>(
  '/movie/:tmdbId',
  isAuthenticated(Permission.REQUEST),
  async (req, res, next) => {
    try {
      const tmdbId = Number(req.params.tmdbId);
      if (Number.isNaN(tmdbId)) {
        return next({ status: 400, message: 'Invalid TMDB ID provided.' });
      }

      const radarrSettings = resolveRadarrSettings(
        req.query.serverId !== undefined
          ? Number(req.query.serverId)
          : undefined
      );

      if (!radarrSettings) {
        return next({
          status: 404,
          message: 'No Radarr server is configured.',
        });
      }

      const radarr = new RadarrAPI({
        apiKey: radarrSettings.apiKey,
        url: RadarrAPI.buildUrl(radarrSettings, '/api/v3'),
      });

      const profiles = await radarr.getProfiles();
      const profileId = resolvePermissiveProfileId(
        profiles,
        radarrSettings.activeProfileId
      );

      const tmdb = new TheMovieDb();
      const movie = await tmdb.getMovie({ movieId: tmdbId });

      const radarrMovie = await radarr.ensureMovie({
        tmdbId,
        title: movie.title,
        year: movie.release_date ? Number(movie.release_date.slice(0, 4)) : 0,
        qualityProfileId: profileId,
        rootFolderPath: radarrSettings.activeDirectory,
        minimumAvailability: radarrSettings.minimumAvailability,
      });

      const releases = await radarr.getReleases(radarrMovie.id);

      return res.status(200).json({
        serverId: radarrSettings.id,
        mediaType: 'movie',
        results: releases.map(parseRelease),
      });
    } catch (e) {
      logger.error('Failed interactive movie search', {
        label: 'Interactive Search',
        errorMessage: e.message,
        tmdbId: req.params.tmdbId,
      });
      return next({ status: 500, message: e.message });
    }
  }
);

/**
 * Interactive search for TV by TVDB id + season.
 * GET /release/tv/:tvdbId?season=&serverId=
 *
 * Returns the parsed releases for the whole season plus the list of episodes
 * (with their Sonarr episode ids) so the frontend can offer per-episode search.
 */
interactiveSearchRoutes.get<
  { tvdbId: string },
  InteractiveSearchTvResponse,
  never,
  { season?: string; serverId?: string }
>(
  '/tv/:tvdbId',
  isAuthenticated(Permission.REQUEST),
  async (req, res, next) => {
    try {
      const tvdbId = Number(req.params.tvdbId);
      if (Number.isNaN(tvdbId)) {
        return next({ status: 400, message: 'Invalid TVDB ID provided.' });
      }

      const seasonNumber =
        req.query.season !== undefined ? Number(req.query.season) : undefined;
      if (seasonNumber === undefined || Number.isNaN(seasonNumber)) {
        return next({
          status: 400,
          message: 'A season number is required.',
        });
      }

      const sonarrSettings = resolveSonarrSettings(
        req.query.serverId !== undefined
          ? Number(req.query.serverId)
          : undefined
      );

      if (!sonarrSettings) {
        return next({
          status: 404,
          message: 'No Sonarr server is configured.',
        });
      }

      const sonarr = new SonarrAPI({
        apiKey: sonarrSettings.apiKey,
        url: SonarrAPI.buildUrl(sonarrSettings, '/api/v3'),
      });

      const profiles = await sonarr.getProfiles();
      const profileId = resolvePermissiveProfileId(
        profiles,
        sonarrSettings.activeProfileId
      );

      const series = await sonarr.ensureSeries({
        tvdbId,
        qualityProfileId: profileId,
        languageProfileId: sonarrSettings.activeLanguageProfileId,
        rootFolderPath: sonarrSettings.activeDirectory,
        seasonFolder: sonarrSettings.enableSeasonFolders,
        seriesType: sonarrSettings.seriesType,
      });

      if (!series.id) {
        return next({
          status: 500,
          message: 'Failed to resolve series in Sonarr.',
        });
      }

      const [releases, allEpisodes] = await Promise.all([
        sonarr.getReleasesBySeason({
          seriesId: series.id,
          seasonNumber,
        }),
        sonarr.getEpisodes(series.id),
      ]);

      const episodes: ReleaseEpisode[] = allEpisodes
        .filter((ep) => ep.seasonNumber === seasonNumber)
        .map((ep) => ({
          id: ep.id,
          seasonNumber: ep.seasonNumber,
          episodeNumber: ep.episodeNumber,
          title: ep.title,
          airDate: ep.airDate,
          hasFile: ep.hasFile,
          monitored: ep.monitored,
        }))
        .sort((a, b) => a.episodeNumber - b.episodeNumber);

      return res.status(200).json({
        serverId: sonarrSettings.id,
        mediaType: 'tv',
        seriesId: series.id,
        seasonNumber,
        results: releases.map(parseRelease),
        episodes,
      });
    } catch (e) {
      logger.error('Failed interactive TV season search', {
        label: 'Interactive Search',
        errorMessage: e.message,
        tvdbId: req.params.tvdbId,
      });
      return next({ status: 500, message: e.message });
    }
  }
);

/**
 * Interactive search for a single EPISODE (by Sonarr episode id).
 * GET /release/tv/:tvdbId/episode/:episodeId?serverId=
 *
 * The episodeId is Sonarr's internal id, obtained from the season endpoint's
 * `episodes` array.
 */
interactiveSearchRoutes.get<
  { tvdbId: string; episodeId: string },
  InteractiveSearchResponse,
  never,
  { serverId?: string }
>(
  '/tv/:tvdbId/episode/:episodeId',
  isAuthenticated(Permission.REQUEST),
  async (req, res, next) => {
    try {
      const episodeId = Number(req.params.episodeId);
      if (Number.isNaN(episodeId)) {
        return next({ status: 400, message: 'Invalid episode ID provided.' });
      }

      const sonarrSettings = resolveSonarrSettings(
        req.query.serverId !== undefined
          ? Number(req.query.serverId)
          : undefined
      );

      if (!sonarrSettings) {
        return next({
          status: 404,
          message: 'No Sonarr server is configured.',
        });
      }

      const sonarr = new SonarrAPI({
        apiKey: sonarrSettings.apiKey,
        url: SonarrAPI.buildUrl(sonarrSettings, '/api/v3'),
      });

      const releases = await sonarr.getReleasesByEpisode(episodeId);

      return res.status(200).json({
        serverId: sonarrSettings.id,
        mediaType: 'tv',
        results: releases.map(parseRelease),
      });
    } catch (e) {
      logger.error('Failed interactive episode search', {
        label: 'Interactive Search',
        errorMessage: e.message,
        episodeId: req.params.episodeId,
      });
      return next({ status: 500, message: e.message });
    }
  }
);

interface GrabReleaseBody {
  mediaType: 'movie' | 'tv';
  serverId?: number;
  guid: string;
  indexerId: number;
}

/**
 * Determine whether the current user's grab may be pushed immediately, mirroring
 * the auto-approval permission model used for normal requests.
 */
const canAutoGrab = (
  req: Express.Request['user'],
  mediaType: 'movie' | 'tv'
): boolean => {
  if (!req) {
    return false;
  }
  return req.hasPermission(
    [
      Permission.MANAGE_REQUESTS,
      Permission.AUTO_APPROVE,
      mediaType === 'movie'
        ? Permission.AUTO_APPROVE_MOVIE
        : Permission.AUTO_APPROVE_TV,
    ],
    { type: 'or' }
  );
};

/**
 * GRAB a specific release for a movie or episode(s).
 * POST /release/grab
 *
 * Respects the existing approval model: a user without auto-approve permission
 * does not push the grab; instead a pending-approval response is returned. Users
 * with manage/auto-approve permission push the grab straight to Radarr/Sonarr.
 */
interactiveSearchRoutes.post<never, GrabReleaseResponse, GrabReleaseBody>(
  '/grab',
  isAuthenticated(Permission.REQUEST),
  async (req, res, next) => {
    try {
      const { mediaType, serverId, guid, indexerId } = req.body;

      if (!guid || indexerId === undefined || indexerId === null) {
        return next({
          status: 400,
          message: 'A release guid and indexerId are required.',
        });
      }

      if (mediaType !== 'movie' && mediaType !== 'tv') {
        return next({ status: 400, message: 'Invalid media type.' });
      }

      // Enforce the existing approval model. Non-privileged users do not push
      // the grab directly — this is where a future phase persists the chosen
      // release on a MediaRequest for an admin to approve.
      if (!canAutoGrab(req.user, mediaType)) {
        return res.status(202).json({
          grabbed: false,
          pendingApproval: true,
          message:
            'This grab requires approval and has not been sent to the download client.',
        });
      }

      if (mediaType === 'movie') {
        const radarrSettings = resolveRadarrSettings(serverId);
        if (!radarrSettings) {
          return next({
            status: 404,
            message: 'No Radarr server is configured.',
          });
        }
        const radarr = new RadarrAPI({
          apiKey: radarrSettings.apiKey,
          url: RadarrAPI.buildUrl(radarrSettings, '/api/v3'),
        });
        await radarr.grabRelease({ guid, indexerId });
      } else {
        const sonarrSettings = resolveSonarrSettings(serverId);
        if (!sonarrSettings) {
          return next({
            status: 404,
            message: 'No Sonarr server is configured.',
          });
        }
        const sonarr = new SonarrAPI({
          apiKey: sonarrSettings.apiKey,
          url: SonarrAPI.buildUrl(sonarrSettings, '/api/v3'),
        });
        await sonarr.grabRelease({ guid, indexerId });
      }

      logger.info('Interactive grab pushed to download client', {
        label: 'Interactive Search',
        mediaType,
        userId: req.user?.id,
      });

      return res.status(200).json({
        grabbed: true,
        pendingApproval: false,
        message: 'Release sent to the download client.',
      });
    } catch (e) {
      logger.error('Failed to grab release', {
        label: 'Interactive Search',
        errorMessage: e.message,
      });
      return next({ status: 500, message: e.message });
    }
  }
);

export default interactiveSearchRoutes;
