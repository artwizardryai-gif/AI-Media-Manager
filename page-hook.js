(() => {
  if (window.__CGPT_GROK_MEDIA_SCRAPER_HOOK_V20__) return;
  window.__CGPT_GROK_MEDIA_SCRAPER_HOOK_V20__ = true;

  const SOURCE = "CGPT_IMAGES_API_SCRAPER_HOOK";
  const HOST_SOURCE = "CGPT_IMAGES_API_SCRAPER_EXTENSION";
  const MAX_TEXT = 10 * 1024 * 1024;
  const DEFAULT_LIMIT = 25;
  const DEFAULT_MAX_PAGES = 300;
  let stopReplay = false;
  let lastImageGenFetchTemplate = null;

  // v2.32.65: capture and diagnose the actual Grok feed/category request used by the current page.
  // New History/Recents pages no longer necessarily use the old hard-coded
  // MEDIA_POST_SOURCE_SAVED / MEDIA_POST_SOURCE_LIKED requests, so the hook records the page's own request
  // body and response assets from document_start, even when Live Capture is off.
  const grokRequestTemplates = [];
  const grokPassiveAssets = new Map();
  const grokLastTemplateByUrl = new Map();
  // v2.32.84: remember the exact Imagine-All asset-history request across SPA
  // navigation/reloads in this tab. Resource Timing may evict older entries after
  // a busy Grok page, while sessionStorage survives same-origin navigation.
  const GROK_IMAGINE_ASSET_TEMPLATE_SESSION_KEY = "__CGPT_GROK_IMAGINE_ALL_ASSET_TEMPLATE_V1__";

  function headersObjectFrom(headersLike) {
    const out = {};
    try {
      const headers = new Headers(headersLike || {});
      headers.forEach((value, key) => {
        const k = String(key || "").toLowerCase();
        // Browser-managed or unsafe headers must not be replayed manually.
        if (!k || k === "cookie" || k === "host" || k === "origin" || k === "referer" || k === "content-length" || k === "accept-encoding" || k === "connection" || k.startsWith("sec-") || k.startsWith("proxy-")) return;
        out[k] = String(value);
      });
    } catch (_) {}
    return out;
  }

  function mergeHeaders(a, b) {
    return { ...(a || {}), ...(b || {}) };
  }

  function captureFetchTemplate(input, init, reqUrl) {
    if (!isImageGenEndpoint(reqUrl)) return;
    try {
      const req = (typeof Request !== "undefined" && input instanceof Request) ? input : null;
      const fromReq = req ? headersObjectFrom(req.headers) : {};
      const fromInit = init && init.headers ? headersObjectFrom(init.headers) : {};
      const headers = mergeHeaders(fromReq, fromInit);
      if (!headers.accept) headers.accept = "application/json, text/plain, */*";
      lastImageGenFetchTemplate = {
        baseUrl: canonicalImageGenUrl(reqUrl),
        headers,
        credentials: (init && init.credentials) || (req && req.credentials) || "include",
        mode: (init && init.mode) || (req && req.mode) || "cors",
        cache: (init && init.cache) || (req && req.cache) || "default",
        referrerPolicy: (init && init.referrerPolicy) || (req && req.referrerPolicy) || "strict-origin-when-cross-origin",
        capturedAt: nowIso()
      };
      post("FETCH_TEMPLATE_CAPTURED", { url: lastImageGenFetchTemplate.baseUrl, headerKeys: Object.keys(headers), capturedAt: lastImageGenFetchTemplate.capturedAt });
    } catch (_) {}
  }

  function isGrokPageRequest(raw) {
    try {
      const u = new URL(String(raw || ""), location.href);
      if (u.hostname !== "grok.com") return false;
      const p = `${u.pathname}${u.search}`.toLowerCase();
      if (/monitoring|log_metric|quota_info|\/t\/?(?:\?|$)|cdn-cgi|favicon|_next\/static/.test(p)) return false;
      return true;
    } catch (_) { return false; }
  }

  function grokTemplateKey(tpl) {
    return `${tpl?.method || "GET"}|${tpl?.url || ""}|${tpl?.body || ""}`;
  }

  function grokDiagnosticSafeValue(value) {
    if (value == null) return "";
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return String(text || "").replace(/\s+/g, " ").trim().slice(0, 180);
  }

  function grokTemplateDiagnostics(tpl) {
    const pairs = [];
    const seen = new Set();
    const add = (key, value) => {
      const k = String(key || "").trim();
      const v = grokDiagnosticSafeValue(value);
      if (!k || !v) return;
      if (/token|auth|cookie|session|csrf|secret|signature|trace|ray|user.?id/i.test(k)) return;
      if (!/(source|filter|category|feed|tab|section|view|scope|collection|status|sort|type|mode|query|origin|history|recent|liked|saved|generated|media)/i.test(`${k} ${v}`)) return;
      const id = `${k}=${v}`;
      if (seen.has(id)) return;
      seen.add(id);
      pairs.push(id);
    };
    let path = "";
    try {
      const u = new URL(String(tpl?.url || ""), location.href);
      path = `${u.pathname}${u.search}`;
      u.searchParams.forEach((value, key) => add(key, value));
    } catch (_) { path = String(tpl?.url || ""); }
    const walk = (value, key = "body", depth = 0) => {
      if (depth > 8 || value == null) return;
      if (Array.isArray(value)) { value.slice(0, 30).forEach((v, i) => walk(v, `${key}[${i}]`, depth + 1)); return; }
      if (typeof value === "object") { Object.entries(value).slice(0, 80).forEach(([k, v]) => { add(k, v); walk(v, k, depth + 1); }); return; }
      add(key, value);
    };
    const body = String(tpl?.body || "").trim();
    if (body) {
      let parsed = null;
      try { parsed = JSON.parse(body); } catch (_) {}
      if (parsed != null) walk(parsed);
      else {
        try { const q = new URLSearchParams(body); q.forEach((value, key) => add(key, value)); } catch (_) {}
        const constants = body.match(/MEDIA_[A-Z0-9_]+|(?:LIKED|SAVED|HISTORY|RECENT|GENERATED|CREATIONS|GALLERY|LIBRARY|BOOKMARKS?)/gi) || [];
        constants.slice(0, 20).forEach((v, i) => add(`body${i ? i : ""}`, v));
      }
    }
    const endpoint = path.split("?")[0] || path;
    const summaryParts = [`${String(tpl?.method || "GET").toUpperCase()} ${endpoint}`];
    if (pairs.length) summaryParts.push(pairs.slice(0, 8).join(", "));
    return { method: String(tpl?.method || "GET").toUpperCase(), url: String(tpl?.url || ""), path, pairs: pairs.slice(0, 24), summary: summaryParts.join(" — ") };
  }

  function grokTemplateReplayScore(tpl) {
    const text = `${tpl?.url || ""} ${tpl?.body || ""}`.toLowerCase();
    let score = Number(tpl?.assetHits || 0) * 1000 + Number(tpl?.responseHits || 0) * 25;
    if (/\/rest\/media\//.test(text)) score += 500;
    if (/post\/list|feed|history|recent|liked|saved|generated|creation|gallery|library|collection|bookmark|source|filter|category/.test(text)) score += 350;
    if (String(tpl?.method || "GET").toUpperCase() === "POST" && tpl?.body) score += 120;
    return score;
  }

  function persistGrokImagineAssetTemplate(tpl) {
    try {
      if (!tpl?.url || !grokIsImagineAllAssetsUrl(tpl.url)) return;
      const safe = {
        url: String(tpl.url || ""),
        method: String(tpl.method || "GET").toUpperCase(),
        headers: headersObjectFrom(tpl.headers || {}),
        body: String(tpl.body || ""),
        credentials: tpl.credentials || "include",
        mode: tpl.mode || "cors",
        cache: tpl.cache || "default",
        referrerPolicy: tpl.referrerPolicy || "origin-when-cross-origin",
        capturedAt: tpl.capturedAt || nowIso()
      };
      sessionStorage.setItem(GROK_IMAGINE_ASSET_TEMPLATE_SESSION_KEY, JSON.stringify(safe));
    } catch (_) {}
  }

  function restoredGrokImagineAssetTemplate() {
    try {
      const raw = sessionStorage.getItem(GROK_IMAGINE_ASSET_TEMPLATE_SESSION_KEY) || "";
      if (!raw) return null;
      const tpl = JSON.parse(raw);
      return tpl?.url && grokIsImagineAllAssetsUrl(tpl.url) ? tpl : null;
    } catch (_) { return null; }
  }

  function rememberGrokTemplate(tpl) {
    if (!tpl || !tpl.url || !isGrokPageRequest(tpl.url)) return null;
    const key = grokTemplateKey(tpl);
    const old = grokRequestTemplates.find(x => grokTemplateKey(x) === key);
    if (old) {
      old.capturedAt = tpl.capturedAt || nowIso();
      old.headers = { ...(old.headers || {}), ...(tpl.headers || {}) };
      if (tpl.body) old.body = tpl.body;
      old.diagnostics = grokTemplateDiagnostics(old);
      grokLastTemplateByUrl.set(tpl.url, old);
      persistGrokImagineAssetTemplate(old);
      return old;
    }
    const stored = { ...tpl, assetHits: 0, responseHits: 0 };
    stored.diagnostics = grokTemplateDiagnostics(stored);
    grokRequestTemplates.unshift(stored);
    if (grokRequestTemplates.length > 50) grokRequestTemplates.length = 50;
    grokLastTemplateByUrl.set(stored.url, stored);
    persistGrokImagineAssetTemplate(stored);
    return stored;
  }

  // Dedicated buffered observer for the flat Imagine asset feed. This runs
  // independently of Live Capture and records the exact URL even if Connect is
  // pressed much later.
  try {
    const grokImagineAssetObserver = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        const url = String(entry?.name || "");
        if (!grokIsImagineAllAssetsUrl(url)) continue;
        rememberGrokTemplate({
          url, method: "GET", headers: { accept: "application/json, text/plain, */*" },
          body: "", credentials: "include", mode: "cors", cache: "default",
          referrerPolicy: "origin-when-cross-origin", capturedAt: nowIso()
        });
      }
    });
    grokImagineAssetObserver.observe({ type: "resource", buffered: true });
    window.__CGPT_GROK_IMAGINE_ASSET_OBSERVER__ = grokImagineAssetObserver;
  } catch (_) {}

  function bodyToText(body) {
    if (body == null) return "";
    if (typeof body === "string") return body;
    if (body instanceof URLSearchParams) return body.toString();
    try { return JSON.stringify(body); } catch (_) { return ""; }
  }

  function captureGrokFetchTemplate(input, init, reqUrl) {
    if (!isGrokPageRequest(reqUrl)) return null;
    try {
      const req = (typeof Request !== "undefined" && input instanceof Request) ? input : null;
      const method = String((init && init.method) || (req && req.method) || "GET").toUpperCase();
      const headers = mergeHeaders(req ? headersObjectFrom(req.headers) : {}, init?.headers ? headersObjectFrom(init.headers) : {});
      let body = bodyToText(init && init.body);
      const tpl = rememberGrokTemplate({
        url: abs(reqUrl), method, headers, body,
        credentials: (init && init.credentials) || (req && req.credentials) || "include",
        mode: (init && init.mode) || (req && req.mode) || "cors",
        cache: (init && init.cache) || (req && req.cache) || "default",
        referrerPolicy: (init && init.referrerPolicy) || (req && req.referrerPolicy) || "origin-when-cross-origin",
        capturedAt: nowIso()
      });
      if (!body && req && method !== "GET" && method !== "HEAD") {
        req.clone().text().then(text => {
          if (!text || !tpl) return;
          tpl.body = text;
          rememberGrokTemplate(tpl);
        }).catch(() => {});
      }
      return tpl;
    } catch (_) { return null; }
  }

  function captureGrokXhrTemplate(url, method, body, headers = {}) {
    if (!isGrokPageRequest(url)) return null;
    return rememberGrokTemplate({
      url: abs(url), method: String(method || "GET").toUpperCase(), headers: headersObjectFrom(headers),
      body: bodyToText(body), credentials: "include", mode: "cors", cache: "default",
      referrerPolicy: "origin-when-cross-origin", capturedAt: nowIso()
    });
  }

  function fetchInitFromTemplate() {
    const tpl = lastImageGenFetchTemplate || {};
    const headers = { ...(tpl.headers || {}) };
    if (!headers.accept) headers.accept = "application/json, text/plain, */*";
    const init = {
      method: "GET",
      credentials: tpl.credentials || "include",
      headers,
      redirect: "follow"
    };
    if (tpl.mode && tpl.mode !== "navigate" && tpl.mode !== "no-cors") init.mode = tpl.mode;
    if (tpl.cache && tpl.cache !== "only-if-cached") init.cache = tpl.cache;
    if (tpl.referrerPolicy) init.referrerPolicy = tpl.referrerPolicy;
    return init;
  }

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  async function waitForTemplate(timeoutMs = 4500) {
    if (lastImageGenFetchTemplate) return lastImageGenFetchTemplate;
    const start = Date.now();
    while (!lastImageGenFetchTemplate && Date.now() - start < timeoutMs) await sleep(100);
    return lastImageGenFetchTemplate;
  }

  const nowIso = () => new Date().toISOString();

  function post(type, payload = {}) {
    try { window.postMessage({ source: SOURCE, type, ...payload }, "*"); } catch (_) {}
  }

  function abs(raw) {
    try { return new URL(String(raw || ""), location.href).href; }
    catch (_) { return String(raw || ""); }
  }

  function isHttpUrl(raw) {
    try { const u = new URL(String(raw || ""), location.href); return u.protocol === "https:" || u.protocol === "http:"; }
    catch (_) { return false; }
  }

  function isImageGenEndpoint(raw) {
    try {
      const u = new URL(String(raw || ""), location.href);
      return (u.hostname === "chatgpt.com" || u.hostname === "chat.openai.com") && /\/backend-api\/my\/recent\/image_gen$/.test(u.pathname);
    } catch (_) { return false; }
  }

  function canonicalImageGenUrl(raw) {
    try {
      const u = new URL(String(raw || ""), location.href);
      u.searchParams.set("limit", u.searchParams.get("limit") || String(DEFAULT_LIMIT));
      u.searchParams.delete("after");
      u.searchParams.delete("cursor");
      return u.href;
    } catch (_) {
      return "https://chatgpt.com/backend-api/my/recent/image_gen?limit=25";
    }
  }

  function parseJson(text) {
    if (!text || typeof text !== "string") return null;
    try { return JSON.parse(text); } catch (_) { return null; }
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
    if (!isHttpUrl(raw)) return false;
    try {
      const u = new URL(String(raw), location.href);
      if (!/\/backend-api\/estuary\/content$/.test(u.pathname)) return false;
      const id = u.searchParams.get("id") || "";
      // Full source image has id=file_... ; thumbnails usually have id=<hash>#file_...#thumbnail.
      return /^file_[A-Za-z0-9_\-]+$/.test(id);
    } catch (_) { return false; }
  }

  function safePreview(raw) {
    if (!isHttpUrl(raw)) return "";
    const s = String(raw || "").toLowerCase();
    if (/\.svg(?:[?#]|$)|\.html?(?:[?#]|$)|\.json(?:[?#]|$)|oaistatic\.com|\/_next\/static\/|avatar|profile|icon|logo|favicon|sprite/.test(s)) return "";
    return abs(raw);
  }

  function extractAssets(root, apiUrl) {
    const out = [];
    const seen = new Set();
    const items = Array.isArray(root?.items) ? root.items : [];
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
      if (!looksLikeEstuarySource(sourceUrl)) continue;
      if (seen.has(sourceUrl)) continue;
      seen.add(sourceUrl);

      const thumb = safePreview(item?.encodings?.thumbnail?.path || "");
      out.push({
        url: sourceUrl,
        previewUrl: thumb || sourceUrl,
        prompt: item.title || item.prompt || item.recreation_prompt || "ChatGPT image",
        createdAt: coerceDate(item.created_at || item.createdAt || item.create_time || item.updated_at) || nowIso(),
        sourceApi: apiUrl || "",
        contextId: item.generation_id || item.id || item.message_id || "",
        fileId: (sourceUrl.match(/[?&]id=(file_[A-Za-z0-9_\-]+)/) || [])[1] || "",
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

  function cursorFrom(root) {
    const c = root && typeof root === "object" ? root.cursor : "";
    return typeof c === "string" && c ? c : "";
  }

  function recipeFromRequest(url, init, fallbackMethod = "GET") {
    return {
      url: canonicalImageGenUrl(url),
      method: "GET",
      body: "",
      contentType: "",
      capturedAt: nowIso()
    };
  }

  function processImageGenResponse(recipe, responseUrl, status, contentType, text) {
    if (!isImageGenEndpoint(responseUrl || recipe.url)) return;
    if (!text || text.length > MAX_TEXT) return;
    const json = parseJson(text);
    if (!json) return;
    const apiUrl = responseUrl || recipe.url;
    const assets = extractAssets(json, apiUrl);
    const cursor = cursorFrom(json);
    post("API_CAPTURE", {
      recipe: recipeFromRequest(recipe.url),
      responseUrl: apiUrl,
      status,
      contentType,
      assets,
      pagination: { cursors: cursor ? [cursor] : [], nextUrls: [] },
      capturedAt: nowIso()
    });
  }


  // v2.12 Live Capture: passive listener for media URLs that the page normally receives.
  // No polling/retry storm; it only records URLs present in ordinary fetch/XHR responses.
  let liveCaptureEnabled = false;
  const liveSeenUrls = new Set();
  const liveBoards = new Map();
  const liveConversationBoards = new Map();

  function liveGrokAbs(raw) {
    const value = String(raw || "").trim();
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith("users/")) return `https://assets.grok.com/${value}`;
    if (value.startsWith("/")) return `${location.origin}${value}`;
    return value;
  }

  function liveSafeSegment(name, fallback = "item") {
    return String(name || fallback).replace(/[\\/:*?"<>|]+/g, "_").replace(/[\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, 80) || fallback;
  }

  function liveBoardFolder(board) {
    const name = liveSafeSegment(board?.name || "", "").replace(/\s+/g, "_");
    const short = String(board?.id || "").slice(0, 8);
    return `Grok/Boards/${name || (short ? `Board_${short}` : "Board")}`;
  }

  function liveKindFrom(item) {
    const mt = String(item?.mediaType || item?.mimeType || item?.type || item?.mime_type || "").toLowerCase();
    const url = String(item?.mediaUrl || item?.url || "").toLowerCase();
    if (mt.includes("video") || mt.includes("mp4") || /\.mp4(?:[?#]|$)/.test(url)) return "video";
    return "image";
  }

  function liveCollectObjects(root, predicate, out = []) {
    if (!root || typeof root !== "object") return out;
    if (predicate(root)) out.push(root);
    if (Array.isArray(root)) for (const v of root) liveCollectObjects(v, predicate, out);
    else for (const v of Object.values(root)) liveCollectObjects(v, predicate, out);
    return out;
  }

  function liveParseCards(value) {
    const arr = Array.isArray(value) ? value : [];
    const out = [];
    for (const raw of arr) {
      if (typeof raw === "string") { try { out.push(JSON.parse(raw)); } catch (_) {} }
      else if (raw && typeof raw === "object") out.push(raw);
    }
    return out;
  }

  function liveRememberGrokMaps(json) {
    try {
      const docs = Array.isArray(json?.documents) ? json.documents : [];
      for (const d of docs) if (d?.id) liveBoards.set(String(d.id), { id: String(d.id), name: d.name || "", createdAt: d.createdAt || "", updatedAt: d.updatedAt || "" });
      const convs = Array.isArray(json?.conversations) ? json.conversations : [];
      for (const c of convs) {
        if (c?.conversationId && c?.canvasId) liveConversationBoards.set(String(c.conversationId), String(c.canvasId));
      }
    } catch (_) {}
  }

  function liveResponseConversationId(apiUrl) {
    try {
      const u = new URL(String(apiUrl || ""), location.href);
      const m = u.pathname.match(/\/rest\/app-chat\/conversations\/([^/]+)\/responses/);
      return m ? decodeURIComponent(m[1]) : "";
    } catch (_) { return ""; }
  }

  function liveCurrentCanvasId() {
    try {
      const m = location.pathname.match(/\/imagine\/agent\/([^/?#]+)/);
      return m ? decodeURIComponent(m[1]) : "";
    } catch (_) { return ""; }
  }

  function liveBoardForApi(apiUrl) {
    const convId = liveResponseConversationId(apiUrl);
    const canvasId = (convId && liveConversationBoards.get(convId)) || liveCurrentCanvasId() || "";
    const known = canvasId ? liveBoards.get(canvasId) : null;
    return known || { id: canvasId, name: document.title && !/grok/i.test(document.title) ? document.title : (canvasId ? `Board ${canvasId.slice(0,8)}` : "Live Board") };
  }

  function liveExtractGrokPostAssets(json, apiUrl) {
    const out = [];
    const seen = new Set();
    const visit = (item, parentPost = null) => {
      if (!item || typeof item !== "object") return;
      const url = liveGrokAbs(item.mediaUrl || item.url || "");
      const mimeType = String(item.mimeType || "");
      const kind = liveKindFrom(item);
      if (url) {
        const key = `${item.id || ""}|${url}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({
            source: "grok",
            grokMode: "imagen",
            kind,
            sourceId: item.id || key,
            postId: item.id || parentPost?.id || "",
            url,
            previewUrl: liveGrokAbs(item.thumbnailImageUrl || (kind === "image" ? url : "")),
            mimeType,
            extHint: mimeType || url,
            prompt: item.prompt || item.originalPrompt || parentPost?.prompt || parentPost?.originalPrompt || (kind === "video" ? "Grok live video" : "Grok live image"),
            createdAt: coerceDate(item.createTime || item.createdAt || parentPost?.createTime) || nowIso(),
            sourceApi: apiUrl || "",
            contextId: item.originalPostId || parentPost?.id || "",
            keyName: "live.grok.post.mediaUrl",
            capturedAt: nowIso(),
            width: Number(item?.resolution?.width || 0),
            height: Number(item?.resolution?.height || 0),
            duration: item.videoDuration || 0,
            resolutionName: item.resolutionName || "",
            folderPrefix: "Grok/Imagen"
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

  function liveExtractGrokBoardAssets(json, board, apiUrl) {
    const out = [];
    const seen = new Set();
    const responses = liveCollectObjects(json, o => Array.isArray(o.cardAttachmentsJson));
    for (const response of responses) {
      const cards = liveParseCards(response.cardAttachmentsJson);
      for (const card of cards) {
        const candidates = [];
        if (card?.type === "imagine_image_to_image" || card?.cardType === "generated_image_card") {
          const chunk = card.image_chunk || card.imageChunk || {};
          const url = liveGrokAbs(chunk.imageUrl || "");
          if (url && !/-part-\d+\//.test(url)) {
            candidates.push({ kind: "image", url, mimeType: "image/jpeg", sourceId: chunk.imageUuid || card.id || url, prompt: chunk?.imagePrompt?.prompt || response.message || "Grok board live image", createdAt: response.createTime, width: chunk?.resolution?.width || card?.resolution?.width, height: chunk?.resolution?.height || card?.resolution?.height });
          }
        }
        if (card?.type === "render_imagine_media" || card?.cardType === "rendered_file_card") {
          const url = liveGrokAbs(card.url || card.fileUrl || "");
          const mimeType = String(card.mime_type || card.mimeType || "");
          const kind = /video|mp4/i.test(`${mimeType} ${url}`) ? "video" : "image";
          if (url) candidates.push({ kind, url, mimeType, sourceId: card.id || url, prompt: card.file_name || response.message || (kind === "video" ? "Grok board live video" : "Grok board live image"), createdAt: response.createTime });
        }
        for (const c of candidates) {
          const key = `${c.kind}|${c.sourceId}|${c.url}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({
            source: "grok",
            grokMode: "boards",
            kind: c.kind,
            sourceId: c.sourceId,
            postId: c.sourceId,
            url: c.url,
            previewUrl: c.kind === "image" ? c.url : "",
            mimeType: c.mimeType,
            extHint: c.mimeType || c.url,
            prompt: c.prompt || (c.kind === "video" ? "Grok board live video" : "Grok board live image"),
            createdAt: coerceDate(c.createdAt || board?.updatedAt || board?.createdAt) || nowIso(),
            sourceApi: apiUrl || "",
            contextId: response.responseId || "",
            conversationId: liveResponseConversationId(apiUrl) || response.conversationId || "",
            boardId: board?.id || "",
            boardName: board?.name || "",
            keyName: "live.grok.board.cardAttachmentsJson",
            capturedAt: nowIso(),
            width: Number(c.width || 0),
            height: Number(c.height || 0),
            folderPrefix: liveBoardFolder(board)
          });
        }
      }
    }
    return out;
  }

  function liveIsGrokApi(apiUrl) {
    try { const u = new URL(String(apiUrl || ""), location.href); return u.hostname === "grok.com" && /\/rest\//.test(u.pathname); }
    catch (_) { return false; }
  }

  function liveExtractJsonAssets(json, apiUrl) {
    liveRememberGrokMaps(json);
    let assets = [];
    try {
      const u = new URL(String(apiUrl || ""), location.href);
      if (isImageGenEndpoint(apiUrl)) assets = assets.concat(extractAssets(json, apiUrl));
      if (u.hostname === "grok.com") {
        if (/\/rest\/media\/post\/list$/.test(u.pathname)) assets = assets.concat(liveExtractGrokPostAssets(json, apiUrl));
        if (/\/rest\/app-chat\/conversations\/[^/]+\/responses$/.test(u.pathname) || liveCollectObjects(json, o => Array.isArray(o.cardAttachmentsJson)).length) {
          assets = assets.concat(liveExtractGrokBoardAssets(json, liveBoardForApi(apiUrl), apiUrl));
        }
      }
    } catch (_) {}
    return assets;
  }

  function liveGrokContextFromObject(obj, parent = {}) {
    if (!obj || typeof obj !== "object") return parent || {};
    return {
      prompt: obj.prompt || obj.originalPrompt || obj.message || obj.text || obj.title || parent.prompt || "",
      id: obj.id || obj.postId || obj.mediaPostId || obj.imageUuid || obj.videoUuid || obj.generationId || parent.id || "",
      createdAt: obj.createTime || obj.createdAt || obj.created_at || obj.timestamp || parent.createdAt || "",
      mimeType: obj.mimeType || obj.mime_type || obj.mediaType || obj.contentType || parent.mimeType || ""
    };
  }

  function liveGenericGrokAssets(root, apiUrl) {
    const candidates = [];
    const visited = new WeakSet();
    const addUrl = (raw, ctx = {}, keyName = "generic") => {
      const values = [];
      if (liveLooksLikeGeneratedAsset(raw)) values.push(liveCleanGrokAssetUrl(raw));
      values.push(...liveExtractGrokGeneratedUrlsFromText(raw));
      for (const url of values) {
        const asset = liveBinaryAsset(url, ctx.mimeType || (/\.(mp4|webm)(?:[?#]|$)/i.test(url) ? "video/mp4" : "image/jpeg"));
        if (!asset) continue;
        if (ctx.prompt) asset.prompt = String(ctx.prompt).replace(/\s+/g, " ").trim().slice(0, 500);
        if (ctx.createdAt) asset.createdAt = coerceDate(ctx.createdAt) || asset.createdAt;
        if (ctx.id && !asset.contextId) asset.contextId = String(ctx.id);
        asset.sourceApi = apiUrl || asset.sourceApi;
        asset.keyName = `live.grok.generic.${keyName}`;
        candidates.push(asset);
      }
    };
    const walk = (value, parentCtx = {}, keyName = "root") => {
      if (value == null) return;
      if (typeof value === "string") { addUrl(value, parentCtx, keyName); return; }
      if (typeof value !== "object") return;
      if (visited.has(value)) return;
      visited.add(value);
      const ctx = liveGrokContextFromObject(value, parentCtx);
      const directKeys = ["mediaUrl","url","fileUrl","imageUrl","videoUrl","assetUrl","downloadUrl","outputUrl","thumbnailImageUrl","thumbnailUrl","previewImageUrl","src","poster"];
      for (const k of directKeys) if (typeof value[k] === "string") addUrl(value[k], ctx, k);
      if (Array.isArray(value)) value.forEach((v, i) => walk(v, ctx, `${keyName}[${i}]`));
      else for (const [k, v] of Object.entries(value)) walk(v, ctx, k);
    };
    walk(root, {}, "json");

    // Prefer the real generated file over preview_image within the same generation.
    const byGeneration = new Map();
    for (const a of candidates) {
      const gen = (String(a.url || "").match(/\/generated\/([^/]+)\//i) || [])[1] || a.url;
      if (!byGeneration.has(gen)) byGeneration.set(gen, []);
      byGeneration.get(gen).push(a);
    }
    const out = [];
    const seen = new Set();
    for (const group of byGeneration.values()) {
      const hasFull = group.some(a => !/\/preview_image\./i.test(a.url || ""));
      for (const a of group) {
        if (hasFull && /\/preview_image\./i.test(a.url || "")) continue;
        const key = `${a.kind}|${a.url}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(a);
      }
    }
    return out;
  }

  function rememberGrokPassiveAssets(assets, template = null) {
    let count = 0;
    for (const asset of assets || []) {
      if (!asset?.url) continue;
      const key = `${asset.kind || ""}|${asset.url}`;
      grokPassiveAssets.set(key, asset);
      count += 1;
    }
    if (grokPassiveAssets.size > 12000) {
      const keys = Array.from(grokPassiveAssets.keys());
      for (const k of keys.slice(0, grokPassiveAssets.size - 12000)) grokPassiveAssets.delete(k);
    }
    if (template && count) template.assetHits = Number(template.assetHits || 0) + count;
    if (template) template.responseHits = Number(template.responseHits || 0) + 1;
    return count;
  }

  function processGrokPageResponse(apiUrl, status, contentType, text, template = null, emitLive = true) {
    if (!isGrokPageRequest(apiUrl) || !text || text.length > MAX_TEXT) return [];
    let assets = [];
    const json = parseJson(text);
    if (json) {
      assets = assets.concat(liveExtractJsonAssets(json, apiUrl));
      assets = assets.concat(liveGenericGrokAssets(json, apiUrl));
    } else {
      assets = assets.concat(liveGenericGrokAssets(String(text), apiUrl));
    }
    // Text/RSC responses can contain escaped generated URLs even when they are not valid JSON.
    for (const url of liveExtractGrokGeneratedUrlsFromText(text)) {
      const a = liveBinaryAsset(url, /\.(mp4|webm)(?:[?#]|$)/i.test(url) ? "video/mp4" : "image/jpeg");
      if (a) { a.sourceApi = apiUrl; a.keyName = "live.grok.raw_response"; assets.push(a); }
    }
    const dedup = [];
    const seen = new Set();
    for (const a of assets) {
      const key = `${a.kind || ""}|${a.url || ""}`;
      if (!a?.url || seen.has(key)) continue;
      seen.add(key);
      dedup.push(a);
    }
    rememberGrokPassiveAssets(dedup, template || grokLastTemplateByUrl.get(abs(apiUrl)) || null);
    if (emitLive && liveCaptureEnabled) livePostAssets(dedup, apiUrl, "grok-page-response");
    return dedup;
  }

  function grokNextCursor(root) {
    if (!root || typeof root !== "object") return "";
    for (const k of ["nextCursor", "next_cursor", "cursor"]) {
      const v = root[k];
      if ((typeof v === "string" || typeof v === "number") && String(v)) return String(v);
    }
    for (const v of Object.values(root)) {
      if (!v || typeof v !== "object") continue;
      const c = grokNextCursor(v);
      if (c) return c;
    }
    return "";
  }

  function grokFetchInitFromTemplate(tpl, cursor = "") {
    const method = String(tpl?.method || "GET").toUpperCase();
    const headers = { ...(tpl?.headers || {}) };
    if (!headers.accept) headers.accept = "application/json, text/plain, */*";
    let url = tpl?.url || location.href;
    let body = tpl?.body || "";
    if (cursor) {
      let changed = false;
      if (body) {
        try {
          const obj = JSON.parse(body);
          if (obj && typeof obj === "object") { obj.cursor = cursor; body = JSON.stringify(obj); changed = true; }
        } catch (_) {}
      }
      if (!changed && (method === "GET" || method === "HEAD")) {
        try { const u = new URL(url, location.href); u.searchParams.set("cursor", cursor); url = u.href; } catch (_) {}
      }
    }
    const init = { method, credentials: tpl?.credentials || "include", headers, redirect: "follow" };
    if (body && method !== "GET" && method !== "HEAD") init.body = body;
    if (tpl?.mode && tpl.mode !== "navigate" && tpl.mode !== "no-cors") init.mode = tpl.mode;
    if (tpl?.cache && tpl.cache !== "only-if-cached") init.cache = tpl.cache;
    if (tpl?.referrerPolicy) init.referrerPolicy = tpl.referrerPolicy;
    return { url, init };
  }

  async function grokPageFeedSync(maxImages = 7500, maxPages = 300) {
    stopReplay = false;
    const max = Math.max(1, Number(maxImages || 7500));
    const pageMax = Math.max(1, Math.min(Number(maxPages || 300), 300));
    const syncSeen = new Set();
    let pages = 0, totalAssets = 0;
    const emitPage = (assets, url, cursor = "", label = "captured") => {
      const fresh = [];
      for (const a of assets || []) {
        const key = `${a.kind || ""}|${a.url || ""}`;
        if (!a?.url || syncSeen.has(key) || totalAssets + fresh.length >= max) continue;
        syncSeen.add(key); fresh.push(a);
      }
      if (!fresh.length) return;
      pages += 1; totalAssets += fresh.length;
      post("GROK_FEED_SYNC_PAGE", { page: pages, url: url || location.href, assets: fresh, cursor, label, totalAssets });
    };

    emitPage(Array.from(grokPassiveAssets.values()), location.href, "", "captured-response-cache");

    const templates = grokRequestTemplates
      .filter(t => {
        if (!t?.url) return false;
        const text = `${t.url || ""} ${t.body || ""}`;
        return Number(t.assetHits || 0) > 0 || Number(t.responseHits || 0) > 0 ||
          /\/rest\/(media|app-chat)\/|post\/list|feed|history|recent|liked|saved|generated|creation|gallery|library|collection|bookmark|source|filter|category/i.test(text);
      })
      .sort((a, b) => grokTemplateReplayScore(b) - grokTemplateReplayScore(a) || String(b.capturedAt || "").localeCompare(String(a.capturedAt || "")))
      .filter((t, i, arr) => arr.findIndex(x => grokTemplateKey(x) === grokTemplateKey(t)) === i)
      .slice(0, 16);

    for (const tpl of templates) {
      if (stopReplay || totalAssets >= max) break;
      let cursor = "";
      const seenCursors = new Set();
      for (let p = 0; p < pageMax && totalAssets < max; p++) {
        const req = grokFetchInitFromTemplate(tpl, cursor);
        let res, text = "", ct = "";
        try {
          res = await nativeFetch(req.url, req.init);
          ct = res.headers.get("content-type") || "";
          text = await res.clone().text().catch(() => "");
        } catch (e) {
          post("GROK_FEED_SYNC_ERROR", { error: e.message || String(e), url: req.url, pages, totalAssets });
          break;
        }
        if (!res.ok) { post("GROK_FEED_SYNC_ERROR", { error: `HTTP ${res.status}`, status: res.status, url: req.url, pages, totalAssets }); break; }
        const assets = processGrokPageResponse(res.url || req.url, res.status, ct, text, tpl, false);
        const json = parseJson(text);
        const next = grokNextCursor(json);
        emitPage(assets, res.url || req.url, next, "replayed-page-feed");
        if (!next || seenCursors.has(next)) break;
        seenCursors.add(next); cursor = next;
      }
    }
    const diagnostics = templates.map(t => t.diagnostics || grokTemplateDiagnostics(t)).filter(Boolean);
    post("GROK_FEED_SYNC_DONE", { pages, totalAssets, templates: templates.length, capturedAssets: grokPassiveAssets.size, diagnostics, cancelled: stopReplay });
  }


  // v2.32.79: sync only the exact flat Imagine-All asset-history request made by
  // Grok itself. Unknown MEDIA_POST_SOURCE_* values can silently fall back to
  // Discover, so do not infer an endpoint or source name here.
  function grokIsImagineAllAssetsUrl(raw) {
    try {
      const u = new URL(String(raw || ""), location.href);
      if (u.hostname !== "grok.com") return false;
      const last = u.pathname.split("/").filter(Boolean).pop() || "";
      if (last.toLowerCase() !== "assets") return false;
      return String(u.searchParams.get("workspaceKind") || "") === "WORKSPACE_KIND_IMAGINE_ALL";
    } catch (_) { return false; }
  }

  function grokImagineAllAssetTemplates() {
    const out = [];
    const seen = new Set();
    const add = (tpl, via) => {
      if (!tpl?.url || !grokIsImagineAllAssetsUrl(tpl.url)) return;
      const key = `${String(tpl.method || "GET").toUpperCase()}|${tpl.url}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ ...tpl, capturedVia: via || tpl.capturedVia || "page" });
    };
    const restored = restoredGrokImagineAssetTemplate();
    if (restored) add(restored, "session");
    for (const tpl of grokRequestTemplates) add(tpl, "fetch/xhr");
    try {
      for (const entry of performance.getEntriesByType("resource") || []) {
        const url = String(entry?.name || "");
        if (!grokIsImagineAllAssetsUrl(url)) continue;
        add({
          url, method: "GET", headers: { accept: "application/json, text/plain, */*" },
          body: "", credentials: "include", mode: "cors", cache: "default",
          referrerPolicy: "origin-when-cross-origin", capturedAt: nowIso()
        }, "performance");
      }
    } catch (_) {}
    out.sort((a, b) => {
      const score = tpl => {
        try {
          const u = new URL(tpl.url, location.href);
          let n = 0;
          if (u.searchParams.get("workspaceKind") === "WORKSPACE_KIND_IMAGINE_ALL") n += 20;
          if (u.searchParams.get("orderBy") === "ORDER_BY_CREATE_TIME") n += 10;
          if (u.searchParams.has("pageToken")) n += 1;
          if (tpl.capturedVia === "fetch/xhr") n += 3;
          if (tpl.capturedVia === "session") n += 2;
          return n;
        } catch (_) { return 0; }
      };
      return score(b) - score(a) || String(b.capturedAt || "").localeCompare(String(a.capturedAt || ""));
    });
    return out;
  }

  function grokAssetHistoryNextPageToken(root) {
    if (!root || typeof root !== "object") return "";
    for (const k of ["nextPageToken", "next_page_token", "nextToken", "continuationToken"]) {
      const v = root[k];
      if ((typeof v === "string" || typeof v === "number") && String(v)) return String(v);
    }
    for (const v of Object.values(root)) {
      if (!v || typeof v !== "object") continue;
      const token = grokAssetHistoryNextPageToken(v);
      if (token) return token;
    }
    return "";
  }

  async function grokImagineAllAssetHistorySync(maxImages = 9500, maxPages = 300) {
    stopReplay = false;
    const max = Math.max(1, Number(maxImages || 9500));
    const pageMax = Math.max(1, Math.min(300, Number(maxPages || 300)));
    const templates = grokImagineAllAssetTemplates();
    if (!templates.length) {
      post("GROK_ASSET_HISTORY_SYNC_DONE", {
        found: false, pages: 0, totalAssets: 0,
        diagnostics: [{ summary: "IMAGINE ALL ASSETS: exact page request not captured" }]
      });
      return;
    }

    const tpl = templates[0];
    const base = new URL(tpl.url, location.href);
    base.searchParams.set("pageSize", base.searchParams.get("pageSize") || "40");
    base.searchParams.set("orderBy", base.searchParams.get("orderBy") || "ORDER_BY_CREATE_TIME");
    base.searchParams.set("workspaceKind", "WORKSPACE_KIND_IMAGINE_ALL");
    base.searchParams.delete("pageToken");

    let pages = 0, totalAssets = 0, token = "", firstShape = "";
    const seenTokens = new Set();
    const seenAssets = new Set();
    for (let p = 0; p < pageMax && totalAssets < max && !stopReplay; p++) {
      const u = new URL(base.href);
      if (token) u.searchParams.set("pageToken", token);
      const initBase = grokFetchInitFromTemplate(tpl, "").init;
      initBase.method = "GET";
      delete initBase.body;
      let res, text = "", ct = "";
      try {
        res = await nativeFetch(u.href, initBase);
        ct = res.headers.get("content-type") || "";
        text = await res.clone().text().catch(() => "");
      } catch (e) {
        post("GROK_ASSET_HISTORY_SYNC_ERROR", { error: e?.message || String(e), url: u.href, pages, totalAssets });
        break;
      }
      if (!res.ok) {
        post("GROK_ASSET_HISTORY_SYNC_ERROR", { error: `HTTP ${res.status}`, status: res.status, url: u.href, pages, totalAssets });
        break;
      }
      const json = parseJson(text);
      if (!firstShape && json && typeof json === "object") {
        const keys = Object.keys(json).slice(0, 10);
        const arrays = Object.entries(json).filter(([,v]) => Array.isArray(v)).slice(0, 6).map(([k,v]) => `${k}:${v.length}`);
        firstShape = `keys ${keys.join(",") || "-"}; arrays ${arrays.join(",") || "-"}`;
      }
      const parsedAll = processGrokPageResponse(res.url || u.href, res.status, ct, text, tpl, false);
      // This feed is used for the user's Imagine history. Never let public
      // Discover URLs leak through this path while we are diagnosing history.
      const parsed = (parsedAll || []).filter(a => liveLooksLikeGeneratedAsset(a?.url || ""));
      const fresh = [];
      for (const a of parsed) {
        const key = `${a?.kind || ""}|${a?.url || ""}`;
        if (!a?.url || seenAssets.has(key) || totalAssets + fresh.length >= max) continue;
        seenAssets.add(key);
        fresh.push(a);
      }
      const next = grokAssetHistoryNextPageToken(json);
      pages += 1;
      if (fresh.length) {
        totalAssets += fresh.length;
        post("GROK_ASSET_HISTORY_SYNC_PAGE", {
          page: pages, url: res.url || u.href, assets: fresh, pageToken: next, totalAssets
        });
      }
      if (!next || seenTokens.has(next) || totalAssets >= max) break;
      seenTokens.add(next);
      token = next;
    }
    post("GROK_ASSET_HISTORY_SYNC_DONE", {
      found: true, pages, totalAssets, path: base.pathname,
      capturedVia: tpl.capturedVia || "page", firstShape,
      diagnostics: [{ summary: `IMAGINE ALL ASSETS: ${base.pathname}; via ${tpl.capturedVia || "page"}; templates ${templates.length}; pages ${pages}; private media ${totalAssets}; ${firstShape || "shape -"}` }],
      cancelled: stopReplay
    });
  }


  // v2.32.80: targeted Imagine conversation-history sync.
  // Grok's newer private generations are exposed by page requests carrying
  // conversationKind=CONVERSATION_KIND_IMAGINE. Replay only that exact page
  // request family; do not guess MEDIA_POST_SOURCE_* categories and do not scroll.
  function grokIsImagineConversationUrl(raw) {
    try {
      const u = new URL(String(raw || ""), location.href);
      if (u.hostname !== "grok.com") return false;
      const q = String(u.searchParams.get("conversationKind") || "");
      if (q === "CONVERSATION_KIND_IMAGINE") return true;
      return /(?:^|[?&])conversationKind=CONVERSATION_KIND_IMAGINE(?:&|$)/.test(u.search);
    } catch (_) { return false; }
  }

  function grokImagineConversationTemplates() {
    const out = [];
    const seen = new Set();
    const add = (tpl, via) => {
      if (!tpl?.url || !grokIsImagineConversationUrl(tpl.url)) return;
      const method = String(tpl.method || "GET").toUpperCase();
      const key = `${method}|${tpl.url}|${tpl.body || ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ ...tpl, method, capturedVia: via || tpl.capturedVia || "page" });
    };
    for (const tpl of grokRequestTemplates) add(tpl, "fetch/xhr");
    try {
      for (const entry of performance.getEntriesByType("resource") || []) {
        const url = String(entry?.name || "");
        if (!grokIsImagineConversationUrl(url)) continue;
        add({
          url,
          method: "GET",
          headers: { accept: "application/json, text/plain, */*" },
          body: "",
          credentials: "include",
          mode: "cors",
          cache: "default",
          referrerPolicy: "origin-when-cross-origin",
          capturedAt: nowIso()
        }, "performance");
      }
    } catch (_) {}
    out.sort((a, b) => {
      const score = tpl => {
        let n = 0;
        try {
          const u = new URL(tpl.url, location.href);
          if (u.searchParams.get("conversationKind") === "CONVERSATION_KIND_IMAGINE") n += 50;
          if (/conversations/i.test(u.pathname)) n += 15;
          if (u.searchParams.has("pageSize")) n += 5;
          if (u.searchParams.has("pageToken")) n += 1;
        } catch (_) {}
        if (tpl.capturedVia === "fetch/xhr") n += 10;
        if (Number(tpl.assetHits || 0) > 0) n += 30;
        return n;
      };
      return score(b) - score(a) || String(b.capturedAt || "").localeCompare(String(a.capturedAt || ""));
    });
    return out;
  }

  function grokImagineContinuation(root) {
    if (!root || typeof root !== "object") return { token: "", param: "" };
    const direct = [
      ["nextPageToken", "pageToken"],
      ["next_page_token", "pageToken"],
      ["nextToken", "pageToken"],
      ["continuationToken", "pageToken"],
      ["nextCursor", "cursor"],
      ["next_cursor", "cursor"]
    ];
    for (const [key, param] of direct) {
      const v = root[key];
      if ((typeof v === "string" || typeof v === "number") && String(v)) return { token: String(v), param };
    }
    for (const v of Object.values(root)) {
      if (!v || typeof v !== "object") continue;
      const hit = grokImagineContinuation(v);
      if (hit.token) return hit;
    }
    return { token: "", param: "" };
  }

  async function grokImagineConversationHistorySync(maxImages = 9500, maxPages = 300) {
    stopReplay = false;
    const max = Math.max(1, Number(maxImages || 9500));
    const pageMax = Math.max(1, Math.min(300, Number(maxPages || 300)));
    const templates = grokImagineConversationTemplates();
    if (!templates.length) {
      post("GROK_IMAGINE_CONVERSATION_SYNC_DONE", {
        found: false, pages: 0, totalAssets: 0,
        diagnostics: [{ summary: "IMAGINE CONVERSATIONS: exact conversationKind page request not captured" }]
      });
      return;
    }

    const tpl = templates[0];
    const base = new URL(tpl.url, location.href);
    base.searchParams.delete("pageToken");
    base.searchParams.delete("cursor");
    base.searchParams.delete("nextPageToken");
    base.searchParams.set("conversationKind", "CONVERSATION_KIND_IMAGINE");

    let pages = 0, totalAssets = 0, token = "", tokenParam = "";
    let firstShape = "", firstSample = "";
    const seenTokens = new Set();
    const seenAssets = new Set();

    for (let p = 0; p < pageMax && totalAssets < max && !stopReplay; p++) {
      const u = new URL(base.href);
      if (token && tokenParam) u.searchParams.set(tokenParam, token);
      const initBase = grokFetchInitFromTemplate(tpl, "").init;
      if (String(tpl.method || "GET").toUpperCase() === "GET") {
        initBase.method = "GET";
        delete initBase.body;
      }

      let res, text = "", ct = "";
      try {
        res = await nativeFetch(u.href, initBase);
        ct = res.headers.get("content-type") || "";
        text = await res.clone().text().catch(() => "");
      } catch (e) {
        post("GROK_IMAGINE_CONVERSATION_SYNC_ERROR", { error: e?.message || String(e), url: u.href, pages, totalAssets });
        break;
      }
      if (!res.ok) {
        post("GROK_IMAGINE_CONVERSATION_SYNC_ERROR", { error: `HTTP ${res.status}`, status: res.status, url: u.href, pages, totalAssets });
        break;
      }

      const json = parseJson(text);
      if (!firstShape && json && typeof json === "object") {
        const keys = Object.keys(json).slice(0, 12);
        const arrays = Object.entries(json).filter(([,v]) => Array.isArray(v)).slice(0, 8).map(([k,v]) => `${k}:${v.length}`);
        firstShape = `keys ${keys.join(",") || "-"}; arrays ${arrays.join(",") || "-"}`;
      }

      const parsed = processGrokPageResponse(res.url || u.href, res.status, ct, text, tpl, false);
      const fresh = [];
      for (const a of parsed || []) {
        const url = String(a?.url || "");
        if (!url || !/assets\.grok\.com\/users\/[^/]+\/generated\/[^/]+\//i.test(url)) continue;
        const key = `${a?.kind || ""}|${url}`;
        if (seenAssets.has(key) || totalAssets + fresh.length >= max) continue;
        seenAssets.add(key);
        fresh.push(a);
        if (!firstSample) {
          const m = url.match(/\/generated\/([^/]+)\//i);
          firstSample = `${String(m?.[1] || a?.sourceId || "").slice(0, 8)}:${a?.kind || "media"}`;
        }
      }

      const cont = grokImagineContinuation(json);
      pages += 1;
      if (fresh.length) {
        totalAssets += fresh.length;
        post("GROK_IMAGINE_CONVERSATION_SYNC_PAGE", {
          page: pages, url: res.url || u.href, assets: fresh,
          pageToken: cont.token || "", tokenParam: cont.param || "", totalAssets
        });
      }

      if (!cont.token || seenTokens.has(`${cont.param}|${cont.token}`) || totalAssets >= max) break;
      seenTokens.add(`${cont.param}|${cont.token}`);
      token = cont.token;
      tokenParam = cont.param || "pageToken";
    }

    post("GROK_IMAGINE_CONVERSATION_SYNC_DONE", {
      found: true, pages, totalAssets, path: base.pathname,
      capturedVia: tpl.capturedVia || "page", firstShape, firstSample,
      diagnostics: [{ summary: `IMAGINE CONVERSATIONS: ${base.pathname}; via ${tpl.capturedVia || "page"}; pages ${pages}; media ${totalAssets}; sample ${firstSample || "-"}; ${firstShape || "shape -"}` }],
      cancelled: stopReplay
    });
  }

  function liveBinaryAsset(apiUrl, contentType) {
    if (!isHttpUrl(apiUrl)) return null;
    const url = abs(apiUrl);
    const s = url.toLowerCase();
    const ct = String(contentType || "").toLowerCase();
    if (!/(image\/(png|jpeg|jpg|webp)|video\/(mp4|webm))/.test(ct) && !/\.(png|jpe?g|webp|mp4|webm)(?:[?#]|$)/.test(s)) return null;
    const isGrokGeneratedAsset = /assets\.grok\.com\/users\/[^/]+\/generated\/[^/]+\//.test(s);
    if (!isGrokGeneratedAsset && /thumbnail|thumb|preview|canvas_thumbnails|avatar|profile|icon|logo|sprite|favicon|unknown_light|unknown_dark/.test(s)) return null;
    if (looksLikeEstuarySource(url)) {
      return { source: "chatgpt", kind: "image", url, previewUrl: url, prompt: "ChatGPT live image", createdAt: nowIso(), sourceApi: url, fileId: (url.match(/[?&]id=(file_[A-Za-z0-9_\-]+)/) || [])[1] || "", keyName: "live.chatgpt.binary", extHint: contentType || url, capturedAt: nowIso() };
    }
    if (/assets\.grok\.com\/users\/|imagine-public\.x\.ai\/imagine-public\/(share-images|share-videos)/.test(s)) {
      const kind = /video|\.(mp4|webm)(?:[?#]|$)/.test(`${ct} ${s}`) ? "video" : "image";
      const boardMode = /\/imagine\/agent\//.test(location.pathname) ? "boards" : "imagen";
      const board = boardMode === "boards" ? liveBoardForApi("") : null;
      const gen = (url.match(/\/generated\/([^/]+)\/([^/?#]+)/i) || []);
      const sourceId = gen[1] ? `${gen[1]}:${decodeURIComponent(gen[2] || "")}` : ((url.match(/\/([0-9a-f-]{20,}|file_[A-Za-z0-9_\-]+)(?:\/|\.|$)/i) || [])[1] || url);
      return { source: "grok", grokMode: boardMode, kind, url, previewUrl: kind === "image" ? url : "", prompt: /\/preview_image\./i.test(url) ? "Grok live image preview" : (kind === "video" ? "Grok live video" : "Grok live image"), createdAt: nowIso(), sourceApi: url, sourceId, postId: gen[1] || "", contextId: gen[1] || "", keyName: gen[1] ? "live.grok.generated_asset" : "live.grok.binary", extHint: contentType || url, capturedAt: nowIso(), folderPrefix: board ? liveBoardFolder(board) : "Grok/Imagen", boardId: board?.id || "", boardName: board?.name || "" };
    }
    return null;
  }

  function livePostAssets(assets, apiUrl, reason) {
    if (!liveCaptureEnabled) return;
    const fresh = [];
    for (const a of assets || []) {
      if (!a || !a.url) continue;
      const key = `${a.source || ""}|${a.grokMode || ""}|${a.kind || ""}|${a.url}`;
      if (liveSeenUrls.has(key)) continue;
      liveSeenUrls.add(key);
      fresh.push(a);
    }
    if (!fresh.length) return;
    post("LIVE_CAPTURE", { responseUrl: apiUrl || "", reason: reason || "", assetSource: fresh[0]?.source || "", assets: fresh, capturedAt: nowIso() });
  }

  function startLiveCapture() {
    liveCaptureEnabled = true;
    liveStartGeneratedAssetWatch();
    post("LIVE_CAPTURE", { phase: "started", responseUrl: location.href, reason: "started", assets: [], capturedAt: nowIso() });
  }
  function stopLiveCapture() {
    liveCaptureEnabled = false;
    liveStopGeneratedAssetWatch();
    post("LIVE_CAPTURE", { phase: "stopped", responseUrl: location.href, reason: "stopped", assets: [], capturedAt: nowIso() });
  }

  function processLiveJsonResponse(apiUrl, status, contentType, text, template = null) {
    if (!text || text.length > MAX_TEXT || !/json|text|javascript|x-component/i.test(String(contentType || ""))) return;
    if (isGrokPageRequest(apiUrl)) {
      processGrokPageResponse(apiUrl, status, contentType, text, template, true);
      return;
    }
    const json = parseJson(text);
    if (!json) return;
    const assets = liveExtractJsonAssets(json, apiUrl);
    livePostAssets(assets, apiUrl, "json");
  }

  function processLiveBinaryResponse(apiUrl, status, contentType) {
    const asset = liveBinaryAsset(apiUrl, contentType);
    if (asset) livePostAssets([asset], apiUrl, "binary");
  }

  let livePerfObserver = null;
  let livePerfTimer = null;

  function liveCleanGrokAssetUrl(raw) {
    let value = String(raw || "").trim();
    if (!value) return "";
    for (let i = 0; i < 3; i++) {
      value = value.replace(/&amp;/g, "&").replace(/\\u002[Ff]/g, "/").replace(/\\u0026/g, "&").replace(/\\u003[Dd]/g, "=").replace(/\\u003[Ff]/g, "?").replace(/\\//g, "/");
    }
    value = value.replace(/[\"'<>),;]+$/g, "");
    if (/^https?:\/\/assets\.grok\.com\//i.test(value)) return value;
    if (/^assets\.grok\.com\//i.test(value)) return `https://${value}`;
    if (/^\/users\//i.test(value)) return `https://assets.grok.com${value}`;
    if (/^users\//i.test(value)) return `https://assets.grok.com/${value}`;
    return value;
  }

  function liveLooksLikeGeneratedAsset(raw) {
    try {
      const u = new URL(liveCleanGrokAssetUrl(raw), location.href);
      return u.hostname === "assets.grok.com" && /^\/users\/[^/]+\/generated\/[^/]+\/.+\.(?:mp4|webm|webp|png|jpe?g)$/i.test(u.pathname);
    } catch (_) { return false; }
  }

  function liveExtractGrokGeneratedUrlsFromText(text) {
    const out = [];
    const original = String(text || "");
    if (!original) return out;
    const variants = [original, original.replace(/\\u002[Ff]/g, "/").replace(/\\//g, "/").replace(/&amp;/g, "&")];
    const patterns = [
      /https?:\/\/assets\.grok\.com\/users\/[^"'\s<>()]+\/generated\/[^"'\s<>()]+\/[^"'\s<>()]+?\.(?:mp4|webm|webp|png|jpe?g)(?:\?[^"'\s<>()]*)?/gi,
      /(?:^|["'\s(<])((?:\/)?users\/[^"'\s<>()]+\/generated\/[^"'\s<>()]+\/[^"'\s<>()]+?\.(?:mp4|webm|webp|png|jpe?g)(?:\?[^"'\s<>()]*)?)/gi,
      /assets\.grok\.com\/users\/[^"'\s<>()]+\/generated\/[^"'\s<>()]+\/[^"'\s<>()]+?\.(?:mp4|webm|webp|png|jpe?g)(?:\?[^"'\s<>()]*)?/gi
    ];
    for (const variant of variants) {
      for (const re of patterns) {
        let m;
        re.lastIndex = 0;
        while ((m = re.exec(variant))) out.push(liveCleanGrokAssetUrl(m[1] || m[0]));
      }
    }
    return out.filter(Boolean);
  }

  function liveCssUrls(value) {
    const out = [];
    const re = /url\((['"]?)(.*?)\1\)/gi;
    let m;
    while ((m = re.exec(String(value || "")))) if (m[2]) out.push(m[2]);
    return out;
  }

  function liveScanGeneratedAssets(reason = "resource-scan") {
    if (!liveCaptureEnabled) return;
    const urls = [];
    try {
      for (const e of performance.getEntriesByType("resource") || []) if (e?.name && liveLooksLikeGeneratedAsset(e.name)) urls.push(e.name);
    } catch (_) {}
    try {
      const nodes = Array.from(document.querySelectorAll('video, source, img, a, [src], [href], [poster], [style], [data-src], [data-url], [aria-label], [title], [alt]'));
      for (const el of nodes) {
        const direct = [el.currentSrc, el.src, el.href, el.poster, el.getAttribute?.('src'), el.getAttribute?.('href'), el.getAttribute?.('poster'), el.getAttribute?.('data-src'), el.getAttribute?.('data-url'), el.getAttribute?.('aria-label'), el.getAttribute?.('title'), el.getAttribute?.('alt')].filter(Boolean);
        const srcset = el.getAttribute?.('srcset') || "";
        if (srcset) for (const part of String(srcset).split(',')) { const u = part.trim().split(/\s+/)[0]; if (u) direct.push(u); }
        try { direct.push(...liveCssUrls(el.getAttribute?.('style') || "")); } catch (_) {}
        try { direct.push(...liveCssUrls(getComputedStyle(el).backgroundImage || "")); } catch (_) {}
        for (const raw of direct) {
          if (liveLooksLikeGeneratedAsset(raw)) urls.push(liveCleanGrokAssetUrl(raw));
          else urls.push(...liveExtractGrokGeneratedUrlsFromText(raw));
        }
      }
    } catch (_) {}
    try {
      urls.push(...liveExtractGrokGeneratedUrlsFromText(String(document.documentElement?.innerHTML || "")));
      for (const sc of Array.from(document.scripts || [])) urls.push(...liveExtractGrokGeneratedUrlsFromText(String(sc.textContent || sc.innerHTML || "")));
    } catch (_) {}
    const assets = [];
    const seen = new Set();
    for (const raw of urls) {
      const url = abs(liveCleanGrokAssetUrl(raw));
      if (seen.has(url)) continue;
      seen.add(url);
      const asset = liveBinaryAsset(url, /\.(mp4|webm)(?:[?#]|$)/i.test(url) ? "video/mp4" : "image/jpeg");
      if (asset) assets.push(asset);
    }
    livePostAssets(assets, location.href, reason);
  }

  function liveStartGeneratedAssetWatch() {
    liveScanGeneratedAssets("start-resource-scan");
    try {
      livePerfObserver = new PerformanceObserver((list) => {
        const assets = [];
        for (const e of list.getEntries() || []) {
          if (!e?.name || !liveLooksLikeGeneratedAsset(e.name)) continue;
          const asset = liveBinaryAsset(e.name, /\.(mp4|webm)(?:[?#]|$)/i.test(e.name) ? "video/mp4" : "image/jpeg");
          if (asset) assets.push(asset);
        }
        livePostAssets(assets, location.href, "performance-resource");
      });
      livePerfObserver.observe({ type: "resource", buffered: true });
    } catch (_) {}
    clearInterval(livePerfTimer);
    livePerfTimer = setInterval(() => liveScanGeneratedAssets("interval-resource-scan"), 2500);
  }

  function liveStopGeneratedAssetWatch() {
    clearInterval(livePerfTimer);
    livePerfTimer = null;
    if (livePerfObserver) { try { livePerfObserver.disconnect(); } catch (_) {} }
    livePerfObserver = null;
  }

  async function readIfImageGen(res, recipe, reqUrl, grokTemplate = null) {
    const responseUrl = res.url || reqUrl || recipe.url;
    const ct = (res.headers && res.headers.get && res.headers.get("content-type")) || "";
    const shouldReadGrok = isGrokPageRequest(responseUrl || reqUrl);
    if (/json|text|javascript|x-component/i.test(ct) || shouldReadGrok) {
      const text = await res.clone().text().catch(() => "");
      if (isImageGenEndpoint(responseUrl)) processImageGenResponse(recipe, responseUrl, res.status, ct, text);
      if (shouldReadGrok) processGrokPageResponse(responseUrl, res.status, ct, text, grokTemplate, true);
      else if (liveCaptureEnabled) processLiveJsonResponse(responseUrl, res.status, ct, text, grokTemplate);
    } else {
      if (liveCaptureEnabled) processLiveBinaryResponse(responseUrl, res.status, ct);
    }
  }

  const nativeFetch = window.fetch;
  window.fetch = async function(input, init) {
    const reqUrl = abs(input && input.url ? input.url : input);
    let grokTemplate = null;
    try { captureFetchTemplate(input, init, reqUrl); } catch (_) {}
    try { grokTemplate = captureGrokFetchTemplate(input, init, reqUrl); } catch (_) {}
    const res = await nativeFetch.apply(this, arguments);
    try {
      if (isHttpUrl(reqUrl) || isHttpUrl(res.url || "")) await readIfImageGen(res, recipeFromRequest(reqUrl, init), reqUrl, grokTemplate);
    } catch (_) {}
    return res;
  };

  const NativeXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function() {
    const xhr = new NativeXHR();
    let url = "";
    let method = "GET";
    const requestHeaders = {};
    let grokTemplate = null;
    const oldOpen = xhr.open;
    xhr.open = function(requestMethod, requestUrl) {
      method = String(requestMethod || "GET").toUpperCase();
      url = abs(requestUrl || "");
      return oldOpen.apply(xhr, arguments);
    };
    const oldSetRequestHeader = xhr.setRequestHeader;
    xhr.setRequestHeader = function(name, value) {
      try { requestHeaders[String(name || "").toLowerCase()] = String(value || ""); } catch (_) {}
      return oldSetRequestHeader.apply(xhr, arguments);
    };
    const oldSend = xhr.send;
    xhr.send = function(body) {
      try { grokTemplate = captureGrokXhrTemplate(url, method, body, requestHeaders); } catch (_) {}
      return oldSend.apply(xhr, arguments);
    };
    xhr.addEventListener("load", () => {
      try {
        const responseUrl = xhr.responseURL || url;
        if (!isHttpUrl(responseUrl)) return;
        const ct = xhr.getResponseHeader("content-type") || "";
        if (/json|text|javascript|x-component/i.test(ct) || isGrokPageRequest(responseUrl)) {
          let text = "";
          try { text = typeof xhr.responseText === "string" ? xhr.responseText : ""; } catch (_) {}
          if (!text && xhr.response && typeof xhr.response === "object") { try { text = JSON.stringify(xhr.response); } catch (_) {} }
          if (isImageGenEndpoint(responseUrl)) processImageGenResponse(recipeFromRequest(url), responseUrl, xhr.status, ct, text);
          if (isGrokPageRequest(responseUrl)) processGrokPageResponse(responseUrl, xhr.status, ct, text, grokTemplate, true);
          else if (liveCaptureEnabled) processLiveJsonResponse(responseUrl, xhr.status, ct, text, grokTemplate);
        } else {
          if (liveCaptureEnabled) processLiveBinaryResponse(responseUrl, xhr.status, ct);
        }
      } catch (_) {}
    });
    return xhr;
  };

  async function replayImageGen(recipe, maxPages = DEFAULT_MAX_PAGES, maxImages = DEFAULT_MAX_PAGES * DEFAULT_LIMIT) {
    stopReplay = false;
    let base = canonicalImageGenUrl(recipe?.url || "https://chatgpt.com/backend-api/my/recent/image_gen?limit=25");
    const seenCursors = new Set();
    const seenUrls = new Set();
    let cursor = "";
    let totalAssets = 0;

    for (let page = 0; page < Number(maxPages || DEFAULT_MAX_PAGES); page++) {
      if (stopReplay) { post("REPLAY_CANCELLED", { page }); break; }
      const u = new URL(base);
      u.searchParams.set("limit", u.searchParams.get("limit") || String(DEFAULT_LIMIT));
      if (cursor) u.searchParams.set("after", cursor);
      else u.searchParams.delete("after");
      const url = u.href;
      if (seenUrls.has(url)) break;
      seenUrls.add(url);

      post("REPLAY_PROGRESS", { page: page + 1, url, method: "GET" });
      let res;
      try {
        res = await nativeFetch(url, { method: "GET", credentials: "include", cache: "no-store" });
      } catch (e) {
        post("REPLAY_ERROR", { url, error: e.message || String(e) });
        break;
      }
      const ct = res.headers.get("content-type") || "";
      const text = await res.clone().text().catch(() => "");
      processImageGenResponse(recipeFromRequest(url), res.url || url, res.status, ct, text);

      const json = parseJson(text);
      const assets = extractAssets(json, res.url || url);
      totalAssets += assets.length;
      const next = cursorFrom(json);
      if (!next || seenCursors.has(next)) break;
      seenCursors.add(next);
      cursor = next;
      if (totalAssets >= Number(maxImages || DEFAULT_MAX_PAGES * DEFAULT_LIMIT)) break;
    }
  }



  async function pageCursorSync(maxImages = DEFAULT_MAX_PAGES * DEFAULT_LIMIT, maxPages = DEFAULT_MAX_PAGES) {
    stopReplay = false;
    const limit = DEFAULT_LIMIT;
    const max = Math.max(limit, Number(maxImages || DEFAULT_MAX_PAGES * DEFAULT_LIMIT));
    const pageMax = Math.max(1, Math.min(Number(maxPages || Math.ceil(max / limit)), Math.ceil(max / limit)));
    await waitForTemplate(5000);
    const baseUrl = lastImageGenFetchTemplate?.baseUrl || "https://chatgpt.com/backend-api/my/recent/image_gen?limit=25";
    let cursor = "";
    let pages = 0;
    let totalAssets = 0;
    let exhausted = false;
    const seenCursors = new Set();
    const seenUrls = new Set();

    post("PAGE_SYNC_TEMPLATE", { hasTemplate: !!lastImageGenFetchTemplate, headerKeys: Object.keys(lastImageGenFetchTemplate?.headers || {}) });

    for (let page = 0; page < pageMax; page++) {
      if (stopReplay) { post("PAGE_SYNC_CANCELLED", { page: page + 1, pages, totalAssets }); break; }
      const u = new URL(baseUrl, location.origin);
      u.searchParams.set("limit", String(limit));
      if (cursor) u.searchParams.set("after", cursor);
      const url = u.href;
      if (seenUrls.has(url)) break;
      seenUrls.add(url);

      post("PAGE_SYNC_PROGRESS", { page: page + 1, url, totalAssets, maxImages: max });
      let res, text = "", ct = "";
      try {
        res = await nativeFetch(url, fetchInitFromTemplate());
        ct = res.headers.get("content-type") || "";
        text = await res.clone().text().catch(() => "");
      } catch (e) {
        post("PAGE_SYNC_ERROR", { page: page + 1, url, error: e.message || String(e), pages, totalAssets });
        break;
      }

      if (!res || !res.ok) {
        post("PAGE_SYNC_ERROR", { page: page + 1, url, status: res && res.status, contentType: ct, error: `HTTP ${res && res.status}`, pages, totalAssets });
        break;
      }

      const json = parseJson(text);
      if (!json) {
        post("PAGE_SYNC_ERROR", { page: page + 1, url, status: res.status, contentType: ct, error: "JSON parse failed", pages, totalAssets });
        break;
      }

      const assets = extractAssets(json, res.url || url).slice(0, Math.max(0, max - totalAssets));
      const next = cursorFrom(json);
      pages += 1;
      totalAssets += assets.length;

      post("PAGE_SYNC_PAGE", {
        page: page + 1,
        url: res.url || url,
        status: res.status,
        contentType: ct,
        assets,
        count: assets.length,
        cursor: next,
        totalAssets,
        maxImages: max,
        hasNext: !!next
      });

      if (!next) { exhausted = true; break; }
      if (seenCursors.has(next)) break;
      seenCursors.add(next);
      cursor = next;
      if (totalAssets >= max) break;
    }

    post("PAGE_SYNC_DONE", { pages, totalAssets, maxImages: max, exhausted, cancelled: stopReplay });
  }



  // v2.13 experimental: ChatGPT generation-window watcher.
  // Observes visible DOM artifacts only: img/src, CSS background-image, blob markers,
  // canvas presence, file_ ids, and estuary URLs. It catalogues only normal downloadable
  // ChatGPT full estuary URLs; blob/canvas are debug markers, not forced downloads.
  let generationWatchObserver = null;
  let generationWatchEnabled = false;
  let generationWatchTimer = null;
  let generationWatchLastSignature = "";
  const generationSeenUrls = new Set();

  function isChatGptHost() {
    return /(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$/i.test(location.hostname || "");
  }

  function cssUrls(value) {
    const out = [];
    const text = String(value || "");
    const re = /url\((['"]?)(.*?)\1\)/gi;
    let m;
    while ((m = re.exec(text))) if (m[2]) out.push(m[2]);
    return out;
  }

  function generationUrlKind(raw) {
    const value = String(raw || "").trim();
    if (!value) return "empty";
    if (/^blob:/i.test(value)) return "blob";
    if (/^data:image\//i.test(value)) return "data";
    try {
      const u = new URL(value, location.href);
      if (/\/backend-api\/estuary\/content$/.test(u.pathname) && /^file_[A-Za-z0-9_\-]+$/.test(u.searchParams.get("id") || "")) return "estuary";
      if (/file_[A-Za-z0-9_\-]+/.test(u.href)) return "file-marker";
      if (/oaiusercontent\.com|oaidalle|openai|chatgpt/i.test(u.hostname + u.pathname) && /\.(png|jpe?g|webp)(?:[?#]|$)/i.test(u.pathname)) return "image-url";
      if (/\.(png|jpe?g|webp)(?:[?#]|$)/i.test(u.pathname)) return "generic-image";
    } catch (_) {}
    return "other";
  }

  function generationAssetFromUrl(raw, source, prompt) {
    const value = abs(raw);
    if (!looksLikeEstuarySource(value)) return null;
    const key = `${source}|${value}`;
    if (generationSeenUrls.has(key)) return null;
    generationSeenUrls.add(key);
    return {
      source: "chatgpt",
      kind: "image",
      url: value,
      previewUrl: value,
      prompt: prompt || "ChatGPT generation-window image",
      createdAt: nowIso(),
      sourceApi: location.href,
      contextId: "generation-window",
      fileId: (value.match(/[?&]id=(file_[A-Za-z0-9_\-]+)/) || [])[1] || "",
      keyName: `generation_window.${source}`,
      extHint: "png",
      capturedAt: nowIso()
    };
  }

  function nearGenerationWindow(el) {
    try {
      const text = String((el.closest('[role="dialog"], [data-testid], main, article') || document.body).textContent || "").slice(0, 3000).toLowerCase();
      if (/generating|creating|image|download|вариант|variation|edit|select|moderated|removed|policy|content/.test(text)) return true;
      if (el.closest('[role="dialog"]')) return true;
    } catch (_) {}
    return false;
  }

  function scanGenerationWindow() {
    if (!generationWatchEnabled || !isChatGptHost()) return;
    const urls = [];
    const assets = [];
    let imgCount = 0, backgroundCount = 0, canvasCount = 0, blobCount = 0, estuaryCount = 0, downloadableCount = 0;

    const nodes = Array.from(document.querySelectorAll('img, video, source, canvas, [style]'));
    for (const el of nodes) {
      if (!nearGenerationWindow(el)) continue;
      if (el.tagName === 'CANVAS') { canvasCount += 1; continue; }
      const direct = [el.getAttribute && el.getAttribute('src'), el.currentSrc, el.poster, el.getAttribute && el.getAttribute('data-src')].filter(Boolean);
      if (el.getAttribute && el.getAttribute('srcset')) {
        for (const part of String(el.getAttribute('srcset')).split(',')) {
          const u = part.trim().split(/\s+/)[0];
          if (u) direct.push(u);
        }
      }
      try { const bg = cssUrls(getComputedStyle(el).backgroundImage); backgroundCount += bg.length; for (const u of bg) direct.push(u); } catch (_) {}
      try { const bg = cssUrls(el.getAttribute && el.getAttribute('style')); backgroundCount += bg.length; for (const u of bg) direct.push(u); } catch (_) {}
      for (const raw of direct) {
        const kind = generationUrlKind(raw);
        if (kind === "empty" || kind === "other") continue;
        const absUrl = kind === "blob" || kind === "data" ? String(raw) : abs(raw);
        urls.push(absUrl);
        if (kind === "blob") blobCount += 1;
        if (kind === "estuary") estuaryCount += 1;
        if (el.tagName === 'IMG') imgCount += 1;
        if (kind === "estuary" || kind === "image-url" || kind === "generic-image") downloadableCount += 1;
        const asset = generationAssetFromUrl(raw, el.tagName.toLowerCase(), document.title || "ChatGPT generation-window image");
        if (asset) assets.push(asset);
      }
    }

    // Text scan catches file_ ids even when React keeps them in attributes/text but not as URLs.
    const htmlSample = String(document.body?.innerHTML || "").slice(0, 120000);
    const fileIds = new Set((htmlSample.match(/file_[A-Za-z0-9_\-]+/g) || []).slice(0, 80));
    // Keep file_ ids as diagnostics only. We catalogue actual full estuary URLs from src/backgrounds,
    // not synthesized URLs from arbitrary ids, because some ids are metadata/revoked pointers.

    if (!urls.length && !fileIds.size && !canvasCount && !assets.length) return;
    const uniqueUrls = Array.from(new Set(urls)).slice(0, 8);
    const signature = JSON.stringify({ u: uniqueUrls, f: Array.from(fileIds).slice(0, 8), c: canvasCount, a: assets.length });
    if (signature === generationWatchLastSignature) return;
    generationWatchLastSignature = signature;
    const sample = uniqueUrls[0] || (fileIds.size ? Array.from(fileIds)[0] : (canvasCount ? "canvas" : ""));
    post("GENERATION_WATCH", {
      phase: "dom-scan",
      summary: `img ${imgCount} · bg ${backgroundCount} · blob ${blobCount} · canvas ${canvasCount} · file ids ${fileIds.size} · estuary ${estuaryCount} · downloadable ${downloadableCount}`,
      imgCount,
      backgroundCount,
      blobCount,
      canvasCount,
      fileIds: fileIds.size,
      estuaryCount,
      downloadableCount,
      sample: String(sample).slice(0, 500),
      assets,
      capturedAt: nowIso()
    });
  }

  function scheduleGenerationScan(delay = 200) {
    if (!generationWatchEnabled) return;
    clearTimeout(generationWatchTimer);
    generationWatchTimer = setTimeout(scanGenerationWindow, delay);
  }

  function startGenerationWatch() {
    if (!isChatGptHost()) return;
    generationWatchEnabled = true;
    if (!generationWatchObserver) {
      generationWatchObserver = new MutationObserver(() => scheduleGenerationScan(180));
      generationWatchObserver.observe(document.documentElement || document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["src", "srcset", "style", "poster", "data-src", "class", "aria-label"]
      });
    }
    post("GENERATION_WATCH", { phase: "started", summary: "Generation Window Watch started", capturedAt: nowIso() });
    scheduleGenerationScan(50);
  }

  function stopGenerationWatch() {
    generationWatchEnabled = false;
    clearTimeout(generationWatchTimer);
    if (generationWatchObserver) {
      generationWatchObserver.disconnect();
      generationWatchObserver = null;
    }
    post("GENERATION_WATCH", { phase: "stopped", summary: "Generation Window Watch stopped", capturedAt: nowIso() });
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    const data = event.data || {};
    if (data.source !== HOST_SOURCE) return;
    if (data.type === "START_GENERATION_WATCH") {
      startGenerationWatch();
      return;
    }
    if (data.type === "STOP_GENERATION_WATCH") {
      stopGenerationWatch();
      return;
    }
    if (data.type === "START_LIVE_CAPTURE") {
      startLiveCapture();
      return;
    }
    if (data.type === "STOP_LIVE_CAPTURE") {
      stopLiveCapture();
      return;
    }
    if (data.type === "STOP_REPLAY") {
      stopReplay = true;
      post("REPLAY_CANCELLED", { reason: "user" });
      return;
    }
    if (data.type === "GROK_IMAGINE_CONVERSATION_SYNC_V20") {
      await grokImagineConversationHistorySync(Number(data.maxImages || 9500), Number(data.maxPages || 300));
      return;
    }
    if (data.type === "GROK_ASSET_HISTORY_SYNC_V20") {
      await grokImagineAllAssetHistorySync(Number(data.maxImages || 9500), Number(data.maxPages || 300));
      return;
    }
    if (data.type === "GROK_PAGE_FEED_SYNC_V20") {
      await grokPageFeedSync(Number(data.maxImages || 7500), Number(data.maxPages || 300));
      return;
    }
    if (data.type === "PAGE_CURSOR_SYNC_V20") {
      await pageCursorSync(Number(data.maxImages || DEFAULT_MAX_PAGES * DEFAULT_LIMIT), Number(data.maxPages || DEFAULT_MAX_PAGES));
      return;
    }
    if (data.type === "REPLAY_RECIPES") {
      const recipes = Array.isArray(data.recipes) && data.recipes.length ? data.recipes : [{ url: "https://chatgpt.com/backend-api/my/recent/image_gen?limit=25" }];
      post("REPLAY_STARTED", { count: recipes.length });
      for (const recipe of recipes.slice(0, 1)) await replayImageGen(recipe, Number(data.maxPages || DEFAULT_MAX_PAGES), Number(data.maxImages || DEFAULT_MAX_PAGES * DEFAULT_LIMIT));
      post("REPLAY_DONE", { count: recipes.length });
    }
  });

  post("HOOK_READY", { href: location.href, at: nowIso() });
})();
