import logger from '@server/logger';
import type { AxiosResponse } from 'axios';
import ServarrBase from './base';

export interface SonarrSeason {
  seasonNumber: number;
  monitored: boolean;
  statistics?: {
    previousAiring?: string;
    episodeFileCount: number;
    episodeCount: number;
    totalEpisodeCount: number;
    sizeOnDisk: number;
    percentOfEpisodes: number;
  };
}
interface EpisodeResult {
  seriesId: number;
  episodeFileId: number;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  airDate: string;
  airDateUtc: string;
  overview: string;
  hasFile: boolean;
  monitored: boolean;
  absoluteEpisodeNumber: number;
  unverifiedSceneNumbering: boolean;
  id: number;
}

export interface SonarrSeries {
  title: string;
  sortTitle: string;
  seasonCount: number;
  status: string;
  overview: string;
  network: string;
  airTime: string;
  images: {
    coverType: string;
    url: string;
  }[];
  remotePoster: string;
  seasons: SonarrSeason[];
  year: number;
  path: string;
  profileId: number;
  languageProfileId: number;
  seasonFolder: boolean;
  monitored: boolean;
  monitorNewItems: 'all' | 'none';
  useSceneNumbering: boolean;
  runtime: number;
  tvdbId: number;
  tvRageId: number;
  tvMazeId: number;
  firstAired: string;
  lastInfoSync?: string;
  seriesType: 'standard' | 'daily' | 'anime';
  cleanTitle: string;
  imdbId: string;
  titleSlug: string;
  certification: string;
  genres: string[];
  tags: number[];
  added: string;
  ratings: {
    votes: number;
    value: number;
  };
  qualityProfileId: number;
  id?: number;
  rootFolderPath?: string;
  addOptions?: {
    ignoreEpisodesWithFiles?: boolean;
    ignoreEpisodesWithoutFiles?: boolean;
    searchForMissingEpisodes?: boolean;
  };
  statistics: {
    seasonCount: number;
    episodeFileCount: number;
    episodeCount: number;
    totalEpisodeCount: number;
    sizeOnDisk: number;
    releaseGroups: string[];
    percentOfEpisodes: number;
  };
}

export interface AddSeriesOptions {
  tvdbid: number;
  title: string;
  profileId: number;
  languageProfileId?: number;
  seasons: number[];
  seasonFolder: boolean;
  rootFolderPath: string;
  tags?: number[];
  seriesType: SonarrSeries['seriesType'];
  monitored?: boolean;
  monitorNewItems?: SonarrSeries['monitorNewItems'];
  searchNow?: boolean;
}

export interface LanguageProfile {
  id: number;
  name: string;
}

export interface SonarrRelease {
  guid: string;
  quality: {
    quality: {
      id: number;
      name: string;
      source?: string;
      resolution?: number;
    };
    revision?: {
      version: number;
      real: number;
      isRepack: boolean;
    };
  };
  qualityWeight?: number;
  age?: number;
  ageHours?: number;
  ageMinutes?: number;
  size: number;
  indexerId: number;
  indexer: string;
  releaseGroup?: string;
  subGroup?: string;
  title: string;
  fullSeason?: boolean;
  sceneSource?: boolean;
  seasonNumber?: number;
  episodeNumbers?: number[];
  languages?: { id: number; name: string }[];
  approved: boolean;
  temporarilyRejected?: boolean;
  rejected: boolean;
  rejections?: string[];
  publishDate?: string;
  downloadUrl?: string;
  infoUrl?: string;
  downloadAllowed?: boolean;
  releaseWeight?: number;
  customFormatScore?: number;
  seeders?: number;
  leechers?: number;
  protocol?: string;
}

export interface SonarrReleaseGrabResponse {
  guid: string;
  [key: string]: unknown;
}

