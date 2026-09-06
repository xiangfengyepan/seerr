import Header from '@app/components/Common/Header';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import TmdbTitleCard from '@app/components/TitleCard/TmdbTitleCard';
import useVerticalScroll from '@app/hooks/useVerticalScroll';
import globalMessages from '@app/i18n/globalMessages';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import { FilmIcon } from '@heroicons/react/24/solid';
import type { MediaResultsResponse } from '@server/interfaces/api/mediaInterfaces';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWRInfinite from 'swr/infinite';

const messages = defineMessages('components.AvailableMedia', {
  available: 'Available',
});

type MediaTypeFilter = 'all' | 'movie' | 'tv';

const isMediaTypeFilter = (value: unknown): value is MediaTypeFilter =>
  value === 'all' || value === 'movie' || value === 'tv';

const pageSize = 20;

const AvailableMedia = () => {
  const intl = useIntl();
  const [mediaType, setMediaType] = useState<MediaTypeFilter>('all');

  // Restore the last selected media type filter on mount.
  useEffect(() => {
    const stored = window.localStorage.getItem('available-media-type');
    if (isMediaTypeFilter(stored)) {
      setMediaType(stored);
    }
  }, []);

  const { data, error, size, setSize, isValidating } =
    useSWRInfinite<MediaResultsResponse>(
      (pageIndex, previousPageData) => {
        if (
          previousPageData &&
          pageIndex + 1 > previousPageData.pageInfo.pages
        ) {
          return null;
        }

        return `/api/v1/media?filter=allavailable&sort=mediaAdded&take=${pageSize}&skip=${
          pageIndex * pageSize
        }${mediaType !== 'all' ? `&mediaType=${mediaType}` : ''}`;
      },
      {
        initialSize: 1,
        revalidateFirstPage: false,
      }
    );

  const titles = (data ?? []).reduce(
    (results, page) => [...results, ...page.results],
    [] as MediaResultsResponse['results']
  );

  const isLoadingInitialData = !data && !error;
  const isLoadingMore =
    isLoadingInitialData ||
    (size > 0 && !!data && typeof data[size - 1] === 'undefined');
  const isEmpty = !isLoadingInitialData && titles.length === 0;
  const isReachingEnd =
    !!data &&
    data[data.length - 1]?.pageInfo.page >=
      data[data.length - 1]?.pageInfo.pages;

  const fetchMore = () => {
    setSize(size + 1);
  };

  useVerticalScroll(
    fetchMore,
    !isLoadingMore && !isEmpty && !isReachingEnd && !isValidating
  );

  const onChangeMediaType = (value: string) => {
    if (!isMediaTypeFilter(value)) {
      return;
    }
    setMediaType(value);
    setSize(1);
    window.localStorage.setItem('available-media-type', value);
  };

  if (error) {
    return <ErrorPage statusCode={500} />;
  }

  const title = intl.formatMessage(messages.available);

  return (
    <>
      <PageTitle title={title} />
      <div className="mb-4 flex flex-col justify-between lg:flex-row lg:items-end">
        <Header>{title}</Header>
        <div className="mt-2 flex flex-grow flex-col sm:flex-row lg:flex-grow-0">
          <div className="mb-2 flex flex-grow sm:mb-0 lg:flex-grow-0">
            <span className="inline-flex cursor-default items-center rounded-l-md border border-r-0 border-gray-500 bg-gray-800 px-3 text-gray-100 sm:text-sm">
              <FilmIcon className="h-6 w-6" />
            </span>
            <select
              id="mediaType"
              name="mediaType"
              className="rounded-r-only"
              value={mediaType}
              onChange={(e) => onChangeMediaType(e.target.value)}
            >
              <option value="all">
                {intl.formatMessage(globalMessages.all)}
              </option>
              <option value="movie">
                {intl.formatMessage(globalMessages.movies)}
              </option>
              <option value="tv">
                {intl.formatMessage(globalMessages.tvshows)}
              </option>
            </select>
          </div>
        </div>
      </div>
      {isLoadingInitialData ? (
        <LoadingSpinner />
      ) : isEmpty ? (
        <div className="mt-64 w-full text-center text-2xl text-gray-400">
          {intl.formatMessage(globalMessages.noresults)}
        </div>
      ) : (
        <ul className="cards-vertical">
          {titles.map((media) => (
            <li key={`available-media-${media.id}`}>
              <TmdbTitleCard
                id={media.id}
                tmdbId={media.tmdbId}
                tvdbId={media.tvdbId}
                type={media.mediaType}
                canExpand
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
};

export default AvailableMedia;
