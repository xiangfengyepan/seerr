import type { MediaType } from '@server/constants/media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { NonFunctionProperties, PaginatedResponse } from './common';

export interface RequestResultsResponse extends PaginatedResponse {
  results: (NonFunctionProperties<MediaRequest> & {
    profileName?: string;
    canRemove?: boolean;
  })[];
  serviceErrors: {
    radarr: { id: number; name: string }[];
    sonarr: { id: number; name: string }[];
  };
}

export type MediaRequestBody = {
  mediaType: MediaType;
  mediaId: number;
  tvdbId?: number;
  seasons?: number[] | 'all';
  is4k?: boolean;
  serverId?: number;
  profileId?: number;
  profileName?: string;
  rootFolder?: string;
  languageProfileId?: number;
  userId?: number;
  tags?: number[];
  ignoreQuota?: boolean;
  // Interactive search: a specific release the user picked in the modal. When
  // present, the request is grabbed for THIS release on approval/auto-approve
  // instead of running a fresh *arr auto-search. Used by movies (single pick).
  grabReleaseGuid?: string;
  grabReleaseIndexerId?: number;
  grabEpisodeId?: number;
  // Interactive search (TV): multiple chosen releases, at most one per episode,
  // plus optionally one whole-season pack (episodeId omitted). Each is grabbed
  // on approval/auto-approve. When present this takes precedence over the single
  // grabRelease* fields above.
  grabReleases?: GrabReleaseSelection[];
};

/** One release chosen in the interactive search. */
export interface GrabReleaseSelection {
  guid: string;
  indexerId: number;
  /** Sonarr episode id, when the pick targets a single episode. Omitted for a
   * whole-season pack. */
  episodeId?: number;
}
