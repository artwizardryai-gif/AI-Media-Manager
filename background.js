const STORAGE = {
  catalog: "cgpt_scraper_catalog_v3",
  statuses: "cgpt_scraper_statuses_v3",
  recipes: "cgpt_scraper_recipes_v3",
  events: "cgpt_scraper_events_v3",
  settings: "cgpt_scraper_settings_v3",
  collections: "cgpt_scraper_collections_v1",
  itemCollections: "cgpt_scraper_item_collections_v1",
  ratings: "cgpt_scraper_ratings_v1",
  storyboards: "cgpt_scraper_storyboards_v1",
  canvases: "cgpt_scraper_canvases_v1"
};

const DEFAULT_SETTINGS = {
  folder: "ChatGPT-Images",
  archiveFolder: "ChatGPT-Images/archives",
  maxReplayPages: 300,
  maxImages: 7500,
  zipPartMb: 1500,
  folderStructure: "flat",
  viewMode: "grid",
  pageMode: "infinite",
  pageSize: 100,
  gridSize: "medium",
  gridScale: 100,
  chooseFolderOnce: true,
  activeSource: "chatgpt",
  localFolderLabel: "",
  localFolderPath: "",
  localRootId: "",
  localRoots: [],
  localViewMode: "folder",
  localMaxFiles: 3500,
  localFolderBarPinned: false,
  thumbnailCache: true,
  thumbnailCacheAutoBuild: true,
  thumbnailCacheFullGrid: false,
  thumbnailCacheQuality: "medium",
  grokMode: "imagen",
  grokMedia: "both",
  grokVideoThumbs: false,
  collectionFilter: "all",
  hiddenMainViewCollections: [],
  storyboardActiveId: "",
  storyboardView: false,
  canvasActiveId: "",
  canvasView: false,
  liveCapture: false,
  generationWatch: false
};

let cancelSyncRequested = false;
const CONTENT_SYNC_VERSION = "2.1.0";

const getStore = (keys) => chrome.storage.local.get(keys);
const setStore = (obj) => chrome.storage.local.set(obj);

function sanitizeSegment(name, fallback = "asset") {
  return String(name || fallback)
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || fallback;
}

function sanitizePath(path) {
  return String(path || "asset")
    .split(/[\\/]+/)
    .filter(Boolean)
    .map(part => sanitizeSegment(part, "folder"))
    .join("/") || "asset";
}


function sanitizeOrganizerCollections(input) {
  const out = {};
  const src = input && typeof input === "object" ? input : {};
  for (const [rawId, rawCol] of Object.entries(src)) {
    const id = String(rawId || rawCol?.id || "").slice(0, 128);
    if (!id) continue;
    const name = String(rawCol?.name || "Untitled").trim().slice(0, 80) || "Untitled";
    const color = String(rawCol?.color || "#38bdf8").slice(0, 32);
    out[id] = {
      id,
      name,
      color,
      createdAt: rawCol?.createdAt || new Date().toISOString(),
      updatedAt: rawCol?.updatedAt || rawCol?.createdAt || new Date().toISOString()
    };
  }
  return out;
}

function sanitizeOrganizerItemCollections(input, collections) {
  const out = {};
  const src = input && typeof input === "object" ? input : {};
  const known = new Set(Object.keys(collections || {}));
  for (const [rawItemId, rawIds] of Object.entries(src)) {
    const itemId = String(rawItemId || "");
    if (!itemId) continue;
    const ids = Array.from(new Set((Array.isArray(rawIds) ? rawIds : [])
      .map(id => String(id || "").slice(0, 128))
      .filter(id => id && known.has(id))));
    if (ids.length) out[itemId] = ids;
  }
  return out;
}


function sanitizeStoryboards(input) {
  const out = {};
  const src = input && typeof input === "object" ? input : {};
  for (const [rawId, rawBoard] of Object.entries(src)) {
    const id = String(rawId || rawBoard?.id || "").slice(0, 128);
    if (!id) continue;
    const name = String(rawBoard?.name || "Storyboard").trim().slice(0, 80) || "Storyboard";
    const rawItems = Array.isArray(rawBoard?.items) ? rawBoard.items : [];
    const items = rawItems.map(entry => {
      const itemId = String((entry && typeof entry === "object" ? entry.id : entry) || "").slice(0, 160);
      if (!itemId) return null;
      return {
        id: itemId,
        note: String(entry?.note || "").slice(0, 500),
        fit: ["fit", "fill"].includes(entry?.fit) ? entry.fit : "fit"
      };
    }).filter(Boolean).slice(0, 2000);
    out[id] = {
      id,
      name,
      items,
      createdAt: rawBoard?.createdAt || new Date().toISOString(),
      updatedAt: rawBoard?.updatedAt || rawBoard?.createdAt || new Date().toISOString()
    };
  }
  return out;
}


function sanitizeCanvases(input) {
  const out = {};
  const src = input && typeof input === "object" ? input : {};
  for (const [rawId, rawCanvas] of Object.entries(src)) {
    const id = String(rawId || rawCanvas?.id || "").slice(0, 128);
    if (!id) continue;
    const name = String(rawCanvas?.name || "Canvas").trim().slice(0, 80) || "Canvas";
    const rawPanels = Array.isArray(rawCanvas?.panels) ? rawCanvas.panels : [];
    const panels = rawPanels.map((panel, index) => {
      const itemId = String(panel?.itemId || panel?.id || "").slice(0, 160);
      if (!itemId) return null;
      const num = (v, fallback, min, max) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
      };
      return {
        id: String(panel?.id || `panel_${index}`).slice(0, 128),
        itemId,
        x: num(panel?.x, 6, 0, 98),
        y: num(panel?.y, 6, 0, 98),
        w: num(panel?.w, 40, 5, 100),
        h: num(panel?.h, 22, 5, 100),
        z: Math.floor(num(panel?.z, index + 1, -100000, 100000)),
        fit: panel?.fit === "fill" ? "fill" : "fit",
        cropX: num(panel?.cropX, 50, 0, 100),
        cropY: num(panel?.cropY, 50, 0, 100),
        cropZoom: Math.round(num(panel?.cropZoom, 1, 1, 3) * 100) / 100
      };
    }).filter(Boolean).slice(0, 200);
    out[id] = {
      id,
      name,
      page: rawCanvas?.page || { kind: "portrait", ratio: "3:4" },
      panels,
      createdAt: rawCanvas?.createdAt || new Date().toISOString(),
      updatedAt: rawCanvas?.updatedAt || rawCanvas?.createdAt || new Date().toISOString()
    };
  }
  return out;
}

function normalizeOrganizerRatings(input = {}) {
  const out = {};
  for (const [id, value] of Object.entries(input || {})) {
    const n = Math.round(Number(value) * 10) / 10;
    if (!id || !Number.isFinite(n)) continue;
    if (n >= 1 && n <= 5) out[String(id)] = Math.max(1, Math.min(5, n));
  }
  return out;
}

async function sha256(text) {
  try {
    const enc = new TextEncoder().encode(String(text || ""));
    const hash = await crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 20);
  } catch (_) {
    let h = 0;
    const s = String(text || "");
    for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i) | 0;
    return Math.abs(h).toString(16);
  }
}