class SonarrAPI extends ServarrBase<{
  seriesId: number;
  episodeId: number;
  episode: EpisodeResult;
}> {
  constructor({ url, apiKey }: { url: string; apiKey: string }) {
    super({ url, apiKey, apiName: 'Sonarr', cacheName: 'sonarr' });
  }

  /**
   * Interactive search for a whole season. The series must already exist in
   * Sonarr.
   */
  public getReleasesBySeason = async ({
    seriesId,
    seasonNumber,
  }: {
    seriesId: number;
    seasonNumber: number;
  }): Promise<SonarrRelease[]> => {
    try {
      const response = await this.axios.get<SonarrRelease[]>('/release', {
        params: { seriesId, seasonNumber },
        // Interactive indexer searches routinely take far longer than the
        // global Servarr apiRequestTimeout (~10s); allow up to 90s here.
        timeout: 90000,
      });

      return response.data;
    } catch (e) {
      throw new Error(
        `[Sonarr] Failed to retrieve season releases: ${e.message}`,
        { cause: e }
      );
    }
  };

  /**
   * Interactive search for a single episode (by Sonarr episode id).
   */
  public getReleasesByEpisode = async (
    episodeId: number
  ): Promise<SonarrRelease[]> => {
    try {
      const response = await this.axios.get<SonarrRelease[]>('/release', {
        params: { episodeId },
        // Interactive indexer searches routinely take far longer than the
        // global Servarr apiRequestTimeout (~10s); allow up to 90s here.
        timeout: 90000,
      });

      return response.data;
    } catch (e) {
      throw new Error(
        `[Sonarr] Failed to retrieve episode releases: ${e.message}`,
        { cause: e }
      );
    }
  };

  /**
   * Ensure a series exists in Sonarr so an interactive release search can run
   * against it. If the series is not yet in the library it is added
   * UNMONITORED (all seasons unmonitored, no automatic search) on the supplied
   * (permissive) quality profile. Returns the Sonarr series record.
   */
  public async ensureSeries(options: {
    tvdbId: number;
    title?: string;
    qualityProfileId: number;
    languageProfileId?: number;
    rootFolderPath: string;
    seasonFolder: boolean;
    seriesType: SonarrSeries['seriesType'];
  }): Promise<SonarrSeries> {
    const lookup = await this.getSeriesByTvdbId(options.tvdbId);

    // Already in the Sonarr library.
    if (lookup.id) {
      return lookup;
    }

    try {
      const response = await this.axios.post<SonarrSeries>('/series', {
        tvdbId: options.tvdbId,
        title: options.title ?? lookup.title,
        qualityProfileId: options.qualityProfileId,
        languageProfileId: options.languageProfileId,
        seasons: (lookup.seasons ?? []).map((season) => ({
          seasonNumber: season.seasonNumber,
          monitored: false,
        })),
        seasonFolder: options.seasonFolder,
        monitored: false,
        monitorNewItems: 'none',
        rootFolderPath: options.rootFolderPath,
        seriesType: options.seriesType,
        addOptions: {
          ignoreEpisodesWithFiles: false,
          searchForMissingEpisodes: false,
        },
      } as Partial<SonarrSeries>);

      if (!response.data.id) {
        throw new Error('Sonarr did not return a series id');
      }

      logger.info(
        'Added series to Sonarr (unmonitored) for interactive search',
        {
          label: 'Sonarr',
          seriesId: response.data.id,
          tvdbId: options.tvdbId,
        }
      );

      return response.data;
    } catch (e) {
      throw new Error(
        `[Sonarr] Failed to add series for interactive search: ${e.message}`,
        { cause: e }
      );
    }
  }

  /**
   * Interactive grab: tell Sonarr to download a specific release the user
   * picked.
   */
  public grabRelease = async ({
    guid,
    indexerId,
  }: {
    guid: string;
    indexerId: number;
  }): Promise<SonarrReleaseGrabResponse> => {
    try {
      const response = await this.axios.post<SonarrReleaseGrabResponse>(
        '/release',
        { guid, indexerId }
      );

      return response.data;
    } catch (e) {
      throw new Error(`[Sonarr] Failed to grab release: ${e.message}`, {
        cause: e,
      });
    }
  };

  public async getSeries(): Promise<SonarrSeries[]> {
    try {
      const response = await this.axios.get<SonarrSeries[]>('/series');

      return response.data;
    } catch (e) {
      throw new Error(`[Sonarr] Failed to retrieve series: ${e.message}`, {
        cause: e,
      });
    }
  }

  public async getSeriesById(id: number): Promise<SonarrSeries> {
    try {
      const response = await this.axios.get<SonarrSeries>(`/series/${id}`);

      return response.data;
    } catch (e) {
      throw new Error(
        `[Sonarr] Failed to retrieve series by ID: ${e.message}`,
        { cause: e }
      );
    }
  }

  public async getSeriesByTitle(title: string): Promise<SonarrSeries[]> {
    try {
      const response = await this.axios.get<SonarrSeries[]>('/series/lookup', {
        params: {
          term: title,
        },
      });

      if (!response.data[0]) {
        throw new Error('No series found');
      }

      return response.data;
    } catch (e) {
      logger.error('Error retrieving series by series title', {
        label: 'Sonarr API',
        errorMessage: e.message,
        title,
      });
      throw new Error('No series found', { cause: e });
    }
  }

  public async getSeriesByTvdbId(id: number): Promise<SonarrSeries> {
    let response: AxiosResponse<SonarrSeries[]>;
    try {
      response = await this.axios.get<SonarrSeries[]>('/series/lookup', {
        params: {
          term: `tvdb:${id}`,
        },
      });
    } catch (e) {
      logger.error('Error retrieving series by tvdb ID', {
        label: 'Sonarr API',
        errorMessage: e.message,
        tvdbId: id,
      });
      throw e;
    }

    if (!response.data[0]) {
      throw new Error('Series not found');
    }

    return response.data[0];
  }

  public async addSeries(options: AddSeriesOptions): Promise<SonarrSeries> {
    try {
      const series = await this.getSeriesByTvdbId(options.tvdbid);

      // If the series already exists, we will simply just update it
      if (series.id) {
        series.monitored = options.monitored ?? series.monitored;
        series.tags = options.tags
          ? Array.from(new Set([...series.tags, ...options.tags]))
          : series.tags;
        series.seasons = this.buildSeasonList(options.seasons, series.seasons);

        const newSeriesResponse = await this.axios.put<SonarrSeries>(
          '/series',
          series
        );

        if (newSeriesResponse.data.id) {
          logger.info('Updated existing series in Sonarr.', {
            label: 'Sonarr',
            seriesId: newSeriesResponse.data.id,
            seriesTitle: newSeriesResponse.data.title,
          });
          logger.debug('Sonarr update details', {
            label: 'Sonarr',
            series: newSeriesResponse.data,
          });

          try {
            const episodes = await this.getEpisodes(newSeriesResponse.data.id);
            const episodeIdsToMonitor = episodes
              .filter(
                (ep) =>
                  options.seasons.includes(ep.seasonNumber) && !ep.monitored
              )
              .map((ep) => ep.id);

            if (episodeIdsToMonitor.length > 0) {
              logger.debug(
                'Re-monitoring unmonitored episodes for requested seasons.',
                {
                  label: 'Sonarr',
                  seriesId: newSeriesResponse.data.id,
                  episodeCount: episodeIdsToMonitor.length,
                }
              );
              await this.monitorEpisodes(episodeIdsToMonitor);
            }
          } catch (e) {
            logger.warn('Failed to re-monitor episodes', {
              label: 'Sonarr',
              errorMessage: e.message,
              seriesId: newSeriesResponse.data.id,
            });
          }

          if (options.searchNow) {
            this.searchSeries(newSeriesResponse.data.id);
          }

          return newSeriesResponse.data;
        } else {
          logger.error('Failed to update series in Sonarr', {
            label: 'Sonarr',
            options,
          });
          throw new Error('Failed to update series in Sonarr');
        }
      }

      const createdSeriesResponse = await this.axios.post<SonarrSeries>(
        '/series',
        {
          tvdbId: options.tvdbid,
          title: options.title,
          qualityProfileId: options.profileId,
          languageProfileId: options.languageProfileId,
          seasons: this.buildSeasonList(
            options.seasons,
            series.seasons.map((season) => ({
              seasonNumber: season.seasonNumber,
              // We force all seasons to false if its the first request
              monitored: false,
            }))
          ),
          tags: options.tags,
          seasonFolder: options.seasonFolder,
          monitored: options.monitored,
          monitorNewItems: options.monitorNewItems,
          rootFolderPath: options.rootFolderPath,
          seriesType: options.seriesType,
          addOptions: {
            ignoreEpisodesWithFiles: true,
            searchForMissingEpisodes: options.searchNow,
          },
        } as Partial<SonarrSeries>
      );

      if (createdSeriesResponse.data.id) {
        logger.info('Sonarr accepted request', { label: 'Sonarr' });
        logger.debug('Sonarr add details', {
          label: 'Sonarr',
          series: createdSeriesResponse.data,
        });
      } else {
        logger.error('Failed to add series to Sonarr', {
          label: 'Sonarr',
          options,
        });
        throw new Error('Failed to add series to Sonarr');
      }

      return createdSeriesResponse.data;
    } catch (e) {
      logger.error('Something went wrong while adding a series to Sonarr.', {
        label: 'Sonarr API',
        errorMessage: e.message,
        options,
        response: e?.response?.data,
      });
      throw new Error('Failed to add series', { cause: e });
    }
  }

  public async getLanguageProfiles(): Promise<LanguageProfile[]> {
    try {
      const data = await this.getRolling<LanguageProfile[]>(
        '/languageprofile',
        undefined,
        3600
      );

      return data;
    } catch (e) {
      logger.error(
        'Something went wrong while retrieving Sonarr language profiles.',
        {
          label: 'Sonarr API',
          errorMessage: e.message,
        }
      );

      throw new Error('Failed to get language profiles', { cause: e });
    }
  }

  public async searchSeries(seriesId: number): Promise<void> {
    logger.info('Executing series search command.', {
      label: 'Sonarr API',
      seriesId,
    });

    try {
      await this.runCommand('MissingEpisodeSearch', { seriesId });
    } catch (e) {
      logger.error(
        'Something went wrong while executing Sonarr missing episode search.',
        {
          label: 'Sonarr API',
          errorMessage: e.message,
          seriesId,
        }
      );
    }
  }

  public async getEpisodes(seriesId: number): Promise<EpisodeResult[]> {
    try {
      const response = await this.axios.get<EpisodeResult[]>('/episode', {
        params: { seriesId },
      });
      return response.data;
    } catch (e) {
      logger.error('Failed to retrieve episodes', {
        label: 'Sonarr API',
        errorMessage: e.message,
        seriesId,
      });
      throw new Error('Failed to get episodes', { cause: e });
    }
  }

  public async monitorEpisodes(episodeIds: number[]): Promise<void> {
    try {
      await this.axios.put('/episode/monitor', {
        episodeIds,
        monitored: true,
      });
    } catch (e) {
      logger.error('Failed to monitor episodes', {
        label: 'Sonarr API',
        errorMessage: e.message,
        episodeIds,
      });
      throw new Error('Failed to monitor episodes', { cause: e });
    }
  }

  private buildSeasonList(
    seasons: number[],
    existingSeasons?: SonarrSeason[]
  ): SonarrSeason[] {
    if (existingSeasons) {
      const newSeasons = existingSeasons.map((season) => {
        if (seasons.includes(season.seasonNumber)) {
          season.monitored = true;
        }
        return season;
      });

      return newSeasons;
    }

    const newSeasons = seasons.map(
      (seasonNumber): SonarrSeason => ({
        seasonNumber,
        monitored: true,
      })
    );

    return newSeasons;
  }
  public removeSeries = async (tvdbId: number): Promise<void> => {
    const { id, title } = await this.getSeriesByTvdbId(tvdbId);

    if (!id) {
      logger.info(`[Sonarr] Series not in library, nothing to remove`, {
        tvdbId,
      });
      return;
    }

    try {
      await this.axios.delete(`/series/${id}`, {
        params: {
          deleteFiles: true,
          addImportExclusion: false,
        },
      });
      logger.info(`[Sonarr] Removed series ${title}`);
    } catch (e) {
      if (e?.response?.status === 404) {
        logger.info(`[Sonarr] Series already removed from Sonarr`, {
          tvdbId,
        });
        return;
      }
      throw e;
    }
  };

  public clearCache = ({
    tvdbId,
    externalId,
    title,
  }: {
    tvdbId?: number | null;
    externalId?: number | null;
    title?: string | null;
  }) => {
    if (tvdbId) {
      this.removeCache('/series/lookup', {
        term: `tvdb:${tvdbId}`,
      });
    }
    if (externalId) {
      this.removeCache(`/series/${externalId}`);
    }
    if (title) {
      this.removeCache('/series/lookup', {
        term: title,
      });
    }
  };
}

export default SonarrAPI;
