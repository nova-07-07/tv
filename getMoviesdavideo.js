(function (root) {
  "use strict";

  const MAX_PAGES = 40;
  const MEDIA_EXTENSIONS = /\.(mp4|webm|ogg|m4v|mov)(?:$|[\s?#])/i;
  const QUALITY_PATTERN = /(?:^|\D)(2160|1440|1080|720|480|360|240)p?(?:\D|$)/i;

  function isMoviesDaHost(hostname) {
    const host = hostname.toLowerCase();
    return host === "moviesda.ski" || host.endsWith(".moviesda.ski");
  }

  function isDirectMedia(url) {
    try {
      return /\.(mp4|webm|ogg|m4v|mov)$/i.test(new URL(url).pathname);
    } catch {
      return false;
    }
  }

  function getResolution(text) {
    const match = String(text).match(QUALITY_PATTERN);
    return match ? Number(match[1]) : 0;
  }

  function isPreDvd(text) {
    return /pre[\s._-]*dvd/i.test(String(text));
  }

  function parsePage(html, baseUrl) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const links = new Map();
    const directVideos = new Set();

    for (const element of doc.querySelectorAll("video[src], video source[src]")) {
      try {
        const url = new URL(element.getAttribute("src"), baseUrl).href;
        if (isDirectMedia(url)) directVideos.add(url);
      } catch {}
    }

    for (const anchor of doc.querySelectorAll("a[href]")) {
      const raw = anchor.getAttribute("href");
      if (!raw || raw.trim().startsWith("#")) continue;

      try {
        const parsed = new URL(raw, baseUrl);
        if (!["http:", "https:"].includes(parsed.protocol)) continue;
        if (parsed.href === baseUrl || (parsed.origin === new URL(baseUrl).origin && parsed.pathname === "/")) continue;
        if (/\/tamil-movies\/[a-z]\/?$/i.test(parsed.pathname)) continue;

        const label = (anchor.innerText || anchor.textContent || anchor.getAttribute("title") || "")
          .trim()
          .replace(/\s+/g, " ");
        const item = {
          url: parsed.href,
          label: label || parsed.hostname + parsed.pathname,
          sameSite: parsed.origin === new URL(baseUrl).origin,
          videoHint: MEDIA_EXTENSIONS.test(label) || isDirectMedia(parsed.href),
          server: /download\s*server\s*[12]/i.test(label)
        };

        if (!links.has(item.url)) links.set(item.url, item);
      } catch {}
    }

    return { links: [...links.values()], directVideos: [...directVideos] };
  }

  function makeVideo(url, label, direct, sourceUrl) {
    return {
      url,
      label: label || "Video",
      resolution: getResolution(label) || getResolution(url),
      preDVD: isPreDvd(label) || isPreDvd(url),
      direct,
      sourceUrl: sourceUrl || ""
    };
  }

  async function crawl(inputUrl) {
    let start;
    try {
      start = new URL(inputUrl);
      if (!["http:", "https:"].includes(start.protocol)) throw new Error("Only HTTP and HTTPS URLs are supported.");
    } catch (error) {
      return {
        inputUrl: String(inputUrl || ""),
        videos: [],
        stats: { pages: 0, links: 0, failedRequests: 0 },
        error: error.message
      };
    }

    const visited = new Set();
    const links = new Map();
    const videos = new Map();
    let failedRequests = 0;

    function addVideo(url, label, direct, sourceUrl) {
      try {
        const parsed = new URL(url);
        if (isMoviesDaHost(parsed.hostname) || videos.has(parsed.href)) return;
        videos.set(parsed.href, makeVideo(parsed.href, label, direct, sourceUrl));
      } catch {}
    }

    async function visit(rawUrl, inheritedLabel = "", depth = 0) {
      let page;
      try {
        page = new URL(rawUrl);
        if (!["http:", "https:"].includes(page.protocol)) return;
      } catch {
        return;
      }

      if (visited.has(page.href) || visited.size >= MAX_PAGES || depth >= MAX_PAGES) return;
      visited.add(page.href);

      if (isDirectMedia(page.href)) {
        addVideo(page.href, inheritedLabel || page.pathname.split("/").pop(), true, page.href);
        return;
      }

      try {
        const response = await fetch(page.href, { redirect: "follow", headers: { Accept: "text/html" } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const finalUrl = response.url || page.href;
        if (isDirectMedia(finalUrl)) {
          addVideo(finalUrl, inheritedLabel || page.hostname, true, page.href);
          return;
        }

        const parsed = parsePage(await response.text(), finalUrl);
        parsed.links.forEach(link => links.set(link.url, link));

        parsed.directVideos.forEach(url => addVideo(url, inheritedLabel || "Embedded video", true, finalUrl));

        for (const link of parsed.links) {
          if (!link.videoHint) continue;
          const host = new URL(link.url).hostname;
          if (!isMoviesDaHost(host)) addVideo(link.url, link.label, isDirectMedia(link.url), finalUrl);
        }

        const serverLinks = parsed.links.filter(link => link.server && !visited.has(link.url));
        const nextLinks = serverLinks.length
          ? serverLinks
          : parsed.links.filter(link => link.sameSite && !visited.has(link.url));

        for (const link of nextLinks) {
          const label = link.server
            ? inheritedLabel || link.label
            : link.videoHint
              ? link.label
              : inheritedLabel || link.label;
          await visit(link.url, label, depth + 1);
        }
      } catch {
        failedRequests++;
        if (!isMoviesDaHost(page.hostname) && (getResolution(inheritedLabel) || MEDIA_EXTENSIONS.test(inheritedLabel))) {
          addVideo(page.href, inheritedLabel, isDirectMedia(page.href), page.href);
        }
      }
    }

    await visit(start.href);

    return {
      inputUrl: start.href,
      videos: [...videos.values()],
      stats: {
        pages: visited.size,
        links: links.size,
        failedRequests
      }
    };
  }

  async function GetAllVideoUrl(inputUrl) {
    return crawl(inputUrl);
  }

  async function GetQuickVideoUrl(inputUrl) {
    const result = await crawl(inputUrl);
    const nonPreDvd = result.videos.filter(video => !video.preDVD);
    const choices = nonPreDvd.length ? nonPreDvd : result.videos;
    choices.sort((a, b) => b.resolution - a.resolution);

    return {
      inputUrl: result.inputUrl,
      video: choices[0] || null,
      selection: choices.length
        ? nonPreDvd.length
          ? "highest available resolution excluding PRE-DVD when alternatives exist"
          : "only PRE-DVD candidates were available"
        : "no video URL found",
      stats: result.stats,
      ...(result.error ? { error: result.error } : {})
    };
  }

  root.GetQuickVideoUrl = GetQuickVideoUrl;
  root.GetAllVideoUrl = GetAllVideoUrl;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { GetQuickVideoUrl, GetAllVideoUrl };
  }
})(typeof globalThis !== "undefined" ? globalThis : this);