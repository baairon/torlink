(function () {
  window.Torlink = window.Torlink || {};

  // MediaSource requires a codecs parameter to accept a mime type — bare "video/mp4" is
  // always rejected by both isTypeSupported() and addSourceBuffer(). These are best-effort
  // guesses at the common case (H.264/AAC, VP8/Vorbis); a file using a different codec
  // (HEVC, AV1, Opus...) may still fail at appendBuffer() time, surfaced via onStatus.
  const MIME_BY_EXT = {
    ".mp4": 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
    ".webm": 'video/webm; codecs="vp8, vorbis"',
  };

  function mimeFor(name) {
    const lower = name.toLowerCase();
    const ext = Object.keys(MIME_BY_EXT).find((e) => lower.endsWith(e));
    return ext ? MIME_BY_EXT[ext] : null;
  }

  function canFallbackStream(name) {
    const mime = mimeFor(name);
    return typeof MediaSource !== "undefined" && !!mime && MediaSource.isTypeSupported(mime);
  }

  function streamViaMediaSource(file, videoEl, onStatus) {
    const mime = mimeFor(file.name);
    if (!canFallbackStream(file.name)) {
      onStatus?.("This file's format needs a full server to preview — try Download instead.");
      return { destroy() {} };
    }

    let destroyed = false;
    let readStream = null;
    let sourceBuffer = null;
    let streamEnded = false;
    const queue = [];

    const mediaSource = new MediaSource();
    videoEl.src = URL.createObjectURL(mediaSource);
    onStatus?.("Buffering… (no seeking in this fallback mode)");

    function pump() {
      if (destroyed || !sourceBuffer || sourceBuffer.updating || !queue.length) return;
      sourceBuffer.appendBuffer(queue.shift());
    }

    mediaSource.addEventListener(
      "sourceopen",
      () => {
        if (destroyed) return;
        try {
          sourceBuffer = mediaSource.addSourceBuffer(mime);
        } catch (err) {
          onStatus?.(`Streaming unavailable: ${err.message || err}`);
          return;
        }
        sourceBuffer.addEventListener("updateend", () => {
          pump();
          if (streamEnded && !queue.length && !sourceBuffer.updating && mediaSource.readyState === "open") {
            mediaSource.endOfStream();
            onStatus?.("");
          }
        });
        sourceBuffer.addEventListener("error", (e) => onStatus?.(`Playback error: ${e.message || "buffer error"}`));

        readStream = file.createReadStream();
        readStream.on("data", (chunk) => {
          queue.push(chunk);
          pump();
        });
        readStream.on("end", () => {
          streamEnded = true;
          pump();
        });
        readStream.on("error", (err) => onStatus?.(`Stream error: ${err.message || err}`));
      },
      { once: true },
    );

    return {
      destroy() {
        destroyed = true;
        readStream?.destroy();
        try {
          URL.revokeObjectURL(videoEl.src);
        } catch {}
      },
    };
  }

  Torlink.canFallbackStream = canFallbackStream;
  Torlink.streamViaMediaSource = streamViaMediaSource;
})();
