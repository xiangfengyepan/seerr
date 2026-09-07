import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import { SmallLoadingSpinner } from '@app/components/Common/LoadingSpinner';
import Tooltip from '@app/components/Common/Tooltip';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { formatBytes } from '@app/utils/numberHelpers';
import { Listbox, Transition } from '@headlessui/react';
import {
  ChevronDownIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/solid';
import type { ParsedRelease } from '@server/interfaces/api/interactiveSearchInterfaces';
import { Fragment, useMemo } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.RequestModal.InteractiveSearch', {
  searchingindexers: 'Searching indexers… this can take a while.',
  noreleases: 'No releases found.',
  videoquality: 'Video Quality',
  audiolanguage: 'Audio Language',
  audiocodec: 'Audio Codec',
  any: 'Any',
  select: 'Select',
  selected: 'Selected',
  rejected: 'Rejected',
  seeders: '{count} seeders',
  nofilteredreleases: 'No releases match the selected filters.',
});

export const ANY = '__any__';

// A release the user picked in the modal. It is NOT grabbed on selection; it is
// carried on the request and grabbed only when the user hits Request (and, for
// non-admins, once an admin approves).
export interface SelectedRelease {
  guid: string;
  indexerId: number;
  /** Season the release belongs to (TV only). */
  season?: number;
  /** Sonarr episode id, when the release is for a single episode (TV only). */
  episodeId?: number;
}

// The three release filters, shared across the whole interactive search (the
// season list and every per-episode list) so a single choice applies to all.
export interface ReleaseFilters {
  quality: string;
  language: string;
  codec: string;
}

export const emptyReleaseFilters: ReleaseFilters = {
  quality: ANY,
  language: ANY,
  codec: ANY,
};

/** Distinct, sorted option lists for each filter, derived from releases. */
export const computeFilterOptions = (results?: ParsedRelease[]) => ({
  quality: Array.from(
    new Set((results ?? []).map((r) => r.videoQuality).filter(Boolean))
  ).sort(),
  language: Array.from(
    new Set((results ?? []).flatMap((r) => r.audioLanguages))
  ).sort(),
  codec: Array.from(
    new Set(
      (results ?? []).map((r) => r.audioCodec).filter((c): c is string => !!c)
    )
  ).sort(),
});

/** Apply the shared filters to a release list. Quality is a STRICT gate;
 * language and codec are best-effort (unknown values are never hidden). */
export const applyReleaseFilters = (
  results: ParsedRelease[] | undefined,
  filters: ReleaseFilters
): ParsedRelease[] =>
  (results ?? []).filter((release) => {
    if (filters.quality !== ANY && release.videoQuality !== filters.quality) {
      return false;
    }
    if (
      filters.language !== ANY &&
      release.audioLanguages.length > 0 &&
      !release.audioLanguages.includes(filters.language)
    ) {
      return false;
    }
    if (
      filters.codec !== ANY &&
      release.audioCodec !== null &&
      release.audioCodec !== filters.codec
    ) {
      return false;
    }
    return true;
  });

interface ReleaseListProps {
  mediaType: 'movie' | 'tv';
  serverId?: number;
  tmdbId?: number;
  tvdbId?: number;
  seasonNumber?: number;
  episodeId?: number;
  results?: ParsedRelease[];
  isLoading: boolean;
  error?: unknown;
  /** Shared filter values, owned by the top-level interactive search. */
  filters: ReleaseFilters;
  /** guids of every currently selected release across the whole modal. A
   * release renders as "Selected" when its guid is in this list. Movies pass a
   * 0/1-length list (single select); TV accumulates one pick per episode plus an
   * optional whole-season pack. */
  selectedGuids?: string[];
  onSelect?: (release: SelectedRelease | null) => void;
}

interface FilterDropdownProps {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  anyLabel: string;
}

const FilterDropdown = ({
  label,
  value,
  options,
  onChange,
  anyLabel,
}: FilterDropdownProps) => {
  return (
    <Listbox as="div" value={value} onChange={onChange} className="space-y-1">
      {({ open }) => (
        <>
          <Listbox.Label className="text-sm font-medium text-gray-300">
            {label}
          </Listbox.Label>
          <div className="relative">
            <span className="inline-block w-full rounded-md shadow-sm">
              <Listbox.Button className="focus:shadow-outline-blue relative w-full cursor-default rounded-md border border-gray-700 bg-gray-800 py-2 pl-3 pr-10 text-left text-white transition duration-150 ease-in-out focus:border-blue-300 focus:outline-none sm:text-sm sm:leading-5">
                <span className="block truncate">
                  {value === ANY ? anyLabel : value}
                </span>
                <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2 text-gray-500">
                  <ChevronDownIcon className="h-5 w-5" />
                </span>
              </Listbox.Button>
            </span>
            <Transition
              show={open}
              as={Fragment}
              leave="transition ease-in duration-100"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <Listbox.Options
                static
                className="shadow-xs absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-gray-700 bg-gray-800 py-1 text-base leading-6 shadow-lg focus:outline-none sm:text-sm sm:leading-5"
              >
                {[ANY, ...options].map((option) => (
                  <Listbox.Option key={option} value={option}>
                    {({ selected, active }) => (
                      <div
                        className={`${
                          active ? 'bg-indigo-600 text-white' : 'text-gray-300'
                        } relative cursor-default select-none py-2 pl-3 pr-9`}
                      >
                        <span
                          className={`${
                            selected ? 'font-semibold' : 'font-normal'
                          } block truncate`}
                        >
                          {option === ANY ? anyLabel : option}
                        </span>
                      </div>
                    )}
                  </Listbox.Option>
                ))}
              </Listbox.Options>
            </Transition>
          </div>
        </>
      )}
    </Listbox>
  );
};

