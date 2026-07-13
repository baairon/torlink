export interface ParsedRelease {
  title: string;
  year?: number;
  season?: number;
  episode?: number;
  resolution?: string;
  source?: string;
  codec?: string;
  group?: string;
}

export interface SubtitleCandidate {
  releaseName: string;
  lang: string;
  downloadUrl: string;
}
