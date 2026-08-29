// create-torrent ships no types, in the same way parse-torrent does not. Only
// the callback form is declared, because it is the only one torlink calls: the
// package also accepts streams and File objects, and declaring shapes we never
// use is how a hand-written declaration drifts from the package it describes.
declare module "create-torrent" {
  interface CreateTorrentOptions {
    announce?: string[];
    name?: string;
    comment?: string;
    createdBy?: string;
    creationDate?: number;
    private?: boolean;
    pieceLength?: number;
    urlList?: string[];
  }

  function createTorrent(
    input: string,
    opts: CreateTorrentOptions,
    callback: (err: Error | null, torrent: Uint8Array) => void,
  ): void;

  export = createTorrent;
}
