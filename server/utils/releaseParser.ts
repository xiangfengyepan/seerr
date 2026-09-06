import type { RadarrRelease } from '@server/api/servarr/radarr';
import type { SonarrRelease } from '@server/api/servarr/sonarr';
import type { ParsedRelease } from '@server/interfaces/api/interactiveSearchInterfaces';

/**
 * Best-effort parsing of release metadata from *arr release objects.
 *
 * Video quality / source come straight from the *arr `quality` field and are
 * reliable. Audio codec / channels / language are scraped from the release
 * title (and the *arr `languages` field for language) and are intentionally
 * lenient: when a value cannot be determined we return null / [] rather than
 * guessing, so the frontend can avoid hiding releases with unknown audio.
 */

type AnyRelease = RadarrRelease | SonarrRelease;

/**
 * Map a resolution number (from *arr) to a display string.
 */
function normalizeResolution(resolution?: number): string {
  switch (resolution) {
    case 2160:
      return '2160p';
    case 1080:
      return '1080p';
    case 720:
      return '720p';
    case 576:
      return '576p';
    case 480:
      return '480p';
    default:
      return 'Unknown';
  }
}

/**
 * Derive a human-friendly video quality from the *arr quality object, falling
 * back to parsing the quality name / title when the resolution field is absent.
 */
export function parseVideoQuality(release: AnyRelease): string {
  const resolution = release.quality?.quality?.resolution;
  const fromField = normalizeResolution(resolution);
  if (fromField !== 'Unknown') {
    return fromField;
  }

  // Fall back to the quality name / release title.
  const haystack = `${release.quality?.quality?.name ?? ''} ${release.title}`;
  if (/\b(2160p|4k|uhd)\b/i.test(haystack)) return '2160p';
  if (/\b1080p\b/i.test(haystack)) return '1080p';
  if (/\b720p\b/i.test(haystack)) return '720p';
  if (/\b576p\b/i.test(haystack)) return '576p';
  if (/\b480p\b/i.test(haystack)) return '480p';
  return 'Unknown';
}

/**
 * Derive the source (Bluray/WEB-DL/etc). Uses the *arr `source` field first,
 * detecting remux via the release title/name since *arr models remux as a
 * modifier rather than a distinct source.
 */
export function parseSource(release: AnyRelease): string {
  const haystack = `${release.quality?.quality?.name ?? ''} ${release.title}`;
  if (/\bremux\b/i.test(haystack)) return 'Remux';

  const source = release.quality?.quality?.source?.toLowerCase();
  switch (source) {
    case 'bluray':
    case 'blurayraw':
      return 'Bluray';
    case 'webdl':
    case 'web-dl':
      return 'WEB-DL';
    case 'webrip':
      return 'WEBRip';
    case 'hdtv':
      return 'HDTV';
    case 'dvd':
      return 'DVD';
    case 'tv':
      return 'TV';
    default:
      break;
  }

  // Fall back to title scraping.
  if (/\bblu-?ray\b/i.test(haystack)) return 'Bluray';
  if (/\bweb-?dl\b/i.test(haystack)) return 'WEB-DL';
  if (/\bwebrip\b/i.test(haystack)) return 'WEBRip';
  if (/\bhdtv\b/i.test(haystack)) return 'HDTV';
  if (/\bdvd\b/i.test(haystack)) return 'DVD';
  return 'Unknown';
}

/**
 * Best-effort audio codec parse from the release title.
 * Order matters: more specific tokens must be tested before generic ones.
 */
