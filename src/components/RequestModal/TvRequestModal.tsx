import Alert from '@app/components/Common/Alert';
import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import Modal from '@app/components/Common/Modal';
import type { RequestOverrides } from '@app/components/RequestModal/AdvancedRequester';
import AdvancedRequester from '@app/components/RequestModal/AdvancedRequester';
import InteractiveSearch from '@app/components/RequestModal/InteractiveSearch';
import type { SelectedRelease } from '@app/components/RequestModal/InteractiveSearch/ReleaseList';
import QuotaDisplay from '@app/components/RequestModal/QuotaDisplay';
import SearchByNameModal from '@app/components/RequestModal/SearchByNameModal';
import useSettings from '@app/hooks/useSettings';
import useToasts from '@app/hooks/useToasts';
import { useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import {
  ChevronDownIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/solid';
import { ANIME_KEYWORD_ID } from '@server/api/themoviedb/constants';
import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type SeasonRequest from '@server/entity/SeasonRequest';
import type { NonFunctionProperties } from '@server/interfaces/api/common';
import type { QuotaResponse } from '@server/interfaces/api/userInterfaces';
import { Permission } from '@server/lib/permissions';
import type { TvDetails } from '@server/models/Tv';
import axios from 'axios';
import { Fragment, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

const messages = defineMessages('components.RequestModal', {
  requestadmin: 'This request will be approved automatically.',
  requestSuccess: '<strong>{title}</strong> requested successfully!',
  requestseriestitle: 'Request Series',
  requestseries4ktitle: 'Request Series in 4K',
  edit: 'Edit Request',
  approve: 'Approve Request',
  cancel: 'Cancel Request',
  pendingrequest: 'Pending Request',
  pending4krequest: 'Pending 4K Request',
  requestfrom: "{username}'s request is pending approval.",
  requestseasons:
    'Request {seasonCount} {seasonCount, plural, one {Season} other {Seasons}}',
  requestseasons4k:
    'Request {seasonCount} {seasonCount, plural, one {Season} other {Seasons}} in 4K',
  alreadyrequested: 'Already Requested',
  selectseason: 'Select Season(s)',
  season: 'Season',
  numberofepisodes: '# of Episodes',
  seasonnumber: 'Season {number}',
  errorediting: 'Something went wrong while editing the request.',
  requestedited: 'Request for <strong>{title}</strong> edited successfully!',
  requestApproved: 'Request for <strong>{title}</strong> approved!',
  requestcancelled: 'Request for <strong>{title}</strong> canceled.',
  autoapproval: 'Automatic Approval',
  requesterror: 'Something went wrong while submitting the request.',
  pendingapproval: 'Your request is pending approval.',
  interactivesearch: 'Interactive Search',
});

interface RequestModalProps extends React.HTMLAttributes<HTMLDivElement> {
  tmdbId: number;
  onCancel?: () => void;
  onComplete?: (newStatus: MediaStatus) => void;
  onUpdating?: (isUpdating: boolean) => void;
  is4k?: boolean;
  editRequest?: NonFunctionProperties<MediaRequest>;
}

const TvRequestModal = ({
  onCancel,
  onComplete,
  tmdbId,
  onUpdating,
  editRequest,
  is4k = false,
}: RequestModalProps) => {
  const settings = useSettings();
  const { addToast } = useToasts();
  const editingSeasons: number[] = (editRequest?.seasons ?? []).map(
    (season) => season.seasonNumber
  );
  const { data, error } = useSWR<TvDetails>(`/api/v1/tv/${tmdbId}`);
  const [requestOverrides, setRequestOverrides] =
    useState<RequestOverrides | null>(null);
  const [expandedSeason, setExpandedSeason] = useState<number | null>(null);
  // Interactive search picks: at most one release per episode (keyed by
  // episodeId) plus optionally one whole-season pack (keyed by season, no
  // episodeId). Uniqueness is enforced in handleSelectRelease below.
  const [selectedReleases, setSelectedReleases] = useState<SelectedRelease[]>(
    []
  );
  const intl = useIntl();
  const { user, hasPermission } = useUser();
  const [searchModal, setSearchModal] = useState<{
    show: boolean;
  }>({
    show: true,
  });
  const [tvdbId, setTvdbId] = useState<number | undefined>(undefined);
  const { data: quota } = useSWR<QuotaResponse>(
    user &&
      (!requestOverrides?.user?.id || hasPermission(Permission.MANAGE_USERS))
      ? `/api/v1/user/${requestOverrides?.user?.id ?? user.id}/quota`
      : null
  );

  // Enforce the "at most one pick per episode, at most one whole-season pack"
  // rule and toggle-off behavior, all in the parent so the release list stays
  // dumb. Re-selecting the exact same release removes it; a new pick for an
  // episode/season-pack replaces any existing pick for that same key.
  const handleSelectRelease = (release: SelectedRelease | null): void => {
    if (!release) {
      return;
    }
    setSelectedReleases((prev) => {
      if (prev.some((pick) => pick.guid === release.guid)) {
        return prev.filter((pick) => pick.guid !== release.guid);
      }
      const isSameKey = (pick: SelectedRelease): boolean =>
        release.episodeId !== undefined
          ? pick.episodeId === release.episodeId
          : pick.episodeId === undefined && pick.season === release.season;
      return [...prev.filter((pick) => !isSameKey(pick)), release];
    });
  };

  const updateRequest = async (alsoApproveRequest = false) => {
    if (!editRequest) {
      return;
    }

    if (onUpdating) {
      onUpdating(true);
      mutate('/api/v1/request/count');
    }

    try {
      if (editingSeasons.length > 0) {
        await axios.put(`/api/v1/request/${editRequest.id}`, {
          mediaType: 'tv',
          serverId: requestOverrides?.server,
          profileId: requestOverrides?.profile,
          rootFolder: requestOverrides?.folder,
          languageProfileId: requestOverrides?.language,
          userId: requestOverrides?.user?.id,
          tags: requestOverrides?.tags,
          seasons: [...editingSeasons].sort((a, b) => a - b),
        });

        if (alsoApproveRequest) {
          await axios.post(`/api/v1/request/${editRequest.id}/approve`);
        }
      } else {
        await axios.delete(`/api/v1/request/${editRequest.id}`);
      }
      mutate('/api/v1/request?filter=all&take=10&sort=modified&skip=0');
      mutate('/api/v1/request/count');

      addToast(
        <span>
          {editingSeasons.length > 0
            ? intl.formatMessage(
                alsoApproveRequest
                  ? messages.requestApproved
                  : messages.requestedited,
                {
                  title: data?.name,
                  strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
                }
              )
            : intl.formatMessage(messages.requestcancelled, {
                title: data?.name,
                strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
              })}
        </span>,
        {
          appearance: 'success',
          autoDismiss: true,
        }
      );
      if (onComplete) {
        onComplete(MediaStatus.PENDING);
      }
    } catch {
      addToast(<span>{intl.formatMessage(messages.errorediting)}</span>, {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      if (onUpdating) {
        onUpdating(false);
      }
    }
  };

  const sendRequest = async () => {
    if (onUpdating) {
      onUpdating(true);
      mutate('/api/v1/request/count');
    }

    try {
      let overrideParams = {};
      if (requestOverrides) {
        overrideParams = {
          serverId: requestOverrides.server,
          profileId: requestOverrides.profile,
          rootFolder: requestOverrides.folder,
          languageProfileId: requestOverrides.language,
          userId: requestOverrides?.user?.id,
          tags: requestOverrides.tags,
        };
      }
      const response = await axios.post<MediaRequest>('/api/v1/request', {
        mediaId: data?.id,
        tvdbId: tvdbId ?? data?.externalIds.tvdbId,
        mediaType: 'tv',
        is4k,
        ignoreQuota: requestOverrides?.ignoreQuota,
        // Seasons come from the interactive-search picks; with no picks we fall
        // back to requesting the whole show (all unrequested seasons) so a plain
        // Request still works as before.
        seasons: [...requestSeasons].sort((a, b) => a - b),
        // Interactive search: carry every chosen release (one per episode, plus
        // an optional whole-season pack) so each is grabbed on approval instead
        // of a fresh auto-search. Omitted entirely when nothing was picked.
        ...(selectedReleases.length > 0
          ? {
              grabReleases: selectedReleases.map((release) => ({
                guid: release.guid,
                indexerId: release.indexerId,
                ...(release.episodeId !== undefined
                  ? { episodeId: release.episodeId }
                  : {}),
              })),
            }
          : {}),
        ...overrideParams,
      });
      mutate('/api/v1/request?filter=all&take=10&sort=modified&skip=0');

      if (response.data) {
        if (onComplete) {
          onComplete(response.data.media.status);
        }
        addToast(
          <span>
            {intl.formatMessage(messages.requestSuccess, {
              title: data?.name,
              strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
            })}
          </span>,
          { appearance: 'success', autoDismiss: true }
        );
      }
    } catch {
      addToast(intl.formatMessage(messages.requesterror), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      if (onUpdating) {
        onUpdating(false);
      }
    }
  };

  const getAllSeasons = (): number[] => {
    let allSeasons = (data?.seasons ?? []).filter(
      (season) => season.episodeCount !== 0
    );
    if (!settings.currentSettings.enableSpecialEpisodes) {
      allSeasons = allSeasons.filter((season) => season.seasonNumber > 0);
    }
    return allSeasons.map((season) => season.seasonNumber);
  };

  const getAllRequestedSeasons = (): number[] => {
    const requestedSeasons = (data?.mediaInfo?.requests ?? [])
      .filter(
        (request) =>
          request.is4k === is4k &&
          request.status !== MediaRequestStatus.DECLINED &&
          request.status !== MediaRequestStatus.COMPLETED
      )
      .reduce((requestedSeasons, request) => {
        return [
          ...requestedSeasons,
          ...request.seasons
            .filter((season) => !editingSeasons.includes(season.seasonNumber))
            .map((sr) => sr.seasonNumber),
        ];
      }, [] as number[]);

    const availableSeasons = (data?.mediaInfo?.seasons ?? [])
      .filter(
        (season) =>
          (season[is4k ? 'status4k' : 'status'] === MediaStatus.AVAILABLE ||
            season[is4k ? 'status4k' : 'status'] ===
              MediaStatus.PARTIALLY_AVAILABLE ||
            season[is4k ? 'status4k' : 'status'] === MediaStatus.PROCESSING) &&
          !requestedSeasons.includes(season.seasonNumber)
      )
      .map((season) => season.seasonNumber);

    return [...requestedSeasons, ...availableSeasons];
  };

  const unrequestedSeasons = getAllSeasons().filter(
    (season) => !getAllRequestedSeasons().includes(season)
  );

  // Seasons touched by the interactive-search picks (episode picks and
  // whole-season packs both carry their season). This is what the request must
  // cover so the backend monitors the right seasons.
  const seasonsFromPicks = Array.from(
    new Set(
      selectedReleases
        .map((release) => release.season)
        .filter((season): season is number => season !== undefined)
    )
  );

  // With picks, request exactly the seasons they touch; with none, fall back to
  // requesting the whole show (all unrequested seasons).
  const requestSeasons =
    seasonsFromPicks.length > 0 ? seasonsFromPicks : unrequestedSeasons;

  const currentlyRemaining =
    (quota?.tv.remaining ?? 0) -
    requestSeasons.length +
    (editRequest?.seasons ?? []).length;

  const getSeasonRequest = (
    seasonNumber: number
  ): SeasonRequest | undefined => {
    let seasonRequest: SeasonRequest | undefined;

    if (
      data?.mediaInfo &&
      (data.mediaInfo.requests || []).filter(
        (request) =>
          request.is4k === is4k &&
          request.status !== MediaRequestStatus.DECLINED &&
          request.status !== MediaRequestStatus.COMPLETED
      ).length > 0
    ) {
      data.mediaInfo.requests
        .filter(
          (request) =>
            request.is4k === is4k &&
            request.status !== MediaRequestStatus.DECLINED &&
            request.status !== MediaRequestStatus.COMPLETED
        )
        .forEach((request) => {
          if (!seasonRequest) {
            seasonRequest = request.seasons.find(
              (season) =>
                season.seasonNumber === seasonNumber &&
                season.status !== MediaRequestStatus.COMPLETED
            );
          }
        });
    }

    return seasonRequest;
  };

  const isOwner = editRequest && editRequest.requestedBy.id === user?.id;

  return data && !error && !data.externalIds.tvdbId && searchModal.show ? (
    <SearchByNameModal
      tvdbId={tvdbId}
      setTvdbId={setTvdbId}
      closeModal={() => setSearchModal({ show: false })}
      onCancel={onCancel}
      modalTitle={intl.formatMessage(
        is4k ? messages.requestseries4ktitle : messages.requestseriestitle
      )}
      modalSubTitle={data.name}
      tmdbId={tmdbId}
      backdrop={`https://image.tmdb.org/t/p/w1920_and_h800_multi_faces/${data?.backdropPath}`}
    />
  ) : (
    <Modal
      loading={!data && !error}
      backgroundClickable
      onCancel={tvdbId ? () => setSearchModal({ show: true }) : onCancel}
      onOk={() =>
        editRequest
          ? hasPermission(Permission.MANAGE_REQUESTS)
            ? updateRequest(true)
            : updateRequest()
          : sendRequest()
      }
      title={intl.formatMessage(
        editRequest
          ? is4k
            ? messages.pending4krequest
            : messages.pendingrequest
          : is4k
            ? messages.requestseries4ktitle
            : messages.requestseriestitle
      )}
      subTitle={data?.name}
      okText={
        editRequest
          ? editingSeasons.length === 0
            ? intl.formatMessage(messages.cancel)
            : hasPermission(Permission.MANAGE_REQUESTS)
              ? intl.formatMessage(messages.approve)
              : intl.formatMessage(messages.edit)
          : unrequestedSeasons.length === 0
            ? intl.formatMessage(messages.alreadyrequested)
            : seasonsFromPicks.length > 0
              ? intl.formatMessage(
                  is4k ? messages.requestseasons4k : messages.requestseasons,
                  {
                    seasonCount: seasonsFromPicks.length,
                  }
                )
              : intl.formatMessage(
                  is4k ? globalMessages.request4k : globalMessages.request
                )
      }
      okDisabled={
        editRequest
          ? false
          : quota?.tv.limit &&
              requestSeasons.length > quota.tv.limit &&
              !requestOverrides?.ignoreQuota
            ? true
            : unrequestedSeasons.length === 0
      }
      okButtonType={
        editRequest
          ? editingSeasons.length === 0
            ? 'danger'
            : hasPermission(Permission.MANAGE_REQUESTS)
              ? 'success'
              : 'primary'
          : 'primary'
      }
      cancelText={
        editRequest
          ? intl.formatMessage(globalMessages.close)
          : tvdbId
            ? intl.formatMessage(globalMessages.back)
            : intl.formatMessage(globalMessages.cancel)
      }
      backdrop={`https://image.tmdb.org/t/p/w1920_and_h800_multi_faces/${data?.backdropPath}`}
    >
      {editRequest
        ? isOwner
          ? intl.formatMessage(messages.pendingapproval)
          : intl.formatMessage(messages.requestfrom, {
              username: editRequest?.requestedBy.displayName,
            })
        : null}
      {hasPermission(
        [
          Permission.MANAGE_REQUESTS,
          is4k ? Permission.AUTO_APPROVE_4K : Permission.AUTO_APPROVE,
          is4k ? Permission.AUTO_APPROVE_4K_TV : Permission.AUTO_APPROVE_TV,
        ],
        { type: 'or' }
      ) &&
        !(
          quota?.tv.limit &&
          !settings.currentSettings.partialRequestsEnabled &&
          unrequestedSeasons.length > (quota?.tv.remaining ?? 0)
        ) &&
        getAllRequestedSeasons().length < getAllSeasons().length &&
        !editRequest && (
          <div className="mt-6">
            <Alert
              title={intl.formatMessage(messages.requestadmin)}
              type="info"
            />
          </div>
        )}
      {(quota?.tv.limit ?? 0) > 0 && (
        <QuotaDisplay
          mediaType="tv"
          quota={quota?.tv}
          remaining={
            !settings.currentSettings.partialRequestsEnabled &&
            unrequestedSeasons.length > (quota?.tv.remaining ?? 0)
              ? 0
              : currentlyRemaining
          }
          userOverride={
            requestOverrides?.user && requestOverrides.user.id !== user?.id
              ? requestOverrides?.user?.id
              : undefined
          }
          overLimit={
            !settings.currentSettings.partialRequestsEnabled &&
            unrequestedSeasons.length > (quota?.tv.remaining ?? 0)
              ? unrequestedSeasons.length
              : undefined
          }
        />
      )}
      <div className="flex flex-col">
        <div className="-mx-4 sm:mx-0">
          <div className="inline-block min-w-full py-2 align-middle">
            <div className="overflow-hidden border border-gray-700 shadow backdrop-blur sm:rounded-lg">
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className="bg-gray-700/80 px-1 py-3 text-left text-xs font-medium uppercase leading-4 tracking-wider text-gray-200 md:px-6">
                      {intl.formatMessage(messages.season)}
                    </th>
                    <th className="bg-gray-700/80 px-5 py-3 text-left text-xs font-medium uppercase leading-4 tracking-wider text-gray-200 md:px-6">
                      {intl.formatMessage(messages.numberofepisodes)}
                    </th>
                    <th className="bg-gray-700/80 px-2 py-3 text-left text-xs font-medium uppercase leading-4 tracking-wider text-gray-200 md:px-6">
                      {intl.formatMessage(globalMessages.status)}
                    </th>
                    <th className="bg-gray-700/80 px-2 py-3 text-right text-xs font-medium uppercase leading-4 tracking-wider text-gray-200 md:px-6">
                      <span className="sr-only">
                        {intl.formatMessage(messages.interactivesearch)}
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {data?.seasons
                    .filter(
                      (season) =>
                        season.episodeCount !== 0 &&
                        (settings.currentSettings.enableSpecialEpisodes ||
                          season.seasonNumber !== 0)
                    )
                    .map((season) => {
                      const seasonRequest = getSeasonRequest(
                        season.seasonNumber
                      );
                      const mediaSeason = data?.mediaInfo?.seasons.find(
                        (sn) =>
                          sn.seasonNumber === season.seasonNumber &&
                          sn[is4k ? 'status4k' : 'status'] !==
                            MediaStatus.UNKNOWN &&
                          sn[is4k ? 'status4k' : 'status'] !==
                            MediaStatus.DELETED
                      );
                      const isExpanded = expandedSeason === season.seasonNumber;
                      const tvdbIdForSearch =
                        tvdbId ?? data?.externalIds.tvdbId;
                      return (
                        <Fragment key={`season-${season.id}`}>
                          <tr>
                            <td className="whitespace-nowrap px-1 py-4 text-sm font-medium leading-5 text-gray-100 md:px-6">
                              {season.seasonNumber === 0
                                ? intl.formatMessage(globalMessages.specials)
                                : intl.formatMessage(messages.seasonnumber, {
                                    number: season.seasonNumber,
                                  })}
                            </td>
                            <td className="whitespace-nowrap px-5 py-4 text-sm leading-5 text-gray-200 md:px-6">
                              {season.episodeCount}
                            </td>
                            <td className="whitespace-nowrap py-4 pr-2 text-sm leading-5 text-gray-200 md:px-6">
                              {!seasonRequest && !mediaSeason && (
                                <Badge>
                                  {intl.formatMessage(
                                    globalMessages.notrequested
                                  )}
                                </Badge>
                              )}
                              {!mediaSeason &&
                                seasonRequest?.status ===
                                  MediaRequestStatus.PENDING && (
                                  <Badge badgeType="warning">
                                    {intl.formatMessage(globalMessages.pending)}
                                  </Badge>
                                )}
                              {((!mediaSeason &&
                                seasonRequest?.status ===
                                  MediaRequestStatus.APPROVED) ||
                                mediaSeason?.[is4k ? 'status4k' : 'status'] ===
                                  MediaStatus.PROCESSING) && (
                                <Badge badgeType="primary">
                                  {intl.formatMessage(globalMessages.requested)}
                                </Badge>
                              )}
                              {mediaSeason?.[is4k ? 'status4k' : 'status'] ===
                                MediaStatus.PARTIALLY_AVAILABLE && (
                                <Badge badgeType="success">
                                  {intl.formatMessage(
                                    globalMessages.partiallyavailable
                                  )}
                                </Badge>
                              )}
                              {mediaSeason?.[is4k ? 'status4k' : 'status'] ===
                                MediaStatus.AVAILABLE && (
                                <Badge badgeType="success">
                                  {intl.formatMessage(globalMessages.available)}
                                </Badge>
                              )}
                            </td>
                            <td className="whitespace-nowrap py-4 pr-2 text-right text-sm leading-5 text-gray-200 md:px-6">
                              {tvdbIdForSearch && (
                                <Button
                                  buttonType="ghost"
                                  buttonSize="sm"
                                  onClick={() =>
                                    setExpandedSeason(
                                      isExpanded ? null : season.seasonNumber
                                    )
                                  }
                                >
                                  {isExpanded ? (
                                    <ChevronDownIcon />
                                  ) : (
                                    <MagnifyingGlassIcon />
                                  )}
                                </Button>
                              )}
                            </td>
                          </tr>
                          {isExpanded && tvdbIdForSearch && (
                            <tr>
                              <td
                                colSpan={4}
                                className="bg-gray-800/40 px-4 py-4"
                              >
                                <InteractiveSearch
                                  mediaType="tv"
                                  tmdbId={tmdbId}
                                  tvdbId={tvdbIdForSearch}
                                  season={season.seasonNumber}
                                  serverId={requestOverrides?.server}
                                  selectedGuids={selectedReleases.map(
                                    (release) => release.guid
                                  )}
                                  onSelect={handleSelectRelease}
                                />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      {hasPermission(
        [Permission.REQUEST_ADVANCED, Permission.MANAGE_REQUESTS],
        { type: 'or' }
      ) && (
        <AdvancedRequester
          type="tv"
          tmdbId={tmdbId}
          is4k={is4k}
          isAnime={data?.keywords.some(
            (keyword) => keyword.id === ANIME_KEYWORD_ID
          )}
          quota={quota}
          onChange={(overrides) => setRequestOverrides(overrides)}
          requestUser={editRequest?.requestedBy}
          requestId={editRequest?.id}
          defaultOverrides={
            editRequest
              ? {
                  folder: editRequest.rootFolder,
                  profile: editRequest.profileId,
                  server: editRequest.serverId,
                  language: editRequest.languageProfileId,
                  tags: editRequest.tags,
                }
              : undefined
          }
        />
      )}
    </Modal>
  );
};

export default TvRequestModal;