function dateOnly(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function extFromCandidate(raw) {
  const s = `${raw?.url || ""} ${raw?.extHint || ""} ${raw?.mimeType || ""} ${raw?.kind || ""}`.toLowerCase();
  if (/video\/mp4|\.mp4(?:[?#]|$)|\bmp4\b|\bvideo\b/.test(s)) return "mp4";
  if (/image\/png|\.png(?:[?#]|$)|\bpng\b/.test(s)) return "png";
  if (/image\/jpe?g|\.jpe?g(?:[?#]|$)|\bjpg\b|\bjpeg\b/.test(s)) return "jpg";
  if (/image\/webp|\.webp(?:[?#]|$)|\bwebp\b/.test(s)) return "webp";
  return "png";
}

function hardRejectUrl(raw, key = "") {
  const u = String(raw || "").toLowerCase();
  const k = String(key || "").toLowerCase();
  if (!u) return true;
  try {
    const parsed = new URL(String(raw));
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:" && parsed.protocol !== "data:" && parsed.protocol !== "blob:") return true;
  } catch (_) { return true; }
  if (u.startsWith("chrome-extension:")) return true;
  if (/\.svg(?:[?#]|$)|image\/svg|\.html?(?:[?#]|$)|\.json(?:[?#]|$)|text\/html|application\/json/.test(u)) return true;
  if (/oaistatic\.com|\/_next\/static\/|\/assets\/|favicon|sprite|mask-icon|manifest\.webmanifest/.test(u)) return true;
  const isGrokGeneratedAsset = /assets\.grok\.com\/users\/[^/]+\/generated\/[^/]+\//.test(u);
  if (/avatar|profile|icon|logo|brand|company|openai-logo|apple-touch-icon/.test(u)) return true;
  if (!isGrokGeneratedAsset && /avatar|profile|icon|logo|brand|company|filter|preset|template|style-suggestion|thumbnail|thumb|preview|small|placeholder/.test(k)) return true;
  return false;
}

function stableKey(raw) {
  const url = String(raw?.url || "");
  const explicit = raw?.sourceId || raw?.fileId || "";
  if (explicit) return `${raw?.source || "chatgpt"}:${explicit}`;
  const m = url.match(/file[-_][A-Za-z0-9_-]+/);
  if (m) return m[0];
  try {
    const u = new URL(url);
    if (u.hostname.includes("oaiusercontent.com") || u.hostname.includes("openai.com") || u.hostname.includes("chatgpt.com")) {
      u.search = "";
      u.hash = "";
      return u.href;
    }
  } catch (_) {}
  return `${raw?.contextId || ""}|${url.split("#")[0]}`;
}

function canonicalizeRecipe(recipe) {
  const out = { ...(recipe || {}) };
  try {
    const u = new URL(out.url);
    if (/\/backend-api\/my\/recent\/image_gen$/.test(u.pathname)) {
      u.searchParams.set("limit", u.searchParams.get("limit") || "25");
      u.searchParams.delete("after");
      u.searchParams.delete("cursor");
      out.url = u.href;
      out.method = "GET";
      out.body = "";
      out.contentType = "";
    }
  } catch (_) {}
  return out;
}

function recipeFingerprint(recipe) {
  try {
    const u = new URL(recipe.url);
    const path = u.origin + u.pathname;
    let bodyShape = "";
    try {
      const obj = JSON.parse(recipe.body || "{}");
      bodyShape = JSON.stringify(Object.keys(obj).sort());
    } catch (_) {
      bodyShape = String(recipe.body || "").slice(0, 80);
    }
    return `${recipe.method || "GET"} ${path} ${bodyShape}`;
  } catch (_) {
    return `${recipe.method || "GET"} ${recipe.url || ""} ${String(recipe.body || "").slice(0, 80)}`;
  }
}


function nowIso() { return new Date().toISOString(); }

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
    const u = new URL(String(raw || ""), "https://chatgpt.com");
    if (!/\/backend-api\/estuary\/content$/.test(u.pathname)) return false;
    const id = u.searchParams.get("id") || "";
    return /^file_[A-Za-z0-9_-]+$/.test(id);
  } catch (_) { return false; }
}

function safePreviewUrl(raw) {
  try {
    const u = new URL(String(raw || ""), "https://chatgpt.com");
    const s = u.href.toLowerCase();
    if (/\.svg(?:[?#]|$)|\.html?(?:[?#]|$)|\.json(?:[?#]|$)|oaistatic\.com|\/_next\/static\/|avatar|profile|icon|logo|favicon|sprite/.test(s)) return "";
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

    const sourceUrl = safePreviewUrl(item.url || "");
    if (!looksLikeEstuarySource(sourceUrl)) continue;
    if (seen.has(sourceUrl)) continue;
    seen.add(sourceUrl);
    const thumb = safePreviewUrl(item?.encodings?.thumbnail?.path || "");
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

function cursorFromImageGen(json) {
  const c = json && typeof json === "object" ? json.cursor : "";
  return typeof c === "string" && c ? c : "";
}

function grokAbs(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("users/")) return `https://assets.grok.com/${value}`;
  if (value.startsWith("/")) return `https://grok.com${value}`;
  return value;
}

function grokKindFrom(item) {
  const mt = String(item?.mediaType || item?.mimeType || item?.type || "").toLowerCase();
  if (mt.includes("video") || mt.includes("mp4")) return "video";
  return "image";
}

function extractGrokPostAssets(json, apiUrl, mediaFilter = "both") {
  const out = [];
  const seen = new Set();
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
          source: "grok",
          grokMode: "imagen",
          kind,
          sourceId: item.id || key,
          postId: item.id || parentPost?.id || "",
          url,
          previewUrl: grokAbs(item.thumbnailImageUrl || (kind === "image" ? url : "")),
          mimeType,
          extHint: mimeType || url,
          prompt: item.prompt || item.originalPrompt || parentPost?.prompt || parentPost?.originalPrompt || (kind === "video" ? "Grok video" : "Grok image"),
          createdAt: coerceDate(item.createTime || item.createdAt || parentPost?.createTime) || nowIso(),
          sourceApi: apiUrl || "",
          contextId: item.originalPostId || parentPost?.id || "",
          keyName: "grok.post.mediaUrl",
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

function nextGrokCursor(json) {
  const c = json && typeof json === "object" ? (json.nextCursor || json.cursor || "") : "";
  return typeof c === "string" || typeof c === "number" ? String(c || "") : "";
}

function safeBoardName(name, id) {
  const base = sanitizeSegment(name || "", "").replace(/\s+/g, "_").slice(0, 80);
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
    if (typeof raw === "string") {
      try { out.push(JSON.parse(raw)); } catch (_) {}
    } else if (raw && typeof raw === "object") out.push(raw);
  }
  return out;
}

function extractGrokBoardAssetsFromResponses(json, board, apiUrl, mediaFilter = "both") {
  const out = [];
  const seen = new Set();
  const allowImage = mediaFilter === "both" || mediaFilter === "images";
  const allowVideo = mediaFilter === "both" || mediaFilter === "videos";
  const boardFolder = `Grok/Boards/${safeBoardName(board?.name, board?.id)}`;
  const responses = collectObjects(json, o => Array.isArray(o.cardAttachmentsJson));
  for (const response of responses) {
    const cards = parseCardJsonList(response.cardAttachmentsJson);
    for (const card of cards) {
      const candidates = [];
      if (card?.type === "imagine_image_to_image" || card?.cardType === "generated_image_card") {
        const chunk = card.image_chunk || card.imageChunk || {};
        const url = grokAbs(chunk.imageUrl || "");
        if (url && !/-part-\d+\//.test(url) && allowImage) {
          candidates.push({ kind: "image", url, mimeType: "image/jpeg", sourceId: chunk.imageUuid || card.id || url, prompt: chunk?.imagePrompt?.prompt || response.message || "Grok board image", createdAt: response.createTime, width: chunk?.resolution?.width || card?.resolution?.width, height: chunk?.resolution?.height || card?.resolution?.height });
        }
      }
      if (card?.type === "render_imagine_media" || card?.cardType === "rendered_file_card") {
        const url = grokAbs(card.url || card.fileUrl || "");
        const mimeType = String(card.mime_type || card.mimeType || "");
        const kind = /video|mp4/i.test(`${mimeType} ${url}`) ? "video" : "image";
        if (url && ((kind === "image" && allowImage) || (kind === "video" && allowVideo))) {
          candidates.push({ kind, url, mimeType, sourceId: card.id || url, prompt: card.file_name || response.message || (kind === "video" ? "Grok board video" : "Grok board image"), createdAt: response.createTime });
        }
      }
      for (const c of candidates) {
        if (!c.url) continue;
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
          prompt: c.prompt || (c.kind === "video" ? "Grok board video" : "Grok board image"),
          createdAt: coerceDate(c.createdAt || board?.updatedAt || board?.createdAt) || nowIso(),
          sourceApi: apiUrl || "",
          contextId: response.responseId || "",
          conversationId: response.conversationId || "",
          boardId: board?.id || "",
          boardName: board?.name || "",
          keyName: "grok.board.cardAttachmentsJson",
          capturedAt: nowIso(),
          width: Number(c.width || 0),
          height: Number(c.height || 0),
          folderPrefix: boardFolder
        });
      }
    }
  }
  return out;
}

async function normalizeAsset(raw, settings) {
  if (!raw || !raw.url || hardRejectUrl(raw.url, raw.keyName)) return null;
  const key = stableKey(raw);
  const id = await sha256(key);
  const ext = extFromCandidate(raw);
  const createdDay = dateOnly(raw.createdAt || raw.capturedAt);
  const source = raw.source || "chatgpt";
  const kind = raw.kind || (ext === "mp4" ? "video" : "image");
  const prompt = String(raw.prompt || (source === "grok" ? `Grok ${kind}` : "ChatGPT image")).replace(/\s+/g, " ").trim().slice(0, 280) || (source === "grok" ? `Grok ${kind}` : "ChatGPT image");
  const title = sanitizeSegment(prompt, source === "grok" ? `grok_${kind}` : "chatgpt_image").replace(/\s+/g, "_").slice(0, 80);
  const baseFolder = sanitizePath(settings.folder || DEFAULT_SETTINGS.folder);
  const fixedFolder = raw.folderPrefix ? sanitizePath(raw.folderPrefix) : "";
  const filenameBase = `${createdDay}_${id}_${title}.${ext}`;
  const filename = fixedFolder ? `${fixedFolder}/${filenameBase}` : `${baseFolder}/${createdDay}/${filenameBase}`;
  return {
    id,
    stableKey: key,
    source,
    grokMode: raw.grokMode || "",
    kind,
    url: raw.url,
    previewUrl: raw.previewUrl && !/\.svg(?:[?#]|$)|\.html?(?:[?#]|$)|\.json(?:[?#]|$)|oaistatic\.com|\/_next\/static\/|avatar|profile|icon|logo|favicon|sprite/i.test(String(raw.previewUrl).toLowerCase()) ? raw.previewUrl : raw.url,
    ext,
    mimeType: raw.mimeType || "",
    filename,
    fixedFolder,
    prompt,
    title: raw.title || prompt,
    createdAt: raw.createdAt || raw.capturedAt || new Date().toISOString(),
    sourceApi: raw.sourceApi || "",
    contextId: raw.contextId || "",
    sourceId: raw.sourceId || "",
    postId: raw.postId || "",
    boardId: raw.boardId || "",
    boardName: raw.boardName || "",
    conversationId: raw.conversationId || raw.conversation_id || "",
    messageId: raw.messageId || raw.message_id || "",
    transformationId: raw.transformationId || raw.transformation_id || "",
    duration: raw.duration || 0,
    resolutionName: raw.resolutionName || "",
    width: Number(raw.width || 0),
    height: Number(raw.height || 0),
    keyName: raw.keyName || "",
    capturedAt: raw.capturedAt || new Date().toISOString(),
    validation: "unvalidated"
  };
}

async function mergeAssets(rawAssets) {
  if (!Array.isArray(rawAssets) || !rawAssets.length) return { added: 0, updated: 0 };
  const store = await getStore([STORAGE.catalog, STORAGE.statuses, STORAGE.settings]);
  const catalog = store[STORAGE.catalog] || {};
  const statuses = store[STORAGE.statuses] || {};
  const settings = { ...DEFAULT_SETTINGS, ...(store[STORAGE.settings] || {}) };
  let added = 0, updated = 0;
  for (const raw of rawAssets) {
    const asset = await normalizeAsset(raw, settings);
    if (!asset) continue;
    if (catalog[asset.id]) {
      catalog[asset.id] = { ...catalog[asset.id], ...asset, firstSeenAt: catalog[asset.id].firstSeenAt || asset.capturedAt };
      updated += 1;
    } else {
      catalog[asset.id] = { ...asset, firstSeenAt: new Date().toISOString() };
      statuses[asset.id] = statuses[asset.id] || { state: "missing", error: "" };
      added += 1;
    }
  }
  await setStore({ [STORAGE.catalog]: catalog, [STORAGE.statuses]: statuses });
  return { added, updated };
}

async function mergeRecipe(recipe, pagination = {}) {
  recipe = canonicalizeRecipe(recipe);
  if (!recipe || !recipe.url) return false;
  if (!/\/backend-api\/my\/recent\/image_gen(?:\?|$)/.test(recipe.url)) return false;
  const store = await getStore([STORAGE.recipes]);
  const recipes = store[STORAGE.recipes] || {};
  const fp = recipeFingerprint(recipe);
  recipes[fp] = {
    ...(recipes[fp] || {}),
    ...recipe,
    fingerprint: fp,
    pagination,
    lastSeenAt: new Date().toISOString(),
    seenCount: (recipes[fp]?.seenCount || 0) + 1
  };
  await setStore({ [STORAGE.recipes]: recipes });
  return true;
}

async function logEvent(event) {
  const store = await getStore([STORAGE.events]);
  const events = store[STORAGE.events] || [];
  events.push({ at: new Date().toISOString(), ...event });
  while (events.length > 200) events.shift();
  await setStore({ [STORAGE.events]: events });
}

function isChatGPTImagesUrl(url = "") {
  try {
    const u = new URL(url);
    return (u.hostname === "chatgpt.com" || u.hostname === "chat.openai.com") && /\/images(?:$|[/?#])/.test(u.pathname + u.search + u.hash);
  } catch (_) { return false; }
}

function isGrokUrl(url = "") {
  try { return new URL(url).hostname === "grok.com"; } catch (_) { return false; }
}
function isGrokImagineUrl(url = "") {
  try {
    const u = new URL(url);
    return u.hostname === "grok.com" && /\/imagine(?:$|[/?#])/.test(u.pathname + u.search + u.hash);
  } catch (_) { return false; }
}

async function focusTab(tab) {
  if (!tab || !tab.id) return tab;
  try { if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true }); } catch (_) {}
  try { return await chrome.tabs.update(tab.id, { active: true }); } catch (_) { return tab; }
}

async function findOrOpenImagesTab(active = false) {
  // chrome.tabs.query path wildcards can be unreliable with SPA routes, so query broadly and parse URLs ourselves.
  const tabs = await chrome.tabs.query({ url: ["https://chatgpt.com/*", "https://chat.openai.com/*"] });
  const imagesTab = tabs.find(t => isChatGPTImagesUrl(t.url || ""));
  if (imagesTab) {
    if (active) return await focusTab(imagesTab);
    return imagesTab;
  }
  const created = await chrome.tabs.create({ url: "https://chatgpt.com/images", active: !!active });
  if (active) await focusTab(created);
  return created;
}

async function findChatGPTTabsOrOpenImages(active = false) {
  const tabs = await chrome.tabs.query({ url: ["https://chatgpt.com/*", "https://chat.openai.com/*"] });
  const imageTabs = tabs.filter(t => isChatGPTImagesUrl(t.url || ""));
  if (imageTabs.length) {
    if (active) imageTabs[0] = await focusTab(imageTabs[0]);
    return imageTabs;
  }
  const created = await chrome.tabs.create({ url: "https://chatgpt.com/images", active: !!active });
  return [created];
}


async function findOrOpenGrokTab(active = false, mode = "imagen") {
  const targetUrl = mode === "boards" ? "https://grok.com/imagine/saved" : "https://grok.com/imagine/saved";
  const tabs = await chrome.tabs.query({ url: ["https://grok.com/*"] });
  const grokTab = tabs.find(t => isGrokImagineUrl(t.url || "")) || tabs.find(t => isGrokUrl(t.url || ""));
  if (grokTab) {
    if (active) return await focusTab(grokTab);
    return grokTab;
  }
  const created = await chrome.tabs.create({ url: targetUrl, active: !!active });
  if (active) await focusTab(created);
  return created;
}


async function ensureSourceTab(source = "chatgpt", options = {}) {
  const src = source === "grok" ? "grok" : "chatgpt";
  const mode = options.mode || "imagen";
  const active = !!options.active;
  const tab = src === "grok" ? await findOrOpenGrokTab(active, mode) : await findOrOpenImagesTab(active);
  if (!tab?.id) return { ok: false, source: src, error: "tab unavailable" };
  try {
    const current = await chrome.tabs.get(tab.id);
    if (current?.discarded) await chrome.tabs.reload(tab.id);
  } catch (_) {}
  try { await waitForTabComplete(tab.id, Number(options.timeoutMs || 25000)); } catch (_) {}
  const content = await ensureContent(tab.id);
  await logEvent({ type: content ? "source_tab_ready" : "source_tab_content_unavailable", source: src, mode, tabId: tab.id });
  return { ok: true, source: src, mode, tabId: tab.id, content };
}

async function findReplayTab(options = {}) {
  // For sync we prefer a fresh /images tab. Reusing old SPA tabs can leave stale
  // content scripts/hooks attached and is what caused the “only loaded items” behavior.
  const fresh = !!options.fresh;
  const active = !!options.active;
  if (fresh) {
    const tab = await chrome.tabs.create({ url: "https://chatgpt.com/images", active });
    if (active) await focusTab(tab);
    return tab;
  }
  const tab = await findOrOpenImagesTab(active);
  try {
    const current = await chrome.tabs.get(tab.id);
    if (!isChatGPTImagesUrl(current.url || "")) {
      await chrome.tabs.update(tab.id, { url: "https://chatgpt.com/images", active });
    }
  } catch (_) {}
  return tab;
}

async function waitForTabComplete(tabId, timeoutMs = 20000) {
  const existing = await chrome.tabs.get(tabId).catch(() => null);
  if (existing && existing.status === "complete") return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(false);
    }, timeoutMs);
    const listener = (id, changeInfo) => {
      if (id === tabId && changeInfo.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(true);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function ensureContent(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: "PING_CONTENT_V20" });
    if (res?.ok && res.version === CONTENT_SYNC_VERSION) return true;
  } catch (_) {}
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: false }, files: ["content.js"] });
    const res = await chrome.tabs.sendMessage(tabId, { type: "PING_CONTENT_V20" });
    return !!(res?.ok && res.version === CONTENT_SYNC_VERSION);
  } catch (_) {
    return false;
  }
}

async function directSyncImageGen(maxImages) {
  const limit = 25;
  const maxPages = Math.max(1, Math.ceil(Number(maxImages || DEFAULT_SETTINGS.maxImages) / limit));
  let cursor = "";
  let pages = 0;
  let totalAdded = 0;
  let totalUpdated = 0;
  let totalAssets = 0;
  let lastCursor = "";
  let exhausted = false;
  let maxReached = false;
  const seenCursors = new Set();
  const seenUrls = new Set();

  for (let page = 0; page < maxPages; page++) {
    if (cancelSyncRequested) { await logEvent({ type: "direct_sync_cancelled", page: page + 1 }); break; }
    const u = new URL("https://chatgpt.com/backend-api/my/recent/image_gen");
    u.searchParams.set("limit", String(limit));
    if (cursor) u.searchParams.set("after", cursor);
    const url = u.href;
    if (seenUrls.has(url)) break;
    seenUrls.add(url);
    await logEvent({ type: "direct_sync_progress", page: page + 1, api: url });

    let res;
    try {
      res = await fetch(url, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: { "accept": "application/json, text/plain, */*" }
      });
    } catch (e) {
      await logEvent({ type: "direct_sync_error", page: page + 1, api: url, error: e.message || String(e) });
      return { ok: false, pages, added: totalAdded, updated: totalUpdated, assets: totalAssets, error: e.message || String(e), needsPageFallback: true };
    }

    const contentType = res.headers.get("content-type") || "";
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      await logEvent({ type: "direct_sync_error", page: page + 1, status: res.status, contentType, api: url });
      return { ok: false, pages, added: totalAdded, updated: totalUpdated, assets: totalAssets, error: `HTTP ${res.status}`, needsPageFallback: true };
    }
    if (!/json|text|javascript/i.test(contentType) || /^\s*</.test(text)) {
      await logEvent({ type: "direct_sync_error", page: page + 1, status: res.status, contentType, api: url, error: "not JSON" });
      return { ok: false, pages, added: totalAdded, updated: totalUpdated, assets: totalAssets, error: "not JSON/auth page", needsPageFallback: true };
    }

    let json;
    try { json = JSON.parse(text); }
    catch (e) {
      await logEvent({ type: "direct_sync_error", page: page + 1, api: url, error: "JSON parse failed" });
      return { ok: false, pages, added: totalAdded, updated: totalUpdated, assets: totalAssets, error: "JSON parse failed", needsPageFallback: true };
    }

    const assets = extractImageGenAssets(json, url);
    const result = await mergeAssets(assets);
    await mergeRecipe({ url: "https://chatgpt.com/backend-api/my/recent/image_gen?limit=25", method: "GET", body: "", contentType: "" }, { cursors: cursorFromImageGen(json) ? [cursorFromImageGen(json)] : [] });
    pages += 1;
    totalAssets += assets.length;
    totalAdded += result.added;
    totalUpdated += result.updated;
    await logEvent({ type: "direct_sync_capture", page: page + 1, assets: assets.length, added: result.added, updated: result.updated, api: url });

    const next = cursorFromImageGen(json);
    if (!next || next === lastCursor || seenCursors.has(next)) { exhausted = true; break; }
    seenCursors.add(next);
    lastCursor = cursor;
    cursor = next;
    if (totalAssets >= Number(maxImages || DEFAULT_SETTINGS.maxImages)) { maxReached = true; break; }
  }

  await logEvent({ type: "direct_sync_done", pages, assets: totalAssets, added: totalAdded, updated: totalUpdated, maxImages, exhausted, maxReached });
  return { ok: true, direct: true, pages, added: totalAdded, updated: totalUpdated, assets: totalAssets, maxImages, maxPages, exhausted, maxReached };
}


function pageContextImageGenSync(maxImages) {
  const limit = 25;
  const maxPages = Math.max(1, Math.ceil(Number(maxImages || 7500) / limit));
  const out = [];
  const seen = new Set();
  const seenCursors = new Set();

  const nowIso = () => new Date().toISOString();
  const coerceDate = (value) => {
    if (value == null || value === "") return "";
    if (typeof value === "number") {
      const ms = value > 1e12 ? value : value > 1e9 ? value * 1000 : value;
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? "" : d.toISOString();
    }
    const d = new Date(String(value));
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
  };
  const abs = (raw) => {
    try { return new URL(String(raw || ""), location.href).href; }
    catch (_) { return String(raw || ""); }
  };
  const looksLikeEstuarySource = (raw) => {
    try {
      const u = new URL(String(raw || ""), location.href);
      if (!/\/backend-api\/estuary\/content$/.test(u.pathname)) return false;
      return /^file_[A-Za-z0-9_-]+$/.test(u.searchParams.get("id") || "");
    } catch (_) { return false; }
  };
  const safePreview = (raw) => {
    try {
      const u = new URL(String(raw || ""), location.href);
      const s = u.href.toLowerCase();
      if (/\.svg(?:[?#]|$)|\.html?(?:[?#]|$)|\.json(?:[?#]|$)|oaistatic\.com|\/_next\/static\/|avatar|profile|icon|logo|favicon|sprite/.test(s)) return "";
      return u.href;
    } catch (_) { return ""; }
  };
  const extract = (json, apiUrl) => {
    const items = Array.isArray(json && json.items) ? json.items : [];
    const assets = [];
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
      const thumb = safePreview(item && item.encodings && item.encodings.thumbnail && item.encodings.thumbnail.path || "");
      assets.push({
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
    return assets;
  };

  return (async () => {
    let cursor = "";
    let pages = 0;
    let lastStatus = 0;
    let lastContentType = "";
    for (let page = 0; page < maxPages; page++) {
      const u = new URL("/backend-api/my/recent/image_gen", location.origin);
      u.searchParams.set("limit", String(limit));
      if (cursor) u.searchParams.set("after", cursor);
      const res = await fetch(u.href, { method: "GET", credentials: "include", cache: "no-store", headers: { "accept": "application/json, text/plain, */*" } });
      lastStatus = res.status;
      lastContentType = res.headers.get("content-type") || "";
      const text = await res.text();
      if (!res.ok) return { ok: false, pages, assets: out, status: res.status, error: "HTTP " + res.status, contentType: lastContentType };
      if (/^\s*</.test(text)) return { ok: false, pages, assets: out, status: res.status, error: "auth/html response", contentType: lastContentType };
      let json;
      try { json = JSON.parse(text); }
      catch (e) { return { ok: false, pages, assets: out, status: res.status, error: "JSON parse failed", contentType: lastContentType }; }
      const assets = extract(json, u.href);
      out.push(...assets);
      pages += 1;
      const next = typeof json.cursor === "string" ? json.cursor : "";
      if (!next || seenCursors.has(next) || out.length >= Number(maxImages || 7500)) break;
      seenCursors.add(next);
      cursor = next;
    }
    return { ok: true, pages, assets: out.slice(0, Number(maxImages || 7500)), status: lastStatus, contentType: lastContentType };
  })();
}

async function scriptSyncImageGen(maxImages) {
  const tab = await findReplayTab({ fresh: true, active: false });
  await waitForTabComplete(tab.id);
  let result;
  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: false },
      world: "MAIN",
      func: pageContextImageGenSync,
      args: [maxImages]
    });
    result = injected && injected[0] && injected[0].result;
  } catch (firstError) {
    try {
      const injected = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: false },
        func: pageContextImageGenSync,
        args: [maxImages]
      });
      result = injected && injected[0] && injected[0].result;
    } catch (secondError) {
      await logEvent({ type: "script_sync_error", error: secondError.message || String(secondError) });
      return { ok: false, mode: "script", pages: 0, added: 0, updated: 0, assets: 0, error: secondError.message || String(secondError) };
    }
  }

  if (!result || !result.ok) {
    await logEvent({ type: "script_sync_error", error: result?.error || "no result", pages: result?.pages || 0, status: result?.status || 0 });
    return { ok: false, mode: "script", pages: result?.pages || 0, added: 0, updated: 0, assets: result?.assets?.length || 0, error: result?.error || "script sync failed" };
  }
  const merge = await mergeAssets(result.assets || []);
  await mergeRecipe({ url: "https://chatgpt.com/backend-api/my/recent/image_gen?limit=25", method: "GET", body: "", contentType: "" }, {});
  await logEvent({ type: "script_sync_done", pages: result.pages, assets: (result.assets || []).length, added: merge.added, updated: merge.updated, tabId: tab.id });
  return { ok: true, mode: "page-script", pages: result.pages, assets: (result.assets || []).length, added: merge.added, updated: merge.updated, maxImages };
}


async function contentSyncImageGen(maxImages) {
  const tab = await findReplayTab({ fresh: true, active: false });
  await waitForTabComplete(tab.id);
  const ok = await ensureContent(tab.id);
  if (!ok) return { ok: false, mode: "content", pages: 0, added: 0, updated: 0, assets: 0, error: "content script unavailable" };
  try {
    const result = await chrome.tabs.sendMessage(tab.id, { type: "RUN_IMAGE_GEN_SYNC_V20", maxImages }).catch(e => ({ ok: false, error: e.message || String(e) }));
    if (!result || !result.ok) {
      await logEvent({ type: "content_sync_error", error: result?.error || "no result", pages: result?.pages || 0, assets: result?.assets || 0, tabId: tab.id });
      return { ok: false, mode: "content", pages: result?.pages || 0, added: result?.added || 0, updated: result?.updated || 0, assets: result?.assets || 0, error: result?.error || "content sync failed" };
    }
    await mergeRecipe({ url: "https://chatgpt.com/backend-api/my/recent/image_gen?limit=25", method: "GET", body: "", contentType: "" }, {});
    await logEvent({ type: "content_sync_done", pages: result.pages, assets: result.assets, added: result.added, updated: result.updated, tabId: tab.id });
    return { ok: true, mode: "content", pages: result.pages, assets: result.assets, added: result.added, updated: result.updated, maxImages };
  } catch (e) {
    await logEvent({ type: "content_sync_error", error: e.message || String(e), tabId: tab.id });
    return { ok: false, mode: "content", pages: 0, added: 0, updated: 0, assets: 0, error: e.message || String(e) };
  }
}


function syncLooksComplete(res, maxImages, maxPages) {
  if (!res || !res.ok || Number(res.assets || 0) <= 0) return false;
  const assets = Number(res.assets || 0);
  const pages = Number(res.pages || 0);
  // Accept multi-page cursor sync, max reached, or a genuinely exhausted library
  // larger than one page. One page only is treated as incomplete because ChatGPT
  // sometimes returns/captures only the currently loaded first batch.
  return assets >= Number(maxImages || DEFAULT_SETTINGS.maxImages) ||
    res.maxReached === true ||
    pages >= Number(maxPages || 1) ||
    pages > 1 ||
    (res.exhausted === true && assets < 25);
}

async function catalogCount() {
  const store = await getStore([STORAGE.catalog]);
  return Object.keys(store[STORAGE.catalog] || {}).length;
}

async function autoScrollCaptureSync(maxImages) {
  const before = await catalogCount();
  const tab = await findReplayTab({ fresh: true, active: true });
  await waitForTabComplete(tab.id, 30000);
  const ok = await ensureContent(tab.id);
  if (!ok) return { ok: false, mode: "auto-scroll", pages: 0, assets: 0, added: 0, updated: 0, error: "content script unavailable" };
  await new Promise(r => setTimeout(r, 1500));
  const result = await chrome.tabs.sendMessage(tab.id, { type: "RUN_IMAGE_GEN_AUTOSCROLL_V20", maxImages }).catch(e => ({ ok: false, error: e.message || String(e) }));
  await new Promise(r => setTimeout(r, 1200));
  const after = await catalogCount();
  const addedApprox = Math.max(0, after - before);
  await logEvent({ type: "auto_scroll_sync_done", rounds: result?.rounds || 0, before, after, addedApprox, tabId: tab.id, error: result?.error || "" });
  return { ok: !!result?.ok || after > before, mode: "auto-scroll", pages: result?.rounds || 0, assets: after, added: addedApprox, updated: 0, maxImages, error: result?.error || "" };
}


async function syncGrok(mode = "imagen", media = "both") {
  cancelSyncRequested = false;
  const startedAt = Date.now();
  const store = await getStore([STORAGE.settings, STORAGE.catalog]);
  const settings = { ...DEFAULT_SETTINGS, ...(store[STORAGE.settings] || {}) };
  const maxImages = Math.max(1, Number(settings.maxImages || DEFAULT_SETTINGS.maxImages));
  const beforeCount = Object.keys(store[STORAGE.catalog] || {}).filter(id => (store[STORAGE.catalog] || {})[id]?.source === "grok").length;

  // Reuse any existing Grok tab. Only create /imagine/saved when no Grok tab exists.
  const tab = await findOrOpenGrokTab(false, "imagen");
  const current = await chrome.tabs.get(tab.id).catch(() => null);
  if (current?.status !== "complete") await waitForTabComplete(tab.id, 12000);
  const ok = await ensureContent(tab.id);
  if (!ok) return { ok: false, mode: "grok-private-imagine-responses", error: "content script unavailable", assets: 0, added: 0, updated: 0 };

  // One direct message; the new sync is short-lived and contains no polling loop.
  const res = await chrome.tabs.sendMessage(tab.id, {
    type: "RUN_GROK_IMAGEN_SYNC_V20",
    maxImages,
    media
  }).catch(e => ({ ok: false, error: e.message || String(e) }));

  const after = await getStore([STORAGE.catalog]);
  const afterCount = Object.keys(after[STORAGE.catalog] || {}).filter(id => (after[STORAGE.catalog] || {})[id]?.source === "grok").length;
  const delta = Math.max(0, afterCount - beforeCount);
  const diagnostics = Array.isArray(res?.diagnostics) ? res.diagnostics : [];
  diagnostics.unshift({ summary: `DIRECT CONNECTION: ${((Date.now()-startedAt)/1000).toFixed(1)}s; existing Grok tab reused when available; /imagine/saved opened only when none exists; no polling/sleeps/page-hook/source feeds` });
  await logEvent({ type: "grok_sync_done", mode: "private-imagine-responses", media, pages: res?.pages || 0, assets: res?.assets || 0, added: res?.added ?? delta, updated: res?.updated || 0, total: afterCount, error: res?.error || "", diagnostics: diagnostics.slice(0, 20) });
  return { ok: !!res?.ok || delta > 0, mode: res?.mode || "grok-private-imagine-responses", media, pages: res?.pages || 0, assets: res?.assets || delta, added: res?.added ?? delta, updated: res?.updated || 0, total: afterCount, maxImages, error: res?.error || "", diagnostics };
}

async function replayCapturedRecipes() {
  cancelSyncRequested = false;
  const store = await getStore([STORAGE.settings, STORAGE.catalog]);
  const settings = { ...DEFAULT_SETTINGS, ...(store[STORAGE.settings] || {}) };
  const maxImages = Math.max(25, Number(settings.maxImages || settings.maxReplayPages * 25 || DEFAULT_SETTINGS.maxImages));
  const maxPages = Math.ceil(maxImages / 25);
  const beforeCount = Object.keys(store[STORAGE.catalog] || {}).length;

  // v2.0: one clean sync channel:
  // viewer -> background -> content -> page-hook -> PAGE_SYNC_PAGE -> content merges page-by-page.
  // No DOM thumbnails and no dependence on already-visible cards.
  const tab = await findReplayTab({ active: false, fresh: false });
  await waitForTabComplete(tab.id, 30000);
  const ok = await ensureContent(tab.id);
  if (!ok) {
    await logEvent({ type: "sync_error", mode: "page-hook-v20", error: "content script unavailable", tabId: tab.id });
    return { ok: false, mode: "page-hook-v20", recipes: 1, maxImages, maxPages, assets: 0, added: 0, updated: 0, error: "content script unavailable" };
  }
  await new Promise(r => setTimeout(r, 800));

  const recipe = { url: "https://chatgpt.com/backend-api/my/recent/image_gen?limit=25", method: "GET", body: "", contentType: "" };
  await mergeRecipe(recipe, {});
  await logEvent({ type: "sync", message: `Page-hook v2.0 cursor sync: max ${maxImages} images / ${maxPages} source pages`, tabId: tab.id });

  const replay = await chrome.tabs.sendMessage(tab.id, {
    type: "RUN_PAGE_HOOK_CURSOR_SYNC_V20",
    maxPages,
    maxImages
  }).catch(e => ({ ok: false, error: e.message || String(e) }));

  const after = await getStore([STORAGE.catalog]);
  const afterCount = Object.keys(after[STORAGE.catalog] || {}).length;
  const delta = Math.max(0, afterCount - beforeCount);
  await logEvent({ type: "sync_done", mode: "page-hook-v20", pages: replay?.pages || 0, assets: replay?.assets || 0, added: replay?.added || 0, updated: replay?.updated || 0, addedToCatalog: delta, total: afterCount, tabId: tab.id, error: replay?.error || "" });

  return {
    ok: !!replay?.ok || afterCount > beforeCount,
    mode: "page-hook-v20",
    recipes: 1,
    maxImages,
    maxPages,
    pages: replay?.pages || 0,
    assets: replay?.assets || delta,
    added: replay?.added ?? delta,
    updated: replay?.updated ?? 0,
    total: afterCount,
    error: replay?.error || ""
  };
}

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("viewer.html") });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (!message || !message.type) return;

    if (message.type === "MERGE_SYNC_ASSETS") {
      const assets = Array.isArray(message.assets) ? message.assets : [];
      const result = await mergeAssets(assets);
      const api = message.api || "";
      if (/\/backend-api\/my\/recent\/image_gen(?:\?|$)/.test(api)) {
        await mergeRecipe({ url: "https://chatgpt.com/backend-api/my/recent/image_gen?limit=25", method: "GET", body: "", contentType: "" }, { cursors: message.cursor ? [message.cursor] : [] });
      } else if (/grok\.com\/rest\//.test(api)) {
        const store = await getStore([STORAGE.recipes]);
        const recipes = store[STORAGE.recipes] || {};
        const fp = `GROK ${api.split('?')[0]}`;
        recipes[fp] = { fingerprint: fp, url: api, method: message.method || "GET", lastSeenAt: new Date().toISOString(), seenCount: (recipes[fp]?.seenCount || 0) + 1 };
        await setStore({ [STORAGE.recipes]: recipes });
      }
      await logEvent({ type: "content_sync_capture", page: message.page || 0, api, assets: assets.length, added: result.added, updated: result.updated });
      sendResponse({ ok: true, added: result.added, updated: result.updated });
      return;
    }

    if (message.type === "HOOK_EVENT") {
      const event = message.event || {};
      if (event.type === "API_CAPTURE") {
        const apiUrl = event.responseUrl || event.recipe?.url || "";
        const isRecentImageGen = /\/backend-api\/my\/recent\/image_gen(?:\?|$)/.test(apiUrl);
        await mergeRecipe(event.recipe, event.pagination || {});
        const result = isRecentImageGen ? await mergeAssets(event.assets || []) : { added: 0, updated: 0 };
        await logEvent({
          type: "capture",
          api: apiUrl,
          assets: isRecentImageGen ? (event.assets || []).length : 0,
          ignoredAssets: isRecentImageGen ? 0 : (event.assets || []).length,
          added: result.added,
          updated: result.updated,
          tabId: sender.tab?.id || null
        });
      } else if (event.type === "LIVE_CAPTURE") {
        const settingsStore = await getStore([STORAGE.settings]);
        const settings = { ...DEFAULT_SETTINGS, ...(settingsStore[STORAGE.settings] || {}) };
        const assets = Array.isArray(event.assets) ? event.assets : [];
        if (settings.liveCapture && assets.length) {
          const result = await mergeAssets(assets);
          await logEvent({
            type: "live_capture",
            api: event.responseUrl || event.api || "",
            source: event.assetSource || "",
            reason: event.reason || "",
            assets: assets.length,
            added: result.added,
            updated: result.updated,
            tabId: sender.tab?.id || null
          });
        } else if (assets.length) {
          await logEvent({ type: "live_capture_ignored", assets: assets.length, reason: "disabled", api: event.responseUrl || event.api || "" });
        }
      } else if (event.type === "GENERATION_WATCH") {
        const settingsStore = await getStore([STORAGE.settings]);
        const settings = { ...DEFAULT_SETTINGS, ...(settingsStore[STORAGE.settings] || {}) };
        const assets = Array.isArray(event.assets) ? event.assets : [];
        let result = { added: 0, updated: 0 };
        if (settings.generationWatch && assets.length) result = await mergeAssets(assets);
        if (settings.generationWatch || assets.length) {
          await logEvent({
            type: "generation_watch",
            phase: event.phase || "scan",
            message: event.summary || "generation window scan",
            img: event.imgCount || 0,
            bg: event.backgroundCount || 0,
            blob: event.blobCount || 0,
            canvas: event.canvasCount || 0,
            fileIds: event.fileIds || 0,
            estuary: event.estuaryCount || 0,
            downloadable: event.downloadableCount || 0,
            assets: assets.length,
            added: result.added,
            updated: result.updated,
            sample: event.sample || "",
            tabId: sender.tab?.id || null
          });
        }
      } else if (event.type === "HOOK_READY") {
        await logEvent({ type: "hook", href: event.href || sender.tab?.url || "" });
      } else if (/REPLAY_/.test(event.type || "")) {
        await logEvent({ type: event.type.toLowerCase(), ...event });
      }
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "GET_STATE") {
      const store = await getStore([STORAGE.catalog, STORAGE.statuses, STORAGE.recipes, STORAGE.events, STORAGE.settings, STORAGE.collections, STORAGE.itemCollections, STORAGE.ratings, STORAGE.storyboards, STORAGE.canvases]);
      sendResponse({
        ok: true,
        catalog: store[STORAGE.catalog] || {},
        statuses: store[STORAGE.statuses] || {},
        recipes: store[STORAGE.recipes] || {},
        events: store[STORAGE.events] || [],
        collections: store[STORAGE.collections] || {},
        itemCollections: store[STORAGE.itemCollections] || {},
        ratings: store[STORAGE.ratings] || {},
        storyboards: store[STORAGE.storyboards] || {},
        canvases: store[STORAGE.canvases] || {},
        settings: { ...DEFAULT_SETTINGS, ...(store[STORAGE.settings] || {}) }
      });
      return;
    }

    if (message.type === "SAVE_SETTINGS") {
      const current = (await getStore([STORAGE.settings]))[STORAGE.settings] || {};
      const settings = { ...DEFAULT_SETTINGS, ...current, ...(message.settings || {}) };
      settings.folder = sanitizePath(settings.folder || DEFAULT_SETTINGS.folder);
      settings.archiveFolder = sanitizePath(settings.archiveFolder || DEFAULT_SETTINGS.archiveFolder);
      settings.maxImages = Math.max(25, Math.floor(Number(settings.maxImages || DEFAULT_SETTINGS.maxImages) / 25) * 25);
      settings.maxReplayPages = Math.ceil(settings.maxImages / 25);
      settings.zipPartMb = Math.max(100, Math.min(3500, Number(settings.zipPartMb || DEFAULT_SETTINGS.zipPartMb)));
      settings.folderStructure = ["flat", "date", "chat"].includes(settings.folderStructure) ? settings.folderStructure : DEFAULT_SETTINGS.folderStructure;
      settings.viewMode = ["grid", "list"].includes(settings.viewMode) ? settings.viewMode : DEFAULT_SETTINGS.viewMode;
      settings.pageMode = ["infinite", "pages"].includes(settings.pageMode) ? settings.pageMode : DEFAULT_SETTINGS.pageMode;
      settings.pageSize = [25,50,100,200,300,400,500].includes(Number(settings.pageSize)) ? Number(settings.pageSize) : DEFAULT_SETTINGS.pageSize;
      settings.gridSize = ["small", "medium", "large"].includes(settings.gridSize) ? settings.gridSize : DEFAULT_SETTINGS.gridSize;
      { const scales = [60,80,100,120,140,160,200]; const n = Number(settings.gridScale || DEFAULT_SETTINGS.gridScale); settings.gridScale = scales.reduce((best, v) => Math.abs(v - n) < Math.abs(best - n) ? v : best, 100); }
      settings.chooseFolderOnce = settings.chooseFolderOnce !== false;
      settings.activeSource = ["chatgpt", "grok", "local"].includes(settings.activeSource) ? settings.activeSource : DEFAULT_SETTINGS.activeSource;
      settings.localFolderLabel = String(settings.localFolderLabel || "").slice(0, 140);
      settings.localFolderPath = String(settings.localFolderPath || "").split("/").map(x => x.trim()).filter(Boolean).join("/").slice(0, 1000);
      settings.localRootId = String(settings.localRootId || "").slice(0, 80);
      settings.localRoots = (Array.isArray(settings.localRoots) ? settings.localRoots : [])
        .map(root => ({ id: String(root?.id || "").slice(0, 80), name: String(root?.name || root?.label || "Local root").slice(0, 80) }))
        .filter(root => root.id)
        .slice(0, 12);
      if (settings.localRootId && !settings.localRoots.some(root => root.id === settings.localRootId)) settings.localRootId = settings.localRoots[0]?.id || "";
      settings.localViewMode = ["folder", "all"].includes(settings.localViewMode) ? settings.localViewMode : DEFAULT_SETTINGS.localViewMode;
      settings.localMaxFiles = Math.max(25, Math.min(100000, Math.floor(Number(settings.localMaxFiles || DEFAULT_SETTINGS.localMaxFiles))));
      settings.localFolderBarPinned = !!settings.localFolderBarPinned;
      settings.thumbnailCache = settings.thumbnailCache !== false;
      settings.thumbnailCacheAutoBuild = settings.thumbnailCacheAutoBuild !== false;
      settings.thumbnailCacheFullGrid = !!settings.thumbnailCacheFullGrid;
      settings.thumbnailCacheQuality = ["low", "medium", "high"].includes(settings.thumbnailCacheQuality) ? settings.thumbnailCacheQuality : DEFAULT_SETTINGS.thumbnailCacheQuality;
      settings.grokMode = ["imagen", "boards", "both"].includes(settings.grokMode) ? settings.grokMode : DEFAULT_SETTINGS.grokMode;
      settings.grokMedia = ["both", "images", "videos"].includes(settings.grokMedia) ? settings.grokMedia : DEFAULT_SETTINGS.grokMedia;
      settings.grokVideoThumbs = !!settings.grokVideoThumbs;
      settings.collectionFilter = String(settings.collectionFilter || "all").slice(0, 128);
      settings.storyboardActiveId = String(settings.storyboardActiveId || "").slice(0, 128);
      settings.storyboardView = !!settings.storyboardView;
      settings.canvasActiveId = String(settings.canvasActiveId || "").slice(0, 128);
      settings.canvasView = !!settings.canvasView;
      settings.hiddenMainViewCollections = Array.from(new Set(Array.isArray(settings.hiddenMainViewCollections) ? settings.hiddenMainViewCollections : []))
        .map(x => String(x || "").slice(0, 128))
        .filter(Boolean)
        .slice(0, 500);
      settings.liveCapture = !!settings.liveCapture;
      settings.generationWatch = !!settings.generationWatch;
      await setStore({ [STORAGE.settings]: settings });
      sendResponse({ ok: true, settings });
      return;
    }

    if (message.type === "SET_STATUSES") {
      const store = await getStore([STORAGE.statuses]);
      const statuses = store[STORAGE.statuses] || {};
      for (const [id, patch] of Object.entries(message.patches || {})) {
        statuses[id] = { ...(statuses[id] || {}), ...patch };
      }
      await setStore({ [STORAGE.statuses]: statuses });
      sendResponse({ ok: true });
      return;
    }


    if (message.type === "IMPORT_ORGANIZER") {
      const payload = message.payload && typeof message.payload === "object" ? message.payload : {};
      const importedCollections = sanitizeOrganizerCollections(payload.collections || {});
      const store = await getStore([STORAGE.collections, STORAGE.itemCollections, STORAGE.ratings, STORAGE.storyboards, STORAGE.canvases, STORAGE.settings]);
      const currentCollections = store[STORAGE.collections] && typeof store[STORAGE.collections] === "object" ? store[STORAGE.collections] : {};
      const currentItemCollections = store[STORAGE.itemCollections] && typeof store[STORAGE.itemCollections] === "object" ? store[STORAGE.itemCollections] : {};
      const currentRatings = normalizeOrganizerRatings(store[STORAGE.ratings] || {});
      const currentStoryboards = sanitizeStoryboards(store[STORAGE.storyboards] || {});
      const currentCanvases = sanitizeCanvases(store[STORAGE.canvases] || {});
      const currentSettings = { ...DEFAULT_SETTINGS, ...(store[STORAGE.settings] || {}) };
      const mergedCollections = { ...currentCollections, ...importedCollections };
      const importedItemCollections = sanitizeOrganizerItemCollections(payload.itemCollections || {}, mergedCollections);
      const mergedItemCollections = { ...currentItemCollections };
      for (const [itemId, ids] of Object.entries(importedItemCollections)) {
        mergedItemCollections[itemId] = Array.from(new Set([...(Array.isArray(mergedItemCollections[itemId]) ? mergedItemCollections[itemId] : []), ...ids]))
          .filter(id => mergedCollections[id]);
      }
      const importedRatings = normalizeOrganizerRatings(payload.ratings || {});
      const mergedRatings = { ...currentRatings, ...importedRatings };
      const importedStoryboards = sanitizeStoryboards(payload.storyboards || {});
      const importedCanvases = sanitizeCanvases(payload.canvases || {});
      const mergedCanvases = { ...currentCanvases, ...importedCanvases };
      const mergedStoryboards = { ...currentStoryboards, ...importedStoryboards };
      const incomingHidden = Array.isArray(payload.settings?.hiddenMainViewCollections) ? payload.settings.hiddenMainViewCollections : [];
      const hiddenMainViewCollections = Array.from(new Set([...(Array.isArray(currentSettings.hiddenMainViewCollections) ? currentSettings.hiddenMainViewCollections : []), ...incomingHidden]))
        .map(id => String(id || "").slice(0, 128))
        .filter(id => id && mergedCollections[id]);
      const mergedSettings = { ...currentSettings, hiddenMainViewCollections };
      await setStore({
        [STORAGE.collections]: mergedCollections,
        [STORAGE.itemCollections]: mergedItemCollections,
        [STORAGE.ratings]: mergedRatings,
        [STORAGE.storyboards]: mergedStoryboards,
        [STORAGE.canvases]: mergedCanvases,
        [STORAGE.settings]: mergedSettings
      });
      sendResponse({
        ok: true,
        importedCollections: Object.keys(importedCollections).length,
        importedItemLinks: Object.keys(importedItemCollections).length,
        importedRatings: Object.keys(importedRatings).length,
        totalCollections: Object.keys(mergedCollections).length,
        totalItemLinks: Object.keys(mergedItemCollections).length,
        totalRatings: Object.keys(mergedRatings).length,
        importedStoryboards: Object.keys(importedStoryboards).length,
        totalStoryboards: Object.keys(mergedStoryboards).length,
        importedCanvases: Object.keys(importedCanvases).length,
        totalCanvases: Object.keys(mergedCanvases).length
      });
      return;
    }

    if (message.type === "SET_COLLECTIONS") {
      const collections = message.collections && typeof message.collections === "object" ? message.collections : {};
      const itemCollections = message.itemCollections && typeof message.itemCollections === "object" ? message.itemCollections : {};
      await setStore({ [STORAGE.collections]: collections, [STORAGE.itemCollections]: itemCollections });
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "SET_STORYBOARDS") {
      const storyboards = sanitizeStoryboards(message.storyboards || {});
      await setStore({ [STORAGE.storyboards]: storyboards });
      sendResponse({ ok: true, storyboards });
      return;
    }

    if (message.type === "SET_CANVASES") {
      const canvases = sanitizeCanvases(message.canvases || {});
      await setStore({ [STORAGE.canvases]: canvases });
      sendResponse({ ok: true, canvases });
      return;
    }

    if (message.type === "SET_RATINGS") {
      const input = message.ratings && typeof message.ratings === "object" ? message.ratings : {};
      const ratings = {};
      for (const [id, value] of Object.entries(input)) {
        const n = Math.round(Number(value) * 10) / 10;
        if (!id || !Number.isFinite(n)) continue;
        if (n >= 1 && n <= 5) ratings[String(id)] = Math.max(1, Math.min(5, n));
      }
      await setStore({ [STORAGE.ratings]: ratings });
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "CLEAR_MEDIA_STATE") {
      await setStore({ [STORAGE.catalog]: {}, [STORAGE.statuses]: {}, [STORAGE.recipes]: {}, [STORAGE.events]: [] });
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "CLEAR_ALL") {
      await setStore({ [STORAGE.catalog]: {}, [STORAGE.statuses]: {}, [STORAGE.recipes]: {}, [STORAGE.events]: [], [STORAGE.collections]: {}, [STORAGE.itemCollections]: {}, [STORAGE.ratings]: {}, [STORAGE.storyboards]: {}, [STORAGE.canvases]: {} });
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "SHOW_DOWNLOADS_FOLDER") {
      try {
        chrome.downloads.showDefaultFolder();
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e.message || String(e) });
      }
      return;
    }

    if (message.type === "ENSURE_SOURCE_TAB") {
      const store = await getStore([STORAGE.settings]);
      const settings = { ...DEFAULT_SETTINGS, ...(store[STORAGE.settings] || {}) };
      const src = message.source || settings.activeSource || "chatgpt";
      const mode = message.grokMode || message.mode || settings.grokMode || "imagen";
      const result = await ensureSourceTab(src, { active: !!message.active, mode, timeoutMs: message.timeoutMs || 25000 });
      sendResponse(result);
      return;
    }

    if (message.type === "OPEN_IMAGES") {
      const tab = await findOrOpenImagesTab(true);
      sendResponse({ ok: true, tabId: tab.id });
      return;
    }

    if (message.type === "START_GENERATION_WATCH") {
      const tabs = await findChatGPTTabsOrOpenImages(false);
      let started = 0;
      let attempted = 0;
      const attached = [];
      for (const tab of tabs) {
        if (!tab?.id) continue;
        attempted += 1;
        try { await waitForTabComplete(tab.id, 12000); } catch (_) {}
        const ok = await ensureContent(tab.id);
        if (ok) {
          const res = await chrome.tabs.sendMessage(tab.id, { type: "START_GENERATION_WATCH_V20" }).catch(e => ({ ok: false, error: e.message || String(e) }));
          if (res?.ok) { started += 1; attached.push(tab.id); }
        }
      }
      await logEvent({ type: started ? "generation_watch_started" : "generation_watch_start_failed", source: "chatgpt", tabs: started, attempted, tabIds: attached.join(",") });
      sendResponse({ ok: started > 0, tabs: started, attempted, source: "chatgpt", error: started > 0 ? "" : "content script unavailable or hook not ready" });
      return;
    }

    if (message.type === "STOP_GENERATION_WATCH") {
      const tabs = await chrome.tabs.query({ url: ["https://chatgpt.com/*", "https://chat.openai.com/*"] });
      let stopped = 0;
      const ids = [];
      for (const tab of tabs) {
        if (!tab?.id) continue;
        const res = await chrome.tabs.sendMessage(tab.id, { type: "STOP_GENERATION_WATCH_V20" }).catch(() => null);
        if (res?.ok) { stopped += 1; ids.push(tab.id); }
      }
      await logEvent({ type: "generation_watch_stopped", source: "chatgpt", tabs: stopped, tabIds: ids.join(",") });
      sendResponse({ ok: true, tabs: stopped, source: "chatgpt" });
      return;
    }

    if (message.type === "START_LIVE_CAPTURE") {
      const store = await getStore([STORAGE.settings]);
      const settings = { ...DEFAULT_SETTINGS, ...(store[STORAGE.settings] || {}) };
      const src = message.source || settings.activeSource || "chatgpt";
      const mode = message.grokMode || settings.grokMode || "imagen";
      const tabs = src === "grok" ? [await findOrOpenGrokTab(false, mode)] : await findChatGPTTabsOrOpenImages(false);
      let attached = 0;
      const ids = [];
      for (const tab of tabs) {
        if (!tab?.id) continue;
        try { await waitForTabComplete(tab.id, 12000); } catch (_) {}
        const ok = await ensureContent(tab.id);
        if (ok) {
          const res = await chrome.tabs.sendMessage(tab.id, { type: "START_LIVE_CAPTURE_V20" }).catch(e => ({ ok: false, error: e.message || String(e) }));
          if (res?.ok) { attached += 1; ids.push(tab.id); }
        }
      }
      await logEvent({ type: attached ? "live_capture_started" : "live_capture_start_failed", source: src, mode, tabs: attached, tabIds: ids.join(",") });
      sendResponse({ ok: attached > 0, tabs: attached, source: src, mode, error: attached > 0 ? "" : "content script unavailable" });
      return;
    }

    if (message.type === "STOP_LIVE_CAPTURE") {
      const store = await getStore([STORAGE.settings]);
      const settings = { ...DEFAULT_SETTINGS, ...(store[STORAGE.settings] || {}) };
      const src = message.source || settings.activeSource || "chatgpt";
      const tabs = src === "grok"
        ? await chrome.tabs.query({ url: ["https://grok.com/*"] })
        : await chrome.tabs.query({ url: ["https://chatgpt.com/*", "https://chat.openai.com/*"] });
      let stopped = 0;
      const ids = [];
      for (const tab of tabs) {
        if (!tab?.id) continue;
        const res = await chrome.tabs.sendMessage(tab.id, { type: "STOP_LIVE_CAPTURE_V20" }).catch(() => null);
        if (res?.ok) { stopped += 1; ids.push(tab.id); }
      }
      await logEvent({ type: "live_capture_stopped", source: src, tabs: stopped, tabIds: ids.join(",") });
      sendResponse({ ok: true, tabs: stopped, source: src });
      return;
    }

    if (message.type === "OPEN_GROK") {
      const tab = await findOrOpenGrokTab(true, message.mode || "imagen");
      sendResponse({ ok: true, tabId: tab.id });
      return;
    }

    if (message.type === "CANCEL_SYNC") {
      cancelSyncRequested = true;
      const tabs = await chrome.tabs.query({ url: ["https://chatgpt.com/images*", "https://chat.openai.com/images*", "https://grok.com/*"] });
      for (const tab of tabs) {
        try { await chrome.tabs.sendMessage(tab.id, { type: "CANCEL_REPLAY_V20" }); } catch (_) {}
      }
      await logEvent({ type: "sync", message: "Cancel requested" });
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "AUTO_SYNC") {
      const store = await getStore([STORAGE.settings]);
      const settings = { ...DEFAULT_SETTINGS, ...(store[STORAGE.settings] || {}) };
      const requestedGrokMode = ["imagen", "boards", "both"].includes(message.grokMode) ? message.grokMode : (settings.grokMode || "imagen");
      const requestedGrokMedia = ["both", "images", "videos"].includes(message.grokMedia) ? message.grokMedia : (settings.grokMedia || "both");
      const result = settings.activeSource === "grok"
        ? await syncGrok(requestedGrokMode, requestedGrokMedia)
        : await replayCapturedRecipes();
      sendResponse(result);
      return;
    }
  })().catch(error => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});
