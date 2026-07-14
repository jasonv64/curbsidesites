/**
 * Instagram feed adapter. Read path is our images table (rows with
 * purpose='instagram', written by the fetch job in live.ts) — never a vendor
 * call at request time (D10).
 */
export interface InstaPost {
  id: string;
  caption: string;
  /** null → branded placeholder tile serves. */
  imageUrl: string | null;
  permalink: string | null;
}

export interface InstagramFeed {
  posts: InstaPost[];
  handle: string | null;
  isDemo: boolean;
}
