// The shape of the metadata torlink shows beside a search result, independent of which provider
// produced it. Everything here has already crossed the trust boundary: strings are cleaned, lists
// are capped and the IMDb id is validated, so a render path can print any of it verbatim.
// Fields are readonly because these values are cached and shared across rows — a consumer that
// mutated one would silently poison every other row holding the same object.

export type MetaKind = "movie" | "series";

export interface EpisodeMeta {
  readonly season: number;
  readonly number: number;
  readonly title?: string;
  readonly overview?: string;
}

export interface Meta {
  readonly imdbId: string;
  readonly kind: MetaKind;
  readonly title: string;
  /** `releaseInfo` verbatim: a movie's "1999", a series' "2008–2013" or open-ended "2016–". */
  readonly year?: string;
  /** IMDb rating as sent, e.g. "8.7" — kept a string so a missing value is absent, not 0. */
  readonly rating?: string;
  readonly runtime?: string;
  readonly genres: readonly string[];
  readonly cast: readonly string[];
  /** Cinemeta sends `null` here for series, so this is routinely empty. */
  readonly director: readonly string[];
  readonly plot?: string;
  /** https only, host-allowlisted at the mapping boundary. */
  readonly posterUrl?: string;
  readonly episode?: EpisodeMeta;
}

/** One row of a provider's search catalog — just enough to match against a parsed release name. */
export interface CatalogHit {
  readonly imdbId: string;
  readonly name: string;
  readonly releaseInfo?: string;
  readonly kind: MetaKind;
}
