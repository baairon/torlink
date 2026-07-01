(function () {
  window.Torlink = window.Torlink || {};

  function unescapeEntities(s) {
    return s
      .replace(/&#0?38;|&amp;/g, "&")
      .replace(/&#8211;|&#8212;/g, "-")
      .replace(/&#8217;|&#0?39;|&apos;/g, "'")
      .replace(/&#8220;|&#8221;|&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }

  Torlink.unescapeEntities = unescapeEntities;
})();
