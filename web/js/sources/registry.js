(function () {
  window.Torlink = window.Torlink || {};
  const { eztv, yts, nyaa, subsplease, solid, fitgirl, tpbMovies, tpbTv } = Torlink.sources;

  const SOURCES = [fitgirl, yts, tpbMovies, eztv, solid, tpbTv, nyaa, subsplease];

  const GROUP_ORDER = ["Games", "Movies", "TV", "Anime"];

  function sourcesByGroup() {
    return GROUP_ORDER.map((group) => ({
      group,
      sources: SOURCES.filter((s) => s.group === group),
    })).filter((g) => g.sources.length > 0);
  }

  Torlink.SOURCES = SOURCES;
  Torlink.sourcesByGroup = sourcesByGroup;
})();
