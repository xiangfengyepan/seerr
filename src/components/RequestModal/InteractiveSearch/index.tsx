import Button from '@app/components/Common/Button';
import ReleaseList, {
  computeFilterOptions,
  emptyReleaseFilters,
  FilterBar,
  type ReleaseFilters,
  type SelectedRelease,
} from '@app/components/RequestModal/InteractiveSearch/ReleaseList';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/solid';
import type {
  InteractiveSearchResponse,
  InteractiveSearchTvResponse,
} from '@server/interfaces/api/interactiveSearchInterfaces';
import { useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.RequestModal.InteractiveSearch', {
  seasonreleases: 'Season Releases',
  episodes: 'Individual Episodes',
  episodenumber: 'Episode {number}',
  searchepisode: 'Search Releases',
  hide: 'Hide',
});

interface InteractiveSearchProps {
  mediaType: 'movie' | 'tv';
  tmdbId?: number;
  tvdbId?: number;
  season?: number;
  episodeId?: number;
  serverId?: number;
  selectedGuids?: string[];
  onSelect?: (release: SelectedRelease | null) => void;
  /**
   * When provided, this instance is CONTROLLED by a parent (a per-episode
   * search): it uses these shared filter values and renders no filter bar of
   * its own. When omitted, the instance owns the filters and renders the single
   * shared bar for the whole season.
   */
  filters?: ReleaseFilters;
}

const buildUrl = ({
  mediaType,
  tmdbId,
  tvdbId,
  season,
  episodeId,
  serverId,
}: InteractiveSearchProps): string | null => {
  const serverParam =
    serverId !== undefined && serverId >= 0 ? serverId : undefined;

  if (mediaType === 'movie') {
    if (tmdbId === undefined) {
      return null;
    }
    return `/api/v1/release/movie/${tmdbId}${
      serverParam !== undefined ? `?serverId=${serverParam}` : ''
    }`;
  }

  if (tvdbId === undefined) {
    return null;
  }

  if (episodeId !== undefined) {
    return `/api/v1/release/tv/${tvdbId}/episode/${episodeId}${
      serverParam !== undefined ? `?serverId=${serverParam}` : ''
    }`;
  }

  const params = new URLSearchParams();
  if (season !== undefined) {
    params.set('season', String(season));
  }
  if (serverParam !== undefined) {
    params.set('serverId', String(serverParam));
  }
  const query = params.toString();
  return `/api/v1/release/tv/${tvdbId}${query ? `?${query}` : ''}`;
};

const EpisodeSearch = ({
  tmdbId,
  tvdbId,
  season,
  episodeId,
  serverId,
  selectedGuids,
  onSelect,
  filters,
}: {
  tmdbId?: number;
  tvdbId: number;
  season: number;
  episodeId: number;
  serverId?: number;
  selectedGuids?: string[];
  onSelect?: (release: SelectedRelease | null) => void;
  filters: ReleaseFilters;
}) => {
  const intl = useIntl();
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <Button
        buttonType="ghost"
        buttonSize="sm"
        onClick={() => setExpanded((prev) => !prev)}
      >
        {expanded ? (
          <ChevronDownIcon className="mr-1 h-4 w-4" />
        ) : (
          <ChevronRightIcon className="mr-1 h-4 w-4" />
        )}
        {intl.formatMessage(expanded ? messages.hide : messages.searchepisode)}
      </Button>
      {expanded && (
        <div className="mt-3">
          <InteractiveSearch
            mediaType="tv"
            tmdbId={tmdbId}
            tvdbId={tvdbId}
            season={season}
            episodeId={episodeId}
            serverId={serverId}
            selectedGuids={selectedGuids}
            onSelect={onSelect}
            filters={filters}
          />
        </div>
      )}
    </div>
  );
};

const InteractiveSearch = (props: InteractiveSearchProps) => {
  const intl = useIntl();
  const url = buildUrl(props);
  const isSeason = props.mediaType === 'tv' && props.episodeId === undefined;

  const { data, error, isLoading } = useSWR<
    InteractiveSearchResponse | InteractiveSearchTvResponse
  >(url, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    shouldRetryOnError: false,
  });

  const resolvedServerId = data?.serverId ?? props.serverId;
  const episodes = data && 'episodes' in data ? (data.episodes ?? []) : [];

  // A per-episode search is CONTROLLED by its parent's filters. A top-level
  // search (movie, or a whole season) owns the filters and renders the single
  // shared bar; its choice applies to the season list AND every episode list.
  const controlled = props.filters !== undefined;
  const [ownFilters, setOwnFilters] =
    useState<ReleaseFilters>(emptyReleaseFilters);
  const filters = props.filters ?? ownFilters;

  // Filter options come from this (top) level's results, i.e. the season list.
  const options = useMemo(
    () => computeFilterOptions(data?.results),
    [data?.results]
  );

  return (
    <div className="space-y-4">
      {!controlled && (data?.results.length ?? 0) > 0 && (
        <FilterBar filters={filters} options={options} onChange={setOwnFilters} />
      )}
      {isSeason && (episodes.length > 0 || (data?.results.length ?? 0) > 0) && (
        <h4 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
          {intl.formatMessage(messages.seasonreleases)}
        </h4>
      )}
      <ReleaseList
        mediaType={props.mediaType}
        serverId={resolvedServerId}
        tmdbId={props.tmdbId}
        tvdbId={props.tvdbId}
        seasonNumber={props.season}
        episodeId={props.episodeId}
        results={data?.results}
        isLoading={isLoading}
        error={error}
        filters={filters}
        selectedGuids={props.selectedGuids}
        onSelect={props.onSelect}
      />

      {isSeason && episodes.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
            {intl.formatMessage(messages.episodes)}
          </h4>
          <ul className="divide-y divide-gray-700 rounded-md border border-gray-700">
            {episodes.map((episode) => (
              <li key={episode.id} className="px-3 py-3">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-sm text-gray-200">
                    <span className="font-medium">
                      {intl.formatMessage(messages.episodenumber, {
                        number: episode.episodeNumber,
                      })}
                    </span>
                    {episode.title ? ` – ${episode.title}` : ''}
                  </span>
                  {episode.hasFile && (
                    <span className="text-xs text-green-400">
                      {intl.formatMessage(globalMessages.available)}
                    </span>
                  )}
                </div>
                <div className="mt-2">
                  <EpisodeSearch
                    tmdbId={props.tmdbId}
                    tvdbId={props.tvdbId as number}
                    season={episode.seasonNumber}
                    episodeId={episode.id}
                    serverId={resolvedServerId}
                    selectedGuids={props.selectedGuids}
                    onSelect={props.onSelect}
                    filters={filters}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default InteractiveSearch;
