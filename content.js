(() => {
  const CONTENT_VERSION = "2.1.0";
  const GLOBAL_KEY = "__CGPT_GROK_MEDIA_SCRAPER_CONTENT_V20__";
  if (window[GLOBAL_KEY]) return;
  window[GLOBAL_KEY] = true;

  const HOOK_SOURCE = "CGPT_IMAGES_API_SCRAPER_HOOK";
  const EXT_SOURCE = "CGPT_IMAGES_API_SCRAPER_EXTENSION";
  let contentSyncCancel = false;
  // v2.32.72: long Grok syncs no longer keep a chrome.runtime message channel
  // open for the entire scan. Chrome may close that channel while the page/grid
  // is changing, producing: "A listener indicated an asynchronous response...".
  // Run the sync as an in-page job and expose only short synchronous status polls.
  const grokSyncJobs = new Map();

  function startGrokSyncJob(kind, maxImages, media = "both") {
    const jobId = `grok_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
    const job = { jobId, kind, state: "running", startedAt: Date.now(), finishedAt: 0, result: null, error: "" };
    grokSyncJobs.set(jobId, job);
    const runner = kind === "boards" ? runGrokBoardsSync : runGrokImagenSync;
    Promise.resolve()
      .then(() => runner(maxImages, media))
      .then(result => {
        job.state = "done";
        job.finishedAt = Date.now();
        job.result = result || { ok: false, error: "Grok sync returned no result" };
      })
      .catch(error => {
        job.state = "done";
        job.finishedAt = Date.now();
        job.error = error?.message || String(error);
        job.result = { ok: false, error: job.error };
      });
    return { ok: true, started: true, jobId, kind };
  }

  function grokSyncJobStatus(jobId, consume = false) {
    const job = grokSyncJobs.get(String(jobId || ""));
    if (!job) return { ok: false, missing: true, jobId: String(jobId || ""), error: "Grok sync job not found (page may have reloaded)" };
    const payload = {
      ok: true,
      jobId: job.jobId,
      kind: job.kind,
      state: job.state,
      elapsedMs: Math.max(0, (job.finishedAt || Date.now()) - job.startedAt),
      result: job.state === "done" ? job.result : null
    };
    if (consume && job.state === "done") grokSyncJobs.delete(job.jobId);
    return payload;
  }

  function injectHook() {
    if (document.documentElement.dataset.cgptImagesScraperHookV20 === "1") return;
    document.documentElement.dataset.cgptImagesScraperHookV20 = "1";
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("page-hook.js");
    script.async = false;
    (document.documentElement || document.head).appendChild(script);
    script.remove();
  }

  function nowIso() { return new Date().toISOString(); }
  function abs(raw) {
    try { return new URL(String(raw || ""), location.href).href; }
    catch (_) { return String(raw || ""); }
  }
  function coerceDate(value) {
    if (value == null || value === "") return "";
    if (typeof value === "number") {
      const ms = value > 1e12 ? value : value > 1e9 ? value * 1000 : value;
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? "" : d.toISOString();
    }
    const d = new Date(String(value));
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
  }
  function looksLikeEstuarySource(raw) {
    try {
      const u = new URL(String(raw || ""), location.href);
      return /\/backend-api\/estuary\/content$/.test(u.pathname) && /^file_[A-Za-z0-9_-]+$/.test(u.searchParams.get("id") || "");
    } catch (_) { return false; }
  }
  function safePreview(raw) {
    try {
      const u = new URL(String(raw || ""), location.href);
      const low = u.href.toLowerCase();
      if (/\.svg(?:[?#]|$)|\.html?(?:[?#]|$)|\.json(?:[?#]|$)|oaistatic\.com|\/_next\/static\/|avatar|profile|icon|logo|favicon|sprite/.test(low)) return "";
      return u.href;
    } catch (_) { return ""; }
  }
  function extractImageGenAssets(json, apiUrl) {
    const out = [];
    const seen = new Set();
    const items = Array.isArray(json?.items) ? json.items : [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const kind = String(item.kind || "").toLowerCase();
      const genType = String(item.generation_type || item.generationType || "").toLowerCase();
      const source = String(item.source || "").toLowerCase();
      if (kind !== "media_generation") continue;
      if (genType && genType !== "image_gen") continue;
      if (source && source !== "chatgpt") continue;
      if (item.output_blocked === true) continue;
      const sourceUrl = abs(item.url || "");
      if (!looksLikeEstuarySource(sourceUrl) || seen.has(sourceUrl)) continue;
      seen.add(sourceUrl);
      const thumb = safePreview(item?.encodings?.thumbnail?.path || "");
      out.push({
        url: sourceUrl,
        previewUrl: thumb || sourceUrl,
        prompt: item.title || item.prompt || item.recreation_prompt || "ChatGPT image",
        createdAt: coerceDate(item.created_at || item.createdAt || item.create_time || item.updated_at) || nowIso(),
        sourceApi: apiUrl || "",
        contextId: item.generation_id || item.id || item.message_id || "",
        fileId: (sourceUrl.match(/[?&]id=(file_[A-Za-z0-9_-]+)/) || [])[1] || "",
        assetPointer: item.asset_pointer || "",
        keyName: "image_gen.items.url",
        extHint: "png",
        score: 100,
        capturedAt: nowIso(),
        width: Number(item.width || 0),
        height: Number(item.height || 0),
        conversationId: item.conversation_id || "",
        messageId: item.message_id || "",
        transformationId: item.transformation_id || ""
      });
    }
    return out;
  }

  async function runImageGenCursorSync(maxImages) {
    contentSyncCancel = false;
    const limit = 25;
    const max = Math.max(25, Number(maxImages || 7500));
    const maxPages = Math.max(1, Math.ceil(max / limit));
    let cursor = "";
    let pages = 0;
    let totalAssets = 0;
    let totalAdded = 0;
    let totalUpdated = 0;
    let exhausted = false;
    const seenCursors = new Set();
    const seenUrls = new Set();

    for (let page = 0; page < maxPages; page++) {
      if (contentSyncCancel) return { ok: false, cancelled: true, pages, assets: totalAssets, added: totalAdded, updated: totalUpdated };
      const u = new URL("/backend-api/my/recent/image_gen", location.origin);
      u.searchParams.set("limit", String(limit));
      if (cursor) u.searchParams.set("after", cursor);
      const api = u.href;
      if (seenUrls.has(api)) break;
      seenUrls.add(api);
      const res = await fetch(api, { method: "GET", credentials: "include", cache: "no-store", headers: { "accept": "application/json, text/plain, */*" } });
      const ct = res.headers.get("content-type") || "";
      const text = await res.text();
      if (!res.ok) return { ok: false, pages, assets: totalAssets, added: totalAdded, updated: totalUpdated, error: `HTTP ${res.status}`, status: res.status, contentType: ct };
      if (/^\s*</.test(text)) return { ok: false, pages, assets: totalAssets, added: totalAdded, updated: totalUpdated, error: "auth/html response", status: res.status, contentType: ct };
      let json;
      try { json = JSON.parse(text); }
      catch (_) { return { ok: false, pages, assets: totalAssets, added: totalAdded, updated: totalUpdated, error: "JSON parse failed", status: res.status, contentType: ct }; }
      const assets = extractImageGenAssets(json, api).slice(0, Math.max(0, max - totalAssets));
      const next = typeof json.cursor === "string" ? json.cursor : "";
      const merge = await chrome.runtime.sendMessage({ type: "MERGE_SYNC_ASSETS", assets, api, page: page + 1, cursor: next }).catch(e => ({ ok: false, error: e.message || String(e) }));
      if (!merge || merge.ok === false) return { ok: false, pages, assets: totalAssets, added: totalAdded, updated: totalUpdated, error: merge?.error || "merge failed" };
      pages += 1;
      totalAssets += assets.length;
      totalAdded += Number(merge.added || 0);
      totalUpdated += Number(merge.updated || 0);
      if (!next) { exhausted = true; break; }
      if (seenCursors.has(next)) break;
      seenCursors.add(next);
      cursor = next;
      if (totalAssets >= max) break;
    }
    return { ok: true, mode: "content-v112", pages, assets: totalAssets, added: totalAdded, updated: totalUpdated, maxImages: max, exhausted };
  }

  // v2.32.95: Grok sync no longer uses the page hook/network interception layer.
  // Avoid installing observers/interceptors on Grok entirely. ChatGPT keeps the old hook.
  if (!/(^|\.)grok\.com$/i.test(location.hostname)) injectHook();

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data || {};
    if (data.source !== HOOK_SOURCE) return;
    chrome.runtime.sendMessage({ type: "HOOK_EVENT", event: data }).catch(() => {});
  });



  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  function getBestScroller() {
    const nodes = [document.scrollingElement, document.documentElement, document.body, document.querySelector('main'), document.querySelector('[role="main"]'), ...Array.from(document.querySelectorAll('main div, [role="main"] div'))].filter(Boolean);
    return nodes
      .filter(el => {
        try { return (el.scrollHeight || 0) > (el.clientHeight || 0) + 200; } catch (_) { return false; }
      })
      .sort((a, b) => ((b.scrollHeight || 0) - (b.clientHeight || 0)) - ((a.scrollHeight || 0) - (a.clientHeight || 0)))[0] || document.scrollingElement || document.documentElement;
  }

  function getScrollInfo(scroller) {
    if (!scroller || scroller === document.body || scroller === document.documentElement || scroller === document.scrollingElement) {
      return {
        top: window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0,
        client: window.innerHeight || document.documentElement.clientHeight || 0,
        height: Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0)
      };
    }
    return { top: scroller.scrollTop || 0, client: scroller.clientHeight || 0, height: scroller.scrollHeight || 0 };
  }

  function scrollToPosition(scroller, top) {
    try {
      if (!scroller || scroller === document.body || scroller === document.documentElement || scroller === document.scrollingElement) window.scrollTo({ top, behavior: 'instant' });
      else scroller.scrollTo({ top, behavior: 'instant' });
    } catch (_) {
      if (!scroller || scroller === document.body || scroller === document.documentElement || scroller === document.scrollingElement) window.scrollTo(0, top);
      else scroller.scrollTop = top;
    }
  }



  async function runPageHookCursorSync(maxImages) {
    contentSyncCancel = false;
    injectHook();
    const max = Math.max(25, Number(maxImages || 7500));
    const maxPages = Math.max(1, Math.ceil(max / 25));
    let done = false;
    let pages = 0;
    let totalAssets = 0;
    let totalAdded = 0;
    let totalUpdated = 0;
    let lastError = "";
    let mergeChain = Promise.resolve();

    return await new Promise((resolve) => {
      const finish = (payload = {}) => {
        if (done) return;
        done = true;
        window.removeEventListener("message", onPageMessage);
        clearTimeout(timer);
        mergeChain.finally(() => resolve({
          ok: !lastError && !payload.error,
          mode: "page-hook-v20",
          pages,
          assets: totalAssets,
          added: totalAdded,
          updated: totalUpdated,
          maxImages: max,
          error: payload.error || lastError || "",
          exhausted: !!payload.exhausted,
          cancelled: !!payload.cancelled
        }));
      };

      const onPageMessage = (event) => {
        if (event.source !== window) return;
        const data = event.data || {};
        if (data.source !== HOOK_SOURCE) return;

        if (data.type === "PAGE_SYNC_PAGE") {
          mergeChain = mergeChain.then(async () => {
            const assets = Array.isArray(data.assets) ? data.assets : [];
            const merge = await chrome.runtime.sendMessage({
              type: "MERGE_SYNC_ASSETS",
              assets,
              api: data.url || "",
              page: data.page || pages + 1,
              cursor: data.cursor || ""
            }).catch(e => ({ ok: false, error: e.message || String(e) }));
            pages = Math.max(pages, Number(data.page || pages + 1));
            totalAssets += assets.length;
            if (!merge || merge.ok === false) {
              lastError = merge?.error || "merge failed";
            } else {
              totalAdded += Number(merge.added || 0);
              totalUpdated += Number(merge.updated || 0);
            }
          });
          return;
        }

        if (data.type === "PAGE_SYNC_ERROR") {
          lastError = data.error || `HTTP ${data.status || "error"}`;
          finish({ error: lastError });
          return;
        }

        if (data.type === "PAGE_SYNC_CANCELLED") {
          finish({ cancelled: true, error: "cancelled" });
          return;
        }

        if (data.type === "PAGE_SYNC_DONE") {
          finish({ exhausted: !!data.exhausted, cancelled: !!data.cancelled });
        }
      };

      const timer = setTimeout(() => finish({ error: "page hook sync timeout" }), Math.max(180000, maxPages * 3500));
      window.addEventListener("message", onPageMessage);
      setTimeout(() => window.postMessage({ source: EXT_SOURCE, type: "PAGE_CURSOR_SYNC_V20", maxImages: max, maxPages }, "*"), 150);
    });
  }

  async function runImagesAutoScrollCapture(maxImages) {
    // This does NOT read DOM thumbnails as assets. It only scrolls the real /images UI
    // to force ChatGPT's own image_gen API calls; page-hook captures those JSON responses.
    contentSyncCancel = false;
    injectHook();
    const roundsMax = Math.min(1200, Math.max(80, Math.ceil(Number(maxImages || 7500) / 10)));
    const scroller = getBestScroller();
    let noMoveRounds = 0;
    let lastTop = -1;
    let lastHeight = 0;
    let rounds = 0;

    scrollToPosition(scroller, 0);
    await sleep(1200);

    for (let i = 0; i < roundsMax; i++) {
      if (contentSyncCancel) return { ok: false, mode: 'autosscroll-cancelled', cancelled: true, rounds };
      rounds = i + 1;
      const info = getScrollInfo(scroller);
      const atBottom = info.top + info.client >= info.height - 60;
      const grew = info.height > lastHeight + 20;
      const nextTop = Math.min(Math.max(0, info.height - info.client), info.top + Math.max(500, Math.floor(info.client * 0.82)));

      if (atBottom && !grew) noMoveRounds += 1;
      else noMoveRounds = 0;

      if (noMoveRounds >= 8) break;
      if (Math.abs(nextTop - lastTop) < 4 && atBottom) noMoveRounds += 1;
      lastTop = nextTop;
      lastHeight = info.height;
      scrollToPosition(scroller, nextTop);
      await sleep(900);
    }
    await sleep(1500);
    return { ok: true, mode: 'auto-scroll-api-capture', rounds };
  }


  async function runPageHookCursorSyncWithFallback(maxImages) {
    const first = await runPageHookCursorSync(maxImages);
    if (first.ok || Number(first.assets || 0) > 25) return first;
    // If the hook has no first-party request template yet, direct replay may 401.
    // Seed the template by scrolling the real /images UI enough to let ChatGPT
    // make its own authenticated image_gen request, then retry cursor replay.
    if (/401|HTTP|timeout|auth/i.test(first.error || "") || Number(first.assets || 0) <= 25) {
      await runImagesAutoScrollCapture(Math.min(Number(maxImages || 7500), 300));
      const retry = await runPageHookCursorSync(maxImages);
      if (retry.ok || Number(retry.assets || 0) > Number(first.assets || 0)) {
        return { ...retry, mode: "page-hook-v20-template-retry", firstError: first.error || "" };
      }
      return { ...first, mode: "page-hook-v20-template-retry-failed", retryError: retry.error || "" };
    }
    return first;
  }



  async function runGrokImagineAllAssetHistorySync(maxImages = 9500, media = "both") {
    contentSyncCancel = false;
    injectHook();
    const max = Math.max(1, Number(maxImages || 9500));
    const maxPages = Math.min(300, Math.max(1, Math.ceil(max / 40) + 2));
    let done = false, pages = 0, totalAssets = 0, totalAdded = 0, totalUpdated = 0;
    let lastError = "", found = false;
    let mergeChain = Promise.resolve();
    return await new Promise(resolve => {
      const finish = (payload = {}) => {
        if (done) return;
        done = true;
        window.removeEventListener("message", onPageMessage);
        clearTimeout(timer);
        mergeChain.finally(() => resolve({
          ok: !lastError || totalAssets > 0,
          skipped: !found,
          mode: "grok-imagine-all-assets",
          pages, assets: totalAssets, added: totalAdded, updated: totalUpdated,
          maxImages: max, error: totalAssets > 0 ? "" : (payload.error || lastError || ""),
          diagnostics: Array.isArray(payload.diagnostics) ? payload.diagnostics : [],
          path: payload.path || "", capturedVia: payload.capturedVia || ""
        }));
      };
      const onPageMessage = event => {
        if (event.source !== window) return;
        const data = event.data || {};
        if (data.source !== HOOK_SOURCE) return;
        if (data.type === "GROK_ASSET_HISTORY_SYNC_PAGE") {
          found = true;
          mergeChain = mergeChain.then(async () => {
            let assets = Array.isArray(data.assets) ? data.assets : [];
            if (media === "images") assets = assets.filter(a => a?.kind === "image");
            else if (media === "videos") assets = assets.filter(a => a?.kind === "video");
            if (!assets.length) { pages = Math.max(pages, Number(data.page || pages + 1)); return; }
            const merge = await chrome.runtime.sendMessage({
              type: "MERGE_SYNC_ASSETS", assets, api: data.url || location.href,
              page: data.page || pages + 1, cursor: data.pageToken || "", method: "CAPTURED_ASSETS"
            }).catch(e => ({ ok: false, error: e.message || String(e) }));
            pages = Math.max(pages, Number(data.page || pages + 1));
            totalAssets += assets.length;
            if (!merge || merge.ok === false) lastError = lastError || merge?.error || "merge failed";
            else { totalAdded += Number(merge.added || 0); totalUpdated += Number(merge.updated || 0); }
          });
          return;
        }
        if (data.type === "GROK_ASSET_HISTORY_SYNC_ERROR") {
          found = true;
          lastError = lastError || String(data.error || "");
          return;
        }
        if (data.type === "GROK_ASSET_HISTORY_SYNC_DONE") {
          found = !!data.found;
          pages = Math.max(pages, Number(data.pages || 0));
          finish(data);
        }
      };
      const timer = setTimeout(() => finish({ error: "Imagine All asset-history page request sync timed out" }), 240000);
      window.addEventListener("message", onPageMessage);
      setTimeout(() => window.postMessage({ source: EXT_SOURCE, type: "GROK_ASSET_HISTORY_SYNC_V20", maxImages: max, maxPages }, "*"), 100);
    });
  }


  async function runGrokImagineConversationHistorySync(maxImages = 9500, media = "both") {
    contentSyncCancel = false;
    injectHook();
    const max = Math.max(1, Number(maxImages || 9500));
    const maxPages = Math.min(300, Math.max(1, Math.ceil(max / 40) + 8));
    let done = false, pages = 0, totalAssets = 0, totalAdded = 0, totalUpdated = 0;
    let lastError = "", found = false;
    let mergeChain = Promise.resolve();

    return await new Promise(resolve => {
      const finish = (payload = {}) => {
        if (done) return;
        done = true;
        window.removeEventListener("message", onPageMessage);
        clearTimeout(timer);
        mergeChain.finally(() => resolve({
          ok: totalAssets > 0 || (!lastError && found), skipped: !found,
          mode: "grok-imagine-conversations", pages, assets: totalAssets,
          added: totalAdded, updated: totalUpdated, maxImages: max,
          error: totalAssets > 0 ? "" : (payload.error || lastError || ""),
          diagnostics: Array.isArray(payload.diagnostics) ? payload.diagnostics : [],
          path: payload.path || "", capturedVia: payload.capturedVia || "", firstSample: payload.firstSample || ""
        }));
      };

      const onPageMessage = event => {
        if (event.source !== window) return;
        const data = event.data || {};
        if (data.source !== HOOK_SOURCE) return;
        if (data.type === "GROK_IMAGINE_CONVERSATION_SYNC_PAGE") {
          found = true;
          mergeChain = mergeChain.then(async () => {
            let assets = Array.isArray(data.assets) ? data.assets : [];
            if (media === "images") assets = assets.filter(a => a?.kind === "image");
            else if (media === "videos") assets = assets.filter(a => a?.kind === "video");
            pages = Math.max(pages, Number(data.page || pages + 1));
            if (!assets.length) return;
            const merge = await chrome.runtime.sendMessage({
              type: "MERGE_SYNC_ASSETS", assets, api: data.url || location.href,
              page: data.page || pages, cursor: data.pageToken || "", method: "IMAGINE_CONVERSATIONS"
            }).catch(e => ({ ok: false, error: e.message || String(e) }));
            totalAssets += assets.length;
            if (!merge || merge.ok === false) lastError = lastError || merge?.error || "merge failed";
            else { totalAdded += Number(merge.added || 0); totalUpdated += Number(merge.updated || 0); }
          });
          return;
        }
        if (data.type === "GROK_IMAGINE_CONVERSATION_SYNC_ERROR") {
          found = true; lastError = lastError || String(data.error || ""); return;
        }
        if (data.type === "GROK_IMAGINE_CONVERSATION_SYNC_DONE") {
          found = !!data.found; pages = Math.max(pages, Number(data.pages || 0)); finish(data);
        }
      };

      const timer = setTimeout(() => finish({ error: totalAssets > 0 ? "" : "Imagine conversation history sync timed out" }), 120000);
      window.addEventListener("message", onPageMessage);
      setTimeout(() => window.postMessage({ source: EXT_SOURCE, type: "GROK_IMAGINE_CONVERSATION_SYNC_V20", maxImages: max, maxPages }, "*"), 100);
    });
  }

  async function runGrokPageFeedSync(maxImages = 7500) {
    contentSyncCancel = false;
    injectHook();
    const max = Math.max(1, Number(maxImages || 7500));
    let done = false, pages = 0, totalAssets = 0, totalAdded = 0, totalUpdated = 0, lastError = "";
    let mergeChain = Promise.resolve();
    return await new Promise(resolve => {
      const finish = (payload = {}) => {
        if (done) return;
        done = true;
        window.removeEventListener("message", onPageMessage);
        clearTimeout(timer);
        mergeChain.finally(() => resolve({
          ok: !lastError && !payload.error,
          mode: "grok-dynamic-page-feed",
          pages, assets: totalAssets, added: totalAdded, updated: totalUpdated,
          maxImages: max, error: payload.error || lastError || "",
          templates: Number(payload.templates || 0), capturedAssets: Number(payload.capturedAssets || 0),
          diagnostics: Array.isArray(payload.diagnostics) ? payload.diagnostics : []
        }));
      };
      const onPageMessage = event => {
        if (event.source !== window) return;
        const data = event.data || {};
        if (data.source !== HOOK_SOURCE) return;
        if (data.type === "GROK_FEED_SYNC_PAGE") {
          mergeChain = mergeChain.then(async () => {
            const assets = Array.isArray(data.assets) ? data.assets : [];
            const merge = await chrome.runtime.sendMessage({
              type: "MERGE_SYNC_ASSETS", assets, api: data.url || location.href,
              page: data.page || pages + 1, cursor: data.cursor || "", method: "CAPTURED"
            }).catch(e => ({ ok: false, error: e.message || String(e) }));
            pages = Math.max(pages, Number(data.page || pages + 1));
            totalAssets += assets.length;
            if (!merge || merge.ok === false) lastError = merge?.error || "merge failed";
            else { totalAdded += Number(merge.added || 0); totalUpdated += Number(merge.updated || 0); }
          });
          return;
        }
        if (data.type === "GROK_FEED_SYNC_ERROR") {
          // A stale captured template should not discard assets from other templates.
          lastError = lastError || String(data.error || "");
          return;
        }
        if (data.type === "GROK_FEED_SYNC_DONE") finish(data);
      };
      const timer = setTimeout(() => finish({ error: "Grok dynamic feed capture unavailable (12s timeout)" }), 12000);
      window.addEventListener("message", onPageMessage);
      setTimeout(() => window.postMessage({ source: EXT_SOURCE, type: "GROK_PAGE_FEED_SYNC_V20", maxImages: max, maxPages: Math.min(300, Math.ceil(max / 20) + 10) }, "*"), 100);
    });
  }

  function grokAbs(raw) {
    const value = String(raw || "").trim();
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith("users/")) return `https://assets.grok.com/${value}`;
    if (value.startsWith("/")) return `${location.origin}${value}`;
    return value;
  }
  function grokKindFrom(item) {
    const mt = String(item?.mediaType || item?.mimeType || item?.type || "").toLowerCase();
    if (mt.includes("video") || mt.includes("mp4")) return "video";
    return "image";
  }
  function extractGrokPostAssets(json, apiUrl, mediaFilter = "both") {
    const out = [], seen = new Set();
    const allowImage = mediaFilter === "both" || mediaFilter === "images";
    const allowVideo = mediaFilter === "both" || mediaFilter === "videos";
    const visit = (item, parentPost = null) => {
      if (!item || typeof item !== "object") return;
      const url = grokAbs(item.mediaUrl || item.url || "");
      const mimeType = String(item.mimeType || "");
      const kind = grokKindFrom(item);
      if (url && ((kind === "image" && allowImage) || (kind === "video" && allowVideo))) {
        const key = `${item.id || ""}|${url}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({
            source: "grok", grokMode: "imagen", kind,
            sourceId: item.id || key, postId: item.id || parentPost?.id || "", url,
            previewUrl: grokAbs(item.thumbnailImageUrl || (kind === "image" ? url : "")),
            mimeType, extHint: mimeType || url,
            prompt: item.prompt || item.originalPrompt || parentPost?.prompt || parentPost?.originalPrompt || (kind === "video" ? "Grok video" : "Grok image"),
            createdAt: coerceDate(item.createTime || item.createdAt || parentPost?.createTime) || nowIso(),
            sourceApi: apiUrl || "", contextId: item.originalPostId || parentPost?.id || "", keyName: "grok.post.mediaUrl",
            capturedAt: nowIso(), width: Number(item?.resolution?.width || 0), height: Number(item?.resolution?.height || 0),
            duration: item.videoDuration || 0, resolutionName: item.resolutionName || "", folderPrefix: "Grok/Imagen"
          });
        }
      }
      for (const child of (Array.isArray(item.images) ? item.images : [])) visit(child, item);
      for (const child of (Array.isArray(item.videos) ? item.videos : [])) visit(child, item);
      for (const child of (Array.isArray(item.childPosts) ? item.childPosts : [])) visit(child, item);
    };
    for (const post of (Array.isArray(json?.posts) ? json.posts : [])) visit(post, post);
    return out;
  }
  function nextGrokCursor(json) {
    const c = json && typeof json === "object" ? (json.nextCursor || json.cursor || "") : "";
    return typeof c === "string" || typeof c === "number" ? String(c || "") : "";
  }


  // v2.32.77: Grok's flat / Imagine All view uses a separate paginated asset-history
  // request (basename "assets") instead of /rest/media/post/list. Capture that request
  // passively from Resource Timing; do not scroll or interact with the page.
  const grokFlatAssetRequestUrls = new Set();
  function isGrokFlatAssetHistoryUrl(raw) {
    try {
      const u = new URL(String(raw || ""), location.href);
      if (u.hostname !== "grok.com") return false;
      const last = u.pathname.split('/').filter(Boolean).pop() || "";
      if (last.toLowerCase() !== "assets") return false;
      const wk = String(u.searchParams.get("workspaceKind") || "");
      const order = String(u.searchParams.get("orderBy") || "");
      return /IMAGINE/i.test(wk) || /CREATE_TIME/i.test(order) || u.searchParams.has("pageSize");
    } catch (_) { return false; }
  }
  function rememberGrokFlatAssetHistoryUrl(raw) {
    try {
      const u = new URL(String(raw || ""), location.href);
      if (!isGrokFlatAssetHistoryUrl(u.href)) return;
      grokFlatAssetRequestUrls.add(u.href);
      while (grokFlatAssetRequestUrls.size > 12) grokFlatAssetRequestUrls.delete(grokFlatAssetRequestUrls.values().next().value);
    } catch (_) {}
  }
  try {
    for (const e of performance.getEntriesByType("resource")) rememberGrokFlatAssetHistoryUrl(e?.name || "");
    const grokAssetPerfObserver = new PerformanceObserver(list => {
      for (const e of list.getEntries()) rememberGrokFlatAssetHistoryUrl(e?.name || "");
    });
    grokAssetPerfObserver.observe({ type: "resource", buffered: true });
  } catch (_) {}

  function findGrokFlatAssetHistoryUrl() {
    try {
      for (const e of performance.getEntriesByType("resource")) rememberGrokFlatAssetHistoryUrl(e?.name || "");
    } catch (_) {}
    const urls = [...grokFlatAssetRequestUrls];
    if (!urls.length) return "";
    // Prefer the exact Imagine All / create-time feed seen in the user's flat view.
    urls.sort((a, b) => {
      const score = raw => {
        try {
          const u = new URL(raw);
          let n = 0;
          if (u.searchParams.get("workspaceKind") === "WORKSPACE_KIND_IMAGINE_ALL") n += 10;
          if (u.searchParams.get("orderBy") === "ORDER_BY_CREATE_TIME") n += 5;
          if (u.searchParams.has("pageToken")) n += 1;
          return n;
        } catch (_) { return 0; }
      };
      return score(b) - score(a);
    });
    return urls[0] || "";
  }

  function nextGrokAssetPageToken(json) {
    if (!json || typeof json !== "object") return "";
    const direct = json.nextPageToken ?? json.next_page_token ?? json.nextToken ?? json.continuationToken ?? "";
    if (typeof direct === "string" || typeof direct === "number") return String(direct || "");
    const nests = [json.pagination, json.pageInfo, json.page, json.meta];
    for (const obj of nests) {
      if (!obj || typeof obj !== "object") continue;
      const v = obj.nextPageToken ?? obj.next_page_token ?? obj.nextToken ?? obj.continuationToken ?? "";
      if (typeof v === "string" || typeof v === "number") return String(v || "");
    }
    return "";
  }

  function extractGrokFlatAssetHistoryAssets(json, apiUrl, mediaFilter = "both") {
    const out = [];
    const seen = new Set();
    const visited = new WeakSet();
    const allowImage = mediaFilter === "both" || mediaFilter === "images";
    const allowVideo = mediaFilter === "both" || mediaFilter === "videos";
    const primaryFields = [
      "hd1080MediaUrl", "hdMediaUrl", "mediaUrl", "assetUrl", "downloadUrl",
      "videoUrl", "imageUrl", "fileUrl", "originalUrl", "sourceUrl", "url", "uri", "src",
      "media_url", "asset_url", "download_url", "video_url", "image_url", "file_url", "original_url", "source_url"
    ];
    const previewFields = ["thumbnailImageUrl", "thumbnailUrl", "thumbnail_url", "previewImageUrl", "previewUrl", "posterUrl"];
    const firstString = (obj, fields) => {
      for (const k of fields) if (typeof obj?.[k] === "string" && obj[k].trim()) return obj[k].trim();
      return "";
    };
    const mediaKind = (obj, rawUrl) => {
      const mt = String(obj?.mimeType || obj?.contentType || obj?.mediaType || obj?.type || "").toLowerCase();
      const u = String(rawUrl || "").toLowerCase();
      if (mt.includes("video") || /\.(?:mp4|webm|mov)(?:[?#]|$)/i.test(u)) return "video";
      if (mt.includes("image") || /\.(?:jpe?g|png|webp|gif|avif)(?:[?#]|$)/i.test(u)) return "image";
      if (/\/generated\/[^/]+\/(?:generated_video|video)\./i.test(u)) return "video";
      if (/\/generated\/[^/]+\/(?:image|generated_image|preview_image)\./i.test(u)) return "image";
      return "";
    };
    const pushFrom = (obj, parent = null) => {
      const raw = firstString(obj, primaryFields);
      if (!raw) return;
      const url = grokAbs(raw);
      const kind = mediaKind(obj, url);
      if (!kind || (kind === "image" && !allowImage) || (kind === "video" && !allowVideo)) return;
      // Exclude obvious API/page URLs accidentally stored in generic `url` fields.
      if (/^https?:\/\/grok\.com\//i.test(url) && !/\.(?:jpe?g|png|webp|gif|avif|mp4|webm|mov)(?:[?#]|$)/i.test(url)) return;
      const id = String(obj?.id || obj?.assetId || obj?.generationId || obj?.postId || obj?.uuid || parent?.id || "");
      const key = `${kind}|${id}|${url}`;
      if (seen.has(key)) return;
      seen.add(key);
      const previewRaw = firstString(obj, previewFields) || firstString(parent, previewFields);
      const mimeType = String(obj?.mimeType || obj?.contentType || "");
      out.push({
        source: "grok", grokMode: "imagen", kind,
        sourceId: id || url, postId: String(obj?.postId || obj?.generationId || id || ""),
        generationId: String(obj?.generationId || obj?.postId || id || ""),
        url, previewUrl: grokAbs(previewRaw || (kind === "image" ? url : "")),
        mimeType, extHint: mimeType || url,
        prompt: String(obj?.prompt || obj?.originalPrompt || obj?.title || parent?.prompt || parent?.originalPrompt || (kind === "video" ? "Grok asset video" : "Grok asset image")),
        createdAt: coerceDate(obj?.createTime || obj?.createdAt || obj?.creationTime || obj?.updatedAt || parent?.createTime || parent?.createdAt) || nowIso(),
        sourceApi: apiUrl || "", contextId: String(obj?.conversationId || obj?.contextId || parent?.conversationId || ""),
        keyName: "grok.flat.assets", capturedAt: nowIso(),
        width: Number(obj?.resolution?.width || obj?.width || 0), height: Number(obj?.resolution?.height || obj?.height || 0),
        duration: Number(obj?.videoDuration || obj?.duration || 0), resolutionName: String(obj?.resolutionName || ""), folderPrefix: "Grok/Imagen"
      });
    };
    const walk = (value, parent = null, depth = 0) => {
      if (!value || typeof value !== "object" || depth > 16) return;
      if (visited.has(value)) return;
      visited.add(value);
      if (!Array.isArray(value)) pushFrom(value, parent);
      if (Array.isArray(value)) {
        for (const item of value) walk(item, parent, depth + 1);
      } else {
        for (const child of Object.values(value)) if (child && typeof child === "object") walk(child, value, depth + 1);
      }
    };
    walk(json, null, 0);

    // Also catch private generated URLs embedded in unexpected string fields.
    let text = "";
    try { text = JSON.stringify(json); } catch (_) {}
    for (const raw of extractGrokGeneratedUrlsFromText(text)) {
      const a = grokGeneratedAssetFromUrl(raw, mediaFilter, "flat-assets-json");
      if (!a) continue;
      const key = `${a.kind}|${a.sourceId || ""}|${a.url || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      a.sourceApi = apiUrl || "";
      a.folderPrefix = "Grok/Imagen";
      out.push(a);
    }

    // v2.32.78: the newer flat asset feed can use field names that differ from
    // media/post/list. As a final parser fallback, collect concrete media URLs
    // from the JSON text itself. This is still passive parsing of the response.
    const decodedText = String(text || "")
      .replace(/\\u002[Ff]/g, "/")
      .replace(/\\u0026/g, "&")
      .replace(/\\\//g, "/");
    const urlMatches = decodedText.match(/https?:\/\/[^\s"'<>\\]+/g) || [];
    for (let raw of urlMatches) {
      raw = String(raw || "").replace(/[),.;]+$/, "");
      const lower = raw.toLowerCase();
      if (!/(?:assets\.grok\.com|imagine-public\.x\.ai)/i.test(raw)) continue;
      let kind = "";
      if (/\.(?:mp4|webm|mov)(?:[?#]|$)/i.test(lower)) kind = "video";
      else if (/\.(?:jpe?g|png|webp|gif|avif)(?:[?#]|$)/i.test(lower)) kind = "image";
      if (!kind || (kind === "image" && !allowImage) || (kind === "video" && !allowVideo)) continue;
      const idm = raw.match(/\/generated\/([^/?#]+)\//i) || raw.match(/\/([^/?#]+?)(?:_1080_hd|_hd|_thumbnail)?\.(?:mp4|webm|mov|jpe?g|png|webp|gif|avif)(?:[?#]|$)/i);
      const id = idm?.[1] || raw;
      const key = `${kind}|${id}|${raw}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        source: "grok", grokMode: "imagen", kind, sourceId: id, postId: id, generationId: id,
        url: raw, previewUrl: kind === "image" ? raw : "", mimeType: kind === "video" ? "video/mp4" : "image/jpeg", extHint: raw,
        prompt: kind === "video" ? "Grok asset video" : "Grok asset image", createdAt: nowIso(), sourceApi: apiUrl || "",
        contextId: "", keyName: "grok.flat.assets.url-fallback", capturedAt: nowIso(), width: 0, height: 0, duration: 0, resolutionName: "", folderPrefix: "Grok/Imagen"
      });
    }
    return preferFullGrokGeneratedAssets(out);
  }

  async function getJsonDetailed(url, timeoutMs = 10000) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method: "GET", credentials: "include", cache: "no-store", headers: { "accept": "application/json, text/plain, */*" }, signal: ctl.signal });
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch (_) {}
      return { ok: res.ok, status: res.status, statusText: res.statusText || "", text, json, contentType: res.headers.get("content-type") || "" };
    } catch (error) {
      if (error?.name === "AbortError") return { ok: false, status: 0, statusText: "timeout", text: "", json: null, error: "timeout" };
      return { ok: false, status: 0, statusText: "network-error", text: "", json: null, error: error?.message || String(error) };
    } finally {
      clearTimeout(timer);
    }
  }

  function summarizeGrokFlatAssetJson(json) {
    if (!json || typeof json !== "object") return "non-object";
    const keys = Object.keys(json).slice(0, 10);
    const arrays = [];
    for (const [k, v] of Object.entries(json)) if (Array.isArray(v)) arrays.push(`${k}:${v.length}`);
    const token = nextGrokAssetPageToken(json);
    return `keys ${keys.join(",") || "-"}; arrays ${arrays.slice(0, 6).join(",") || "-"}; nextToken ${token ? "yes" : "no"}`;
  }

  async function resolveGrokFlatAssetHistoryBaseUrl() {
    const captured = findGrokFlatAssetHistoryUrl();
    const candidates = [];
    if (captured) candidates.push(captured);
    // The Network request shown by Grok's flat Imagine view is named "assets".
    // quota_info lives under /rest/media/imagine/, so probe that concrete sibling
    // directly instead of requiring the request to have been observed beforehand.
    candidates.push(
      `${location.origin}/rest/media/imagine/assets`,
      `${location.origin}/rest/media/assets`
    );
    const unique = [...new Set(candidates)];
    const attempts = [];
    for (const raw of unique) {
      const u = new URL(raw, location.href);
      u.searchParams.set("pageSize", "40");
      u.searchParams.set("orderBy", "ORDER_BY_CREATE_TIME");
      u.searchParams.set("workspaceKind", "WORKSPACE_KIND_IMAGINE_ALL");
      u.searchParams.delete("pageToken");
      const result = await getJsonDetailed(u.href, 10000);
      attempts.push({ url: u.href, path: u.pathname, status: result.status, ok: result.ok, json: result.json, detail: summarizeGrokFlatAssetJson(result.json), error: result.error || "" });
      if (result.ok && result.json && typeof result.json === "object") return { url: u.href, first: result, attempts };
    }
    return { url: "", first: null, attempts };
  }

  async function runGrokFlatAssetHistorySync(maxImages = 7500, media = "both") {
    const resolved = await resolveGrokFlatAssetHistoryBaseUrl();
    if (!resolved.url) {
      const probeText = resolved.attempts.map(a => `${a.path}:${a.status || a.error || "failed"}`).join(", ");
      return { ok: true, skipped: true, pages: 0, assets: 0, added: 0, updated: 0, assetKeys: [], diagnostics: [{ summary: `FLAT ASSETS: endpoint not found; probes ${probeText || "-"}` }] };
    }
    const max = Math.max(1, Number(maxImages || 7500));
    const pageSize = 40;
    const maxPages = Math.max(1, Math.ceil(max / pageSize));
    const u = new URL(resolved.url, location.href);
    u.searchParams.set("pageSize", String(pageSize));
    u.searchParams.set("orderBy", "ORDER_BY_CREATE_TIME");
    u.searchParams.set("workspaceKind", "WORKSPACE_KIND_IMAGINE_ALL");
    u.searchParams.delete("pageToken");
    let pages = 0, totalAssets = 0, added = 0, updated = 0;
    let token = "";
    const seenTokens = new Set();
    const assetKeys = new Set();
    let firstSample = "";
    let firstShape = summarizeGrokFlatAssetJson(resolved.first?.json);
    for (let page = 0; page < maxPages && totalAssets < max; page++) {
      if (contentSyncCancel) break;
      if (token) u.searchParams.set("pageToken", token); else u.searchParams.delete("pageToken");
      const api = u.href;
      let json;
      if (page === 0 && resolved.first?.json) json = resolved.first.json;
      else {
        const detail = await getJsonDetailed(api, 12000);
        if (!detail.ok || !detail.json) throw new Error(`FLAT ASSETS ${u.pathname} HTTP ${detail.status || detail.error || "failed"}`);
        json = detail.json;
      }
      let assets = extractGrokFlatAssetHistoryAssets(json, api, media);
      const fresh = [];
      for (const a of assets) {
        const key = `${a?.kind || ""}|${a?.sourceId || a?.postId || ""}|${a?.url || ""}`;
        if (!key || assetKeys.has(key)) continue;
        assetKeys.add(key);
        fresh.push(a);
        if (totalAssets + fresh.length >= max) break;
      }
      assets = fresh.slice(0, Math.max(0, max - totalAssets));
      const next = nextGrokAssetPageToken(json);
      if (!firstSample && assets[0]) firstSample = `${String(assets[0].sourceId || assets[0].postId || "").slice(0, 8)}:${assets[0].kind}`;
      if (assets.length) {
        const merge = await mergePage(assets, api, pages + 1, next);
        totalAssets += assets.length;
        added += Number(merge.added || 0);
        updated += Number(merge.updated || 0);
      }
      pages++;
      if (!next || seenTokens.has(next) || totalAssets >= max) break;
      seenTokens.add(next);
      token = next;
    }
    const path = u.pathname;
    const probes = resolved.attempts.map(a => `${a.path}:${a.status}`).join(",");
    return {
      ok: true, skipped: false, pages, assets: totalAssets, added, updated, assetKeys: [...assetKeys],
      diagnostics: [{ summary: `FLAT ASSETS: ${path}; probes ${probes}; pages ${pages}; media ${totalAssets}; sample ${firstSample || "-"}; ${firstShape}` }]
    };
  }
  function safeBoardName(name, id) {
    const base = String(name || "").replace(/[\/:*?"<>|]+/g, "_").replace(/\s+/g, "_").trim().slice(0, 80);
    if (base) return base;
    const short = String(id || "").slice(0, 8);
    return short ? `Board_${short}` : "Board";
  }
  function collectObjects(root, predicate, out = []) {
    if (!root || typeof root !== "object") return out;
    if (predicate(root)) out.push(root);
    if (Array.isArray(root)) for (const v of root) collectObjects(v, predicate, out);
    else for (const v of Object.values(root)) collectObjects(v, predicate, out);
    return out;
  }
  function parseCardJsonList(value) {
    const arr = Array.isArray(value) ? value : [];
    const out = [];
    for (const raw of arr) {
      if (typeof raw === "string") { try { out.push(JSON.parse(raw)); } catch (_) {} }
      else if (raw && typeof raw === "object") out.push(raw);
    }
    return out;
  }
  function extractGrokBoardAssetsFromResponses(json, board, apiUrl, mediaFilter = "both") {
    const out = [], seen = new Set();
    const allowImage = mediaFilter === "both" || mediaFilter === "images";
    const allowVideo = mediaFilter === "both" || mediaFilter === "videos";
    const boardFolder = `Grok/Boards/${safeBoardName(board?.name, board?.id)}`;
    const responses = collectObjects(json, o => Array.isArray(o.cardAttachmentsJson));
    for (const response of responses) {
      for (const card of parseCardJsonList(response.cardAttachmentsJson)) {
        const candidates = [];
        if (card?.type === "imagine_image_to_image" || card?.cardType === "generated_image_card") {
          const chunk = card.image_chunk || card.imageChunk || {};
          const url = grokAbs(chunk.imageUrl || "");
          if (url && !/-part-\d+\//.test(url) && allowImage) candidates.push({ kind: "image", url, mimeType: "image/jpeg", sourceId: chunk.imageUuid || card.id || url, prompt: chunk?.imagePrompt?.prompt || response.message || "Grok board image", createdAt: response.createTime, width: chunk?.resolution?.width || card?.resolution?.width, height: chunk?.resolution?.height || card?.resolution?.height });
        }
        if (card?.type === "render_imagine_media" || card?.cardType === "rendered_file_card") {
          const url = grokAbs(card.url || card.fileUrl || "");
          const mimeType = String(card.mime_type || card.mimeType || "");
          const kind = /video|mp4/i.test(`${mimeType} ${url}`) ? "video" : "image";
          if (url && ((kind === "image" && allowImage) || (kind === "video" && allowVideo))) candidates.push({ kind, url, mimeType, sourceId: card.id || url, prompt: card.file_name || response.message || (kind === "video" ? "Grok board video" : "Grok board image"), createdAt: response.createTime, previewUrl: grokAbs(card.thumbnail_url || card.thumbnailUrl || card.thumbnailImageUrl || "") });
        }
        for (const obj of collectObjects(card, o => !!(o.mediaUrl || o.url) && !!(o.mimeType || o.mime_type || o.mediaType))) {
          const url = grokAbs(obj.mediaUrl || obj.url || "");
          const mimeType = String(obj.mimeType || obj.mime_type || obj.mediaType || "");
          const kind = /video|mp4/i.test(`${mimeType} ${url}`) ? "video" : "image";
          if (url && ((kind === "image" && allowImage) || (kind === "video" && allowVideo))) candidates.push({ kind, url, mimeType, sourceId: obj.id || obj.imageUuid || url, prompt: obj.prompt || obj.originalPrompt || response.message || (kind === "video" ? "Grok board video" : "Grok board image"), createdAt: obj.createTime || obj.createdAt || response.createTime, previewUrl: grokAbs(obj.thumbnailImageUrl || obj.thumbnail_url || obj.previewImageUrl || "") });
        }
        for (const c of candidates) {
          const key = `${c.kind}|${c.sourceId}|${c.url}`;
          if (seen.has(key)) continue; seen.add(key);
          out.push({ source: "grok", grokMode: "boards", kind: c.kind, sourceId: c.sourceId, postId: c.sourceId, url: c.url,
            previewUrl: c.previewUrl || (c.kind === "image" ? c.url : ""), mimeType: c.mimeType, extHint: c.mimeType || c.url,
            prompt: c.prompt || (c.kind === "video" ? "Grok board video" : "Grok board image"), createdAt: coerceDate(c.createdAt || board?.updatedAt || board?.createdAt) || nowIso(),
            sourceApi: apiUrl || "", contextId: response.responseId || "", conversationId: response.conversationId || "", boardId: board?.id || "", boardName: board?.name || "", keyName: "grok.board.cardAttachmentsJson", capturedAt: nowIso(), width: Number(c.width || 0), height: Number(c.height || 0), folderPrefix: boardFolder });
        }
      }
    }
    return out;
  }
  async function postJsonDetailed(url, body) {
    // v2.32.75: Grok page requests must never be allowed to stall Connect forever.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(url, { method: "POST", credentials: "include", cache: "no-store", headers: { "content-type": "application/json", "accept": "application/json, text/plain, */*" }, body: JSON.stringify(body || {}), signal: ctl.signal });
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch (_) {}
      return { ok: res.ok, status: res.status, statusText: res.statusText || "", text, json };
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("Page request timed out after 8 seconds");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  async function postJson(url, body) {
    // v2.32.76: restored the original direct page-request behavior. The source
    // feed request itself is allowed to complete normally; the background job
    // watchdog protects the overall Connect operation.
    const res = await fetch(url, { method: "POST", credentials: "include", cache: "no-store", headers: { "content-type": "application/json", "accept": "application/json, text/plain, */*" }, body: JSON.stringify(body || {}) });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return JSON.parse(text);
  }
  async function getJson(url) {
    const res = await fetch(url, { method: "GET", credentials: "include", cache: "no-store", headers: { "accept": "application/json, text/plain, */*" } });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return JSON.parse(text);
  }
  async function mergePage(assets, api, page, cursor = "") {
    const merge = await chrome.runtime.sendMessage({ type: "MERGE_SYNC_ASSETS", assets, api, page, cursor, method: api.includes('/post/list') || api.includes('/canvas/list') || api.includes('/conversation/get') ? "POST" : "GET" }).catch(e => ({ ok: false, error: e.message || String(e) }));
    if (!merge || merge.ok === false) throw new Error(merge?.error || "merge failed");
    return merge;
  }
  function isAllowedGrokMediaKind(kind, media = "both") {
    if (media === "videos") return kind === "video";
    if (media === "images") return kind === "image";
    return kind === "image" || kind === "video";
  }

  function cleanGrokAssetUrlText(raw) {
    let value = String(raw || "").trim();
    if (!value) return "";
    for (let i = 0; i < 3; i++) {
      value = value
        .replace(/&amp;/g, "&")
        .replace(/\\u002[Ff]/g, "/")
        .replace(/\\u0026/g, "&")
        .replace(/\\u003[Dd]/g, "=")
        .replace(/\\u003[Ff]/g, "?")
        .replace(/\\//g, "/")
        .replace(/\\u002[Dd]/g, "-");
    }
    value = value.replace(/[\"'<>),;]+$/g, "");
    if (/^https?:\/\/assets\.grok\.com\//i.test(value)) return value;
    if (/^assets\.grok\.com\//i.test(value)) return `https://${value}`;
    if (/^\/users\//i.test(value)) return `https://assets.grok.com${value}`;
    if (/^users\//i.test(value)) return `https://assets.grok.com/${value}`;
    return value;
  }

  function grokGeneratedAssetInfo(raw) {
    try {
      const u = new URL(cleanGrokAssetUrlText(raw), location.href);
      if (u.hostname !== "assets.grok.com") return null;
      const m = u.pathname.match(/^\/users\/([^/]+)\/generated\/([^/]+)\/(.+\.(?:mp4|webm|webp|png|jpe?g))$/i);
      if (!m) return null;
      const filename = decodeURIComponent((m[3] || "").split("/").pop() || m[3] || "");
      const kind = /\.(mp4|webm)$/i.test(filename) ? "video" : "image";
      return {
        userId: decodeURIComponent(m[1] || ""),
        generationId: decodeURIComponent(m[2] || ""),
        filename,
        kind,
        url: u.href
      };
    } catch (_) { return null; }
  }

  function extractGrokGeneratedUrlsFromText(text) {
    const out = [];
    const variants = [];
    const original = String(text || "");
    if (!original) return out;
    variants.push(original);
    variants.push(cleanGrokAssetUrlText(original));
    variants.push(original.replace(/\\u002[Ff]/g, "/").replace(/\\//g, "/").replace(/&amp;/g, "&"));
    const seenVariant = new Set();
    const patterns = [
      /https?:\/\/assets\.grok\.com\/users\/[^"'\s<>()]+\/generated\/[^"'\s<>()]+\/[^"'\s<>()]+?\.(?:mp4|webm|webp|png|jpe?g)(?:\?[^"'\s<>()]*)?/gi,
      /(?:^|["'\s(<])((?:\/)?users\/[^"'\s<>()]+\/generated\/[^"'\s<>()]+\/[^"'\s<>()]+?\.(?:mp4|webm|webp|png|jpe?g)(?:\?[^"'\s<>()]*)?)/gi,
      /assets\.grok\.com\/users\/[^"'\s<>()]+\/generated\/[^"'\s<>()]+\/[^"'\s<>()]+?\.(?:mp4|webm|webp|png|jpe?g)(?:\?[^"'\s<>()]*)?/gi
    ];
    for (const variant of variants) {
      if (!variant || seenVariant.has(variant)) continue;
      seenVariant.add(variant);
      for (const re of patterns) {
        let m;
        re.lastIndex = 0;
        while ((m = re.exec(variant))) out.push(m[1] || m[0]);
      }
    }
    return out.map(cleanGrokAssetUrlText).filter(Boolean);
  }

  function grokGeneratedAssetFromUrl(raw, media = "both", reason = "generated-assets-fallback") {
    const info = grokGeneratedAssetInfo(raw);
    if (!info || !isAllowedGrokMediaKind(info.kind, media)) return null;
    return {
      source: "grok",
      grokMode: "imagen",
      kind: info.kind,
      sourceId: `${info.generationId}:${info.filename}`,
      postId: info.generationId,
      url: info.url,
      previewUrl: info.kind === "image" ? info.url : "",
      mimeType: info.kind === "video" ? (info.filename.toLowerCase().endsWith(".webm") ? "video/webm" : "video/mp4") : (info.filename.toLowerCase().endsWith(".webp") ? "image/webp" : info.filename.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg"),
      extHint: info.filename,
      prompt: info.kind === "video" ? "Grok generated video" : "Grok generated image",
      createdAt: nowIso(),
      sourceApi: location.href,
      contextId: info.generationId,
      generationId: info.generationId,
      keyName: `grok.${reason}`,
      capturedAt: nowIso(),
      folderPrefix: "Grok/Imagen"
    };
  }

  function collectCssUrls(value) {
    const out = [];
    const re = /url\((['"]?)(.*?)\1\)/gi;
    let m;
    while ((m = re.exec(String(value || "")))) if (m[2]) out.push(m[2]);
    return out;
  }

  function collectGrokGeneratedAssetsFromPage(media = "both") {
    const urls = [];
    try {
      for (const e of performance.getEntriesByType("resource") || []) if (e?.name) urls.push(e.name);
    } catch (_) {}
    try {
      const nodes = Array.from(document.querySelectorAll('video, source, img, a, [src], [href], [poster], [style], [data-src], [data-url]'));
      for (const el of nodes) {
        const direct = [
          el.currentSrc, el.src, el.href, el.poster,
          el.getAttribute?.('src'), el.getAttribute?.('href'), el.getAttribute?.('poster'),
          el.getAttribute?.('data-src'), el.getAttribute?.('data-url')
        ].filter(Boolean);
        const srcset = el.getAttribute?.('srcset') || "";
        if (srcset) for (const part of String(srcset).split(',')) {
          const u = part.trim().split(/\s+/)[0];
          if (u) direct.push(u);
        }
        try { direct.push(...collectCssUrls(el.getAttribute?.('style') || "")); } catch (_) {}
        try { direct.push(...collectCssUrls(getComputedStyle(el).backgroundImage || "")); } catch (_) {}
        urls.push(...direct);
      }
    } catch (_) {}
    try {
      const html = String(document.documentElement?.innerHTML || "");
      urls.push(...extractGrokGeneratedUrlsFromText(html));
    } catch (_) {}
    try {
      for (const sc of Array.from(document.scripts || [])) {
        const txt = String(sc.textContent || sc.innerHTML || "");
        if (/generated|assets\.grok|users\?\//i.test(txt)) urls.push(...extractGrokGeneratedUrlsFromText(txt));
      }
    } catch (_) {}
    try {
      for (const el of Array.from(document.querySelectorAll('[data-state], [data-testid], [aria-label], [title], [alt]'))) {
        urls.push(...extractGrokGeneratedUrlsFromText(`${el.getAttribute?.('data-state') || ""} ${el.getAttribute?.('aria-label') || ""} ${el.getAttribute?.('title') || ""} ${el.getAttribute?.('alt') || ""}`));
      }
    } catch (_) {}
    const out = [];
    const seen = new Set();
    for (const raw of urls) {
      const asset = grokGeneratedAssetFromUrl(raw, media, "generated-assets-page-scan");
      if (!asset) continue;
      const key = asset.sourceId || asset.url;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(asset);
    }
    return out;
  }

  function grokPreviewSiblingCandidateUrls(raw, media = "both") {
    const info = grokGeneratedAssetInfo(raw);
    if (!info) return [];
    const name = String(info.filename || "").toLowerCase();
    if (!/^preview_image\.(?:jpe?g|png|webp)$/.test(name)) return [];
    const allowImage = media === "both" || media === "images";
    const allowVideo = media === "both" || media === "videos";
    let base = "";
    let query = "?cache=1";
    try {
      const u = new URL(info.url, location.href);
      query = u.search || "?cache=1";
      base = u.href.replace(/\/[^/?#]+(?:[?#].*)?$/, "/");
    } catch (_) {
      base = String(info.url || "").replace(/\/[^/?#]+(?:[?#].*)?$/, "/");
    }
    const names = [];
    if (allowVideo) names.push("generated_video.mp4", "generated_video.webm");
    if (allowImage) {
      // Keep the already-present preview as an image fallback because Grok now
      // often exposes only preview_image.jpg in group pages until a card is opened.
      names.push(
        info.filename,
        "image.jpg", "image.jpeg", "image.png", "image.webp",
        "generated_image.jpg", "generated_image.jpeg", "generated_image.webp", "generated_image.png"
      );
    }
    const out = [];
    const seen = new Set();
    for (const n of names) {
      if (!n) continue;
      const url = `${base}${n}${query}`;
      if (seen.has(url)) continue;
      seen.add(url);
      out.push(url);
    }
    return out;
  }

  async function probeGrokAssetExists(url) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 2500);
      const res = await fetch(url, { method: "HEAD", credentials: "include", cache: "force-cache", signal: ctl.signal });
      clearTimeout(t);
      const ct = res.headers?.get?.("content-type") || "";
      if (res.ok && /image\/(png|jpe?g|webp)|video\/(mp4|webm)/i.test(ct)) return ct;
      // Some Cloudflare edge paths return a generic type on HEAD but still expose
      // a sane length. Accept generated sibling names when HEAD is 2xx.
      if (res.ok && /\/generated\/[^/]+\/(?:generated_video|generated_image|preview_image|image|video)\./i.test(url)) return /\.(mp4|webm)(?:[?#]|$)/i.test(url) ? "video/mp4" : "image/jpeg";
    } catch (_) {}
    return "";
  }


  function grokCardRootForAnchor(a) {
    if (!a) return null;
    return a.closest?.('[data-masonry-key]')
      || a.closest?.('[role="listitem"]')
      || a.closest?.('.group\\/compact-card')
      || a.parentElement?.parentElement
      || a.parentElement
      || null;
  }

  function grokCardPreviewForRef(ref) {
    const roots = [];
    const pushRoot = (el) => { if (el && !roots.includes(el)) roots.push(el); };
    pushRoot(ref?.root);
    pushRoot(ref?.anchor?.parentElement);
    pushRoot(ref?.anchor?.parentElement?.parentElement);
    pushRoot(ref?.anchor?.closest?.('.relative.cursor-pointer'));
    pushRoot(ref?.anchor?.closest?.('[role="listitem"]'));
    pushRoot(ref?.anchor?.closest?.('[data-masonry-key]'));

    const candidates = [];
    const push = (value, source) => {
      const raw = String(value || '').trim();
      if (raw) candidates.push({ raw, source });
    };
    for (const root of roots) {
      for (const img of Array.from(root.querySelectorAll?.('img') || [])) {
        push(img.currentSrc, 'img.currentSrc');
        push(img.src, 'img.src');
        push(img.getAttribute?.('src'), 'img[src]');
        const srcset = img.getAttribute?.('srcset') || '';
        for (const part of String(srcset).split(',')) push(part.trim().split(/\s+/)[0], 'img[srcset]');
      }
      try {
        for (const raw of extractGrokGeneratedUrlsFromText(root.outerHTML || '')) push(raw, 'root.outerHTML');
      } catch (_) {}
    }
    // Last-resort direct lookup by post/generation id. In the current Grok cards the
    // post id and generated folder id are normally identical.
    if (ref?.postId) {
      try {
        const escaped = (globalThis.CSS?.escape ? CSS.escape(ref.postId) : ref.postId.replace(/["\\]/g, '\\$&'));
        for (const img of Array.from(document.querySelectorAll(`img[src*="/generated/${escaped}/"], img[srcset*="/generated/${escaped}/"]`))) {
          push(img.currentSrc, 'post-id.currentSrc');
          push(img.src, 'post-id.src');
          push(img.getAttribute?.('src'), 'post-id[src]');
        }
      } catch (_) {}
    }

    let fallback = null;
    for (const candidate of candidates) {
      const info = grokGeneratedAssetInfo(candidate.raw);
      if (!info) continue;
      const hit = { ...candidate, info };
      if (info.generationId === ref?.postId) return hit;
      if (!fallback) fallback = hit;
    }
    return fallback;
  }

  function collectGrokImagineCardRefs(maxCards = 7500) {
    const out = [];
    const seen = new Set();
    const anchors = Array.from(document.querySelectorAll('a[href*="/imagine/post/"]'));
    for (const a of anchors) {
      if (out.length >= Math.max(1, Number(maxCards || 7500))) break;
      try {
        const u = new URL(a.getAttribute('href') || a.href || '', location.href);
        const m = u.pathname.match(/^\/imagine\/post\/([^/?#]+)/i);
        if (!m) continue;
        const root = grokCardRootForAnchor(a);
        const postId = decodeURIComponent(m[1] || '');
        const conversationId = u.searchParams.get('conversation') || root?.getAttribute?.('data-masonry-key') || '';
        const key = `${conversationId}|${postId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          href: u.href,
          postId,
          conversationId: String(conversationId || ''),
          masonryKey: String(root?.getAttribute?.('data-masonry-key') || ''),
          root,
          anchor: a
        });
      } catch (_) {}
    }
    return out;
  }

  function collectGrokImagineCardPreviewAssets(media = "both", maxCards = 7500) {
    const refs = collectGrokImagineCardRefs(maxCards);
    const assets = [];
    const seen = new Set();
    const userIds = new Set();
    const samples = [];
    let cardsWithoutGeneratedPreview = 0;
    for (const ref of refs) {
      const found = grokCardPreviewForRef(ref);
      const info = found?.info || null;
      if (!info) {
        cardsWithoutGeneratedPreview++;
        if (samples.length < 8) samples.push({ postId: ref.postId, result: 'missing', root: !!ref.root });
        continue;
      }
      userIds.add(info.userId);
      const asset = grokGeneratedAssetFromUrl(info.url, media, 'imagine-card-preview-dom');
      if (!asset) continue;
      asset.postId = ref.postId || info.generationId;
      asset.contextId = ref.conversationId || info.generationId;
      asset.conversationId = ref.conversationId || '';
      asset.generationId = info.generationId;
      asset.sourceApi = ref.href || location.href;
      asset.keyName = 'grok.imagine.card_preview_dom';
      const key = asset.sourceId || asset.url;
      if (seen.has(key)) continue;
      seen.add(key);
      assets.push(asset);
      if (samples.length < 8) samples.push({ postId: ref.postId, result: info.filename, source: found?.source || '?' });
    }
    return {
      refs,
      assets,
      cards: refs.length,
      previews: assets.length,
      cardsWithoutGeneratedPreview,
      userIds: [...userIds],
      samples
    };
  }

  function grokGridScrollTarget() {
    const grid = document.querySelector('[data-imagine-masonry-grid], [role="list"]');
    let el = grid?.parentElement || null;
    while (el && el !== document.body && el !== document.documentElement) {
      try {
        const cs = getComputedStyle(el);
        if (/(auto|scroll)/i.test(cs.overflowY || '') && el.scrollHeight > el.clientHeight + 80) {
          return { type: 'element', el };
        }
      } catch (_) {}
      el = el.parentElement;
    }
    return { type: 'window', el: null };
  }

  async function collectGrokImagineVirtualGrid(media = "both", maxCards = 7500) {
    const max = Math.max(1, Number(maxCards || 7500));
    const assetMap = new Map();
    const refMap = new Map();
    const userIds = new Set();
    const missingSamples = [];
    const foundSamples = [];
    let scans = 0;
    const capture = () => {
      const snap = collectGrokImagineCardPreviewAssets(media, max);
      scans++;
      for (const ref of snap.refs) refMap.set(`${ref.conversationId}|${ref.postId}`, ref);
      for (const asset of snap.assets) assetMap.set(asset.sourceId || asset.url, asset);
      for (const id of snap.userIds) userIds.add(id);
      for (const sample of snap.samples || []) {
        const dst = sample.result === 'missing' ? missingSamples : foundSamples;
        if (dst.length < 6 && !dst.some(x => x.postId === sample.postId)) dst.push(sample);
      }
    };

    capture();
    const target = grokGridScrollTarget();
    const isEl = target.type === 'element' && target.el;
    const getTop = () => isEl ? target.el.scrollTop : (window.scrollY || document.documentElement.scrollTop || 0);
    const getHeight = () => isEl ? target.el.clientHeight : window.innerHeight;
    const getMax = () => isEl
      ? Math.max(0, target.el.scrollHeight - target.el.clientHeight)
      : Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const setTop = (top) => {
      if (isEl) target.el.scrollTop = top;
      else window.scrollTo(0, top);
    };

    const initialTop = getTop();
    const oldRootBehavior = document.documentElement.style.scrollBehavior;
    const oldBodyBehavior = document.body?.style?.scrollBehavior || '';
    document.documentElement.style.scrollBehavior = 'auto';
    if (document.body) document.body.style.scrollBehavior = 'auto';
    let swept = false;
    try {
      let maxTop = getMax();
      if (maxTop > 80 && refMap.size < max) {
        swept = true;
        const step = Math.max(360, Math.floor(getHeight() * 0.82));
        let top = 0;
        let loops = 0;
        let stagnant = 0;
        let prevCount = refMap.size;
        while (!contentSyncCancel && loops < 90 && refMap.size < max) {
          setTop(Math.min(top, maxTop));
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          await sleep(90);
          capture();
          if (refMap.size === prevCount) stagnant++; else stagnant = 0;
          prevCount = refMap.size;
          maxTop = getMax();
          if (top >= maxTop) break;
          top = Math.min(maxTop, top + step);
          loops++;
          // Keep this sweep light. Unlike the removed preload routine it never
          // dispatches hover/mouse events and therefore does not force videos to play.
          if (stagnant > 12 && top > maxTop * 0.85) break;
        }
      }
    } finally {
      setTop(initialTop);
      document.documentElement.style.scrollBehavior = oldRootBehavior;
      if (document.body) document.body.style.scrollBehavior = oldBodyBehavior;
    }

    return {
      refs: [...refMap.values()],
      assets: [...assetMap.values()],
      cards: refMap.size,
      previews: assetMap.size,
      cardsWithoutGeneratedPreview: Math.max(0, refMap.size - assetMap.size),
      userIds: [...userIds],
      samples: [...foundSamples, ...missingSamples],
      scans,
      swept,
      scrollTarget: target.type
    };
  }

  function preferFullGrokGeneratedAssets(assets = []) {
    const groups = new Map();
    for (const asset of assets) {
      const info = grokGeneratedAssetInfo(asset?.url || '');
      const key = info?.generationId || asset?.postId || asset?.sourceId || asset?.url || '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(asset);
    }
    const out = [];
    for (const group of groups.values()) {
      const hasFull = group.some(a => !/\/preview_image\./i.test(a?.url || ''));
      for (const a of group) {
        if (hasFull && /\/preview_image\./i.test(a?.url || '')) continue;
        out.push(a);
      }
    }
    return out;
  }

  function extractGrokImagenAssetsFromConversation(json, ref, apiUrl, media = "both") {
    const out = [];
    const seen = new Set();

    // The new masonry/history cards expose a conversation id. The same authenticated
    // conversation response used by Boards contains the complete generated group.
    for (const raw of extractGrokBoardAssetsFromResponses(json, { id: ref?.conversationId || '', name: '' }, apiUrl, media)) {
      const info = grokGeneratedAssetInfo(raw.url || '');
      const asset = {
        ...raw,
        grokMode: 'imagen',
        postId: info?.generationId || ref?.postId || raw.postId || raw.sourceId || '',
        generationId: info?.generationId || raw.generationId || '',
        conversationId: ref?.conversationId || raw.conversationId || '',
        contextId: ref?.conversationId || raw.contextId || '',
        sourceApi: apiUrl,
        folderPrefix: 'Grok/Imagen',
        boardId: '',
        boardName: '',
        keyName: 'grok.imagen.card_conversation'
      };
      const key = `${asset.sourceId || ''}|${asset.url || ''}`;
      if (!asset.url || seen.has(key)) continue;
      seen.add(key);
      out.push(asset);
    }

    // Also parse any direct generated asset URL kept elsewhere in the response.
    let text = '';
    try { text = JSON.stringify(json); } catch (_) {}
    for (const url of extractGrokGeneratedUrlsFromText(text)) {
      const asset = grokGeneratedAssetFromUrl(url, media, 'imagen-card-conversation-json');
      if (!asset) continue;
      asset.conversationId = ref?.conversationId || '';
      asset.contextId = ref?.conversationId || asset.contextId || '';
      asset.sourceApi = apiUrl;
      asset.postId = asset.generationId || ref?.postId || asset.postId || '';
      const key = `${asset.sourceId || ''}|${asset.url || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(asset);
    }

    // Some responses still contain the older posts array shape.
    for (const raw of extractGrokPostAssets(json, apiUrl, media)) {
      const asset = {
        ...raw,
        grokMode: 'imagen',
        conversationId: ref?.conversationId || raw.conversationId || '',
        contextId: ref?.conversationId || raw.contextId || '',
        sourceApi: apiUrl,
        folderPrefix: 'Grok/Imagen',
        keyName: 'grok.imagen.card_conversation_post'
      };
      const key = `${asset.sourceId || ''}|${asset.url || ''}`;
      if (!asset.url || seen.has(key)) continue;
      seen.add(key);
      out.push(asset);
    }

    return preferFullGrokGeneratedAssets(out);
  }

  async function runGrokImagineCardConversationSync(maxImages = 7500, media = "both") {
    // v2.32.71: diagnostic only. The conversation query parameter exposed by the
    // new masonry cards is not accepted by /rest/app-chat/conversations/<id>/responses
    // (previous builds produced 100% errors), so do not spend network time replaying it.
    const refs = collectGrokImagineCardRefs(Math.min(Math.max(1, Number(maxImages || 7500)), 2000));
    const conversations = new Set(refs.map(ref => ref.conversationId).filter(Boolean));
    return {
      ok: true,
      mode: 'grok-imagine-card-reference-diagnostic',
      pages: 0,
      assets: 0,
      added: 0,
      updated: 0,
      cards: refs.length,
      conversations: conversations.size,
      errors: 0,
      skipped: true,
      diagnostics: [{
        summary: `Card references ${refs.length}; conversation ids ${conversations.size}; conversation replay skipped (known incompatible endpoint)`,
        path: '/imagine/post/<postId>?conversation=<conversationId>'
      }]
    };
  }

  async function collectGrokGeneratedSiblingAssetsFromPreviews(media = "both", maxAssets = 120, seenKeys = new Set()) {
    const previewUrls = [];
    const seenPreview = new Set();
    for (const asset of collectGrokGeneratedAssetsFromPage("both")) {
      const info = grokGeneratedAssetInfo(asset?.url || "");
      if (!info || !/^preview_image\.(?:jpe?g|png|webp)$/i.test(info.filename || "")) continue;
      const folderKey = `${info.userId}/${info.generationId}`;
      if (seenPreview.has(folderKey)) continue;
      seenPreview.add(folderKey);
      previewUrls.push(asset.url);
    }
    const out = [];
    for (const preview of previewUrls) {
      if (contentSyncCancel || out.length >= maxAssets) break;
      for (const candidate of grokPreviewSiblingCandidateUrls(preview, media)) {
        if (contentSyncCancel || out.length >= maxAssets) break;
        const asset = grokGeneratedAssetFromUrl(candidate, media, "generated-assets-preview-sibling-probe");
        if (!asset) continue;
        const key = asset.sourceId || asset.url;
        if (seenKeys.has(key)) continue;

        // The preview itself is already loaded and safe to keep. For inferred
        // siblings, do a cheap HEAD probe so we don't fill the catalogue with
        // non-existing generated_image/video guesses.
        const isSamePreview = /\/preview_image\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(asset.url);
        const ct = isSamePreview ? asset.mimeType : await probeGrokAssetExists(asset.url);
        if (!ct) continue;
        asset.mimeType = ct || asset.mimeType;
        asset.extHint = ct || asset.extHint;
        asset.prompt = isSamePreview ? "Grok generated image preview" : asset.prompt;
        asset.keyName = isSamePreview ? "grok.generated_asset_image_fallback" : asset.keyName;
        seenKeys.add(key);
        out.push(asset);
      }
      if (previewUrls.length > 8) await sleep(40);
    }
    return out;
  }

  function visibleGrokHoverTargets(limit = 120) { return []; }

  function grokScrollableContainers() { return []; }

  async function hoverElementForMedia(el) { return; }

  async function triggerGrokGeneratedPreloadRound(round = 0) {
    // v2.32.62: deliberately passive. The previous deep scan simulated hover and
    // scrolled nested containers, which forced Grok to preload hundreds of
    // preview_image/generated_video resources. Do not synthesize user movement here.
    return 0;
  }

  async function runGrokGeneratedAssetsFallback(maxImages = 7500, media = "both") {
    const max = Math.max(1, Number(maxImages || 7500));
    const seen = new Set();
    let pages = 0, totalAssets = 0, totalAdded = 0, totalUpdated = 0;
    const api = `${location.origin}/generated-assets-passive-dom-performance-fallback`;
    // v2.32.76: back to the old passive fallback. Never synthesize hover and never
    // scroll the Grok page. Only ingest assets that the page has already rendered
    // or loaded naturally, then probe same-folder siblings from visible previews.
    for (let round = 0; round < 3 && totalAssets < max; round++) {
      if (contentSyncCancel) break;
      if (round > 0) await sleep(250);
      let assets = collectGrokGeneratedAssetsFromPage(media).filter(a => {
        const k = a.sourceId || a.url;
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      }).slice(0, Math.max(0, max - totalAssets));
      if (round === 0 && totalAssets + assets.length < max) {
        const siblingAssets = await collectGrokGeneratedSiblingAssetsFromPreviews(media, Math.max(0, max - totalAssets - assets.length), seen);
        if (siblingAssets.length) assets = assets.concat(siblingAssets);
      }
      pages += 1;
      if (assets.length) {
        const merge = await mergePage(assets, api, pages, "");
        totalAssets += assets.length;
        totalAdded += Number(merge.added || 0);
        totalUpdated += Number(merge.updated || 0);
      }
    }
    return { ok: true, mode: "grok-passive-asset-fallback", pages, assets: totalAssets, added: totalAdded, updated: totalUpdated };
  }


  function isPrivateGeneratedGrokAsset(asset) {
    const url = String(asset?.url || asset?.mediaUrl || "");
    return /https?:\/\/assets\.grok\.com\/users\/[^/]+\/generated\/[^/]+\//i.test(url);
  }

  function grokImagineConversationIds(json) {
    const ids = new Set();
    const visited = new WeakSet();
    const walk = (value, depth = 0, parentKey = "") => {
      if (!value || typeof value !== "object" || depth > 12) return;
      if (visited.has(value)) return;
      visited.add(value);
      if (Array.isArray(value)) {
        for (const item of value) walk(item, depth + 1, parentKey);
        return;
      }
      const explicit = value.conversationId || value.conversation_id || "";
      if (typeof explicit === "string" && explicit.length >= 16) ids.add(explicit);
      // The /rest/app-chat/conversations list commonly uses `id` for the
      // conversation itself. Only accept generic ids from conversation-shaped
      // objects so media/post ids are not replayed as app-chat conversations.
      const generic = typeof value.id === "string" ? value.id : "";
      const looksConversation = /conversation/i.test(parentKey) ||
        value.conversationKind || value.conversation_kind || value.title ||
        value.starred !== undefined || value.isStarred !== undefined ||
        value.lastResponseId || value.last_response_id;
      if (generic.length >= 16 && looksConversation) ids.add(generic);
      for (const [k, child] of Object.entries(value)) {
        if (child && typeof child === "object") walk(child, depth + 1, k);
      }
    };
    walk(json, 0, "root");
    return [...ids];
  }

  function extractGrokPrivateGeneratedAssetsSimple(json, apiUrl, mediaFilter = "both") {
    const out = [];
    const seen = new Set();
    const visited = new WeakSet();
    const allowImage = mediaFilter === "both" || mediaFilter === "images";
    const allowVideo = mediaFilter === "both" || mediaFilter === "videos";
    const urlFields = [
      "hd1080MediaUrl", "hdMediaUrl", "mediaUrl", "assetUrl", "downloadUrl",
      "videoUrl", "imageUrl", "fileUrl", "originalUrl", "sourceUrl",
      "thumbnailImageUrl", "thumbnailUrl", "previewImageUrl", "previewUrl",
      "media_url", "asset_url", "download_url", "video_url", "image_url"
    ];

    const pushUrl = (raw, obj = null, parent = null) => {
      const info = grokGeneratedAssetInfo(raw);
      if (!info) return;
      if ((info.kind === "image" && !allowImage) || (info.kind === "video" && !allowVideo)) return;
      const key = `${info.kind}|${info.generationId}|${info.url}`;
      if (seen.has(key)) return;
      seen.add(key);
      const prompt = String(
        obj?.prompt || obj?.originalPrompt || obj?.title ||
        parent?.prompt || parent?.originalPrompt ||
        (info.kind === "video" ? "Grok generated video" : "Grok generated image")
      );
      const createdAt = coerceDate(
        obj?.createTime || obj?.createdAt || obj?.creationTime || obj?.updatedAt ||
        parent?.createTime || parent?.createdAt
      ) || nowIso();
      out.push({
        source: "grok", grokMode: "imagen", kind: info.kind,
        sourceId: `${info.generationId}:${info.filename}`,
        postId: String(obj?.id || obj?.postId || obj?.generationId || info.generationId),
        generationId: info.generationId,
        url: info.url,
        previewUrl: info.kind === "image" ? info.url : "",
        mimeType: info.kind === "video" ? (info.filename.toLowerCase().endsWith(".webm") ? "video/webm" : "video/mp4") : (info.filename.toLowerCase().endsWith(".png") ? "image/png" : info.filename.toLowerCase().endsWith(".webp") ? "image/webp" : "image/jpeg"),
        extHint: info.filename,
        prompt, createdAt, sourceApi: apiUrl || "",
        contextId: String(obj?.conversationId || obj?.conversation_id || parent?.conversationId || ""),
        keyName: "grok.imagine.history.private", capturedAt: nowIso(),
        width: Number(obj?.resolution?.width || obj?.width || 0),
        height: Number(obj?.resolution?.height || obj?.height || 0),
        duration: Number(obj?.videoDuration || obj?.duration || 0),
        resolutionName: String(obj?.resolutionName || ""),
        folderPrefix: "Grok/Imagen",
        grokUserId: info.userId
      });
    };

    const walk = (value, parent = null, depth = 0) => {
      if (!value || typeof value !== "object" || depth > 18 || visited.has(value)) return;
      visited.add(value);
      if (Array.isArray(value)) {
        for (const item of value) walk(item, parent, depth + 1);
        return;
      }
      for (const field of urlFields) {
        if (typeof value[field] === "string") pushUrl(value[field], value, parent);
      }
      for (const child of Object.values(value)) if (child && typeof child === "object") walk(child, value, depth + 1);
    };
    walk(json, null, 0);

    // Some response fields contain serialized/escaped URLs instead of a mediaUrl key.
    // Keep this fallback self-contained so Imagine History does not depend on the
    // older flat-assets parser.
    let text = "";
    try { text = JSON.stringify(json); } catch (_) {}
    if (text) {
      const normalized = text
        .replace(/\\u002[Ff]/g, "/")
        .replace(/\\u0026/g, "&")
        .replace(/\\\//g, "/");
      const re = new RegExp("https?:\\/\\/assets\\.grok\\.com\\/users\\/[^\"\'\\s<>()]+\\/generated\\/[^\"\'\\s<>()]+\\/[^\"\'\\s<>()]+?\\.(?:mp4|webm|webp|png|jpe?g)(?:\\?[^\"\'\\s<>()]*)?", "gi");
      let match;
      while ((match = re.exec(normalized))) pushUrl(match[0], null, null);
    }
    return preferFullGrokGeneratedAssets(out);
  }

  function grokImagineConversationIdsSimple(json) {
    const ids = new Set();
    const visited = new WeakSet();
    const walk = (value, parentKey = "", depth = 0) => {
      if (!value || typeof value !== "object" || depth > 14 || visited.has(value)) return;
      visited.add(value);
      if (Array.isArray(value)) {
        for (const item of value) walk(item, parentKey, depth + 1);
        return;
      }
      const explicit = value.conversationId || value.conversation_id;
      if (typeof explicit === "string" && explicit.length >= 16) ids.add(explicit);
      const generic = typeof value.id === "string" ? value.id : "";
      const shaped = /conversation/i.test(parentKey) ||
        value.conversationKind !== undefined || value.conversation_kind !== undefined ||
        value.starred !== undefined || value.isStarred !== undefined ||
        value.lastResponseId !== undefined || value.last_response_id !== undefined;
      if (generic.length >= 16 && shaped) ids.add(generic);
      for (const [key, child] of Object.entries(value)) if (child && typeof child === "object") walk(child, key, depth + 1);
    };
    walk(json, "root", 0);
    return [...ids];
  }

  function grokAssetUrlFromKey(raw) {
    const value = String(raw || "").trim();
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value;
    if (/^users\//i.test(value)) return `https://assets.grok.com/${value.replace(/^\/+/, "")}`;
    return "";
  }

  function grokMediaGenDetails(mediaGenInput) {
    if (!mediaGenInput || typeof mediaGenInput !== "object") return {};
    const queue = [mediaGenInput];
    const seen = new WeakSet();
    while (queue.length) {
      const value = queue.shift();
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);
      if (!Array.isArray(value)) {
        if (typeof value.prompt === "string" || typeof value.modelName === "string" || value.duration !== undefined || value.resolutionName !== undefined) {
          return {
            prompt: typeof value.prompt === "string" ? value.prompt : "",
            modelName: typeof value.modelName === "string" ? value.modelName : "",
            duration: Number(value.duration || 0),
            resolutionName: String(value.resolutionName || "")
          };
        }
        for (const child of Object.values(value)) if (child && typeof child === "object") queue.push(child);
      }
    }
    return {};
  }

  function extractGrokRootModelGeneratedAssets(json, apiUrl, mediaFilter = "both") {
    const out = [];
    const seenAssetIds = new Set();
    const allowImage = mediaFilter === "both" || mediaFilter === "images";
    const allowVideo = mediaFilter === "both" || mediaFilter === "videos";
    const stats = {
      responseObjects: 0,
      assistantImagineResponses: 0,
      richMetadata: 0,
      simpleMetadata: 0,
      acceptedRich: 0,
      acceptedSimple: 0,
      skippedReferences: 0,
      skippedNonMedia: 0,
      jsonStringsExpanded: 0,
      relativeGeneratedKeys: 0
    };
    const sampleKeys = new Set();
    const visited = new WeakSet();

    const boolish = (v) => v === true || v === "true" || v === 1 || v === "1";
    const responseLooksImagineOutput = (response) => {
      if (!response || typeof response !== "object") return false;
      const sender = String(response.sender || "").toUpperCase();
      const mode = String(response?.metadata?.request_metadata?.mode || response?.requestMetadata?.mode || "").toLowerCase();
      const model = String(response.model || response?.metadata?.request_metadata?.model || response?.requestMetadata?.model || "").toLowerCase();
      const queryType = String(response.queryType || "").toLowerCase();
      const hasMediaGen = !!(response.mediaGenInput && typeof response.mediaGenInput === "object" && Object.keys(response.mediaGenInput).length);
      const imagine = queryType === "imagine" || mode === "imagine" || model.includes("imagine") || hasMediaGen;
      return sender === "ASSISTANT" && imagine;
    };

    const makeAsset = (meta, response, rich) => {
      const rawId = rich ? (meta.assetId || meta.fileMetadataId) : (meta.fileMetadataId || meta.assetId);
      const assetId = String(rawId || "").trim();
      const rawKey = rich ? (meta.key || meta.fileUri || "") : (meta.fileUri || meta.key || "");
      const url = grokAssetUrlFromKey(rawKey);
      if (!assetId || !url || !/\/users\/[^/]+\/generated\/[^/]+\//i.test(url)) return null;
      stats.relativeGeneratedKeys++;
      const mime = String((rich ? meta.mimeType : meta.fileMimeType) || meta.mimeType || "").toLowerCase();
      const name = String((rich ? meta.name : meta.fileName) || meta.name || "").toLowerCase();
      const kind = mime.startsWith("video/") || /\.(?:mp4|webm|mov)$/i.test(name) ? "video"
        : mime.startsWith("image/") || /\.(?:jpe?g|png|webp|gif|avif)$/i.test(name) ? "image" : "";
      if (!kind || (kind === "image" && !allowImage) || (kind === "video" && !allowVideo)) {
        stats.skippedNonMedia++;
        return null;
      }
      const ownGen = grokMediaGenDetails(meta.mediaGenInput);
      const responseGen = grokMediaGenDetails(response?.mediaGenInput);
      let prompt = String(ownGen.prompt || responseGen.prompt || response?.query || "").trim();
      if (!prompt && typeof response?.message === "string") {
        const m = response.message.match(/prompt:\s*['\"]([\s\S]*?)['\"]\.?$/i);
        if (m) prompt = m[1].trim();
      }
      const modelName = String(ownGen.modelName || responseGen.modelName || response?.model || response?.metadata?.request_metadata?.model || "");
      const previewKey = rich ? String(meta.previewImageKey || meta?.auxKeys?.["preview-image"] || "") : "";
      let previewUrl = kind === "image" ? url : grokAssetUrlFromKey(previewKey);
      if (!previewUrl && kind === "video") {
        try {
          const u = new URL(url);
          u.pathname = u.pathname.replace(/\/[^/]+$/, "/preview_image.jpg");
          previewUrl = u.href;
        } catch (_) {}
      }
      const createdAt = coerceDate(meta.createTime || response?.createTime || meta.updateTime) || "";
      const conversationId = String(meta.sourceConversationId || meta.currentConversationId || meta.rootAssetSourceConversationId || response?.conversationId || "");
      const genId = (url.match(/\/generated\/([^/?#]+)\//i) || [])[1] || assetId;
      return {
        source: "grok", grokMode: "imagen", kind,
        sourceId: assetId, postId: assetId, generationId: genId,
        url, previewUrl: previewUrl || (kind === "image" ? url : ""),
        mimeType: (rich ? meta.mimeType : meta.fileMimeType) || meta.mimeType || (kind === "video" ? "video/mp4" : "image/jpeg"),
        extHint: (rich ? meta.name : meta.fileName) || meta.name || rawKey || "",
        prompt: prompt || (kind === "video" ? "Grok generated video" : "Grok generated image"),
        createdAt,
        sourceApi: apiUrl || "",
        contextId: conversationId,
        conversationId,
        responseId: String(meta.responseId || response?.responseId || ""),
        keyName: rich ? "grok.imagine.fileAttachmentAssetMetadata" : "grok.imagine.assistant.fileAttachmentsMetadata",
        capturedAt: nowIso(),
        width: Number(meta.width || 0),
        height: Number(meta.height || 0),
        duration: Number(ownGen.duration || responseGen.duration || 0),
        resolutionName: String(ownGen.resolutionName || responseGen.resolutionName || ""),
        modelName,
        folderPrefix: "Grok/Imagen",
        grokUserId: String(meta.ownerUserId || "")
      };
    };

    const ingestResponse = (response) => {
      if (!response || typeof response !== "object") return;
      stats.responseObjects++;
      const isOutput = responseLooksImagineOutput(response);
      if (isOutput) stats.assistantImagineResponses++;

      const richList = Array.isArray(response.fileAttachmentAssetMetadata) ? response.fileAttachmentAssetMetadata : [];
      for (const meta of richList) {
        if (!meta || typeof meta !== "object") continue;
        stats.richMetadata++;
        const generatedSignals = [
          String(meta.fileSource || "") === "IMAGINE_GENERATED_FILE_SOURCE",
          boolish(meta.isModelGenerated),
          boolish(meta.isRootAssetCreatedByModel)
        ].filter(Boolean).length;
        // Rich metadata is authoritative when at least the two model/root flags agree,
        // or when Grok explicitly labels the file as Imagine-generated and it belongs
        // to an assistant Imagine response. This tolerates older history records that
        // omit one of the newer fields without admitting ordinary uploaded inputs.
        const generated = meta.isDeleted !== true && meta.isDeleted !== "true" &&
          ((boolish(meta.isModelGenerated) && boolish(meta.isRootAssetCreatedByModel)) ||
           (String(meta.fileSource || "") === "IMAGINE_GENERATED_FILE_SOURCE" && isOutput && generatedSignals >= 1));
        if (!generated) { stats.skippedReferences++; continue; }
        const asset = makeAsset(meta, response, true);
        if (!asset) continue;
        const key = asset.sourceId || asset.url;
        if (!seenAssetIds.has(key)) {
          seenAssetIds.add(key);
          out.push(asset);
          stats.acceptedRich++;
        }
      }

      // Older/sparser /responses payloads may omit fileAttachmentAssetMetadata.
      // In that case, fileAttachmentsMetadata is safe ONLY for an ASSISTANT Imagine
      // response. User uploads live on user/input responses and are not ingested.
      const simpleList = Array.isArray(response.fileAttachmentsMetadata) ? response.fileAttachmentsMetadata : [];
      for (const meta of simpleList) {
        if (!meta || typeof meta !== "object") continue;
        stats.simpleMetadata++;
        if (!isOutput) { stats.skippedReferences++; continue; }
        const asset = makeAsset(meta, response, false);
        if (!asset) continue;
        const key = asset.sourceId || asset.url;
        if (!seenAssetIds.has(key)) {
          seenAssetIds.add(key);
          out.push(asset);
          stats.acceptedSimple++;
        }
      }
    };

    const walk = (value, depth = 0) => {
      if (value == null || depth > 24) return;
      if (typeof value === "string") {
        const t = value.trim();
        if (t.length > 1 && t.length < 4000000 && ((t[0] === "{" && t.endsWith("}")) || (t[0] === "[" && t.endsWith("]")))) {
          try {
            const parsed = JSON.parse(t);
            stats.jsonStringsExpanded++;
            walk(parsed, depth + 1);
          } catch (_) {}
        }
        return;
      }
      if (typeof value !== "object" || visited.has(value)) return;
      visited.add(value);
      if (Array.isArray(value)) {
        for (const item of value) walk(item, depth + 1);
        return;
      }
      for (const k of Object.keys(value).slice(0, 30)) sampleKeys.add(k);
      if (Array.isArray(value.fileAttachmentAssetMetadata) || Array.isArray(value.fileAttachmentsMetadata) || value.responseId || value.sender) ingestResponse(value);
      // Do not prune originalPost/images/videos here. We only ingest attachments from
      // response-like containers, and the positive assistant/model-generated tests above
      // are what exclude references. Pruning was hiding valid nested response wrappers.
      for (const child of Object.values(value)) if (child && (typeof child === "object" || typeof child === "string")) walk(child, depth + 1);
    };
    walk(json, 0);
    return { assets: out, stats, sampleKeys: [...sampleKeys].slice(0, 24) };
  }

  function extractGrokConversationLatestAssets(json, apiUrl, mediaFilter = "both") {
    const out = [];
    const seen = new Set();
    const allowImage = mediaFilter === "both" || mediaFilter === "images";
    const allowVideo = mediaFilter === "both" || mediaFilter === "videos";
    const conversations = Array.isArray(json?.conversations) ? json.conversations : [];
    for (const conv of conversations) {
      const meta = conv?.latestAssetMetadata;
      if (!meta || typeof meta !== "object") continue;
      const generated = meta.isDeleted !== true && meta.isDeleted !== "true"
        && String(meta.fileSource || "") === "IMAGINE_GENERATED_FILE_SOURCE"
        && (meta.isModelGenerated === true || meta.isModelGenerated === "true")
        && (meta.isRootAssetCreatedByModel === true || meta.isRootAssetCreatedByModel === "true");
      if (!generated) continue;
      const assetId = String(meta.assetId || "").trim();
      const url = grokAssetUrlFromKey(meta.key || "");
      if (!assetId || !url || seen.has(assetId)) continue;
      const mime = String(meta.mimeType || "").toLowerCase();
      const name = String(meta.name || "").toLowerCase();
      const kind = mime.startsWith("video/") || /\.(?:mp4|webm|mov)$/i.test(name) ? "video"
        : mime.startsWith("image/") || /\.(?:jpe?g|png|webp|gif|avif)$/i.test(name) ? "image" : "";
      if (!kind || (kind === "image" && !allowImage) || (kind === "video" && !allowVideo)) continue;
      const ownGen = grokMediaGenDetails(meta.mediaGenInput);
      const previewKey = String(meta.previewImageKey || meta?.auxKeys?.["preview-image"] || "");
      let previewUrl = kind === "image" ? url : grokAssetUrlFromKey(previewKey);
      if (!previewUrl && kind === "video") {
        try { const u = new URL(url); u.pathname = u.pathname.replace(/\/[^/]+$/, "/preview_image.jpg"); previewUrl = u.href; } catch (_) {}
      }
      const genId = (url.match(/\/generated\/([^/?#]+)\//i) || [])[1] || assetId;
      seen.add(assetId);
      out.push({
        source: "grok", grokMode: "imagen", kind,
        sourceId: assetId, postId: assetId, generationId: genId,
        url, previewUrl: previewUrl || (kind === "image" ? url : ""),
        mimeType: meta.mimeType || (kind === "video" ? "video/mp4" : "image/jpeg"),
        extHint: meta.name || meta.key || "",
        prompt: String(ownGen.prompt || "").trim() || (kind === "video" ? "Grok generated video" : "Grok generated image"),
        createdAt: coerceDate(meta.createTime || conv?.modifyTime || conv?.createTime) || "",
        sourceApi: apiUrl || "",
        contextId: String(conv?.conversationId || meta.sourceConversationId || ""),
        conversationId: String(conv?.conversationId || meta.sourceConversationId || ""),
        responseId: String(meta.responseId || ""),
        keyName: "grok.imagine.latestAssetMetadata",
        capturedAt: nowIso(),
        width: Number(meta.width || 0), height: Number(meta.height || 0),
        duration: Number(ownGen.duration || 0), resolutionName: String(ownGen.resolutionName || ""),
        modelName: String(ownGen.modelName || ""), folderPrefix: "Grok/Imagen",
        grokUserId: String(meta.ownerUserId || "")
      });
    }
    return out;
  }

  async function mapWithConcurrency(items, concurrency, fn) {
    const results = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(Math.max(1, concurrency), Math.max(1, items.length)) }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) break;
        results[i] = await fn(items[i], i);
      }
    });
    await Promise.all(workers);
    return results;
  }

  async function runGrokImagineConversationDirectSync(maxImages = 9500, media = "both") {
    const startedAt = performance.now();
    const max = Math.max(1, Number(maxImages || 9500));
    const base = new URL(`${location.origin}/rest/app-chat/conversations`);
    // Exact request observed in the user's Grok HAR.  The list endpoint uses
    // `kind`, NOT `conversationKind`.
    base.searchParams.set("pageSize", "40");
    base.searchParams.set("kind", "CONVERSATION_KIND_IMAGINE");

    let token = "";
    let listPages = 0;
    let firstStatus = 0;
    const seenTokens = new Set();
    const conversationIds = [];
    const seenConversations = new Set();
    const diagnostics = [];
    const latestAssets = [];
    const latestSeen = new Set();

    // Conversation-list pagination is the only sequential network dependency.
    for (let page = 0; page < 40 && !contentSyncCancel; page++) {
      const url = new URL(base.href);
      if (token) url.searchParams.set("pageToken", token);
      const detail = await getJsonDetailed(url.href, 6000);
      if (!firstStatus) firstStatus = Number(detail.status || 0);
      if (!detail.ok || !detail.json) {
        diagnostics.push({ summary: `PRIVATE IMAGINE: conversation list HTTP ${detail.status || 0}${detail.error ? ` ${detail.error}` : ""}` });
        break;
      }
      listPages++;
      for (const id of grokImagineConversationIdsSimple(detail.json)) {
        if (!seenConversations.has(id)) {
          seenConversations.add(id);
          conversationIds.push(id);
        }
      }
      // The list response itself contains latestAssetMetadata. Keep it as a
      // zero-extra-request safety net; response history below will add older assets.
      for (const asset of extractGrokConversationLatestAssets(detail.json, url.href, media)) {
        const key = asset.sourceId || asset.url;
        if (key && !latestSeen.has(key)) { latestSeen.add(key); latestAssets.push(asset); }
      }
      const next = nextGrokAssetPageToken(detail.json) || nextGrokCursor(detail.json);
      if (!next || seenTokens.has(next)) break;
      seenTokens.add(next);
      token = next;
    }

    // Fetch every Imagine conversation response concurrently. No polling, sleeps,
    // page hooks, source-feed probes, or page-navigation capture is involved.
    const responseConcurrency = 24;
    const responseResults = await mapWithConcurrency(conversationIds, responseConcurrency, async id => {
      const api = `${location.origin}/rest/app-chat/conversations/${encodeURIComponent(id)}/responses?conversationKind=CONVERSATION_KIND_IMAGINE`;
      const detail = await getJsonDetailed(api, 5000);
      return { id, api, detail };
    });

    let responseOk = 0, responseFailed = 0;
    const parseStats = { responseObjects:0, assistantImagineResponses:0, richMetadata:0, simpleMetadata:0, acceptedRich:0, acceptedSimple:0, skippedReferences:0, skippedNonMedia:0, jsonStringsExpanded:0, relativeGeneratedKeys:0 };
    const parseKeys = new Set();
    const assets = [];
    const seenAssets = new Set();
    for (const asset of latestAssets) {
      const key = asset.sourceId || asset.url;
      if (key && !seenAssets.has(key) && assets.length < max) { seenAssets.add(key); assets.push(asset); }
    }
    const statusCounts = new Map();
    for (const result of responseResults) {
      const status = Number(result.detail?.status || 0);
      statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
      if (!result.detail?.ok || !result.detail?.json) { responseFailed++; continue; }
      responseOk++;
      const parsed = extractGrokRootModelGeneratedAssets(result.detail.json, result.api, media);
      for (const [k,v] of Object.entries(parsed.stats || {})) parseStats[k] = Number(parseStats[k] || 0) + Number(v || 0);
      for (const k of parsed.sampleKeys || []) parseKeys.add(k);
      for (const asset of parsed.assets) {
        const key = asset.sourceId || asset.url;
        if (!key || seenAssets.has(key) || assets.length >= max) continue;
        seenAssets.add(key);
        assets.push(asset);
      }
    }

    let merge = { added: 0, updated: 0 };
    if (assets.length) merge = await mergePage(assets, `${location.origin}/rest/app-chat/conversations/*/responses`, listPages + responseResults.length, "");

    const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1);
    const statusSummary = [...statusCounts.entries()].sort((a,b)=>a[0]-b[0]).map(([s,c]) => `${s}:${c}`).join(",") || "-";
    diagnostics.push({
      summary: `PRIVATE IMAGINE RESPONSES HAR: ${elapsed}s; list ${listPages}p HTTP ${firstStatus || 0}; conversations ${conversationIds.length}; latest assets ${latestAssets.length}; responses ${responseOk} ok/${responseFailed} failed [${statusSummary}]; concurrency 24; response objects ${parseStats.responseObjects}; assistant Imagine ${parseStats.assistantImagineResponses}; rich meta ${parseStats.richMetadata}->${parseStats.acceptedRich}; simple meta ${parseStats.simpleMetadata}->${parseStats.acceptedSimple}; refs skipped ${parseStats.skippedReferences}; generated keys ${parseStats.relativeGeneratedKeys}; JSON strings ${parseStats.jsonStringsExpanded}; assets ${assets.length}; keys ${[...parseKeys].slice(0,12).join(",") || "-"}; one catalog merge`
    });
    return {
      ok: firstStatus === 200 && responseOk > 0,
      mode: "grok-private-imagine-responses-har",
      pages: listPages + responseResults.length,
      assets: assets.length,
      added: Number(merge.added || 0),
      updated: Number(merge.updated || 0),
      diagnostics,
      conversations: conversationIds.length,
      responseOk,
      responseFailed
    };
  }

  async function runGrokImagenSync(maxImages, media = "both") {
    contentSyncCancel = false;
    return runGrokImagineConversationDirectSync(maxImages, media);
  }

  async function runGrokBoardsSync(maxImages, media = "both") {
    const max = Math.max(1, Number(maxImages || 7500));
    let pages = 0, totalAssets = 0, totalAdded = 0, totalUpdated = 0;
    const boardListApi = `${location.origin}/rest/media/canvas/list`;
    const boardsJson = await postJson(boardListApi, {});
    const boards = Array.isArray(boardsJson?.documents) ? boardsJson.documents : [];
    for (const board of boards) {
      if (contentSyncCancel || totalAssets >= max) break;
      const convApi = `${location.origin}/rest/media/conversation/get`;
      const convJson = await postJson(convApi, { canvasId: board.id });
      const conversations = Array.isArray(convJson?.conversations) ? convJson.conversations : [];
      for (const c of conversations) {
        if (contentSyncCancel || totalAssets >= max) break;
        const id = c.conversationId;
        if (!id) continue;
        const api = `${location.origin}/rest/app-chat/conversations/${encodeURIComponent(id)}/responses?conversationKind=CONVERSATION_KIND_IMAGINE`;
        const respJson = await getJson(api);
        const assets = extractGrokBoardAssetsFromResponses(respJson, board, api, media).slice(0, Math.max(0, max - totalAssets));
        const merge = await mergePage(assets, api, ++pages, "");
        totalAssets += assets.length; totalAdded += Number(merge.added || 0); totalUpdated += Number(merge.updated || 0);
      }
    }
    const fallback = await runGrokGeneratedAssetsFallback(Math.max(1, max - totalAssets), media).catch(e => ({ ok: false, pages: 0, assets: 0, added: 0, updated: 0, error: e.message || String(e) }));
    pages += Number(fallback.pages || 0);
    totalAssets += Number(fallback.assets || 0);
    totalAdded += Number(fallback.added || 0);
    totalUpdated += Number(fallback.updated || 0);
    return { ok: true, mode: "grok-boards+generated-assets-fallback", pages, assets: totalAssets, added: totalAdded, updated: totalUpdated, maxImages: max, fallback };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return;
    if (message.type === "PING_CONTENT_V20") {
      injectHook();
      sendResponse({ ok: true, version: CONTENT_VERSION, href: location.href });
      return true;
    }

    if (message.type === "START_GENERATION_WATCH_V20") {
      injectHook();
      window.postMessage({ source: EXT_SOURCE, type: "START_GENERATION_WATCH" }, "*");
      sendResponse({ ok: true, version: CONTENT_VERSION, href: location.href });
      return true;
    }
    if (message.type === "STOP_GENERATION_WATCH_V20") {
      window.postMessage({ source: EXT_SOURCE, type: "STOP_GENERATION_WATCH" }, "*");
      sendResponse({ ok: true, version: CONTENT_VERSION, href: location.href });
      return true;
    }
    if (message.type === "START_LIVE_CAPTURE_V20") {
      injectHook();
      window.postMessage({ source: EXT_SOURCE, type: "START_LIVE_CAPTURE" }, "*");
      sendResponse({ ok: true, version: CONTENT_VERSION, href: location.href });
      return true;
    }
    if (message.type === "STOP_LIVE_CAPTURE_V20") {
      window.postMessage({ source: EXT_SOURCE, type: "STOP_LIVE_CAPTURE" }, "*");
      sendResponse({ ok: true, version: CONTENT_VERSION, href: location.href });
      return true;
    }
    if (message.type === "START_GROK_SYNC_JOB_V20") {
      const kind = message.kind === "boards" ? "boards" : "imagen";
      sendResponse(startGrokSyncJob(kind, message.maxImages || 7500, message.media || "both"));
      return;
    }
    if (message.type === "GET_GROK_SYNC_JOB_V20") {
      sendResponse(grokSyncJobStatus(message.jobId, !!message.consume));
      return;
    }
    if (message.type === "RUN_GROK_IMAGEN_SYNC_V20") {
      // Compatibility path for older callers. New background code uses the job API
      // above so the message channel is never held open during a long Grok scan.
      runGrokImagenSync(message.maxImages || 7500, message.media || "both").then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message || String(e) }));
      return true;
    }
    if (message.type === "RUN_GROK_BOARDS_SYNC_V20") {
      runGrokBoardsSync(message.maxImages || 7500, message.media || "both").then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message || String(e) }));
      return true;
    }
    if (message.type === "RUN_PAGE_HOOK_CURSOR_SYNC_V20") {
      runPageHookCursorSyncWithFallback(message.maxImages || 7500).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message || String(e) }));
      return true;
    }
    if (message.type === "RUN_IMAGE_GEN_SYNC_V20") {
      runImageGenCursorSync(message.maxImages || 7500).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message || String(e) }));
      return true;
    }
    if (message.type === "CANCEL_REPLAY_V20") {
      contentSyncCancel = true;
      window.postMessage({ source: EXT_SOURCE, type: "STOP_REPLAY" }, "*");
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === "RUN_IMAGE_GEN_AUTOSCROLL_V20") {
      runImagesAutoScrollCapture(message.maxImages || 7500).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message || String(e) }));
      return true;
    }
    if (message.type === "REPLAY_RECIPES") {
      const timeoutMs = Number(message.timeoutMs || 180000);
      let done = false;
      const finish = (payload = {}) => {
        if (done) return;
        done = true;
        window.removeEventListener("message", waitForReplay);
        clearTimeout(timer);
        setTimeout(() => sendResponse({ ok: true, ...payload }), 350);
      };
      const waitForReplay = (event) => {
        if (event.source !== window) return;
        const data = event.data || {};
        if (data.source !== HOOK_SOURCE) return;
        if (data.type === "REPLAY_DONE" || data.type === "REPLAY_CANCELLED") finish({ replayStatus: data.type });
        if (data.type === "REPLAY_ERROR") finish({ replayStatus: data.type, error: data.error || "replay error" });
      };
      const timer = setTimeout(() => finish({ replayStatus: "timeout" }), timeoutMs);
      window.addEventListener("message", waitForReplay);
      window.postMessage({ source: EXT_SOURCE, type: "REPLAY_RECIPES", recipes: message.recipes || [], maxPages: message.maxPages || 300, maxImages: message.maxImages || 7500 }, "*");
      return true;
    }
  });
})();
