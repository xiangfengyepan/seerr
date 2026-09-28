import logger from '@server/logger';
import type { AxiosResponse } from 'axios';
import ServarrBase from './base';

export interface RadarrMovieOptions {
  title: string;
  qualityProfileId: number;
  minimumAvailability: string;
  tags: number[];
  profileId: number;
  year: number;
  rootFolderPath: string;
  tmdbId: number;
  monitored?: boolean;
  searchNow?: boolean;
}

export interface RadarrMovie {
  id: number;
  title: string;
  isAvailable: boolean;
  monitored: boolean;
  tmdbId: number;
  imdbId: string;
  titleSlug: string;
  folderName: string;
  path: string;
  profileId: number;
  qualityProfileId: number;
  added: string;
  hasFile: boolean;
  tags: number[];
  movieFile?: {
    id: number;
    movieId: number;
    relativePath?: string;
    path?: string;
    size: number;
    dateAdded: string;
    sceneName?: string;
    releaseGroup?: string;
    edition?: string;
    indexerFlags?: number;
    mediaInfo: {
      id: number;
      audioBitrate: number;
      audioChannels: number;
      audioCodec?: string;
      audioLanguages?: string;
      audioStreamCount: number;
      videoBitDepth: number;
      videoBitrate: number;
      videoCodec?: string;
      videoFps: number;
      videoDynamicRange?: string;
      videoDynamicRangeType?: string;
      resolution?: string;
      runTime?: string;
      scanType?: string;
      subtitles?: string;
    };
    originalFilePath?: string;
    qualityCutoffNotMet: boolean;
  };
}