/**
 * The shared filter bar. Rendered ONCE at the top of the interactive search;
 * the chosen values apply to the season list and every per-episode list. The
 * `options` are derived once (from the season results) by the parent.
 */
export const FilterBar = ({
  filters,
  options,
  onChange,
}: {
  filters: ReleaseFilters;
  options: { quality: string[]; language: string[]; codec: string[] };
  onChange: (filters: ReleaseFilters) => void;
}) => {
  const intl = useIntl();
  const anyLabel = intl.formatMessage(messages.any);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <FilterDropdown
        label={intl.formatMessage(messages.videoquality)}
        value={filters.quality}
        options={options.quality}
        onChange={(quality) => onChange({ ...filters, quality })}
        anyLabel={anyLabel}
      />
      <FilterDropdown
        label={intl.formatMessage(messages.audiolanguage)}
        value={filters.language}
        options={options.language}
        onChange={(language) => onChange({ ...filters, language })}
        anyLabel={anyLabel}
      />
      <FilterDropdown
        label={intl.formatMessage(messages.audiocodec)}
        value={filters.codec}
        options={options.codec}
        onChange={(codec) => onChange({ ...filters, codec })}
        anyLabel={anyLabel}
      />
    </div>
  );
};

const ReleaseList = ({
  seasonNumber,
  episodeId,
  results,
  isLoading,
  error,
  filters,
  selectedGuids,
  onSelect,
}: ReleaseListProps) => {
  const intl = useIntl();

  const filteredResults = useMemo(
    () => applyReleaseFilters(results, filters),
    [results, filters]
  );

  // The click always reports the clicked release; the parent decides whether it
  // is a new pick, a replacement for the same episode/season-pack, or a toggle
  // off (re-selecting the same release). This keeps the multi-select rules in
  // one place (the modal) and lets movies reuse the same list for single select.
  const select = (release: ParsedRelease) => {
    if (!onSelect) {
      return;
    }
    onSelect({
      guid: release.guid,
      indexerId: release.indexerId,
      season: seasonNumber,
      episodeId,
    });
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-6">
        <SmallLoadingSpinner />
        <span className="mt-2 text-sm text-gray-400">
          {intl.formatMessage(messages.searchingindexers)}
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-6 text-center text-sm text-gray-400">
        {intl.formatMessage(globalMessages.error)}
      </div>
    );
  }

  if (!results || results.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-gray-400">
        {intl.formatMessage(messages.noreleases)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {filteredResults.length === 0 ? (
        <div className="py-6 text-center text-sm text-gray-400">
          {intl.formatMessage(messages.nofilteredreleases)}
        </div>
      ) : (
        <ul className="space-y-2">
          {filteredResults.map((release) => {
            const isSelected = selectedGuids?.includes(release.guid) ?? false;
            return (
              <li
                key={release.guid}
                className={`rounded-md border p-3 ${
                  isSelected
                    ? 'border-indigo-500 bg-gray-800 ring-1 ring-indigo-500'
                    : 'border-gray-700'
                } ${
                  release.rejected && !isSelected
                    ? 'bg-gray-800/40 opacity-60'
                    : 'bg-gray-800'
                }`}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      {release.rejected && (
                        <Tooltip
                          content={
                            release.rejectionReasons.length > 0 ? (
                              <ul className="max-w-xs list-disc space-y-1 pl-4">
                                {release.rejectionReasons.map((reason, i) => (
                                  <li key={i}>{reason}</li>
                                ))}
                              </ul>
                            ) : (
                              intl.formatMessage(messages.rejected)
                            )
                          }
                        >
                          <span className="inline-flex flex-shrink-0 text-yellow-500">
                            <ExclamationTriangleIcon className="h-5 w-5" />
                          </span>
                        </Tooltip>
                      )}
                      <span
                        className="truncate text-sm font-medium text-gray-100"
                        title={release.title}
                      >
                        {release.title}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge badgeType="primary">{release.videoQuality}</Badge>
                      {release.videoCodec && (
                        <Badge badgeType="light">{release.videoCodec}</Badge>
                      )}
                      {release.source && release.source !== 'Unknown' && (
                        <Badge badgeType="light">{release.source}</Badge>
                      )}
                      {release.audioLanguages.map((lang) => (
                        <Badge key={lang} badgeType="dark">
                          {lang}
                        </Badge>
                      ))}
                      {release.audioCodec && (
                        <Badge badgeType="light">
                          {release.audioCodec}
                          {release.audioChannels
                            ? ` ${release.audioChannels}`
                            : ''}
                        </Badge>
                      )}
                      {release.rejected && (
                        <Badge badgeType="danger">
                          {intl.formatMessage(messages.rejected)}
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-400">
                      <span>{formatBytes(release.sizeBytes)}</span>
                      {release.seeders !== null && (
                        <span>
                          {intl.formatMessage(messages.seeders, {
                            count: release.seeders,
                          })}
                        </span>
                      )}
                      <span>{release.indexer}</span>
                    </div>
                  </div>
                  <div className="flex-shrink-0">
                    <Button
                      buttonType={isSelected ? 'primary' : 'default'}
                      buttonSize="sm"
                      onClick={() => select(release)}
                    >
                      {intl.formatMessage(
                        isSelected ? messages.selected : messages.select
                      )}
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default ReleaseList;
