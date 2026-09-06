import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import { SmallLoadingSpinner } from '@app/components/Common/LoadingSpinner';
import Tooltip from '@app/components/Common/Tooltip';
import useToasts from '@app/hooks/useToasts';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { formatBytes } from '@app/utils/numberHelpers';
import { Listbox, Transition } from '@headlessui/react';
import {
  ChevronDownIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/solid';
import type {
  GrabReleaseResponse,
  ParsedRelease,
} from '@server/interfaces/api/interactiveSearchInterfaces';
import axios from 'axios';
import { Fragment, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.RequestModal.InteractiveSearch', {
  searchingindexers: 'Searching indexers… this can take a while.',
  noreleases: 'No releases found.',
  videoquality: 'Video Quality',
  audiolanguage: 'Audio Language',
  audiocodec: 'Audio Codec',
  any: 'Any',
  grab: 'Grab',
  grabbing: 'Grabbing…',
  grabbed: 'Release grabbed successfully!',
  grabpending: 'Your grab request is pending approval.',
  graberror: 'Something went wrong while grabbing the release.',
  rejected: 'Rejected',
  seeders: '{count} seeders',
  nofilteredreleases: 'No releases match the selected filters.',
});

const ANY = '__any__';

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
  onGrab?: () => void;
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

const ReleaseList = ({
  mediaType,
  serverId,
  tmdbId,
  tvdbId,
  seasonNumber,
  episodeId,
  results,
  isLoading,
  error,
  onGrab,
}: ReleaseListProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const [qualityFilter, setQualityFilter] = useState<string>(ANY);
  const [languageFilter, setLanguageFilter] = useState<string>(ANY);
  const [codecFilter, setCodecFilter] = useState<string>(ANY);
  const [grabbingGuid, setGrabbingGuid] = useState<string | null>(null);
  const [grabbedGuids, setGrabbedGuids] = useState<string[]>([]);

  const qualityOptions = useMemo(
    () =>
      Array.from(
        new Set((results ?? []).map((r) => r.videoQuality).filter(Boolean))
      ).sort(),
    [results]
  );
  const languageOptions = useMemo(
    () =>
      Array.from(
        new Set((results ?? []).flatMap((r) => r.audioLanguages))
      ).sort(),
    [results]
  );
  const codecOptions = useMemo(
    () =>
      Array.from(
        new Set(
          (results ?? [])
            .map((r) => r.audioCodec)
            .filter((c): c is string => !!c)
        )
      ).sort(),
    [results]
  );

  const filteredResults = useMemo(
    () =>
      (results ?? []).filter((release) => {
        // Video quality is a STRICT gate.
        if (qualityFilter !== ANY && release.videoQuality !== qualityFilter) {
          return false;
        }
        // Audio language is BEST-EFFORT: never hide a release whose languages
        // are unknown (empty).
        if (
          languageFilter !== ANY &&
          release.audioLanguages.length > 0 &&
          !release.audioLanguages.includes(languageFilter)
        ) {
          return false;
        }
        // Audio codec is BEST-EFFORT: never hide a release with an unknown
        // (null) codec.
        if (
          codecFilter !== ANY &&
          release.audioCodec !== null &&
          release.audioCodec !== codecFilter
        ) {
          return false;
        }
        return true;
      }),
    [results, qualityFilter, languageFilter, codecFilter]
  );

  const grab = async (release: ParsedRelease) => {
    setGrabbingGuid(release.guid);
    try {
      const response = await axios.post<GrabReleaseResponse>(
        '/api/v1/release/grab',
        {
          mediaType,
          serverId,
          guid: release.guid,
          indexerId: release.indexerId,
          tmdbId,
          tvdbId,
          seasonNumber,
          episodeId,
        }
      );
      setGrabbedGuids((prev) => [...prev, release.guid]);
      addToast(
        intl.formatMessage(
          response.data.pendingApproval
            ? messages.grabpending
            : messages.grabbed
        ),
        {
          appearance: response.data.pendingApproval ? 'info' : 'success',
          autoDismiss: true,
        }
      );
      if (onGrab) {
        onGrab();
      }
    } catch {
      addToast(intl.formatMessage(messages.graberror), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setGrabbingGuid(null);
    }
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

  const anyLabel = intl.formatMessage(messages.any);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FilterDropdown
          label={intl.formatMessage(messages.videoquality)}
          value={qualityFilter}
          options={qualityOptions}
          onChange={setQualityFilter}
          anyLabel={anyLabel}
        />
        <FilterDropdown
          label={intl.formatMessage(messages.audiolanguage)}
          value={languageFilter}
          options={languageOptions}
          onChange={setLanguageFilter}
          anyLabel={anyLabel}
        />
        <FilterDropdown
          label={intl.formatMessage(messages.audiocodec)}
          value={codecFilter}
          options={codecOptions}
          onChange={setCodecFilter}
          anyLabel={anyLabel}
        />
      </div>

      {filteredResults.length === 0 ? (
        <div className="py-6 text-center text-sm text-gray-400">
          {intl.formatMessage(messages.nofilteredreleases)}
        </div>
      ) : (
        <ul className="space-y-2">
          {filteredResults.map((release) => {
            const isGrabbing = grabbingGuid === release.guid;
            const isGrabbed = grabbedGuids.includes(release.guid);
            return (
              <li
                key={release.guid}
                className={`rounded-md border border-gray-700 p-3 ${
                  release.rejected ? 'bg-gray-800/40 opacity-60' : 'bg-gray-800'
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
                      buttonType="primary"
                      buttonSize="sm"
                      disabled={isGrabbing || isGrabbed}
                      onClick={() => grab(release)}
                    >
                      {isGrabbed
                        ? intl.formatMessage(messages.grabbed)
                        : isGrabbing
                          ? intl.formatMessage(messages.grabbing)
                          : intl.formatMessage(messages.grab)}
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