export interface RadarrRelease {
  guid: string;
  quality: {
    quality: {
      id: number;
      name: string;
      source?: string;
      resolution?: number;
      modifier?: string;
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
  sceneSource?: boolean;
  movieTitles?: string[];
  languages?: { id: number; name: string }[];
  mappedMovieId?: number;
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

export interface RadarrReleaseGrabResponse {
  guid: string;
  [key: string]: unknown;
}

class RadarrAPI extends ServarrBase<{ movieId: number }> {
  constructor({ url, apiKey }: { url: string; apiKey: string }) {
    super({ url, apiKey, cacheName: 'radarr', apiName: 'Radarr' });
  }

  /**
   * Interactive search: fetch the actual releases the indexers return for a
   * given Radarr movie. The movie must already exist in Radarr.
   */
  public getReleases = async (movieId: number): Promise<RadarrRelease[]> => {
    try {
      const response = await this.axios.get<RadarrRelease[]>('/release', {
        params: { movieId },
        // Interactive indexer searches routinely take far longer than the
        // global Servarr apiRequestTimeout (~10s); allow up to 90s here.
        timeout: 90000,
      });

      return response.data;
    } catch (e) {
      throw new Error(`[Radarr] Failed to retrieve releases: ${e.message}`, {
        cause: e,
      });
    }
  };

  /**
   * Ensure a movie exists in Radarr so an interactive release search can run
   * against it. If the movie is not yet in the library it is added UNMONITORED
   * with no automatic search, on the supplied (permissive) quality profile.
   * Returns the Radarr movie record (with its internal id).
   */
  public ensureMovie = async (options: {
    tmdbId: number;
    title: string;
    year: number;
    qualityProfileId: number;
    rootFolderPath: string;
    minimumAvailability: string;
  }): Promise<RadarrMovie> => {
    const lookup = await this.getMovieByTmdbId(options.tmdbId);

    // Already in the Radarr library.
    if (lookup.id) {
      return lookup;
    }

    try {
      const response = await this.axios.post<RadarrMovie>('/movie', {
        title: options.title,
        qualityProfileId: options.qualityProfileId,
        profileId: options.qualityProfileId,
        titleSlug: options.tmdbId.toString(),
        minimumAvailability: options.minimumAvailability,
        tmdbId: options.tmdbId,
        year: options.year,
        rootFolderPath: options.rootFolderPath,
        monitored: false,
        tags: [],
        addOptions: {
          searchForMovie: false,
        },
      });

      if (!response.data.id) {
        throw new Error('Radarr did not return a movie id');
      }

      logger.info(
        'Added movie to Radarr (unmonitored) for interactive search',
        {
          label: 'Radarr',
          movieId: response.data.id,
          tmdbId: options.tmdbId,
        }
      );

      return response.data;
    } catch (e) {
      throw new Error(
        `[Radarr] Failed to add movie for interactive search: ${e.message}`,
        { cause: e }
      );
    }
  };

  /**
   * Interactive grab: tell Radarr to download a specific release the user
   * picked. Radarr accepts the release regardless of quality profile when the
   * movie sits on a permissive ("Any") profile.
   */
  public grabRelease = async ({
    guid,
    indexerId,
  }: {
    guid: string;
    indexerId: number;
  }): Promise<RadarrReleaseGrabResponse> => {
    try {
      const response = await this.axios.post<RadarrReleaseGrabResponse>(
        '/release',
        { guid, indexerId }
      );

      return response.data;
    } catch (e) {
      throw new Error(`[Radarr] Failed to grab release: ${e.message}`, {
        cause: e,
      });
    }
  };

  public getMovies = async (): Promise<RadarrMovie[]> => {
    try {
      const response = await this.axios.get<RadarrMovie[]>('/movie');

      return response.data;
    } catch (e) {
      throw new Error(`[Radarr] Failed to retrieve movies: ${e.message}`, {
        cause: e,
      });
    }
  };

  public getLibraryMoviesByTmdbId = async (
    tmdbId: number
  ): Promise<RadarrMovie[]> => {
    try {
      const response = await this.axios.get<RadarrMovie[]>('/movie', {
        params: { tmdbId },
      });

      return response.data;
    } catch (e) {
      throw new Error(
        `[Radarr] Failed to retrieve movies by TMDB ID: ${e.message}`,
        { cause: e }
      );
    }
  };

  public getMovie = async ({ id }: { id: number }): Promise<RadarrMovie> => {
    try {
      const response = await this.axios.get<RadarrMovie>(`/movie/${id}`);

      return response.data;
    } catch (e) {
      throw new Error(`[Radarr] Failed to retrieve movie: ${e.message}`, {
        cause: e,
      });
    }
  };

  public async getMovieByTmdbId(id: number): Promise<RadarrMovie> {
    let response: AxiosResponse<RadarrMovie[]>;
    try {
      response = await this.axios.get<RadarrMovie[]>('/movie/lookup', {
        params: {
          term: `tmdb:${id}`,
        },
      });
    } catch (e) {
      logger.error('Error retrieving movie by TMDB ID', {
        label: 'Radarr API',
        errorMessage: e.message,
        tmdbId: id,
      });
      throw e;
    }

    if (!response.data[0]) {
      throw new Error('Movie not found');
    }

    return response.data[0];
  }

  public addMovie = async (
    options: RadarrMovieOptions
  ): Promise<RadarrMovie> => {
    try {
      const movie = await this.getMovieByTmdbId(options.tmdbId);

      if (movie.hasFile) {
        logger.info(
          'Title already exists and is available. Skipping add and returning success',
          {
            label: 'Radarr',
            movie,
          }
        );
        return movie;
      }

      // movie exists in Radarr but is neither downloaded nor monitored
      if (movie.id && !movie.monitored) {
        const response = await this.axios.put<RadarrMovie>(`/movie`, {
          ...movie,
          title: options.title,
          qualityProfileId: options.qualityProfileId,
          profileId: options.profileId,
          titleSlug: options.tmdbId.toString(),
          minimumAvailability: options.minimumAvailability,
          tmdbId: options.tmdbId,
          year: options.year,
          tags: Array.from(new Set([...movie.tags, ...options.tags])),
          rootFolderPath: options.rootFolderPath,
          monitored: options.monitored,
          addOptions: {
            searchForMovie: options.searchNow,
          },
        });

        if (response.data.monitored) {
          logger.info(
            'Found existing title in Radarr and set it to monitored.',
            {
              label: 'Radarr',
              movieId: response.data.id,
              movieTitle: response.data.title,
            }
          );
          logger.debug('Radarr update details', {
            label: 'Radarr',
            movie: response.data,
          });

          if (options.searchNow) {
            this.searchMovie(response.data.id);
          }

          return response.data;
        } else {
          logger.error('Failed to update existing movie in Radarr.', {
            label: 'Radarr',
            options,
          });
          throw new Error('Failed to update existing movie in Radarr');
        }
      }

      if (movie.id) {
        // Movie exists and is already monitored
        logger.info('Movie is already monitored in Radarr.', {
          label: 'Radarr',
          movieId: movie.id,
          movieTitle: movie.title,
          hasFile: movie.hasFile,
        });

        // If searchNow is requested and movie doesn't have a file, trigger search
        if (options.searchNow && !movie.hasFile) {
          logger.info(
            'Triggering search for existing monitored movie without file',
            {
              label: 'Radarr',
              movieId: movie.id,
              movieTitle: movie.title,
            }
          );
          this.searchMovie(movie.id);
        }

        return movie;
      }

      const response = await this.axios.post<RadarrMovie>(`/movie`, {
        title: options.title,
        qualityProfileId: options.qualityProfileId,
        profileId: options.profileId,
        titleSlug: options.tmdbId.toString(),
        minimumAvailability: options.minimumAvailability,
        tmdbId: options.tmdbId,
        year: options.year,
        rootFolderPath: options.rootFolderPath,
        monitored: options.monitored,
        tags: options.tags,
        addOptions: {
          searchForMovie: options.searchNow,
        },
      });

      if (response.data.id) {
        logger.info('Radarr accepted request', { label: 'Radarr' });
        logger.debug('Radarr add details', {
          label: 'Radarr',
          movie: response.data,
        });
      } else {
        logger.error('Failed to add movie to Radarr', {
          label: 'Radarr',
          options,
        });
        throw new Error('Failed to add movie to Radarr');
      }
      return response.data;
    } catch (e) {
      logger.error(
        'Failed to add movie to Radarr. This might happen if the movie already exists, in which case you can safely ignore this error.',
        {
          label: 'Radarr',
          errorMessage: e.message,
          options,
          response: e?.response?.data,
        }
      );
      throw new Error('Failed to add movie to Radarr', { cause: e });
    }
  };

  public async searchMovie(movieId: number): Promise<void> {
    logger.info('Executing movie search command', {
      label: 'Radarr API',
      movieId,
    });

    try {
      await this.runCommand('MoviesSearch', { movieIds: [movieId] });
    } catch (e) {
      logger.error(
        'Something went wrong while executing Radarr movie search.',
        {
          label: 'Radarr API',
          errorMessage: e.message,
          movieId,
        }
      );
    }
  }
  public removeMovie = async (tmdbId: number): Promise<void> => {
    const { id, title } = await this.getMovieByTmdbId(tmdbId);

    if (!id) {
      logger.info(`[Radarr] Movie not in library, nothing to remove`, {
        tmdbId,
      });
      return;
    }

    try {
      await this.axios.delete(`/movie/${id}`, {
        params: {
          deleteFiles: true,
          addImportExclusion: false,
        },
      });
      logger.info(`[Radarr] Removed movie ${title}`);
    } catch (e) {
      if (e?.response?.status === 404) {
        logger.info(`[Radarr] Movie already removed from Radarr`, {
          tmdbId,
        });
        return;
      }
      throw e;
    }
  };

  public clearCache = ({
    tmdbId,
    externalId,
  }: {
    tmdbId?: number | null;
    externalId?: number | null;
  }) => {
    if (tmdbId) {
      this.removeCache('/movie/lookup', {
        term: `tmdb:${tmdbId}`,
      });
    }
    if (externalId) {
      this.removeCache(`/movie/${externalId}`);
    }
  };
}

export default RadarrAPI;