export function parseAudioCodec(title: string): string | null {
  const patterns: [RegExp, string][] = [
    [/\bdts[\s.-]?hd[\s.-]?ma\b/i, 'DTS-HD MA'],
    [/\bdts[\s.-]?hd\b/i, 'DTS-HD'],
    [/\bdts[\s.-]?x\b/i, 'DTS:X'],
    [/\bdts\b/i, 'DTS'],
    [/\btruehd\b/i, 'TrueHD'],
    [/\batmos\b/i, 'Atmos'],
    [/\b(?:ddp|dd\+|e[\s.-]?ac[\s.-]?3|eac3)\b/i, 'EAC3'],
    [/\b(?:dd|ac[\s.-]?3|ac3)\b/i, 'AC3'],
    [/\baac\b/i, 'AAC'],
    [/\bflac\b/i, 'FLAC'],
    [/\bopus\b/i, 'Opus'],
    [/\b(?:l?pcm)\b/i, 'PCM'],
    [/\bmp3\b/i, 'MP3'],
  ];

  for (const [pattern, label] of patterns) {
    if (pattern.test(title)) {
      return label;
    }
  }
  return null;
}

/**
 * Best-effort audio channel layout parse (e.g. 5.1, 7.1, 2.0).
 */
export function parseAudioChannels(title: string): string | null {
  // Common written forms: "5.1", "DDP5.1", "7 1", "2.0".
  const match = title.match(/\b([157])[\s.](0|1)\b/);
  if (match) {
    return `${match[1]}.${match[2]}`;
  }
  // Attached form like "DDP5.1", "AAC2.0".
  const attached = title.match(/(?:[a-z0-9])([157])\.([012])\b/i);
  if (attached) {
    return `${attached[1]}.${attached[2]}`;
  }
  return null;
}

const LANGUAGE_TITLE_TOKENS: [RegExp, string][] = [
  [/\bmulti\b/i, 'Multi'],
  [/\bdual\b/i, 'Dual Audio'],
  [/\bvostfr\b/i, 'French'],
  [/\btruefrench\b/i, 'French'],
  [/\bvff\b/i, 'French'],
  [/\bger(?:man)?\b/i, 'German'],
  [/\bita(?:lian)?\b/i, 'Italian'],
  [/\bspa(?:nish)?\b|\bcastellano\b|\blat(?:ino)?\b/i, 'Spanish'],
  [/\bjpn?\b|\bjapanese\b/i, 'Japanese'],
  [/\bkor(?:ean)?\b/i, 'Korean'],
  [/\brus(?:sian)?\b/i, 'Russian'],
  [/\bhindi\b/i, 'Hindi'],
  [/\bpor(?:tuguese)?\b/i, 'Portuguese'],
  [/\bchi(?:nese)?\b|\bmandarin\b|\bcantonese\b/i, 'Chinese'],
];

/**
 * Best-effort audio languages. Prefers the structured *arr `languages` field;
 * augments with tokens scraped from the release title. Returns [] when nothing
 * is found — callers MUST treat empty as "unknown", never as an exclusion.
 */
export function parseAudioLanguages(
  title: string,
  languages?: { id: number; name: string }[]
): string[] {
  const result = new Set<string>();

  for (const lang of languages ?? []) {
    // *arr uses "Unknown" for unparsed languages — skip it so it does not
    // become a filterable value.
    if (lang.name && lang.name.toLowerCase() !== 'unknown') {
      result.add(lang.name);
    }
  }

  for (const [pattern, label] of LANGUAGE_TITLE_TOKENS) {
    if (pattern.test(title)) {
      result.add(label);
    }
  }

  return Array.from(result);
}

/**
 * Turn a raw *arr release into the shared ParsedRelease shape.
 */
export function parseRelease(release: AnyRelease): ParsedRelease {
  return {
    guid: release.guid,
    indexerId: release.indexerId,
    indexer: release.indexer,
    title: release.title,
    videoQuality: parseVideoQuality(release),
    source: parseSource(release),
    qualityName: release.quality?.quality?.name ?? 'Unknown',
    audioLanguages: parseAudioLanguages(release.title, release.languages),
    audioCodec: parseAudioCodec(release.title),
    audioChannels: parseAudioChannels(release.title),
    sizeBytes: release.size ?? 0,
    seeders: typeof release.seeders === 'number' ? release.seeders : null,
    protocol: release.protocol ?? null,
    rejected: release.rejected ?? false,
    rejectionReasons: release.rejections ?? [],
    ageHours: typeof release.ageHours === 'number' ? release.ageHours : null,
  };
}
