import { SOURCES } from "./sources/registry.js";

let activeToken = 0;

export function runSearch(query, { onResult, onStatus, onDone }) {
  const token = ++activeToken;
  let pending = SOURCES.length;

  for (const source of SOURCES) {
    onStatus(source, "pending");
    source
      .search(query)
      .then((results) => {
        if (token !== activeToken) return;
        onStatus(source, "ok", results.length);
        onResult(source, results);
      })
      .catch((err) => {
        if (token !== activeToken) return;
        onStatus(source, "err", 0, err);
      })
      .finally(() => {
        if (token !== activeToken) return;
        pending -= 1;
        if (pending === 0) onDone();
      });
  }
}
