const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

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
  canvasHideWorkMarks: false
};

const THOUGHT_BASE_OFFSET_OLD_DEFAULT = 4.5;
const THOUGHT_BASE_OFFSET_ZERO_ACTUAL = -4.5;
const BUBBLE_ANCHOR_OFFSET_ZERO_ACTUAL = -1.6;

const BUBBLE_TUNING_STORAGE_KEY = "comicBubbleTuningV23209";
const BUBBLE_TUNING_DEFAULTS = {
  globalContourPadAdjust: -0.80,
  tailContourOffset: -0.53,
  // Speech tail base should sit deeper inside the bubble.
  tailBlackBaseInset: 5.2,
  tailBlackBaseMult: 4.30,
  tailWhiteBaseInset: 4.0,
  tailWhiteBaseMult: 3.50,
  whiteTipInset: 4.60,
  thoughtMergeOnExtra: 0.05,
  thoughtMergeOffStrokeExtra: -0.10
};
let bubbleTuningState = { ...BUBBLE_TUNING_DEFAULTS };
function bubbleTuningValue(key) {
  const n = Number(bubbleTuningState?.[key]);
  return Number.isFinite(n) ? n : BUBBLE_TUNING_DEFAULTS[key];
}
function saveBubbleTuningState() {}
function resetBubbleTuningState() {
  bubbleTuningState = { ...BUBBLE_TUNING_DEFAULTS };
  saveBubbleTuningState();
  updateBubbleTuningDebugUi();
  renderComicCanvas();
}
function bubbleTuningCopyText() {
  return Object.keys(BUBBLE_TUNING_DEFAULTS).map(key => `${key} = ${Number(bubbleTuningValue(key)).toFixed(2)}`).join("\n");
}
function updateBubbleTuningDebugUi() {
  Object.keys(BUBBLE_TUNING_DEFAULTS).forEach(key => {
    const input = document.getElementById(`bubbleTuning_${key}`);
    const value = Number(bubbleTuningValue(key));
    if (input && document.activeElement !== input) input.value = String(Math.round(value * 100) / 100);
    const out = document.getElementById(`bubbleTuning_${key}_value`);
    if (out) out.textContent = value.toFixed(2);
  });
  const copy = document.getElementById("bubbleTuningCopy");
  if (copy) copy.value = bubbleTuningCopyText();
}
function setBubbleTuningValue(key, raw) {
  if (!Object.prototype.hasOwnProperty.call(BUBBLE_TUNING_DEFAULTS, key)) return;
  const n = Number(raw);
  if (!Number.isFinite(n)) return;
  bubbleTuningState[key] = Math.round(n * 100) / 100;
  saveBubbleTuningState();
  updateBubbleTuningDebugUi();
  renderComicCanvas();
}
const GRID_SCALES = [60, 80, 100, 120, 140, 160, 200];
const SOURCE_DEFAULT_FOLDERS = {
  chatgpt: { folder: "ChatGPT-Images", archiveFolder: "ChatGPT-Images/archives" },
  grok: { folder: "Grok", archiveFolder: "Grok/archives" }
};
let state = { catalog: {}, statuses: {}, recipes: {}, events: [], collections: {}, itemCollections: {}, ratings: {}, storyboards: {}, canvases: {}, settings: { ...DEFAULT_SETTINGS } };
let localCatalog = {};
let localDirectoryHandle = null;
let localRootHandles = new Map();
let localDirectoryOptions = [];
let localImmediateDirectories = [];
let localFilesTruncated = false;
let localObjectUrls = new Set();
let thumbCacheDbPromise = null;
let thumbMemoryUrls = new Map();
let thumbKnownMissing = new Set();
let thumbBuildInFlight = new Map();
let thumbHydrationObserver = null;
let contextMenuAssetId = null;
let contextCanvasPanelId = null;
let filter = "all";
let query = "";
let sortMode = "newest";
let filteredList = [];
let currentList = [];
let currentPage = 1;
let lightboxIndex = 0;
let busy = false;
let cancelRequested = false;
let activeAbortController = null;
let suppressControlRefreshUntil = 0;
let settingsSaveTimer = null;
let fastSettingsSaveTimer = null;
let gridScaleUiTimer = 0;
let connectingActive = false;
let connectingTimer = null;
let connectingButtonId = "sync";
let sourceKeepAliveTimer = 0;
let lastSourceEnsureAt = 0;
let sourceEnsureInFlight = null;
let miniBarHideTimer = 0;
let selectedIds = new Set();
let selectionUndoStack = [];
const MAX_SELECTION_UNDO = 40;
let dragSelectState = null;
let dragSelectBoxEl = null;
let dragSelectLastIds = new Set();
let dragSelectScrollRaf = 0;
let dragSelectMoveRaf = 0;
let suppressNextGridClick = false;
let compareState = { items: [], aId: null, bId: null, mode: "side", revealPct: 50, revealPointerId: null, revealRaf: 0, lastClientX: 0 };
const COLLECTION_COLORS = ["#38bdf8", "#a78bfa", "#f472b6", "#fb7185", "#f59e0b", "#facc15", "#34d399", "#22c55e", "#60a5fa", "#c084fc", "#f97316", "#14b8a6"];

// v2.28.10 speed restore: keep expensive collection normalization/counts out of per-card render paths.
let collectionsDirty = true;
let collectionStateVersion = 0;
let collectionCountsCache = { key: "", summary: null };
let collectionOptionsCache = {};
let collectionSaveTimer = 0;
let actionButtonsRaf = 0;
let ratingsSaveTimer = 0;
let storyboardsSaveTimer = 0;
let canvasesSaveTimer = 0;
let canvasSelectedPanelId = "";
let canvasSelectedBubbleId = "";
let canvasMultiSelection = [];
let canvasActiveBubbleJoinId = "";
let canvasDragState = null;
let canvasCropHintTimer = 0;

function markCollectionsDirty() {
  collectionsDirty = true;
  collectionStateVersion += 1;
  collectionCountsCache = { key: "", summary: null };
  collectionOptionsCache = {};
}


let zipDirectoryHandle = null;
const DIR_DB_NAME = "cgpt_grok_media_scraper_dir_handles_v2";
const DIR_STORE = "handles";
const THUMB_STORE = "thumbs";
const DIR_KEY = "zip-output";
const LOCAL_DIR_KEY = "local-media-source";
const LOCAL_ROOT_PREFIX = "local-media-root:";
const LOCAL_SCAN_DEFAULT_LIMIT = 3500;
const LOCAL_SCAN_BATCH_SIZE = 200;
const LOCAL_DIR_LIMIT = 800;
const GRID_IMAGE_FALLBACK_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='480' height='320' viewBox='0 0 480 320'%3E%3Crect width='480' height='320' fill='%23020b1f'/%3E%3Ctext x='240' y='154' text-anchor='middle' font-family='Arial' font-size='30' font-weight='700' fill='%2394a3b8'%3ENO PREVIEW%3C/text%3E%3Ctext x='240' y='192' text-anchor='middle' font-family='Arial' font-size='17' fill='%2364748b'%3EOpen card or reconnect source%3C/text%3E%3C/svg%3E";

function openDirDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DIR_DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DIR_STORE)) db.createObjectStore(DIR_STORE);
      if (!db.objectStoreNames.contains(THUMB_STORE)) db.createObjectStore(THUMB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
  });
}
async function idbGetDirHandle() {
  try {
    const db = await openDirDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DIR_STORE, "readonly");
      const req = tx.objectStore(DIR_STORE).get(DIR_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error("IndexedDB get failed"));
    });
  } catch (_) { return null; }
}
async function idbPutDirHandle(handle) {
  try {
    const db = await openDirDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DIR_STORE, "readwrite");
      tx.objectStore(DIR_STORE).put(handle, DIR_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("IndexedDB put failed"));
    });
  } catch (_) {}
}
async function idbGetHandleByKey(key) {
  try {
    const db = await openDirDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DIR_STORE, "readonly");
      const req = tx.objectStore(DIR_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error("IndexedDB get failed"));
    });
  } catch (_) { return null; }
}
async function idbPutHandleByKey(key, handle) {
  try {
    const db = await openDirDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DIR_STORE, "readwrite");
      tx.objectStore(DIR_STORE).put(handle, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("IndexedDB put failed"));
    });
  } catch (_) {}
}

function thumbnailCacheEnabled() { return state.settings.thumbnailCache !== false; }
function thumbnailAutoBuildEnabled() { return state.settings.thumbnailCacheAutoBuild !== false; }
function thumbnailFullGridEnabled() { return !!state.settings.thumbnailCacheFullGrid; }
function thumbnailQualitySettings() {
  const q = state.settings.thumbnailCacheQuality || "medium";
  if (q === "low") return { max: 320, quality: 0.72 };
  if (q === "high") return { max: 720, quality: 0.86 };
  return { max: 480, quality: 0.80 };
}
function thumbKeyForAsset(asset) {
  if (!asset) return "";
  const stable = [asset.source || "remote", asset.id || "", asset.url || "", asset.thumbnailUrl || "", asset.previewUrl || "", asset.filename || "", asset.localPath || "", asset.createdAt || "", asset.ext || ""].join("|");
  let h = 2166136261;
  for (let i = 0; i < stable.length; i++) { h ^= stable.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `thumb:${asset.source || "remote"}:${(h >>> 0).toString(36)}:${String(asset.id || asset.filename || "asset").slice(0, 64)}`;
}
async function openThumbDb() {
  if (!thumbCacheDbPromise) thumbCacheDbPromise = openDirDb();
  return thumbCacheDbPromise;
}
async function idbGetThumb(key) {
  if (!key) return null;
  try {
    const db = await openThumbDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(THUMB_STORE, "readonly");
      const req = tx.objectStore(THUMB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error("Thumbnail cache get failed"));
    });
  } catch (_) { return null; }
}
async function idbPutThumb(key, entry) {
  if (!key || !entry?.blob) return;
  try {
    const db = await openThumbDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(THUMB_STORE, "readwrite");
      tx.objectStore(THUMB_STORE).put(entry, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Thumbnail cache put failed"));
    });
  } catch (_) {}
}
async function idbClearThumbs() {
  try {
    const db = await openThumbDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(THUMB_STORE, "readwrite");
      tx.objectStore(THUMB_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Thumbnail cache clear failed"));
    });
  } catch (_) {}
  for (const url of thumbMemoryUrls.values()) { try { URL.revokeObjectURL(url); } catch (_) {} }
  thumbMemoryUrls.clear();
  thumbKnownMissing.clear();
  thumbBuildInFlight.clear();
}
function thumbObjectUrlFromEntry(key, entry) {
  if (!entry?.blob) return "";
  if (thumbMemoryUrls.has(key)) return thumbMemoryUrls.get(key);
  try {
    const url = URL.createObjectURL(entry.blob);
    thumbMemoryUrls.set(key, url);
    return url;
  } catch (_) { return ""; }
}
function lightweightPreviewUrl(asset) {
  if (!asset) return "";
  const raw = asset.thumbnailUrl || asset.previewUrl || asset.posterUrl || "";
  if (!raw || looksLikeVideoUrl(raw)) return "";
  return raw;
}
function initialGridImageUrl(asset) {
  if (!asset) return "";
  const light = lightweightPreviewUrl(asset);
  if ((asset.kind || "image") === "video") return light;
  if (thumbnailCacheEnabled() && !thumbnailFullGridEnabled()) return light;
  return mediaFullUrl(asset) || light || "";
}
function thumbnailSourceUrl(asset) {
  if (!asset) return "";
  const light = lightweightPreviewUrl(asset);
  if ((asset.kind || "image") === "video") return light;
  return light || mediaFullUrl(asset) || "";
}
async function fetchBlobForThumbnail(asset) {
  if (!asset) return null;
  if (asset.source === "local" && asset.file && (asset.kind || "image") !== "video") return asset.file;
  const url = thumbnailSourceUrl(asset);
  if (!url || looksLikeVideoUrl(url)) return null;
  const fetchOnce = async () => {
    const res = await fetch(url, { credentials: "include", cache: "force-cache", redirect: "follow" });
    if (!res.ok) throw new Error(`thumbnail HTTP ${res.status}`);
    const type = res.headers.get("content-type") || "";
    if (/text\/html|application\/json|image\/svg/i.test(type)) throw new Error(`not thumbnail media: ${type}`);
    return await res.blob();
  };
  try {
    return await fetchOnce();
  } catch (firstError) {
    const src = sourceFromAsset(asset);
    if (src === "local") throw firstError;
    await ensureSourceTab(src, { force: true, active: false });
    await delayMs(1200);
    return await fetchOnce();
  }
}
async function resizeThumbBlob(sourceBlob) {
  if (!sourceBlob || !/^image\//i.test(sourceBlob.type || "image/")) return sourceBlob;
  const { max, quality } = thumbnailQualitySettings();
  let bitmap = null;
  try { bitmap = await createImageBitmap(sourceBlob); }
  catch (_) { return sourceBlob; }
  try {
    const scale = Math.min(1, max / Math.max(bitmap.width || max, bitmap.height || max));
    const w = Math.max(1, Math.round((bitmap.width || max) * scale));
    const h = Math.max(1, Math.round((bitmap.height || max) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d", { alpha: true });
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", quality));
    return blob || sourceBlob;
  } finally {
    try { bitmap.close?.(); } catch (_) {}
  }
}
async function ensureThumbnailForAsset(asset, imgEl = null, { force = false } = {}) {
  if (!asset || !thumbnailCacheEnabled()) return "";
  const isVideo = (asset.kind || "image") === "video";
  const sourceUrl = thumbnailSourceUrl(asset);
  if (isVideo && !sourceUrl) return "";
  const key = thumbKeyForAsset(asset);
  if (!key) return "";
  if (!force && thumbMemoryUrls.has(key)) {
    const url = thumbMemoryUrls.get(key);
    if (imgEl && url && imgEl.src !== url) imgEl.src = url;
    return url;
  }
  if (!force && thumbKnownMissing.has(key)) return "";
  if (thumbBuildInFlight.has(key)) return thumbBuildInFlight.get(key);
  const job = (async () => {
    try {
      if (!force) {
        const cached = await idbGetThumb(key);
        const cachedUrl = thumbObjectUrlFromEntry(key, cached);
        if (cachedUrl) {
          if (imgEl && imgEl.isConnected && imgEl.closest?.(`[data-id="${cssEscapeValue(asset.id)}"]`)) imgEl.src = cachedUrl;
          return cachedUrl;
        }
      }
      if (!thumbnailAutoBuildEnabled() && !force) { thumbKnownMissing.add(key); return ""; }
      const srcBlob = await fetchBlobForThumbnail(asset);
      if (!srcBlob) { thumbKnownMissing.add(key); return ""; }
      const blob = await resizeThumbBlob(srcBlob);
      await idbPutThumb(key, { blob, type: blob.type || srcBlob.type || "image/webp", sourceUrl, sourceId: asset.id, updatedAt: Date.now() });
      const url = thumbObjectUrlFromEntry(key, { blob });
      if (imgEl && imgEl.isConnected && imgEl.closest?.(`[data-id="${cssEscapeValue(asset.id)}"]`)) imgEl.src = url;
      return url;
    } catch (_) {
      thumbKnownMissing.add(key);
      return "";
    } finally {
      thumbBuildInFlight.delete(key);
    }
  })();
  thumbBuildInFlight.set(key, job);
  return job;
}
function setupThumbnailObserver() {
  if (thumbHydrationObserver) return thumbHydrationObserver;
  thumbHydrationObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const img = entry.target;
      thumbHydrationObserver.unobserve(img);
      const id = img.closest?.(".card[data-id]")?.dataset?.id;
      const asset = assetById(id);
      if (asset) ensureThumbnailForAsset(asset, img).catch(() => {});
    }
  }, { rootMargin: "480px 0px", threshold: 0.01 });
  return thumbHydrationObserver;
}
function hydrateVisibleThumbnails({ force = false } = {}) {
  if (!thumbnailCacheEnabled()) return;
  const imgs = $$("#grid .card[data-id] .preview img[data-thumb-cache]");
  if (force) {
    imgs.slice(0, 80).forEach(img => {
      const id = img.closest?.(".card[data-id]")?.dataset?.id;
      const asset = assetById(id);
      if (asset) ensureThumbnailForAsset(asset, img, { force: true }).catch(() => {});
    });
    return;
  }
  if (!thumbnailAutoBuildEnabled()) return;
  const obs = setupThumbnailObserver();
  imgs.forEach(img => obs.observe(img));
}

async function hasDirPermission(handle) {
  if (!handle) return false;
  const opts = { mode: "readwrite" };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  return (await handle.requestPermission(opts)) === "granted";
}
async function selectZipDirectory() {
  if (!("showDirectoryPicker" in window)) throw new Error("Folder picker unavailable in this browser/page");
  const handle = await window.showDirectoryPicker({ id: "chatgpt-images-zip-output", mode: "readwrite" });
  if (!(await hasDirPermission(handle))) throw new Error("Folder permission denied");
  zipDirectoryHandle = handle;
  await idbPutDirHandle(handle);
  return handle;
}

function runtimeMessage(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, response => {
        const err = chrome.runtime.lastError;
        if (err) {
          resolve({ ok: false, error: err.message || String(err), transportError: true });
          return;
        }
        resolve(response ?? { ok: false, error: "Extension returned no response", transportError: true });
      });
    } catch (e) {
      resolve({ ok: false, error: e?.message || String(e), transportError: true });
    }
  });
}

function delayMs(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function sourceFromAsset(asset = null) {
  const src = String(asset?.source || activeSource() || "chatgpt");
  return src === "grok" ? "grok" : src === "local" ? "local" : "chatgpt";
}

async function ensureSourceTab(source = null, { force = false, active = false } = {}) {
  const src = source || activeSource();
  if (src === "local") return { ok: true, source: "local" };
  const now = Date.now();
  if (!force && sourceEnsureInFlight) return sourceEnsureInFlight;
  if (!force && now - lastSourceEnsureAt < 45000) return { ok: true, throttled: true, source: src };
  lastSourceEnsureAt = now;
  sourceEnsureInFlight = runtimeMessage({
    type: "ENSURE_SOURCE_TAB",
    source: src,
    grokMode: state.settings.grokMode || "imagen",
    active: !!active
  }).catch(e => ({ ok: false, error: e.message || String(e), source: src }))
    .finally(() => { sourceEnsureInFlight = null; });
  return sourceEnsureInFlight;
}

function startSourceKeepAlive() {
  clearInterval(sourceKeepAliveTimer);
  const tick = () => {
    if (document.hidden) return;
    const src = activeSource();
    if (src === "local") return;
    ensureSourceTab(src, { force: false, active: false }).catch(() => {});
  };
  tick();
  sourceKeepAliveTimer = setInterval(tick, 60000);
}

function safeText(s) {
  return String(s ?? "").replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
}
function safeAttr(s) { return safeText(s); }

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
    .map(p => sanitizeSegment(p, "folder"))
    .join("/") || "asset";
}
function statusFor(asset) { return asset?.source === "local" ? "downloaded" : (state.statuses[asset.id]?.state || "missing"); }
function dateOnly(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}
function extFromMime(mime, bytes, fallback = "png") {
  const m = String(mime || "").toLowerCase();
  if (m.includes("mp4")) return "mp4";
  if (m.includes("png")) return "png";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("webp")) return "webp";
  if (bytes && bytes.length >= 12) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "webp";
    if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return "mp4";
  }
  return fallback || "png";
}
function validateBytes(buffer, contentType, asset = {}) {
  const bytes = new Uint8Array(buffer.slice(0, Math.min(buffer.byteLength, 64)));
  const mime = String(contentType || asset.mimeType || "").toLowerCase();
  const ascii = new TextDecoder("utf-8", { fatal: false }).decode(bytes).toLowerCase().trim();
  if (mime.includes("text/html") || mime.includes("application/json") || mime.includes("image/svg") || ascii.startsWith("<") || ascii.startsWith("{") || ascii.startsWith("[")) {
    throw new Error(`not a media binary (${contentType || "unknown content-type"})`);
  }
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isWebp = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  const isMp4 = bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
  if (!isPng && !isJpg && !isWebp && !isMp4) throw new Error(`bad magic bytes (${contentType || "unknown content-type"})`);
  if (buffer.byteLength < 256) throw new Error("file too small to be generated media");
  if (isMp4) return { ext: "mp4", mime: "video/mp4" };
  return { ext: extFromMime(contentType, bytes), mime: isPng ? "image/png" : isJpg ? "image/jpeg" : "image/webp" };
}

async function fetchValidatedImage(asset) {
  if (cancelRequested) throw new Error("cancelled");
  if (!asset || !asset.url) throw new Error("missing URL");
  let parsed;
  try { parsed = new URL(asset.url); } catch (_) { throw new Error("invalid URL"); }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error(`invalid URL protocol: ${parsed.protocol}`);
  if (asset.source !== "grok") {
    if (!/\/backend-api\/estuary\/content$/.test(parsed.pathname) || !/^file_[A-Za-z0-9_-]+$/.test(parsed.searchParams.get("id") || "")) {
      throw new Error("not a ChatGPT full image content URL");
    }
  } else {
    if (!/(^|\.)grok\.com$|(^|\.)x\.ai$/.test(parsed.hostname)) throw new Error("not a Grok media URL");
  }
  if (/\.svg(?:[?#]|$)|\.html?(?:[?#]|$)|\.json(?:[?#]|$)|oaistatic\.com|\/_next\/static\/|avatar|profile|icon|logo|favicon|sprite/i.test(asset.url)) {
    throw new Error("rejected non-generation URL before fetch");
  }
  activeAbortController = new AbortController();
  const res = await fetch(asset.url, { method: "GET", credentials: "include", cache: "no-store", redirect: "follow", signal: activeAbortController.signal });
  activeAbortController = null;
  const contentType = res.headers.get("content-type") || asset.mimeType || "";
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (/text\/html|application\/json|image\/svg/i.test(contentType)) throw new Error(`not media binary: ${contentType}`);
  const buffer = await res.arrayBuffer();
  const detected = validateBytes(buffer, contentType, asset);
  const blob = new Blob([buffer], { type: detected.mime });
  return { buffer, blob, ext: detected.ext, mime: detected.mime, bytes: buffer.byteLength };
}


async function setStatusPatches(patches) {
  await runtimeMessage({ type: "SET_STATUSES", patches });
  const changedIds = Object.keys(patches || {});
  for (const [id, patch] of Object.entries(patches || {})) state.statuses[id] = { ...(state.statuses[id] || {}), ...patch };
  // Keep counters/buttons/cards live during long jobs without rebuilding thousands of cards.
  try {
    filteredList = filteredAssetsFull();
    currentList = applyViewSlice();
    for (const id of changedIds) syncCardStatusDom(id);
    renderStats();
    updateActionButtons();
  } catch (_) {}
}
function updateCancelButton() {
  const btn = $("#cancelProgress");
  if (!btn) return;
  btn.disabled = !busy || cancelRequested;
  btn.classList.toggle("inactive", !busy || cancelRequested);
}
function showProgress(title, value = 0, max = 100, log = "") {
  $("#progress").hidden = false;
  $("#progressTitle").textContent = title;
  $("#progressBar").max = max;
  $("#progressBar").value = value;
  $("#progressLog").textContent = log;
  updateCancelButton();
}
function hideProgress() { $("#progress").hidden = true; updateCancelButton(); }
function requestCancel() {
  if (!busy || cancelRequested) return;
  cancelRequested = true;
  try { activeAbortController?.abort(); } catch (_) {}
  runtimeMessage({ type: "CANCEL_SYNC" }).catch(() => {});
  showProgress("Cancelling...", $("#progressBar").value || 0, $("#progressBar").max || 1, "Current operation will stop at the next safe point.");
}

async function refreshState(options = {}) {
  const fullRender = options.fullRender !== false;
  const res = await runtimeMessage({ type: "GET_STATE" });
  if (res?.ok) {
    state = { ...res, collections: res.collections || {}, itemCollections: res.itemCollections || {}, ratings: normalizeRatingsState(res.ratings || {}), storyboards: normalizeStoryboardsState(res.storyboards || {}), canvases: normalizeCanvasesState(res.canvases || {}), settings: normalizeSettings({ ...DEFAULT_SETTINGS, ...(res.settings || {}) }) };
    markCollectionsDirty();
    // v2.20: deprecated experimental live/generation watchers stay off even if older builds saved them.
    state.settings.liveCapture = false;
    state.settings.generationWatch = false;
    if (state.settings.activeSource === "grok" && (state.settings.folder === SOURCE_DEFAULT_FOLDERS.chatgpt.folder || state.settings.archiveFolder === SOURCE_DEFAULT_FOLDERS.chatgpt.archiveFolder)) {
      state.settings = setSourceDefaultFolders("grok");
      runtimeMessage({ type: "SAVE_SETTINGS", settings: { ...state.settings } }).catch(() => {});
    }
    const active = document.activeElement;
    const keepUserEdits = Date.now() < suppressControlRefreshUntil || !!active?.closest?.(".settings, .viewbar, .filter-row, .collection-row, .stats");
    if (!keepUserEdits) {
      const setValue = (id, value) => { const el = $("#" + id); if (el) el.value = value; };
      const setChecked = (id, value) => { const el = $("#" + id); if (el) el.checked = !!value; };
      setValue("folder", state.settings.folder);
      setValue("archiveFolder", state.settings.archiveFolder);
      setValue("zipPartMb", state.settings.zipPartMb);
      setValue("maxImages", state.settings.maxImages || ((state.settings.maxReplayPages || 300) * 25));
      setValue("folderStructure", state.settings.folderStructure || "flat");
      setValue("grokMode", state.settings.grokMode || "imagen");
      setValue("grokMedia", state.settings.grokMedia || "both");
      setValue("collectionFilter", state.settings.collectionFilter || "all");
      setValue("localViewMode", state.settings.localViewMode || "folder");
      setValue("localMaxFiles", state.settings.localMaxFiles || DEFAULT_SETTINGS.localMaxFiles);
      setChecked("grokVideoThumbs", !!state.settings.grokVideoThumbs);
      setChecked("thumbnailCache", state.settings.thumbnailCache !== false);
      setChecked("thumbnailCacheAutoBuild", state.settings.thumbnailCacheAutoBuild !== false);
      setChecked("thumbnailCacheFullGrid", !!state.settings.thumbnailCacheFullGrid);
      setValue("thumbnailCacheQuality", state.settings.thumbnailCacheQuality || "medium");
      setValue("viewMode", state.settings.viewMode || "grid");
      setValue("pageMode", state.settings.pageMode || "infinite");
      setValue("pageSize", state.settings.pageSize || 100);
      updateGridScaleControls(state.settings.gridScale || DEFAULT_SETTINGS.gridScale);
      setChecked("chooseFolderOnce", state.settings.chooseFolderOnce !== false);
    }
  }
  if (fullRender) render();
  else renderShellOnly();
  return res;
}
function activeSource() { return state.settings.activeSource || "chatgpt"; }
function grokModeValue() { return state.settings.grokMode || "imagen"; }
function grokModeLabel(mode = grokModeValue()) { return mode === "both" ? "Imagen + Boards" : mode === "boards" ? "Boards" : "Imagen"; }
function mediaLabel(value = state.settings.grokMedia || "both") { return value === "images" ? "Images" : value === "videos" ? "Videos" : "Images + videos"; }
function nearestGridScale(value) {
  const n = Number(value || DEFAULT_SETTINGS.gridScale);
  return GRID_SCALES.reduce((best, v) => Math.abs(v - n) < Math.abs(best - n) ? v : best, GRID_SCALES[2]);
}

function isLocalSource() { return activeSource() === "local"; }
function sleepFrame() { return new Promise(resolve => setTimeout(resolve, 0)); }
function normalizeLocalPath(path = "") {
  return String(path || "")
    .split("/")
    .map(part => part.trim())
    .filter(Boolean)
    .join("/")
    .slice(0, 1000);
}
function localPathLabel(path = "", rootName = "Local folder") {
  const clean = normalizeLocalPath(path);
  return clean ? clean : `/ ${rootName || "Local folder"}`;
}
function shouldSkipLocalDirectory(name = "") {
  return /^\./.test(String(name || "")) || ["node_modules", ".git", "__pycache__"].includes(String(name || "").toLowerCase());
}
function ensureLocalObjectUrl(asset) {
  if (!asset || asset.source !== "local") return "";
  if (!asset.url && asset.file) {
    try {
      const url = URL.createObjectURL(asset.file);
      localObjectUrls.add(url);
      asset.url = url;
      if ((asset.kind || "image") !== "video") asset.previewUrl = asset.previewUrl || url;
    } catch (_) {}
  }
  return asset.url || asset.previewUrl || "";
}
function mediaFullUrl(asset) {
  if (!asset) return "";
  if (asset.source === "local") return ensureLocalObjectUrl(asset) || asset.url || asset.previewUrl || asset.thumbnailUrl || "";
  // Full media must prefer the real source URL. v2.28.5 accidentally preferred previewUrl first,
  // which caused low-res square crops and video thumbnails to be used as the actual preview source.
  return asset.url || asset.fullUrl || asset.mediaUrl || asset.originalUrl || asset.previewUrl || asset.thumbnailUrl || "";
}
function mediaPreviewUrl(asset) {
  if (!asset) return "";
  const isVideo = (asset.kind || "image") === "video";
  const preview = asset.thumbnailUrl || asset.previewUrl || asset.posterUrl || "";
  if (isVideo) return looksLikeVideoUrl(preview) ? "" : preview;
  if (asset.source === "local") return preview || ensureLocalObjectUrl(asset) || asset.url || "";
  return preview || asset.url || "";
}
function looksLikeVideoUrl(raw = "") {
  const s = String(raw || "").toLowerCase();
  return /(?:^|[\/._-])(mp4|webm|mov|m4v)(?:$|[?#&])/.test(s) || /video/.test(s);
}
function videoPosterAttr(asset, fullUrl = "") {
  const poster = mediaPreviewUrl(asset);
  if (!poster || poster === fullUrl || looksLikeVideoUrl(poster)) return "";
  return ` poster="${safeAttr(poster)}"`;
}
function localMediaKind(file) {
  const type = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();
  if (type.startsWith("video/") || /\.(mp4|webm|mov|m4v|avi|mkv)$/i.test(name)) return "video";
  return "image";
}
function isSupportedLocalMedia(file) {
  const type = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();
  return type.startsWith("image/") || type.startsWith("video/") || /\.(png|jpe?g|webp|gif|bmp|avif|mp4|webm|mov|m4v)$/i.test(name);
}

function cleanLocalRootName(name = "Local root") {
  return String(name || "Local root").replace(/[\n\r\t]+/g, " ").trim().slice(0, 80) || "Local root";
}
function makeLocalRootId() {
  return `root_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
function normalizeLocalRootsList(list = []) {
  const out = [];
  const seen = new Set();
  for (const root of Array.isArray(list) ? list : []) {
    const id = String(root?.id || "").slice(0, 80);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: cleanLocalRootName(root?.name || root?.label || "Local root") });
  }
  return out.slice(0, 12);
}
function localScanLimit() {
  const raw = Number(state.settings.localMaxFiles || DEFAULT_SETTINGS.localMaxFiles || LOCAL_SCAN_DEFAULT_LIMIT);
  if (!Number.isFinite(raw) || raw <= 0) return LOCAL_SCAN_DEFAULT_LIMIT;
  return Math.max(25, Math.min(100000, Math.floor(raw)));
}
function activeLocalRoot() {
  const roots = normalizeLocalRootsList(state.settings.localRoots || []);
  let id = state.settings.localRootId || roots[0]?.id || "";
  if (id && !roots.some(r => r.id === id)) id = roots[0]?.id || "";
  return roots.find(r => r.id === id) || roots[0] || null;
}
function setLocalRoots(nextRoots, activeId = "") {
  const roots = normalizeLocalRootsList(nextRoots);
  state.settings.localRoots = roots;
  state.settings.localRootId = activeId && roots.some(r => r.id === activeId) ? activeId : (roots[0]?.id || "");
  const active = activeLocalRoot();
  state.settings.localFolderLabel = active?.name || state.settings.localFolderLabel || "";
}
async function getActiveLocalRootHandle() {
  let root = activeLocalRoot();
  if (!root) {
    const legacy = localDirectoryHandle || await idbGetHandleByKey(LOCAL_DIR_KEY);
    if (!legacy) return null;
    const id = "legacy";
    localRootHandles.set(id, legacy);
    setLocalRoots([{ id, name: cleanLocalRootName(legacy.name || state.settings.localFolderLabel || "Local root") }], id);
    await idbPutHandleByKey(LOCAL_ROOT_PREFIX + id, legacy);
    return legacy;
  }
  if (localRootHandles.has(root.id)) return localRootHandles.get(root.id);
  let handle = await idbGetHandleByKey(LOCAL_ROOT_PREFIX + root.id);
  if (!handle && root.id === "legacy") handle = await idbGetHandleByKey(LOCAL_DIR_KEY);
  if (handle) localRootHandles.set(root.id, handle);
  return handle || null;
}
async function chooseLocalRoot({ append = false } = {}) {
  const handle = await window.showDirectoryPicker({ id: append ? "cgpt-grok-local-media-add" : "cgpt-grok-local-media", mode: "read" });
  const opts = { mode: "read" };
  if ((await handle.queryPermission(opts)) !== "granted" && (await handle.requestPermission(opts)) !== "granted") throw new Error("Folder permission denied");
  const id = makeLocalRootId();
  const name = cleanLocalRootName(handle.name || "Local root");
  const roots = append ? normalizeLocalRootsList(state.settings.localRoots || []) : [];
  roots.push({ id, name });
  setLocalRoots(roots, id);
  localRootHandles.set(id, handle);
  localDirectoryHandle = handle;
  await idbPutHandleByKey(LOCAL_ROOT_PREFIX + id, handle);
  await idbPutHandleByKey(LOCAL_DIR_KEY, handle);
  state.settings.localFolderPath = "";
  state.settings.localFolderLabel = name;
  localDirectoryOptions = [];
  localImmediateDirectories = [];
  return handle;
}
function renderLocalRootSelect() {
  const picker = $("#localRootSelect");
  if (!picker) return;
  const roots = normalizeLocalRootsList(state.settings.localRoots || []);
  const active = activeLocalRoot();
  if (!roots.length) {
    picker.innerHTML = `<option value="">No root selected</option>`;
    picker.disabled = true;
    return;
  }
  picker.disabled = false;
  picker.innerHTML = roots.map(root => `<option value="${safeAttr(root.id)}" ${root.id === active?.id ? "selected" : ""}>${safeText(root.name)}</option>`).join("");
  picker.value = active?.id || roots[0]?.id || "";
  picker.title = picker.selectedOptions?.[0]?.textContent || "Local root";
}
async function listImmediateLocalDirectories(rootHandle, path = "") {
  const selectedHandle = await getLocalDirectoryHandleByPath(rootHandle, path);
  const dirs = [];
  let seen = 0;
  for await (const [name, entry] of selectedHandle.entries()) {
    if (cancelRequested) break;
    if (entry.kind === "directory" && !shouldSkipLocalDirectory(name)) {
      const rel = normalizeLocalPath(path ? `${path}/${name}` : name);
      dirs.push({ name, path: rel });
    }
    if (++seen % 120 === 0) await sleepFrame();
  }
  dirs.sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: "base" }));
  return dirs;
}
function parentLocalPath(path = "") {
  const parts = normalizeLocalPath(path).split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}
function renderLocalFolderBar() {
  const bar = $("#localFolderBar");
  if (!bar) return;
  const srcLocal = activeSource() === "local";
  bar.classList.toggle("hidden", !srcLocal);
  if (!srcLocal) return;
  const pinned = !!state.settings.localFolderBarPinned;
  bar.classList.toggle("pinned", pinned);
  const pinBtn = $("#localFolderPin");
  if (pinBtn) {
    pinBtn.classList.toggle("active", pinned);
    pinBtn.textContent = pinned ? "Pinned" : "Pin";
    pinBtn.title = pinned ? "Unpin folder bar" : "Keep folder bar visible while scrolling";
  }
  const root = activeLocalRoot();
  const path = normalizeLocalPath(state.settings.localFolderPath || "");
  const pathBox = $("#localBreadcrumb");
  if (pathBox) {
    if (!root) {
      pathBox.innerHTML = `<span class="local-breadcrumb-empty">Choose root first</span>`;
    } else {
      const parts = path.split("/").filter(Boolean);
      let acc = "";
      const crumbs = [`<button type="button" class="local-crumb ${!path ? "active" : ""}" data-path="">Main</button>`];
      for (const part of parts) {
        acc = acc ? `${acc}/${part}` : part;
        crumbs.push(`<span class="local-crumb-sep">/</span><button type="button" class="local-crumb ${acc === path ? "active" : ""}" data-path="${safeAttr(acc)}">${safeText(part)}</button>`);
      }
      pathBox.innerHTML = crumbs.join("");
    }
  }
  const tiles = $("#localFolderTiles");
  if (tiles) {
    const up = path ? `<button type="button" class="local-folder-tile parent" data-path="${safeAttr(parentLocalPath(path))}">..</button>` : "";
    const folderTiles = (localImmediateDirectories || []).map(dir => `<button type="button" class="local-folder-tile" data-path="${safeAttr(dir.path)}" title="${safeAttr(dir.path)}"><span class="folder-icon">▰</span><span>${safeText(dir.name)}</span></button>`).join("");
    tiles.innerHTML = up + (folderTiles || `<span class="local-folder-empty">No subfolders</span>`);
  }
}

function revokeLocalObjectUrls() {
  for (const url of localObjectUrls) {
    try { URL.revokeObjectURL(url); } catch (_) {}
  }
  localObjectUrls.clear();
}
async function getLocalDirectoryHandleByPath(rootHandle, path = "") {
  let handle = rootHandle;
  const parts = normalizeLocalPath(path).split("/").filter(Boolean);
  for (const part of parts) handle = await handle.getDirectoryHandle(part);
  return handle;
}
async function enumerateLocalDirectories(rootHandle) {
  const rootName = rootHandle?.name || "Local folder";
  const out = [{ path: "", label: `/ ${rootName}`, depth: 0 }];
  async function walk(handle, prefix = "", depth = 1) {
    if (cancelRequested || out.length >= LOCAL_DIR_LIMIT || depth > 6) return;
    const dirs = [];
    let seen = 0;
    for await (const [name, entry] of handle.entries()) {
      if (cancelRequested || out.length >= LOCAL_DIR_LIMIT) break;
      if (entry.kind === "directory" && !shouldSkipLocalDirectory(name)) dirs.push([name, entry]);
      if (++seen % 120 === 0) await sleepFrame();
    }
    dirs.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    for (const [name, entry] of dirs) {
      if (cancelRequested || out.length >= LOCAL_DIR_LIMIT) break;
      const rel = prefix ? `${prefix}/${name}` : name;
      out.push({ path: rel, label: `${"  ".repeat(Math.min(depth, 4))}${name}/`, depth });
      await walk(entry, rel, depth + 1);
    }
  }
  await walk(rootHandle);
  return out;
}
async function scanLocalDirectory(handle, prefix = "", options = {}) {
  const maxFiles = Math.max(25, Number(options.maxFiles || localScanLimit()));
  const batchSize = Math.max(25, Number(options.batchSize || LOCAL_SCAN_BATCH_SIZE));
  const recursive = !!options.recursive;
  const out = [];
  let batch = [];
  let truncated = false;
  let seen = 0;
  async function flushBatch(force = false) {
    if (!batch.length || !options.onBatch) return;
    if (!force && batch.length < batchSize) return;
    const chunk = batch;
    batch = [];
    await options.onBatch(chunk, out.length, { truncated });
    await sleepFrame();
  }
  async function addFile(name, entry, currentPrefix) {
    const file = await entry.getFile();
    if (!isSupportedLocalMedia(file)) return true;
    const rel = normalizeLocalPath(currentPrefix ? `${currentPrefix}/${name}` : name);
    const item = { file, rel };
    out.push(item);
    batch.push(item);
    if (out.length % batchSize === 0) {
      showProgress("Local Files", Math.min(out.length, maxFiles), maxFiles, `Scanning... ${out.length} media indexed`);
      await flushBatch(true);
    }
    if (out.length >= maxFiles) {
      truncated = true;
      return false;
    }
    return true;
  }
  async function walk(dirHandle, currentPrefix = "", depth = 0) {
    const files = [];
    const dirs = [];
    for await (const [name, entry] of dirHandle.entries()) {
      if (cancelRequested || truncated) break;
      if (++seen % 150 === 0) await sleepFrame();
      if (entry.kind === "file") files.push([name, entry]);
      else if (recursive && entry.kind === "directory" && !shouldSkipLocalDirectory(name)) dirs.push([name, entry]);
    }
    files.sort((a, b) => String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true, sensitivity: "base" }));
    for (const [name, entry] of files) {
      if (cancelRequested || truncated) break;
      const keepGoing = await addFile(name, entry, currentPrefix);
      if (!keepGoing) break;
    }
    if (recursive && !truncated) {
      dirs.sort((a, b) => String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true, sensitivity: "base" }));
      for (const [name, entry] of dirs) {
        if (cancelRequested || truncated) break;
        const nextPrefix = normalizeLocalPath(currentPrefix ? `${currentPrefix}/${name}` : name);
        await walk(entry, nextPrefix, depth + 1);
      }
    }
  }
  await walk(handle, prefix, 0);
  await flushBatch(true);
  out.sort((a, b) => Number(b.file?.lastModified || 0) - Number(a.file?.lastModified || 0));
  return { files: out, truncated };
}
function buildLocalAsset({ file, rel }, selectedPath = "", rootName = "Local root") {
  const ext = (file.name.split(".").pop() || (file.type.split("/")[1] || "file")).toLowerCase();
  const id = `local:${rel}:${file.size}:${file.lastModified}`;
  const kind = localMediaKind(file);
  return {
    id,
    source: "local",
    sourceApi: "local-folder",
    kind,
    url: "",
    previewUrl: "",
    file,
    filename: file.name,
    ext,
    mimeType: file.type || (kind === "video" ? "video/*" : "image/*"),
    bytes: file.size,
    createdAt: new Date(file.lastModified || Date.now()).toISOString(),
    prompt: rel,
    localPath: rel,
    folderName: selectedPath || rootName || "Local root"
  };
}
function addLocalFileEntries(entries, selectedPath = "", rootName = "Local root") {
  let added = 0;
  for (const item of entries) {
    const asset = buildLocalAsset(item, selectedPath, rootName);
    if (!localCatalog[asset.id]) added += 1;
    localCatalog[asset.id] = asset;
  }
  return added;
}
function renderLocalDirectoryPicker() {
  const picker = $("#localFolderPath");
  if (!picker) return;
  const rootName = state.settings.localFolderLabel || "Local folder";
  const selected = normalizeLocalPath(state.settings.localFolderPath || "");
  if (!localDirectoryOptions.length) {
    picker.innerHTML = `<option value="">${safeText(rootName ? `/ ${rootName}` : "Choose root first")}</option>`;
    picker.disabled = !localDirectoryHandle;
    return;
  }
  picker.disabled = false;
  picker.innerHTML = localDirectoryOptions.map(opt => `<option value="${safeAttr(opt.path)}" ${opt.path === selected ? "selected" : ""}>${safeText(opt.label)}</option>`).join("");
  picker.value = localDirectoryOptions.some(opt => opt.path === selected) ? selected : "";
  picker.title = localPathLabel(picker.value, rootName);
}
async function loadLocalDirectory({ choose = false, addRoot = false, silent = false, rebuildFolders = false } = {}) {
  if (!("showDirectoryPicker" in window)) {
    showProgress("Local Files unavailable", 1, 1, "This browser/page does not provide direct folder access.");
    return;
  }
  try {
    busy = true; cancelRequested = false;
    const maxFiles = localScanLimit();
    showProgress("Local Files", 0, maxFiles, choose || addRoot ? "Choose the root local media folder, e.g. ComfyUI/output." : "Reading saved local folder permission.");
    let handle = null;
    if (choose || addRoot) {
      handle = await chooseLocalRoot({ append: !!addRoot });
    } else {
      handle = localDirectoryHandle || await getActiveLocalRootHandle();
    }
    if (!handle) {
      if (!choose && !addRoot && silent) { busy = false; renderLocalRootSelect(); renderLocalFolderBar(); return; }
      handle = await chooseLocalRoot({ append: false });
    }
    const opts = { mode: "read" };
    if ((await handle.queryPermission(opts)) !== "granted" && (await handle.requestPermission(opts)) !== "granted") throw new Error("Folder permission denied");
    localDirectoryHandle = handle;
    const root = activeLocalRoot();
    state.settings.localFolderLabel = root?.name || handle.name || "Local root";
    if (choose || addRoot) state.settings.localFolderPath = "";
    state.settings.localFolderPath = normalizeLocalPath(state.settings.localFolderPath || "");
    state.settings.localViewMode = state.settings.localViewMode === "all" ? "all" : "folder";

    if (choose || addRoot || rebuildFolders || !localDirectoryOptions.length) {
      localDirectoryOptions = [{ path: "", label: `/ ${handle.name || "Local root"}`, depth: 0 }];
    }

    let selectedPath = normalizeLocalPath(state.settings.localFolderPath || "");
    let selectedHandle;
    try {
      selectedHandle = await getLocalDirectoryHandleByPath(handle, selectedPath);
    } catch (_) {
      selectedPath = "";
      state.settings.localFolderPath = "";
      selectedHandle = handle;
    }
    await runtimeMessage({ type: "SAVE_SETTINGS", settings: { ...state.settings } });
    renderLocalRootSelect();
    renderLocalDirectoryPicker();
    try { localImmediateDirectories = await listImmediateLocalDirectories(handle, selectedPath); } catch (_) { localImmediateDirectories = []; }
    renderLocalFolderBar();

    const mode = state.settings.localViewMode === "all" ? "all" : "folder";
    const recursive = mode === "all";
    const scanLabel = recursive ? `${state.settings.localFolderLabel || handle.name || "Local root"} / all media` : localPathLabel(selectedPath, state.settings.localFolderLabel || handle.name || "Local root");
    showProgress("Local Files", 0, maxFiles, `Scanning ${recursive ? "all media" : "folder"}: ${scanLabel}`);
    revokeLocalObjectUrls();
    localCatalog = {};
    currentPage = 1;
    selectedIds.clear();
    render();

    let renderedAt = 0;
    const onBatch = async (batch, count, info = {}) => {
      addLocalFileEntries(batch, selectedPath, state.settings.localFolderLabel || handle.name || "Local root");
      localFilesTruncated = !!info.truncated;
      const now = Date.now();
      if (!renderedAt || now - renderedAt > 180 || count <= LOCAL_SCAN_BATCH_SIZE) {
        renderedAt = now;
        filteredList = filteredAssetsFull();
        currentList = applyViewSlice();
        renderStats();
        renderViewControls();
        renderGrid();
        updateActionButtons();
      }
    };
    const { files, truncated } = await scanLocalDirectory(selectedHandle, selectedPath, { maxFiles, batchSize: LOCAL_SCAN_BATCH_SIZE, recursive, onBatch });
    localFilesTruncated = truncated;
    if (!Object.keys(localCatalog).length && files.length) addLocalFileEntries(files, selectedPath, state.settings.localFolderLabel || handle.name || "Local root");
    busy = false;
    const suffix = truncated ? `Reached max local media: ${files.length}/${maxFiles}.` : `${files.length} local media files loaded.`;
    showProgress("Local Files ready", files.length, Math.max(1, maxFiles), `${suffix} Mode: ${recursive ? "All Media" : "Folder View"}. Folder: ${scanLabel}.`);
    render();
  } catch (e) {
    busy = false;
    if (e && (e.name === "AbortError" || /abort|cancel/i.test(e.message || ""))) {
      showProgress("Local Files unchanged", 1, 1, "Folder picker cancelled.");
      return;
    }
    showProgress("Local Files failed", 1, 1, e.message || String(e));
    renderLocalRootSelect();
    renderLocalFolderBar();
  }
}
function setSourceDefaultFolders(src) {
  const current = state.settings || {};
  const other = src === "grok" ? SOURCE_DEFAULT_FOLDERS.chatgpt : SOURCE_DEFAULT_FOLDERS.grok;
  const target = SOURCE_DEFAULT_FOLDERS[src] || SOURCE_DEFAULT_FOLDERS.chatgpt;
  const next = { ...current };
  if (!next.folder || next.folder === other.folder) next.folder = target.folder;
  if (!next.archiveFolder || next.archiveFolder === other.archiveFolder) next.archiveFolder = target.archiveFolder;
  return next;
}
function allAssets() {
  const src = activeSource();
  if (src === "local") return Object.values(localCatalog || {});
  return Object.values(state.catalog || {}).filter(a => {
    const itemSource = a.source || "chatgpt";
    if (itemSource !== src) return false;
    if (src === "grok") {
      const mode = state.settings.grokMode || "imagen";
      const media = state.settings.grokMedia || "both";
      if (mode !== "both" && (a.grokMode || "imagen") !== mode) return false;
      if (media === "images" && a.kind === "video") return false;
      if (media === "videos" && a.kind !== "video") return false;
    }
    return true;
  });
}
function filteredAssetsFull() {
  const q = query.trim().toLowerCase();
  const activeStoryboard = activeStoryboardObj();
  if (state.settings.storyboardView && activeStoryboard) {
    let ordered = storyboardAssetIds(activeStoryboard).map(id => assetById(id)).filter(Boolean);
    if (q) ordered = ordered.filter(a => `${a.prompt} ${a.createdAt} ${a.url} ${a.filename} ${a.source || ""} ${a.kind || ""}`.toLowerCase().includes(q));
    return ordered;
  }
  const collectionFilter = state.settings.collectionFilter || "all";
  const hiddenIds = hiddenMainCollectionSet();
  let list = allAssets().filter(a => {
    const st = statusFor(a);
    const passFilter = filter === "all" || st === filter;
    const ids = collectionIdsForItem(a.id);
    const isHiddenFromMain = ids.some(id => hiddenIds.has(id));
    const passCollection = collectionFilter === "all"
      ? !isHiddenFromMain
      : collectionFilter === "unassigned"
        ? ids.length === 0
        : collectionFilter === "hidden"
          ? isHiddenFromMain
          : ids.includes(collectionFilter);
    const collectionText = ids.map(id => state.collections?.[id]?.name || "").join(" ");
    const passQuery = !q || `${a.prompt} ${a.createdAt} ${a.url} ${a.filename} ${st} ${a.sourceApi} ${a.source || ""} ${a.kind || ""} ${a.boardName || ""} ${collectionText}`.toLowerCase().includes(q);
    return passFilter && passCollection && passQuery;
  });
  list.sort((a, b) => {
    if (sortMode === "oldest") return String(a.createdAt).localeCompare(String(b.createdAt));
    if (sortMode === "prompt") return String(a.prompt).localeCompare(String(b.prompt));
    if (sortMode === "status") return statusFor(a).localeCompare(statusFor(b)) || String(b.createdAt).localeCompare(String(a.createdAt));
    if (sortMode === "rating-desc") return (ratingForItem(b.id) || 0) - (ratingForItem(a.id) || 0) || String(b.createdAt).localeCompare(String(a.createdAt));
    if (sortMode === "rating-asc") return (ratingForItem(a.id) || 0) - (ratingForItem(b.id) || 0) || String(b.createdAt).localeCompare(String(a.createdAt));
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });
  return list;
}
function assetById(id) { return state.catalog?.[id] || localCatalog?.[id] || null; }
function selectedAssets() {
  return Array.from(selectedIds)
    .map(id => assetById(id))
    .filter(Boolean);
}
function selectedVisibleCount() {
  const visible = new Set(currentList.map(a => a.id));
  let n = 0;
  for (const id of selectedIds) if (visible.has(id)) n++;
  return n;
}
function pruneSelection() {
  for (const id of Array.from(selectedIds)) {
    if (!assetById(id)) selectedIds.delete(id);
  }
}

function normalizeCollectionsState(force = false) {
  if (!force && !collectionsDirty) return;
  if (!state.collections || typeof state.collections !== "object") state.collections = {};
  if (!state.itemCollections || typeof state.itemCollections !== "object") state.itemCollections = {};
  for (const [itemId, ids] of Object.entries(state.itemCollections)) {
    const clean = Array.from(new Set((Array.isArray(ids) ? ids : []).filter(id => state.collections?.[id])));
    if (clean.length) state.itemCollections[itemId] = clean;
    else delete state.itemCollections[itemId];
  }
  collectionsDirty = false;
}
function sortedCollections() {
  normalizeCollectionsState();
  return Object.values(state.collections).sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}
function collectionIdsForItem(itemId) {
  normalizeCollectionsState();
  const ids = state.itemCollections?.[itemId];
  return Array.isArray(ids) ? ids : [];
}
function collectionColor(id) {
  const col = state.collections?.[id];
  if (col?.color) return col.color;
  const ids = Object.keys(state.collections || {}).sort();
  const idx = Math.max(0, ids.indexOf(id));
  return COLLECTION_COLORS[idx % COLLECTION_COLORS.length];
}

function normalizeSettings(settings = {}) {
  const hidden = Array.isArray(settings.hiddenMainViewCollections) ? settings.hiddenMainViewCollections : [];
  const roots = normalizeLocalRootsList(settings.localRoots || []);
  const rootId = roots.some(r => r.id === settings.localRootId) ? settings.localRootId : (roots[0]?.id || "");
  const rawLocalMax = Number(settings.localMaxFiles || DEFAULT_SETTINGS.localMaxFiles || LOCAL_SCAN_DEFAULT_LIMIT);
  return {
    ...settings,
    localFolderPath: normalizeLocalPath(settings.localFolderPath || ""),
    localRoots: roots,
    localRootId: rootId,
    localViewMode: settings.localViewMode === "all" ? "all" : "folder",
    localMaxFiles: Number.isFinite(rawLocalMax) ? Math.max(25, Math.min(100000, Math.floor(rawLocalMax))) : LOCAL_SCAN_DEFAULT_LIMIT,
    localFolderBarPinned: !!settings.localFolderBarPinned,
    hiddenMainViewCollections: Array.from(new Set(hidden.map(x => String(x || "").slice(0, 128)).filter(Boolean))),
    storyboardActiveId: String(settings.storyboardActiveId || "").slice(0, 128),
    storyboardView: !!settings.storyboardView,
    canvasActiveId: String(settings.canvasActiveId || "").slice(0, 128),
    canvasView: !!settings.canvasView,
    canvasHideWorkMarks: !!settings.canvasHideWorkMarks
  };
}

function normalizeRatingValue(value) {
  const n = Math.round(Number(value) * 10) / 10;
  if (!Number.isFinite(n) || n < 1 || n > 5) return null;
  return Math.max(1, Math.min(5, n));
}
function normalizeRatingsState(input = {}) {
  const out = {};
  for (const [id, value] of Object.entries(input || {})) {
    const n = normalizeRatingValue(value);
    if (id && n != null) out[String(id)] = n;
  }
  return out;
}
function ratingForItem(itemId) {
  const n = normalizeRatingValue(state.ratings?.[itemId]);
  return n == null ? null : n;
}
function ratingText(value) {
  const n = normalizeRatingValue(value);
  return n == null ? "Unrated" : n.toFixed(1);
}
function ratingBadgeHtml(asset) {
  const n = ratingForItem(asset?.id);
  if (n == null) return "";
  return `<span class="badge badge-rating" title="Rating ${safeAttr(n.toFixed(1))}"><span class="badge-icon" aria-hidden="true">★</span><span class="badge-text">${safeText(n.toFixed(1))}</span></span>`;
}
function scheduleRatingsStateSave() {
  clearTimeout(ratingsSaveTimer);
  ratingsSaveTimer = setTimeout(() => {
    runtimeMessage({ type: "SET_RATINGS", ratings: normalizeRatingsState(state.ratings || {}) }).catch(() => {});
  }, 320);
}
function syncCardRatingDom(itemId) {
  const card = cardNodeForId(itemId);
  if (!card) return;
  const row = card.querySelector(".row");
  if (!row) return;
  const existing = row.querySelector(".badge-rating");
  const asset = assetById(itemId);
  const html = asset ? ratingBadgeHtml(asset) : "";
  if (html) {
    if (existing) existing.outerHTML = html;
    else row.insertAdjacentHTML("beforeend", html);
  } else if (existing) {
    existing.remove();
  }
}
function renderLightboxRating(asset) {
  const panel = $("#lightboxRatingPanel");
  const slider = $("#lightboxRatingSlider");
  const value = $("#lightboxRatingValue");
  const clear = $("#clearLightboxRating");
  if (!panel || !slider || !value) return;
  const rating = ratingForItem(asset?.id);
  slider.value = rating == null ? 1 : rating;
  slider.dataset.itemId = asset?.id || "";
  value.textContent = rating == null ? "Unrated" : rating.toFixed(1);
  panel.classList.toggle("is-unrated", rating == null);
  if (clear) clear.disabled = rating == null;
}
function syncRatingControlDom(itemId) {
  if (!itemId) return;
  const rating = ratingForItem(itemId);
  $$(`[data-rating-item-id="${cssEscapeValue(itemId)}"]`).forEach(root => {
    root.classList.toggle("is-unrated", rating == null);
    const slider = root.querySelector("[data-compare-rating]");
    const value = root.querySelector(".compare-rating-value");
    const clear = root.querySelector("[data-clear-compare-rating]");
    if (slider) slider.value = rating == null ? 1 : rating;
    if (value) value.textContent = rating == null ? "Unrated" : rating.toFixed(1);
    if (clear) clear.disabled = rating == null;
  });
}
function setItemRating(itemId, value) {
  if (!itemId || !assetById(itemId)) return;
  const n = normalizeRatingValue(value);
  state.ratings = normalizeRatingsState(state.ratings || {});
  if (n == null) delete state.ratings[itemId];
  else state.ratings[itemId] = n;
  syncCardRatingDom(itemId);
  syncRatingControlDom(itemId);
  const asset = currentList[lightboxIndex];
  if (asset?.id === itemId) renderLightboxRating(asset);
  scheduleRatingsStateSave();
}

// v2.30 Storyboard Alpha: lightweight ordered panel lists layered on top of the catalogue.
function normalizeStoryboardsState(input = {}) {
  const out = {};
  const src = input && typeof input === "object" ? input : {};
  for (const [rawId, rawBoard] of Object.entries(src)) {
    const id = String(rawId || rawBoard?.id || "").slice(0, 128);
    if (!id) continue;
    const name = String(rawBoard?.name || "Storyboard").trim().slice(0, 80) || "Storyboard";
    const items = (Array.isArray(rawBoard?.items) ? rawBoard.items : [])
      .map(entry => {
        const itemId = String((entry && typeof entry === "object" ? entry.id : entry) || "").slice(0, 160);
        if (!itemId) return null;
        return {
          id: itemId,
          note: String(entry?.note || "").slice(0, 500),
          fit: ["fit", "fill"].includes(entry?.fit) ? entry.fit : "fit"
        };
      })
      .filter(Boolean)
      .slice(0, 2000);
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
function sortedStoryboards() {
  state.storyboards = normalizeStoryboardsState(state.storyboards || {});
  return Object.values(state.storyboards).sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}
function activeStoryboardObj() {
  state.storyboards = normalizeStoryboardsState(state.storyboards || {});
  const id = state.settings.storyboardActiveId || "";
  return id && state.storyboards?.[id] ? state.storyboards[id] : null;
}
function storyboardAssetIds(board = activeStoryboardObj()) {
  return (board?.items || []).map(x => x.id).filter(Boolean);
}
function storyboardIndexForItem(itemId) {
  if (!state.settings.storyboardView) return 0;
  const ids = storyboardAssetIds();
  const idx = ids.indexOf(itemId);
  return idx >= 0 ? idx + 1 : 0;
}
function storyboardPanelNumberHtml(asset) {
  const n = storyboardIndexForItem(asset?.id);
  return n ? `<span class="storyboard-panel-number" title="Storyboard panel ${n}">${safeText(String(n).padStart(2, "0"))}</span>` : "";
}
async function saveStoryboardsState() {
  state.storyboards = normalizeStoryboardsState(state.storyboards || {});
  await runtimeMessage({ type: "SET_STORYBOARDS", storyboards: state.storyboards });
}
function scheduleStoryboardsStateSave() {
  clearTimeout(storyboardsSaveTimer);
  storyboardsSaveTimer = setTimeout(() => { saveStoryboardsState().catch(() => {}); }, 350);
}
function renderStoryboardControls() {
  const select = $("#storyboardSelect");
  const boards = sortedStoryboards();
  const active = state.settings.storyboardActiveId || "";
  if (select) {
    const html = `<option value="">No storyboard</option>` + boards.map(b => `<option value="${safeAttr(b.id)}">${safeText(b.name || "Storyboard")} (${(b.items || []).length})</option>`).join("");
    if (select.dataset.storyboardOptions !== html) {
      select.innerHTML = html;
      select.dataset.storyboardOptions = html;
    }
    select.value = state.storyboards?.[active] ? active : "";
  }
  const board = activeStoryboardObj();
  const status = $("#storyboardStatus");
  if (status) {
    status.textContent = board
      ? `${board.name || "Storyboard"}: ${(board.items || []).length} panel${(board.items || []).length === 1 ? "" : "s"}${state.settings.storyboardView ? " · viewing order" : ""}`
      : "Create a storyboard to order panels.";
  }
  const viewBtn = $("#toggleStoryboardView");
  if (viewBtn) {
    viewBtn.textContent = state.settings.storyboardView ? "Exit board" : "View board";
    viewBtn.classList.toggle("active", !!state.settings.storyboardView);
  }
  updateStoryboardButtonStates();
}
function updateStoryboardButtonStates() {
  const board = activeStoryboardObj();
  const hasBoard = !!board;
  const selected = selectedIds.size;
  const setDisabled = (id, disabled) => { const el = $("#" + id); if (el) el.disabled = !!disabled; };
  setDisabled("toggleStoryboardView", !hasBoard);
  setDisabled("addSelectedToStoryboard", !hasBoard || !selected);
  setDisabled("removeSelectedFromStoryboard", !hasBoard || !selected);
  setDisabled("moveStoryboardUp", !hasBoard || !selected || !state.settings.storyboardView);
  setDisabled("moveStoryboardDown", !hasBoard || !selected || !state.settings.storyboardView);
  setDisabled("exportStoryboard", !hasBoard);
}
async function createStoryboardPrompt() {
  const name = (prompt("Storyboard name:") || "").trim();
  if (!name) return;
  state.storyboards = normalizeStoryboardsState(state.storyboards || {});
  const id = `sb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();
  state.storyboards[id] = { id, name: name.slice(0, 80), items: [], createdAt: now, updatedAt: now };
  state.settings.storyboardActiveId = id;
  state.settings.storyboardView = false;
  await Promise.all([saveStoryboardsState(), runtimeMessage({ type: "SAVE_SETTINGS", settings: { ...state.settings } })]);
  render();
}
async function setActiveStoryboard(id) {
  state.settings.storyboardActiveId = state.storyboards?.[id] ? id : "";
  if (!state.settings.storyboardActiveId) state.settings.storyboardView = false;
  currentPage = 1;
  await runtimeMessage({ type: "SAVE_SETTINGS", settings: { ...state.settings } });
  render();
}
async function toggleStoryboardView() {
  if (!activeStoryboardObj()) return;
  state.settings.storyboardView = !state.settings.storyboardView;
  currentPage = 1;
  await runtimeMessage({ type: "SAVE_SETTINGS", settings: { ...state.settings } });
  render();
}
async function addIdsToActiveStoryboard(ids) {
  const board = activeStoryboardObj();
  if (!board || !ids?.length) return;
  const seen = new Set(storyboardAssetIds(board));
  let added = 0;
  for (const id of ids) {
    if (!assetById(id) || seen.has(id)) continue;
    board.items.push({ id, note: "", fit: "fit" });
    seen.add(id);
    added += 1;
  }
  if (!added) return;
  board.updatedAt = new Date().toISOString();
  scheduleStoryboardsStateSave();
  render();
}
async function addSelectedToStoryboard() {
  await addIdsToActiveStoryboard(Array.from(selectedIds));
}
async function removeSelectedFromStoryboard() {
  const board = activeStoryboardObj();
  if (!board || !selectedIds.size) return;
  const remove = new Set(selectedIds);
  board.items = (board.items || []).filter(entry => !remove.has(entry.id));
  board.updatedAt = new Date().toISOString();
  scheduleStoryboardsStateSave();
  render();
}
async function moveSelectedStoryboardItems(dir = -1) {
  const board = activeStoryboardObj();
  if (!board || !selectedIds.size) return;
  const items = [...(board.items || [])];
  if (dir < 0) {
    for (let i = 1; i < items.length; i++) {
      if (selectedIds.has(items[i].id) && !selectedIds.has(items[i - 1].id)) {
        [items[i - 1], items[i]] = [items[i], items[i - 1]];
      }
    }
  } else {
    for (let i = items.length - 2; i >= 0; i--) {
      if (selectedIds.has(items[i].id) && !selectedIds.has(items[i + 1].id)) {
        [items[i + 1], items[i]] = [items[i], items[i + 1]];
      }
    }
  }
  board.items = items;
  board.updatedAt = new Date().toISOString();
  await saveStoryboardsState();
  render();
}
async function exportActiveStoryboard() {
  const board = activeStoryboardObj();
  if (!board) return;
  const payload = {
    schema: "ai-media-manager.storyboard.v1",
    appVersion: chrome.runtime?.getManifest?.().version || "unknown",
    exportedAt: new Date().toISOString(),
    storyboard: board,
    assets: storyboardAssetIds(board).map(id => {
      const a = assetById(id);
      return a ? { id: a.id, prompt: a.prompt || "", filename: a.filename || "", source: a.source || "chatgpt", kind: a.kind || "image", ext: a.ext || "", createdAt: a.createdAt || "" } : { id };
    })
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const slug = String(board.name || "storyboard").toLowerCase().replace(/[^a-z0-9а-я]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "storyboard";
  await downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), `storyboard-${slug}-${stamp}.json`, true);
  showProgress("Storyboard exported", 1, 1, `${board.name || "Storyboard"}: ${(board.items || []).length} panels.`);
}


// v2.31 Canvas Alpha: simple comic page builder layered on storyboard/catalogue.
function normalizeCanvasPanel(panel = {}, index = 0) {
  const itemId = String(panel.itemId || panel.id || "").slice(0, 160);
  if (!itemId) return null;
  const n = (v, fallback, min, max) => {
    const x = Number(v);
    return Number.isFinite(x) ? Math.max(min, Math.min(max, x)) : fallback;
  };
  return {
    id: String(panel.id || `panel_${Date.now().toString(36)}_${index}_${Math.random().toString(36).slice(2, 6)}`).slice(0, 128),
    itemId,
    x: n(panel.x, 6 + (index % 2) * 46, 0, 98),
    y: n(panel.y, 6 + Math.floor(index / 2) * 24, 0, 98),
    w: n(panel.w, 40, 5, 100),
    h: n(panel.h, 22, 5, 100),
    z: Math.floor(n(panel.z, index + 1, 0, 100000)),
    fit: panel.fit === "fill" ? "fill" : "fit",
    cropX: n(panel.cropX, 50, 0, 100),
    cropY: n(panel.cropY, 50, 0, 100),
    cropZoom: Math.round(n(panel.cropZoom, 1, 1, 3) * 100) / 100,
    strokeWidth: Math.round(n(panel.strokeWidth, 0, 0, 12)),
    strokeTop: Math.round(n(panel.strokeTop, n(panel.strokeWidth, 0, 0, 12), 0, 12)),
    strokeRight: Math.round(n(panel.strokeRight, n(panel.strokeWidth, 0, 0, 12), 0, 12)),
    strokeBottom: Math.round(n(panel.strokeBottom, n(panel.strokeWidth, 0, 0, 12), 0, 12)),
    strokeLeft: Math.round(n(panel.strokeLeft, n(panel.strokeWidth, 0, 0, 12), 0, 12)),
    strokeSeparate: panel.strokeSeparate === true,
    strokeColor: /^#[0-9a-f]{6}$/i.test(String(panel.strokeColor || "")) ? String(panel.strokeColor) : "#000000",
    // v2.31.48: optional four-corner panel shape. Values are percentages inside the panel box.
    shapeCustom: panel.shapeCustom === true,
    shapeTlX: Math.round(n(panel.shapeTlX, 0, -40, 140) * 10) / 10,
    shapeTlY: Math.round(n(panel.shapeTlY, 0, -40, 140) * 10) / 10,
    shapeTrX: Math.round(n(panel.shapeTrX, 100, -40, 140) * 10) / 10,
    shapeTrY: Math.round(n(panel.shapeTrY, 0, -40, 140) * 10) / 10,
    shapeBrX: Math.round(n(panel.shapeBrX, 100, -40, 140) * 10) / 10,
    shapeBrY: Math.round(n(panel.shapeBrY, 100, -40, 140) * 10) / 10,
    shapeBlX: Math.round(n(panel.shapeBlX, 0, -40, 140) * 10) / 10,
    shapeBlY: Math.round(n(panel.shapeBlY, 100, -40, 140) * 10) / 10
  };
}
function normalizeCanvasBubble(bubble = {}, index = 0) {
  const n = (v, fallback, min, max) => {
    const x = Number(v);
    return Number.isFinite(x) ? Math.max(min, Math.min(max, x)) : fallback;
  };
  const type = ["speech", "thought", "caption"].includes(String(bubble.type || "")) ? String(bubble.type) : "speech";
  const style = ["white", "yellow", "dark"].includes(String(bubble.style || "")) ? String(bubble.style) : "white";
  return {
    id: String(bubble.id || `bubble_${Date.now().toString(36)}_${index}_${Math.random().toString(36).slice(2, 6)}`).slice(0, 128),
    type,
    style,
    bubbleShape: (() => { const shape = String(bubble.bubbleShape || "oval"); return shape === "cloud2" ? "cloud" : (["oval", "cloud", "gear", "burst"].includes(shape) ? shape : "oval"); })(),
    burstSpikeCount: Math.round(n(bubble.burstSpikeCount, 8, 5, 24)),
    burstPeakOffset: Math.round(n(bubble.burstPeakOffset, 0, -0.25, 0.25) * 100) / 100,
    burstValleyOffset: Math.round(n(bubble.burstValleyOffset, 0, -0.25, 0.25) * 100) / 100,
    burstRandomness: Math.round(n(bubble.burstRandomness, 0, 0, 1) * 100) / 100,
    burstRandomness2: Math.round(n(bubble.burstRandomness2, 0, 0, 1) * 100) / 100,
    burstJagged: bubble.burstJagged === true,
    cloudCircleCount: Math.round(n(bubble.cloudCircleCount, 12, 6, 22)),
    cloudCircleSize: Math.round(n(bubble.cloudCircleSize, 1, 0.5, 1.8) * 100) / 100,
    cloudRandomness: Math.round(n(bubble.cloudRandomness, ["cloud", "cloud2"].includes(String(bubble.bubbleShape || "")) ? n(bubble.burstRandomness, 0, 0, 1) : 0, 0, 1) * 100) / 100,
    cloudRandomness2: Math.round(n(bubble.cloudRandomness2, ["cloud", "cloud2"].includes(String(bubble.bubbleShape || "")) ? n(bubble.burstRandomness2, 0, 0, 1) : 0, 0, 1) * 100) / 100,
    burstRandomSeed: Math.floor(n(bubble.burstRandomSeed, 0, 0, 999999)),
    cloudRandomSeed: Math.floor(n(bubble.cloudRandomSeed, ["cloud", "cloud2"].includes(String(bubble.bubbleShape || "")) ? n(bubble.burstRandomSeed, 0, 0, 999999) : 0, 0, 999999)),
    tailHidden: bubble.tailHidden === true,
    tailJagged: bubble.tailJagged === true || bubble.tailBroken === true,
    tailBroken: false,
    tailJaggedCount: Math.round(n(bubble.tailJaggedCount, 4, 2, 4)),
    tailJaggedLengthOffset: Math.round(n(bubble.tailJaggedLengthOffset, 0, -24, 24) * 10) / 10,
    tailJaggedWidthOffset: Math.round(n(bubble.tailJaggedWidthOffset, 11, 0, 30) * 10) / 10,
    tailJaggedSpacing: Math.round(n(bubble.tailJaggedSpacing, 1, 0.5, 1.8) * 100) / 100,
    secondaryEnabled: bubble.secondaryEnabled === true,
    secondaryCount: Math.round(n(bubble.secondaryCount, bubble.secondaryEnabled === true ? 1 : 0, 0, 3)),
    secondaryText: String(bubble.secondaryText || "...").slice(0, 500),
    secondaryX: Math.round(n(bubble.secondaryX, 72, -120, 220) * 10) / 10,
    secondaryY: Math.round(n(bubble.secondaryY, -18, -120, 220) * 10) / 10,
    secondaryW: Math.round(n(bubble.secondaryW, 70, 20, 180) * 10) / 10,
    secondaryH: Math.round(n(bubble.secondaryH, 68, 20, 180) * 10) / 10,
    secondaryFontScale: Math.round(n(bubble.secondaryFontScale, 0.86, 0.45, 1.5) * 100) / 100,
    secondary2Text: String(bubble.secondary2Text || "...").slice(0, 500),
    secondary2X: Math.round(n(bubble.secondary2X, 130, -120, 260) * 10) / 10,
    secondary2Y: Math.round(n(bubble.secondary2Y, 8, -120, 260) * 10) / 10,
    secondary2W: Math.round(n(bubble.secondary2W, 62, 20, 180) * 10) / 10,
    secondary2H: Math.round(n(bubble.secondary2H, 60, 20, 180) * 10) / 10,
    secondary2FontScale: Math.round(n(bubble.secondary2FontScale, 0.78, 0.45, 1.5) * 100) / 100,
    secondary3Text: String(bubble.secondary3Text || "...").slice(0, 500),
    secondary3X: Math.round(n(bubble.secondary3X, 180, -120, 320) * 10) / 10,
    secondary3Y: Math.round(n(bubble.secondary3Y, 40, -120, 320) * 10) / 10,
    secondary3W: Math.round(n(bubble.secondary3W, 54, 20, 180) * 10) / 10,
    secondary3H: Math.round(n(bubble.secondary3H, 52, 20, 180) * 10) / 10,
    secondary3FontScale: Math.round(n(bubble.secondary3FontScale, 0.70, 0.45, 1.5) * 100) / 100,
    secondaryBoolean: bubble.secondaryBoolean !== false,
    secondaryThoughtBoolean: bubble.secondaryThoughtBoolean !== false,
    secondaryBridgeEnabled: bubble.secondaryBridgeEnabled !== false,
    secondaryBridgeBaseA: Math.round(n(bubble.secondaryBridgeBaseA, 12, 3, 42) * 10) / 10,
    secondaryBridgeBaseB: Math.round(n(bubble.secondaryBridgeBaseB, 12, 3, 42) * 10) / 10,
    secondaryBridgeCurve: Math.round(n(bubble.secondaryBridgeCurve, -6, -9, 42) * 10) / 10,
    secondaryBridgeBend1Custom: bubble.secondaryBridgeBend1Custom === true,
    secondaryBridgeBend1X: Math.round(n(bubble.secondaryBridgeBend1X, 50, -240, 420) * 10) / 10,
    secondaryBridgeBend1Y: Math.round(n(bubble.secondaryBridgeBend1Y, 50, -240, 420) * 10) / 10,
    secondaryBridgeBend1OffsetX: Math.round(n(bubble.secondaryBridgeBend1OffsetX, 0, -300, 300) * 10) / 10,
    secondaryBridgeBend1OffsetY: Math.round(n(bubble.secondaryBridgeBend1OffsetY, 0, -300, 300) * 10) / 10,
    secondaryBridgeBend2Custom: bubble.secondaryBridgeBend2Custom === true,
    secondaryBridgeBend2X: Math.round(n(bubble.secondaryBridgeBend2X, 50, -240, 420) * 10) / 10,
    secondaryBridgeBend2Y: Math.round(n(bubble.secondaryBridgeBend2Y, 50, -240, 420) * 10) / 10,
    secondaryBridgeBend2OffsetX: Math.round(n(bubble.secondaryBridgeBend2OffsetX, 0, -300, 300) * 10) / 10,
    secondaryBridgeBend2OffsetY: Math.round(n(bubble.secondaryBridgeBend2OffsetY, 0, -300, 300) * 10) / 10,
    secondaryBridgeBend3Custom: bubble.secondaryBridgeBend3Custom === true,
    secondaryBridgeBend3X: Math.round(n(bubble.secondaryBridgeBend3X, 50, -240, 420) * 10) / 10,
    secondaryBridgeBend3Y: Math.round(n(bubble.secondaryBridgeBend3Y, 50, -240, 420) * 10) / 10,
    secondaryBridgeBend3OffsetX: Math.round(n(bubble.secondaryBridgeBend3OffsetX, 0, -300, 300) * 10) / 10,
    secondaryBridgeBend3OffsetY: Math.round(n(bubble.secondaryBridgeBend3OffsetY, 0, -300, 300) * 10) / 10,
    text: String(bubble.text || "...").slice(0, 500),
    x: n(bubble.x, 10 + (index % 3) * 16, 0, 98),
    y: n(bubble.y, 10 + Math.floor(index / 3) * 14, 0, 98),
    w: n(bubble.w, 18, 8, 80),
    h: n(bubble.h, 12, 6, 50),
    z: Math.floor(n(bubble.z, 500 + index + 1, 0, 100000)),
    fontSize: Math.round(n(bubble.fontSize, 16, 10, 42)),
    tailX: Math.round(n(bubble.tailX, 18, -80, 180) * 10) / 10,
    tailY: Math.round(n(bubble.tailY, 112, -80, 180) * 10) / 10,
    tailBaseWidth: Math.round(n(bubble.tailBaseWidth, 13, 4, 28) * 10) / 10,
    tailBaseShift: Math.round(n(bubble.tailBaseShift, 0, -30, 30) * 10) / 10,
    tailBaseCustom: !!bubble.tailBaseCustom,
    tailBaseX: Math.round(n(bubble.tailBaseX, 0, -80, 180) * 10) / 10,
    tailBaseY: Math.round(n(bubble.tailBaseY, 0, -80, 180) * 10) / 10,
    tailBaseRelativeFollow: bubble.tailBaseRelativeFollow !== false,
    tailBaseOffsetReady: !!bubble.tailBaseOffsetReady,
    tailBaseAngleOffset: Math.round(n(bubble.tailBaseAngleOffset, 0, -6.283, 6.283) * 1000) / 1000,
    tailOuterStroke: Math.round(n(bubble.tailOuterStroke, 2, 0.1, 5) * 10) / 10,
    tailInnerStroke: Math.round(n(bubble.tailInnerStroke, 0, 0, 4) * 10) / 10,
    // v2.31.47: Anchor offset UI is relative. 0 means actual 3.8.
    tailAnchorOffset: Math.round((bubble.tailAnchorOffsetRelativeV3
      ? n(bubble.tailAnchorOffset, 0, -12, 12)
      : n(Number(bubble.tailAnchorOffset) - BUBBLE_ANCHOR_OFFSET_ZERO_ACTUAL, 0, -12, 12)) * 10) / 10,
    tailAnchorOffsetRelativeV3: true,
    tailCurved: !!bubble.tailCurved,
    tailRelativeFollow: bubble.tailRelativeFollow !== false,
    tailCurveMode: String(bubble.tailCurveMode || "normal") === "quadrant" ? "quadrant" : "normal",
    tailCurveManual: !!bubble.tailCurveManual,
    tailCurveOffsetReady: !!bubble.tailCurveOffsetReady,
    tailCurveOffsetX: Math.round(n(bubble.tailCurveOffsetX, 0, -120, 120) * 10) / 10,
    tailCurveOffsetY: Math.round(n(bubble.tailCurveOffsetY, 0, -120, 120) * 10) / 10,
    tailCurveX: Math.round(n(bubble.tailCurveX, 0, -120, 220) * 10) / 10,
    tailCurveY: Math.round(n(bubble.tailCurveY, 0, -120, 220) * 10) / 10,
    thoughtSpacing: Math.round(n(bubble.thoughtSpacing, 1, 0.6, 2.2) * 10) / 10,
    thoughtScaleX: Math.round(n(bubble.thoughtScaleX, 1, 0.5, 1.8) * 10) / 10,
    thoughtScaleY: Math.round(n(bubble.thoughtScaleY, 1, 0.5, 1.8) * 10) / 10,
    thoughtHorizontal: bubble.thoughtHorizontal !== false,
    thoughtFalloff: Math.round(n(bubble.thoughtFalloff, 1.15, 0.4, 2.5) * 100) / 100,
    thoughtBaseSize: Math.round(n(bubble.thoughtBaseSize, 1, 0.45, 2.2) * 100) / 100,
    // v2.31.44: Base offset UI is relative. 0 means the old/default base position pushed outward by +15.
    thoughtBaseOffset: Math.round((bubble.thoughtBaseOffsetRelativeV2
      ? n(bubble.thoughtBaseOffset, 0, -24, 24)
      : n(Number(bubble.thoughtBaseOffset) - THOUGHT_BASE_OFFSET_OLD_DEFAULT, 0, -24, 24)) * 10) / 10,
    thoughtBaseOffsetRelativeV2: true,
    thoughtJoin: bubble.thoughtJoin === true,
    thoughtJoinWidth: Math.round(n(bubble.thoughtJoinWidth, 1, 0.2, 2.5) * 100) / 100,
    thoughtJoinLength: Math.round(n(bubble.thoughtJoinLength, 1, 0, 1.5) * 100) / 100,
    thoughtCount: Math.round(n(bubble.thoughtCount, 5, 3, 8)),
    thoughtAngle: Math.round(n(bubble.thoughtAngle, 0, -90, 90) * 10) / 10
  };
}
function normalizeCanvasBubbleJoin(join = {}, index = 0, validBubbleIds = null) {
  const ids = Array.isArray(join?.bubbleIds) ? join.bubbleIds.map(v => String(v || '').slice(0, 128)).filter(Boolean) : [];
  const unique = Array.from(new Set(ids)).slice(0, 2);
  if (unique.length !== 2) return null;
  if (validBubbleIds && (!validBubbleIds.has(unique[0]) || !validBubbleIds.has(unique[1]))) return null;
  const mainBubbleId = unique.includes(String(join?.mainBubbleId || "")) ? String(join.mainBubbleId) : "";
  return {
    id: String(join.id || `bubble_join_${Date.now().toString(36)}_${index}_${Math.random().toString(36).slice(2, 6)}`).slice(0, 128),
    bubbleIds: unique,
    mainBubbleId,
    hideSecondaryTail: !!(mainBubbleId && join?.hideSecondaryTail !== false)
  };
}

function normalizeCanvasesState(input = {}) {
  const out = {};
  const src = input && typeof input === "object" ? input : {};
  for (const [rawId, rawCanvas] of Object.entries(src)) {
    const id = String(rawId || rawCanvas?.id || "").slice(0, 128);
    if (!id) continue;
    const name = String(rawCanvas?.name || "Canvas").trim().slice(0, 80) || "Canvas";
    const rawPanels = Array.isArray(rawCanvas?.panels) ? rawCanvas.panels : [];
    const panels = rawPanels.map((p, i) => normalizeCanvasPanel(p, i)).filter(Boolean).slice(0, 200);
    const rawBubbles = Array.isArray(rawCanvas?.bubbles) ? rawCanvas.bubbles : [];
    const bubbles = rawBubbles.map((b, i) => normalizeCanvasBubble(b, i)).filter(Boolean).slice(0, 200);
    const bubbleIds = new Set(bubbles.map(b => b.id));
    const rawBubbleJoins = Array.isArray(rawCanvas?.bubbleJoins) ? rawCanvas.bubbleJoins : [];
    const bubbleJoins = rawBubbleJoins.map((j, i) => normalizeCanvasBubbleJoin(j, i, bubbleIds)).filter(Boolean).slice(0, 200);
    out[id] = {
      id,
      name,
      page: rawCanvas?.page || { kind: "portrait", ratio: "3:4" },
      panels,
      bubbles,
      bubbleJoins,
      createdAt: rawCanvas?.createdAt || new Date().toISOString(),
      updatedAt: rawCanvas?.updatedAt || rawCanvas?.createdAt || new Date().toISOString()
    };
  }
  return out;
}
function sortedCanvases() {
  state.canvases = normalizeCanvasesState(state.canvases || {});
  return Object.values(state.canvases).sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}
function activeCanvasObj() {
  state.canvases = normalizeCanvasesState(state.canvases || {});
  const id = state.settings.canvasActiveId || "";
  return id && state.canvases?.[id] ? state.canvases[id] : null;
}
async function saveCanvasesState() {
  state.canvases = normalizeCanvasesState(state.canvases || {});
  await runtimeMessage({ type: "SET_CANVASES", canvases: state.canvases });
}
function scheduleCanvasesStateSave() {
  clearTimeout(canvasesSaveTimer);
  canvasesSaveTimer = setTimeout(() => { saveCanvasesState().catch(() => {}); }, 350);
}
function canvasPanelIds(canvas = activeCanvasObj()) {
  return Array.isArray(canvas?.panels) ? canvas.panels.map(p => p.itemId).filter(Boolean) : [];
}
function canvasSelectedSpeechBubbleIds() {
  const canvas = activeCanvasObj();
  if (!canvas) return [];
  const root = $("#comicCanvas");
  const domIds = root ? $$(".canvas-bubble[data-bubble-id]", root)
    .filter(el => el.classList.contains("selected") || el.classList.contains("multi-selected"))
    .map(el => el.dataset.bubbleId)
    .filter(Boolean) : [];
  const stateIds = canvasNormalizeSelection(canvasMultiSelection)
    .filter(item => item.kind === "bubble")
    .map(item => item.id)
    .filter(Boolean);
  const ids = [
    ...domIds,
    ...stateIds,
    canvasSelectedBubbleId
  ].filter(Boolean);
  const out = [];
  const seen = new Set();
  ids.forEach(id => {
    if (seen.has(id)) return;
    const bubble = canvas.bubbles?.find(b => b.id === id);
    if (bubble && String(bubble.type || "speech") === "speech") { seen.add(id); out.push(id); }
  });
  return out;
}
function canvasFindBubbleJoin(canvas, aId, bId) {
  if (!canvas || !aId || !bId) return null;
  const key = [String(aId), String(bId)].sort().join("::");
  return (canvas.bubbleJoins || []).find(join => Array.isArray(join.bubbleIds) && join.bubbleIds.length === 2 && [...join.bubbleIds].sort().join("::") === key) || null;
}
function canvasFindBubbleJoinByBubble(canvas, bubbleId) {
  const id = String(bubbleId || "");
  if (!canvas || !id) return null;
  return (canvas.bubbleJoins || []).find(join => Array.isArray(join.bubbleIds) && join.bubbleIds.includes(id)) || null;
}
function canvasFindBubbleJoinById(canvas, joinId) {
  const id = String(joinId || "");
  if (!canvas || !id) return null;
  return (canvas.bubbleJoins || []).find(join => String(join.id || "") === id) || null;
}
function canvasSelectedSpeechPair() {
  const ids = canvasSelectedSpeechBubbleIds();
  return ids.length >= 2 ? ids.slice(0, 2) : [];
}
function canvasJoinedPairForSelection(canvas = activeCanvasObj()) {
  if (!canvas) return null;
  cleanupCanvasBubbleJoins(canvas);
  const ids = canvasSelectedSpeechPair();
  if (ids.length === 2) {
    const joined = canvasFindBubbleJoin(canvas, ids[0], ids[1]);
    if (joined) { canvasActiveBubbleJoinId = joined.id; return joined; }
  }
  if (canvasSelectedBubbleId) {
    const joined = canvasFindBubbleJoinByBubble(canvas, canvasSelectedBubbleId);
    if (joined) { canvasActiveBubbleJoinId = joined.id; return joined; }
  }
  const selectedIds = canvasSelectedSpeechBubbleIds();
  for (const id of selectedIds) {
    const joined = canvasFindBubbleJoinByBubble(canvas, id);
    if (joined) { canvasActiveBubbleJoinId = joined.id; return joined; }
  }
  const activeJoined = canvasFindBubbleJoinById(canvas, canvasActiveBubbleJoinId);
  if (activeJoined) return activeJoined;
  canvasActiveBubbleJoinId = "";
  return null;
}
function canvasSelectedMainCandidate(join = null) {
  const ids = Array.isArray(join?.bubbleIds) ? join.bubbleIds : canvasSelectedSpeechPair();
  if (!ids.length) return "";
  if (canvasSelectedBubbleId && ids.includes(canvasSelectedBubbleId)) return canvasSelectedBubbleId;
  const selectedIds = canvasSelectedSpeechBubbleIds();
  const selectedInPair = selectedIds.find(id => ids.includes(id));
  return selectedInPair || ids[0] || "";
}
function canvasBubbleTailHiddenByJoin(canvas, bubbleId) {
  const id = String(bubbleId || "");
  const join = (canvas?.bubbleJoins || []).find(j => j?.hideSecondaryTail && j?.mainBubbleId && Array.isArray(j.bubbleIds) && j.bubbleIds.includes(id));
  return !!(join && join.mainBubbleId !== id);
}
function canvasBubbleTailHidden(canvas, bubble) {
  if (!bubble) return false;
  return bubble.tailHidden === true || canvasBubbleTailHiddenByJoin(canvas, bubble.id);
}
function canvasApplyJoinedTailState(join, canvas = activeCanvasObj()) {
  if (!canvas || !join || !Array.isArray(join.bubbleIds) || join.bubbleIds.length !== 2) return;
  const mainId = join.mainBubbleId && join.bubbleIds.includes(join.mainBubbleId) ? join.mainBubbleId : join.bubbleIds[0];
  join.mainBubbleId = mainId;
  join.hideSecondaryTail = true;
  for (const id of join.bubbleIds) {
    const bubble = canvas.bubbles?.find(b => b.id === id);
    if (bubble) bubble.tailHidden = id !== mainId;
    const el = $(`#comicCanvas .canvas-bubble[data-bubble-id="${cssEscapeValue(id)}"]`);
    if (el) {
      const hidden = id !== mainId;
      el.classList.toggle("tail-hidden", hidden);
      el.classList.toggle("joined-tail-hidden", hidden);
    }
  }
}
function setCanvasBubbleTailHidden(bubbleId, hidden) {
  const canvas = activeCanvasObj();
  const bubble = canvas?.bubbles?.find(b => b.id === bubbleId);
  if (!canvas || !bubble) return false;
  bubble.tailHidden = !!hidden;
  canvas.updatedAt = new Date().toISOString();
  scheduleCanvasesStateSave();
  const el = $(`#comicCanvas .canvas-bubble[data-bubble-id="${cssEscapeValue(bubble.id)}"]`);
  if (el) el.classList.toggle("tail-hidden", !!bubble.tailHidden);
  updateCanvasBubbleTailDom(bubble);
  updateCanvasButtonStates();
  return true;
}
function toggleSelectedCanvasBubbleTailHidden() {
  const bubble = selectedCanvasBubble();
  if (!bubble) return;
  setCanvasBubbleTailHidden(bubble.id, !(bubble.tailHidden === true));
  renderComicCanvas();
  canvasApplySelectionDom();
}
function cleanupCanvasBubbleJoins(canvas) {
  if (!canvas) return;
  const valid = new Set((canvas.bubbles || []).map(b => b.id));
  canvas.bubbleJoins = (canvas.bubbleJoins || []).map((join, i) => normalizeCanvasBubbleJoin(join, i, valid)).filter(Boolean);
}
function canvasBubbleAttachedCount(bubble) {
  if (!bubble || String(bubble.type || "speech") === "caption") return 0;
  const n = Number(bubble.secondaryCount);
  if (Number.isFinite(n)) return Math.max(0, Math.min(3, Math.round(n)));
  return bubble.secondaryEnabled === true ? 1 : 0;
}
function canvasBubbleHasAttachedSecondary(bubble) {
  return canvasBubbleAttachedCount(bubble) > 0;
}
function canvasBubbleAttachedBubbleData(bubble) {
  const count = canvasBubbleAttachedCount(bubble);
  const defs = [
    { key: "secondary", x: 72, y: -18, w: 70, h: 68, scale: 0.86, text: "secondaryText" },
    { key: "secondary2", x: 130, y: 8, w: 62, h: 60, scale: 0.78, text: "secondary2Text" },
    { key: "secondary3", x: 180, y: 40, w: 54, h: 52, scale: 0.70, text: "secondary3Text" }
  ];
  return defs.slice(0, count).map((d, i) => ({
    index: i + 1,
    x: Number.isFinite(Number(bubble[`${d.key}X`])) ? Number(bubble[`${d.key}X`]) : d.x,
    y: Number.isFinite(Number(bubble[`${d.key}Y`])) ? Number(bubble[`${d.key}Y`]) : d.y,
    w: Number.isFinite(Number(bubble[`${d.key}W`])) ? Number(bubble[`${d.key}W`]) : d.w,
    h: Number.isFinite(Number(bubble[`${d.key}H`])) ? Number(bubble[`${d.key}H`]) : d.h,
    fontScale: Number.isFinite(Number(bubble[`${d.key}FontScale`])) ? Number(bubble[`${d.key}FontScale`]) : d.scale,
    text: String(bubble[d.text] || "...").slice(0, 500) || "..."
  }));
}

function canvasBubbleSecondaryShapeMergeEnabled(bubble) {
  return !!(bubble && canvasBubbleHasAttachedSecondary(bubble) && bubble.secondaryBoolean !== false);
}
function canvasBubbleThoughtBubblesMergeEnabled(bubble) {
  return !!(bubble && canvasBubbleIsThought(bubble) && bubble.secondaryThoughtBoolean !== false);
}
function canvasBubbleSecondaryBooleanEnabled(bubble) {
  return false;
}
function canvasBubbleTailBooleanEnabled(bubble) {
  return false;
}
function canvasBubbleSecondaryStandaloneEnabled(bubble) {
  return canvasBubbleHasAttachedSecondary(bubble) && !canvasBubbleSecondaryShapeMergeEnabled(bubble);
}
function canvasBubbleSecondaryBridgeEnabled(bubble) {
  return canvasBubbleHasAttachedSecondary(bubble) && bubble.secondaryBridgeEnabled !== false;
}
function canvasBubbleSecondaryBridgeData(bubble) {
  if (!canvasBubbleSecondaryBridgeEnabled(bubble)) return null;
  const sx = Number.isFinite(Number(bubble.secondaryX)) ? Number(bubble.secondaryX) : 72;
  const sy = Number.isFinite(Number(bubble.secondaryY)) ? Number(bubble.secondaryY) : -18;
  const sw = Number.isFinite(Number(bubble.secondaryW)) ? Number(bubble.secondaryW) : 70;
  const sh = Number.isFinite(Number(bubble.secondaryH)) ? Number(bubble.secondaryH) : 68;
  const main = { cx: 50, cy: 50, rx: 50, ry: 50 };
  const sec = { cx: sx + sw / 2, cy: sy + sh / 2, rx: Math.max(8, sw / 2), ry: Math.max(8, sh / 2) };
  const dx = sec.cx - main.cx;
  const dy = sec.cy - main.cy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const boundary = (e, dirX, dirY) => {
    const d = 1 / Math.sqrt((dirX * dirX) / (e.rx * e.rx) + (dirY * dirY) / (e.ry * e.ry));
    return { x: e.cx + dirX * d, y: e.cy + dirY * d };
  };
  const a = boundary(main, ux, uy);
  const b = boundary(sec, -ux, -uy);
  const baseA = Math.max(3, Math.min(42, Number(bubble.secondaryBridgeBaseA || 12)));
  const baseB = Math.max(3, Math.min(42, Number(bubble.secondaryBridgeBaseB || 12)));
  const curve = Math.max(-9, Math.min(42, Number(bubble.secondaryBridgeCurve || 0)));
  const a1 = { x: a.x + nx * baseA / 2, y: a.y + ny * baseA / 2 };
  const a2 = { x: a.x - nx * baseA / 2, y: a.y - ny * baseA / 2 };
  const b1 = { x: b.x + nx * baseB / 2, y: b.y + ny * baseB / 2 };
  const b2 = { x: b.x - nx * baseB / 2, y: b.y - ny * baseB / 2 };
  // v2.31.76: the fill overlaps slightly into each bubble so it erases the
  // original oval stroke at the bridge bases. The visible stroke remains only
  // on the two outer bridge sides.
  const seamInset = Math.max(1.2, Math.min(3.8, Math.min(baseA, baseB) * 0.18));
  const a1f = { x: a1.x - ux * seamInset, y: a1.y - uy * seamInset };
  const a2f = { x: a2.x - ux * seamInset, y: a2.y - uy * seamInset };
  const b1f = { x: b1.x + ux * seamInset, y: b1.y + uy * seamInset };
  const b2f = { x: b2.x + ux * seamInset, y: b2.y + uy * seamInset };
  const c1 = { x: (a1.x + b1.x) / 2 + nx * curve, y: (a1.y + b1.y) / 2 + ny * curve };
  const c2 = { x: (a2.x + b2.x) / 2 - nx * curve, y: (a2.y + b2.y) / 2 - ny * curve };
  const fill = `M ${a1f.x.toFixed(3)} ${a1f.y.toFixed(3)} Q ${c1.x.toFixed(3)} ${c1.y.toFixed(3)} ${b1f.x.toFixed(3)} ${b1f.y.toFixed(3)} L ${b2f.x.toFixed(3)} ${b2f.y.toFixed(3)} Q ${c2.x.toFixed(3)} ${c2.y.toFixed(3)} ${a2f.x.toFixed(3)} ${a2f.y.toFixed(3)} Z`;
  const sideA = `M ${a1.x.toFixed(3)} ${a1.y.toFixed(3)} Q ${c1.x.toFixed(3)} ${c1.y.toFixed(3)} ${b1.x.toFixed(3)} ${b1.y.toFixed(3)}`;
  const sideB = `M ${a2.x.toFixed(3)} ${a2.y.toFixed(3)} Q ${c2.x.toFixed(3)} ${c2.y.toFixed(3)} ${b2.x.toFixed(3)} ${b2.y.toFixed(3)}`;
  return { fill, sideA, sideB };
}
function canvasBubbleSecondaryBridgePath(bubble) {
  return canvasBubbleSecondaryBridgeData(bubble)?.fill || "";
}
function canvasBubbleSecondaryStandaloneBridgeSvg(bubble) {
  const data = canvasBubbleSecondaryBridgeData(bubble);
  if (!data) return "";
  return `<svg class="canvas-bubble-secondary-standalone-bridge" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path class="bridge-fill" d="${safeAttr(data.fill)}"></path><path class="bridge-side bridge-side-a" d="${safeAttr(data.sideA)}"></path><path class="bridge-side bridge-side-b" d="${safeAttr(data.sideB)}"></path></svg>`;
}
function canvasBubbleSecondaryBridgeStyle(bubble) {
  if (!canvasBubbleHasAttachedSecondary(bubble)) return "";
  const sx = Number.isFinite(Number(bubble.secondaryX)) ? Number(bubble.secondaryX) : 72;
  const sy = Number.isFinite(Number(bubble.secondaryY)) ? Number(bubble.secondaryY) : -18;
  const sw = Number.isFinite(Number(bubble.secondaryW)) ? Number(bubble.secondaryW) : 70;
  const sh = Number.isFinite(Number(bubble.secondaryH)) ? Number(bubble.secondaryH) : 68;
  const main = { x: 50, y: 50, rx: 50, ry: 50 };
  const sec = { x: sx + sw / 2, y: sy + sh / 2, rx: Math.max(8, sw / 2), ry: Math.max(8, sh / 2) };
  const boundary = (ellipse, target) => {
    const dx = Number(target.x || 0) - ellipse.x;
    const dy = Number(target.y || 0) - ellipse.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const dist = 1 / Math.sqrt((ux * ux) / (ellipse.rx * ellipse.rx) + (uy * uy) / (ellipse.ry * ellipse.ry));
    return { x: ellipse.x + ux * dist, y: ellipse.y + uy * dist };
  };
  const a = boundary(main, sec);
  const b = boundary(sec, main);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.max(8, Math.hypot(dx, dy));
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  const thickness = Math.max(10, Math.min(16, Math.min(main.ry, sec.ry) * 0.36));
  return `--bubble-secondary-bridge-left:${a.x}%;--bubble-secondary-bridge-top:${a.y}%;--bubble-secondary-bridge-length:${length}%;--bubble-secondary-bridge-thickness:${thickness}%;--bubble-secondary-bridge-angle:${angle}deg;`;
}

function canvasBubbleShapeType(bubble) {
  const value = String(bubble?.bubbleShape || "oval");
  if (value === "cloud2") return "cloud";
  return ["oval", "cloud", "gear", "burst"].includes(value) ? value : "oval";
}
function canvasBubbleBurstSpikeCount(bubble) {
  const x = Number(bubble?.burstSpikeCount);
  return Number.isFinite(x) ? Math.max(5, Math.min(24, Math.round(x))) : 8;
}
function canvasBubbleBurstPeakOffset(bubble) {
  const x = Number(bubble?.burstPeakOffset);
  return Number.isFinite(x) ? Math.max(-0.25, Math.min(0.25, x)) : 0;
}
function canvasBubbleBurstValleyOffset(bubble) {
  const x = Number(bubble?.burstValleyOffset);
  return Number.isFinite(x) ? Math.max(-0.25, Math.min(0.25, x)) : 0;
}
function canvasBubbleBurstRandomness(bubble) {
  const x = Number(bubble?.burstRandomness);
  return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0;
}
function canvasBubbleBurstRandomness2(bubble) {
  const x = Number(bubble?.burstRandomness2);
  return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0;
}
function canvasBubbleBurstJagged(bubble) {
  return bubble?.burstJagged === true;
}
function canvasBubbleCloudCircleCount(bubble) {
  const x = Number(bubble?.cloudCircleCount);
  return Number.isFinite(x) ? Math.max(6, Math.min(22, Math.round(x))) : 12;
}
function canvasBubbleCloudCircleSize(bubble) {
  const x = Number(bubble?.cloudCircleSize);
  return Number.isFinite(x) ? Math.max(0.5, Math.min(1.8, x)) : 1;
}
function canvasBubbleCloudAutoSizeForCount(count) {
  const c = Math.max(6, Math.min(22, Number(count) || 12));
  const stops = [[6, 1.8], [7, 1.45], [8, 1.3], [11, 1.0], [14, 0.8], [22, 0.7]];
  if (c <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [c1, s1] = stops[i - 1];
    const [c2, s2] = stops[i];
    if (c <= c2) {
      const t = (c - c1) / (c2 - c1);
      return s1 + (s2 - s1) * t;
    }
  }
  return stops[stops.length - 1][1];
}
function canvasBubbleCloudRandomness(bubble) {
  const x = Number(bubble?.cloudRandomness);
  return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0;
}
function canvasBubbleCloudRandomness2(bubble) {
  const x = Number(bubble?.cloudRandomness2);
  return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0;
}
function canvasBubbleCloudRandomSeed(bubble) {
  const x = Math.floor(Number(bubble?.cloudRandomSeed));
  const base = Number.isFinite(x) ? Math.max(0, Math.min(999999, x)) : 0;
  const secondaryIndex = Math.max(0, Math.min(9, Math.round(Number(bubble?.secondaryIndex) || 0)));
  return (base + secondaryIndex * 7919) % 1000000;
}
function canvasBubbleBurstRandomSeed(bubble) {
  const x = Math.floor(Number(bubble?.burstRandomSeed));
  const base = Number.isFinite(x) ? Math.max(0, Math.min(999999, x)) : 0;
  const secondaryIndex = Math.max(0, Math.min(9, Math.round(Number(bubble?.secondaryIndex) || 0)));
  return (base + secondaryIndex * 7919) % 1000000;
}
function canvasBubbleDeterministicRandom(seed, index) {
  const x = Math.sin((seed + 1) * 12.9898 + (index + 1) * 78.233) * 43758.5453123;
  return x - Math.floor(x);
}
function canvasBubbleSmoothClosedPath(points, tension = 8) {
  if (!points?.length) return '';
  const parts = [];
  for (let i = 0; i < points.length; i++) {
    const p0 = points[(i - 1 + points.length) % points.length];
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const p3 = points[(i + 2) % points.length];
    if (i === 0) parts.push(`M ${p1.x.toFixed(3)} ${p1.y.toFixed(3)}`);
    const c1 = { x: p1.x + (p2.x - p0.x) / tension, y: p1.y + (p2.y - p0.y) / tension };
    const c2 = { x: p2.x - (p3.x - p1.x) / tension, y: p2.y - (p3.y - p1.y) / tension };
    parts.push(`C ${c1.x.toFixed(3)} ${c1.y.toFixed(3)} ${c2.x.toFixed(3)} ${c2.y.toFixed(3)} ${p2.x.toFixed(3)} ${p2.y.toFixed(3)}`);
  }
  parts.push('Z');
  return parts.join(' ');
}
function canvasBubbleCloudPath(bubble, cx, cy, rx, ry) {
  const lobes = 8;
  const lows = [];
  const highs = [];
  const minR = Math.max(12, Math.min(rx, ry));
  const pointFrom = (pt, angle, len) => ({ x: pt.x + Math.cos(angle) * len, y: pt.y + Math.sin(angle) * len });
  const highOffset = 0;
  const lowOffset = 0.07;
  const randomness = canvasBubbleBurstRandomness(bubble);
  const randomSeed = canvasBubbleBurstRandomSeed(bubble);
  const jitterPoint = (pt, pointIndex, radius) => {
    if (!(randomness > 0) || !(radius > 0)) return pt;
    const angle = canvasBubbleDeterministicRandom(randomSeed + 231, pointIndex * 2 + 1) * Math.PI * 2;
    const dist = Math.sqrt(canvasBubbleDeterministicRandom(randomSeed + 279, pointIndex * 2 + 2)) * radius * randomness;
    return { x: pt.x + Math.cos(angle) * dist, y: pt.y + Math.sin(angle) * dist };
  };
  const lowJitter = [0.00, -0.008, 0.006, -0.004, 0.00, -0.006, 0.004, -0.005];
  const highJitter = [0.00, 0.025, -0.005, 0.018, 0.00, 0.022, -0.006, 0.014];
  const lowHandleJitter = [1.00, 0.94, 1.02, 0.96, 1.00, 0.95, 1.03, 0.97];
  const highHandleJitter = [1.00, 1.05, 0.98, 1.03, 1.00, 1.06, 0.98, 1.02];
  for (let i = 0; i < lobes; i++) {
    const lowA = -Math.PI / 2 + (i / lobes) * Math.PI * 2;
    const highA = lowA + Math.PI / lobes;
    // Cloud defaults: sharper low points, rounder high lobes.
    const lowMod = 0.90 + lowOffset + lowJitter[i % lowJitter.length];
    const highMod = 1.20 + highOffset + highJitter[i % highJitter.length];
    const lowBase = { x: cx + Math.cos(lowA) * rx * lowMod, y: cy + Math.sin(lowA) * ry * lowMod };
    const highBase = { x: cx + Math.cos(highA) * rx * highMod, y: cy + Math.sin(highA) * ry * highMod };
    lows.push({
      a: lowA,
      handleMul: lowHandleJitter[i % lowHandleJitter.length],
      p: jitterPoint(lowBase, i, minR * 0.06)
    });
    highs.push({
      a: highA,
      handleMul: highHandleJitter[i % highHandleJitter.length],
      p: jitterPoint(highBase, 100 + i, minR * 0.13)
    });
  }
  const lowHandleLen = minR * 0.022;
  const highHandleLen = minR * 0.30;
  const parts = [];
  parts.push(`M ${lows[0].p.x.toFixed(3)} ${lows[0].p.y.toFixed(3)}`);
  for (let i = 0; i < lobes; i++) {
    const low = lows[i];
    const high = highs[i];
    const nextLow = lows[(i + 1) % lobes];
    const lowOut = pointFrom(low.p, low.a + Math.PI / 2, lowHandleLen * low.handleMul);
    const highIn = pointFrom(high.p, high.a - Math.PI / 2, highHandleLen * high.handleMul);
    const highOut = pointFrom(high.p, high.a + Math.PI / 2, highHandleLen * high.handleMul);
    const nextLowIn = pointFrom(nextLow.p, nextLow.a - Math.PI / 2, lowHandleLen * nextLow.handleMul);
    parts.push(`C ${lowOut.x.toFixed(3)} ${lowOut.y.toFixed(3)} ${highIn.x.toFixed(3)} ${highIn.y.toFixed(3)} ${high.p.x.toFixed(3)} ${high.p.y.toFixed(3)}`);
    parts.push(`C ${highOut.x.toFixed(3)} ${highOut.y.toFixed(3)} ${nextLowIn.x.toFixed(3)} ${nextLowIn.y.toFixed(3)} ${nextLow.p.x.toFixed(3)} ${nextLow.p.y.toFixed(3)}`);
  }
  parts.push('Z');
  return parts.join(' ');
}

function canvasBubbleCloudRimSvg(bubble, cx, cy, rx, ry) {
  const baseCount = canvasBubbleCloudCircleCount(bubble);
  const randomness = canvasBubbleCloudRandomness(bubble);
  const randomness2 = canvasBubbleCloudRandomness2(bubble);
  const circleSize = canvasBubbleCloudCircleSize(bubble);
  const randomSeed = canvasBubbleCloudRandomSeed(bubble);
  const rnd = (i, salt = 0) => canvasBubbleDeterministicRandom(randomSeed + 401 + salt, i + 1);
  const visualW = Math.max(1, Number(bubble?.w) || 18);
  const visualH = Math.max(1, Number(bubble?.h) || 12);
  const aspect = Math.max(0.12, Math.min(8, visualW / visualH));
  const aspectExtreme = Math.max(aspect, 1 / aspect);
  // When the whole bubble is stretched, do not stretch the same rim circles.
  // Add more circles along the edge instead, so the cloud keeps its lumpy density.
  const count = Math.max(baseCount, Math.min(48, Math.round(baseCount * Math.pow(aspectExtreme, 0.62))));
  const invScreenX = aspect > 1 ? 1 / aspect : 1;
  const invScreenY = aspect < 1 ? aspect : 1;
  const invScreenAvg = (invScreenX + invScreenY) / 2;
  const minR = Math.max(12, Math.min(rx, ry));
  const refR = 50;
  const parts = [];
  const coreRx = Math.max(8, rx * 0.82);
  const coreRy = Math.max(8, ry * 0.80);
  parts.push(`<ellipse stroke="none" cx="${cx.toFixed(3)}" cy="${cy.toFixed(3)}" rx="${coreRx.toFixed(3)}" ry="${coreRy.toFixed(3)}"></ellipse>`);
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (i / count) * Math.PI * 2;
    const radialJ = (rnd(i, 17) - 0.5) * 2 * randomness2;
    const tangentJ = (rnd(i, 23) - 0.5) * refR * 0.26 * invScreenAvg * randomness;
    const sizeJ = (rnd(i, 29) - 0.5) * randomness;
    const minorJ = (rnd(i, 43) - 0.5) * randomness;
    const centerMul = 0.82 + radialJ * 0.25 + (rnd(i, 13) - 0.5) * 0.06 * randomness;
    const tx = -Math.sin(a);
    const ty = Math.cos(a);
    const ex = cx + Math.cos(a) * rx * centerMul + tx * tangentJ * invScreenX;
    const ey = cy + Math.sin(a) * ry * centerMul + ty * tangentJ * invScreenY;
    const baseMajor = refR * circleSize * (0.32 + sizeJ * 0.20);
    const baseMinor = refR * circleSize * (0.22 + minorJ * 0.15);
    const squash = 1 - Math.abs(Math.sin(a)) * 0.10;
    const erx = Math.max(4, baseMajor * squash * invScreenX);
    const ery = Math.max(4, baseMinor * (1 + Math.abs(Math.sin(a)) * 0.18) * invScreenY);
    const rot = (a + Math.PI / 2) * 180 / Math.PI + (rnd(i, 59) - 0.5) * 18 * randomness;
    parts.push(`<ellipse stroke="none" cx="${ex.toFixed(3)}" cy="${ey.toFixed(3)}" rx="${erx.toFixed(3)}" ry="${ery.toFixed(3)}" transform="rotate(${rot.toFixed(3)} ${ex.toFixed(3)} ${ey.toFixed(3)})"></ellipse>`);
  }
  return parts.join('');
}
function canvasBubbleGearPath(bubble, cx, cy, rx, ry) {
  const lobes = 8;
  const inners = [];
  const outers = [];
  const minR = Math.max(12, Math.min(rx, ry));
  const pointFrom = (pt, angle, len) => ({ x: pt.x + Math.cos(angle) * len, y: pt.y + Math.sin(angle) * len });
  const peakOffset = -0.20 + canvasBubbleBurstPeakOffset(bubble);
  const valleyOffset = 0.25 + canvasBubbleBurstValleyOffset(bubble);
  const randomness = canvasBubbleBurstRandomness(bubble);
  const randomSeed = canvasBubbleBurstRandomSeed(bubble);
  const jitterPoint = (pt, pointIndex, radius) => {
    if (!(randomness > 0) || !(radius > 0)) return pt;
    const angle = canvasBubbleDeterministicRandom(randomSeed + 131, pointIndex * 2 + 1) * Math.PI * 2;
    const dist = Math.sqrt(canvasBubbleDeterministicRandom(randomSeed + 179, pointIndex * 2 + 2)) * radius * randomness;
    return { x: pt.x + Math.cos(angle) * dist, y: pt.y + Math.sin(angle) * dist };
  };
  const peakScaleJitter = [0.00, 0.04, -0.005, 0.03, 0.00, 0.04, -0.01, 0.02];
  const valleyScaleJitter = [0.00, -0.01, 0.01, 0.005, -0.005, 0.01, -0.005, 0.005];
  const peakHandleJitter = [1.00, 0.95, 1.02, 0.97, 1.00, 0.94, 1.03, 0.98];
  const valleyHandleJitter = [1.00, 1.05, 0.98, 1.03, 1.00, 1.06, 0.98, 1.02];
  for (let i = 0; i < lobes; i++) {
    const innerA = -Math.PI / 2 + (i / lobes) * Math.PI * 2;
    const outerA = innerA + Math.PI / lobes;
    const innerMod = 1.275 + peakOffset + peakScaleJitter[i % peakScaleJitter.length];
    const outerMod = 0.955 + valleyOffset + valleyScaleJitter[i % valleyScaleJitter.length];
    const innerBase = { x: cx + Math.cos(innerA) * rx * innerMod, y: cy + Math.sin(innerA) * ry * innerMod };
    const outerBase = { x: cx + Math.cos(outerA) * rx * outerMod, y: cy + Math.sin(outerA) * ry * outerMod };
    inners.push({
      a: innerA,
      handleMul: peakHandleJitter[i % peakHandleJitter.length],
      p: jitterPoint(innerBase, i, minR * 0.12)
    });
    outers.push({
      a: outerA,
      handleMul: valleyHandleJitter[i % valleyHandleJitter.length],
      p: jitterPoint(outerBase, 100 + i, minR * 0.14)
    });
  }
  const innerHandleLen = minR * 0.20;
  const outerHandleLen = minR * 0.40;
  const parts = [];
  parts.push(`M ${inners[0].p.x.toFixed(3)} ${inners[0].p.y.toFixed(3)}`);
  for (let i = 0; i < lobes; i++) {
    const inner = inners[i];
    const outer = outers[i];
    const nextInner = inners[(i + 1) % lobes];
    const innerOut = pointFrom(inner.p, inner.a + Math.PI / 2, innerHandleLen * inner.handleMul);
    const outerIn = pointFrom(outer.p, outer.a - Math.PI / 2, outerHandleLen * outer.handleMul);
    const outerOut = pointFrom(outer.p, outer.a + Math.PI / 2, outerHandleLen * outer.handleMul);
    const nextInnerIn = pointFrom(nextInner.p, nextInner.a - Math.PI / 2, innerHandleLen * nextInner.handleMul);
    parts.push(`C ${innerOut.x.toFixed(3)} ${innerOut.y.toFixed(3)} ${outerIn.x.toFixed(3)} ${outerIn.y.toFixed(3)} ${outer.p.x.toFixed(3)} ${outer.p.y.toFixed(3)}`);
    parts.push(`C ${outerOut.x.toFixed(3)} ${outerOut.y.toFixed(3)} ${nextInnerIn.x.toFixed(3)} ${nextInnerIn.y.toFixed(3)} ${nextInner.p.x.toFixed(3)} ${nextInner.p.y.toFixed(3)}`);
  }
  parts.push('Z');
  return parts.join(' ');
}
function canvasBubbleBurstPath(bubble, cx, cy, rx, ry) {
  const spikes = canvasBubbleBurstSpikeCount(bubble);
  const peaks = [];
  const valleys = [];
  const minR = Math.max(12, Math.min(rx, ry));
  // Keep Bezier handles proportional to the angular distance between points.
  // Without this, high point counts make handles overlap and the burst tangles.
  const spacingComp = Math.max(0.32, Math.min(1.15, Math.sin(Math.PI / spikes) / Math.sin(Math.PI / 8)));
  const pointFrom = (pt, angle, len) => ({ x: pt.x + Math.cos(angle) * len, y: pt.y + Math.sin(angle) * len });
  const peakOffset = canvasBubbleBurstPeakOffset(bubble);
  const valleyOffset = canvasBubbleBurstValleyOffset(bubble);
  const randomness = canvasBubbleBurstRandomness(bubble);
  const heightRandomness = canvasBubbleBurstRandomness2(bubble);
  const randomSeed = canvasBubbleBurstRandomSeed(bubble);
  const jitterPoint = (pt, pointIndex, radius) => {
    if (!(randomness > 0) || !(radius > 0)) return pt;
    const angle = canvasBubbleDeterministicRandom(randomSeed + 31, pointIndex * 2 + 1) * Math.PI * 2;
    const dist = Math.sqrt(canvasBubbleDeterministicRandom(randomSeed + 79, pointIndex * 2 + 2)) * radius * randomness;
    return { x: pt.x + Math.cos(angle) * dist, y: pt.y + Math.sin(angle) * dist };
  };
  // Mild built-in irregularity so the burst is less mechanical.
  const peakScaleJitter = [0.00, 0.04, -0.005, 0.03, 0.00, 0.04, -0.01, 0.02];
  const valleyScaleJitter = [0.00, -0.01, 0.01, 0.005, -0.005, 0.01, -0.005, 0.005];
  const peakHandleJitter = [1.00, 0.95, 1.02, 0.97, 1.00, 0.94, 1.03, 0.98];
  const valleyHandleJitter = [1.00, 1.05, 0.98, 1.03, 1.00, 1.06, 0.98, 1.02];
  for (let i = 0; i < spikes; i++) {
    const peakA = -Math.PI / 2 + (i / spikes) * Math.PI * 2;
    const valleyA = peakA + Math.PI / spikes;
    // Keep default shape slightly more inward; user offsets and randomness layer on top.
    // Height randomness changes each peak/valley along its own radial direction,
    // so high and low points can vary in height without tangling the Beziers.
    const peakHeightJitter = (canvasBubbleDeterministicRandom(randomSeed + 301, i * 2 + 1) - 0.5) * 2 * heightRandomness * 0.22 * spacingComp;
    const valleyHeightJitter = (canvasBubbleDeterministicRandom(randomSeed + 347, i * 2 + 2) - 0.5) * 2 * heightRandomness * 0.18 * spacingComp;
    const peakMod = 1.275 + peakOffset + peakScaleJitter[i % peakScaleJitter.length] + peakHeightJitter;
    const valleyMod = 0.955 + valleyOffset + valleyScaleJitter[i % valleyScaleJitter.length] + valleyHeightJitter;
    const peakBase = { x: cx + Math.cos(peakA) * rx * peakMod, y: cy + Math.sin(peakA) * ry * peakMod };
    const valleyBase = { x: cx + Math.cos(valleyA) * rx * valleyMod, y: cy + Math.sin(valleyA) * ry * valleyMod };
    peaks.push({
      a: peakA,
      handleMul: peakHandleJitter[i % peakHandleJitter.length],
      p: jitterPoint(peakBase, i, minR * 0.20 * spacingComp)
    });
    valleys.push({
      a: valleyA,
      handleMul: valleyHandleJitter[i % valleyHandleJitter.length],
      p: jitterPoint(valleyBase, 100 + i, minR * 0.15 * spacingComp)
    });
  }
  const peakHandleLen = minR * 0.108 * spacingComp;
  const valleyHandleLen = minR * 0.32 * spacingComp;
  const inwardAngle = (Math.max(1.4, Math.min(4, 4 * spacingComp)) * Math.PI) / 180;
  const parts = [];
  parts.push(`M ${peaks[0].p.x.toFixed(3)} ${peaks[0].p.y.toFixed(3)}`);
  if (canvasBubbleBurstJagged(bubble)) {
    for (let i = 0; i < spikes; i++) {
      const valley = valleys[i];
      const nextPeak = peaks[(i + 1) % spikes];
      parts.push(`L ${valley.p.x.toFixed(3)} ${valley.p.y.toFixed(3)}`);
      parts.push(`L ${nextPeak.p.x.toFixed(3)} ${nextPeak.p.y.toFixed(3)}`);
    }
    parts.push('Z');
    return parts.join(' ');
  }
  for (let i = 0; i < spikes; i++) {
    const peak = peaks[i];
    const valley = valleys[i];
    const nextPeak = peaks[(i + 1) % spikes];
    const peakOut = pointFrom(peak.p, peak.a + Math.PI + inwardAngle, peakHandleLen * peak.handleMul);
    const valleyIn = pointFrom(valley.p, valley.a - Math.PI / 2, valleyHandleLen * valley.handleMul);
    const valleyOut = pointFrom(valley.p, valley.a + Math.PI / 2, valleyHandleLen * valley.handleMul);
    const nextPeakIn = pointFrom(nextPeak.p, nextPeak.a + Math.PI - inwardAngle, peakHandleLen * nextPeak.handleMul);
    parts.push(`C ${peakOut.x.toFixed(3)} ${peakOut.y.toFixed(3)} ${valleyIn.x.toFixed(3)} ${valleyIn.y.toFixed(3)} ${valley.p.x.toFixed(3)} ${valley.p.y.toFixed(3)}`);
    parts.push(`C ${valleyOut.x.toFixed(3)} ${valleyOut.y.toFixed(3)} ${nextPeakIn.x.toFixed(3)} ${nextPeakIn.y.toFixed(3)} ${nextPeak.p.x.toFixed(3)} ${nextPeak.p.y.toFixed(3)}`);
  }
  parts.push('Z');
  return parts.join(' ');
}
function canvasBubbleShapeSvg(shape, cx, cy, rx, ry, bubble = null) {
  if (shape === "cloud" || shape === "cloud2") return canvasBubbleCloudRimSvg(bubble, cx, cy, rx, ry);
  if (shape === "gear") return `<path stroke="none" d="${safeAttr(canvasBubbleGearPath(bubble, cx, cy, rx, ry))}"></path>`;
  if (shape === "burst") return `<path stroke="none" d="${safeAttr(canvasBubbleBurstPath(bubble, cx, cy, rx, ry))}"></path>`;
  return `<ellipse stroke="none" cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"></ellipse>`;
}
function canvasBubbleDualLayerEnabled(bubble) {
  return !!bubble && String(bubble.type || "speech") !== "caption";
}
function canvasBubbleTailPctGeometry(bubble) {
  const g = canvasBubbleTailGeometry(bubble);
  const xp = (x) => (Number(x) / Math.max(1, g.viewW)) * 100;
  const p = (pt) => ({ x: xp(pt[0]), y: Number(pt[1]) });
  const points = g.points.map(p);
  const baseCenter = { x: xp(g.baseCenter[0]), y: Number(g.baseCenter[1]) };
  const baseContour = { x: xp(g.baseContour[0]), y: Number(g.baseContour[1]) };
  const anchor = { x: xp(g.anchor[0]), y: Number(g.anchor[1]) };
  const cpRaw = canvasBubbleTailCurved(bubble) ? canvasBubbleTailCurvePoint(bubble) : null;
  const cp = cpRaw ? { x: xp(cpRaw[0]), y: Number(cpRaw[1]) } : null;
  return {
    points,
    baseCenter,
    baseContour,
    anchor,
    tangent: { x: Number(g.tangent[0]) || 1, y: Number(g.tangent[1]) || 0 },
    cp
  };
}
function canvasBubbleDualSpeechTailShapes(bubble, pad = 1.6) {
  const visualW = Math.max(1, Number(bubble?.w) || 18);
  const visualH = Math.max(1, Number(bubble?.h) || 12);
  const aspectExtreme = Math.max(visualW / visualH, visualH / visualW);
  // Keep the jagged/curved tail contour from becoming over-compensated on very flat/tall bubbles.
  pad *= Math.max(0.58, Math.min(1, 1 / Math.pow(Math.max(1, aspectExtreme), 0.30)));
  const tg = canvasBubbleTailPctGeometry(bubble);
  const [p1i, tipI, p2i] = tg.points;
  const base = tg.baseCenter;
  const half = Math.hypot(p2i.x - p1i.x, p2i.y - p1i.y) / 2;
  const cp = tg.cp || null;
  const normalize = (x, y) => {
    const len = Math.hypot(x, y) || 1;
    return { x: x / len, y: y / len };
  };
  if (canvasBubbleTailJagged(bubble)) {
    const tailContourOffset = bubbleTuningValue("tailContourOffset");
    const outer = canvasBubbleJaggedTaperPath(bubble, base, tipI, half, {
      grow: Math.max(0.01, pad + 0.5 + tailContourOffset),
      baseOverlap: Math.max(bubbleTuningValue("tailBlackBaseInset"), pad * bubbleTuningValue("tailBlackBaseMult")) + 0.6,
      tipExtend: Math.max(0, pad * 1.15 + 0.5 + tailContourOffset),
      tipInset: 0
    });
    const inner = canvasBubbleJaggedTaperPath(bubble, base, tipI, half, {
      grow: 0,
      baseOverlap: Math.max(bubbleTuningValue("tailWhiteBaseInset"), pad * bubbleTuningValue("tailWhiteBaseMult")) + 0.45,
      tipExtend: 0,
      tipInset: bubbleTuningValue("whiteTipInset")
    });
    return { outer, inner, bboxPts: [p1i, p2i, tipI, base] };
  }
  const qPoint = (t) => {
    if (!cp) return { x: base.x + (tipI.x - base.x) * t, y: base.y + (tipI.y - base.y) * t };
    const mt = 1 - t;
    return {
      x: mt * mt * base.x + 2 * mt * t * cp.x + t * t * tipI.x,
      y: mt * mt * base.y + 2 * mt * t * cp.y + t * t * tipI.y
    };
  };
  const qTangent = (t) => {
    if (!cp) return normalize(tipI.x - base.x, tipI.y - base.y);
    return normalize(
      2 * (1 - t) * (cp.x - base.x) + 2 * t * (tipI.x - cp.x),
      2 * (1 - t) * (cp.y - base.y) + 2 * t * (tipI.y - cp.y)
    );
  };
  const samples = [];
  let totalLen = 0;
  let prev = qPoint(0);
  samples.push({ t: 0, len: 0, p: prev, tangent: qTangent(0) });
  for (let i = 1; i <= 96; i++) {
    const t = i / 96;
    const p = qPoint(t);
    totalLen += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
    samples.push({ t, len: totalLen, p, tangent: qTangent(t) });
  }
  const pointAtLen = (targetLen) => {
    if (targetLen <= 0) {
      const t0 = samples[0].tangent;
      const p0 = samples[0].p;
      return { p: { x: p0.x + t0.x * targetLen, y: p0.y + t0.y * targetLen }, tangent: t0 };
    }
    if (targetLen >= totalLen) {
      const last = samples[samples.length - 1];
      return { p: { x: last.p.x + last.tangent.x * (targetLen - totalLen), y: last.p.y + last.tangent.y * (targetLen - totalLen) }, tangent: last.tangent };
    }
    for (let i = 1; i < samples.length; i++) {
      if (samples[i].len >= targetLen) {
        const a = samples[i - 1];
        const b = samples[i];
        const span = Math.max(0.0001, b.len - a.len);
        const u = (targetLen - a.len) / span;
        const t = a.t + (b.t - a.t) * u;
        return {
          p: {
            x: a.p.x + (b.p.x - a.p.x) * u,
            y: a.p.y + (b.p.y - a.p.y) * u
          },
          tangent: qTangent(t)
        };
      }
    }
    return samples[samples.length - 1];
  };
  const makeTaperPath = ({ grow = 0, baseOverlap = 0, tipExtend = 0, tipInset = 0 } = {}) => {
    const startLen = -baseOverlap;
    const endLen = Math.max(startLen + 0.1, totalLen + tipExtend - tipInset);
    const width0 = Math.max(0.05, half + grow);
    const steps = 44;
    const left = [];
    const right = [];
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const len = startLen + (endLen - startLen) * u;
      const sample = pointAtLen(len);
      const tx = sample.tangent.x;
      const ty = sample.tangent.y;
      const nx = -ty;
      const ny = tx;
      const taper = Math.pow(Math.max(0, 1 - u), 0.92);
      const width = width0 * taper;
      left.push({ x: sample.p.x + nx * width, y: sample.p.y + ny * width });
      right.push({ x: sample.p.x - nx * width, y: sample.p.y - ny * width });
    }
    const parts = [];
    left.forEach((pt, i) => parts.push(`${i ? "L" : "M"} ${pt.x.toFixed(3)} ${pt.y.toFixed(3)}`));
    right.reverse().forEach(pt => parts.push(`L ${pt.x.toFixed(3)} ${pt.y.toFixed(3)}`));
    parts.push("Z");
    return parts.join(" ");
  };
  // v2.32.02: both black and white tail layers are generated from the same
  // centerline curve samples. The white layer is only shorter/narrower along
  // that same skeleton, so the curves match instead of diverging.
  const tailContourOffset = bubbleTuningValue("tailContourOffset");
  const outer = makeTaperPath({
    grow: Math.max(0.01, pad + 0.5 + tailContourOffset),
    baseOverlap: Math.max(bubbleTuningValue("tailBlackBaseInset"), pad * bubbleTuningValue("tailBlackBaseMult")) + 0.6,
    tipExtend: Math.max(0, pad * 1.15 + 0.5 + tailContourOffset),
    tipInset: 0
  });
  const inner = makeTaperPath({
    grow: 0,
    baseOverlap: Math.max(bubbleTuningValue("tailWhiteBaseInset"), pad * bubbleTuningValue("tailWhiteBaseMult")) + 0.45,
    tipExtend: 0,
    tipInset: bubbleTuningValue("whiteTipInset")
  });
  const bboxPts = [p1i, p2i, tipI, base];
  if (cp) bboxPts.push(cp);
  return { outer, inner, bboxPts };
}
function canvasBubbleDualThoughtShapes(bubble, pad = 1.6) {
  const thought = canvasBubbleThoughtTailData(bubble);
  const dots = (thought.dots || []).map(dot => ({
    cx: (Number(dot.cx) / Math.max(1, thought.viewW)) * 100,
    cy: Number(dot.cy),
    rx: (Number(dot.rx) / Math.max(1, thought.viewW)) * 100,
    ry: Number(dot.ry),
    angle: Number(dot.angle) || 0
  }));
  const outer = dots.map(dot => ({ ...dot, rx: dot.rx + pad, ry: dot.ry + pad }));
  return { inner: dots, outer };
}
function canvasBubbleBridgeEllipses(bubble) {
  const attached = canvasBubbleAttachedBubbleData(bubble);
  if (!attached.length) return [];
  return [
    { cx: 50, cy: 50, rx: 50, ry: 50 },
    ...attached.map(sec => ({ cx: sec.x + sec.w / 2, cy: sec.y + sec.h / 2, rx: Math.max(8, sec.w / 2), ry: Math.max(8, sec.h / 2) }))
  ];
}
function canvasBubbleBridgeDefaultBendPoint(bubble, bridgeIndex = 1) {
  const ellipses = canvasBubbleBridgeEllipses(bubble);
  const i = Math.max(0, Math.min(ellipses.length - 2, Math.round(Number(bridgeIndex) || 1) - 1));
  const from = ellipses[i];
  const to = ellipses[i + 1];
  if (!from || !to) return { x: 50, y: 50 };
  return { x: (from.cx + to.cx) / 2, y: (from.cy + to.cy) / 2 };
}
function canvasBubbleBridgeBendOffset(bubble, bridgeIndex = 1) {
  const i = Math.max(1, Math.min(3, Math.round(Number(bridgeIndex) || 1)));
  const ox = Number(bubble?.[`secondaryBridgeBend${i}OffsetX`]);
  const oy = Number(bubble?.[`secondaryBridgeBend${i}OffsetY`]);
  if (Number.isFinite(ox) && Number.isFinite(oy) && (Math.abs(ox) > 0.001 || Math.abs(oy) > 0.001)) return { x: ox, y: oy };
  if (bubble?.[`secondaryBridgeBend${i}Custom`] === true) {
    const x = Number(bubble[`secondaryBridgeBend${i}X`]);
    const y = Number(bubble[`secondaryBridgeBend${i}Y`]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      const d = canvasBubbleBridgeDefaultBendPoint(bubble, i);
      return { x: x - d.x, y: y - d.y };
    }
  }
  return { x: 0, y: 0 };
}
function canvasBubbleEnsureBridgeBendOffsets(bubble) {
  if (!bubble) return;
  for (let i = 1; i <= 3; i++) {
    if (bubble[`secondaryBridgeBend${i}Custom`] !== true) continue;
    const ox = Number(bubble[`secondaryBridgeBend${i}OffsetX`]);
    const oy = Number(bubble[`secondaryBridgeBend${i}OffsetY`]);
    if (Number.isFinite(ox) && Number.isFinite(oy) && (Math.abs(ox) > 0.001 || Math.abs(oy) > 0.001)) continue;
    const x = Number(bubble[`secondaryBridgeBend${i}X`]);
    const y = Number(bubble[`secondaryBridgeBend${i}Y`]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const d = canvasBubbleBridgeDefaultBendPoint(bubble, i);
    bubble[`secondaryBridgeBend${i}OffsetX`] = Math.round((x - d.x) * 10) / 10;
    bubble[`secondaryBridgeBend${i}OffsetY`] = Math.round((y - d.y) * 10) / 10;
  }
}
function canvasBubbleBridgeBendPoint(bubble, bridgeIndex = 1) {
  const i = Math.max(1, Math.min(3, Math.round(Number(bridgeIndex) || 1)));
  const d = canvasBubbleBridgeDefaultBendPoint(bubble, i);
  if (bubble?.[`secondaryBridgeBend${i}Custom`] === true) {
    const o = canvasBubbleBridgeBendOffset(bubble, i);
    return { x: d.x + o.x, y: d.y + o.y };
  }
  return d;
}
function canvasBubbleBridgeBendHandlesHtml(bubble) {
  if (!canvasBubbleSecondaryBridgeEnabled(bubble)) return "";
  const count = canvasBubbleAttachedCount(bubble);
  if (!count) return "";
  const max = Math.min(3, count);
  const handles = [];
  for (let i = 1; i <= max; i++) {
    const p = canvasBubbleBridgeBendPoint(bubble, i);
    handles.push(`<div class="canvas-bridge-bend-handle" data-bridge-bend="${i}" title="Drag bridge ${i} bend point" style="left:${p.x}%;top:${p.y}%;"></div>`);
  }
  return handles.join("");
}

function canvasBubbleDualBridgeShapes(bubble, pad = 1.6) {
  if (!canvasBubbleSecondaryBridgeEnabled(bubble)) return null;
  const ellipses = canvasBubbleBridgeEllipses(bubble);
  if (ellipses.length < 2) return null;
  const baseA0 = Math.max(3, Math.min(42, Number(bubble.secondaryBridgeBaseA || 12)));
  const baseB0 = Math.max(3, Math.min(42, Number(bubble.secondaryBridgeBaseB || 12)));
  const curve = Math.max(-9, Math.min(42, Number(bubble.secondaryBridgeCurve || 0)));
  const boundary = (e, dirX, dirY) => {
    const d = 1 / Math.sqrt((dirX * dirX) / (e.rx * e.rx) + (dirY * dirY) / (e.ry * e.ry));
    return { x: e.cx + dirX * d, y: e.cy + dirY * d };
  };
  const makeBridge = (from, to, index, inner = false) => {
    const dx = to.cx - from.cx;
    const dy = to.cy - from.cy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    const a = boundary(from, ux, uy);
    const b = boundary(to, -ux, -uy);

    // Keep the original bridge-curve behavior: the curve value pulls the two sides
    // toward or away from each other, instead of bending the whole bridge centerline.
    const baseA = index === 0 ? baseA0 : Math.max(5, baseB0 * 0.86);
    const baseB = index === 0 ? baseB0 : Math.max(5, baseB0 * 0.82);
    const growRaw = inner ? 0 : pad * 2 - (index > 0 ? 0.5 : 0);
    const grow = Math.max(0, growRaw);
    const aa = Math.max(1.6, baseA + grow);
    const bb = Math.max(1.6, baseB + grow);
    const a1 = { x: a.x + nx * aa / 2, y: a.y + ny * aa / 2 };
    const a2 = { x: a.x - nx * aa / 2, y: a.y - ny * aa / 2 };
    const b1 = { x: b.x + nx * bb / 2, y: b.y + ny * bb / 2 };
    const b2 = { x: b.x - nx * bb / 2, y: b.y - ny * bb / 2 };

    // Both bridge layers should follow the same start/end overlap logic.
    // Unlike the speech tail, the white bridge layer does not need a separate
    // axial offset at the bases, otherwise the black/white layers drift apart.
    const fromCenterInset = Math.hypot(a.x - from.cx, a.y - from.cy);
    const toCenterInset = Math.hypot(to.cx - b.x, to.cy - b.y);
    const fromInset = index === 0
      ? Math.max(2.2, pad * 1.65)
      : Math.max(fromCenterInset * 0.82, pad * 3.2);
    const toInset = Math.max(toCenterInset * 0.82, pad * 3.8);
    const a1f = { x: a1.x - ux * fromInset, y: a1.y - uy * fromInset };
    const a2f = { x: a2.x - ux * fromInset, y: a2.y - uy * fromInset };
    const b1f = { x: b1.x + ux * toInset, y: b1.y + uy * toInset };
    const b2f = { x: b2.x + ux * toInset, y: b2.y + uy * toInset };

    const curveDir = index === 0 ? curve : curve * 0.72;
    const defaultBend = canvasBubbleBridgeDefaultBendPoint(bubble, index + 1);
    const bend = canvasBubbleBridgeBendPoint(bubble, index + 1);
    const bendDx = bend.x - defaultBend.x;
    const bendDy = bend.y - defaultBend.y;
    const c1 = { x: (a1.x + b1.x) / 2 + nx * curveDir + bendDx, y: (a1.y + b1.y) / 2 + ny * curveDir + bendDy };
    const c2 = { x: (a2.x + b2.x) / 2 - nx * curveDir + bendDx, y: (a2.y + b2.y) / 2 - ny * curveDir + bendDy };
    return {
      path: `M ${a1f.x.toFixed(3)} ${a1f.y.toFixed(3)} Q ${c1.x.toFixed(3)} ${c1.y.toFixed(3)} ${b1f.x.toFixed(3)} ${b1f.y.toFixed(3)} L ${b2f.x.toFixed(3)} ${b2f.y.toFixed(3)} Q ${c2.x.toFixed(3)} ${c2.y.toFixed(3)} ${a2f.x.toFixed(3)} ${a2f.y.toFixed(3)} Z`,
      pts: [a1f, a2f, b1f, b2f, c1, c2]
    };
  };
  const result = [];
  for (let i = 0; i < ellipses.length - 1; i++) {
    result.push({ outer: makeBridge(ellipses[i], ellipses[i + 1], i, false), inner: makeBridge(ellipses[i], ellipses[i + 1], i, true) });
  }
  return result;
}
function canvasBubbleDualLayerSvg(bubble) {
  if (!canvasBubbleDualLayerEnabled(bubble)) return "";
  const stroke = Math.max(0.1, Math.min(5, canvasBubbleTailOuterStroke(bubble)));
  const pad = Math.max(0.02, Math.min(4.0, (stroke * 0.75) + bubbleTuningValue("globalContourPadAdjust")));
  const bboxPts = [];
  const outerShapes = [];
  const innerShapes = [];
  const pushEllipseBBox = (cx, cy, rx, ry) => {
    bboxPts.push({ x: cx - rx, y: cy - ry }, { x: cx + rx, y: cy + ry });
  };

  const bubbleShape = canvasBubbleShapeType(bubble);
  // v2.32.55: dual-layer contour is built in percentage coordinates and the SVG is
  // stretched with preserveAspectRatio="none". A single pad value therefore becomes
  // visually thinner on the compressed axis. Compensate X/Y independently so a 2px
  // contour stays visually ~2px on all sides while the bubble is resized.
  const contourAxisPads = (basePad) => {
    const visualW = Math.max(1, Number(bubble.w) || 18);
    const visualH = Math.max(1, Number(bubble.h) || 12);
    const aspect = Math.max(0.12, Math.min(8, visualW / visualH));
    const xFactor = aspect < 1 ? Math.pow(1 / aspect, 0.5) : 1;
    const yFactor = aspect > 1 ? Math.pow(aspect, 0.5) : 1;
    return {
      x: basePad * xFactor,
      y: basePad * yFactor
    };
  };
  const baseShapePad = bubbleShape === "burst" ? pad + 0.45 : pad;
  const shapePad = contourAxisPads(baseShapePad);
  const shapeOuterPad = Math.max(shapePad.x, shapePad.y);

  // Main bubble: bottom layer is a full black silhouette, top layer is a full white silhouette.
  pushEllipseBBox(50, 50, 50 + shapePad.x + (bubbleShape === "oval" ? 0 : 10), 50 + shapePad.y + (bubbleShape === "oval" ? 0 : 10));
  outerShapes.push(canvasBubbleShapeSvg(bubbleShape, 50, 50, 50 + shapePad.x, 50 + shapePad.y, bubble));
  innerShapes.push(canvasBubbleShapeSvg(bubbleShape, 50, 50, 50, 50, bubble));

  canvasBubbleAttachedBubbleData(bubble).forEach(sec => {
    const cx = sec.x + sec.w / 2;
    const cy = sec.y + sec.h / 2;
    const rx = Math.max(8, sec.w / 2);
    const ry = Math.max(8, sec.h / 2);
    const shapeBubble = { ...bubble, secondaryIndex: Math.max(1, Math.min(3, Math.round(Number(sec.secondaryIndex) || 1))) };
    pushEllipseBBox(cx, cy, rx + shapePad.x + (bubbleShape === "oval" ? 0 : 10), ry + shapePad.y + (bubbleShape === "oval" ? 0 : 10));
    outerShapes.push(canvasBubbleShapeSvg(bubbleShape, cx, cy, rx + shapePad.x, ry + shapePad.y, shapeBubble));
    innerShapes.push(canvasBubbleShapeSvg(bubbleShape, cx, cy, rx, ry, shapeBubble));
  });

  if (canvasBubbleHasAttachedSecondary(bubble) && canvasBubbleSecondaryBridgeEnabled(bubble)) {
    const bridge = canvasBubbleDualBridgeShapes(bubble, pad);
    if (bridge) {
      const bridges = Array.isArray(bridge) ? bridge : [bridge];
      bridges.forEach(part => {
        bboxPts.push(...part.outer.pts);
        outerShapes.push(`<path stroke="none" d="${safeAttr(part.outer.path)}"></path>`);
        innerShapes.push(`<path stroke="none" d="${safeAttr(part.inner.path)}"></path>`);
      });
    }
  }

  if (canvasBubbleIsThought(bubble)) {
    const thoughtMerge = canvasBubbleThoughtBubblesMergeEnabled(bubble);
    // v2.32.07 debug tuning: thought contour values are live-adjustable.
    const thought = canvasBubbleDualThoughtShapes(bubble, thoughtMerge ? Math.max(0.01, pad + bubbleTuningValue("thoughtMergeOnExtra")) : pad);
    const standaloneStroke = Math.max(0.1, stroke - 0.1);
    if (thoughtMerge) {
      thought.outer.forEach(dot => {
        pushEllipseBBox(dot.cx, dot.cy, dot.rx, dot.ry);
        outerShapes.push(`<ellipse stroke="none" cx="${dot.cx}" cy="${dot.cy}" rx="${dot.rx}" ry="${dot.ry}" transform="rotate(${dot.angle} ${dot.cx} ${dot.cy})"></ellipse>`);
      });
    } else {
      thought.inner.forEach(dot => {
        pushEllipseBBox(dot.cx, dot.cy, dot.rx + standaloneStroke, dot.ry + standaloneStroke);
      });
    }
    thought.inner.forEach(dot => {
      const cls = thoughtMerge ? '' : ' class="thought-inner-standalone"';
      innerShapes.push(`<ellipse${cls} stroke="none" cx="${dot.cx}" cy="${dot.cy}" rx="${dot.rx}" ry="${dot.ry}" transform="rotate(${dot.angle} ${dot.cx} ${dot.cy})"></ellipse>`);
    });
  } else {
    const tail = canvasBubbleDualSpeechTailShapes(bubble, pad);
    bboxPts.push(...tail.bboxPts);
    outerShapes.push(`<path stroke="none" d="${safeAttr(tail.outer)}"></path>`);
    innerShapes.push(`<path stroke="none" d="${safeAttr(tail.inner)}"></path>`);
  }

  // v2.31.93: keep the SVG viewport fixed while tail/dots move.
  // Before this, the SVG bbox was recomputed from the moving tail, so left/top/width/height
  // changed every drag frame and caused visible raster jitter. These bounds cover the
  // normalized editor range but never resize during interaction.
  const minX = -220;
  const minY = -220;
  const w = 540;
  const h = 540;
  return `<svg class="canvas-bubble-dual-layer-svg" viewBox="${minX} ${minY} ${w} ${h}" preserveAspectRatio="none" aria-hidden="true" style="left:${minX}%;top:${minY}%;width:${w}%;height:${h}%;"><g class="bubble-dual-layer-outer">${outerShapes.join('')}</g><g class="bubble-dual-layer-inner">${innerShapes.join('')}</g></svg>`;
}

function updateCanvasBubbleDualLayerDom(bubble) {
  const el = bubble?.id ? $(`#comicCanvas .canvas-bubble[data-bubble-id="${cssEscapeValue(bubble.id)}"]`) : null;
  if (!el || !bubble) return;
  const html = canvasBubbleDualLayerSvg(bubble);
  const old = el.querySelector('.canvas-bubble-dual-layer-svg');
  if (old && html) old.outerHTML = html;
  else if (old && !html) old.remove();
  else if (html) el.insertAdjacentHTML('afterbegin', html);
}

function canvasBubbleCompoundHullPath(points) {
  const pts = (points || []).filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))
    .sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x);
  if (pts.length < 3) return [];
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
function canvasBubbleSecondaryUnionSpeechTailPath(bubble, minX, minY, w, h) {
  if (!bubble || String(bubble.type || "speech") === "caption" || canvasBubbleIsThought(bubble) || bubble.tailHidden === true) return "";
  const geom = canvasBubbleTailGeometry(bubble);
  const pts = geom.points.map(([x, y]) => ({
    x: (((x / geom.viewW) * 100) - minX) / w * 100,
    y: ((y - minY) / h) * 100
  }));
  if (pts.length < 3) return "";
  const p1 = pts[0], tip = pts[1], p2 = pts[2];
  if (canvasBubbleTailCurved(bubble)) {
    const cpRaw = canvasBubbleTailCurvePoint(bubble);
    const cp = { x: (((cpRaw[0] / geom.viewW) * 100) - minX) / w * 100, y: ((cpRaw[1] - minY) / h) * 100 };
    return `M ${p1.x.toFixed(3)} ${p1.y.toFixed(3)} Q ${cp.x.toFixed(3)} ${cp.y.toFixed(3)} ${tip.x.toFixed(3)} ${tip.y.toFixed(3)} Q ${cp.x.toFixed(3)} ${cp.y.toFixed(3)} ${p2.x.toFixed(3)} ${p2.y.toFixed(3)} Z`;
  }
  return `M ${p1.x.toFixed(3)} ${p1.y.toFixed(3)} L ${tip.x.toFixed(3)} ${tip.y.toFixed(3)} L ${p2.x.toFixed(3)} ${p2.y.toFixed(3)} Z`;
}
function canvasBubbleSecondaryUnionSpeechTailEdges(bubble, minX, minY, w, h) {
  if (!bubble || String(bubble.type || "speech") === "caption" || canvasBubbleIsThought(bubble) || bubble.tailHidden === true) return "";
  const geom = canvasBubbleTailGeometry(bubble);
  const pts = geom.points.map(([x, y]) => ({
    x: (((x / geom.viewW) * 100) - minX) / w * 100,
    y: ((y - minY) / h) * 100
  }));
  if (pts.length < 3) return "";
  const p1 = pts[0], tip = pts[1], p2 = pts[2];
  if (canvasBubbleTailCurved(bubble)) {
    const cpRaw = canvasBubbleTailCurvePoint(bubble);
    const cp = { x: (((cpRaw[0] / geom.viewW) * 100) - minX) / w * 100, y: ((cpRaw[1] - minY) / h) * 100 };
    return `<path class="canvas-bubble-union-tail-edge" d="M ${p1.x.toFixed(3)} ${p1.y.toFixed(3)} Q ${cp.x.toFixed(3)} ${cp.y.toFixed(3)} ${tip.x.toFixed(3)} ${tip.y.toFixed(3)}"></path><path class="canvas-bubble-union-tail-edge" d="M ${p2.x.toFixed(3)} ${p2.y.toFixed(3)} Q ${cp.x.toFixed(3)} ${cp.y.toFixed(3)} ${tip.x.toFixed(3)} ${tip.y.toFixed(3)}"></path>`;
  }
  return `<path class="canvas-bubble-union-tail-edge" d="M ${p1.x.toFixed(3)} ${p1.y.toFixed(3)} L ${tip.x.toFixed(3)} ${tip.y.toFixed(3)}"></path><path class="canvas-bubble-union-tail-edge" d="M ${p2.x.toFixed(3)} ${p2.y.toFixed(3)} L ${tip.x.toFixed(3)} ${tip.y.toFixed(3)}"></path>`;
}

function canvasBubbleSecondaryUnionThoughtBounds(bubble) {
  if (!bubble || !canvasBubbleIsThought(bubble) || bubble.tailHidden === true) return [];
  const thought = canvasBubbleThoughtTailData(bubble);
  const pts = [];
  for (const dot of thought.dots || []) {
    const rx = Number(dot.rx) || 0;
    const ry = Number(dot.ry) || 0;
    pts.push({ x: ((Number(dot.cx) || 0) - rx) / Math.max(1, thought.viewW) * 100, y: (Number(dot.cy) || 0) - ry });
    pts.push({ x: ((Number(dot.cx) || 0) + rx) / Math.max(1, thought.viewW) * 100, y: (Number(dot.cy) || 0) + ry });
  }
  if (thought.join && Math.hypot(thought.join.x2 - thought.join.x1, thought.join.y2 - thought.join.y1) > 0.35) {
    const w = Math.max(1, Number(thought.join.width) || 1);
    [thought.join.x1, thought.join.x2].forEach((x, i) => {
      const y = i ? thought.join.y2 : thought.join.y1;
      pts.push({ x: (x - w) / Math.max(1, thought.viewW) * 100, y: y - w });
      pts.push({ x: (x + w) / Math.max(1, thought.viewW) * 100, y: y + w });
    });
  }
  return pts;
}
function canvasBubbleSecondaryUnionThoughtShapes(bubble, minX, minY, w, h, solid = false) {
  if (!bubble || !canvasBubbleIsThought(bubble) || bubble.tailHidden === true) return "";
  const thought = canvasBubbleThoughtTailData(bubble);
  const viewW = Math.max(1, thought.viewW);
  const normX = x => (((x / viewW) * 100) - minX) / w * 100;
  const normY = y => (y - minY) / h * 100;
  const dots = (thought.dots || []).map(dot => {
    const cx = normX(Number(dot.cx) || 0);
    const cy = normY(Number(dot.cy) || 0);
    const rx = ((Number(dot.rx) || 0) / viewW * 100) / w * 100;
    const ry = ((Number(dot.ry) || 0) / h) * 100;
    return `<ellipse cx="${cx.toFixed(3)}" cy="${cy.toFixed(3)}" rx="${rx.toFixed(3)}" ry="${ry.toFixed(3)}" transform="rotate(${Number(dot.angle) || 0} ${cx.toFixed(3)} ${cy.toFixed(3)})"></ellipse>`;
  }).join("");
  const join = thought.join && Math.hypot(thought.join.x2 - thought.join.x1, thought.join.y2 - thought.join.y1) > 0.35
    ? `<line x1="${normX(thought.join.x1).toFixed(3)}" y1="${normY(thought.join.y1).toFixed(3)}" x2="${normX(thought.join.x2).toFixed(3)}" y2="${normY(thought.join.y2).toFixed(3)}" style="stroke-width:${Math.max(0.5, ((Number(thought.join.width) || 1) / h) * 100).toFixed(3)}"></line>`
    : "";
  return solid ? `<g class="canvas-bubble-union-thought-solid">${dots}${join}</g>` : `${dots}${join}`;
}

function canvasBubbleSecondaryCompoundSvg(bubble) {
  // v2.31.92: residual boolean/alpha-union bubble rendering is fully disabled.
  // The bubble assembly is now drawn only by the dual-layer silhouette system.
  return "";
}


function canvasBubbleSecondaryFieldPrefix(index = 1) {
  const n = Math.max(1, Math.min(3, Math.round(Number(index) || 1)));
  return n === 1 ? "secondary" : `secondary${n}`;
}
function canvasBubbleSecondaryBounds(index = 1) {
  const n = Math.max(1, Math.min(3, Math.round(Number(index) || 1)));
  if (n === 3) return { minX: -120, maxX: 320, minY: -120, maxY: 320, fallbackX: 180, fallbackY: 40, fallbackW: 54, fallbackH: 52 };
  if (n === 2) return { minX: -120, maxX: 260, minY: -120, maxY: 260, fallbackX: 130, fallbackY: 8, fallbackW: 62, fallbackH: 60 };
  return { minX: -120, maxX: 220, minY: -120, maxY: 220, fallbackX: 72, fallbackY: -18, fallbackW: 70, fallbackH: 68 };
}

function canvasBubbleSecondaryHtml(bubble) {
  const compound = canvasBubbleSecondaryCompoundSvg(bubble);
  const bubbles = canvasBubbleAttachedBubbleData(bubble);
  if (!bubbles.length) return compound;
  const html = bubbles.map((sec) => {
    return `<div class="canvas-bubble-secondary secondary-${sec.index}" data-secondary-bubble="${sec.index}" title="Drag to move. Drag corner to resize. Double-click to edit secondary text." style="--bubble-secondary-x:${sec.x}%;--bubble-secondary-y:${sec.y}%;--bubble-secondary-w:${sec.w}%;--bubble-secondary-h:${sec.h}%;--bubble-secondary-font-scale:${sec.fontScale};"><div class="canvas-bubble-secondary-text">${safeText(sec.text)}</div><div class="canvas-secondary-resize-handle" data-secondary-resize="1" title="Resize secondary bubble"></div></div>`;
  }).join('');
  return `${compound}${canvasBubbleSecondaryStandaloneBridgeSvg(bubble)}${html}`;
}
function addSelectedCanvasSecondaryBubble() {
  const canvas = activeCanvasObj();
  const bubble = selectedCanvasBubble();
  if (!canvas || !bubble || String(bubble.type || "speech") === "caption") return;
  const current = canvasBubbleAttachedCount(bubble);
  const next = current >= 3 ? 0 : current + 1;
  bubble.secondaryEnabled = next > 0;
  bubble.secondaryCount = next;
  if (next > 0) {
    bubble.secondaryText = String(bubble.secondaryText || "...").slice(0, 500) || "...";
    bubble.secondaryX = Number.isFinite(Number(bubble.secondaryX)) ? bubble.secondaryX : 72;
    bubble.secondaryY = Number.isFinite(Number(bubble.secondaryY)) ? bubble.secondaryY : -18;
    bubble.secondaryW = Number.isFinite(Number(bubble.secondaryW)) ? bubble.secondaryW : 70;
    bubble.secondaryH = Number.isFinite(Number(bubble.secondaryH)) ? bubble.secondaryH : 68;
    bubble.secondaryFontScale = Number.isFinite(Number(bubble.secondaryFontScale)) ? bubble.secondaryFontScale : 0.86;
    bubble.secondary2Text = String(bubble.secondary2Text || "...").slice(0, 500) || "...";
    bubble.secondary3Text = String(bubble.secondary3Text || "...").slice(0, 500) || "...";
    bubble.secondaryBoolean = bubble.secondaryBoolean !== false;
    bubble.secondaryThoughtBoolean = bubble.secondaryThoughtBoolean !== false;
    bubble.secondaryBridgeEnabled = bubble.secondaryBridgeEnabled !== false;
    bubble.secondaryBridgeBaseA = Number.isFinite(Number(bubble.secondaryBridgeBaseA)) ? bubble.secondaryBridgeBaseA : 12;
    bubble.secondaryBridgeBaseB = Number.isFinite(Number(bubble.secondaryBridgeBaseB)) ? bubble.secondaryBridgeBaseB : 12;
    bubble.secondaryBridgeCurve = Number.isFinite(Number(bubble.secondaryBridgeCurve)) ? bubble.secondaryBridgeCurve : -6;
  }
  canvas.updatedAt = new Date().toISOString();
  scheduleCanvasesStateSave();
  renderComicCanvas();
  canvasSetSingleSelection("bubble", bubble.id);
  renderCanvasControls();
}

function editSelectedCanvasSecondaryBubble(index = 1) {
  const canvas = activeCanvasObj();
  const bubble = selectedCanvasBubble();
  if (!canvas || !bubble || !canvasBubbleHasAttachedSecondary(bubble)) return;
  const secondaryIndex = Math.max(1, Math.min(3, Math.round(Number(index) || 1)));
  const key = secondaryIndex === 1 ? "secondaryText" : `secondary${secondaryIndex}Text`;
  const textValue = prompt(`Secondary ${secondaryIndex} bubble text:`, bubble[key] || "...");
  if (textValue === null) return;
  bubble[key] = String(textValue || "...").trim().slice(0, 500) || "...";
  canvas.updatedAt = new Date().toISOString();
  scheduleCanvasesStateSave();
  renderComicCanvas();
  canvasSetSingleSelection("bubble", bubble.id);
  renderCanvasControls();
}
function removeSelectedCanvasSecondaryBubble() {
  const canvas = activeCanvasObj();
  const bubble = selectedCanvasBubble();
  if (!canvas || !bubble || !bubble.secondaryEnabled) return;
  bubble.secondaryEnabled = false;
  bubble.secondaryCount = 0;
  canvas.updatedAt = new Date().toISOString();
  scheduleCanvasesStateSave();
  renderComicCanvas();
  canvasSetSingleSelection("bubble", bubble.id);
  renderCanvasControls();
}

function removeBubbleJoinUiControls() {
  ["bubbleJoinSelected", "bubbleUnjoinSelected", "bubbleMakeMainJoined"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const parent = el.parentElement;
    el.remove();
    if (parent && !parent.children.length) parent.remove();
  });
}

function syncBubbleJoinButtonState() {
  removeBubbleJoinUiControls();
  const canvas = activeCanvasObj();
  if (canvas) cleanupCanvasBubbleJoins(canvas);
  const selectedPair = canvasSelectedSpeechPair();
  const canJoinPair = !!canvas && selectedPair.length === 2;
  const joinedPairFromTwo = canJoinPair ? canvasFindBubbleJoin(canvas, selectedPair[0], selectedPair[1]) : null;
  const joinedPair = joinedPairFromTwo || canvasJoinedPairForSelection(canvas);
  const selectedBubbleInJoin = !!(joinedPair && canvasSelectedBubbleId && joinedPair.bubbleIds?.includes(canvasSelectedBubbleId));
  const joinBtn = $("#bubbleJoinSelected");
  const unjoinBtn = $("#bubbleUnjoinSelected");
  const mainBtn = $("#bubbleMakeMainJoined");
  if (joinBtn) joinBtn.disabled = !canJoinPair || !!joinedPairFromTwo;
  if (unjoinBtn) unjoinBtn.disabled = !joinedPair;
  if (mainBtn) {
    const selectedIds = canvasSelectedSpeechBubbleIds();
    const mainCandidate = selectedBubbleInJoin ? canvasSelectedBubbleId : (joinedPair ? selectedIds.find(id => joinedPair.bubbleIds?.includes(id)) || "" : "");
    const alreadyMain = !!(joinedPair && mainCandidate && joinedPair.mainBubbleId === mainCandidate && joinedPair.hideSecondaryTail);
    mainBtn.disabled = !joinedPair || !mainCandidate || alreadyMain;
    mainBtn.textContent = alreadyMain ? "Main joined: selected" : "Make main joined";
  }
}
function joinSelectedSpeechBubbles() {
  const canvas = activeCanvasObj();
  if (!canvas) return;
  const ids = canvasSelectedSpeechPair();
  if (ids.length < 2) return;
  cleanupCanvasBubbleJoins(canvas);
  canvas.bubbleJoins = Array.isArray(canvas.bubbleJoins) ? canvas.bubbleJoins : [];
  let join = canvasFindBubbleJoin(canvas, ids[0], ids[1]);
  if (!join) {
    join = {
      id: `bubble_join_${ids.slice().sort().join("_")}_${Date.now().toString(36)}`,
      bubbleIds: ids.slice(0, 2),
      mainBubbleId: ids[0],
      hideSecondaryTail: true
    };
    canvas.bubbleJoins.push(join);
  } else {
    join.bubbleIds = ids.slice(0, 2);
    join.mainBubbleId = join.mainBubbleId && join.bubbleIds.includes(join.mainBubbleId) ? join.mainBubbleId : ids[0];
    join.hideSecondaryTail = true;
  }
  canvasActiveBubbleJoinId = join.id;
  canvasApplyJoinedTailState(join, canvas);
  canvasMultiSelection = join.bubbleIds.map(id => canvasSelectionItem("bubble", id));
  canvasSelectedBubbleId = join.mainBubbleId;
  canvasSelectedPanelId = "";
  canvas.updatedAt = new Date().toISOString();
  scheduleCanvasesStateSave();
  renderComicCanvas();
  canvasSetSelection(join.bubbleIds.map(id => canvasSelectionItem("bubble", id)), canvasSelectionItem("bubble", join.mainBubbleId));
  renderCanvasControls();
  syncBubbleJoinButtonState();
}

function unjoinSelectedSpeechBubbles() {
  const canvas = activeCanvasObj();
  if (!canvas) return;
  const join = canvasJoinedPairForSelection(canvas);
  if (!join) return;
  const key = [...(join.bubbleIds || [])].sort().join("::");
  canvas.bubbleJoins = (canvas.bubbleJoins || []).filter(item => [...(item.bubbleIds || [])].sort().join("::") !== key);
  for (const id of join.bubbleIds || []) {
    const b = canvas.bubbles?.find(item => item.id === id);
    if (b) b.tailHidden = false;
  }
  if (canvasActiveBubbleJoinId === join.id) canvasActiveBubbleJoinId = "";
  canvasMultiSelection = (join.bubbleIds || []).map(id => canvasSelectionItem("bubble", id));
  if (!canvasSelectedBubbleId || !(join.bubbleIds || []).includes(canvasSelectedBubbleId)) canvasSelectedBubbleId = join.bubbleIds?.[0] || "";
  canvasSelectedPanelId = "";
  canvas.updatedAt = new Date().toISOString();
  scheduleCanvasesStateSave();
  renderComicCanvas();
  canvasApplySelectionDom();
  syncBubbleJoinButtonState();
}
function makeMainJoinedBubble() {
  const canvas = activeCanvasObj();
  if (!canvas) return;
  const bubble = selectedCanvasBubble();
  const bubbleId = bubble?.id || canvasSelectedBubbleId || canvasSelectedSpeechBubbleIds()[0] || "";
  const join = canvasFindBubbleJoinByBubble(canvas, bubbleId) || canvasJoinedPairForSelection(canvas);
  if (!join || !Array.isArray(join.bubbleIds) || !join.bubbleIds.includes(bubbleId)) return;
  join.mainBubbleId = bubbleId;
  join.hideSecondaryTail = true;
  canvasActiveBubbleJoinId = join.id;
  canvasApplyJoinedTailState(join, canvas);
  canvasSelectedBubbleId = bubbleId;
  canvasSelectedPanelId = "";
  canvasMultiSelection = join.bubbleIds.map(id => canvasSelectionItem("bubble", id));
  canvas.updatedAt = new Date().toISOString();
  scheduleCanvasesStateSave();
  renderComicCanvas();
  canvasSetSelection(join.bubbleIds.map(id => canvasSelectionItem("bubble", id)), canvasSelectionItem("bubble", bubbleId));
  renderCanvasControls();
  syncBubbleJoinButtonState();
}


function canvasBubbleStyleFill(style = "white") {
  if (style === "yellow") return '#fef3c7';
  if (style === "dark") return 'rgba(15, 23, 42, .94)';
  return '#ffffff';
}
function canvasBubbleStyleBorder(style = "white") {
  return style === "dark" ? '#f8fafc' : (style === "yellow" ? '#111827' : '#0f172a');
}
function canvasBubbleCenter(bubble) {
  return { x: Number(bubble.x || 0) + Number(bubble.w || 0) / 2, y: Number(bubble.y || 0) + Number(bubble.h || 0) / 2, rx: Number(bubble.w || 0) / 2, ry: Number(bubble.h || 0) / 2 };
}
function canvasBubbleBoundaryToward(bubble, target) {
  const c = canvasBubbleCenter(bubble);
  const dx = Number(target.x || 0) - c.x;
  const dy = Number(target.y || 0) - c.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const rx = Math.max(0.5, c.rx);
  const ry = Math.max(0.5, c.ry);
  const dist = 1 / Math.sqrt((ux * ux) / (rx * rx) + (uy * uy) / (ry * ry));
  return { x: c.x + ux * dist, y: c.y + uy * dist, ux, uy };
}
function canvasBubbleJoinHtml(join, canvas, index = 0) {
  const bubbleA = canvas?.bubbles?.find(b => b.id === join?.bubbleIds?.[0]);
  const bubbleB = canvas?.bubbles?.find(b => b.id === join?.bubbleIds?.[1]);
  if (!bubbleA || !bubbleB) return '';
  if (String(bubbleA.type || 'speech') !== 'speech' || String(bubbleB.type || 'speech') !== 'speech') return '';
  const centerA = canvasBubbleCenter(bubbleA);
  const centerB = canvasBubbleCenter(bubbleB);
  const pointA = canvasBubbleBoundaryToward(bubbleA, centerB);
  const pointB = canvasBubbleBoundaryToward(bubbleB, centerA);
  const dx = pointB.x - pointA.x;
  const dy = pointB.y - pointA.y;
  const canvasAspectY = 4 / 3; // canvas default is 3:4, so Y percent needs this correction for CSS rotation.
  const dxScaled = dx;
  const dyScaled = dy * canvasAspectY;
  const span = Math.hypot(dxScaled, dyScaled);
  if (span < 0.4) return '';
  const mainBubble = join?.mainBubbleId === bubbleB.id ? bubbleB : bubbleA;
  const style = String(mainBubble.style || bubbleA.style || 'white');
  const fill = canvasBubbleStyleFill(style);
  const border = canvasBubbleStyleBorder(style);
  const stroke = Math.max(0.8, Number(mainBubble.tailOuterStroke || bubbleA.tailOuterStroke || 2));
  const bridge = Math.max(2.2, Math.min(Math.min(centerA.ry, centerB.ry) * 0.72, Math.min(centerA.rx, centerB.rx) * 0.46, 8));
  const outer = Math.round((bridge + stroke * 2.3) * 100) / 100;
  const inner = Math.round(bridge * 100) / 100;
  const angle = Math.atan2(dyScaled, dxScaled) * 180 / Math.PI;
  const z = Math.floor(Math.max(Number(bubbleA.z) || 0, Number(bubbleB.z) || 0)) + 20 + index;
  const left = Math.round(pointA.x * 100) / 100;
  const top = Math.round(pointA.y * 100) / 100;
  const width = Math.round(span * 100) / 100;
  // v2.31.57: use plain absolutely-positioned rounded divs instead of the SVG line overlay.
  // The old SVG bridge could exist in state but remain effectively invisible in some canvas stacks.
  return `<div class="canvas-bubble-join-bridge" data-bubble-join-id="${safeAttr(join.id)}" style="left:${left}%;top:${top}%;width:${width}%;height:${outer}%;z-index:${z};transform:translateY(-50%) rotate(${angle}deg);--bubble-join-fill:${safeAttr(fill)};--bubble-join-border:${safeAttr(border)};--bubble-join-inner:${inner}%;"><div class="canvas-bubble-join-bridge-inner"></div></div>`;
}
function canvasBubbleJoinsHtml(canvas) {
  cleanupCanvasBubbleJoins(canvas);
  return (canvas?.bubbleJoins || []).map((join, i) => canvasBubbleJoinHtml(join, canvas, i)).join('');
}

function renderCanvasControls() {
  const select = $("#canvasSelect");
  const canvases = sortedCanvases();
  const active = state.settings.canvasActiveId || "";
  if (select) {
    const html = `<option value="">No canvas</option>` + canvases.map(c => `<option value="${safeAttr(c.id)}">${safeText(c.name || "Canvas")} (${(c.panels || []).length})</option>`).join("");
    if (select.dataset.canvasOptions !== html) {
      select.innerHTML = html;
      select.dataset.canvasOptions = html;
    }
    select.value = state.canvases?.[active] ? active : "";
  }
  const canvas = activeCanvasObj();
  const status = $("#canvasStatus");
  if (status) {
    const panelCount = (canvas?.panels || []).length;
    const bubbleCount = (canvas?.bubbles || []).length;
    status.textContent = canvas ? `${canvas.name || "Canvas"}: ${panelCount} panel${panelCount === 1 ? "" : "s"} · ${bubbleCount} bubble${bubbleCount === 1 ? "" : "s"}${state.settings.canvasView ? " · editing page" : ""}` : "Create a canvas to arrange comic panels.";
  }
  const viewBtn = $("#toggleCanvasView");
  if (viewBtn) {
    viewBtn.textContent = state.settings.canvasView ? "Exit canvas" : "Open canvas";
    viewBtn.classList.toggle("active", !!state.settings.canvasView);
  }
  updateCanvasButtonStates();
  document.body.classList.toggle("canvas-mode", !!state.settings.canvasView && !!canvas);
  const workspace = $("#canvasWorkspace");
  if (workspace) workspace.hidden = !(state.settings.canvasView && canvas);
  updateCanvasWorkMarksToggle();
}

function updateCanvasWorkMarksToggle() {
  const hidden = !!state.settings.canvasHideWorkMarks;
  const workspace = $("#canvasWorkspace");
  if (workspace) workspace.classList.toggle("canvas-workmarks-hidden", hidden);
  const btn = $("#canvasWorkMarksToggle");
  if (btn) {
    btn.textContent = hidden ? "Show guides" : "Hide guides";
    btn.classList.toggle("active", hidden);
    btn.disabled = !(activeCanvasObj() && state.settings.canvasView);
  }
}

async function toggleCanvasWorkMarks() {
  state.settings.canvasHideWorkMarks = !state.settings.canvasHideWorkMarks;
  updateCanvasWorkMarksToggle();
  await runtimeMessage({ type: "SAVE_SETTINGS", settings: { ...state.settings } });
}
function updateCanvasButtonStates() {
  const canvas = activeCanvasObj();
  const hasCanvas = !!canvas;
  const selected = selectedIds.size > 0;
  const hasStoryboard = !!activeStoryboardObj();
  const hasPanel = !!(canvasSelectedPanelId && canvas?.panels?.some(p => p.id === canvasSelectedPanelId));
  const hasBubble = !!(canvasSelectedBubbleId && canvas?.bubbles?.some(b => b.id === canvasSelectedBubbleId));
  const setDisabled = (id, disabled) => { const el = $("#" + id); if (el) el.disabled = !!disabled; };
  setDisabled("toggleCanvasView", !hasCanvas);
  setDisabled("addSelectedToCanvas", !hasCanvas || !selected);
  setDisabled("addStoryboardToCanvas", !hasCanvas || !hasStoryboard);
  setDisabled("addCanvasBubble", !hasCanvas);
  setDisabled("canvasFitPanel", !hasCanvas || !hasPanel);
  setDisabled("canvasFillPanel", !hasCanvas || !hasPanel);
  setDisabled("canvasBringFront", !hasCanvas || !hasPanel);
  setDisabled("canvasSendBack", !hasCanvas || !hasPanel);
  setDisabled("canvasStrokeMinus", !hasCanvas || !hasPanel);
  setDisabled("canvasStrokePlus", !hasCanvas || !hasPanel);
  setDisabled("canvasStrokeColor", !hasCanvas || !hasPanel);
  setDisabled("canvasDeletePanel", !hasCanvas || !(hasPanel || hasBubble));
  setDisabled("exportCanvas", !hasCanvas);
  syncBubbleJoinButtonState();
  const delBtn = $("#canvasDeletePanel");
  if (delBtn) delBtn.textContent = hasBubble && !hasPanel ? "Remove bubble" : "Remove panel";
  updateCanvasBubbleSideControls();
  updateCanvasPanelSideControls();
}
function updateCanvasBubbleSideControls() {
  const panel = $("#canvasBubbleSideControls");
  if (!panel) return;
  const bubble = selectedCanvasBubble();
  const show = !!(activeCanvasObj() && state.settings.canvasView && bubble);
  panel.hidden = !show;
  if (!show) return;
  const bubbleType = String(bubble.type || "speech");
  const typeButton = $("#bubbleTypeButton");
  if (typeButton) {
    const typeLabel = bubbleType;
    typeButton.textContent = `Tail type: ${typeLabel.charAt(0).toUpperCase()}${typeLabel.slice(1)}`;
    typeButton.classList.toggle("active", typeLabel === "thought");
  }
  const bubbleShapeButton = $("#bubbleShapeButton");
  const bubbleShape = canvasBubbleShapeType(bubble);
  if (bubbleShapeButton) {
    const shapeLabel = bubbleShape;
    bubbleShapeButton.textContent = `Bubble: ${shapeLabel.charAt(0).toUpperCase()}${shapeLabel.slice(1)}`;
    bubbleShapeButton.classList.toggle("active", bubbleShape !== "oval");
  }
  const bubbleBurstControls = $("#bubbleBurstControls");
  const bubbleCloudControls = $("#bubbleCloudControls");
  if (bubbleBurstControls) bubbleBurstControls.hidden = !(bubbleShape === "burst" || bubbleShape === "gear");
  const bubbleBurstSpikeCountControl = $("#bubbleBurstSpikeCountControl");
  if (bubbleBurstSpikeCountControl) bubbleBurstSpikeCountControl.hidden = bubbleShape !== "burst";
  if (bubbleCloudControls) bubbleCloudControls.hidden = bubbleShape !== "cloud";
  const secondaryAddBtn = $("#bubbleAddSecondary");
  const secondaryEditBtn = $("#bubbleEditSecondary");
  const secondaryRemoveBtn = $("#bubbleRemoveSecondary");
  const canSecondary = bubbleType !== "caption";
  const hasSecondary = canvasBubbleHasAttachedSecondary(bubble);
  if (secondaryAddBtn) {
    const secCount = canvasBubbleAttachedCount(bubble);
    secondaryAddBtn.disabled = !canSecondary;
    secondaryAddBtn.textContent = secCount > 0 ? `Secondary: ${secCount}` : "Secondary: OFF";
    secondaryAddBtn.classList.toggle("active", secCount > 0);
  }
  if (secondaryEditBtn) secondaryEditBtn.disabled = !canSecondary || !hasSecondary;
  if (secondaryRemoveBtn) {
    secondaryRemoveBtn.disabled = true;
    secondaryRemoveBtn.hidden = true;
    secondaryRemoveBtn.style.display = "none";
  }
  const secondaryBridgeControls = $("#bubbleSecondaryBridgeControls");
  if (secondaryBridgeControls) secondaryBridgeControls.hidden = !hasSecondary;
  const secondaryBridgeToggle = $("#bubbleSecondaryBridgeToggle");
  if (secondaryBridgeToggle) {
    secondaryBridgeToggle.disabled = !hasSecondary;
    secondaryBridgeToggle.checked = bubble.secondaryBridgeEnabled !== false;
  }
  const secondaryBooleanToggle = $("#bubbleSecondaryBooleanToggle");
  if (secondaryBooleanToggle) {
    secondaryBooleanToggle.disabled = canvasBubbleIsThought(bubble);
    secondaryBooleanToggle.checked = bubble.secondaryBoolean !== false;
  }
  const secondaryThoughtBooleanToggle = $("#bubbleSecondaryThoughtBooleanToggle");
  const secondaryThoughtBooleanRow = secondaryThoughtBooleanToggle?.closest?.("label");
  if (secondaryThoughtBooleanRow) secondaryThoughtBooleanRow.hidden = !canvasBubbleIsThought(bubble);
  if (secondaryThoughtBooleanToggle) {
    secondaryThoughtBooleanToggle.disabled = !canvasBubbleIsThought(bubble);
    secondaryThoughtBooleanToggle.checked = bubble.secondaryThoughtBoolean !== false;
  }
  removeBubbleJoinUiControls();
  const selectedSpeechIds = canvasSelectedSpeechPair();
  const joinBtn = $("#bubbleJoinSelected");
  if (joinBtn) joinBtn.textContent = selectedSpeechIds.length === 2 ? "Join selected speech bubbles" : "Join 2 selected speech bubbles";
  const unjoinBtn = $("#bubbleUnjoinSelected");
  if (unjoinBtn) unjoinBtn.textContent = "Remove shared contour";
  syncBubbleJoinButtonState();
  const isThoughtMode = canvasBubbleIsThought(bubble);
  $$(".speech-tail-hide-in-thought", panel).forEach(el => {
    el.hidden = isThoughtMode;
    el.style.display = isThoughtMode ? "none" : "";
  });
  $$(".bubble-stroke-control", panel).forEach(el => { el.hidden = false; el.style.display = ""; });
  $$(".tail-path-control", panel).forEach(el => { el.hidden = false; el.style.display = ""; });
  // v2.31.77: keep base/anchor controls visible in boolean mode too.
  // They drive the union tail geometry live and are still useful for placing the base along the bubble edge.
  const tailMode = canvasBubbleTailMode(bubble);
  const modeButton = $("#bubbleTailPathModeButton");
  if (modeButton) {
    const label = tailMode === "jagged" ? "Jagged" : (tailMode === "curved" ? "Curved" : "Straight");
    modeButton.textContent = `Tail path: ${label}`;
    modeButton.classList.toggle("active", tailMode !== "straight");
  }
  $$(".tail-jagged-control", panel).forEach(el => { el.hidden = tailMode !== "jagged"; el.style.display = tailMode !== "jagged" ? "none" : ""; });
  $$(".tail-curve-control", panel).forEach(el => { el.hidden = tailMode !== "curved"; el.style.display = tailMode !== "curved" ? "none" : ""; });
  const relativeToggle = $("#bubbleTailRelativeToggle");
  if (relativeToggle) relativeToggle.checked = bubble.tailRelativeFollow !== false;
  const curveModeButton = $("#bubbleTailCurveModeButton");
  if (curveModeButton) {
    const curveMode = canvasBubbleCurveMode(bubble);
    curveModeButton.textContent = `Curve mode: ${curveMode === "quadrant" ? "Quadrant flip" : "Normal"}`;
    curveModeButton.classList.toggle("active", curveMode === "quadrant");
    curveModeButton.hidden = tailMode !== "curved";
    curveModeButton.style.display = tailMode !== "curved" ? "none" : "";
  }
  const baseCustomToggle = $("#bubbleTailBaseCustomToggle");
  if (baseCustomToggle) baseCustomToggle.checked = !!bubble.tailBaseCustom;
  const baseRelativeOn = bubble.tailBaseRelativeFollow !== false;
  const baseRelativeAvailable = !!bubble.tailBaseCustom;
  const baseRelativeToggle = $("#bubbleTailBaseRelativeToggle");
  if (baseRelativeToggle) {
    baseRelativeToggle.checked = baseRelativeOn;
    baseRelativeToggle.disabled = !baseRelativeAvailable;
  }
  const baseRelativeButton = $("#bubbleTailBaseRelativeButton");
  if (baseRelativeButton) {
    baseRelativeButton.textContent = `Base relative position: ${baseRelativeOn ? "ON" : "OFF"}`;
    baseRelativeButton.classList.toggle("active", baseRelativeOn && baseRelativeAvailable);
    baseRelativeButton.disabled = !baseRelativeAvailable;
  }
  const setControl = (sliderId, inputId, value, digits = 1) => {
    const slider = $("#" + sliderId);
    const input = $("#" + inputId);
    const factor = digits > 1 ? 100 : 10;
    const rounded = Math.round(Number(value) * factor) / factor;
    if (slider && document.activeElement !== slider) slider.value = String(rounded);
    if (input && document.activeElement !== input) input.value = Number(rounded).toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
  };
  setControl("bubbleSecondaryBridgeBaseASlider", "bubbleSecondaryBridgeBaseAValue", Number(bubble.secondaryBridgeBaseA || 12), 1);
  setControl("bubbleSecondaryBridgeBaseBSlider", "bubbleSecondaryBridgeBaseBValue", Number(bubble.secondaryBridgeBaseB || 12), 1);
  setControl("bubbleSecondaryBridgeCurveSlider", "bubbleSecondaryBridgeCurveValue", Number.isFinite(Number(bubble.secondaryBridgeCurve)) ? Number(bubble.secondaryBridgeCurve) : -6, 1);
  setControl("bubbleTailBaseSlider", "bubbleTailBaseValue", canvasBubbleTailBaseWidth(bubble), 1);
  setControl("bubbleTailBasePositionSlider", "bubbleTailBasePositionValue", canvasBubbleTailBaseShift(bubble), 1);
  setControl("bubbleTailOuterSlider", "bubbleTailOuterValue", canvasBubbleTailOuterStroke(bubble), 1);
  setControl("bubbleTailOffsetSlider", "bubbleTailOffsetValue", canvasBubbleTailAnchorOffsetUi(bubble), 1);
  setControl("bubbleTailJaggedCountSlider", "bubbleTailJaggedCountValue", canvasBubbleTailJaggedCount(bubble), 0);
  setControl("bubbleTailJaggedLengthOffsetSlider", "bubbleTailJaggedLengthOffsetValue", canvasBubbleTailJaggedLengthOffset(bubble), 1);
  setControl("bubbleTailJaggedWidthOffsetSlider", "bubbleTailJaggedWidthOffsetValue", canvasBubbleTailJaggedWidthOffset(bubble), 1);
  setControl("bubbleTailJaggedSpacingSlider", "bubbleTailJaggedSpacingValue", canvasBubbleTailJaggedSpacing(bubble), 2);
  const activeShape = canvasBubbleShapeType(bubble);
  const burstBox = $("#bubbleBurstControls");
  const cloudBox = $("#bubbleCloudControls");
  if (burstBox) burstBox.hidden = !(activeShape === "burst" || activeShape === "gear");
  const burstSpikeCountControl = $("#bubbleBurstSpikeCountControl");
  if (burstSpikeCountControl) burstSpikeCountControl.hidden = activeShape !== "burst";
  const burstJaggedControl = $("#bubbleBurstJaggedControl");
  if (burstJaggedControl) burstJaggedControl.hidden = activeShape !== "burst";
  const burstJaggedToggle = $("#bubbleBurstJaggedToggle");
  if (burstJaggedToggle) burstJaggedToggle.checked = canvasBubbleBurstJagged(bubble);
  const burstHeightRandomnessControl = $("#bubbleBurstHeightRandomnessControl");
  if (burstHeightRandomnessControl) burstHeightRandomnessControl.hidden = activeShape !== "burst";
  if (cloudBox) cloudBox.hidden = activeShape !== "cloud";
  if (activeShape === "burst" || activeShape === "gear") {
    if (activeShape === "burst") setControl("bubbleBurstSpikeCountSlider", "bubbleBurstSpikeCountValue", canvasBubbleBurstSpikeCount(bubble), 0);
    setControl("bubbleBurstPeakOffsetSlider", "bubbleBurstPeakOffsetValue", canvasBubbleBurstPeakOffset(bubble), 2);
    setControl("bubbleBurstValleyOffsetSlider", "bubbleBurstValleyOffsetValue", canvasBubbleBurstValleyOffset(bubble), 2);
    setControl("bubbleBurstRandomnessSlider", "bubbleBurstRandomnessValue", canvasBubbleBurstRandomness(bubble), 2);
    if (activeShape === "burst") setControl("bubbleBurstHeightRandomnessSlider", "bubbleBurstHeightRandomnessValue", canvasBubbleBurstRandomness2(bubble), 2);
  }
  if (activeShape === "cloud") {
    setControl("bubbleCloudCircleCountSlider", "bubbleCloudCircleCountValue", canvasBubbleCloudCircleCount(bubble), 0);
    setControl("bubbleCloudCircleSizeSlider", "bubbleCloudCircleSizeValue", canvasBubbleCloudCircleSize(bubble), 2);
    setControl("bubbleCloudRandomnessSlider", "bubbleCloudRandomnessValue", canvasBubbleCloudRandomness(bubble), 2);
    setControl("bubbleCloudRandomness2Slider", "bubbleCloudRandomness2Value", canvasBubbleCloudRandomness2(bubble), 2);
  }
  const thoughtBox = $("#bubbleThoughtControls");
  if (thoughtBox) thoughtBox.hidden = !canvasBubbleIsThought(bubble);
  if (canvasBubbleIsThought(bubble)) {
    setControl("bubbleThoughtScaleXSlider", "bubbleThoughtScaleXValue", canvasBubbleThoughtScaleX(bubble), 1);
    setControl("bubbleThoughtScaleYSlider", "bubbleThoughtScaleYValue", canvasBubbleThoughtScaleY(bubble), 1);
    setControl("bubbleThoughtSpacingSlider", "bubbleThoughtSpacingValue", canvasBubbleThoughtSpacing(bubble), 1);
    const thoughtData = canvasBubbleThoughtTailData(bubble);
    const thoughtCount = $("#bubbleThoughtCount");
    if (thoughtCount) thoughtCount.textContent = String(thoughtData.count || 3);
    setControl("bubbleThoughtCountSlider", "bubbleThoughtCountValue", canvasBubbleThoughtCount(bubble), 0);
    setControl("bubbleThoughtBaseSizeSlider", "bubbleThoughtBaseSizeValue", canvasBubbleThoughtBaseSize(bubble), 2);
    setControl("bubbleThoughtBaseOffsetSlider", "bubbleThoughtBaseOffsetValue", canvasBubbleThoughtBaseOffset(bubble), 1);
    const thoughtJoin = $("#bubbleThoughtJoinToggle");
    if (thoughtJoin) thoughtJoin.checked = canvasBubbleThoughtJoinEnabled(bubble);
    setControl("bubbleThoughtJoinWidthSlider", "bubbleThoughtJoinWidthValue", canvasBubbleThoughtJoinWidth(bubble), 2);
    setControl("bubbleThoughtJoinLengthSlider", "bubbleThoughtJoinLengthValue", canvasBubbleThoughtJoinLength(bubble), 2);
    const thoughtHorizontal = $("#bubbleThoughtHorizontalToggle");
    if (thoughtHorizontal) thoughtHorizontal.checked = bubble.thoughtHorizontal !== false;
    setControl("bubbleThoughtFalloffSlider", "bubbleThoughtFalloffValue", canvasBubbleThoughtFalloff(bubble), 2);
    setControl("bubbleThoughtAngleSlider", "bubbleThoughtAngleValue", canvasBubbleThoughtAngle(bubble), 1);
  }
}

function canvasPanelShapeEnabled(panel) {
  return panel?.shapeCustom === true;
}
function canvasPanelShapePoints(panel) {
  const n = (v, fallback) => {
    const x = Number(v);
    return Number.isFinite(x) ? Math.max(-40, Math.min(140, x)) : fallback;
  };
  return {
    tl: { x: n(panel?.shapeTlX, 0), y: n(panel?.shapeTlY, 0) },
    tr: { x: n(panel?.shapeTrX, 100), y: n(panel?.shapeTrY, 0) },
    br: { x: n(panel?.shapeBrX, 100), y: n(panel?.shapeBrY, 100) },
    bl: { x: n(panel?.shapeBlX, 0), y: n(panel?.shapeBlY, 100) }
  };
}
function canvasPanelClipPolygon(panel) {
  const pts = canvasPanelShapePoints(panel);
  return canvasPanelShapeEnabled(panel)
    ? `polygon(${pts.tl.x}% ${pts.tl.y}%, ${pts.tr.x}% ${pts.tr.y}%, ${pts.br.x}% ${pts.br.y}%, ${pts.bl.x}% ${pts.bl.y}%)`
    : "polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)";
}
function canvasPanelSvgPoints(panel) {
  const pts = canvasPanelShapePoints(panel);
  return `${pts.tl.x},${pts.tl.y} ${pts.tr.x},${pts.tr.y} ${pts.br.x},${pts.br.y} ${pts.bl.x},${pts.bl.y}`;
}
function canvasPanelBorderSvgContent(panel, selected = false) {
  const pts = canvasPanelShapePoints(panel);
  const color = safeAttr(/^#[0-9a-f]{6}$/i.test(String(panel?.strokeColor || "")) ? panel.strokeColor : "#000000");
  const sw = Math.max(0, Math.min(12, Number(panel?.strokeWidth) || 0));
  const top = Math.max(0, Math.min(12, Number(panel?.strokeSeparate ? panel.strokeTop : sw) || 0));
  const right = Math.max(0, Math.min(12, Number(panel?.strokeSeparate ? panel.strokeRight : sw) || 0));
  const bottom = Math.max(0, Math.min(12, Number(panel?.strokeSeparate ? panel.strokeBottom : sw) || 0));
  const left = Math.max(0, Math.min(12, Number(panel?.strokeSeparate ? panel.strokeLeft : sw) || 0));
  const line = (a, b, w, cls) => w > 0 ? `<line class="canvas-panel-border-line ${cls}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${color}" style="stroke-width:${w}px"></line>` : "";
  const border = [
    line(pts.tl, pts.tr, top, "top"),
    line(pts.tr, pts.br, right, "right"),
    line(pts.br, pts.bl, bottom, "bottom"),
    line(pts.bl, pts.tl, left, "left")
  ].join("");
  const select = selected ? `<polygon class="canvas-panel-border-selection" points="${safeAttr(canvasPanelSvgPoints(panel))}"></polygon>` : "";
  return `${border}${select}`;
}
function canvasPanelCornerHandlesHtml(panel, selected = false) {
  if (!(selected || canvasPanelHasSelectedCorner(panel?.id)) || !canvasPanelShapeEnabled(panel)) return "";
  const pts = canvasPanelShapePoints(panel);
  const label = { tl: "Top left", tr: "Top right", br: "Bottom right", bl: "Bottom left" };
  return Object.entries(pts).map(([key, p]) => `<div class="canvas-panel-corner-handle ${canvasSelectionHas("corner", panel.id, key) ? "selected" : ""}" data-shape-corner="${key}" title="Drag ${safeAttr(label[key] || key)} corner" style="left:${p.x}%;top:${p.y}%"></div>`).join("");
}
function updateCanvasPanelShapeDom(panel) {
  const el = panel?.id ? $(`#comicCanvas .canvas-panel[data-panel-id="${cssEscapeValue(panel.id)}"]`) : null;
  if (!el || !panel) return;
  el.classList.toggle("shape-custom", canvasPanelShapeEnabled(panel));
  el.style.setProperty("--canvas-panel-clip", canvasPanelClipPolygon(panel));
  const selected = canvasIsPanelSelected(panel.id);
  const svg = el.querySelector(".canvas-panel-border-svg");
  if (svg) svg.innerHTML = canvasPanelBorderSvgContent(panel, selected);
  const shouldShowHandles = selected && canvasPanelShapeEnabled(panel);
  $$(".canvas-panel-corner-handle", el).forEach(handle => handle.remove());
  if (shouldShowHandles) {
    const resize = el.querySelector(".canvas-resize-handle");
    if (resize) resize.insertAdjacentHTML("beforebegin", canvasPanelCornerHandlesHtml(panel, true));
    else el.insertAdjacentHTML("beforeend", canvasPanelCornerHandlesHtml(panel, true));
  }
  $$(".canvas-panel-corner-handle", el).forEach(handle => {
    const key = handle.dataset.shapeCorner;
    const p = canvasPanelShapePoints(panel)[key];
    if (p) { handle.style.left = `${p.x}%`; handle.style.top = `${p.y}%`; }
    handle.classList.toggle("selected", canvasSelectionHas("corner", panel.id, key));
  });
}
function setSelectedCanvasPanelShape(enabled) {
  const canvas = activeCanvasObj();
  const panel = selectedCanvasPanel();
  if (!canvas || !panel) return;
  panel.shapeCustom = !!enabled;
  if (panel.shapeCustom) {
    const pts = canvasPanelShapePoints(panel);
    panel.shapeTlX = pts.tl.x; panel.shapeTlY = pts.tl.y;
    panel.shapeTrX = pts.tr.x; panel.shapeTrY = pts.tr.y;
    panel.shapeBrX = pts.br.x; panel.shapeBrY = pts.br.y;
    panel.shapeBlX = pts.bl.x; panel.shapeBlY = pts.bl.y;
  }
  canvas.updatedAt = new Date().toISOString();
  scheduleCanvasesStateSave();
  renderComicCanvas();
  updateCanvasPanelSideControls();
}
function resetSelectedCanvasPanelShape() {
  const canvas = activeCanvasObj();
  const panel = selectedCanvasPanel();
  if (!canvas || !panel) return;
  panel.shapeCustom = false;
  panel.shapeTlX = 0; panel.shapeTlY = 0;
  panel.shapeTrX = 100; panel.shapeTrY = 0;
  panel.shapeBrX = 100; panel.shapeBrY = 100;
  panel.shapeBlX = 0; panel.shapeBlY = 100;
  canvas.updatedAt = new Date().toISOString();
  scheduleCanvasesStateSave();
  renderComicCanvas();
  updateCanvasPanelSideControls();
}

function updateCanvasPanelSideControls() {
  const panelBox = $("#canvasPanelSideControls");
  if (!panelBox) return;
  const panel = selectedCanvasPanel();
  const show = !!(activeCanvasObj() && state.settings.canvasView && panel);
  panelBox.hidden = !show;
  if (!show) return;
  const slider = $("#canvasPanelStrokeSlider");
  const input = $("#canvasPanelStrokeValue");
  const select = $("#canvasPanelStrokeColor");
  const separateToggle = $("#canvasPanelStrokeSeparateToggle");
  const sidesBox = $("#canvasPanelStrokeSides");
  const width = Math.max(0, Math.min(12, Math.round(Number(panel.strokeWidth) || 0)));
  if (slider && document.activeElement !== slider) slider.value = String(width);
  if (input && document.activeElement !== input) input.value = String(width);
  if (select && document.activeElement !== select) select.value = /^#[0-9a-f]{6}$/i.test(String(panel.strokeColor || "")) ? String(panel.strokeColor) : "#000000";
  if (separateToggle) separateToggle.checked = panel.strokeSeparate === true;
  if (sidesBox) sidesBox.hidden = panel.strokeSeparate !== true;
  const shapeToggle = $("#canvasPanelShapeToggle");
  const shapeControls = $("#canvasPanelShapeControls");
  if (shapeToggle) shapeToggle.checked = canvasPanelShapeEnabled(panel);
  if (shapeControls) shapeControls.hidden = !canvasPanelShapeEnabled(panel);
  const sideValues = {
    Top: Math.max(0, Math.min(12, Math.round(Number(panel.strokeTop ?? width) || 0))),
    Right: Math.max(0, Math.min(12, Math.round(Number(panel.strokeRight ?? width) || 0))),
    Bottom: Math.max(0, Math.min(12, Math.round(Number(panel.strokeBottom ?? width) || 0))),
    Left: Math.max(0, Math.min(12, Math.round(Number(panel.strokeLeft ?? width) || 0)))
  };
  Object.entries(sideValues).forEach(([side, value]) => {
    const sideSlider = $(`#canvasPanelStroke${side}Slider`);
    const sideInput = $(`#canvasPanelStroke${side}Value`);
    if (sideSlider && document.activeElement !== sideSlider) sideSlider.value = String(value);
    if (sideInput && document.activeElement !== sideInput) sideInput.value = String(value);
  });
}

function setSelectedCanvasPanelStrokeControl(width = null, color = null) {
  const panel = selectedCanvasPanel();
  if (!panel) return;
  if (width !== null && width !== undefined) {
    const v = Math.max(0, Math.min(12, Math.round(Number(width) || 0)));
    panel.strokeWidth = v;
    if (panel.strokeSeparate !== true) {
      panel.strokeTop = v;
      panel.strokeRight = v;
      panel.strokeBottom = v;
      panel.strokeLeft = v;
    }
  }
  if (color && /^#[0-9a-f]{6}$/i.test(String(color))) panel.strokeColor = String(color);
  activeCanvasObj().updatedAt = new Date().toISOString();
  scheduleCanvasesStateSave();
  renderComicCanvas();
  updateCanvasPanelSideControls();
}

function setSelectedCanvasPanelStrokeSeparate(enabled) {
  const panel = selectedCanvasPanel();
  if (!panel) return;
  const width = Math.max(0, Math.min(12, Math.round(Number(panel.strokeWidth) || 0)));
  panel.strokeSeparate = !!enabled;
  panel.strokeTop = Math.max(0, Math.min(12, Math.round(Number(panel.strokeTop ?? width) || 0)));
  panel.strokeRight = Math.max(0, Math.min(12, Math.round(Number(panel.strokeRight ?? width) || 0)));
  panel.strokeBottom = Math.max(0, Math.min(12, Math.round(Number(panel.strokeBottom ?? width) || 0)));
  panel.strokeLeft = Math.max(0, Math.min(12, Math.round(Number(panel.strokeLeft ?? width) || 0)));
  activeCanvasObj().updatedAt = new Date().toISOString();
  scheduleCanvasesStateSave();
  renderComicCanvas();
  updateCanvasPanelSideControls();
}

function setSelectedCanvasPanelStrokeSide(side, value) {
  const panel = selectedCanvasPanel();
  if (!panel) return;
  const keyMap = { top: "strokeTop", right: "strokeRight", bottom: "strokeBottom", left: "strokeLeft" };
  const key = keyMap[String(side || "").toLowerCase()];
  if (!key) return;
  panel.strokeSeparate = true;
  panel[key] = Math.max(0, Math.min(12, Math.round(Number(value) || 0)));
  activeCanvasObj().updatedAt = new Date().toISOString();
  scheduleCanvasesStateSave();
  renderComicCanvas();
  updateCanvasPanelSideControls();
}

function resetSelectedCanvasPanelStroke() {
  const panel = selectedCanvasPanel();
  if (!panel) return;
  panel.strokeWidth = 0;
  panel.strokeTop = 0;
  panel.strokeRight = 0;
  panel.strokeBottom = 0;
  panel.strokeLeft = 0;
  panel.strokeSeparate = false;
  panel.strokeColor = "#000000";
  activeCanvasObj().updatedAt = new Date().toISOString();
  scheduleCanvasesStateSave();
  renderComicCanvas();
  updateCanvasPanelSideControls();
}

function setSelectedCanvasBubbleTailControl(key, value) {
  const canvas = activeCanvasObj();
  const bubble = selectedCanvasBubble();
  if (!canvas || !bubble) return;
  const ranges = {
    tailBaseWidth: [4, 28],
    tailBaseShift: [-30, 30],
    tailOuterStroke: [0.1, 5],
    tailAnchorOffset: [-12, 12],
    tailJaggedCount: [2, 4],
    tailJaggedLengthOffset: [-24, 24],
    tailJaggedWidthOffset: [0, 30],
    tailJaggedSpacing: [0.5, 1.8],
    thoughtScaleX: [0.5, 1.8],
    thoughtScaleY: [0.5, 1.8],
    thoughtSpacing: [0.6, 2.2],
    thoughtFalloff: [0.4, 2.5],
    thoughtBaseSize: [0.45, 2.2],
    thoughtBaseOffset: [-24, 24],
    thoughtJoinWidth: [0.2, 2.5],
    thoughtJoinLength: [0, 1.5],
    thoughtCount: [3, 8],
    thoughtAngle: [-90, 90],
    secondaryBridgeBaseA: [3, 42],
    secondaryBridgeBaseB: [3, 42],
    secondaryBridgeCurve: [-9, 42],
    burstSpikeCount: [5, 24],
    burstPeakOffset: [-0.25, 0.25],
    burstValleyOffset: [-0.25, 0.25],
    burstRandomness: [0, 1],
    burstRandomness2: [0, 1],
    cloudCircleCount: [6, 22],
    cloudCircleSize: [0.5, 1.8],
    cloudRandomness: [0, 1],
    cloudRandomness2: [0, 1]
  };
  const [min, max] = ranges[key] || [0, 100];
  const raw = canvasBubbleNumber(value, bubble[key] || 0, min, max);
  const n = key === "thoughtCount" || key === "cloudCircleCount" || key === "burstSpikeCount" || key === "tailJaggedCount"
    ? Math.round(raw)
    : (key === "burstPeakOffset" || key === "burstValleyOffset" || key === "burstRandomness" || key === "burstRandomness2" || key === "cloudCircleSize" || key === "cloudRandomness" || key === "cloudRandomness2" || key === "tailJaggedSpacing")
      ? Math.round(raw * 100) / 100
      : Math.round(raw * 10) / 10;
  bubble[key] = n;
  if (key === "cloudCircleCount") {
    bubble.cloudCircleSize = Math.round(canvasBubbleCloudAutoSizeForCount(n) * 100) / 100;
  }
  canvas.updatedAt = new Date().toISOString();
  updateCanvasBubbleTailDom(bubble);
  updateCanvasBubbleSideControls();
  scheduleCanvasesStateSave();
}
function setSelectedCanvasBubbleSecondaryBoolean(enabled) {
  const canvas = activeCanvasObj();
  const bubble = selectedCanvasBubble();
  if (!canvas || !bubble || !canvasBubbleHasAttachedSecondary(bubble)) return;
  if (canvasBubbleIsThought(bubble)) bubble.secondaryThoughtBoolean = !!enabled;
  else bubble.secondaryBoolean = !!enabled;
  canvas.updatedAt = new Date().toISOString();
  renderComicCanvas();
  canvasSetSingleSelection("bubble", bubble.id);
  updateCanvasBubbleSideControls();
  scheduleCanvasesStateSave();
}
function setSelectedCanvasBubbleSecondaryBridge(enabled) {
  const canvas = activeCanvasObj();
  const bubble = selectedCanvasBubble();
  if (!canvas || !bubble || !canvasBubbleHasAttachedSecondary(bubble)) return;
  bubble.secondaryBridgeEnabled = !!enabled;
  canvas.updatedAt = new Date().toISOString();
  updateCanvasBubbleSecondaryCompoundDom(bubble);
  updateCanvasBubbleSideControls();
  scheduleCanvasesStateSave();
}
function setSelectedCanvasBubbleSecondaryThoughtBoolean(enabled) {
  const canvas = activeCanvasObj();
  const bubble = selectedCanvasBubble();
  if (!canvas || !bubble || !canvasBubbleIsThought(bubble)) return;
  bubble.secondaryThoughtBoolean = !!enabled;
  canvas.updatedAt = new Date().toISOString();
  renderComicCanvas();
  canvasSetSingleSelection("bubble", bubble.id);
  updateCanvasBubbleSideControls();
  scheduleCanvasesStateSave();
}

function setSelectedCanvasBubbleTailMode(mode) {
  const canvas = activeCanvasObj();
  const bubble = selectedCanvasBubble();
  if (!canvas || !bubble) return;
  const next = mode === "jagged" ? "jagged" : (mode === "curved" ? "curved" : "straight");
  bubble.tailCurved = next === "curved";
  bubble.tailJagged = next === "jagged";
  bubble.tailBroken = false;
  if (bubble.tailCurved && !bubble.tailCurveManual) {
    const cp = canvasBubbleTailDefaultCurvePoint(bubble);
    const pct = canvasBubbleTailCurvePercentFromPoint(bubble, cp);
    bubble.tailCurveX = pct.x;
    bubble.tailCurveY = pct.y;
  }
  canvas.updatedAt = new Date().toISOString();
  updateCanvasBubbleTailDom(bubble);
  updateCanvasBubbleSideControls();
  scheduleCanvasesStateSave();
}
function cycleSelectedCanvasBubbleTailPathMode() {
  const bubble = selectedCanvasBubble();
  if (!bubble) return;
  const order = ["straight", "curved", "jagged"];
  const current = canvasBubbleTailMode(bubble);
  const idx = order.indexOf(current);
  setSelectedCanvasBubbleTailMode(order[(idx + 1 + order.length) % order.length]);
}
function setSelectedCanvasBubbleCurved(enabled) { setSelectedCanvasBubbleTailMode(enabled ? "curved" : "straight"); }
function setSelectedCanvasBubbleBroken(enabled) { setSelectedCanvasBubbleTailMode(enabled ? "jagged" : "straight"); }

function setSelectedCanvasBubbleThoughtHorizontal(enabled) {
  const canvas = activeCanvasObj();
  const bubble = selectedCanvasBubble();
  if (!canvas || !bubble) return;
  bubble.thoughtHorizontal = !!enabled;
  canvas.updatedAt = new Date().toISOString();
  updateCanvasBubbleTailDom(bubble);
  updateCanvasBubbleSideControls();
  scheduleCanvasesStateSave();
}
function setSelectedCanvasBubbleThoughtJoin(enabled) {
  const canvas = activeCanvasObj();
  const bubble = selectedCanvasBubble();
  if (!canvas || !bubble) return;
  bubble.thoughtJoin = !!enabled;
  canvas.updatedAt = new Date().toISOString();
  updateCanvasBubbleTailDom(bubble);
  updateCanvasBubbleSideControls();
  scheduleCanvasesStateSave();
}
function setSelectedCanvasBubbleRelativeFollow(enabled) {
  const canvas = activeCanvasObj();
  const bubble = selectedCanvasBubble();
  if (!canvas || !bubble) return;
  const currentCurvePoint = canvasBubbleTailCurvePoint(bubble);
  bubble.tailRelativeFollow = !!enabled;
  if (bubble.tailCurved) {
    bubble.tailCurveManual = true;
    canvasBubbleSetManualCurveFromPoint(bubble, currentCurvePoint, bubble.tailRelativeFollow !== false);
  }
  canvas.updatedAt = new Date().toISOString();
  updateCanvasBubbleTailDom(bubble);
  updateCanvasBubbleSideControls();
  scheduleCanvasesStateSave();
}

function setSelectedCanvasBubbleCurveMode(mode) {
  const canvas = activeCanvasObj();
  const bubble = selectedCanvasBubble();
  if (!canvas || !bubble) return;
  const currentPoint = canvasBubbleTailCurvePoint(bubble);
  bubble.tailCurveMode = mode === "quadrant" ? "quadrant" : "normal";
  if (bubble.tailCurved) {
    bubble.tailCurveManual = true;
    canvasBubbleSetManualCurveFromPoint(bubble, currentPoint, bubble.tailRelativeFollow !== false);
  }
  canvas.updatedAt = new Date().toISOString();
  updateCanvasBubbleTailDom(bubble);
  updateCanvasBubbleSideControls();
  scheduleCanvasesStateSave();
}
function toggleSelectedCanvasBubbleCurveMode() {
  const bubble = selectedCanvasBubble();
  setSelectedCanvasBubbleCurveMode(canvasBubbleCurveMode(bubble) === "quadrant" ? "normal" : "quadrant");
}

function setSelectedCanvasBubbleBaseRelativeFollow(enabled) {
  const canvas = activeCanvasObj();
  const bubble = selectedCanvasBubble();
  if (!canvas || !bubble || !bubble.tailBaseCustom) {
    updateCanvasBubbleSideControls();
    return;
  }
  const currentBaseGeom = canvasBubbleTailGeometry(bubble);
  const currentBasePoint = currentBaseGeom.baseContour || currentBaseGeom.baseCenter;
  bubble.tailBaseRelativeFollow = !!enabled;
  if (bubble.tailBaseCustom) {
    canvasBubbleSetBaseFromPoint(bubble, currentBasePoint, bubble.tailBaseRelativeFollow !== false);
  }
  canvas.updatedAt = new Date().toISOString();
  updateCanvasBubbleTailDom(bubble);
  updateCanvasBubbleSideControls();
  scheduleCanvasesStateSave();
}
function toggleSelectedCanvasBubbleBaseRelativeFollow() {
  const bubble = selectedCanvasBubble();
  if (!bubble?.tailBaseCustom) {
    updateCanvasBubbleSideControls();
    return;
  }
  setSelectedCanvasBubbleBaseRelativeFollow(!(bubble?.tailBaseRelativeFollow !== false));
}
function setSelectedCanvasBubbleBaseCustom(enabled) {
  const canvas = activeCanvasObj();
  const bubble = selectedCanvasBubble();
  if (!canvas || !bubble) return;
  if (enabled) {
    const geom = canvasBubbleTailGeometry({ ...bubble, tailBaseCustom: false, tailBaseOffsetReady: false, tailBaseShift: 0 });
    const basePoint = geom.baseContour || geom.baseCenter;
    if (bubble.tailBaseRelativeFollow === false) bubble.tailBaseRelativeFollow = true;
    canvasBubbleSetBaseFromPoint(bubble, basePoint, bubble.tailBaseRelativeFollow !== false);
  } else {
    bubble.tailBaseCustom = false;
    bubble.tailBaseOffsetReady = false;
  }
  canvas.updatedAt = new Date().toISOString();
  renderComicCanvas();
  updateCanvasBubbleSideControls();
  scheduleCanvasesStateSave();
}
function resetSelectedCanvasBubbleTailControls() {
  const canvas = activeCanvasObj();
  const bubble = selectedCanvasBubble();
  if (!canvas || !bubble) return;
  bubble.tailBaseWidth = 13;
  bubble.tailBaseShift = 0;
  bubble.tailBaseCustom = false;
  bubble.tailBaseX = 0;
  bubble.tailBaseY = 0;
  bubble.tailBaseOffsetReady = false;
  bubble.tailBaseAngleOffset = 0;
  bubble.tailBaseRelativeFollow = true;
  bubble.tailOuterStroke = 2;
  bubble.tailInnerStroke = 0;
  bubble.tailAnchorOffset = 0;
  bubble.tailAnchorOffsetRelativeV3 = true;
  bubble.tailCurved = false;
  bubble.tailJagged = false;
  bubble.tailBroken = false;
  bubble.tailJaggedCount = 4;
  bubble.tailJaggedLengthOffset = 0;
  bubble.tailJaggedWidthOffset = 11;
  bubble.tailJaggedSpacing = 1;
  bubble.tailRelativeFollow = true;
  bubble.tailCurveMode = "normal";
  bubble.tailCurveManual = false;
  bubble.tailCurveOffsetReady = false;
  bubble.tailCurveOffsetX = 0;
  bubble.tailCurveOffsetY = 0;
  bubble.burstSpikeCount = 8;
  bubble.burstPeakOffset = 0;
  bubble.burstValleyOffset = 0;
  bubble.burstRandomness = 0;
  bubble.burstRandomness2 = 0;
  bubble.cloudCircleCount = 12;
  bubble.cloudCircleSize = Math.round(canvasBubbleCloudAutoSizeForCount(12) * 100) / 100;
  bubble.cloudRandomness = 0;
  bubble.cloudRandomness2 = 0;
  bubble.burstRandomSeed = 0;
  bubble.cloudRandomSeed = 0;
  bubble.secondaryBridgeCurve = -6;
  for (let i = 1; i <= 3; i++) {
    bubble[`secondaryBridgeBend${i}Custom`] = false;
    bubble[`secondaryBridgeBend${i}X`] = 50;
    bubble[`secondaryBridgeBend${i}Y`] = 50;
    bubble[`secondaryBridgeBend${i}OffsetX`] = 0;
    bubble[`secondaryBridgeBend${i}OffsetY`] = 0;
  }
  bubble.thoughtSpacing = 1;
  bubble.thoughtScaleX = 1;
  bubble.thoughtScaleY = 1;
  bubble.thoughtHorizontal = true;
  bubble.thoughtFalloff = 1.15;
  bubble.thoughtBaseSize = 1;
  bubble.thoughtBaseOffset = 0;
  bubble.thoughtBaseOffsetRelativeV2 = true;
  bubble.thoughtJoin = false;
  bubble.thoughtJoinWidth = 1;
  bubble.thoughtJoinLength = 1;
  bubble.thoughtCount = 5;
  bubble.thoughtAngle = 0;
  canvas.updatedAt = new Date().toISOString();
  updateCanvasBubbleTailDom(bubble);
  updateCanvasBubbleSideControls();
  scheduleCanvasesStateSave();
}
async function createCanvasPrompt() {
  const name = (prompt("Canvas page name:") || "").trim();
  if (!name) return;
  state.canvases = normalizeCanvasesState(state.canvases || {});
  const id = `canvas_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();
  state.canvases[id] = { id, name: name.slice(0, 80), page: { kind: "portrait", ratio: "3:4" }, panels: [], bubbles: [], createdAt: now, updatedAt: now };
  state.settings.canvasActiveId = id;
  state.settings.canvasView = true;
  canvasSelectedPanelId = "";
  canvasSelectedBubbleId = "";
  await Promise.all([saveCanvasesState(), runtimeMessage({ type: "SAVE_SETTINGS", settings: { ...state.settings } })]);
  render();
}
async function setActiveCanvas(id) {
  state.settings.canvasActiveId = state.canvases?.[id] ? id : "";
  if (!state.settings.canvasActiveId) state.settings.canvasView = false;
  canvasSelectedPanelId = "";
  canvasSelectedBubbleId = "";
  await runtimeMessage({ type: "SAVE_SETTINGS", settings: { ...state.settings } });
  render();
}
async function toggleCanvasView() {
  if (!activeCanvasObj()) return;
  state.settings.canvasView = !state.settings.canvasView;
  await runtimeMessage({ type: "SAVE_SETTINGS", settings: { ...state.settings } });
  render();
}
function defaultCanvasRect(index, count = 1) {
  if (count <= 1) return { x: 8, y: 8, w: 84, h: 84 };
  const cols = count <= 2 ? 1 : count <= 4 ? 2 : 3;
  const rows = Math.ceil(count / cols);
  const gap = 3;
  const w = (92 - gap * (cols - 1)) / cols;
  const h = (88 - gap * (rows - 1)) / rows;
  const col = index % cols;
  const row = Math.floor(index / cols);
  return { x: 4 + col * (w + gap), y: 5 + row * (h + gap), w, h };
}
async function addIdsToActiveCanvas(ids = []) {
  const canvas = activeCanvasObj();
  if (!canvas) return;
  const existing = new Set((canvas.panels || []).map(p => p.itemId));
  const unique = Array.from(new Set(ids)).filter(id => assetById(id) && !existing.has(id));
  if (!unique.length) return;
  canvas.panels = Array.isArray(canvas.panels) ? canvas.panels : [];
  const start = canvas.panels.length;
  unique.forEach((itemId, i) => {
    const rect = defaultCanvasRect(start + i, start + unique.length);
    canvas.panels.push(normalizeCanvasPanel({ itemId, ...rect, z: start + i + 1, fit: "fill" }, start + i));
  });
  canvas.updatedAt = new Date().toISOString();
  canvasSelectedPanelId = canvas.panels[canvas.panels.length - 1]?.id || "";
  scheduleCanvasesStateSave();
  state.settings.canvasView = true;
  await runtimeMessage({ type: "SAVE_SETTINGS", settings: { ...state.settings } });
  render();
}
async function addSelectedToCanvas() { await addIdsToActiveCanvas(Array.from(selectedIds)); }
async function addStoryboardToCanvas() { await addIdsToActiveCanvas(storyboardAssetIds(activeStoryboardObj())); }
function canvasSelectionKey(item) {
  if (!item || !item.kind) return "";
  if (item.kind === "corner") return `corner:${item.panelId || item.id || ""}:${String(item.corner || "").toLowerCase()}`;
  return `${item.kind}:${item.id || item.panelId || item.bubbleId || ""}`;
}
function canvasSelectionItem(kind, id, corner = "") {
  if (kind === "corner") return { kind: "corner", panelId: String(id || ""), corner: String(corner || "").toLowerCase() };
  return { kind, id: String(id || "") };
}
function canvasNormalizeSelection(items = []) {
  const canvas = activeCanvasObj();
  const panels = new Set((canvas?.panels || []).map(p => p.id));
  const bubbles = new Set((canvas?.bubbles || []).map(b => b.id));
  const allowedCorners = new Set(["tl", "tr", "br", "bl"]);
  const map = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || !item.kind) continue;
    if (item.kind === "panel") {
      const id = String(item.id || item.panelId || "");
      if (panels.has(id)) map.set(`panel:${id}`, { kind: "panel", id });
    } else if (item.kind === "bubble") {
      const id = String(item.id || item.bubbleId || "");
      if (bubbles.has(id)) map.set(`bubble:${id}`, { kind: "bubble", id });
    } else if (item.kind === "corner") {
      const panelId = String(item.panelId || item.id || "");
      const corner = String(item.corner || "").toLowerCase();
      if (panels.has(panelId) && allowedCorners.has(corner)) map.set(`corner:${panelId}:${corner}`, { kind: "corner", panelId, corner });
    }
  }
  return Array.from(map.values());
}
function canvasSelectionHas(kind, id, corner = "") {
  const key = canvasSelectionKey(canvasSelectionItem(kind, id, corner));
  return canvasMultiSelection.some(item => canvasSelectionKey(item) === key);
}
function canvasPanelHasSelectedCorner(panelId) {
  return canvasMultiSelection.some(item => item.kind === "corner" && item.panelId === panelId);
}
function canvasIsPanelSelected(id) { return canvasSelectedPanelId === id || canvasSelectionHas("panel", id) || canvasPanelHasSelectedCorner(id); }
function canvasIsBubbleSelected(id) { return canvasSelectedBubbleId === id || canvasSelectionHas("bubble", id); }
function canvasSetSelection(items, primary = null) {
  canvasMultiSelection = canvasNormalizeSelection(items);
  if (primary?.kind === "panel") { canvasSelectedPanelId = primary.id || primary.panelId || ""; canvasSelectedBubbleId = ""; }
  else if (primary?.kind === "bubble") { canvasSelectedBubbleId = primary.id || primary.bubbleId || ""; canvasSelectedPanelId = ""; }
  else if (primary?.kind === "corner") { canvasSelectedPanelId = primary.panelId || primary.id || ""; canvasSelectedBubbleId = ""; }
  else {
    const first = canvasMultiSelection[0];
    if (first?.kind === "panel") { canvasSelectedPanelId = first.id; canvasSelectedBubbleId = ""; }
    else if (first?.kind === "bubble") { canvasSelectedBubbleId = first.id; canvasSelectedPanelId = ""; }
    else if (first?.kind === "corner") { canvasSelectedPanelId = first.panelId; canvasSelectedBubbleId = ""; }
    else { canvasSelectedPanelId = ""; canvasSelectedBubbleId = ""; }
  }
  canvasApplySelectionDom();
  updateCanvasButtonStates();
}
function canvasSetSingleSelection(kind, id, corner = "") {
  const item = canvasSelectionItem(kind, id, corner);
  canvasSetSelection([item], item);
}
function canvasToggleSelection(kind, id, corner = "") {
  const item = canvasSelectionItem(kind, id, corner);
  const key = canvasSelectionKey(item);
  const next = canvasMultiSelection.filter(existing => canvasSelectionKey(existing) !== key);
  if (next.length === canvasMultiSelection.length) next.push(item);
  canvasSetSelection(next, next[next.length - 1] || null);
}
function canvasSelectionObjectsForMove() {
  return canvasNormalizeSelection(canvasMultiSelection).filter(item => item.kind === "panel" || item.kind === "bubble");
}
function canvasSelectionCornersForMove() {
  return canvasNormalizeSelection(canvasMultiSelection).filter(item => item.kind === "corner");
}
function canvasApplySelectionDom() {
  const root = $("#comicCanvas");
  if (!root) return;
  canvasMultiSelection = canvasNormalizeSelection(canvasMultiSelection);
  $$(".canvas-panel, .canvas-bubble", root).forEach(el => {
    const panelId = el.dataset.panelId || "";
    const bubbleId = el.dataset.bubbleId || "";
    const isPanel = !!panelId;
    const selected = isPanel ? canvasIsPanelSelected(panelId) : canvasIsBubbleSelected(bubbleId);
    el.classList.toggle("selected", selected);
    el.classList.toggle("multi-selected", isPanel ? canvasSelectionHas("panel", panelId) : canvasSelectionHas("bubble", bubbleId));
  });
  $$(".canvas-panel", root).forEach(el => {
    const panel = activeCanvasObj()?.panels?.find(p => p.id === el.dataset.panelId);
    if (panel) updateCanvasPanelShapeDom(panel);
  });
  $$(".canvas-panel-corner-handle", root).forEach(el => {
    const panelId = el.closest?.(".canvas-panel[data-panel-id]")?.dataset?.panelId || "";
    const corner = String(el.dataset.shapeCorner || "").toLowerCase();
    el.classList.toggle("selected", canvasSelectionHas("corner", panelId, corner));
  });
  updateCanvasBubbleSideControls();
  updateCanvasPanelSideControls();
}
function selectedCanvasPanel() {
  const canvas = activeCanvasObj();
  return canvas?.panels?.find(p => p.id === canvasSelectedPanelId) || null;
}
function selectedCanvasBubble() {
  const canvas = activeCanvasObj();
  return canvas?.bubbles?.find(b => b.id === canvasSelectedBubbleId) || null;
}
function selectCanvasPanel(id) {
  canvasSetSingleSelection("panel", id || "");
  renderComicCanvas();
  updateCanvasButtonStates();
}
function selectCanvasBubble(id) {
  canvasSetSingleSelection("bubble", id || "");
  renderComicCanvas();
  updateCanvasButtonStates();
}
async function createCanvasBubblePrompt() {
  const canvas = activeCanvasObj();
  if (!canvas) return;
  const textValue = (prompt("Bubble text:", "...") || "").trim();
  if (!textValue) return;
  canvas.bubbles = Array.isArray(canvas.bubbles) ? canvas.bubbles : [];
  const zs = [...(canvas.panels || []).map(p => Number(p.z) || 0), ...(canvas.bubbles || []).map(b => Number(b.z) || 0)];
  const bubble = normalizeCanvasBubble({ text: textValue, x: 16, y: 12, w: 24, h: 14, z: Math.max(500, ...zs, 0) + 1, type: "speech", fontSize: 16 }, canvas.bubbles.length);
  canvas.bubbles.push(bubble);
  canvas.updatedAt = new Date().toISOString();
  canvasSelectedBubbleId = bubble.id;
  canvasSelectedPanelId = "";
  scheduleCanvasesStateSave();
  state.settings.canvasView = true;
  await runtimeMessage({ type: "SAVE_SETTINGS", settings: { ...state.settings } });
  render();
}
function editSelectedCanvasBubbleText() {
  const bubble = selectedCanvasBubble();
  if (!bubble) return;
  const textValue = (prompt("Edit bubble text:", bubble.text || "") || "").trim();
  if (!textValue) return;
  bubble.text = textValue.slice(0, 500);
  activeCanvasObj().updatedAt = new Date().toISOString();
  scheduleCanvasesStateSave();
  renderComicCanvas();
}
function cycleSelectedCanvasBubbleType() {
  const bubble = selectedCanvasBubble();
  if (!bubble) return;
  // v2.31.39: keep the side editor recoverable.
  // Caption is still accepted when loading old canvases, but the Type button only
  // cycles editable speech/thought bubbles so a third click cannot hide controls.
  const order = ["speech", "thought"];
  const idx = order.indexOf(String(bubble.type || "speech"));
  bubble.type = order[(idx + 1 + order.length) % order.length];
  activeCanvasObj().updatedAt = new Date().toISOString();
  scheduleCanvasesStateSave();
  renderComicCanvas();
  updateCanvasBubbleSideControls();
}
function cycleSelectedCanvasBubbleShape() {
  const bubble = selectedCanvasBubble();
  if (!bubble) return;
  const order = ["oval", "cloud", "burst", "gear"];
  const idx = order.indexOf(canvasBubbleShapeType(bubble));
  bubble.bubbleShape = order[(idx + 1 + order.length) % order.length];
  activeCanvasObj().updatedAt = new Date().toISOString();
  scheduleCanvasesStateSave();
  renderComicCanvas();
  updateCanvasBubbleSideControls();
}
function setSelectedCanvasBubbleBurstJagged(enabled) {
  const canvas = activeCanvasObj();
  const bubble = selectedCanvasBubble();
  if (!canvas || !bubble) return;
  bubble.burstJagged = !!enabled;
  canvas.updatedAt = new Date().toISOString();
  updateCanvasBubbleTailDom(bubble);
  updateCanvasBubbleSideControls();
  scheduleCanvasesStateSave();
}
function randomizeSelectedCanvasBubbleBurst() {
  const canvas = activeCanvasObj();
  const bubble = selectedCanvasBubble();
  if (!canvas || !bubble) return;
  bubble.burstRandomSeed = (canvasBubbleBurstRandomSeed(bubble) + 1 + Math.floor(Math.random() * 97)) % 1000000;
  canvas.updatedAt = new Date().toISOString();
  scheduleCanvasesStateSave();
  renderComicCanvas();
  updateCanvasBubbleSideControls();
}
function randomizeSelectedCanvasBubbleCloud() {
  const canvas = activeCanvasObj();
  const bubble = selectedCanvasBubble();
  if (!canvas || !bubble) return;
  bubble.cloudRandomSeed = (canvasBubbleCloudRandomSeed(bubble) + 1 + Math.floor(Math.random() * 97)) % 1000000;
  canvas.updatedAt = new Date().toISOString();
  scheduleCanvasesStateSave();
  renderComicCanvas();
  updateCanvasBubbleSideControls();
}
function adjustSelectedCanvasBubbleFont(delta = 0) {
  const bubble = selectedCanvasBubble();
  if (!bubble) return;
  bubble.fontSize = Math.max(10, Math.min(42, Math.round((Number(bubble.fontSize) || 16) + delta)));
  activeCanvasObj().updatedAt = new Date().toISOString();
  scheduleCanvasesStateSave();
  renderComicCanvas();
}
function duplicateSelectedCanvasBubble() {
  const canvas = activeCanvasObj();
  const bubble = selectedCanvasBubble();
  if (!canvas || !bubble) return;
  canvas.bubbles = Array.isArray(canvas.bubbles) ? canvas.bubbles : [];
  const zs = [...(canvas.panels || []).map(p => Number(p.z) || 0), ...(canvas.bubbles || []).map(b => Number(b.z) || 0)];
  const copy = normalizeCanvasBubble({
    ...bubble,
    id: `bubble_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    x: Math.min(92, Number(bubble.x || 0) + 3),
    y: Math.min(94, Number(bubble.y || 0) + 3),
    z: Math.max(500, ...zs, 0) + 1
  }, canvas.bubbles.length);
  canvas.bubbles.push(copy);
  canvasSelectedBubbleId = copy.id;
  canvasSelectedPanelId = "";
  canvas.updatedAt = new Date().toISOString();
  scheduleCanvasesStateSave();
  renderComicCanvas();
  updateCanvasButtonStates();
}
function resetSelectedCanvasBubbleTail() {
  const bubble = selectedCanvasBubble();
  if (!bubble) return;
  bubble.tailX = 18;
  bubble.tailY = 112;
  bubble.tailCurveManual = false;
  activeCanvasObj().updatedAt = new Date().toISOString();
  scheduleCanvasesStateSave();
  renderComicCanvas();
  updateCanvasBubbleSideControls();
}
function cycleSelectedCanvasBubbleStyle() {
  const bubble = selectedCanvasBubble();
  if (!bubble) return;
  const order = ["white", "yellow", "dark"];
  const idx = order.indexOf(String(bubble.style || "white"));
  bubble.style = order[(idx + 1 + order.length) % order.length];
  activeCanvasObj().updatedAt = new Date().toISOString();
  scheduleCanvasesStateSave();
  renderComicCanvas();
  updateCanvasBubbleSideControls();
}
function canvasBubbleNumber(value, fallback, min = -80, max = 180) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function canvasBubbleTailMode(bubble) {
  if (bubble?.tailJagged === true || bubble?.tailBroken === true) return "jagged";
  if (bubble?.tailCurved === true) return "curved";
  return "straight";
}
function canvasBubbleTailJagged(bubble) { return canvasBubbleTailMode(bubble) === "jagged"; }
function canvasBubbleTailJaggedCount(bubble) { return Math.max(2, Math.min(4, Math.round(canvasBubbleTailSetting(bubble, "tailJaggedCount", 4, 2, 4)))); }
function canvasBubbleTailJaggedLengthOffset(bubble) { return canvasBubbleTailSetting(bubble, "tailJaggedLengthOffset", 0, -24, 24); }
function canvasBubbleTailJaggedWidthOffset(bubble) { return canvasBubbleTailSetting(bubble, "tailJaggedWidthOffset", 11, 0, 30); }
function canvasBubbleTailJaggedSpacing(bubble) { return canvasBubbleTailSetting(bubble, "tailJaggedSpacing", 1, 0.5, 1.8); }
function canvasBubbleTailJaggedCenterPoints(bubble, base, tip, baseOverlap = 0, endExtra = 0) {
  const normalize = (x, y) => {
    const len = Math.hypot(x, y) || 1;
    return { x: x / len, y: y / len, len };
  };
  const vx = tip.x - base.x;
  const vy = tip.y - base.y;
  const u = normalize(vx, vy);
  const n = { x: -u.y, y: u.x };
  const total = Math.max(0.1, u.len);
  const count = canvasBubbleTailJaggedCount(bubble);
  const spacing = canvasBubbleTailJaggedSpacing(bubble);
  const widthOffset = canvasBubbleTailJaggedWidthOffset(bubble);
  const lengthOffset = canvasBubbleTailJaggedLengthOffset(bubble);
  const pointAt = (along, side = 0) => ({ x: base.x + u.x * along + n.x * side, y: base.y + u.y * along + n.y * side });

  // Build the real jagged centerline first, without any layer cap offsets.
  // Then apply baseOverlap along the first jagged segment and tipExtend/tipInset
  // along the last jagged segment. This keeps the white/black layer offsets local
  // to the contour direction instead of reusing the curved-tail base→tip vector.
  const center = [pointAt(0, 0)];
  const denom = Math.max(1, count + 1);
  for (let i = 1; i <= count; i++) {
    const raw = i / denom;
    const eased = Math.pow(raw, spacing);
    const sideSign = i % 2 ? 1 : -1;
    const along = total * eased + sideSign * lengthOffset;
    const clampedAlong = Math.max(1.2, Math.min(total - 1.2, along));
    center.push(pointAt(clampedAlong, sideSign * widthOffset));
  }
  center.push(pointAt(total, 0));

  const firstDir = normalize(center[1].x - center[0].x, center[1].y - center[0].y);
  const last = center[center.length - 1];
  const prev = center[center.length - 2];
  const lastDir = normalize(last.x - prev.x, last.y - prev.y);
  const pts = center.map(pt => ({ ...pt }));
  pts[0] = { x: center[0].x - firstDir.x * baseOverlap, y: center[0].y - firstDir.y * baseOverlap };
  pts[pts.length - 1] = { x: last.x + lastDir.x * endExtra, y: last.y + lastDir.y * endExtra };
  return pts;
}
function canvasBubbleJaggedTaperPoints(bubble, base, tip, half, { grow = 0, baseOverlap = 0, tipExtend = 0, tipInset = 0 } = {}) {
  const normalize = (x, y) => {
    const len = Math.hypot(x, y) || 1;
    return { x: x / len, y: y / len };
  };
  const endExtra = Math.max(-Math.hypot(tip.x - base.x, tip.y - base.y) + 0.1, tipExtend - tipInset);
  const center = canvasBubbleTailJaggedCenterPoints(bubble, base, tip, baseOverlap, endExtra);
  const width0 = Math.max(0.05, half + grow);
  const left = [];
  const right = [];
  center.forEach((pt, i) => {
    const prev = center[Math.max(0, i - 1)];
    const next = center[Math.min(center.length - 1, i + 1)];
    const tan = normalize(next.x - prev.x, next.y - prev.y);
    const nx = -tan.y;
    const ny = tan.x;
    const t = i / Math.max(1, center.length - 1);
    const taper = Math.pow(Math.max(0, 1 - t), 0.92);
    const width = width0 * taper;
    left.push({ x: pt.x + nx * width, y: pt.y + ny * width });
    right.push({ x: pt.x - nx * width, y: pt.y - ny * width });
  });
  return { center, left, right };
}
function canvasBubbleJaggedPathFromEdge(points) {
  return points.map((pt, i) => `${i ? "L" : "M"} ${pt.x.toFixed(3)} ${pt.y.toFixed(3)}`).join(" ");
}
function canvasBubbleJaggedTaperPath(bubble, base, tip, half, options = {}) {
  const shape = canvasBubbleJaggedTaperPoints(bubble, base, tip, half, options);
  const parts = [];
  shape.left.forEach((pt, i) => parts.push(`${i ? "L" : "M"} ${pt.x.toFixed(3)} ${pt.y.toFixed(3)}`));
  shape.right.slice().reverse().forEach(pt => parts.push(`L ${pt.x.toFixed(3)} ${pt.y.toFixed(3)}`));
  parts.push("Z");
  return parts.join(" ");
}

function canvasBubbleTailSetting(bubble, key, fallback, min, max) {
  return canvasBubbleNumber(bubble?.[key], fallback, min, max);
}
function canvasBubbleTailBaseWidth(bubble) { return canvasBubbleTailSetting(bubble, "tailBaseWidth", 13, 4, 28); }
function canvasBubbleTailBaseShift(bubble) { return canvasBubbleTailSetting(bubble, "tailBaseShift", 0, -30, 30); }
function canvasBubbleTailOuterStroke(bubble) { return canvasBubbleTailSetting(bubble, "tailOuterStroke", 2, 0.1, 5); }
function canvasBubbleTailInnerStroke(bubble) { return 0; }
function canvasBubbleTailAnchorOffset(bubble) { return BUBBLE_ANCHOR_OFFSET_ZERO_ACTUAL + canvasBubbleTailSetting(bubble, "tailAnchorOffset", 0, -12, 12); }
function canvasBubbleTailAnchorOffsetUi(bubble) { return canvasBubbleTailSetting(bubble, "tailAnchorOffset", 0, -12, 12); }
function canvasBubbleThoughtSpacing(bubble) { return canvasBubbleTailSetting(bubble, "thoughtSpacing", 1, 0.6, 2.2); }
function canvasBubbleThoughtScaleX(bubble) { return canvasBubbleTailSetting(bubble, "thoughtScaleX", 1, 0.5, 1.8); }
function canvasBubbleThoughtScaleY(bubble) { return canvasBubbleTailSetting(bubble, "thoughtScaleY", 1, 0.5, 1.8); }
function canvasBubbleThoughtFalloff(bubble) { return canvasBubbleTailSetting(bubble, "thoughtFalloff", 1.15, 0.4, 2.5); }
function canvasBubbleThoughtBaseSize(bubble) { return canvasBubbleTailSetting(bubble, "thoughtBaseSize", 1, 0.45, 2.2); }
function canvasBubbleThoughtBaseOffset(bubble) { return canvasBubbleTailSetting(bubble, "thoughtBaseOffset", 0, -24, 24); }
function canvasBubbleThoughtBaseOffsetActual(bubble) { return Math.max(0, Math.min(60, THOUGHT_BASE_OFFSET_ZERO_ACTUAL + canvasBubbleThoughtBaseOffset(bubble))); }
function canvasBubbleThoughtJoinEnabled(bubble) { return bubble?.thoughtJoin === true; }
function canvasBubbleThoughtJoinWidth(bubble) { return canvasBubbleTailSetting(bubble, "thoughtJoinWidth", 1, 0.2, 2.5); }
function canvasBubbleThoughtJoinLength(bubble) { return canvasBubbleTailSetting(bubble, "thoughtJoinLength", 1, 0, 1.5); }
function canvasBubbleThoughtCount(bubble) { return Math.max(3, Math.min(8, Math.round(canvasBubbleTailSetting(bubble, "thoughtCount", 5, 3, 8)))); }
function canvasBubbleThoughtAngle(bubble) { return canvasBubbleTailSetting(bubble, "thoughtAngle", 0, -90, 90); }
function canvasBubbleIsThought(bubble) { return String(bubble?.type || "speech") === "thought"; }
function canvasBubbleTailCurved(bubble) { return canvasBubbleTailMode(bubble) === "curved"; }
function canvasBubbleTailBroken(bubble) { return canvasBubbleTailMode(bubble) === "jagged"; }
function canvasBubbleCurveMode(bubble) { return String(bubble?.tailCurveMode || "normal") === "quadrant" ? "quadrant" : "normal"; }
function canvasBubbleNormalizeAngle(angle) {
  let a = Number(angle) || 0;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
function markCanvasSelectionDom(kind, id, corner = "") {
  canvasSetSingleSelection(kind, id || "", corner || "");
}
function canvasBubbleTailGeometry(bubble) {
  const txPercent = canvasBubbleNumber(bubble?.tailX, 18);
  const tyPercent = canvasBubbleNumber(bubble?.tailY, 112);
  const pageAspect = 0.75;
  const bw = Math.max(8, Number(bubble?.w) || 18);
  const bh = Math.max(6, Number(bubble?.h) || 12);
  const aspect = Math.max(0.45, Math.min(5.5, (bw / bh) * pageAspect));
  const viewW = Math.round(aspect * 1000) / 10;
  const cx = viewW / 2;
  const cy = 50;
  const tx = (txPercent / 100) * viewW;
  const ty = tyPercent;
  const rx = viewW * 0.465;
  const ry = 45.5;

  let defaultDx = tx - cx;
  let defaultDy = ty - cy;
  if (Math.abs(defaultDx) < 0.0001 && Math.abs(defaultDy) < 0.0001) {
    defaultDx = -0.22 * viewW;
    defaultDy = 62;
  }
  const defaultBaseTheta = Math.atan2(defaultDy / ry, defaultDx / rx);

  let dx = defaultDx;
  let dy = defaultDy;
  if (bubble?.tailBaseCustom) {
    if (bubble.tailBaseRelativeFollow !== false && bubble.tailBaseOffsetReady) {
      const theta = defaultBaseTheta + canvasBubbleNumber(bubble.tailBaseAngleOffset, 0, -6.283, 6.283);
      dx = Math.cos(theta) * rx;
      dy = Math.sin(theta) * ry;
    } else {
      const bxPercent = canvasBubbleNumber(bubble.tailBaseX, NaN, -80, 180);
      const byPercent = canvasBubbleNumber(bubble.tailBaseY, NaN, -80, 180);
      if (Number.isFinite(bxPercent) && Number.isFinite(byPercent)) {
        dx = (bxPercent / 100) * viewW - cx;
        dy = byPercent - cy;
      }
    }
  }

  if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) {
    dx = defaultDx;
    dy = defaultDy;
  }
  const scale = 1 / (Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry)) || 1);
  const bx = cx + dx * scale;
  const by = cy + dy * scale;
  const baseTheta = Math.atan2((by - cy) / ry, (bx - cx) / rx);

  const rawNx = (bx - cx) / (rx * rx);
  const rawNy = (by - cy) / (ry * ry);
  const nLen = Math.sqrt(rawNx * rawNx + rawNy * rawNy) || 1;
  const nux = rawNx / nLen;
  const nuy = rawNy / nLen;
  const offset = canvasBubbleTailAnchorOffset(bubble);
  const ax = bx + nux * (offset + 0.8);
  const ay = by + nuy * (offset + 0.8);
  let txg = -nuy;
  let tyg = nux;
  const tlen = Math.sqrt(txg * txg + tyg * tyg) || 1;
  txg /= tlen;
  tyg /= tlen;
  const baseShift = bubble?.tailBaseCustom ? 0 : canvasBubbleTailBaseShift(bubble);
  const sax = ax + txg * baseShift;
  const say = ay + tyg * baseShift;
  const half = canvasBubbleTailBaseWidth(bubble) / 2;
  const p1 = [Math.round((sax - txg * half) * 10) / 10, Math.round((say - tyg * half) * 10) / 10];
  const p2 = [Math.round((sax + txg * half) * 10) / 10, Math.round((say + tyg * half) * 10) / 10];
  const tip = [Math.round(tx * 10) / 10, Math.round(ty * 10) / 10];
  return {
    viewW, cx, cy, rx, ry,
    defaultBaseTheta,
    baseTheta,
    anchor:[ax, ay],
    baseContour:[Math.round(bx * 10) / 10, Math.round(by * 10) / 10],
    baseCenter:[Math.round(sax * 10) / 10, Math.round(say * 10) / 10],
    tangent:[txg, tyg],
    points: [p1, tip, p2]
  };
}
function canvasBubbleTailPointsArray(bubble) {
  return canvasBubbleTailGeometry(bubble).points;
}
function canvasBubbleTailPoints(bubble) {
  return canvasBubbleTailGeometry(bubble).points.map(p => `${p[0]},${p[1]}`).join(" ");
}
function canvasBubbleTailCurveGeometry(bubble) {
  // Curve control must follow only the tail tip + automatic base reference.
  // Custom base and Base relative affect the base only, not the curve bend.
  return canvasBubbleTailGeometry({ ...bubble, tailBaseCustom: false, tailBaseOffsetReady: false, tailBaseShift: 0 });
}
function canvasBubbleTailQuadrantFlipSign(bubble, geom = null) {
  const g = geom || canvasBubbleTailCurveGeometry(bubble);
  const tip = g.points[1];
  const sx = tip[0] >= g.cx ? 1 : -1;
  const sy = tip[1] >= g.cy ? 1 : -1;
  return sx === sy ? 1 : -1;
}
function canvasBubbleTailDefaultCurvePoint(bubble, geom = null) {
  const g = geom || canvasBubbleTailCurveGeometry(bubble);
  const p1 = g.points[0], tip = g.points[1], p2 = g.points[2];
  const baseCenter = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
  const mx = (baseCenter[0] + tip[0]) / 2;
  const my = (baseCenter[1] + tip[1]) / 2;
  const vx = tip[0] - baseCenter[0];
  const vy = tip[1] - baseCenter[1];
  const len = Math.sqrt(vx * vx + vy * vy) || 1;
  const nx = -vy / len;
  const ny = vx / len;
  const bend = Math.max(6, Math.min(18, len * 0.2));

  const c1 = [mx + nx * bend, my + ny * bend];
  const c2 = [mx - nx * bend, my - ny * bend];
  const d1 = (c1[0] - g.cx) ** 2 + (c1[1] - g.cy) ** 2;
  const d2 = (c2[0] - g.cx) ** 2 + (c2[1] - g.cy) ** 2;

  if (canvasBubbleCurveMode(bubble) === "quadrant") {
    // v2.31.29: hard stable quadrant mode.
    // Do not use outer/inner distance here; that can invert briefly near axes and then return.
    // The side is locked by the real tail tip quadrant relative to the bubble center.
    const sign = canvasBubbleTailQuadrantFlipSign(bubble, g);
    const pick = [mx + nx * bend * sign, my + ny * bend * sign];
    return [Math.round(pick[0] * 10) / 10, Math.round(pick[1] * 10) / 10];
  }

  // Normal: exact v2.31.22-v2.31.24 continuous behavior.
  const radialDot = (mx - g.cx) * nx + (my - g.cy) * ny;
  const outerFactor = Math.tanh(radialDot / 2.8);
  const diagonalFactor = Math.tanh((-(vx * vy) / Math.max(1, len * len)) * 10);
  const sign = outerFactor * diagonalFactor;
  const pick = [mx + nx * bend * sign, my + ny * bend * sign];
  return [Math.round(pick[0] * 10) / 10, Math.round(pick[1] * 10) / 10];
}
function canvasBubbleTailAbsoluteCurvePoint(bubble) {
  const g = canvasBubbleTailCurveGeometry(bubble);
  return [Math.round(((canvasBubbleNumber(bubble.tailCurveX, 0, -120, 220) / 100) * g.viewW) * 10) / 10, Math.round(canvasBubbleNumber(bubble.tailCurveY, 0, -120, 220) * 10) / 10];
}
function canvasBubbleTailCurveBasis(bubble, geom = null) {
  const g = geom || canvasBubbleTailCurveGeometry(bubble);
  const p1 = g.points[0], tip = g.points[1], p2 = g.points[2];
  const baseCenter = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
  let ux = tip[0] - baseCenter[0];
  let uy = tip[1] - baseCenter[1];
  const len = Math.sqrt(ux * ux + uy * uy) || 1;
  ux /= len;
  uy /= len;
  return { ux, uy, nx: -uy, ny: ux };
}
function canvasBubbleSetManualCurveFromPoint(bubble, point, relative = null) {
  if (!bubble || !point) return;
  const g = canvasBubbleTailCurveGeometry(bubble);
  bubble.tailCurveManual = true;
  const useRelative = relative === null ? bubble.tailRelativeFollow !== false : !!relative;
  if (useRelative) {
    const auto = canvasBubbleTailDefaultCurvePoint(bubble, g);
    const basis = canvasBubbleTailCurveBasis(bubble, g);
    const dx = point[0] - auto[0];
    const dy = point[1] - auto[1];
    const sideSign = canvasBubbleCurveMode(bubble) === "quadrant" ? canvasBubbleTailQuadrantFlipSign(bubble, g) : 1;
    bubble.tailCurveOffsetX = Math.round((dx * basis.ux + dy * basis.uy) * 10) / 10;
    bubble.tailCurveOffsetY = Math.round(((dx * basis.nx + dy * basis.ny) / sideSign) * 10) / 10;
    bubble.tailCurveOffsetReady = true;
  } else {
    bubble.tailCurveOffsetReady = false;
  }
  bubble.tailCurveX = Math.round(((point[0] / Math.max(1, g.viewW)) * 100) * 10) / 10;
  bubble.tailCurveY = Math.round(point[1] * 10) / 10;
}
function canvasBubbleTailCurvePoint(bubble) {
  const g = canvasBubbleTailCurveGeometry(bubble);
  if (bubble?.tailCurved && bubble?.tailCurveManual) {
    if (bubble.tailRelativeFollow !== false && bubble.tailCurveOffsetReady) {
      const auto = canvasBubbleTailDefaultCurvePoint(bubble, g);
      const basis = canvasBubbleTailCurveBasis(bubble, g);
      const ou = canvasBubbleNumber(bubble.tailCurveOffsetX, 0, -120, 120);
      const rawOn = canvasBubbleNumber(bubble.tailCurveOffsetY, 0, -120, 120);
      const sideSign = canvasBubbleCurveMode(bubble) === "quadrant" ? canvasBubbleTailQuadrantFlipSign(bubble, g) : 1;
      const on = rawOn * sideSign;
      return [Math.round((auto[0] + basis.ux * ou + basis.nx * on) * 10) / 10, Math.round((auto[1] + basis.uy * ou + basis.ny * on) * 10) / 10];
    }
    return canvasBubbleTailAbsoluteCurvePoint(bubble);
  }
  return canvasBubbleTailDefaultCurvePoint(bubble, g);
}
function canvasBubbleTailCurvePercentFromPoint(bubble, pt) {
  const g = canvasBubbleTailCurveGeometry(bubble);
  return {
    x: Math.round(((pt[0] / g.viewW) * 100) * 10) / 10,
    y: Math.round(pt[1] * 10) / 10
  };
}

function canvasBubbleSetBaseFromPoint(bubble, point, relative = null) {
  if (!bubble || !point) return;
  const baseDefault = canvasBubbleTailGeometry({ ...bubble, tailBaseCustom: false, tailBaseOffsetReady: false, tailBaseShift: 0 });
  const theta = Math.atan2((point[1] - baseDefault.cy) / baseDefault.ry, (point[0] - baseDefault.cx) / baseDefault.rx);
  const bx = baseDefault.cx + Math.cos(theta) * baseDefault.rx;
  const by = baseDefault.cy + Math.sin(theta) * baseDefault.ry;
  const useRelative = relative === null ? (bubble.tailBaseRelativeFollow !== false) : !!relative;
  bubble.tailBaseCustom = true;
  bubble.tailBaseShift = 0;
  bubble.tailBaseX = Math.round(((bx / baseDefault.viewW) * 100) * 10) / 10;
  bubble.tailBaseY = Math.round(by * 10) / 10;
  if (useRelative) {
    bubble.tailBaseAngleOffset = Math.round(canvasBubbleNormalizeAngle(theta - baseDefault.defaultBaseTheta) * 1000) / 1000;
    bubble.tailBaseOffsetReady = true;
  } else {
    bubble.tailBaseOffsetReady = false;
  }
}

function canvasBubblePathPointLinear(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
function canvasBubblePathPointQuadratic(a, c, b, t) {
  const mt = 1 - t;
  return [mt * mt * a[0] + 2 * mt * t * c[0] + t * t * b[0], mt * mt * a[1] + 2 * mt * t * c[1] + t * t * b[1]];
}
function canvasBubblePathTangentQuadratic(a, c, b, t) {
  return [2 * (1 - t) * (c[0] - a[0]) + 2 * t * (b[0] - c[0]), 2 * (1 - t) * (c[1] - a[1]) + 2 * t * (b[1] - c[1])];
}
function canvasBubbleThoughtTailData(bubble) {
  const g = canvasBubbleTailGeometry(bubble);
  const base = g.baseContour || g.baseCenter;
  const tip = g.points[1];
  const curved = canvasBubbleTailCurved(bubble);
  const cp = curved ? canvasBubbleTailCurvePoint(bubble) : [(base[0] + tip[0]) / 2, (base[1] + tip[1]) / 2];
  const pointAt = (t) => curved ? canvasBubblePathPointQuadratic(base, cp, tip, t) : canvasBubblePathPointLinear(base, tip, t);
  const tanAt = (t) => curved ? canvasBubblePathTangentQuadratic(base, cp, tip, t) : [tip[0] - base[0], tip[1] - base[1]];

  const samples = [];
  let totalLen = 0;
  let prev = pointAt(0);
  samples.push({ t: 0, len: 0, p: prev, tg: tanAt(0) });
  for (let i = 1; i <= 80; i++) {
    const t = i / 80;
    const p = pointAt(t);
    totalLen += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
    samples.push({ t, len: totalLen, p, tg: tanAt(t) });
  }
  const pointAtLenFromBase = (targetLen) => {
    if (targetLen <= 0) return samples[0];
    if (targetLen >= totalLen) return samples[samples.length - 1];
    for (let i = 1; i < samples.length; i++) {
      if (samples[i].len >= targetLen) {
        const a = samples[i - 1];
        const b = samples[i];
        const span = Math.max(0.0001, b.len - a.len);
        const u = (targetLen - a.len) / span;
        return {
          t: a.t + (b.t - a.t) * u,
          p: [a.p[0] + (b.p[0] - a.p[0]) * u, a.p[1] + (b.p[1] - a.p[1]) * u],
          tg: [a.tg[0] + (b.tg[0] - a.tg[0]) * u, a.tg[1] + (b.tg[1] - a.tg[1]) * u]
        };
      }
    }
    return samples[samples.length - 1];
  };

  const spacing = canvasBubbleThoughtSpacing(bubble);
  const count = canvasBubbleThoughtCount(bubble);
  const aspect = Math.max(0.6, Math.min(2.35, (g.rx / Math.max(1, g.ry)) * canvasBubbleThoughtScaleX(bubble)));
  const sy = canvasBubbleThoughtScaleY(bubble);
  const falloff = canvasBubbleThoughtFalloff(bubble);
  const baseSize = canvasBubbleThoughtBaseSize(bubble);
  const baseOffset = canvasBubbleThoughtBaseOffsetActual(bubble);
  const angleOffset = canvasBubbleThoughtAngle(bubble);

  const minRy = 2.1 * sy;
  const maxRy = 6.7 * sy * baseSize;
  const sizes = [];
  for (let i = 0; i < count; i++) {
    const progress = count === 1 ? 1 : (i / Math.max(1, count - 1)); // tip -> base
    const grow = Math.pow(progress, 1 / Math.max(0.08, falloff));
    const ry = minRy + (maxRy - minRy) * grow;
    const rx = Math.max(1.8, ry * aspect);
    sizes.push({ rx, ry });
  }

  // v2.31.39-v2.31.41: pin both endpoints in path-length space.
  // The smallest/tip dot is centered exactly on the tail-tip handle.
  // X/Y scale and Base dot size affect only ellipse size, never dot positions.
  // v2.31.40 adds Base offset; v2.31.41 adds Join toggle/width/length
  // so the visual bridge can be controlled without moving dot positions.
  const tipLenFromBase = totalLen;
  const baseLenFromBase = Math.max(0, Math.min(totalLen, baseOffset));
  const spacingCurve = Math.max(0.35, Math.min(2.8, spacing));

  const dots = [];
  for (let i = 0; i < count; i++) {
    const progress = count === 1 ? 0 : (i / Math.max(1, count - 1)); // tip -> base
    const eased = Math.pow(progress, spacingCurve);
    const lenFromBase = tipLenFromBase + (baseLenFromBase - tipLenFromBase) * eased;
    const sample = pointAtLenFromBase(lenFromBase);
    const tangentAngle = Math.atan2(sample.tg[1] || 0, sample.tg[0] || 1) * 180 / Math.PI;
    const angle = bubble?.thoughtHorizontal ? angleOffset : (tangentAngle + 90 + angleOffset);
    dots.push({
      cx: Math.round(sample.p[0] * 10) / 10,
      cy: Math.round(sample.p[1] * 10) / 10,
      rx: Math.round(sizes[i].rx * 10) / 10,
      ry: Math.round(sizes[i].ry * 10) / 10,
      angle: Math.round(angle * 10) / 10
    });
  }
  return { viewW: g.viewW, count, dots, join: null };
}
function canvasBubbleTailSvgContent(bubble) {
  if (String(bubble?.type || "speech") === "caption") return "";
  if (canvasBubbleIsThought(bubble)) {
    const thought = canvasBubbleThoughtTailData(bubble);
    const dotsSvg = thought.dots.map(dot => `<ellipse class="thought-tail-dot" cx="${dot.cx}" cy="${dot.cy}" rx="${dot.rx}" ry="${dot.ry}" transform="rotate(${dot.angle} ${dot.cx} ${dot.cy})"></ellipse>`).join("");
    const join = thought.join && Math.hypot(thought.join.x2 - thought.join.x1, thought.join.y2 - thought.join.y1) > 0.35
      ? `<line class="thought-tail-join" x1="${thought.join.x1}" y1="${thought.join.y1}" x2="${thought.join.x2}" y2="${thought.join.y2}" style="stroke-width:${thought.join.width}px"></line>`
      : "";
    return `${dotsSvg}${join}`;
  }
  return `<path class="bubble-tail-fill" d="${safeAttr(canvasBubbleTailFillPath(bubble))}"></path><line class="bubble-tail-base-white" ${canvasBubbleTailBaseLineAttrs(bubble)}></line><path class="bubble-tail-side bubble-tail-side-a" d="${safeAttr(canvasBubbleTailSidePathA(bubble))}"></path><path class="bubble-tail-side bubble-tail-side-b" d="${safeAttr(canvasBubbleTailSidePathB(bubble))}"></path>`;
}

function canvasBubbleTailFillPath(bubble) {
  const g = canvasBubbleTailGeometry(bubble);
  const [p1, tip, p2] = g.points;
  if (canvasBubbleTailJagged(bubble)) {
    const base = { x: (p1[0] + p2[0]) / 2, y: (p1[1] + p2[1]) / 2 };
    return canvasBubbleJaggedTaperPath(bubble, base, { x: tip[0], y: tip[1] }, Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 2, { grow: 0, baseOverlap: 0, tipExtend: 0 });
  }
  if (canvasBubbleTailCurved(bubble)) {
    const cp = canvasBubbleTailCurvePoint(bubble);
    return `M ${p1[0]} ${p1[1]} Q ${cp[0]} ${cp[1]} ${tip[0]} ${tip[1]} Q ${cp[0]} ${cp[1]} ${p2[0]} ${p2[1]} Z`;
  }
  return `M ${p1[0]} ${p1[1]} L ${tip[0]} ${tip[1]} L ${p2[0]} ${p2[1]} Z`;
}
function canvasBubbleTailSidePathA(bubble) {
  const g = canvasBubbleTailGeometry(bubble);
  const [p1, tip, p2] = g.points;
  if (canvasBubbleTailJagged(bubble)) {
    const base = { x: (p1[0] + p2[0]) / 2, y: (p1[1] + p2[1]) / 2 };
    const half = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 2;
    const shape = canvasBubbleJaggedTaperPoints(bubble, base, { x: tip[0], y: tip[1] }, half, { grow: 0, baseOverlap: 0, tipExtend: 0 });
    return canvasBubbleJaggedPathFromEdge(shape.left);
  }
  if (canvasBubbleTailCurved(bubble)) {
    const cp = canvasBubbleTailCurvePoint(bubble);
    return `M ${p1[0]} ${p1[1]} Q ${cp[0]} ${cp[1]} ${tip[0]} ${tip[1]}`;
  }
  return `M ${p1[0]} ${p1[1]} L ${tip[0]} ${tip[1]}`;
}
function canvasBubbleTailSidePathB(bubble) {
  const g = canvasBubbleTailGeometry(bubble);
  const [p1, tip, p2] = g.points;
  if (canvasBubbleTailJagged(bubble)) {
    const base = { x: (p1[0] + p2[0]) / 2, y: (p1[1] + p2[1]) / 2 };
    const half = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 2;
    const shape = canvasBubbleJaggedTaperPoints(bubble, base, { x: tip[0], y: tip[1] }, half, { grow: 0, baseOverlap: 0, tipExtend: 0 });
    return canvasBubbleJaggedPathFromEdge(shape.right);
  }
  if (canvasBubbleTailCurved(bubble)) {
    const cp = canvasBubbleTailCurvePoint(bubble);
    return `M ${p2[0]} ${p2[1]} Q ${cp[0]} ${cp[1]} ${tip[0]} ${tip[1]}`;
  }
  return `M ${p2[0]} ${p2[1]} L ${tip[0]} ${tip[1]}`;
}
function canvasBubbleTailBaseLineAttrs(bubble) {
  const pts = canvasBubbleTailGeometry(bubble).points;
  return `x1="${pts[0][0]}" y1="${pts[0][1]}" x2="${pts[2][0]}" y2="${pts[2][1]}"`;
}
function canvasBubbleTailViewBox(bubble) {
  return `0 0 ${canvasBubbleTailGeometry(bubble).viewW} 100`;
}
function updateCanvasBubbleSecondaryCompoundDom(bubble) {
  const el = bubble?.id ? $(`#comicCanvas .canvas-bubble[data-bubble-id="${cssEscapeValue(bubble.id)}"]`) : null;
  if (!el || !bubble) return;
  const oldCompound = el.querySelector('.canvas-bubble-secondary-compound-svg');
  if (oldCompound) oldCompound.remove();
  const bridgeHtml = canvasBubbleHasAttachedSecondary(bubble) ? canvasBubbleSecondaryStandaloneBridgeSvg(bubble) : "";
  const oldBridge = el.querySelector('.canvas-bubble-secondary-standalone-bridge');
  if (oldBridge && bridgeHtml) oldBridge.outerHTML = bridgeHtml;
  else if (oldBridge && !bridgeHtml) oldBridge.remove();
  else if (bridgeHtml) el.insertAdjacentHTML('afterbegin', bridgeHtml);
}

function updateCanvasBubbleBridgeBendHandlesDom(bubble) {
  const el = bubble?.id ? $(`#comicCanvas .canvas-bubble[data-bubble-id="${cssEscapeValue(bubble.id)}"]`) : null;
  if (!el || !bubble) return;
  for (const handle of $$(".canvas-bridge-bend-handle[data-bridge-bend]", el)) {
    const i = Math.max(1, Math.min(3, Math.round(Number(handle.dataset.bridgeBend) || 1)));
    const p = canvasBubbleBridgeBendPoint(bubble, i);
    handle.style.left = `${p.x}%`;
    handle.style.top = `${p.y}%`;
  }
}

function updateCanvasBubbleSecondaryDom(bubble) {
  const el = bubble?.id ? $(`#comicCanvas .canvas-bubble[data-bubble-id="${cssEscapeValue(bubble.id)}"]`) : null;
  if (!el || !bubble) return;
  if (canvasBubbleHasAttachedSecondary(bubble)) {
    canvasBubbleAttachedBubbleData(bubble).forEach(secData => {
      const sec = el.querySelector(`.canvas-bubble-secondary[data-secondary-bubble="${secData.index}"]`);
      if (!sec) return;
      sec.style.setProperty("--bubble-secondary-x", `${secData.x}%`);
      sec.style.setProperty("--bubble-secondary-y", `${secData.y}%`);
      sec.style.setProperty("--bubble-secondary-w", `${secData.w}%`);
      sec.style.setProperty("--bubble-secondary-h", `${secData.h}%`);
      sec.style.setProperty("--bubble-secondary-font-scale", `${secData.fontScale}`);
    });
  }
  updateCanvasBubbleSecondaryCompoundDom(bubble);
  updateCanvasBubbleDualLayerDom(bubble);
  updateCanvasBubbleBridgeBendHandlesDom(bubble);
}

function updateCanvasBubbleTailDom(bubble) {
  const el = bubble?.id ? $(`#comicCanvas .canvas-bubble[data-bubble-id="${cssEscapeValue(bubble.id)}"]`) : null;
  if (!el || !bubble) return;
  const tx = canvasBubbleNumber(bubble.tailX, 18);
  const ty = canvasBubbleNumber(bubble.tailY, 112);
  el.style.setProperty("--bubble-tail-x", `${tx}%`);
  el.style.setProperty("--bubble-tail-y", `${ty}%`);
  const unifiedStroke = canvasBubbleTailOuterStroke(bubble);
  const thoughtDotStroke = Math.max(0.5, unifiedStroke);
  el.style.setProperty("--bubble-stroke-width", `${unifiedStroke}px`);
  el.style.setProperty("--bubble-main-stroke-width", `${unifiedStroke}px`);
  el.style.setProperty("--bubble-tail-outer", `${unifiedStroke}px`);
  el.style.setProperty("--bubble-thought-dot-stroke", `${thoughtDotStroke}px`);
  el.style.setProperty("--bubble-tail-base-white", `${Math.max(1.3, unifiedStroke + 0.4)}px`);
  const svg = el.querySelector('.canvas-bubble-tail-svg');
  if (svg) {
    svg.setAttribute('viewBox', canvasBubbleTailViewBox(bubble));
    svg.innerHTML = canvasBubbleTailSvgContent(bubble);
  }
  updateCanvasBubbleSecondaryCompoundDom(bubble);
  updateCanvasBubbleDualLayerDom(bubble);
  const curveHandle = el.querySelector('.canvas-bubble-curve-handle');
  if (curveHandle) {
    curveHandle.hidden = !canvasBubbleTailCurved(bubble);
    const cp = canvasBubbleTailCurvePoint(bubble);
    const geom = canvasBubbleTailGeometry(bubble);
    curveHandle.style.left = `${(cp[0] / geom.viewW) * 100}%`;
    curveHandle.style.top = `${cp[1]}%`;
  }
  const baseHandle = el.querySelector('.canvas-bubble-base-handle');
  if (baseHandle) {
    baseHandle.hidden = !bubble.tailBaseCustom;
    const geom = canvasBubbleTailGeometry(bubble);
    baseHandle.style.left = `${(geom.baseContour[0] / geom.viewW) * 100}%`;
    baseHandle.style.top = `${geom.baseContour[1]}%`;
  }
}
function deleteSelectedCanvasBubble() {
  const canvas = activeCanvasObj();
  if (!canvas || !canvasSelectedBubbleId) return;
  canvas.bubbles = (canvas.bubbles || []).filter(b => b.id !== canvasSelectedBubbleId);
  cleanupCanvasBubbleJoins(canvas);
  canvasMultiSelection = canvasMultiSelection.filter(i => !(i.kind === "bubble" && i.id === canvasSelectedBubbleId));
  canvasSelectedBubbleId = "";
  canvas.updatedAt = new Date().toISOString();
  scheduleCanvasesStateSave();
  renderComicCanvas();
  renderCanvasControls();
}
function setSelectedCanvasFit(fit = "fit") {
  const panel = selectedCanvasPanel();
  if (!panel) return;
  panel.fit = fit === "fill" ? "fill" : "fit";
  if (panel.fit === "fill") {
    panel.cropX = Number.isFinite(Number(panel.cropX)) ? panel.cropX : 50;
    panel.cropY = Number.isFinite(Number(panel.cropY)) ? panel.cropY : 50;
    panel.cropZoom = Number.isFinite(Number(panel.cropZoom)) ? panel.cropZoom : 1;
  }
  activeCanvasObj().updatedAt = new Date().toISOString();
  scheduleCanvasesStateSave();
  renderComicCanvas();
}
function resetSelectedCanvasCrop() {
  const panel = selectedCanvasPanel();
  if (!panel) return;
  panel.cropX = 50;
  panel.cropY = 50;
  panel.cropZoom = 1;
  activeCanvasObj().updatedAt = new Date().toISOString();
  scheduleCanvasesStateSave();
  renderComicCanvas();
}
function adjustSelectedCanvasCropZoom(delta = 0) {
  const panel = selectedCanvasPanel();
  if (!panel) return;
  panel.fit = "fill";
  const current = Number.isFinite(Number(panel.cropZoom)) ? Number(panel.cropZoom) : 1;
  panel.cropZoom = Math.max(1, Math.min(3, Math.round((current + delta) * 100) / 100));
  activeCanvasObj().updatedAt = new Date().toISOString();
  scheduleCanvasesStateSave();
  renderComicCanvas();
}
function adjustSelectedCanvasStroke(delta = 0) {
  const panel = selectedCanvasPanel();
  if (!panel) return;
  const current = Number.isFinite(Number(panel.strokeWidth)) ? Number(panel.strokeWidth) : 0;
  panel.strokeWidth = Math.max(0, Math.min(12, Math.round(current + delta)));
  if (panel.strokeSeparate !== true) {
    panel.strokeTop = panel.strokeWidth;
    panel.strokeRight = panel.strokeWidth;
    panel.strokeBottom = panel.strokeWidth;
    panel.strokeLeft = panel.strokeWidth;
  }
  activeCanvasObj().updatedAt = new Date().toISOString();
  scheduleCanvasesStateSave();
  renderComicCanvas();
}
function setSelectedCanvasStroke(width = 0, color = null) {
  const panel = selectedCanvasPanel();
  if (!panel) return;
  panel.strokeWidth = Math.max(0, Math.min(12, Math.round(Number(width) || 0)));
  if (panel.strokeSeparate !== true) {
    panel.strokeTop = panel.strokeWidth;
    panel.strokeRight = panel.strokeWidth;
    panel.strokeBottom = panel.strokeWidth;
    panel.strokeLeft = panel.strokeWidth;
  }
  if (color && /^#[0-9a-f]{6}$/i.test(String(color))) panel.strokeColor = String(color);
  activeCanvasObj().updatedAt = new Date().toISOString();
  scheduleCanvasesStateSave();
  renderComicCanvas();
}
function cycleSelectedCanvasStrokeColor() {
  const panel = selectedCanvasPanel();
  if (!panel) return;
  const colors = ["#000000", "#ffffff", "#facc15", "#ef4444"];
  const current = String(panel.strokeColor || "#000000").toLowerCase();
  const idx = colors.findIndex(c => c.toLowerCase() === current);
  panel.strokeColor = colors[(idx + 1 + colors.length) % colors.length];
  if (!Number(panel.strokeWidth)) panel.strokeWidth = 2;
  if (panel.strokeSeparate !== true) {
    panel.strokeTop = panel.strokeWidth;
    panel.strokeRight = panel.strokeWidth;
    panel.strokeBottom = panel.strokeWidth;
    panel.strokeLeft = panel.strokeWidth;
  }
  activeCanvasObj().updatedAt = new Date().toISOString();
  scheduleCanvasesStateSave();
  renderComicCanvas();
}
function canvasPanelImageMetrics(panel, img = null) {
  const el = panel?.id ? $(`#comicCanvas .canvas-panel[data-panel-id="${cssEscapeValue(panel.id)}"]`) : null;
  img = img || el?.querySelector?.("img");
  if (!el || !img || !panel) return null;
  const rect = el.getBoundingClientRect();
  const pw = Math.max(1, rect.width);
  const ph = Math.max(1, rect.height);
  const nw = Math.max(1, Number(img.naturalWidth) || 1);
  const nh = Math.max(1, Number(img.naturalHeight) || 1);
  const zoom = Math.max(1, Math.min(3, Number.isFinite(Number(panel.cropZoom)) ? Number(panel.cropZoom) : 1));
  const baseScale = Math.max(pw / nw, ph / nh);
  const drawW = nw * baseScale * zoom;
  const drawH = nh * baseScale * zoom;
  const overflowX = Math.max(0, drawW - pw);
  const overflowY = Math.max(0, drawH - ph);
  return { el, img, pw, ph, nw, nh, zoom, drawW, drawH, overflowX, overflowY };
}
function normalizeCanvasCropForPanel(panel, metrics = null) {
  if (!panel) return;
  const m = metrics || canvasPanelImageMetrics(panel);
  const cropX = Number.isFinite(Number(panel.cropX)) ? Number(panel.cropX) : 50;
  const cropY = Number.isFinite(Number(panel.cropY)) ? Number(panel.cropY) : 50;
  panel.cropX = m && m.overflowX <= 0.5 ? 50 : Math.max(0, Math.min(100, cropX));
  panel.cropY = m && m.overflowY <= 0.5 ? 50 : Math.max(0, Math.min(100, cropY));
}
function updateCanvasPanelCropDom(panel) {
  const el = panel?.id ? $(`#comicCanvas .canvas-panel[data-panel-id="${cssEscapeValue(panel.id)}"]`) : null;
  const img = el?.querySelector?.("img");
  if (!img || !panel) return;
  if ((panel.fit || "fit") !== "fill") {
    img.style.position = "";
    img.style.left = "";
    img.style.top = "";
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.objectFit = "contain";
    img.style.objectPosition = "50% 50%";
    img.style.transform = "";
    return;
  }
  const m = canvasPanelImageMetrics(panel, img);
  if (!m || !img.naturalWidth || !img.naturalHeight) {
    img.style.objectFit = "cover";
    img.style.objectPosition = `${Math.max(0, Math.min(100, Number(panel.cropX) || 50))}% ${Math.max(0, Math.min(100, Number(panel.cropY) || 50))}%`;
    img.style.transform = "";
    return;
  }
  normalizeCanvasCropForPanel(panel, m);
  const cropX = Math.max(0, Math.min(100, Number(panel.cropX) || 0));
  const cropY = Math.max(0, Math.min(100, Number(panel.cropY) || 0));
  const left = -m.overflowX * (cropX / 100);
  const top = -m.overflowY * (cropY / 100);
  img.style.position = "absolute";
  img.style.left = `${left}px`;
  img.style.top = `${top}px`;
  img.style.width = `${m.drawW}px`;
  img.style.height = `${m.drawH}px`;
  img.style.objectFit = "fill";
  img.style.objectPosition = "50% 50%";
  img.style.transform = "";
}
function hydrateCanvasPanelImages() {
  const canvas = activeCanvasObj();
  if (!canvas || !state.settings.canvasView) return;
  for (const panel of (canvas.panels || [])) {
    const el = $(`#comicCanvas .canvas-panel[data-panel-id="${cssEscapeValue(panel.id)}"]`);
    const img = el?.querySelector?.("img");
    if (!img) continue;
    if (!img.dataset.canvasCropBound) {
      img.dataset.canvasCropBound = "1";
      img.addEventListener("load", () => updateCanvasPanelCropDom(panel));
    }
    updateCanvasPanelCropDom(panel);
  }
}
function showCanvasCropHint() {
  const hint = $("#canvasCropHint");
  if (!hint) return;
  hint.hidden = false;
  clearTimeout(canvasCropHintTimer);
  canvasCropHintTimer = setTimeout(() => { hint.hidden = true; }, 1800);
}
function reorderSelectedCanvasPanel(toFront = true) {
  const canvas = activeCanvasObj();
  const panel = selectedCanvasPanel();
  if (!canvas || !panel) return;
  const zs = [...(canvas.panels || []).map(p => Number(p.z) || 0), ...(canvas.bubbles || []).map(b => Number(b.z) || 0)];
  panel.z = toFront ? Math.max(0, ...zs) + 1 : Math.min(0, ...zs) - 1;
  canvas.updatedAt = new Date().toISOString();
  scheduleCanvasesStateSave();
  renderComicCanvas();
}
function reorderSelectedCanvasBubble(toFront = true) {
  const canvas = activeCanvasObj();
  const bubble = selectedCanvasBubble();
  if (!canvas || !bubble) return;
  const zs = [...(canvas.panels || []).map(p => Number(p.z) || 0), ...(canvas.bubbles || []).map(b => Number(b.z) || 0)];
  bubble.z = toFront ? Math.max(0, ...zs) + 1 : Math.min(0, ...zs) - 1;
  canvas.updatedAt = new Date().toISOString();
  scheduleCanvasesStateSave();
  renderComicCanvas();
}
function deleteSelectedCanvasPanel() {
  const canvas = activeCanvasObj();
  if (!canvas) return;
  const selectedPanels = new Set(canvasMultiSelection.filter(i => i.kind === "panel").map(i => i.id));
  const selectedBubbles = new Set(canvasMultiSelection.filter(i => i.kind === "bubble").map(i => i.id));
  if (selectedPanels.size || selectedBubbles.size) {
    canvas.panels = (canvas.panels || []).filter(p => !selectedPanels.has(p.id));
    canvas.bubbles = (canvas.bubbles || []).filter(b => !selectedBubbles.has(b.id));
    canvasMultiSelection = canvasMultiSelection.filter(i => i.kind === "corner");
    canvasSelectedPanelId = "";
    canvasSelectedBubbleId = "";
    canvas.updatedAt = new Date().toISOString();
    scheduleCanvasesStateSave();
    renderComicCanvas();
    renderCanvasControls();
    return;
  }
  if (canvasSelectedBubbleId) return deleteSelectedCanvasBubble();
  if (!canvasSelectedPanelId) return;
  canvas.panels = (canvas.panels || []).filter(p => p.id !== canvasSelectedPanelId);
  canvasSelectedPanelId = "";
  canvasMultiSelection = [];
  canvas.updatedAt = new Date().toISOString();
  scheduleCanvasesStateSave();
  renderComicCanvas();
  renderCanvasControls();
}
function canvasMediaHtml(asset, panel) {
  if (!asset) return `<div class="canvas-video-placeholder">Missing</div>`;
  const prompt = safeAttr(asset.prompt || asset.filename || "panel");
  if ((asset.kind || "image") === "video") return `<div class="canvas-video-placeholder">▶ Video</div>`;
  const url = mediaFullUrl(asset) || mediaPreviewUrl(asset) || initialGridImageUrl(asset) || lightweightPreviewUrl(asset) || "";
  const cropX = Math.max(0, Math.min(100, Number.isFinite(Number(panel?.cropX)) ? Number(panel.cropX) : 50));
  const cropY = Math.max(0, Math.min(100, Number.isFinite(Number(panel?.cropY)) ? Number(panel.cropY) : 50));
  const style = `object-position:${cropX}% ${cropY}%;`;
  return url ? `<img class="canvas-panel-img" src="${safeAttr(url)}" alt="${prompt}" loading="lazy" decoding="async" referrerpolicy="no-referrer" style="${safeAttr(style)}" />` : `<div class="canvas-video-placeholder">Image unavailable</div>`;
}
function renderComicCanvas() {
  const root = $("#comicCanvas");
  const canvas = activeCanvasObj();
  if (!root) return;
  if (!canvas || !state.settings.canvasView) { root.innerHTML = ""; return; }
  const items = [
    ...((canvas.panels || []).map((panel, i) => ({ kind: "panel", z: Number(panel.z) || i + 1, data: panel }))),
    ...((canvas.bubbles || []).map((bubble, i) => ({ kind: "bubble", z: Number(bubble.z) || 500 + i + 1, data: bubble })))
  ].sort((a, b) => a.z - b.z);
  const itemsHtml = items.map((entry, visualIndex) => {
    if (entry.kind === "bubble") {
      const bubble = entry.data;
      const selected = canvasIsBubbleSelected(bubble.id);
      const tailX = canvasBubbleNumber(bubble.tailX, 18);
      const tailY = canvasBubbleNumber(bubble.tailY, 112);
      const unifiedStroke = canvasBubbleTailOuterStroke(bubble);
      const joinedTailHidden = canvasBubbleTailHiddenByJoin(canvas, bubble.id);
      const tailHidden = canvasBubbleTailHidden(canvas, bubble);
      return `<div class="canvas-bubble ${safeAttr(bubble.type || "speech")} bubble-shape-${safeAttr(canvasBubbleShapeType(bubble))} style-${safeAttr(bubble.style || "white")} ${selected ? "selected" : ""} ${joinedTailHidden ? "joined-tail-hidden" : ""} ${tailHidden ? "tail-hidden" : ""} ${canvasBubbleHasAttachedSecondary(bubble) ? "has-secondary" : ""} ${canvasBubbleSecondaryBooleanEnabled(bubble) ? "boolean-secondary" : ""} ${canvasBubbleSecondaryShapeMergeEnabled(bubble) ? "secondary-shape-merge" : ""} ${canvasBubbleThoughtBubblesMergeEnabled(bubble) ? "thought-merge" : ""} ${canvasBubbleTailBooleanEnabled(bubble) ? "tail-boolean" : ""} ${canvasBubbleSecondaryStandaloneEnabled(bubble) ? "secondary-standalone" : ""} ${canvasBubbleDualLayerEnabled(bubble) ? "dual-layer-bubble" : ""}" data-bubble-id="${safeAttr(bubble.id)}" style="left:${bubble.x}%;top:${bubble.y}%;width:${bubble.w}%;height:${bubble.h}%;z-index:${bubble.z || visualIndex + 1};font-size:${Math.max(10, Math.min(42, Number(bubble.fontSize) || 16))}px;--bubble-tail-x:${tailX}%;--bubble-tail-y:${tailY}%;--bubble-stroke-width:${unifiedStroke}px;--bubble-main-stroke-width:${unifiedStroke}px;--bubble-tail-outer:${(Math.max(0.1, unifiedStroke + 0.05)).toFixed(2)}px;--bubble-thought-dot-stroke:${Math.max(0.1, unifiedStroke).toFixed(2)}px;--bubble-tail-base-white:${Math.max(0.1, unifiedStroke + 0.4)}px;">
        ${canvasBubbleDualLayerSvg(bubble)}
        <svg class="canvas-bubble-tail-svg" viewBox="${safeAttr(canvasBubbleTailViewBox(bubble))}" preserveAspectRatio="none" aria-hidden="true" ${canvasBubbleDualLayerEnabled(bubble) ? "style='display:none !important; visibility:hidden !important; opacity:0 !important;'" : ""}>${canvasBubbleTailSvgContent(bubble)}</svg>
        <div class="canvas-bubble-tail-handle" data-tail-handle="1" title="Drag tail"></div>
        <div class="canvas-bubble-curve-handle" data-tail-curve-handle="1" title="Drag curve" ${canvasBubbleTailCurved(bubble) ? '' : 'hidden'}></div>
        <div class="canvas-bubble-base-handle" data-tail-base-handle="1" title="Drag tail base" ${bubble.tailBaseCustom ? '' : 'hidden'}></div>
        ${canvasBubbleBridgeBendHandlesHtml(bubble)}
        ${canvasBubbleSecondaryHtml(bubble)}
        <div class="canvas-bubble-text">${safeText(bubble.text || "...")}</div>
        <div class="canvas-resize-handle" data-resize="1"></div>
      </div>`;
    }
    const panel = entry.data;
    const asset = assetById(panel.itemId);
    const selected = canvasIsPanelSelected(panel.id);
    return `<div class="canvas-panel ${safeAttr(panel.fit || "fit")} ${canvasPanelShapeEnabled(panel) ? "shape-custom" : ""} ${selected ? "selected" : ""}" data-panel-id="${safeAttr(panel.id)}" style="left:${panel.x}%;top:${panel.y}%;width:${panel.w}%;height:${panel.h}%;z-index:${panel.z || visualIndex + 1};--canvas-stroke-width:${Math.max(0, Math.min(12, Number(panel.strokeWidth) || 0))}px;--canvas-stroke-top:${Math.max(0, Math.min(12, Number(panel.strokeSeparate ? panel.strokeTop : panel.strokeWidth) || 0))}px;--canvas-stroke-right:${Math.max(0, Math.min(12, Number(panel.strokeSeparate ? panel.strokeRight : panel.strokeWidth) || 0))}px;--canvas-stroke-bottom:${Math.max(0, Math.min(12, Number(panel.strokeSeparate ? panel.strokeBottom : panel.strokeWidth) || 0))}px;--canvas-stroke-left:${Math.max(0, Math.min(12, Number(panel.strokeSeparate ? panel.strokeLeft : panel.strokeWidth) || 0))}px;--canvas-stroke-color:${safeAttr(/^#[0-9a-f]{6}$/i.test(String(panel.strokeColor || "")) ? panel.strokeColor : "#000000")};--canvas-panel-clip:${safeAttr(canvasPanelClipPolygon(panel))}">
      <div class="canvas-panel-shape">${canvasMediaHtml(asset, panel)}</div>
      <svg class="canvas-panel-border-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${canvasPanelBorderSvgContent(panel, selected)}</svg>
      ${canvasPanelCornerHandlesHtml(panel, selected)}
      <div class="canvas-resize-handle" data-resize="1"></div>
    </div>`;
  }).join("");
  root.innerHTML = itemsHtml + canvasBubbleJoinsHtml(canvas);
  hydrateCanvasPanelImages();
  updateCanvasBubbleSideControls();
  updateCanvasPanelSideControls();
}
async function exportActiveCanvas() {
  const canvas = activeCanvasObj();
  if (!canvas) return;
  const payload = {
    schema: "ai-media-manager.canvas.v1",
    appVersion: "2.32.98",
    exportedAt: new Date().toISOString(),
    canvas,
    assets: (canvas.panels || []).map(p => {
      const a = assetById(p.itemId);
      return a ? { id: a.id, source: a.source, kind: a.kind, prompt: a.prompt || "", filename: a.filename || "", createdAt: a.createdAt || "", rating: ratingForItem(a.id) } : { id: p.itemId, missing: true };
    })
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `comic-canvas-${String(canvas.name || "canvas").toLowerCase().replace(/[^a-z0-9а-я]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "canvas"}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function canvasRectIntersects(a, b) {
  return a && b && a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}
function canvasRectContains(a, b) {
  return a && b && a.left <= b.left && a.right >= b.right && a.top <= b.top && a.bottom >= b.bottom;
}
function canvasSelectionRectFromPoints(x1, y1, x2, y2) {
  return { left: Math.min(x1, x2), top: Math.min(y1, y2), right: Math.max(x1, x2), bottom: Math.max(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}
function canvasPointerMatchesDrag(e) {
  if (!canvasDragState) return false;
  // Pointer events should match by pointerId. Mouse fallback events have no
  // pointerId, so allow them for the active canvas drag/select operation.
  return e?.pointerId === undefined || canvasDragState.pointerId === undefined || e.pointerId === canvasDragState.pointerId;
}
function canvasUpdateSelectBoxVisual(state) {
  if (!state?.boxEl) return;
  const r = canvasSelectionRectFromPoints(state.startX, state.startY, state.lastX, state.lastY);
  state.boxEl.hidden = false;
  state.boxEl.style.display = "block";
  state.boxEl.style.visibility = "visible";
  state.boxEl.style.opacity = "1";
  state.boxEl.style.left = `${r.left}px`;
  state.boxEl.style.top = `${r.top}px`;
  state.boxEl.style.width = `${Math.max(1, r.width)}px`;
  state.boxEl.style.height = `${Math.max(1, r.height)}px`;
  state.boxEl.dataset.mode = state.additive ? "add" : "replace";
}
function canvasItemsInScreenRect(rect) {
  const root = $("#comicCanvas");
  if (!root) return [];
  const cornerHits = [];
  $$(".canvas-panel-corner-handle[data-shape-corner]", root).forEach(el => {
    const panelId = el.closest?.(".canvas-panel[data-panel-id]")?.dataset?.panelId || "";
    const r = el.getBoundingClientRect();
    const pad = 8;
    const hit = { left: r.left - pad, top: r.top - pad, right: r.right + pad, bottom: r.bottom + pad };
    if (panelId && canvasRectIntersects(rect, hit)) cornerHits.push(canvasSelectionItem("corner", panelId, el.dataset.shapeCorner));
  });

  const objectHits = [];
  $$(".canvas-panel[data-panel-id]", root).forEach(el => {
    const pr = el.getBoundingClientRect();
    if (canvasRectIntersects(rect, pr)) objectHits.push({ item: canvasSelectionItem("panel", el.dataset.panelId), rect: pr, contained: canvasRectContains(rect, pr) });
  });
  $$(".canvas-bubble[data-bubble-id]", root).forEach(el => {
    const br = el.getBoundingClientRect();
    if (canvasRectIntersects(rect, br)) objectHits.push({ item: canvasSelectionItem("bubble", el.dataset.bubbleId), rect: br, contained: canvasRectContains(rect, br) });
  });

  // v2.31.50: if the box catches visible corner handles, prefer the handles
  // unless a full panel/bubble is enclosed. This lets a small box select two
  // shape points without also selecting the whole panel under them.
  const containedObjects = objectHits.filter(hit => hit.contained).map(hit => hit.item);
  const objectItems = cornerHits.length ? containedObjects : objectHits.map(hit => hit.item);
  return canvasNormalizeSelection([...objectItems, ...cornerHits]);
}
// v2.31.52: canvas-select-box is handled before dx/dy math so drag-box cannot crash on first move.
function canvasBeginBoxSelection(e, root, options = {}) {
  const box = document.createElement("div");
  box.className = "canvas-drag-select-box";
  box.hidden = false;
  box.style.display = "block";
  box.style.visibility = "visible";
  box.style.opacity = "1";
  document.body.appendChild(box);
  const additive = options.additive ?? !!(e.ctrlKey || e.metaKey);
  const startX = Number.isFinite(Number(options.startX)) ? Number(options.startX) : e.clientX;
  const startY = Number.isFinite(Number(options.startY)) ? Number(options.startY) : e.clientY;
  const lastX = Number.isFinite(Number(options.lastX)) ? Number(options.lastX) : e.clientX;
  const lastY = Number.isFinite(Number(options.lastY)) ? Number(options.lastY) : e.clientY;
  canvasDragState = { pointerId: e.pointerId, mode: "canvas-select-box", startX, startY, lastX, lastY, rect: root.getBoundingClientRect(), boxEl: box, additive, baseSelection: additive ? canvasNormalizeSelection(options.baseSelection || canvasMultiSelection) : [] };
  document.body.classList.add("canvas-drag-selecting");
  canvasUpdateSelectBoxVisual(canvasDragState);
  try { root.setPointerCapture(e.pointerId); } catch (_) {}
}
function canvasBeginPendingBoxSelection(e, root, targetItem = null) {
  e.preventDefault();
  canvasDragState = {
    pointerId: e.pointerId,
    mode: "canvas-select-pending",
    startX: e.clientX,
    startY: e.clientY,
    lastX: e.clientX,
    lastY: e.clientY,
    rect: root.getBoundingClientRect(),
    targetItem,
    additive: true,
    baseSelection: canvasNormalizeSelection(canvasMultiSelection)
  };
  try { root.setPointerCapture(e.pointerId); } catch (_) {}
}
function canvasPromotePendingBoxSelection(e) {
  const root = $("#comicCanvas");
  if (!root || !canvasDragState || canvasDragState.mode !== "canvas-select-pending") return;
  const pending = canvasDragState;
  canvasBeginBoxSelection(e, root, {
    startX: pending.startX,
    startY: pending.startY,
    lastX: e.clientX,
    lastY: e.clientY,
    additive: true,
    baseSelection: pending.baseSelection || canvasMultiSelection
  });
  canvasApplyBoxSelectionFromDrag();
}
function canvasApplyBoxSelectionFromDrag() {
  if (!canvasDragState || canvasDragState.mode !== "canvas-select-box") return;
  const r = canvasSelectionRectFromPoints(canvasDragState.startX, canvasDragState.startY, canvasDragState.lastX, canvasDragState.lastY);
  const hits = canvasItemsInScreenRect(r);
  const next = canvasDragState.additive ? canvasNormalizeSelection([...(canvasDragState.baseSelection || []), ...hits]) : hits;
  canvasSetSelection(next, next[next.length - 1] || null);
}
function canvasSelectedObjectStarts() {
  const canvas = activeCanvasObj();
  return canvasSelectionObjectsForMove().map(item => {
    const obj = item.kind === "panel" ? canvas?.panels?.find(p => p.id === item.id) : canvas?.bubbles?.find(b => b.id === item.id);
    return obj ? { ...item, start: { ...obj } } : null;
  }).filter(Boolean);
}
function canvasSelectedCornerStarts() {
  const canvas = activeCanvasObj();
  const map = { tl: ["shapeTlX", "shapeTlY"], tr: ["shapeTrX", "shapeTrY"], br: ["shapeBrX", "shapeBrY"], bl: ["shapeBlX", "shapeBlY"] };
  return canvasSelectionCornersForMove().map(item => {
    const panel = canvas?.panels?.find(p => p.id === item.panelId);
    const fields = map[item.corner];
    const el = $(`#comicCanvas .canvas-panel[data-panel-id="${cssEscapeValue(item.panelId)}"]`);
    if (!panel || !fields || !el) return null;
    const pr = el.getBoundingClientRect();
    return { ...item, fields, rect: pr, startXValue: Number(panel[fields[0]]) || 0, startYValue: Number(panel[fields[1]]) || 0 };
  }).filter(Boolean);
}
function startCanvasPointer(e) {
  const root = $("#comicCanvas");
  if (!root || e.button !== 0) return;
  const bubbleEl = e.target.closest?.(".canvas-bubble[data-bubble-id]");
  const panelEl = e.target.closest?.(".canvas-panel[data-panel-id]");
  const shapeHandle = e.target.closest?.(".canvas-panel-corner-handle[data-shape-corner]");
  if (!panelEl && !bubbleEl) {
    e.preventDefault();
    canvasBeginBoxSelection(e, root);
    return;
  }
  e.preventDefault();
  const rect = root.getBoundingClientRect();
  if (bubbleEl) {
    const bubble = activeCanvasObj()?.bubbles?.find(b => b.id === bubbleEl.dataset.bubbleId);
    if (!bubble) return;
    const bridgeBendEl = e.target.closest?.(".canvas-bridge-bend-handle[data-bridge-bend]");
    if (bridgeBendEl && canvasBubbleSecondaryBridgeEnabled(bubble)) {
      canvasBubbleEnsureBridgeBendOffsets(bubble);
      canvasSetSingleSelection("bubble", bubble.id);
      const bubbleRect = bubbleEl.getBoundingClientRect();
      canvasDragState = {
        pointerId: e.pointerId,
        mode: "bubble-bridge-bend",
        bubbleId: bubble.id,
        bridgeBendIndex: Math.max(1, Math.min(3, Math.round(Number(bridgeBendEl.dataset.bridgeBend) || 1))),
        startX: e.clientX,
        startY: e.clientY,
        rect,
        bubbleRect,
        start: { ...bubble }
      };
      bubbleEl.classList.add("dragging", "bridge-bend-dragging");
      bridgeBendEl.classList.add("dragging");
      try { bridgeBendEl.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }
    const secondaryEl = e.target.closest?.(".canvas-bubble-secondary[data-secondary-bubble]");
    if (secondaryEl && canvasBubbleHasAttachedSecondary(bubble)) {
      canvasBubbleEnsureBridgeBendOffsets(bubble);
      const secondaryResize = !!e.target.closest?.(".canvas-secondary-resize-handle[data-secondary-resize]");
      canvasSetSingleSelection("bubble", bubble.id);
      const bubbleRect = bubbleEl.getBoundingClientRect();
      canvasDragState = {
        pointerId: e.pointerId,
        mode: secondaryResize ? "bubble-secondary-resize" : "bubble-secondary-move",
        bubbleId: bubble.id,
        secondaryIndex: Math.max(1, Math.min(3, Math.round(Number(secondaryEl.dataset.secondaryBubble) || 1))),
        startX: e.clientX,
        startY: e.clientY,
        rect,
        bubbleRect,
        start: { ...bubble }
      };
      bubbleEl.classList.add("dragging", "secondary-dragging");
      secondaryEl.classList.add("dragging");
      try { secondaryEl.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }
    const mode = e.target.closest?.(".canvas-bubble-base-handle") ? "bubble-tail-base" : (e.target.closest?.(".canvas-bubble-curve-handle") ? "bubble-tail-curve" : (e.target.closest?.(".canvas-bubble-tail-handle") ? "bubble-tail" : (e.target.closest?.(".canvas-resize-handle") ? "bubble-resize" : "bubble-move")));
    if ((e.ctrlKey || e.metaKey) && mode === "bubble-move") {
      canvasBeginPendingBoxSelection(e, root, canvasSelectionItem("bubble", bubble.id));
      return;
    }
    const objectSelected = canvasSelectionHas("bubble", bubble.id);
    if (mode === "bubble-move" && objectSelected && canvasSelectionObjectsForMove().length > 1) {
      canvasDragState = { pointerId: e.pointerId, mode: "multi-move", startX: e.clientX, startY: e.clientY, rect, items: canvasSelectedObjectStarts() };
      bubbleEl.classList.add("dragging");
      try { bubbleEl.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }
    canvasSetSingleSelection("bubble", bubble.id);
    const bubbleRect = bubbleEl.getBoundingClientRect();
    const tailX = canvasBubbleNumber(bubble.tailX, 18);
    const tailY = canvasBubbleNumber(bubble.tailY, 112);
    const tailClientX = bubbleRect.left + (tailX / 100) * bubbleRect.width;
    const tailClientY = bubbleRect.top + (tailY / 100) * bubbleRect.height;
    const tailGrabOffset = { x: e.clientX - tailClientX, y: e.clientY - tailClientY };
    const geomStart = canvasBubbleTailGeometry(bubble);
    const curveGeomStart = canvasBubbleTailCurveGeometry(bubble);
    const curvePt = canvasBubbleTailCurvePoint(bubble);
    const curveClientX = bubbleRect.left + ((curvePt[0] / curveGeomStart.viewW) * bubbleRect.width);
    const curveClientY = bubbleRect.top + (curvePt[1] / 100) * bubbleRect.height;
    const curveGrabOffset = { x: e.clientX - curveClientX, y: e.clientY - curveClientY };
    const baseStartPoint = geomStart.baseContour || geomStart.baseCenter;
    const baseClientX = bubbleRect.left + ((baseStartPoint[0] / geomStart.viewW) * bubbleRect.width);
    const baseClientY = bubbleRect.top + (baseStartPoint[1] / 100) * bubbleRect.height;
    const baseGrabOffset = { x: e.clientX - baseClientX, y: e.clientY - baseClientY };
    canvasDragState = { pointerId: e.pointerId, mode, bubbleId: bubble.id, startX: e.clientX, startY: e.clientY, rect, bubbleRect, tailGrabOffset, curveGrabOffset, baseGrabOffset, start: { ...bubble } };
    bubbleEl.classList.add("dragging");
    try { bubbleEl.setPointerCapture(e.pointerId); } catch (_) {}
    return;
  }
  const panel = activeCanvasObj()?.panels?.find(p => p.id === panelEl.dataset.panelId);
  if (!panel) return;
  let mode = shapeHandle ? "shape-corner" : (e.target.closest?.(".canvas-resize-handle") ? "resize" : "move");
  const corner = shapeHandle?.dataset?.shapeCorner || "";
  if ((e.ctrlKey || e.metaKey) && mode === "shape-corner") {
    canvasBeginPendingBoxSelection(e, root, canvasSelectionItem("corner", panel.id, corner));
    return;
  }
  if ((e.ctrlKey || e.metaKey) && mode === "move") {
    canvasBeginPendingBoxSelection(e, root, canvasSelectionItem("panel", panel.id));
    return;
  }
  if (mode === "move" && panel.fit === "fill" && (e.shiftKey || e.altKey || e.target.closest?.(".canvas-panel")?.classList?.contains("crop-adjust"))) {
    mode = "crop";
    showCanvasCropHint();
  }
  const panelRect = panelEl.getBoundingClientRect();
  let cornerGrabOffset = { x: 0, y: 0 };
  if (mode === "shape-corner") {
    if (!canvasSelectionHas("corner", panel.id, corner)) canvasSetSingleSelection("corner", panel.id, corner);
    const cornerItems = canvasSelectedCornerStarts();
    if (cornerItems.length > 1) {
      canvasDragState = { pointerId: e.pointerId, mode: "multi-corners", startX: e.clientX, startY: e.clientY, rect, items: cornerItems };
      panelEl.classList.add("dragging");
      try { panelEl.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }
    const p = canvasPanelShapePoints(panel)[corner] || { x: 0, y: 0 };
    const cx = panelRect.left + (p.x / 100) * panelRect.width;
    const cy = panelRect.top + (p.y / 100) * panelRect.height;
    cornerGrabOffset = { x: e.clientX - cx, y: e.clientY - cy };
  } else {
    const objectSelected = canvasSelectionHas("panel", panel.id);
    if (mode === "move" && objectSelected && canvasSelectionObjectsForMove().length > 1) {
      canvasDragState = { pointerId: e.pointerId, mode: "multi-move", startX: e.clientX, startY: e.clientY, rect, items: canvasSelectedObjectStarts() };
      panelEl.classList.add("dragging");
      try { panelEl.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }
    canvasSetSingleSelection("panel", panel.id);
  }
  canvasDragState = { pointerId: e.pointerId, mode, panelId: panel.id, corner, cornerGrabOffset, startX: e.clientX, startY: e.clientY, rect, panelRect, start: { ...panel } };
  panelEl.classList.add("dragging");
  try { panelEl.setPointerCapture(e.pointerId); } catch (_) {}
}
function updateCanvasPointer(e) {
  if (!canvasDragState || !canvasPointerMatchesDrag(e)) return;
  if (canvasDragState.mode === "canvas-select-pending") {
    e.preventDefault?.();
    canvasDragState.lastX = e.clientX;
    canvasDragState.lastY = e.clientY;
    const dist = Math.hypot(e.clientX - canvasDragState.startX, e.clientY - canvasDragState.startY);
    if (dist >= 5) canvasPromotePendingBoxSelection(e);
    else return;
  }
  if (canvasDragState.mode === "canvas-select-box") {
    e.preventDefault();
    canvasDragState.lastX = e.clientX;
    canvasDragState.lastY = e.clientY;
    canvasUpdateSelectBoxVisual(canvasDragState);
    canvasApplyBoxSelectionFromDrag();
    return;
  }
  const canvas = activeCanvasObj();
  const dragRect = canvasDragState.rect || $("#comicCanvas")?.getBoundingClientRect?.() || { width: 1, height: 1 };
  const dx = ((e.clientX - canvasDragState.startX) / Math.max(1, dragRect.width)) * 100;
  const dy = ((e.clientY - canvasDragState.startY) / Math.max(1, dragRect.height)) * 100;
  if (canvasDragState.mode === "multi-move") {
    for (const item of canvasDragState.items || []) {
      if (item.kind === "panel") {
        const panel = canvas?.panels?.find(p => p.id === item.id);
        if (!panel) continue;
        panel.x = Math.max(0, Math.min(100 - panel.w, item.start.x + dx));
        panel.y = Math.max(0, Math.min(100 - panel.h, item.start.y + dy));
        const el = $(`#comicCanvas .canvas-panel[data-panel-id="${cssEscapeValue(panel.id)}"]`);
        if (el) { el.style.left = `${panel.x}%`; el.style.top = `${panel.y}%`; updateCanvasPanelShapeDom(panel); }
      } else if (item.kind === "bubble") {
        const bubble = canvas?.bubbles?.find(b => b.id === item.id);
        if (!bubble) continue;
        bubble.x = Math.max(0, Math.min(100 - bubble.w, item.start.x + dx));
        bubble.y = Math.max(0, Math.min(100 - bubble.h, item.start.y + dy));
        const el = $(`#comicCanvas .canvas-bubble[data-bubble-id="${cssEscapeValue(bubble.id)}"]`);
        if (el) { el.style.left = `${bubble.x}%`; el.style.top = `${bubble.y}%`; updateCanvasBubbleTailDom(bubble); }
      }
    }
    return;
  }
  if (canvasDragState.mode === "multi-corners") {
    const dxPx = e.clientX - canvasDragState.startX;
    const dyPx = e.clientY - canvasDragState.startY;
    const touched = new Set();
    for (const item of canvasDragState.items || []) {
      const panel = canvas?.panels?.find(p => p.id === item.panelId);
      if (!panel || !item.fields || !item.rect) continue;
      panel.shapeCustom = true;
      panel[item.fields[0]] = Math.round(Math.max(-40, Math.min(140, item.startXValue + (dxPx / Math.max(1, item.rect.width)) * 100)) * 10) / 10;
      panel[item.fields[1]] = Math.round(Math.max(-40, Math.min(140, item.startYValue + (dyPx / Math.max(1, item.rect.height)) * 100)) * 10) / 10;
      touched.add(panel.id);
    }
    touched.forEach(id => { const p = canvas?.panels?.find(panel => panel.id === id); if (p) updateCanvasPanelShapeDom(p); });
    updateCanvasPanelSideControls();
    return;
  }
  if (canvasDragState.bubbleId) {
    const bubble = canvas?.bubbles?.find(b => b.id === canvasDragState.bubbleId);
    if (!bubble) return;
    if (canvasDragState.mode === "bubble-bridge-bend") {
      const br = canvasDragState.bubbleRect || $(`#comicCanvas .canvas-bubble[data-bubble-id="${cssEscapeValue(bubble.id)}"]`)?.getBoundingClientRect?.() || { left: 0, top: 0, width: 1, height: 1 };
      const i = Math.max(1, Math.min(3, Math.round(Number(canvasDragState.bridgeBendIndex) || 1)));
      const x = ((e.clientX - br.left) / Math.max(1, br.width)) * 100;
      const y = ((e.clientY - br.top) / Math.max(1, br.height)) * 100;
      const px = Math.round(Math.max(-240, Math.min(420, x)) * 10) / 10;
      const py = Math.round(Math.max(-240, Math.min(420, y)) * 10) / 10;
      const d = canvasBubbleBridgeDefaultBendPoint(bubble, i);
      bubble[`secondaryBridgeBend${i}Custom`] = true;
      bubble[`secondaryBridgeBend${i}X`] = px;
      bubble[`secondaryBridgeBend${i}Y`] = py;
      bubble[`secondaryBridgeBend${i}OffsetX`] = Math.round((px - d.x) * 10) / 10;
      bubble[`secondaryBridgeBend${i}OffsetY`] = Math.round((py - d.y) * 10) / 10;
      updateCanvasBubbleSecondaryDom(bubble);
      updateCanvasBubbleSideControls();
      return;
    }
    if (canvasDragState.mode === "bubble-secondary-move" || canvasDragState.mode === "bubble-secondary-resize") {
      const br = canvasDragState.bubbleRect || $(`#comicCanvas .canvas-bubble[data-bubble-id="${cssEscapeValue(bubble.id)}"]`)?.getBoundingClientRect?.() || { width: 1, height: 1 };
      const secondaryIndex = Math.max(1, Math.min(3, Math.round(Number(canvasDragState.secondaryIndex) || 1)));
      const prefix = canvasBubbleSecondaryFieldPrefix(secondaryIndex);
      const bounds = canvasBubbleSecondaryBounds(secondaryIndex);
      const sx = Number.isFinite(Number(canvasDragState.start?.[`${prefix}X`])) ? Number(canvasDragState.start[`${prefix}X`]) : bounds.fallbackX;
      const sy = Number.isFinite(Number(canvasDragState.start?.[`${prefix}Y`])) ? Number(canvasDragState.start[`${prefix}Y`]) : bounds.fallbackY;
      const sw = Number.isFinite(Number(canvasDragState.start?.[`${prefix}W`])) ? Number(canvasDragState.start[`${prefix}W`]) : bounds.fallbackW;
      const sh = Number.isFinite(Number(canvasDragState.start?.[`${prefix}H`])) ? Number(canvasDragState.start[`${prefix}H`]) : bounds.fallbackH;
      const dxs = ((e.clientX - canvasDragState.startX) / Math.max(1, br.width)) * 100;
      const dys = ((e.clientY - canvasDragState.startY) / Math.max(1, br.height)) * 100;
      if (canvasDragState.mode === "bubble-secondary-resize") {
        bubble[`${prefix}W`] = Math.round(Math.max(20, Math.min(180, sw + dxs)) * 10) / 10;
        bubble[`${prefix}H`] = Math.round(Math.max(20, Math.min(180, sh + dys)) * 10) / 10;
        if (e.shiftKey) bubble[`${prefix}H`] = Math.round(Math.max(20, Math.min(180, bubble[`${prefix}W`] * (sh / Math.max(1, sw)))) * 10) / 10;
      } else {
        bubble[`${prefix}X`] = Math.round(Math.max(bounds.minX, Math.min(bounds.maxX, sx + dxs)) * 10) / 10;
        bubble[`${prefix}Y`] = Math.round(Math.max(bounds.minY, Math.min(bounds.maxY, sy + dys)) * 10) / 10;
      }
      updateCanvasBubbleSecondaryDom(bubble);
      updateCanvasBubbleSideControls();
      return;
    }
    if (canvasDragState.mode === "bubble-tail") {
      const br = canvasDragState.bubbleRect || { left: 0, top: 0, width: canvasDragState.rect.width, height: canvasDragState.rect.height };
      const grab = canvasDragState.tailGrabOffset || { x: 0, y: 0 };
      const prevTail = [canvasBubbleNumber(bubble.tailX, 18), canvasBubbleNumber(bubble.tailY, 112)];
      const nextX = ((e.clientX - grab.x - br.left) / Math.max(1, br.width)) * 100;
      const nextY = ((e.clientY - grab.y - br.top) / Math.max(1, br.height)) * 100;
      bubble.tailX = Math.round(canvasBubbleNumber(nextX, 18) * 10) / 10;
      bubble.tailY = Math.round(canvasBubbleNumber(nextY, 112) * 10) / 10;
      if (bubble.tailCurved && bubble.tailRelativeFollow !== false) {
        const cp = canvasBubbleTailCurvePoint(bubble);
        const pct = canvasBubbleTailCurvePercentFromPoint(bubble, cp);
        bubble.tailCurveX = pct.x;
        bubble.tailCurveY = pct.y;
      }
      if (bubble.tailBaseCustom && bubble.tailBaseRelativeFollow !== false && bubble.tailBaseOffsetReady) {
        const bg = canvasBubbleTailGeometry(bubble);
        const bp = bg.baseContour || bg.baseCenter;
        bubble.tailBaseX = Math.round(((bp[0] / bg.viewW) * 100) * 10) / 10;
        bubble.tailBaseY = Math.round(bp[1] * 10) / 10;
      }
      updateCanvasBubbleTailDom(bubble);
      return;
    } else if (canvasDragState.mode === "bubble-tail-curve") {
      const br = canvasDragState.bubbleRect || { left: 0, top: 0, width: canvasDragState.rect.width, height: canvasDragState.rect.height };
      const grab = canvasDragState.curveGrabOffset || { x: 0, y: 0 };
      const geom = canvasBubbleTailCurveGeometry(bubble);
      const nextX = (((e.clientX - grab.x - br.left) / Math.max(1, br.width)) * geom.viewW);
      const nextY = ((e.clientY - grab.y - br.top) / Math.max(1, br.height)) * 100;
      const pt = [nextX, nextY];
      bubble.tailCurved = true;
      bubble.tailCurveManual = true;
      canvasBubbleSetManualCurveFromPoint(bubble, pt, bubble.tailRelativeFollow !== false);
      updateCanvasBubbleTailDom(bubble);
      updateCanvasBubbleSideControls();
      return;
    } else if (canvasDragState.mode === "bubble-tail-base") {
      const br = canvasDragState.bubbleRect || { left: 0, top: 0, width: canvasDragState.rect.width, height: canvasDragState.rect.height };
      const grab = canvasDragState.baseGrabOffset || { x: 0, y: 0 };
      const defaultGeom = canvasBubbleTailGeometry({ ...bubble, tailBaseCustom: false, tailBaseOffsetReady: false, tailBaseShift: 0 });
      const px = ((e.clientX - grab.x - br.left) / Math.max(1, br.width)) * defaultGeom.viewW;
      const py = ((e.clientY - grab.y - br.top) / Math.max(1, br.height)) * 100;
      canvasBubbleSetBaseFromPoint(bubble, [px, py], bubble.tailBaseRelativeFollow !== false);
      updateCanvasBubbleTailDom(bubble);
      updateCanvasBubbleSideControls();
      return;
    } else if (canvasDragState.mode === "bubble-resize") {
      const br = canvasDragState.bubbleRect || { left: 0, top: 0, width: Math.max(1, dragRect.width * ((canvasDragState.start?.w || bubble.w) / 100)), height: Math.max(1, dragRect.height * ((canvasDragState.start?.h || bubble.h) / 100)) };
      const startBubble = canvasDragState.start || bubble;
      const startTailX = canvasBubbleNumber(startBubble.tailX, 18);
      const startTailY = canvasBubbleNumber(startBubble.tailY, 112);
      const tailAbsClientX = br.left + (startTailX / 100) * br.width;
      const tailAbsClientY = br.top + (startTailY / 100) * br.height;
      let curveAbsClient = null;
      if (startBubble.tailCurved && startBubble.tailCurveManual) {
        const startGeom = canvasBubbleTailGeometry(startBubble);
        const startCurve = canvasBubbleTailCurvePoint(startBubble);
        curveAbsClient = {
          x: br.left + (startCurve[0] / Math.max(1, startGeom.viewW)) * br.width,
          y: br.top + (startCurve[1] / 100) * br.height
        };
      }
      let baseAbsClient = null;
      if (startBubble.tailBaseCustom) {
        const startGeom = canvasBubbleTailGeometry(startBubble);
        const basePt = startGeom.baseContour || startGeom.baseCenter;
        if (basePt) {
          baseAbsClient = {
            x: br.left + (basePt[0] / Math.max(1, startGeom.viewW)) * br.width,
            y: br.top + (basePt[1] / 100) * br.height
          };
        }
      }
      bubble.w = Math.max(8, Math.min(100 - bubble.x, canvasDragState.start.w + dx));
      bubble.h = Math.max(6, Math.min(100 - bubble.y, canvasDragState.start.h + dy));
      const newWidthPx = Math.max(1, dragRect.width * (bubble.w / 100));
      const newHeightPx = Math.max(1, dragRect.height * (bubble.h / 100));
      bubble.tailX = Math.round((((tailAbsClientX - br.left) / newWidthPx) * 100) * 10) / 10;
      bubble.tailY = Math.round((((tailAbsClientY - br.top) / newHeightPx) * 100) * 10) / 10;
      if (curveAbsClient) {
        const newGeom = canvasBubbleTailCurveGeometry(bubble);
        const curvePt = [((curveAbsClient.x - br.left) / newWidthPx) * newGeom.viewW, ((curveAbsClient.y - br.top) / newHeightPx) * 100];
        canvasBubbleSetManualCurveFromPoint(bubble, curvePt, startBubble.tailRelativeFollow !== false);
      }
      if (baseAbsClient) {
        const newGeom = canvasBubbleTailGeometry({ ...bubble, tailBaseCustom: false, tailBaseOffsetReady: false, tailBaseShift: 0 });
        const basePt = [((baseAbsClient.x - br.left) / newWidthPx) * newGeom.viewW, ((baseAbsClient.y - br.top) / newHeightPx) * 100];
        canvasBubbleSetBaseFromPoint(bubble, basePt, startBubble.tailBaseRelativeFollow !== false);
      }
    } else {
      bubble.x = Math.max(0, Math.min(100 - bubble.w, canvasDragState.start.x + dx));
      bubble.y = Math.max(0, Math.min(100 - bubble.h, canvasDragState.start.y + dy));
    }
    const el = $(`#comicCanvas .canvas-bubble[data-bubble-id="${cssEscapeValue(bubble.id)}"]`);
    if (el) {
      el.style.left = `${bubble.x}%`; el.style.top = `${bubble.y}%`; el.style.width = `${bubble.w}%`; el.style.height = `${bubble.h}%`;
      updateCanvasBubbleTailDom(bubble);
    }
    return;
  }
  const panel = canvas?.panels?.find(p => p.id === canvasDragState.panelId);
  if (!panel) return;
  if (canvasDragState.mode === "shape-corner") {
    const key = String(canvasDragState.corner || "").toLowerCase();
    const map = { tl: ["shapeTlX", "shapeTlY"], tr: ["shapeTrX", "shapeTrY"], br: ["shapeBrX", "shapeBrY"], bl: ["shapeBlX", "shapeBlY"] };
    const fields = map[key];
    if (!fields) return;
    const pr = canvasDragState.panelRect || { left: 0, top: 0, width: 1, height: 1 };
    const grab = canvasDragState.cornerGrabOffset || { x: 0, y: 0 };
    const nx = ((e.clientX - grab.x - pr.left) / Math.max(1, pr.width)) * 100;
    const ny = ((e.clientY - grab.y - pr.top) / Math.max(1, pr.height)) * 100;
    panel.shapeCustom = true;
    panel[fields[0]] = Math.round(Math.max(-40, Math.min(140, nx)) * 10) / 10;
    panel[fields[1]] = Math.round(Math.max(-40, Math.min(140, ny)) * 10) / 10;
    updateCanvasPanelShapeDom(panel);
    updateCanvasPanelSideControls();
    return;
  } else if (canvasDragState.mode === "move") {
    panel.x = Math.max(0, Math.min(100 - panel.w, canvasDragState.start.x + dx));
    panel.y = Math.max(0, Math.min(100 - panel.h, canvasDragState.start.y + dy));
  } else if (canvasDragState.mode === "crop") {
    panel.fit = "fill";
    const metrics = canvasPanelImageMetrics(panel);
    const startCropX = Number.isFinite(Number(canvasDragState.start.cropX)) ? Number(canvasDragState.start.cropX) : 50;
    const startCropY = Number.isFinite(Number(canvasDragState.start.cropY)) ? Number(canvasDragState.start.cropY) : 50;
    const dxPx = e.clientX - canvasDragState.startX;
    const dyPx = e.clientY - canvasDragState.startY;
    if (metrics?.overflowX > 0.5) panel.cropX = Math.max(0, Math.min(100, startCropX - (dxPx / metrics.overflowX) * 100));
    else panel.cropX = 50;
    if (metrics?.overflowY > 0.5) panel.cropY = Math.max(0, Math.min(100, startCropY - (dyPx / metrics.overflowY) * 100));
    else panel.cropY = 50;
    updateCanvasPanelCropDom(panel);
    return;
  } else {
    panel.w = Math.max(6, Math.min(100 - panel.x, canvasDragState.start.w + dx));
    panel.h = Math.max(6, Math.min(100 - panel.y, canvasDragState.start.h + dy));
  }
  const el = $(`#comicCanvas .canvas-panel[data-panel-id="${cssEscapeValue(panel.id)}"]`);
  if (el) {
    el.style.left = `${panel.x}%`; el.style.top = `${panel.y}%`; el.style.width = `${panel.w}%`; el.style.height = `${panel.h}%`;
    updateCanvasPanelShapeDom(panel);
  }
}
function finishCanvasPointer(e) {
  if (!canvasDragState || !canvasPointerMatchesDrag(e)) return;
  const wasPendingBox = canvasDragState.mode === "canvas-select-pending";
  const wasBoxSelect = canvasDragState.mode === "canvas-select-box";
  if (wasPendingBox) {
    const target = canvasDragState.targetItem;
    canvasDragState = null;
    document.body.classList.remove("canvas-drag-selecting");
    if (target) {
      if (target.kind === "corner") canvasToggleSelection("corner", target.panelId, target.corner);
      else canvasToggleSelection(target.kind, target.id || target.panelId || target.bubbleId || "");
    }
    renderCanvasControls();
    canvasApplySelectionDom();
    return;
  }
  if (wasBoxSelect) {
    canvasApplyBoxSelectionFromDrag();
    canvasDragState.boxEl?.remove?.();
    document.body.classList.remove("canvas-drag-selecting");
  }
  const canvas = activeCanvasObj();
  if (canvas && !wasBoxSelect) canvas.updatedAt = new Date().toISOString();
  $$(`#comicCanvas .canvas-panel.dragging, #comicCanvas .canvas-bubble.dragging, #comicCanvas .canvas-bubble-secondary.dragging`).forEach(el => el.classList.remove("dragging", "secondary-dragging"));
  canvasDragState = null;
  if (!wasBoxSelect) scheduleCanvasesStateSave();
  renderCanvasControls();
  canvasApplySelectionDom();
}
function handleCanvasWheel(e) {
  const panelEl = e.target.closest?.(".canvas-panel[data-panel-id]");
  if (!panelEl || !(e.shiftKey || e.altKey)) return;
  const canvas = activeCanvasObj();
  const panel = canvas?.panels?.find(p => p.id === panelEl.dataset.panelId);
  if (!canvas || !panel) return;
  e.preventDefault();
  e.stopPropagation();
  canvasSelectedPanelId = panel.id;
  panel.fit = "fill";
  const delta = e.deltaY < 0 ? 0.08 : -0.08;
  const currentZoom = Number.isFinite(Number(panel.cropZoom)) ? Number(panel.cropZoom) : 1;
  panel.cropZoom = Math.max(1, Math.min(3, Math.round((currentZoom + delta) * 100) / 100));
  canvas.updatedAt = new Date().toISOString();
  updateCanvasPanelCropDom(panel);
  scheduleCanvasesStateSave();
  updateCanvasButtonStates();
  showCanvasCropHint();
}

function hiddenMainCollectionSet() {
  normalizeCollectionsState();
  const ids = Array.isArray(state.settings.hiddenMainViewCollections) ? state.settings.hiddenMainViewCollections : [];
  return new Set(ids.filter(id => state.collections?.[id]));
}
function isCollectionHiddenFromMain(id) {
  return hiddenMainCollectionSet().has(id);
}
function collectionCountsCacheKey() {
  normalizeCollectionsState();
  const hidden = (Array.isArray(state.settings.hiddenMainViewCollections) ? state.settings.hiddenMainViewCollections : []).join(",");
  const source = activeSource();
  const total = source === "local" ? Object.keys(localCatalog || {}).length : Object.keys(state.catalog || {}).length;
  return `${source}|${total}|${collectionStateVersion}|${hidden}`;
}
function collectionCountSummary() {
  const key = collectionCountsCacheKey();
  if (collectionCountsCache.key === key && collectionCountsCache.summary) return collectionCountsCache.summary;
  const hidden = hiddenMainCollectionSet();
  const summary = { byId: {}, mainItems: 0, hiddenItems: 0, unassigned: 0 };
  for (const a of allAssets()) {
    const ids = collectionIdsForItem(a.id);
    if (!ids.length) summary.unassigned += 1;
    for (const id of ids) summary.byId[id] = (summary.byId[id] || 0) + 1;
    if (ids.some(id => hidden.has(id))) summary.hiddenItems += 1;
    else summary.mainItems += 1;
  }
  collectionCountsCache = { key, summary };
  return summary;
}
function formatCollectionCount(n) {
  return typeof n === "number" && Number.isFinite(n) ? ` (${n})` : "";
}
function collectionFilterLabel(id, counts = null, hiddenSet = null) {
  const c = state.collections?.[id];
  if (!c) return "Collection";
  const count = counts?.byId ? counts.byId[id] || 0 : null;
  const hidden = hiddenSet ? hiddenSet.has(id) : isCollectionHiddenFromMain(id);
  return `${c.name || "Collection"}${formatCollectionCount(count)}${hidden ? " · hidden" : ""}`;
}
function collectionIndicatorHtml(asset) {
  const ids = collectionIdsForItem(asset.id);
  if (!ids.length) return "";
  const visible = ids.slice(0, 3);
  const diamonds = visible.map((id, i) => `<span class="collection-diamond" style="--collection-color:${safeAttr(collectionColor(id))}; --collection-offset:${i * 5}px"></span>`).join("");
  return `<span class="collection-indicator" title="In ${ids.length} collection${ids.length === 1 ? "" : "s"}">${diamonds}</span>`;
}
function collectionOptionsHtml(selected = "", includeSpecial = false) {
  const counts = collectionCountSummary();
  const hiddenSet = hiddenMainCollectionSet();
  const cols = sortedCollections();
  const hiddenGroupCount = hiddenSet.size;
  const cacheKey = `${includeSpecial ? "filter" : "target"}|${collectionCountsCache.key}|${cols.length}|${hiddenGroupCount}`;
  if (collectionOptionsCache[cacheKey]) return collectionOptionsCache[cacheKey];
  const special = includeSpecial
    ? `<option value="all">Main View${formatCollectionCount(counts.mainItems)}</option><option value="unassigned">Unassigned${formatCollectionCount(counts.unassigned)}</option>${hiddenGroupCount ? `<option value="hidden">Hidden from Main${formatCollectionCount(counts.hiddenItems)}</option>` : ""}`
    : `<option value="">Choose collection</option>`;
  const html = special + cols.map(c => `<option value="${safeAttr(c.id)}">${safeText(collectionFilterLabel(c.id, counts, hiddenSet))}</option>`).join("");
  collectionOptionsCache[cacheKey] = html;
  return html;
}
function updateCollectionButtonStates() {
  const hasCollections = sortedCollections().length > 0;
  const selectedCount = selectedIds.size;
  const activeId = state.settings.collectionFilter || "all";
  const activeReal = !!state.collections?.[activeId];
  const setDisabled = (id, disabled) => { const el = $("#" + id); if (el) el.disabled = !!disabled; };
  setDisabled("renameCollection", !activeReal);
  setDisabled("deleteCollection", !activeReal);
  setDisabled("hideCollectionMain", !activeReal);
  const hideBtn = $("#hideCollectionMain");
  if (hideBtn) {
    const hidden = activeReal && isCollectionHiddenFromMain(activeId);
    hideBtn.textContent = hidden ? "Show in Main" : "Hide from Main";
    hideBtn.title = activeReal
      ? (hidden ? "Restore this collection/group to the Main View." : "Hide this collection/group from the default Main View without deleting it.")
      : "Choose a collection first.";
    hideBtn.classList.toggle("warning-soft", activeReal && !hidden);
    hideBtn.classList.toggle("restore-soft", activeReal && hidden);
  }
  setDisabled("addSelectedToCollection", !hasCollections || !selectedCount);
  setDisabled("removeSelectedFromCollection", !hasCollections || !selectedCount);
}
function renderCollectionControls() {
  normalizeCollectionsState();
  const active = state.settings.collectionFilter || "all";
  const filterEl = $("#collectionFilter");
  if (filterEl) {
    const wasFocused = document.activeElement === filterEl;
    const html = collectionOptionsHtml(active, true);
    const filterKey = `filter|${collectionCountsCache.key}|${Object.keys(state.collections || {}).length}`;
    if (filterEl.dataset.optionsHtmlKey !== filterKey) {
      filterEl.innerHTML = html;
      filterEl.dataset.optionsHtmlKey = filterKey;
    }
    filterEl.value = (active === "all" || active === "unassigned" || active === "hidden" || state.collections?.[active]) ? active : "all";
    filterEl.title = filterEl.selectedOptions?.[0]?.textContent || "Collection filter";
    if (wasFocused) filterEl.focus();
  }
  const target = $("#collectionTarget");
  if (target) {
    const prev = target.value;
    const html = collectionOptionsHtml(prev, false);
    const targetKey = `target|${collectionCountsCache.key}|${Object.keys(state.collections || {}).length}`;
    if (target.dataset.optionsHtmlKey !== targetKey) {
      target.innerHTML = html;
      target.dataset.optionsHtmlKey = targetKey;
    }
    if (state.collections?.[prev]) target.value = prev;
    target.title = target.selectedOptions?.[0]?.textContent || "Choose collection";
  }
  updateCollectionButtonStates();
}
async function saveCollectionsState() {
  normalizeCollectionsState(true);
  await runtimeMessage({ type: "SET_COLLECTIONS", collections: state.collections, itemCollections: state.itemCollections });
}
function scheduleCollectionsStateSave() {
  clearTimeout(collectionSaveTimer);
  collectionSaveTimer = setTimeout(() => {
    saveCollectionsState().catch(() => {});
  }, 350);
}

async function createCollectionPrompt() {
  const name = (prompt("Collection name:") || "").trim();
  if (!name) return;
  normalizeCollectionsState();
  const id = `col_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const index = Object.keys(state.collections).length;
  const now = new Date().toISOString();
  state.collections[id] = { id, name: name.slice(0, 60), color: COLLECTION_COLORS[index % COLLECTION_COLORS.length], createdAt: now, updatedAt: now };
  markCollectionsDirty();
  state.settings.collectionFilter = id;
  await runtimeMessage({ type: "SAVE_SETTINGS", settings: { ...state.settings } });
  await saveCollectionsState();
  render();
}
async function renameActiveCollection() {
  const id = state.settings.collectionFilter || "all";
  const col = state.collections?.[id];
  if (!col) return;
  const name = (prompt("Rename collection:", col.name || "") || "").trim();
  if (!name) return;
  col.name = name.slice(0, 60);
  col.updatedAt = new Date().toISOString();
  markCollectionsDirty();
  await saveCollectionsState();
  render();
}
async function deleteActiveCollection() {
  const id = state.settings.collectionFilter || "all";
  const col = state.collections?.[id];
  if (!col) return;
  if (!confirm(`Delete collection "${col.name}"? Items will stay in the catalogue.`)) return;
  delete state.collections[id];
  state.settings.hiddenMainViewCollections = (Array.isArray(state.settings.hiddenMainViewCollections) ? state.settings.hiddenMainViewCollections : []).filter(x => x !== id);
  for (const itemId of Object.keys(state.itemCollections || {})) {
    state.itemCollections[itemId] = (state.itemCollections[itemId] || []).filter(x => x !== id);
    if (!state.itemCollections[itemId].length) delete state.itemCollections[itemId];
  }
  state.settings.collectionFilter = "all";
  markCollectionsDirty();
  await runtimeMessage({ type: "SAVE_SETTINGS", settings: { ...state.settings } });
  await saveCollectionsState();
  render();
}
async function setCollectionFilter(id) {
  state.settings.collectionFilter = id || "all";
  currentPage = 1;
  await runtimeMessage({ type: "SAVE_SETTINGS", settings: { ...state.settings } });
  render();
}
async function toggleActiveCollectionMainVisibility() {
  const id = state.settings.collectionFilter || "all";
  if (!state.collections?.[id]) return;
  const hidden = hiddenMainCollectionSet();
  if (hidden.has(id)) hidden.delete(id);
  else hidden.add(id);
  state.settings.hiddenMainViewCollections = Array.from(hidden);
  markCollectionsDirty();
  currentPage = 1;
  await runtimeMessage({ type: "SAVE_SETTINGS", settings: { ...state.settings } });
  render();
}
async function addSelectedToTargetCollection() {
  const id = $("#collectionTarget")?.value || "";
  if (!id || !state.collections?.[id] || !selectedIds.size) return;
  normalizeCollectionsState();
  for (const itemId of selectedIds) {
    if (!assetById(itemId)) continue;
    const ids = new Set(state.itemCollections[itemId] || []);
    ids.add(id);
    state.itemCollections[itemId] = Array.from(ids);
  }
  markCollectionsDirty();
  scheduleCollectionsStateSave();
  render();
}
async function removeSelectedFromTargetCollection() {
  const id = $("#collectionTarget")?.value || state.settings.collectionFilter || "";
  if (!id || !state.collections?.[id] || !selectedIds.size) return;
  normalizeCollectionsState();
  for (const itemId of selectedIds) {
    const ids = (state.itemCollections[itemId] || []).filter(x => x !== id);
    if (ids.length) state.itemCollections[itemId] = ids;
    else delete state.itemCollections[itemId];
  }
  markCollectionsDirty();
  scheduleCollectionsStateSave();
  render();
}
function contextBatchIdsForAsset(asset) {
  if (!asset?.id) return [];
  if (selectedIds.size > 1 && selectedIds.has(asset.id)) {
    return Array.from(selectedIds).filter(id => !!assetById(id));
  }
  return [asset.id];
}
async function addItemsToCollection(itemIds, collectionId) {
  if (!collectionId || !state.collections?.[collectionId] || !itemIds?.length) return;
  normalizeCollectionsState();
  for (const itemId of itemIds) {
    if (!assetById(itemId)) continue;
    const ids = new Set(state.itemCollections[itemId] || []);
    ids.add(collectionId);
    state.itemCollections[itemId] = Array.from(ids);
  }
  state.collections[collectionId].updatedAt = new Date().toISOString();
  markCollectionsDirty();
  scheduleCollectionsStateSave();
  render();
}
async function removeItemsFromCollection(itemIds, collectionId) {
  if (!collectionId || !state.collections?.[collectionId] || !itemIds?.length) return;
  normalizeCollectionsState();
  for (const itemId of itemIds) {
    const ids = (state.itemCollections[itemId] || []).filter(x => x !== collectionId);
    if (ids.length) state.itemCollections[itemId] = ids;
    else delete state.itemCollections[itemId];
  }
  state.collections[collectionId].updatedAt = new Date().toISOString();
  markCollectionsDirty();
  scheduleCollectionsStateSave();
  render();
}
function lightboxCollectionsHtml(asset) {
  const ids = collectionIdsForItem(asset.id);
  if (!ids.length) return `<span class="collection-chip muted">No collections</span>`;
  return ids.map(id => {
    const c = state.collections?.[id];
    return `<span class="collection-chip" style="--collection-color:${safeAttr(collectionColor(id))}">${safeText(c?.name || "Collection")}</span>`;
  }).join("") + `<button id="lightboxAddCollection" type="button" class="collection-chip add">+</button>`;
}

function getPageCount() {
  const size = Number(state.settings.pageSize || 100);
  return Math.max(1, Math.ceil(filteredList.length / size));
}
function applyViewSlice() {
  if ((state.settings.pageMode || "infinite") !== "pages") return filteredList;
  const pages = getPageCount();
  currentPage = Math.min(Math.max(1, currentPage), pages);
  const size = Number(state.settings.pageSize || 100);
  return filteredList.slice((currentPage - 1) * size, currentPage * size);
}
function currentStats() {
  const items = allAssets();
  const total = items.length;
  const downloaded = items.filter(a => statusFor(a) === "downloaded").length;
  const failed = items.filter(a => statusFor(a) === "failed").length;
  const missing = items.filter(a => statusFor(a) !== "downloaded").length;
  return { total, downloaded, failed, missing, filtered: filteredList.length, visible: currentList.length, selected: selectedAssets().length };
}
function renderStats() {
  const st = currentStats();
  const box = $("#statsMetrics") || $("#stats");
  if (box) {
    box.innerHTML = `
      <span>Total: <b>${st.total}</b></span>
      <span>Missing: <b>${st.missing}</b></span>
      <span>Downloaded: <b>${st.downloaded}</b></span>
      <span>Filtered: <b>${st.filtered}</b></span>
      <span>Visible: <b>${st.visible}</b></span>
    `;
  }
  updateMiniStats(st);
}
function updateMiniStats(st = currentStats()) {
  const set = (id, text) => { const el = $("#" + id); if (el) el.textContent = text; };
  set("miniSelected", `Selected: ${st.selected}`);
  set("miniTotal", `Total: ${st.total}`);
  set("miniMissing", `Missing: ${st.missing}`);
  set("miniDownloaded", `Downloaded: ${st.downloaded}`);
  const scaleLabel = $("#miniGridLabel");
  if (scaleLabel) scaleLabel.textContent = (state.settings.viewMode || "grid") === "list" ? "List" : `${nearestGridScale(state.settings.gridScale || DEFAULT_SETTINGS.gridScale)}%`;
}
function setControlDisabled(labelSelector, controlSelector, disabled) {
  const label = $(labelSelector);
  const control = $(controlSelector);
  if (label) label.classList.toggle("control-disabled", !!disabled);
  if (control) control.disabled = !!disabled;
}
function updateGridScaleControls(value) {
  const mode = state.settings.viewMode || "grid";
  const scale = nearestGridScale(value);
  const label = $("#gridScaleLabel");
  if (label) label.textContent = mode === "list" ? "List" : `${scale}%`;
  const minus = $("#gridScaleMinus");
  const plus = $("#gridScalePlus");
  if (minus) minus.disabled = false;
  if (plus) plus.disabled = false;
  if (minus && mode === "list") minus.disabled = true;
  return scale;
}

function persistSettingsFast() {
  suppressControlRefreshUntil = Date.now() + 1200;
  clearTimeout(fastSettingsSaveTimer);
  fastSettingsSaveTimer = setTimeout(() => {
    runtimeMessage({ type: "SAVE_SETTINGS", settings: { ...state.settings } }).catch(() => {});
  }, 260);
}

function applyGridScaleDom() {
  const grid = $("#grid");
  const mode = state.settings.viewMode || "grid";
  const scale = updateGridScaleControls(state.settings.gridScale || DEFAULT_SETTINGS.gridScale);
  const vm = $("#viewMode");
  if (vm) vm.value = mode;
  if (grid) {
    grid.className = `grid view-${mode} size-medium scale-${scale} is-scaling`;
    grid.style.setProperty("--grid-scale", String(scale / 100));
    clearTimeout(gridScaleUiTimer);
    gridScaleUiTimer = setTimeout(() => grid.classList.remove("is-scaling"), 140);
  }
  const gridScaleBox = $("#gridScaleControls");
  if (gridScaleBox) gridScaleBox.classList.toggle("list-mode", mode === "list");
  updateMiniStats();
}


function renderViewControls() {
  const src = activeSource();
  $("#sourceChatgpt")?.classList.toggle("active", src === "chatgpt");
  $("#sourceGrok")?.classList.toggle("active", src === "grok");
  $("#sourceLocal")?.classList.toggle("active", src === "local");
  $$(".local-only").forEach(el => el.classList.toggle("hidden", src !== "local"));
  $$(".source-network-only").forEach(el => el.classList.toggle("hidden", src === "local"));
  $$(".grok-only").forEach(el => el.classList.toggle("hidden", src !== "grok"));
  $$(".grok-action").forEach(el => el.classList.toggle("hidden", src !== "grok"));
  const chatOpt = $("#folderStructureChatOption");
  if (chatOpt) chatOpt.textContent = src === "grok" ? "By board" : "By chat";
  const openBtn = $("#openImages");
  if (openBtn) openBtn.textContent = src === "local" ? "Choose local folder" : (src === "grok" ? "Open Grok" : "Open /images");
  const syncBtn = $("#sync");
  if (syncBtn) syncBtn.classList.toggle("hidden", src === "grok" || src === "local");
  renderLocalRootSelect();
  renderLocalDirectoryPicker();
  renderLocalFolderBar();
  renderStoryboardControls();
  const modeEl = $("#localViewMode"); if (modeEl) modeEl.value = state.settings.localViewMode || "folder";
  const maxLocalEl = $("#localMaxFiles"); if (maxLocalEl) maxLocalEl.value = state.settings.localMaxFiles || DEFAULT_SETTINGS.localMaxFiles;
  const thumbCacheEl = $("#thumbnailCache"); if (thumbCacheEl) thumbCacheEl.checked = state.settings.thumbnailCache !== false;
  const thumbAutoEl = $("#thumbnailCacheAutoBuild"); if (thumbAutoEl) thumbAutoEl.checked = state.settings.thumbnailCacheAutoBuild !== false;
  const thumbFullEl = $("#thumbnailCacheFullGrid"); if (thumbFullEl) thumbFullEl.checked = !!state.settings.thumbnailCacheFullGrid;
  const thumbQualityEl = $("#thumbnailCacheQuality"); if (thumbQualityEl) thumbQualityEl.value = state.settings.thumbnailCacheQuality || "medium";
  const localLabel = $("#localFolderStatus");
  if (localLabel) {
    const root = state.settings.localFolderLabel || "";
    const path = normalizeLocalPath(state.settings.localFolderPath || "");
    const mode = state.settings.localViewMode === "all" ? "All Media" : "Folder View";
    const label = root ? `${root}${path ? ` / ${path}` : ""} · ${Object.keys(localCatalog || {}).length} files${localFilesTruncated ? "+" : ""} · ${mode} · max ${localScanLimit()}` : "No local folder selected";
    localLabel.textContent = label;
    localLabel.title = label;
  }
  const videoThumbsLabel = $("#grokVideoThumbsLabel");
  if (videoThumbsLabel) videoThumbsLabel.classList.toggle("hidden", src !== "grok" || (state.settings.grokMode || "imagen") === "imagen");
  const grid = $("#grid");
  const mode = state.settings.viewMode || "grid";
  const scale = updateGridScaleControls(state.settings.gridScale || DEFAULT_SETTINGS.gridScale);
  grid.className = `grid view-${mode} size-medium scale-${scale}`;
  grid.style.setProperty("--grid-scale", String(scale / 100));
  const pages = getPageCount();
  const paged = (state.settings.pageMode || "infinite") === "pages";
  for (const box of [$("#pageControls"), $("#pageControlsBottom")]) {
    if (box) {
      box.hidden = false;
      box.classList.toggle("inactive", !paged);
    }
  }
  for (const info of [$("#pageInfo"), $("#pageInfoBottom")]) {
    if (info) info.textContent = paged ? `Page ${currentPage} / ${pages}` : "Infinite";
  }
  for (const id of ["firstPage", "prevPage", "firstPageBottom", "prevPageBottom"]) {
    const el = $("#" + id); if (el) el.disabled = !paged || currentPage <= 1;
  }
  for (const id of ["nextPage", "lastPage", "nextPageBottom", "lastPageBottom"]) {
    const el = $("#" + id); if (el) el.disabled = !paged || currentPage >= pages;
  }
  setControlDisabled("#pageSizeLabel", "#pageSize", !paged);
  const gridScaleBox = $("#gridScaleControls");
  if (gridScaleBox) gridScaleBox.classList.toggle("list-mode", mode === "list");
  updateGridScaleControls(scale);
  updateMiniStats();
  updateCancelButton();
}
function assetCardHtml(a) {
  const st = statusFor(a);
  const isSelected = selectedIds.has(a.id);
  const meta = state.statuses[a.id] || {};
  const fullUrl = mediaFullUrl(a);
  const previewUrl = mediaPreviewUrl(a);
  const gridUrl = initialGridImageUrl(a);
  const gridFallbackUrl = fullUrl && fullUrl !== gridUrl ? fullUrl : (previewUrl && previewUrl !== gridUrl ? previewUrl : "");
  const promptText = a.prompt || a.filename || a.url || "media";
  const isVideo = (a.kind || "image") === "video";
  // Cards should stay lightweight: video thumbnails are thumbnails/placeholders only.
  // Actual playback happens in lightbox/compare, which avoids grid lag and click traps.
  const videoThumb = previewUrl && !looksLikeVideoUrl(previewUrl) ? previewUrl : "";
  const mediaHtml = isVideo
    ? (videoThumb
      ? `<img class="video-thumb-img" src="${safeAttr(videoThumb)}" data-thumb-cache="1" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
      : `<div class="video-thumb-placeholder"><div class="video-icon">▶</div><div>Video</div></div>`)
    : (gridUrl
      ? `<img src="${safeAttr(gridUrl)}" data-fallback="${safeAttr(gridFallbackUrl)}" data-thumb-cache="1" loading="lazy" decoding="async" referrerpolicy="no-referrer" alt="" />`
      : `<img class="image-thumb-pending" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='480' height='320' viewBox='0 0 480 320'%3E%3Crect width='480' height='320' fill='%23020b1f'/%3E%3Ctext x='240' y='166' text-anchor='middle' font-family='Arial' font-size='38' font-weight='700' fill='%2394a3b8'%3EIMG%3C/text%3E%3C/svg%3E" data-thumb-cache="1" loading="lazy" decoding="async" alt="" />`);
  const sourceText = a.source === "local" ? "local" : (a.source === "grok" ? (a.grokMode === "boards" ? "boards" : "imagen") : "gpt");
  const sourceIcon = a.source === "local" ? "⌂" : (a.source === "grok" ? (a.grokMode === "boards" ? "▦" : "✦") : "G");
  const statusIcon = st === "downloaded" ? "✔" : st === "failed" ? "×" : "⬇";
  const imageIcon = `<svg class="mini-svg icon-image" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="8" cy="10" r="2"/><path d="M5.5 17l4.4-4.6 3.1 3.1 2.5-2.8L20 17"/></svg>`;
  const videoIcon = `<svg class="mini-svg icon-video" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="6" width="12.5" height="12" rx="2.4"/><path d="M16.5 10.2 21 7.8v8.4l-4.5-2.4z"/><circle cx="7.3" cy="9" r="1.1"/><circle cx="12.2" cy="9" r="1.1"/></svg>`;
  const kindIcon = isVideo ? videoIcon : imageIcon;
  const badge = (type, text, icon, extra = "") => {
    const iconHtml = String(icon || "").startsWith("<svg") ? icon : safeText(icon);
    return `<span class="badge badge-${type} ${safeAttr(extra)}" title="${safeAttr(text)}"><span class="badge-icon" aria-hidden="true">${iconHtml}</span><span class="badge-text">${safeText(text)}</span></span>`;
  };
  const statusOverlay = `<span class="status-overlay status-${safeAttr(st)}" title="${safeAttr(st)}">${safeText(statusIcon)}</span>`;
  const selectedOverlay = `<button class="select-toggle" type="button" data-action="toggle-select" data-id="${safeAttr(a.id)}" aria-label="${isSelected ? "Unselect" : "Select"} media" title="${isSelected ? "Unselect" : "Select"}"><span>${isSelected ? "✓" : ""}</span></button>`;
  const collectionOverlay = collectionIndicatorHtml(a);
  const storyboardOverlay = storyboardPanelNumberHtml(a);
  const collectionFilter = state.settings.collectionFilter || "all";
  const collectionAccentStyle = state.collections?.[collectionFilter] && collectionIdsForItem(a.id).includes(collectionFilter) ? ` style="--active-collection-color:${safeAttr(collectionColor(collectionFilter))}"` : "";
  return `<article class="card ${safeAttr(st)} ${isSelected ? "selected" : ""} ${collectionAccentStyle ? "collection-filter-hit" : ""}"${collectionAccentStyle} data-id="${safeAttr(a.id)}">
    <div class="preview" data-action="lightbox" data-id="${safeAttr(a.id)}" data-kind="${safeAttr(a.kind || 'image')}">${mediaHtml}${statusOverlay}${selectedOverlay}${collectionOverlay}${storyboardOverlay}</div>
    <div class="body">
      <div class="row">
        ${badge("status", st, statusIcon, st)}
        ${badge("kind", a.kind || "image", kindIcon)}
        ${badge("source", sourceText, sourceIcon, "source-mode")}
        ${badge("ext", a.ext || "img", (a.ext || "img").slice(0, 3))}
        ${badge("date", dateOnly(a.createdAt), "◷")}
        ${ratingBadgeHtml(a)}
      </div>
      <div class="meta prompt" title="${safeAttr(promptText)}">${safeText(promptText)}</div>
      <div class="actions">
        <button data-action="download-one" data-id="${safeAttr(a.id)}">Download</button>
        <button data-action="copy" data-id="${safeAttr(a.id)}">Copy URL</button>
      </div>
    </div>
  </article>`;
}

function renderGrid() {
  const grid = $("#grid");
  if (!currentList.length) {
    const total = allAssets().length;
    let message = "";
    if (!total) {
      message = activeSource() === "local"
        ? `No local media yet.<br>Click <b>Choose root</b> and select a media folder such as <b>ComfyUI/output</b>.`
        : `No catalogued media yet for the current source.<br>Click <b>Connect</b>. The extension reads the signed-in source page and its page requests, then prepares bulk ZIP downloads instead of opening separate Save As dialogs.`;
    } else if (filter === "failed") {
      message = `No failed media. There are no rejected or broken files in the current catalogue.`;
    } else if (filter === "downloaded") {
      message = `No downloaded media in the current filter.`;
    } else if (filter === "missing") {
      message = `No missing media — everything in the current catalogue is marked as downloaded.`;
    } else if (query.trim()) {
      message = `No results for the current search.`;
    } else {
      const collectionFilter = state.settings.collectionFilter || "all";
      if (collectionFilter === "unassigned") {
        message = `No unassigned media — all visible items already belong to a collection.`;
      } else if (collectionFilter === "hidden") {
        message = `No media in groups hidden from Main View.`;
      } else if (state.collections?.[collectionFilter]) {
        message = `No media in the selected collection: <b>${safeText(state.collections[collectionFilter].name || "Collection")}</b>.`;
      } else {
        message = `No results for the current filter.`;
      }
    }
    grid.innerHTML = `<div class="empty">${message}</div>`;
    return;
  }
  grid.innerHTML = currentList.map(assetCardHtml).join("");
  $$(".preview img[data-fallback]", grid).forEach(img => {
    img.onerror = () => {
      const fb = img.getAttribute("data-fallback");
      if (fb && img.dataset.fallbackTried !== "1" && img.src !== fb) {
        img.dataset.fallbackTried = "1";
        img.src = fb;
        return;
      }
      img.onerror = null;
      img.classList.add("image-thumb-broken");
      img.removeAttribute("data-thumb-cache");
      img.src = GRID_IMAGE_FALLBACK_PLACEHOLDER;
    };
  });
  hydrateVisibleThumbnails();
}

function cssEscapeValue(value) {
  const s = String(value ?? "");
  if (window.CSS && typeof CSS.escape === "function") return CSS.escape(s);
  return s.replace(/[\"\\]/g, "\\$&");
}
function cardNodeForId(id) {
  return $("#grid")?.querySelector(`.card[data-id="${cssEscapeValue(id)}"]`) || null;
}
function getCardEl(id) {
  return cardNodeForId(id);
}
function syncCardSelectionDom(id) {
  const card = cardNodeForId(id);
  if (!card) return;
  const isSelected = selectedIds.has(id);
  card.classList.toggle("selected", isSelected);
  const btn = card.querySelector(".select-toggle");
  if (btn) {
    btn.setAttribute("aria-label", `${isSelected ? "Unselect" : "Select"} media`);
    btn.title = isSelected ? "Unselect" : "Select";
    const span = btn.querySelector("span");
    if (span) span.textContent = isSelected ? "✓" : "";
  }
}
function syncCardStatusDom(id) {
  const card = cardNodeForId(id);
  const asset = assetById(id);
  if (!card || !asset) return;
  const st = statusFor(asset);
  card.classList.remove("downloaded", "missing", "failed");
  card.classList.add(st);
  const overlay = card.querySelector(".status-overlay");
  if (overlay) {
    overlay.className = `status-overlay status-${st}`;
    overlay.title = st;
    overlay.textContent = st === "downloaded" ? "✔" : st === "failed" ? "×" : "⬇";
  }
  const badge = card.querySelector(".badge-status");
  if (badge) {
    badge.className = `badge badge-status ${st}`;
    badge.title = st;
    const text = badge.querySelector(".badge-text");
    if (text) text.textContent = st;
    const icon = badge.querySelector(".badge-icon");
    if (icon) icon.textContent = st === "downloaded" ? "✔" : st === "failed" ? "×" : "⬇";
  }
}
function syncSelectionDom() {
  for (const a of currentList) syncCardSelectionDom(a.id);
}
function sameIdArray(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function currentSelectionSnapshot() {
  return Array.from(selectedIds).sort();
}
function pushSelectionUndo() {
  const snap = currentSelectionSnapshot();
  const last = selectionUndoStack[selectionUndoStack.length - 1];
  if (sameIdArray(last, snap)) return;
  selectionUndoStack.push(snap);
  if (selectionUndoStack.length > MAX_SELECTION_UNDO) selectionUndoStack.shift();
}
function restoreSelectionUndo() {
  const snap = selectionUndoStack.pop();
  if (!snap) return false;
  const before = new Set(selectedIds);
  selectedIds = new Set(snap.filter(id => assetById(id)));
  const changed = new Set([...before, ...selectedIds]);
  for (const id of changed) syncCardSelectionDom(id);
  updateSelectionActionButtons();
  return true;
}
function clearSelectionWithUndo() {
  if (!selectedIds.size) return;
  pushSelectionUndo();
  selectedIds.clear();
  syncSelectionDom();
  updateSelectionActionButtons();
}
function toggleSelectionId(id, { undo = true } = {}) {
  if (!id || !assetById(id)) return;
  if (undo) pushSelectionUndo();
  if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
  syncCardSelectionDom(id);
  updateSelectionActionButtons();
}
function selectVisibleWithUndo() {
  if (!currentList.length) return;
  pushSelectionUndo();
  for (const a of currentList) selectedIds.add(a.id);
  syncSelectionDom();
  updateSelectionActionButtons();
}
function createCardNode(asset) {
  const tpl = document.createElement("template");
  tpl.innerHTML = assetCardHtml(asset).trim();
  return tpl.content.firstElementChild;
}
function patchGridForCurrentList({ removeStale = false } = {}) {
  const grid = $("#grid");
  if (!grid) return { added: 0, updated: 0, removed: 0 };
  if (!currentList.length || grid.querySelector(".empty")) {
    renderGrid();
    return { added: currentList.length, updated: 0, removed: 0 };
  }
  const currentIds = new Set(currentList.map(a => a.id));
  const existing = new Map($$(".card[data-id]", grid).map(el => [el.dataset.id, el]));
  let added = 0, updated = 0, removed = 0;
  currentList.forEach((asset, index) => {
    let node = existing.get(asset.id);
    if (!node) {
      node = createCardNode(asset);
      grid.insertBefore(node, grid.children[index] || null);
      added += 1;
    } else {
      syncCardSelectionDom(asset.id);
      syncCardStatusDom(asset.id);
      updated += 1;
    }
  });
  if (removeStale) {
    for (const node of $$(".card[data-id]", grid)) {
      if (!currentIds.has(node.dataset.id)) { node.remove(); removed += 1; }
    }
  }
  hydrateVisibleThumbnails();
  return { added, updated, removed };
}

function renderEvents() {
  const events = (state.events || []).slice(-40).reverse();
  $("#events").innerHTML = events.map(e => {
    const msg = e.message || e.api || e.href || e.type || "event";
    const extra = e.added != null ? ` added ${e.added}, updated ${e.updated}` : e.assets != null ? ` assets ${e.assets}` : "";
    return `<div class="event-line">${safeText((e.at || "").slice(11, 19))} · ${safeText(e.type || "event")} · ${safeText(msg)}${safeText(extra)}</div>`;
  }).join("");
}
function scheduleActionButtonUpdate() {
  if (actionButtonsRaf) return;
  actionButtonsRaf = requestAnimationFrame(() => {
    actionButtonsRaf = 0;
    updateActionButtons();
  });
}
function updateSelectionActionButtons() {
  const selectedCount = selectedIds.size;
  const selectionCount = $("#selectionCount");
  if (selectionCount) {
    const visibleSelected = selectedVisibleCount();
    selectionCount.textContent = selectedCount ? `Selected: ${selectedCount}${visibleSelected !== selectedCount ? ` (${visibleSelected} visible)` : ""}` : "Selected: 0";
    selectionCount.classList.toggle("has-selection", selectedCount > 0);
  }
  const localMode = activeSource() === "local";
  for (const id of ["clearSelection", "miniClearSelection"]) { const el = $("#" + id); if (el) el.disabled = busy || selectedCount <= 0; }
  for (const id of ["downloadSelectedZip", "miniDownloadSelected"]) { const el = $("#" + id); if (el) el.disabled = busy || selectedCount <= 0 || localMode; }
  const canCompare = selectedCount >= 2;
  for (const id of ["compareSelected", "miniCompareSelected"]) { const el = $("#" + id); if (el) el.disabled = busy || !canCompare; }
  updateCollectionButtonStates();
  updateStoryboardButtonStates();
  updateMiniStats({ ...currentStats(), selected: selectedCount });
}
function updateActionButtons() {
  const syncBtn = $("#sync");
  const connectImagenBtn = $("#connectImagen");
  const connectBoardsBtn = $("#connectBoards");
  const downloadBtn = $("#downloadZip");
  const downloadAllBtn = $("#downloadAllZip");
  const downloadSelectedBtn = $("#downloadSelectedZip");
  const selectVisibleBtn = $("#selectVisible");
  const clearSelectionBtn = $("#clearSelection");
  const miniSelectVisibleBtn = $("#miniSelectVisible");
  const miniClearSelectionBtn = $("#miniClearSelection");
  const miniDownloadMissingBtn = $("#miniDownloadMissing");
  const miniDownloadAllBtn = $("#miniDownloadAll");
  const miniDownloadSelectedBtn = $("#miniDownloadSelected");
  const compareSelectedBtn = $("#compareSelected");
  const miniCompareSelectedBtn = $("#miniCompareSelected");
  const selectionCount = $("#selectionCount");
  const validateBtn = $("#validateVisible");
  const resetFiltersBtn = $("#resetFilters");
  const items = allAssets();
  const missing = items.filter(a => statusFor(a) !== "downloaded").length;
  const connected = items.length > 0;
  const selected = selectedAssets();
  const selectedCount = selected.length;
  if (syncBtn) {
    if (connectingActive) {
      syncBtn.classList.add("connecting");
      syncBtn.disabled = true;
      syncBtn.title = "Connecting and syncing current source.";
    } else {
      syncBtn.classList.remove("connecting");
      syncBtn.textContent = connected ? "Connected" : "Connect";
      syncBtn.classList.toggle("connected", connected);
      syncBtn.disabled = busy;
      syncBtn.title = connected ? "Connected. Click again to refresh/sync new media." : "Connect and sync current source.";
    }
  }
  const grokItems = Object.values(state.catalog || {}).filter(a => (a.source || "chatgpt") === "grok");
  const imagenConnected = grokItems.some(a => (a.grokMode || "imagen") === "imagen");
  const boardsConnected = grokItems.some(a => (a.grokMode || "imagen") === "boards");
  const configureGrokConnectButton = (btn, connectedForMode, baseLabel) => {
    if (!btn) return;
    if (!connectingActive || btn.id !== connectingButtonId) {
      btn.textContent = connectedForMode ? `Connected ${baseLabel.replace("Connect ", "")}` : baseLabel;
      btn.classList.toggle("connected", connectedForMode);
      btn.classList.remove("connecting");
    }
    btn.disabled = busy || activeSource() !== "grok";
    btn.title = connectedForMode ? `${baseLabel.replace("Connect ", "")} catalogue loaded. Click again to refresh/sync.` : `${baseLabel} catalogue.`;
  };
  configureGrokConnectButton(connectImagenBtn, imagenConnected, "Connect Imagen");
  configureGrokConnectButton(connectBoardsBtn, boardsConnected, "Connect Boards");
  const localMode = activeSource() === "local";
  if (downloadBtn) {
    downloadBtn.classList.toggle("success", missing > 0 && !localMode);
    downloadBtn.disabled = busy || missing <= 0 || localMode;
    downloadBtn.title = localMode ? "Local Files are already on disk." : (missing > 0 ? `Download ${missing} missing media as ZIP part(s).` : "No missing media to download.");
  }
  if (downloadAllBtn) {
    downloadAllBtn.disabled = busy || items.length <= 0 || localMode;
    downloadAllBtn.title = items.length > 0 ? `Download all ${items.length} visible-source media as ZIP part(s), ignoring downloaded status.` : "No media to download.";
  }
  if (selectionCount) {
    const visibleSelected = selectedVisibleCount();
    selectionCount.textContent = selectedCount ? `Selected: ${selectedCount}${visibleSelected !== selectedCount ? ` (${visibleSelected} visible)` : ""}` : "Selected: 0";
    selectionCount.classList.toggle("has-selection", selectedCount > 0);
  }
  if (selectVisibleBtn) {
    selectVisibleBtn.disabled = busy || !currentList.length;
    selectVisibleBtn.title = currentList.length ? `Select ${currentList.length} visible cards.` : "No visible cards to select.";
  }
  if (miniSelectVisibleBtn) miniSelectVisibleBtn.disabled = busy || !currentList.length;
  if (clearSelectionBtn) {
    clearSelectionBtn.disabled = busy || selectedCount <= 0;
    clearSelectionBtn.title = selectedCount ? `Clear ${selectedCount} selected cards.` : "Nothing selected.";
  }
  if (miniClearSelectionBtn) miniClearSelectionBtn.disabled = busy || selectedCount <= 0;
  if (downloadSelectedBtn) {
    downloadSelectedBtn.disabled = busy || selectedCount <= 0 || localMode;
    downloadSelectedBtn.title = selectedCount ? `Download ${selectedCount} selected media as ZIP part(s).` : "Select media first.";
  }
  if (miniDownloadMissingBtn) miniDownloadMissingBtn.disabled = busy || missing <= 0 || localMode;
  if (miniDownloadAllBtn) miniDownloadAllBtn.disabled = busy || items.length <= 0 || localMode;
  if (miniDownloadSelectedBtn) miniDownloadSelectedBtn.disabled = busy || selectedCount <= 0 || localMode;
  const canCompare = selectedCount >= 2;
  const compareTitle = selectedCount < 2
    ? "Select at least 2 media items to compare."
    : selectedCount > 50
      ? `Compare first 50 of ${selectedCount} selected media.`
      : `Compare ${selectedCount} selected media.`;
  for (const btn of [compareSelectedBtn, miniCompareSelectedBtn]) {
    if (!btn) continue;
    btn.disabled = busy || !canCompare;
    btn.title = compareTitle;
  }
  if (validateBtn) validateBtn.disabled = busy || !currentList.length;
  if (resetFiltersBtn) {
    const hasViewFilter = filter !== "all" || !!query.trim() || (state.settings.collectionFilter || "all") !== "all" || sortMode !== "newest";
    resetFiltersBtn.disabled = busy || !hasViewFilter;
    resetFiltersBtn.classList.toggle("inactive", !hasViewFilter);
  }
  updateCollectionButtonStates();
  updateStoryboardButtonStates();
  updateMiniStats({ total: items.length, missing, downloaded: items.length - missing, failed: items.filter(a => statusFor(a) === "failed").length, filtered: filteredList.length, visible: currentList.length, selected: selectedCount });
}
function renderShellOnly() {
  // Keep hover/selection stable: patch only changed/new cards on passive background refresh.
  pruneSelection();
  filteredList = filteredAssetsFull();
  currentList = applyViewSlice();
  renderViewControls();
  renderCollectionControls();
  renderStoryboardControls();
  renderCanvasControls();
  renderStats();
  renderEvents();
  patchGridForCurrentList({ removeStale: false });
  updateActionButtons();
  updateScrollMiniBarVisibility();
  $$('[data-filter]').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
}

function render() {
  pruneSelection();
  filteredList = filteredAssetsFull();
  currentList = applyViewSlice();
  renderViewControls();
  renderCollectionControls();
  renderStoryboardControls();
  renderCanvasControls();
  renderStats();
  renderGrid();
  renderComicCanvas();
  renderEvents();
  updateActionButtons();
  $$('[data-filter]').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
}

// ZIP writer: STORE only, UTF-8 names, ZIP32. Split into multiple ZIPs to avoid ZIP32/blob limits.
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function dosDateTime(date = new Date()) { const year = Math.max(1980, date.getFullYear()); return { dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2), dosDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate() }; }
function u16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); return b; }
function u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); return b; }
function concatParts(parts) { const total = parts.reduce((n, p) => n + p.length, 0); const out = new Uint8Array(total); let offset = 0; for (const p of parts) { out.set(p, offset); offset += p.length; } return out; }
function makeZip(entries) {
  const enc = new TextEncoder();
  const localParts = [], centralParts = [];
  let offset = 0;
  const { dosTime, dosDate } = dosDateTime(new Date());
  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    const data = new Uint8Array(entry.buffer);
    if (data.length >= 0xffffffff || offset >= 0xffffffff) throw new Error("ZIP32 size limit exceeded");
    const crc = crc32(data);
    const local = concatParts([u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(dosTime), u16(dosDate), u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), nameBytes]);
    localParts.push(local, data);
    const central = concatParts([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(dosTime), u16(dosDate), u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes]);
    centralParts.push(central);
    offset += local.length + data.length;
  }
  const centralSize = centralParts.reduce((n, p) => n + p.length, 0);
  const end = concatParts([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(centralSize), u32(offset), u16(0)]);
  return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
}
function uniqueFilename(base, used) {
  const clean = sanitizePath(base).replace(/\.(html?|json|svg)$/i, ".bin");
  if (!used.has(clean)) { used.add(clean); return clean; }
  const idx = clean.lastIndexOf(".");
  const stem = idx > 0 ? clean.slice(0, idx) : clean;
  const ext = idx > 0 ? clean.slice(idx) : "";
  let n = 2;
  while (used.has(`${stem}_${n}${ext}`)) n++;
  const out = `${stem}_${n}${ext}`; used.add(out); return out;
}
function chatFolderName(asset) {
  const title = asset.chatTitle || asset.conversationTitle || asset.chatName || "";
  if (title && String(title).trim()) return sanitizeSegment(title, "Chat").replace(/\s+/g, "_").slice(0, 80);
  const ids = Array.from(new Set(allAssets().map(a => a.conversationId || a.contextId || "").filter(Boolean))).sort();
  const key = asset.conversationId || asset.contextId || "unknown";
  const index = Math.max(1, ids.indexOf(key) + 1);
  const short = key && key !== "unknown" ? `_${String(key).slice(0, 8)}` : "";
  return `Chat_${String(index).padStart(3, "0")}${short}`;
}

function assetFilename(asset, ext) {
  const settings = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
  const day = dateOnly(asset.createdAt);
  const title = sanitizeSegment(asset.prompt || "media", asset.source === "grok" ? "grok_media" : "chatgpt_image").replace(/\s+/g, "_").slice(0, 80);
  const filename = `${day}_${asset.id}_${title}.${ext || asset.ext || "png"}`;
  if (asset.source === "grok" && asset.fixedFolder) return `${sanitizePath(asset.fixedFolder)}/${filename}`;
  const baseFolder = sanitizePath(settings.folder || DEFAULT_SETTINGS.folder);
  if (settings.folderStructure === "flat") return `${baseFolder}/${filename}`;
  if (settings.folderStructure === "chat") return `${baseFolder}/${chatFolderName(asset)}/${filename}`;
  return `${baseFolder}/${day}/${filename}`;
}

function basename(path) {
  return String(path || "download.zip").split(/[\\/]+/).filter(Boolean).pop() || "download.zip";
}
async function chooseZipDirectoryIfNeeded() {
  if (state.settings.chooseFolderOnce === false) return null;
  if (!("showDirectoryPicker" in window)) {
    showProgress("Folder picker unavailable", 0, 1, "Direct folder access is unavailable here; falling back to browser downloads.");
    return null;
  }
  try {
    if (!zipDirectoryHandle) zipDirectoryHandle = await idbGetDirHandle();
    if (zipDirectoryHandle && await hasDirPermission(zipDirectoryHandle)) return zipDirectoryHandle;
    showProgress("Choose output folder", 0, 1, "Pick the folder once. Single files and ZIP parts will be written there directly without more Save As dialogs.");
    return await selectZipDirectory();
  } catch (e) {
    if (e && (e.name === "AbortError" || /abort|cancel/i.test(e.message || ""))) throw new Error("cancelled");
    throw e;
  }
}
async function getReusableOutputDirectory() {
  if (!("showDirectoryPicker" in window)) return null;
  try {
    if (!zipDirectoryHandle) zipDirectoryHandle = await idbGetDirHandle();
    if (zipDirectoryHandle && await hasDirPermission(zipDirectoryHandle)) return zipDirectoryHandle;
  } catch (_) {}
  return null;
}
async function writeBlobToDirectory(blob, filename, dirHandle) {
  if (!dirHandle) return null;
  if (cancelRequested) throw new Error("cancelled");
  const fileHandle = await dirHandle.getFileHandle(basename(filename), { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
  return { ok: true, filename: basename(filename), mode: "file-system-access" };
}
async function saveBlobWithFilePicker(blob, filename, pickerId = "media-download") {
  if (cancelRequested) throw new Error("cancelled");
  const suggestedName = sanitizeSegment(basename(filename), "download");
  if (!("showSaveFilePicker" in window)) return await downloadBlob(blob, suggestedName, true);
  try {
    const handle = await window.showSaveFilePicker({
      id: String(pickerId || "media-download").slice(0, 32),
      suggestedName,
      excludeAcceptAllOption: false
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return { ok: true, filename: suggestedName, mode: "file-save-picker" };
  } catch (e) {
    if (e && (e.name === "AbortError" || /abort|cancel/i.test(e.message || ""))) throw new Error("cancelled");
    if (e && (e.name === "NotAllowedError" || /user gesture|user activation|showSaveFilePicker/i.test(e.message || ""))) {
      return await downloadBlob(blob, suggestedName, true);
    }
    throw e;
  }
}
async function saveZipBlob(blob, filename, dirHandle, saveAs = false, pickerId = "zip-download") {
  if (dirHandle) return await writeBlobToDirectory(blob, filename, dirHandle);
  // v2.32.59: showSaveFilePicker requires a live user activation. ZIP parts and
  // validated single downloads are created after async fetch/build work, so Chrome
  // often rejects the picker with "Must be handling a user gesture". Use the
  // downloads API Save As dialog for these late save prompts; it is designed for
  // extension downloads and does not lose the gesture after async work.
  if (saveAs) return await downloadBlob(blob, filename, true);
  return await downloadBlob(blob, filename, false);
}
async function downloadBlob(blob, filename, saveAs = false) {
  if (cancelRequested) throw new Error("cancelled");
  const url = URL.createObjectURL(blob);
  const suggestedName = saveAs ? sanitizeSegment(basename(filename), "download") : sanitizePath(filename);
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url, filename: suggestedName, saveAs: !!saveAs, conflictAction: "uniquify" }, (downloadId) => {
      if (chrome.runtime.lastError || !downloadId) { URL.revokeObjectURL(url); reject(new Error(chrome.runtime.lastError?.message || "download failed")); return; }
      const listener = (delta) => {
        if (delta.id !== downloadId) return;
        if (delta.state?.current === "complete") { chrome.downloads.onChanged.removeListener(listener); setTimeout(() => URL.revokeObjectURL(url), 30000); resolve(downloadId); }
        if (delta.state?.current === "interrupted") { chrome.downloads.onChanged.removeListener(listener); URL.revokeObjectURL(url); reject(new Error(delta.error?.current || "download interrupted")); }
      };
      chrome.downloads.onChanged.addListener(listener);
    });
  });
}

async function validateAssets(list) {
  if (busy) return;
  busy = true; cancelRequested = false;
  updateActionButtons();
  const patches = {}; let ok = 0, failed = 0;
  showProgress("Validating real image binaries", 0, list.length, "");
  for (let i = 0; i < list.length; i++) {
    if (cancelRequested) break;
    const a = list[i];
    showProgress("Validating real image binaries", i + 1, list.length, `${i + 1}/${list.length}: ${a.prompt || a.id}`);
    try { const file = await fetchValidatedImage(a); patches[a.id] = { state: statusFor(a) === "downloaded" ? "downloaded" : "missing", validatedAt: new Date().toISOString(), bytes: file.bytes, mime: file.mime, error: "" }; ok++; }
    catch (e) { if ((e.message || "") === "cancelled") break; patches[a.id] = { state: "failed", failedAt: new Date().toISOString(), error: e.message || String(e) }; failed++; }
    if (Object.keys(patches).length >= 20) { await setStatusPatches(patches); for (const k of Object.keys(patches)) delete patches[k]; }
  }
  if (Object.keys(patches).length) await setStatusPatches(patches);
  busy = false;
  updateActionButtons();
  showProgress(cancelRequested ? "Validation cancelled" : "Validation complete", list.length, list.length, `valid: ${ok}, rejected: ${failed}`);
  // local state already patched; avoid a catalogue-wide refresh after validation.
}
async function downloadOne(asset) {
  if (busy || !asset) return;
  busy = true; cancelRequested = false;
  updateActionButtons();
  try {
    showProgress("Downloading one validated image", 1, 3, asset.prompt || asset.id);
    const file = await fetchValidatedImage(asset);
    const filename = assetFilename(asset, file.ext || asset.ext || "png");
    showProgress("Downloading one validated image", 2, 3, state.settings.chooseFolderOnce === false ? `Choose where to save: ${basename(filename)}` : filename);
    let dirHandle = null;
    const forceSaveAs = state.settings.chooseFolderOnce === false;
    if (state.settings.chooseFolderOnce !== false) {
      try { dirHandle = await chooseZipDirectoryIfNeeded(); } catch (_) { dirHandle = null; }
    }
    await saveZipBlob(file.blob, filename, dirHandle, forceSaveAs, "single-media-download");
    await setStatusPatches({ [asset.id]: { state: "downloaded", downloadedAt: new Date().toISOString(), error: "", bytes: file.bytes, mime: file.mime } });
    if (!$("#lightbox")?.hidden) {
      const newIndex = currentList.findIndex(x => x.id === asset.id);
      if (newIndex >= 0) lightboxIndex = newIndex;
      renderLightbox();
    }
    showProgress("Downloaded", 3, 3, filename);
  } catch (e) {
    await setStatusPatches({ [asset.id]: { state: "failed", failedAt: new Date().toISOString(), error: e.message || String(e) } });
    if (!$("#lightbox")?.hidden) renderLightbox();
    showProgress("Download failed", 1, 1, e.message || String(e));
  } finally {
    busy = false;
    updateActionButtons();
    // local state already patched; avoid a catalogue-wide refresh after single download.
    if (!$("#lightbox")?.hidden) renderLightbox();
  }
}
async function downloadAssetsAsZip(downloadAll = false, explicitList = null, label = "") {
  if (busy) return;
  const list = Array.isArray(explicitList) ? explicitList : (downloadAll ? allAssets() : allAssets().filter(a => statusFor(a) !== "downloaded"));
  const modeLabel = label || (Array.isArray(explicitList) ? "selected" : (downloadAll ? "all" : "missing"));
  if (!list.length) { showProgress("Nothing to download", 1, 1, modeLabel === "selected" ? "No selected media." : (downloadAll ? "No media in current source/filter settings." : "No missing media.")); return; }
  busy = true; cancelRequested = false;
  updateActionButtons();
  const usedNames = new Set();
  const archiveFolder = sanitizePath(state.settings.archiveFolder || (activeSource() === "grok" ? "Grok/archives" : "ChatGPT-Images/archives"));
  const archiveSlug = activeSource() === "grok" ? "grok-media" : "chatgpt-images";
  const maxPartBytes = Math.max(100, Number(state.settings.zipPartMb || 1500)) * 1024 * 1024;
  let partNo = 1, includedTotal = 0, rejected = 0, archivesSaved = 0;
  let partEntries = [], partIds = [], partBytes = 0;
  const startStamp = new Date().toISOString().replace(/[:.]/g, "-");
  let zipDirHandle = null;
  if (state.settings.chooseFolderOnce !== false) {
    try { zipDirHandle = await chooseZipDirectoryIfNeeded(); }
    catch (e) { busy = false; updateActionButtons(); if ((e.message || "") === "cancelled") showProgress("ZIP download cancelled", 1, 1, "Folder selection cancelled."); else showProgress("Folder picker failed", 1, 1, e.message || String(e)); await refreshState(); return; }
  }

  async function flushPart() {
    if (!partEntries.length) return;
    showProgress("Creating ZIP part", includedTotal, list.length, `Archive ${partNo}: ${partEntries.length} images, ${(partBytes / 1024 / 1024).toFixed(1)} MB. Downloaded archives: ${archivesSaved}`);
    const zip = makeZip(partEntries);
    const archiveName = `${archiveFolder}/${archiveSlug}-${startStamp}-part-${String(partNo).padStart(3, "0")}.zip`;
    showProgress("Downloading ZIP part", includedTotal, list.length, `Archive ${partNo}: ${archiveName}. Downloaded archives: ${archivesSaved}`);
    await saveZipBlob(zip, archiveName, zipDirHandle, state.settings.chooseFolderOnce === false, "zip-media-download");
    archivesSaved += 1;
    showProgress("ZIP part saved", includedTotal, list.length, `Downloaded archives: ${archivesSaved}. Last archive: ${archiveName}`);
    const donePatch = {};
    for (const id of partIds) donePatch[id] = { state: "downloaded", downloadedAt: new Date().toISOString(), archive: archiveName, error: "" };
    await setStatusPatches(donePatch);
    partNo += 1; partEntries = []; partIds = []; partBytes = 0;
  }

  showProgress(modeLabel === "selected" ? "Building ZIP parts from selected media" : (downloadAll ? "Building ZIP parts from all validated media" : "Building ZIP parts from missing validated media"), 0, list.length, `Bulk mode downloads ZIP parts, not one Save As per media file. ${state.settings.chooseFolderOnce !== false ? "Choose-folder-once is ON." : "Save As mode: pick the ZIP destination; Chrome should reopen the last used ZIP folder."} Part size limit: ${state.settings.zipPartMb || 1500} MB.`);
  for (let i = 0; i < list.length; i++) {
    if (cancelRequested) break;
    const a = list[i];
    showProgress(modeLabel === "selected" ? "Building ZIP parts from selected media" : (downloadAll ? "Building ZIP parts from all validated media" : "Building ZIP parts from missing validated media"), i + 1, list.length, `${i + 1}/${list.length}: included ${includedTotal}, rejected ${rejected}, current archive ${partNo} ${(partBytes / 1024 / 1024).toFixed(1)} MB, downloaded archives: ${archivesSaved}`);
    try {
      const file = await fetchValidatedImage(a);
      const name = uniqueFilename(assetFilename(a, file.ext || a.ext || "png"), usedNames);
      const entrySize = file.buffer.byteLength + name.length + 256;
      if (partEntries.length && partBytes + entrySize > maxPartBytes) await flushPart();
      partEntries.push({ name, buffer: file.buffer });
      partIds.push(a.id);
      partBytes += entrySize;
      includedTotal += 1;
    } catch (e) {
      if ((e.message || "") === "cancelled") break;
      rejected += 1;
      await setStatusPatches({ [a.id]: { state: "failed", failedAt: new Date().toISOString(), error: e.message || String(e) } });
    }
  }

  try {
    if (!cancelRequested) await flushPart();
    busy = false;
    updateActionButtons();
    showProgress(cancelRequested ? "ZIP download cancelled" : "ZIP download complete", list.length, list.length, `included: ${includedTotal}, rejected: ${rejected}, downloaded archives: ${archivesSaved}`);
  } catch (e) {
    busy = false;
    updateActionButtons();
    showProgress("ZIP download failed", 1, 1, e.message || String(e));
  }
  // local state already patched during ZIP creation; avoid catalogue-wide refresh at the end.
}

async function downloadMissingAsZip() { return downloadAssetsAsZip(false); }
async function downloadAllAsZip() { return downloadAssetsAsZip(true); }
async function downloadSelectedAsZip() { return downloadAssetsAsZip(true, selectedAssets(), "selected"); }

function openLightboxById(id) { lightboxIndex = currentList.findIndex(a => a.id === id); if (lightboxIndex < 0) return; renderLightbox(); $("#lightbox").hidden = false; }
function renderLightbox() {
  const a = currentList[lightboxIndex]; if (!a) return;
  const st = statusFor(a);
  const meta = state.statuses[a.id] || {};
  const fullMediaUrl = mediaFullUrl(a);
  const previewMediaUrl = mediaPreviewUrl(a);
  const img = fullMediaUrl || previewMediaUrl;
  const isVideo = (a.kind || "image") === "video";
  const imgEl = $("#lightboxImg");
  const vidEl = $("#lightboxVideo");
  const placeholder = $("#lightboxPlaceholder");
  if (imgEl) { imgEl.hidden = true; imgEl.removeAttribute("src"); }
  if (vidEl) { try { vidEl.pause(); } catch (_) {} vidEl.hidden = true; vidEl.removeAttribute("src"); vidEl.removeAttribute("poster"); try { vidEl.load(); } catch (_) {} }
  if (placeholder) {
    placeholder.hidden = true;
    placeholder.innerHTML = '<div class="video-icon">▶</div><div>Video source unavailable</div>';
  }
  if (isVideo) {
    if (vidEl && fullMediaUrl) {
      vidEl.src = fullMediaUrl;
      if (previewMediaUrl && !looksLikeVideoUrl(previewMediaUrl) && previewMediaUrl !== fullMediaUrl) vidEl.poster = previewMediaUrl;
      vidEl.controls = true;
      vidEl.preload = "metadata";
      vidEl.hidden = false;
      try { vidEl.load(); } catch (_) {}
    } else if (placeholder) {
      placeholder.hidden = false;
    }
  } else if (imgEl) {
    imgEl.onerror = () => {
      if (previewMediaUrl && imgEl.src !== previewMediaUrl) imgEl.src = previewMediaUrl;
    };
    imgEl.src = img || previewMediaUrl;
    imgEl.hidden = false;
  }
  $("#lightboxPrompt").textContent = a.prompt || "media";
  $("#lightboxDate").textContent = meta.error || meta.downloadedAt || meta.validatedAt || a.url || "";
  const sourceText = a.source === "local" ? "local" : (a.source === "grok" ? (a.grokMode === "boards" ? "boards" : "imagen") : "gpt");
  const badges = `
    <span class="badge badge-status ${safeAttr(st)}">${safeText(st)}</span>
    <span class="badge badge-kind">${safeText(a.kind || "image")}</span>
    <span class="badge badge-source source-mode">${safeText(sourceText)}</span>
    <span class="badge badge-ext">${safeText(a.ext || "img")}</span>
    <span class="badge badge-date">${safeText(dateOnly(a.createdAt))}</span>`;
  const badgeBox = $("#lightboxBadges"); if (badgeBox) badgeBox.innerHTML = badges;
  const lbCols = $("#lightboxCollections"); if (lbCols) lbCols.innerHTML = lightboxCollectionsHtml(a);
  const check = $("#lightboxCheck"); if (check) check.hidden = st !== "downloaded";
  renderLightboxRating(a);
}
function stepLightbox(delta) { if (!currentList.length) return; lightboxIndex = (lightboxIndex + delta + currentList.length) % currentList.length; renderLightbox(); }

const COMPARE_MAX_ITEMS = 50;
function compareAssets() {
  return selectedAssets().slice(0, COMPARE_MAX_ITEMS);
}
function compareIsOpen() {
  const modal = $("#compareModal");
  return !!modal && !modal.hidden;
}
function getCompareAsset(id) {
  return compareState.items.find(a => a.id === id) || null;
}
function getCompareThumbUrl(a) {
  if (!a) return "";
  const card = getCardEl(a.id);
  const img = card?.querySelector?.(".preview img");
  if (img?.currentSrc) return img.currentSrc;
  if (img?.src) return img.src;
  const vid = card?.querySelector?.(".preview video");
  if (vid?.poster) return vid.poster;
  const thumb = mediaPreviewUrl(a);
  if (thumb && !looksLikeVideoUrl(thumb)) return thumb;
  return "";
}
function nextCompareId(id, dir = 1) {
  const items = compareState.items || [];
  if (items.length <= 1) return null;
  let idx = items.findIndex(a => a.id === id);
  if (idx < 0) idx = 0;
  for (let step = 1; step < items.length; step++) {
    const next = items[(idx + dir * step + items.length * 10) % items.length];
    if (next?.id && next.id !== id) return next.id;
  }
  return null;
}
function ensureComparePair(changedSide = "a") {
  const items = compareState.items || [];
  if (!items.length) return;
  if (!compareState.aId || !items.some(a => a.id === compareState.aId)) compareState.aId = items[0]?.id || null;
  if (!compareState.bId || !items.some(a => a.id === compareState.bId)) compareState.bId = items[1]?.id || nextCompareId(compareState.aId, 1);
  if (compareState.aId === compareState.bId) {
    if (changedSide === "a") compareState.bId = nextCompareId(compareState.aId, 1);
    else compareState.aId = nextCompareId(compareState.bId, -1) || nextCompareId(compareState.bId, 1);
  }
}
function compareSourceLabel(a) {
  if (!a) return "";
  const sourceText = a.source === "local" ? "Local" : (a.source === "grok" ? (a.grokMode === "boards" ? "Grok boards" : "Grok Imagen") : "ChatGPT");
  return `${sourceText} · ${a.kind || "image"} · ${a.ext || "media"} · ${statusFor(a)}`;
}
function compareCaptionHtml(a, label) {
  if (!a) return "";
  const prompt = a.prompt || "media";
  const shortPrompt = prompt.length > 180 ? prompt.slice(0, 177) + "…" : prompt;
  return `<div class="compare-caption-label">${label} · ${safeText(compareSourceLabel(a))}</div><div class="compare-caption-text" title="${safeAttr(prompt)}">${safeText(shortPrompt)}</div>`;
}
function compareRatingHtml(a, label = "") {
  if (!a) return "";
  const rating = ratingForItem(a.id);
  const value = rating == null ? "Unrated" : rating.toFixed(1);
  return `<div class="compare-rating-control ${rating == null ? "is-unrated" : ""}" data-rating-item-id="${safeAttr(a.id)}" data-rating-label="${safeAttr(label)}">
    <div class="compare-rating-head"><span>${safeText(label ? `${label} rating` : "Rating")}</span><strong class="compare-rating-value">${safeText(value)}</strong></div>
    <input class="compare-rating-slider" data-compare-rating="1" data-item-id="${safeAttr(a.id)}" type="range" min="1" max="5" step="0.1" value="${safeAttr(rating == null ? 1 : rating)}" />
    <div class="compare-rating-scale"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span></div>
    <button class="mini-button compare-rating-clear" data-clear-compare-rating="1" data-item-id="${safeAttr(a.id)}" type="button" ${rating == null ? "disabled" : ""}>Clear</button>
  </div>`;
}
function compareMediaHtml(a, label) {
  if (!a) return `<div class="compare-empty">No media</div>`;
  const isVideo = (a.kind || "image") === "video";
  const url = mediaFullUrl(a);
  const fallback = mediaPreviewUrl(a) || url;
  if (isVideo) {
    if (!url) return `<div class="compare-empty">Video source unavailable</div>`;
    const poster = fallback && !looksLikeVideoUrl(fallback) && fallback !== url ? ` poster="${safeAttr(fallback)}"` : "";
    return `<video class="compare-media" src="${safeAttr(url)}"${poster} controls muted playsinline preload="metadata"></video>`;
  }
  return `<img class="compare-media" src="${safeAttr(url || fallback)}" data-fallback="${safeAttr(fallback)}" alt="${safeAttr(label)}" referrerpolicy="no-referrer" />`;
}
function renderCompareRails() {
  const railA = $("#compareRailA");
  const railB = $("#compareRailB");
  const items = compareState.items || [];
  const railHtml = (side) => items.map((a, idx) => {
    const isActive = side === "a" ? a.id === compareState.aId : a.id === compareState.bId;
    const otherActive = side === "a" ? a.id === compareState.bId : a.id === compareState.aId;
    const thumb = getCompareThumbUrl(a);
    const indexLabel = String(idx + 1).padStart(2, "0");
    const thumbHtml = thumb
      ? `<img src="${safeAttr(thumb)}" loading="lazy" referrerpolicy="no-referrer" alt="" />`
      : `<span class="compare-thumb-placeholder">${safeText((a.kind || "img").slice(0, 3))}</span>`;
    return `<button class="compare-thumb ${isActive ? "active" : ""} ${otherActive ? "other-active" : ""}" type="button" data-compare-side="${side}" data-id="${safeAttr(a.id)}" title="${safeAttr(a.prompt || a.filename || a.url || "media")}"><span class="compare-thumb-index">${indexLabel}</span>${thumbHtml}</button>`;
  }).join("");
  if (railA) railA.innerHTML = railHtml("a");
  if (railB) railB.innerHTML = railHtml("b");
}
function renderCompareStage() {
  const stage = $("#compareStage");
  if (!stage) return;
  const a = getCompareAsset(compareState.aId);
  const b = getCompareAsset(compareState.bId);
  const bothImages = a && b && (a.kind || "image") !== "video" && (b.kind || "image") !== "video";
  const modeRevealBtn = $("#compareModeReveal");
  if (modeRevealBtn) {
    modeRevealBtn.disabled = !bothImages;
    modeRevealBtn.title = bothImages ? "Drag reveal comparison." : "Reveal works for image + image only.";
  }
  if (compareState.mode === "reveal" && !bothImages) compareState.mode = "side";
  $("#compareModeSide")?.classList.toggle("active", compareState.mode === "side");
  $("#compareModeReveal")?.classList.toggle("active", compareState.mode === "reveal");
  if (compareState.mode === "reveal" && bothImages) {
    // Reveal orientation: left side is A, right side is B.
    // B is the base layer clipped from the left; A is the top layer clipped from the right.
    const baseUrl = mediaFullUrl(b);
    const topUrl = mediaFullUrl(a);
    const pct = Math.max(0, Math.min(100, compareState.revealPct || 50));
    stage.className = "compare-stage compare-stage-reveal";
    stage.innerHTML = `<div class="compare-reveal" id="compareRevealBox">
      <img id="compareRevealBaseImg" class="compare-reveal-img base" src="${safeAttr(baseUrl)}" data-fallback="${safeAttr(mediaPreviewUrl(b) || mediaFullUrl(b))}" alt="B" referrerpolicy="no-referrer" style="clip-path:inset(0 0 0 ${pct}%)" />
      <img id="compareRevealTopImg" class="compare-reveal-img top" src="${safeAttr(topUrl)}" data-fallback="${safeAttr(mediaPreviewUrl(a) || mediaFullUrl(a))}" alt="A" referrerpolicy="no-referrer" style="clip-path:inset(0 ${100 - pct}% 0 0)" />
      <div id="compareRevealHandle" class="compare-reveal-handle" style="left:${pct}%"><span></span></div>
      <div class="compare-reveal-label compare-label-a">A</div><div class="compare-reveal-label compare-label-b">B</div>
    </div>
    <div class="compare-caption-row"><div>${compareRatingHtml(a, "A")}${compareCaptionHtml(a, "A")}</div><div>${compareRatingHtml(b, "B")}${compareCaptionHtml(b, "B")}</div></div>`;
  } else {
    stage.className = "compare-stage compare-stage-side";
    stage.innerHTML = `<div class="compare-side-layout">\n      <div class="compare-pane compare-pane-a"><div class="compare-pane-head">A</div><div class="compare-media-box">${compareMediaHtml(a, "A")}</div><div class="compare-caption compare-caption-with-rating">${compareRatingHtml(a, "A")}${compareCaptionHtml(a, "A")}</div></div>\n      <div class="compare-pane compare-pane-b"><div class="compare-pane-head">B</div><div class="compare-media-box">${compareMediaHtml(b, "B")}</div><div class="compare-caption compare-caption-with-rating">${compareRatingHtml(b, "B")}${compareCaptionHtml(b, "B")}</div></div>\n    </div>`;
  }
  $$(`#compareStage img[data-fallback]`).forEach(img => {
    img.onerror = () => {
      const fb = img.getAttribute("data-fallback");
      if (fb && img.src !== fb) img.src = fb;
    };
  });
}
function renderCompare() {
  ensureComparePair();
  renderCompareRails();
  renderCompareStage();
  const count = $("#compareCount");
  if (count) {
    const totalSelected = selectedAssets().length;
    count.textContent = totalSelected > COMPARE_MAX_ITEMS
      ? `Showing first ${COMPARE_MAX_ITEMS} of ${totalSelected} selected`
      : `${compareState.items.length} selected`;
  }
}
function openCompareFromSelection(event = null) {
  if (event) { event.preventDefault?.(); event.stopPropagation?.(); }
  const items = compareAssets();
  if (items.length < 2) {
    showProgress("Compare needs 2+ selected", 1, 1, "Select at least two media items first.");
    return;
  }
  const modal = $("#compareModal");
  compareState.items = items;
  compareState.aId = items[0].id;
  compareState.bId = items[1]?.id || nextCompareId(items[0].id, 1);
  compareState.mode = compareState.mode || "side";
  compareState.revealPct = 50;
  ensureComparePair("a");
  if (modal) {
    modal.hidden = false;
    modal.removeAttribute("hidden");
    modal.classList.add("open");
    document.body.classList.add("compare-open");
  }
  try {
    renderCompare();
    modal?.focus?.();
  } catch (e) {
    console.error("Compare open failed", e);
    showProgress("Compare failed", 1, 1, e.message || String(e));
  }
}
function closeCompare() {
  const modal = $("#compareModal");
  if (modal) {
    modal.hidden = true;
    modal.classList.remove("open");
    modal.setAttribute("hidden", "");
  }
  document.body.classList.remove("compare-open");
  $$("#compareStage video").forEach(v => { try { v.pause(); } catch (_) {} });
  compareState.revealPointerId = null;
}
function setCompareSide(side, id) {
  if (side === "a") compareState.aId = id;
  else compareState.bId = id;
  ensureComparePair(side);
  renderCompare();
}
function swapCompare() {
  const a = compareState.aId;
  compareState.aId = compareState.bId;
  compareState.bId = a;
  renderCompare();
}
function setCompareMode(mode) {
  compareState.mode = mode;
  renderCompareStage();
}
function updateCompareRevealFromClient(clientX) {
  const box = $("#compareRevealBox");
  if (!box) return;
  const rect = box.getBoundingClientRect();
  if (!rect.width) return;
  const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
  compareState.revealPct = pct;
  const baseImg = $("#compareRevealBaseImg");
  const topImg = $("#compareRevealTopImg");
  const handle = $("#compareRevealHandle");
  if (baseImg) baseImg.style.clipPath = `inset(0 0 0 ${pct}%)`;
  if (topImg) topImg.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
  if (handle) handle.style.left = `${pct}%`;
}
function scheduleCompareRevealMove(clientX) {
  compareState.lastClientX = clientX;
  if (compareState.revealRaf) return;
  compareState.revealRaf = requestAnimationFrame(() => {
    compareState.revealRaf = 0;
    updateCompareRevealFromClient(compareState.lastClientX);
  });
}

async function saveSettings() {
  suppressControlRefreshUntil = Date.now() + 2000;
  const val = (id, fallback = "") => { const el = $("#" + id); return el ? el.value : fallback; };
  const chk = (id, fallback = false) => { const el = $("#" + id); return el ? !!el.checked : fallback; };

  const rawMax = Number(val("maxImages", DEFAULT_SETTINGS.maxImages));
  const maxImages = Number.isFinite(rawMax) && rawMax > 0
    ? Math.max(25, Math.floor(rawMax / 25) * 25)
    : DEFAULT_SETTINGS.maxImages;
  const rawZip = Number(val("zipPartMb", DEFAULT_SETTINGS.zipPartMb));
  const zipPartMb = Number.isFinite(rawZip) && rawZip > 0
    ? Math.max(100, Math.min(3500, rawZip))
    : DEFAULT_SETTINGS.zipPartMb;

  const settings = {
    folder: val("folder", DEFAULT_SETTINGS.folder) || DEFAULT_SETTINGS.folder,
    archiveFolder: val("archiveFolder", DEFAULT_SETTINGS.archiveFolder) || DEFAULT_SETTINGS.archiveFolder,
    zipPartMb,
    maxImages,
    maxReplayPages: Math.ceil(maxImages / 25),
    folderStructure: val("folderStructure", DEFAULT_SETTINGS.folderStructure) || DEFAULT_SETTINGS.folderStructure,
    activeSource: state.settings.activeSource || DEFAULT_SETTINGS.activeSource,
    localFolderLabel: state.settings.localFolderLabel || DEFAULT_SETTINGS.localFolderLabel || "",
    localFolderPath: normalizeLocalPath(state.settings.localFolderPath || DEFAULT_SETTINGS.localFolderPath || ""),
    localRootId: state.settings.localRootId || "",
    localRoots: normalizeLocalRootsList(state.settings.localRoots || []),
    localViewMode: val("localViewMode", state.settings.localViewMode || DEFAULT_SETTINGS.localViewMode) === "all" ? "all" : "folder",
    localMaxFiles: Math.max(25, Math.min(100000, Math.floor(Number(val("localMaxFiles", state.settings.localMaxFiles || DEFAULT_SETTINGS.localMaxFiles)) || DEFAULT_SETTINGS.localMaxFiles))),
    localFolderBarPinned: !!state.settings.localFolderBarPinned,
    grokMode: val("grokMode", DEFAULT_SETTINGS.grokMode) || DEFAULT_SETTINGS.grokMode,
    grokMedia: val("grokMedia", DEFAULT_SETTINGS.grokMedia) || DEFAULT_SETTINGS.grokMedia,
    grokVideoThumbs: !!$("#grokVideoThumbs")?.checked,
    thumbnailCache: chk("thumbnailCache", true),
    thumbnailCacheAutoBuild: chk("thumbnailCacheAutoBuild", true),
    thumbnailCacheFullGrid: chk("thumbnailCacheFullGrid", false),
    thumbnailCacheQuality: ["low", "medium", "high"].includes(val("thumbnailCacheQuality", "medium")) ? val("thumbnailCacheQuality", "medium") : "medium",
    liveCapture: false,
    generationWatch: false,
    viewMode: val("viewMode", DEFAULT_SETTINGS.viewMode) || DEFAULT_SETTINGS.viewMode,
    pageMode: val("pageMode", DEFAULT_SETTINGS.pageMode) || DEFAULT_SETTINGS.pageMode,
    pageSize: Number(val("pageSize", DEFAULT_SETTINGS.pageSize) || DEFAULT_SETTINGS.pageSize),
    gridScale: updateGridScaleControls(state.settings.gridScale || DEFAULT_SETTINGS.gridScale),
    chooseFolderOnce: chk("chooseFolderOnce", true),
    collectionFilter: state.settings.collectionFilter || DEFAULT_SETTINGS.collectionFilter,
    storyboardActiveId: state.settings.storyboardActiveId || "",
    storyboardView: !!state.settings.storyboardView,
    hiddenMainViewCollections: Array.isArray(state.settings.hiddenMainViewCollections) ? [...state.settings.hiddenMainViewCollections] : []
  };
  const res = await runtimeMessage({ type: "SAVE_SETTINGS", settings });
  if (res?.ok) {
    state.settings = normalizeSettings({ ...DEFAULT_SETTINGS, ...res.settings });
    // Commit normalized/clamped values only after explicit commit (Enter/change/blur), not while user is typing.
    const maxEl = $("#maxImages");
    const zipEl = $("#zipPartMb");
    if (maxEl) maxEl.value = state.settings.maxImages;
    if (zipEl) zipEl.value = state.settings.zipPartMb;
  }
  render();
}

function startConnectingAnimation(targetId = "sync") {
  connectingActive = true;
  connectingButtonId = targetId || "sync";
  let dots = 0;
  clearInterval(connectingTimer);
  const tick = () => {
    dots = (dots % 3) + 1;
    const btn = $("#" + connectingButtonId);
    if (btn) {
      btn.classList.add("connecting");
      btn.textContent = `Connecting${".".repeat(dots)}`;
    }
  };
  tick();
  connectingTimer = setInterval(tick, 450);
  updateActionButtons();
}
function stopConnectingAnimation() {
  connectingActive = false;
  clearInterval(connectingTimer);
  connectingTimer = null;
  const labels = { sync: "Connect", connectImagen: "Connect Imagen", connectBoards: "Connect Boards" };
  for (const [id, label] of Object.entries(labels)) {
    const btn = $("#" + id);
    if (btn) {
      btn.classList.remove("connecting");
      if (/^Connecting/.test(btn.textContent || "")) btn.textContent = label;
    }
  }
  updateActionButtons();
}

async function autoSync(modeOverride = null) {
  if (busy) return;
  busy = true; cancelRequested = false;
  const src = activeSource();
  const connectTarget = src === "grok"
    ? ((modeOverride || state.settings.grokMode || "imagen") === "boards" ? "connectBoards" : "connectImagen")
    : "sync";
  startConnectingAnimation(connectTarget);
  const maxImages = Number(state.settings.maxImages || DEFAULT_SETTINGS.maxImages);
  const modeName = src === "grok" ? `Grok ${grokModeLabel(modeOverride || state.settings.grokMode || "imagen")}` : "ChatGPT";
  showProgress("Connecting", 0, 1, `${modeName} page connection. Max media: ${maxImages}.`);
  const res = await runtimeMessage({ type: "AUTO_SYNC", grokMode: modeOverride || undefined });
  busy = false;
  stopConnectingAnimation();
  const grokDiagnostics = Array.isArray(res?.diagnostics) ? res.diagnostics : [];
  const diagnosticText = grokDiagnostics.length
    ? ` Grok diagnostics: ${grokDiagnostics.slice(0, 20).map(d => d.summary || d.path || d.url || "unknown").join(" | ")}.`
    : (src === "grok" ? " No additional live feed request was captured; visible-page and known-source scans were used instead." : "");
  if (!res?.ok) showProgress("Connect failed", 1, 1, `${res?.error || "unknown error"}.${diagnosticText}`);
  else showProgress("Connect complete", 1, 1, `Mode: ${res.mode || "direct"}. Pages: ${res.pages || res.maxPages || "?"}. Added: ${res.added ?? "?"}, updated: ${res.updated ?? "?"}. Max media: ${res.maxImages || maxImages}.${diagnosticText}`);
  setTimeout(refreshState, 1500); setTimeout(refreshState, 4500); setTimeout(refreshState, 9000);
}

async function openOutputDirectory() {
  try {
    if (state.settings.chooseFolderOnce !== false && ("showDirectoryPicker" in window)) {
      showProgress("Choose output folder", 0, 1, "Select or re-authorize the ZIP output folder. This folder will be reused for ZIP parts.");
      await selectZipDirectory();
      showProgress("Output folder ready", 1, 1, "Folder selected. ZIP parts will be written there directly when Choose folder once is ON.");
    } else {
      const res = await runtimeMessage({ type: "SHOW_DOWNLOADS_FOLDER" });
      if (!res?.ok) showProgress("Open folder failed", 1, 1, res?.error || "Could not open downloads folder.");
    }
  } catch (e) {
    if (e && (e.name === "AbortError" || /abort|cancel/i.test(e.message || ""))) {
      showProgress("Output folder unchanged", 1, 1, "Folder picker cancelled.");
      return;
    }
    showProgress("Output folder failed", 1, 1, e.message || String(e));
  }
}

// Event bindings
$("#openImages").addEventListener("click", async () => {
  if (activeSource() === "local") await loadLocalDirectory({ choose: true, rebuildFolders: true });
  else if (activeSource() === "grok") await runtimeMessage({ type: "OPEN_GROK", mode: state.settings.grokMode || "imagen" });
  else await runtimeMessage({ type: "OPEN_IMAGES" });
});
$("#chooseLocalFolder")?.addEventListener("click", () => loadLocalDirectory({ choose: true, rebuildFolders: true }));
$("#addLocalRoot")?.addEventListener("click", () => loadLocalDirectory({ addRoot: true, rebuildFolders: true }));
$("#refreshLocalFolder")?.addEventListener("click", () => loadLocalDirectory({ choose: false, rebuildFolders: true }));
$("#localFolderPath")?.addEventListener("change", async e => {
  state.settings.localFolderPath = normalizeLocalPath(e.target.value || "");
  currentPage = 1;
  selectedIds.clear();
  await runtimeMessage({ type: "SAVE_SETTINGS", settings: { ...state.settings } });
  await loadLocalDirectory({ choose: false, rebuildFolders: false });
});
$("#localRootSelect")?.addEventListener("change", async e => {
  state.settings.localRootId = e.target.value || "";
  const root = activeLocalRoot();
  state.settings.localFolderLabel = root?.name || "Local root";
  state.settings.localFolderPath = "";
  localDirectoryHandle = null;
  localDirectoryOptions = [];
  localImmediateDirectories = [];
  currentPage = 1;
  selectedIds.clear();
  await runtimeMessage({ type: "SAVE_SETTINGS", settings: { ...state.settings } });
  await loadLocalDirectory({ choose: false, rebuildFolders: true });
});
$("#localViewMode")?.addEventListener("change", async e => {
  state.settings.localViewMode = e.target.value === "all" ? "all" : "folder";
  currentPage = 1;
  selectedIds.clear();
  await runtimeMessage({ type: "SAVE_SETTINGS", settings: { ...state.settings } });
  await loadLocalDirectory({ choose: false, rebuildFolders: false });
});
$("#localMaxFiles")?.addEventListener("change", async e => {
  const n = Math.max(25, Math.min(100000, Math.floor(Number(e.target.value) || DEFAULT_SETTINGS.localMaxFiles)));
  state.settings.localMaxFiles = n;
  e.target.value = n;
  currentPage = 1;
  await runtimeMessage({ type: "SAVE_SETTINGS", settings: { ...state.settings } });
  if (activeSource() === "local" && localDirectoryHandle) await loadLocalDirectory({ choose: false, rebuildFolders: false });
});
$("#localFolderPin")?.addEventListener("click", async () => {
  state.settings.localFolderBarPinned = !state.settings.localFolderBarPinned;
  await runtimeMessage({ type: "SAVE_SETTINGS", settings: { ...state.settings } });
  renderLocalFolderBar();
});

function organizerExportPayload() {
  const organizerSettings = {
    hiddenMainViewCollections: Array.isArray(state.settings.hiddenMainViewCollections) ? [...state.settings.hiddenMainViewCollections] : [],
    collectionFilter: state.settings.collectionFilter || "all"
  };
  return {
    schema: "ai-media-manager.organizer.v1",
    appVersion: chrome.runtime?.getManifest?.().version || "unknown",
    exportedAt: new Date().toISOString(),
    note: "Contains organizer metadata only. Does not include media catalogue, downloaded statuses, source URLs, thumbnail cache, image cache, local files, or directory handles.",
    collections: state.collections || {},
    itemCollections: state.itemCollections || {},
    ratings: normalizeRatingsState(state.ratings || {}),
    storyboards: normalizeStoryboardsState(state.storyboards || {}),
    canvases: normalizeCanvasesState(state.canvases || {}),
    settings: organizerSettings
  };
}

function sanitizeOrganizerCollections(input) {
  const out = {};
  const src = input && typeof input === "object" ? input : {};
  for (const [rawId, rawCol] of Object.entries(src)) {
    const id = String(rawId || rawCol?.id || "").slice(0, 128);
    if (!id) continue;
    const name = String(rawCol?.name || "Untitled").trim().slice(0, 80) || "Untitled";
    const color = String(rawCol?.color || "blue").slice(0, 32);
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

async function exportOrganizerData() {
  const payload = organizerExportPayload();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  await downloadBlob(blob, `ai-media-manager-organizer-${stamp}.json`, true);
  showProgress("Organizer data exported", 1, 1, "Collections, item collection links, ratings, storyboards, canvases and hidden-main-view settings were exported. Media URLs and thumbnail cache were not included.");
}

async function importOrganizerDataFromFile(file) {
  if (!file) return;
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch (e) {
    showProgress("Import failed", 1, 1, "Could not read JSON: " + (e.message || String(e)));
    return;
  }
  if (!parsed || typeof parsed !== "object") {
    showProgress("Import failed", 1, 1, "The selected file is not a valid organizer JSON backup.");
    return;
  }
  const importedCollections = sanitizeOrganizerCollections(parsed.collections || {});
  const importedItemCollectionsPreview = sanitizeOrganizerItemCollections(parsed.itemCollections || {}, importedCollections);
  const importedRatingsPreview = normalizeRatingsState(parsed.ratings || {});
  const importedStoryboardsPreview = normalizeStoryboardsState(parsed.storyboards || {});
  const importedCanvasesPreview = normalizeCanvasesState(parsed.canvases || {});
  if (!Object.keys(importedCollections).length && !Object.keys(importedItemCollectionsPreview).length && !Object.keys(importedRatingsPreview).length && !Object.keys(importedStoryboardsPreview).length && !Object.keys(importedCanvasesPreview).length) {
    showProgress("Import skipped", 1, 1, "No collections, item collection links, ratings, storyboards or canvases were found in this backup file.");
    return;
  }
  showProgress("Importing organizer data", 0, 1, `Reading backup: ${Object.keys(importedCollections).length} collections, ${Object.keys(importedItemCollectionsPreview).length} item links, ${Object.keys(importedRatingsPreview).length} ratings, ${Object.keys(importedStoryboardsPreview).length} storyboards, ${Object.keys(importedCanvasesPreview).length} canvases.`);
  const res = await runtimeMessage({ type: "IMPORT_ORGANIZER", payload: parsed });
  if (!res?.ok) {
    showProgress("Import failed", 1, 1, res?.error || "Background import did not complete. No media/thumb cache was changed.");
    return;
  }
  invalidateCollectionCaches();
  collectionsDirty = true;
  await refreshState({ fullRender: true });
  render();
  const afterCollections = Object.keys(state.collections || {}).length;
  const afterItemLinks = Object.keys(state.itemCollections || {}).length;
  const afterRatings = Object.keys(state.ratings || {}).length;
  const afterStoryboards = Object.keys(state.storyboards || {}).length;
  const afterCanvases = Object.keys(state.canvases || {}).length;
  showProgress(
    "Organizer data imported",
    1,
    1,
    `Imported ${res.importedCollections ?? Object.keys(importedCollections).length} collections, ${res.importedItemLinks ?? Object.keys(importedItemCollectionsPreview).length} item links, ${res.importedRatings ?? Object.keys(importedRatingsPreview).length} ratings, ${res.importedStoryboards ?? Object.keys(importedStoryboardsPreview).length} storyboards and ${res.importedCanvases ?? Object.keys(importedCanvasesPreview).length} canvases. Totals now: ${afterCollections} collections, ${afterItemLinks} item links, ${afterRatings} ratings, ${afterStoryboards} storyboards, ${afterCanvases} canvases. Media/thumb cache was untouched.`
  );
}

async function clearMediaCatalogueOnly() {
  const ok = confirm("Clear media catalogue/status/request recipes only? Collections, ratings, hidden-main-view groups, settings and thumbnail cache will be kept. You can reconnect sources afterwards.");
  if (!ok) return;
  await runtimeMessage({ type: "CLEAR_MEDIA_STATE" });
  selectedIds.clear();
  currentPage = 1;
  await refreshState();
  showProgress("Media catalogue cleared", 1, 1, "Collections and ratings were kept. Reconnect ChatGPT/Grok or choose Local Files to rebuild media items.");
}

$("#localFolderBar")?.addEventListener("click", async e => {
  const btn = e.target.closest("button[data-path]");
  if (!btn) return;
  state.settings.localFolderPath = normalizeLocalPath(btn.dataset.path || "");
  currentPage = 1;
  selectedIds.clear();
  await runtimeMessage({ type: "SAVE_SETTINGS", settings: { ...state.settings } });
  await loadLocalDirectory({ choose: false, rebuildFolders: false });
});
$("#openOutputDir")?.addEventListener("click", openOutputDirectory);
$("#sync").addEventListener("click", () => autoSync());
async function connectSpecificGrokMode(mode) {
  if (activeSource() === "grok") {
    state.settings.grokMode = mode;
    const el = $("#grokMode"); if (el) el.value = mode;
    await runtimeMessage({ type: "SAVE_SETTINGS", settings: { ...state.settings } });
    render();
  }
  return autoSync(mode);
}
$("#connectImagen")?.addEventListener("click", () => connectSpecificGrokMode("imagen"));
$("#connectBoards")?.addEventListener("click", () => connectSpecificGrokMode("boards"));
$("#downloadZip").addEventListener("click", downloadMissingAsZip);
$("#downloadAllZip")?.addEventListener("click", downloadAllAsZip);
$("#downloadSelectedZip")?.addEventListener("click", downloadSelectedAsZip);
$("#selectVisible")?.addEventListener("click", selectVisibleWithUndo);
$("#clearSelection")?.addEventListener("click", clearSelectionWithUndo);
$("#miniSelectVisible")?.addEventListener("click", selectVisibleWithUndo);
$("#miniClearSelection")?.addEventListener("click", clearSelectionWithUndo);
$("#miniDownloadMissing")?.addEventListener("click", downloadMissingAsZip);
$("#miniDownloadAll")?.addEventListener("click", downloadAllAsZip);
$("#miniDownloadSelected")?.addEventListener("click", downloadSelectedAsZip);
$("#miniGridMinus")?.addEventListener("click", () => adjustGridScale(-20));
$("#miniGridPlus")?.addEventListener("click", () => adjustGridScale(20));
$("#miniTop")?.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
$("#miniBottom")?.addEventListener("click", () => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" }));
$("#validateVisible").addEventListener("click", () => validateAssets(currentList));
$("#cancelProgress").addEventListener("click", requestCancel);
$("#clear").addEventListener("click", async () => { if (!confirm("Clear local extension cache/catalogue/statuses? This does NOT delete files from your computer and does NOT delete anything from ChatGPT.")) return; await runtimeMessage({ type: "CLEAR_ALL" }); selectedIds.clear(); currentPage = 1; await refreshState(); });
$("#search").addEventListener("input", e => { query = e.target.value || ""; currentPage = 1; render(); });
$("#sort").addEventListener("change", e => { sortMode = e.target.value; currentPage = 1; render(); });
$("#resetFilters")?.addEventListener("click", resetViewFilters);
function scheduleSettingsSave() {
  suppressControlRefreshUntil = Date.now() + 2500;
  clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(async () => { currentPage = 1; await saveSettings(); }, 450);
}
async function commitSettingsNow() {
  clearTimeout(settingsSaveTimer);
  currentPage = 1;
  await saveSettings();
}
async function resetViewFilters() {
  filter = "all";
  query = "";
  sortMode = "newest";
  currentPage = 1;
  state.settings.collectionFilter = "all";
  const searchEl = $("#search");
  const sortEl = $("#sort");
  const collectionEl = $("#collectionFilter");
  if (searchEl) searchEl.value = "";
  if (sortEl) sortEl.value = "newest";
  if (collectionEl) collectionEl.value = "all";
  await runtimeMessage({ type: "SAVE_SETTINGS", settings: { ...state.settings, collectionFilter: "all" } });
  render();
}
async function startLiveCaptureForCurrentSource(show = true) {
  if (!state.settings.liveCapture) return;
  const src = activeSource();
  const res = await runtimeMessage({ type: "START_LIVE_CAPTURE", source: src, grokMode: state.settings.grokMode || "imagen" });
  if (show) {
    if (res?.ok) showProgress("Live Capture ON", 1, 1, `Watching ${src === "grok" ? "Grok" : "ChatGPT"}${res.tabs ? ` tabs: ${res.tabs}` : ""}. Captures normal media URLs as the page receives them.`);
    else showProgress("Live Capture failed", 1, 1, res?.error || "Could not attach to source tab.");
  }
}
async function stopLiveCaptureForCurrentSource(show = true) {
  const src = activeSource();
  const res = await runtimeMessage({ type: "STOP_LIVE_CAPTURE", source: src });
  if (show) showProgress("Live Capture OFF", 1, 1, res?.tabs ? `Stopped in ${res.tabs} tab(s). Existing catalogue is unchanged.` : "Passive live capture disabled. Existing catalogue is unchanged.");
}

async function startGenerationWatchForChatGPT(show = true) {
  if (!state.settings.generationWatch || activeSource() !== "chatgpt") return;
  const res = await runtimeMessage({ type: "START_GENERATION_WATCH" });
  if (show) {
    if (res?.ok) showProgress("Generation Watch ON", 1, 1, `Watching ChatGPT generation windows${res.tabs ? ` in ${res.tabs} tab(s)` : ""} for img/blob/canvas/file markers. Check the event log for counts.`);
    else showProgress("Generation Watch failed", 1, 1, res?.error || "Could not attach to ChatGPT tab.");
  }
}
async function stopGenerationWatchForChatGPT(show = true) {
  const res = await runtimeMessage({ type: "STOP_GENERATION_WATCH" });
  if (show) showProgress("Generation Watch OFF", 1, 1, res?.tabs ? `Stopped in ${res.tabs} tab(s). Existing catalogue/debug events are unchanged.` : "Generation-window watcher disabled. Existing catalogue/debug events are unchanged.");
}

for (const id of ["folder", "archiveFolder", "zipPartMb", "chooseFolderOnce", "folderStructure", "grokMode", "grokMedia", "grokVideoThumbs", "pageMode", "pageSize", "maxImages"]) {
  const el = $("#" + id);
  if (!el) continue;
  el.addEventListener("change", commitSettingsNow);
  if (el.tagName === "INPUT" && el.type !== "checkbox") {
    if (id === "zipPartMb" || id === "maxImages") {
      // Number fields are committed only on Enter or blur/change, so typing “1200” no longer becomes “25200”.
      el.addEventListener("keydown", async (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          await commitSettingsNow();
          el.blur();
        }
      });
    } else {
      el.addEventListener("input", scheduleSettingsSave);
    }
  }
}
for (const id of ["thumbnailCache", "thumbnailCacheAutoBuild", "thumbnailCacheFullGrid", "thumbnailCacheQuality"]) {
  const el = $("#" + id);
  if (!el) continue;
  el.addEventListener("change", commitSettingsNow);
}
const viewModeEl = $("#viewMode");
if (viewModeEl) {
  viewModeEl.addEventListener("change", () => {
    state.settings.viewMode = viewModeEl.value || DEFAULT_SETTINGS.viewMode;
    applyGridScaleDom();
    persistSettingsFast();
  });
}

// v2.20: Live Capture and Generation Watch UI removed; connect/manual refresh are the supported paths.

function adjustGridScale(delta) {
  const mode = state.settings.viewMode || "grid";
  if (mode === "list") {
    if (delta > 0) {
      state.settings.viewMode = "grid";
      state.settings.gridScale = 60;
      applyGridScaleDom();
      persistSettingsFast();
    }
    return;
  }
  const current = nearestGridScale(state.settings.gridScale || DEFAULT_SETTINGS.gridScale);
  const idx = GRID_SCALES.indexOf(current);
  if (delta < 0 && current <= GRID_SCALES[0]) {
    state.settings.viewMode = "list";
    applyGridScaleDom();
    persistSettingsFast();
    return;
  }
  const nextIdx = Math.max(0, Math.min(GRID_SCALES.length - 1, idx + (delta > 0 ? 1 : -1)));
  const nextScale = GRID_SCALES[nextIdx];
  if (nextScale === current) return;
  state.settings.gridScale = nextScale;
  applyGridScaleDom();
  persistSettingsFast();
}

$("#gridScaleMinus")?.addEventListener("click", () => adjustGridScale(-20));
$("#gridScalePlus")?.addEventListener("click", () => adjustGridScale(20));

async function setActiveSource(src) {
  state.settings.activeSource = src;
  if (src !== "local") state.settings = setSourceDefaultFolders(src);
  state.settings.activeSource = src;
  filter = "all";
  currentPage = 1;
  await runtimeMessage({ type: "SAVE_SETTINGS", settings: { ...state.settings, activeSource: src } });
  await refreshState();
  if (src === "local" && !Object.keys(localCatalog || {}).length) await loadLocalDirectory({ choose: false, silent: true });
}

// v2.32.75: English help dialog. Storyboard UI remains hidden; data stays intact.
function openHelpDialog() {
  const dialog = $("#helpDialog");
  if (!dialog) return;
  if (typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
}
function closeHelpDialog() {
  const dialog = $("#helpDialog");
  if (!dialog) return;
  if (typeof dialog.close === "function" && dialog.open) dialog.close();
  else dialog.removeAttribute("open");
}
function setHelpTab(tab = "manager") {
  const value = ["manager", "comic", "privacy"].includes(tab) ? tab : "manager";
  $$("[data-help-tab]").forEach(btn => {
    const active = btn.dataset.helpTab === value;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  $$("[data-help-panel]").forEach(panel => {
    panel.hidden = panel.dataset.helpPanel !== value;
  });
  const body = $("#helpDialog .help-dialog-body");
  if (body) body.scrollTop = 0;
}
$("#openHelp")?.addEventListener("click", () => { setHelpTab("manager"); openHelpDialog(); });
$$('[data-help-tab]').forEach(btn => btn.addEventListener("click", () => setHelpTab(btn.dataset.helpTab || "manager")));
$("#closeHelp")?.addEventListener("click", closeHelpDialog);
$("#closeHelpFooter")?.addEventListener("click", closeHelpDialog);
$("#helpDialog")?.addEventListener("click", (event) => {
  const dialog = event.currentTarget;
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  if (!inside) closeHelpDialog();
});

$("#sourceChatgpt")?.addEventListener("click", () => setActiveSource("chatgpt"));
$("#sourceGrok")?.addEventListener("click", () => setActiveSource("grok"));
$("#sourceLocal")?.addEventListener("click", () => setActiveSource("local"));

$(".filter-row").addEventListener("click", e => { const b = e.target.closest("button[data-filter]"); if (!b) return; filter = b.dataset.filter; currentPage = 1; render(); });
function bindPageButton(id, fn) { const el = $("#" + id); if (el) el.addEventListener("click", fn); }
bindPageButton("firstPage", () => { currentPage = 1; render(); });
bindPageButton("prevPage", () => { currentPage -= 1; render(); });
bindPageButton("nextPage", () => { currentPage += 1; render(); });
bindPageButton("lastPage", () => { currentPage = getPageCount(); render(); });
bindPageButton("firstPageBottom", () => { currentPage = 1; render(); });
bindPageButton("prevPageBottom", () => { currentPage -= 1; render(); });
bindPageButton("nextPageBottom", () => { currentPage += 1; render(); });
bindPageButton("lastPageBottom", () => { currentPage = getPageCount(); render(); });

function updateScrollMiniBarVisibility() {
  const bar = $("#scrollMiniBar");
  if (!bar) return;
  const y = window.scrollY || document.documentElement.scrollTop || 0;
  const selectionBar = $("#selectionBar");
  const sourceSwitch = $(".source-switch");
  const pinnedBottom = sourceSwitch ? sourceSwitch.getBoundingClientRect().bottom : 54;
  let shouldShow = y > 360;
  // Show the mini bar only after the normal selection bar has really scrolled away.
  // This prevents the duplicate-toolbar look near the top of the page.
  if (selectionBar) {
    const r = selectionBar.getBoundingClientRect();
    shouldShow = y > 120 && r.bottom <= pinnedBottom + 2;
  }
  if (shouldShow) {
    if (miniBarHideTimer) { clearTimeout(miniBarHideTimer); miniBarHideTimer = 0; }
    bar.hidden = false;
    bar.classList.remove("closing");
    bar.classList.add("open");
    return;
  }
  if (bar.hidden || bar.classList.contains("closing")) return;
  bar.classList.remove("open");
  bar.classList.add("closing");
  if (miniBarHideTimer) clearTimeout(miniBarHideTimer);
  miniBarHideTimer = setTimeout(() => {
    bar.hidden = true;
    bar.classList.remove("closing");
    miniBarHideTimer = 0;
  }, 190);
}
window.addEventListener("scroll", updateScrollMiniBarVisibility, { passive: true });
window.addEventListener("resize", updateScrollMiniBarVisibility, { passive: true });

function ensureDragSelectBox() {
  if (dragSelectBoxEl && document.body.contains(dragSelectBoxEl)) return dragSelectBoxEl;
  dragSelectBoxEl = document.createElement("div");
  dragSelectBoxEl.className = "drag-select-box";
  dragSelectBoxEl.hidden = true;
  document.body.appendChild(dragSelectBoxEl);
  return dragSelectBoxEl;
}
function dragSelectionStartAllowed(target) {
  const grid = $("#grid");
  if (!grid || !target || !grid.contains(target)) return false;
  if (target.closest("button,input,select,textarea,a,[contenteditable='true']")) return false;
  if (target.closest(".actions,.lightbox,.topbar,.settings,.actions-row,.filter-row,.viewbar,.selection-bar")) return false;
  return !!target.closest(".card,.preview,#grid");
}
function pagePointFromClient(clientX, clientY) {
  return { x: clientX + window.scrollX, y: clientY + window.scrollY };
}
function dragRectFromPoints(a, b) {
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const right = Math.max(a.x, b.x);
  const bottom = Math.max(a.y, b.y);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}
function pageRectToViewportRect(r) {
  return {
    left: r.left - window.scrollX,
    top: r.top - window.scrollY,
    width: r.width,
    height: r.height
  };
}
function rectsIntersect(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
function cacheDragSelectableCards() {
  const grid = $("#grid");
  const cards = $$(".card[data-id]", grid);
  return cards.map(card => {
    const cr = card.getBoundingClientRect();
    return {
      id: card.dataset.id,
      el: card,
      rect: {
        left: cr.left + window.scrollX,
        top: cr.top + window.scrollY,
        right: cr.right + window.scrollX,
        bottom: cr.bottom + window.scrollY,
        width: cr.width,
        height: cr.height
      }
    };
  });
}
function setDragCandidateIds(ids) {
  const next = new Set(ids);
  for (const id of dragSelectLastIds) {
    if (!next.has(id)) cardNodeForId(id)?.classList.remove("drag-candidate");
  }
  for (const id of next) {
    if (!dragSelectLastIds.has(id)) cardNodeForId(id)?.classList.add("drag-candidate");
  }
  dragSelectLastIds = next;
}
function clearDragCandidates() {
  for (const id of dragSelectLastIds) cardNodeForId(id)?.classList.remove("drag-candidate");
  dragSelectLastIds.clear();
}
function beginDragSelection(ev) {
  if (!dragSelectState || dragSelectState.active) return;
  dragSelectState.active = true;
  // Default drag replaces the current selection. Ctrl/Cmd toggles; Alt removes.
  dragSelectState.mode = ev.altKey ? "remove" : (ev.ctrlKey || ev.metaKey ? "toggle" : "replace");
  dragSelectState.cardRects = null;
  dragSelectState.hitIds = [];
  dragSelectState.lastPageRect = null;
  document.body.classList.add("drag-selecting");
  const box = ensureDragSelectBox();
  box.hidden = false;
  box.dataset.mode = dragSelectState.mode;
  try { $("#grid")?.setPointerCapture?.(dragSelectState.pointerId); } catch (_) {}
}
function scheduleDragSelectionFrame() {
  if (!dragSelectState?.active || dragSelectMoveRaf) return;
  dragSelectMoveRaf = requestAnimationFrame(runDragSelectionFrame);
}
function getDragPageRect() {
  if (!dragSelectState) return null;
  const client = dragSelectState.lastClient || dragSelectState.startClient;
  const currentPagePoint = pagePointFromClient(client.x, client.y);
  return dragRectFromPoints(dragSelectState.startPage, currentPagePoint);
}
function computeDragHitIds(pageRect) {
  const hit = [];
  if (!dragSelectState?.cardRects) dragSelectState.cardRects = cacheDragSelectableCards();
  const rects = dragSelectState.cardRects || [];
  if (!pageRect || !rects.length) return hit;
  // Fast reject by scroll direction / vertical bands before full rect intersection.
  for (const item of rects) {
    const r = item.rect;
    if (r.bottom < pageRect.top || r.top > pageRect.bottom) continue;
    if (r.right < pageRect.left || r.left > pageRect.right) continue;
    hit.push(item.id);
  }
  return hit;
}
function runDragSelectionFrame() {
  dragSelectMoveRaf = 0;
  if (!dragSelectState?.active) return;
  const pageRect = getDragPageRect();
  if (!pageRect) return;
  dragSelectState.lastPageRect = pageRect;
  const viewRect = pageRectToViewportRect(pageRect);
  const box = ensureDragSelectBox();
  box.style.transform = `translate3d(${Math.round(viewRect.left)}px, ${Math.round(viewRect.top)}px, 0)`;
  box.style.width = `${Math.round(viewRect.width)}px`;
  box.style.height = `${Math.round(viewRect.height)}px`;
  // Performance: do not toggle candidate classes on every frame. Hit-testing is done once on pointerup.
}
function updateDragAutoScroll(clientY) {
  if (!dragSelectState?.active) return;
  const edge = 58;
  const maxSpeed = 24;
  let speed = 0;
  if (clientY < edge) speed = -Math.ceil(maxSpeed * (1 - Math.max(0, clientY) / edge));
  else if (clientY > window.innerHeight - edge) speed = Math.ceil(maxSpeed * (1 - Math.max(0, window.innerHeight - clientY) / edge));
  dragSelectState.scrollSpeed = speed;
  if (speed && !dragSelectScrollRaf) dragSelectScrollRaf = requestAnimationFrame(dragAutoScrollTick);
}
function dragAutoScrollTick() {
  dragSelectScrollRaf = 0;
  if (!dragSelectState?.active) return;
  const speed = dragSelectState.scrollSpeed || 0;
  if (speed) {
    window.scrollBy(0, speed);
    scheduleDragSelectionFrame();
    dragSelectScrollRaf = requestAnimationFrame(dragAutoScrollTick);
  }
}
function updateDragSelectionVisual(ev) {
  if (!dragSelectState) return;
  dragSelectState.lastClient = { x: ev.clientX, y: ev.clientY };
  const dx = ev.clientX - dragSelectState.startClient.x;
  const dy = ev.clientY - dragSelectState.startClient.y;
  const dist = Math.hypot(dx, dy);
  if (!dragSelectState.active && dist < 5) return;
  if (!dragSelectState.active) {
    hideContextMenu();
    beginDragSelection(ev);
  }
  ev.preventDefault();
  scheduleDragSelectionFrame();
  updateDragAutoScroll(ev.clientY);
}
function finishDragSelection(ev) {
  if (!dragSelectState) return;
  const wasActive = !!dragSelectState.active;
  if (wasActive) {
    if (dragSelectMoveRaf) { cancelAnimationFrame(dragSelectMoveRaf); dragSelectMoveRaf = 0; }
    runDragSelectionFrame();
  }
  const finalRect = dragSelectState.lastPageRect || getDragPageRect();
  const hitIds = Array.from(new Set(wasActive ? computeDragHitIds(finalRect) : []));
  const mode = dragSelectState.mode || "replace";
  const beforeIds = new Set(selectedIds);
  const pointerId = dragSelectState.pointerId;
  dragSelectState = null;
  if (dragSelectScrollRaf) { cancelAnimationFrame(dragSelectScrollRaf); dragSelectScrollRaf = 0; }
  if (dragSelectMoveRaf) { cancelAnimationFrame(dragSelectMoveRaf); dragSelectMoveRaf = 0; }
  try { $("#grid")?.releasePointerCapture?.(pointerId); } catch (_) {}
  document.body.classList.remove("drag-selecting");
  if (dragSelectBoxEl) dragSelectBoxEl.hidden = true;
  clearDragCandidates();
  if (!wasActive) return;
  if (ev) { ev.preventDefault(); ev.stopPropagation(); }
  suppressNextGridClick = true;
  setTimeout(() => { suppressNextGridClick = false; }, 350);

  if (hitIds.length || mode === "replace") pushSelectionUndo();
  if (mode === "replace") {
    selectedIds = new Set(hitIds);
  } else if (mode === "remove") {
    for (const id of hitIds) selectedIds.delete(id);
  } else if (mode === "toggle") {
    for (const id of hitIds) selectedIds.has(id) ? selectedIds.delete(id) : selectedIds.add(id);
  }

  const changed = new Set([...beforeIds, ...selectedIds, ...hitIds]);
  for (const id of changed) syncCardSelectionDom(id);
  updateSelectionActionButtons();
}
function cancelDragSelection() {
  const pointerId = dragSelectState?.pointerId;
  dragSelectState = null;
  if (dragSelectScrollRaf) { cancelAnimationFrame(dragSelectScrollRaf); dragSelectScrollRaf = 0; }
  if (dragSelectMoveRaf) { cancelAnimationFrame(dragSelectMoveRaf); dragSelectMoveRaf = 0; }
  try { $("#grid")?.releasePointerCapture?.(pointerId); } catch (_) {}
  document.body.classList.remove("drag-selecting");
  if (dragSelectBoxEl) dragSelectBoxEl.hidden = true;
  clearDragCandidates();
}

function contextMenuEl() { return $("#mediaContextMenu"); }
function contextSubmenuEl() { return $("#mediaContextSubmenu"); }
function hideContextSubmenu() {
  const submenu = contextSubmenuEl();
  if (!submenu) return;
  submenu.hidden = true;
  submenu.innerHTML = "";
}
function hideContextMenu() {
  const menu = contextMenuEl();
  if (menu) {
    menu.hidden = true;
    menu.innerHTML = "";
  }
  hideContextSubmenu();
  contextMenuAssetId = null;
  contextCanvasPanelId = null;
}
function contextMenuRow(cmd, label, icon = "", disabled = false, extraAttrs = "") {
  return `<button type="button" class="context-menu-item" data-context-cmd="${safeAttr(cmd)}" ${extraAttrs} ${disabled ? "disabled" : ""}><span class="context-menu-icon">${safeText(icon)}</span><span>${safeText(label)}</span></button>`;
}
function positionContextPanel(panel, x, y) {
  if (!panel) return;
  const pad = 10;
  panel.hidden = false;
  const rect = panel.getBoundingClientRect();
  const left = Math.min(Math.max(pad, x), window.innerWidth - rect.width - pad);
  const top = Math.min(Math.max(pad, y), window.innerHeight - rect.height - pad);
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}
function contextBatchLabel(asset) {
  const ids = contextBatchIdsForAsset(asset);
  return ids.length > 1 ? `selected (${ids.length})` : "this item";
}
function showCollectionSubmenu(mode, x, y) {
  const submenu = contextSubmenuEl();
  const asset = assetById(contextMenuAssetId);
  if (!submenu || !asset) return;
  const collections = sortedCollections();
  const countLabel = contextBatchLabel(asset);
  const title = mode === "add" ? `Add ${countLabel} to…` : `Remove ${countLabel} from…`;
  const rows = collections.length
    ? collections.map(col => contextMenuRow(mode === "add" ? "add-collection" : "remove-collection", col.name || "Untitled", mode === "add" ? "+" : "−", false, `data-collection-id="${safeAttr(col.id)}"`)).join("")
    : contextMenuRow("noop", "No collections yet", "", true);
  submenu.innerHTML = `<div class="context-menu-title">${safeText(title)}</div>${rows}`;
  positionContextPanel(submenu, x, y);
}
function showContextMenuForAsset(asset, x, y) {
  hideContextSubmenu();
  const menu = contextMenuEl();
  if (!menu || !asset) return;
  const isSelected = selectedIds.has(asset.id);
  const batchIds = contextBatchIdsForAsset(asset);
  const selectedCount = selectedIds.size;
  const local = asset.source === "local";
  contextMenuAssetId = asset.id;
  const batchLabel = batchIds.length > 1 ? `selected (${batchIds.length})` : "this item";
  menu.innerHTML = `
    ${contextMenuRow("preview", "Preview", "↗")}
    ${contextMenuRow("toggle-select", isSelected ? "Unselect" : "Select", isSelected ? "☑" : "☐")}
    ${contextMenuRow("select-only", "Select only this", "◎")}
    <div class="context-menu-sep"></div>
    ${contextMenuRow("compare-selected", selectedCount >= 2 ? `Compare selected (${selectedCount})` : "Compare needs 2 selected", "⇄", selectedCount < 2)}
    ${contextMenuRow("select-for-compare", "Add to compare selection", "+")}
    ${contextMenuRow("add-storyboard", activeStoryboardObj() ? `Add ${batchLabel} to storyboard` : "No active storyboard", "▦", !activeStoryboardObj())}
    <div class="context-menu-sep"></div>
    ${contextMenuRow("add-collection-menu", `Add ${batchLabel} to collection…`, "+", !sortedCollections().length)}
    ${contextMenuRow("remove-collection-menu", `Remove ${batchLabel} from collection…`, "−", !sortedCollections().length)}
    <div class="context-menu-sep"></div>
    ${contextMenuRow("download", local ? "Local file already on disk" : (batchIds.length > 1 ? `Download selected (${batchIds.length})` : "Download"), "↓", local)}
    ${contextMenuRow("copy-url", local ? "Copy filename/path" : "Copy URL", "⧉")}
  `;
  positionContextPanel(menu, x, y);
}

function showCanvasPanelContextMenu(panelId, x, y) {
  const menu = contextMenuEl();
  const canvas = activeCanvasObj();
  const panel = canvas?.panels?.find(p => p.id === panelId);
  if (!menu || !canvas || !panel) return;
  hideContextSubmenu();
  contextMenuAssetId = null;
  contextCanvasPanelId = panelId;
  canvasSetSingleSelection("panel", panelId);
  renderCanvasControls();
  const asset = assetById(panel.itemId);
  const label = asset?.prompt || asset?.filename || "Canvas panel";
  menu.innerHTML = `
    <div class="context-menu-title">${safeText(String(label).slice(0, 72))}</div>
    ${contextMenuRow("canvas-remove", "Remove from canvas", "✕")}
    <div class="context-menu-sep"></div>
    ${contextMenuRow("canvas-fit", "Fit image", "□")}
    ${contextMenuRow("canvas-fill", "Fill/Crop image", "▣")}
    ${contextMenuRow("canvas-reset-crop", "Reset crop", "⌖")}
    ${contextMenuRow("canvas-zoom-in", "Crop zoom in", "+")}
    ${contextMenuRow("canvas-zoom-out", "Crop zoom out", "−")}
    <div class="context-menu-hint">Shift-drag panel to pan crop</div>
    <div class="context-menu-sep"></div>
    ${contextMenuRow("canvas-stroke-plus", "Stroke thicker", "▣")}
    ${contextMenuRow("canvas-stroke-minus", "Stroke thinner", "□")}
    ${contextMenuRow("canvas-stroke-color", "Cycle stroke color", "●")}
    ${contextMenuRow("canvas-stroke-off", "Stroke off", "○")}
    <div class="context-menu-sep"></div>
    ${contextMenuRow("canvas-front", "Bring front", "↑")}
    ${contextMenuRow("canvas-back", "Send back", "↓")}
  `;
  positionContextPanel(menu, x, y);
}

function showCanvasBubbleContextMenu(bubbleId, x, y) {
  const menu = contextMenuEl();
  const canvas = activeCanvasObj();
  const bubble = canvas?.bubbles?.find(b => b.id === bubbleId);
  if (!menu || !canvas || !bubble) return;
  hideContextSubmenu();
  contextMenuAssetId = null;
  contextCanvasPanelId = `bubble:${bubbleId}`;
  selectCanvasBubble(bubbleId);
  menu.innerHTML = `
    <div class="context-menu-title">Speech bubble</div>
    ${contextMenuRow("bubble-edit", "Edit text", "✎")}
    ${contextMenuRow("bubble-duplicate", "Duplicate bubble", "⧉")}
    ${contextMenuRow("bubble-remove", "Remove bubble", "✕")}
    <div class="context-menu-sep"></div>
    ${contextMenuRow("bubble-type", `Tail type: ${String(bubble.type || "speech")}`, "◔")}
    ${contextMenuRow("bubble-shape", `Bubble: ${canvasBubbleShapeType(bubble)}`, "◯")}
    ${contextMenuRow("bubble-style", `Style: ${String(bubble.style || "white")}`, "●")}
    ${contextMenuRow("bubble-reset-tail", "Reset tail", "⌖", String(bubble.type || "speech") === "caption")}
    ${contextMenuRow("bubble-font-plus", "Font larger", "+")}
    ${contextMenuRow("bubble-font-minus", "Font smaller", "−")}
    <div class="context-menu-hint">Drag blue dot to aim tail</div>
    <div class="context-menu-sep"></div>
    ${contextMenuRow("bubble-front", "Bring front", "↑")}
    ${contextMenuRow("bubble-back", "Send back", "↓")}
  `;
  positionContextPanel(menu, x, y);
}
async function handleCanvasContextCommand(cmd) {
  const canvas = activeCanvasObj();
  const token = contextCanvasPanelId;
  if (!canvas || !token) { hideContextMenu(); return; }
  const isBubble = String(token).startsWith("bubble:");
  if (isBubble) {
    canvasSetSingleSelection("bubble", String(token).slice(7));
  } else {
    canvasSetSingleSelection("panel", token);
  }
  hideContextMenu();
  if (cmd === "bubble-edit") return editSelectedCanvasBubbleText();
  if (cmd === "bubble-duplicate") return duplicateSelectedCanvasBubble();
  if (cmd === "bubble-remove") return deleteSelectedCanvasBubble();
  if (cmd === "bubble-type") return cycleSelectedCanvasBubbleType();
  if (cmd === "bubble-shape") return cycleSelectedCanvasBubbleShape();
  if (cmd === "bubble-style") return cycleSelectedCanvasBubbleStyle();
  if (cmd === "bubble-reset-tail") return resetSelectedCanvasBubbleTail();
  if (cmd === "bubble-font-plus") return adjustSelectedCanvasBubbleFont(1);
  if (cmd === "bubble-font-minus") return adjustSelectedCanvasBubbleFont(-1);
  if (cmd === "bubble-front") return reorderSelectedCanvasBubble(true);
  if (cmd === "bubble-back") return reorderSelectedCanvasBubble(false);
  if (cmd === "canvas-remove") return deleteSelectedCanvasPanel();
  if (cmd === "canvas-fit") return setSelectedCanvasFit("fit");
  if (cmd === "canvas-fill") return setSelectedCanvasFit("fill");
  if (cmd === "canvas-reset-crop") return resetSelectedCanvasCrop();
  if (cmd === "canvas-zoom-in") return adjustSelectedCanvasCropZoom(0.1);
  if (cmd === "canvas-zoom-out") return adjustSelectedCanvasCropZoom(-0.1);
  if (cmd === "canvas-stroke-plus") return adjustSelectedCanvasStroke(1);
  if (cmd === "canvas-stroke-minus") return adjustSelectedCanvasStroke(-1);
  if (cmd === "canvas-stroke-color") return cycleSelectedCanvasStrokeColor();
  if (cmd === "canvas-stroke-off") return setSelectedCanvasStroke(0);
  if (cmd === "canvas-front") return reorderSelectedCanvasPanel(true);
  if (cmd === "canvas-back") return reorderSelectedCanvasPanel(false);
}

function contextAssetFromEventTarget(target) {
  const card = target.closest?.(".card[data-id]");
  if (card?.dataset?.id) return assetById(card.dataset.id);
  const preview = target.closest?.(".preview[data-id]");
  if (preview?.dataset?.id) return assetById(preview.dataset.id);
  const lightbox = $("#lightbox");
  if (lightbox && !lightbox.hidden && target.closest?.("#lightbox")) return currentList[lightboxIndex] || null;
  const compareItem = target.closest?.("[data-compare-side][data-id]");
  if (compareItem?.dataset?.id) return assetById(compareItem.dataset.id);
  return null;
}
async function handleContextCommand(cmd, triggerEvent = null) {
  if (String(cmd || "").startsWith("canvas-")) return handleCanvasContextCommand(cmd);
  const asset = assetById(contextMenuAssetId);
  if (!asset) { hideContextMenu(); return; }
  const batchIds = contextBatchIdsForAsset(asset);
  if (cmd === "add-collection-menu") {
    const r = contextMenuEl()?.getBoundingClientRect();
    showCollectionSubmenu("add", Math.min(window.innerWidth - 12, (r?.right || (triggerEvent?.clientX || 0)) + 4), triggerEvent?.clientY || r?.top || 0);
    return;
  }
  if (cmd === "remove-collection-menu") {
    const r = contextMenuEl()?.getBoundingClientRect();
    showCollectionSubmenu("remove", Math.min(window.innerWidth - 12, (r?.right || (triggerEvent?.clientX || 0)) + 4), triggerEvent?.clientY || r?.top || 0);
    return;
  }
  if (cmd === "add-collection" || cmd === "remove-collection") {
    const collectionId = triggerEvent?.target?.closest?.("[data-collection-id]")?.dataset?.collectionId || "";
    hideContextMenu();
    if (!collectionId) return;
    if (cmd === "add-collection") await addItemsToCollection(batchIds, collectionId);
    else await removeItemsFromCollection(batchIds, collectionId);
    return;
  }
  hideContextMenu();
  if (cmd === "preview") return openLightboxById(asset.id);
  if (cmd === "toggle-select") return toggleSelectionId(asset.id);
  if (cmd === "select-only") {
    pushSelectionUndo();
    selectedIds.clear();
    selectedIds.add(asset.id);
    syncSelectionDom();
    updateSelectionActionButtons();
    return;
  }
  if (cmd === "select-for-compare") {
    if (!selectedIds.has(asset.id)) toggleSelectionId(asset.id);
    return;
  }
  if (cmd === "compare-selected") return openCompareFromSelection(new Event("contextmenu"));
  if (cmd === "add-storyboard") return addIdsToActiveStoryboard(batchIds);
  if (cmd === "copy-url") return navigator.clipboard.writeText(asset.source === "local" ? (asset.localPath || asset.filename || "") : (asset.url || ""));
  if (cmd === "download") {
    if (batchIds.length > 1 && asset.source !== "local") return downloadAssetsAsZip(true, batchIds.map(id => assetById(id)).filter(Boolean), "selected");
    return downloadOne(asset);
  }
}

$("#grid").addEventListener("pointerdown", e => {
  if (e.button === 0) hideContextMenu();
  if (busy || e.button !== 0 || !dragSelectionStartAllowed(e.target)) return;
  dragSelectState = {
    startClient: { x: e.clientX, y: e.clientY },
    lastClient: { x: e.clientX, y: e.clientY },
    startPage: pagePointFromClient(e.clientX, e.clientY),
    active: false,
    hitIds: [],
    cardRects: null,
    pointerId: e.pointerId,
    scrollSpeed: 0,
    lastPageRect: null
  };
  // Do not preventDefault here; normal click must still open the preview.
  // Native selection/drag is blocked only after movement passes the drag threshold.
});
document.addEventListener("pointermove", e => updateDragSelectionVisual(e), { passive: false });
document.addEventListener("pointerup", e => finishDragSelection(e), { passive: false });
document.addEventListener("pointercancel", cancelDragSelection);

document.addEventListener("contextmenu", e => {
  if (e.shiftKey) return;
  const canvasBubble = e.target.closest?.(".canvas-bubble[data-bubble-id]");
  if (canvasBubble?.dataset?.bubbleId) {
    e.preventDefault();
    e.stopPropagation();
    showCanvasBubbleContextMenu(canvasBubble.dataset.bubbleId, e.clientX, e.clientY);
    return;
  }
  const canvasPanel = e.target.closest?.(".canvas-panel[data-panel-id]");
  if (canvasPanel?.dataset?.panelId) {
    e.preventDefault();
    e.stopPropagation();
    showCanvasPanelContextMenu(canvasPanel.dataset.panelId, e.clientX, e.clientY);
    return;
  }
  const asset = contextAssetFromEventTarget(e.target);
  const menuOpen = !!(contextMenuEl() && !contextMenuEl().hidden);
  if (!asset && !menuOpen) return;
  e.preventDefault();
  e.stopPropagation();
  if (asset) showContextMenuForAsset(asset, e.clientX, e.clientY);
  else hideContextMenu();
}, true);
document.addEventListener("pointerdown", e => {
  const menu = contextMenuEl();
  const submenu = contextSubmenuEl();
  if (!menu || menu.hidden) return;
  if (e.target.closest?.("#mediaContextMenu") || e.target.closest?.("#mediaContextSubmenu")) return;
  if (e.button === 0) hideContextMenu();
}, true);
document.addEventListener("click", e => {
  const menu = contextMenuEl();
  if (menu && !menu.hidden && !e.target.closest?.("#mediaContextMenu") && !e.target.closest?.("#mediaContextSubmenu")) hideContextMenu();
});
document.addEventListener("scroll", hideContextMenu, { passive: true });
for (const menuEl of [$("#mediaContextMenu"), $("#mediaContextSubmenu")]) {
  menuEl?.addEventListener("click", async e => {
    const btn = e.target.closest?.("[data-context-cmd]");
    if (!btn || btn.disabled) return;
    await handleContextCommand(btn.dataset.contextCmd, e);
  });
}
$("#clearThumbnailCache")?.addEventListener("click", async () => {
  await idbClearThumbs();
  showProgress("Thumbnail cache cleared", 1, 1, "Cached thumbnails removed. They will rebuild only for visible cards.");
  render();
});
$("#rebuildVisibleThumbs")?.addEventListener("click", () => {
  hydrateVisibleThumbnails({ force: true });
  showProgress("Refreshing visible thumbnails", 1, 1, "Rebuilding thumbnails for the first visible cards only.");
});
$("#exportOrganizerData")?.addEventListener("click", exportOrganizerData);
$("#importOrganizerData")?.addEventListener("click", () => $("#importOrganizerFile")?.click());
$("#importOrganizerFile")?.addEventListener("change", async e => {
  const file = e.target.files?.[0];
  e.target.value = "";
  await importOrganizerDataFromFile(file);
});
$("#clearMediaStateOnly")?.addEventListener("click", clearMediaCatalogueOnly);

$("#grid").addEventListener("click", async e => {
  if (suppressNextGridClick) { e.preventDefault(); e.stopPropagation(); suppressNextGridClick = false; return; }
  const previewVideo = e.target.closest?.(".preview video");
  if (previewVideo) {
    const id = previewVideo.closest?.(".preview")?.dataset?.id;
    if (id) openLightboxById(id);
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const target = e.target.closest("[data-action]");
  if (!target) {
    const card = e.target.closest?.(".card[data-id]");
    if ((e.ctrlKey || e.metaKey) && card?.dataset?.id) {
      e.preventDefault();
      e.stopPropagation();
      toggleSelectionId(card.dataset.id);
      return;
    }
    if (selectedIds.size && e.target === $("#grid")) clearSelectionWithUndo();
    return;
  }
  const id = target.dataset.id; const asset = assetById(id);
  if ((e.ctrlKey || e.metaKey) && id && target.dataset.action === "lightbox") {
    e.preventDefault();
    e.stopPropagation();
    toggleSelectionId(id);
    return;
  }
  if (target.dataset.action === "toggle-select") {
    toggleSelectionId(id);
    return;
  }
  if (target.dataset.action === "lightbox") openLightboxById(id);
  if (target.dataset.action === "copy") await navigator.clipboard.writeText(asset?.url || "");
  if (target.dataset.action === "download-one") await downloadOne(asset);
});
function closeLightbox() {
  $("#lightbox").hidden = true;
  const vid = $("#lightboxVideo");
  if (vid) { try { vid.pause(); } catch (_) {} }
}
$("#closeLightbox").addEventListener("click", closeLightbox);
$("#lightbox").addEventListener("click", e => { if (e.target === $("#lightbox")) closeLightbox(); });
$("#prevItem").addEventListener("click", () => stepLightbox(-1));
$("#nextItem").addEventListener("click", () => stepLightbox(1));
$("#downloadOne").addEventListener("click", () => downloadOne(currentList[lightboxIndex]));
$("#copyUrl").addEventListener("click", async () => navigator.clipboard.writeText(currentList[lightboxIndex]?.url || ""));
document.addEventListener("keydown", e => {
  const key = String(e.key || "").toLowerCase();
  const editable = e.target?.closest?.("input, textarea, select, [contenteditable='true']");
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === "z" && !editable) {
    if (restoreSelectionUndo()) {
      e.preventDefault();
      e.stopPropagation();
    }
    return;
  }
  if (key === "escape") hideContextMenu();
  if (compareIsOpen()) {
    if (e.key === "Escape") closeCompare();
    return;
  }
  if ($("#lightbox").hidden) return;
  if (e.key === "Escape") closeLightbox();
  if (e.key === "ArrowLeft") stepLightbox(-1);
  if (e.key === "ArrowRight") stepLightbox(1);
  if (key === "d") downloadOne(currentList[lightboxIndex]);
});


$("#storyboardSelect")?.addEventListener("change", e => setActiveStoryboard(e.target.value || ""));
$("#newStoryboard")?.addEventListener("click", createStoryboardPrompt);
$("#toggleStoryboardView")?.addEventListener("click", toggleStoryboardView);
$("#addSelectedToStoryboard")?.addEventListener("click", addSelectedToStoryboard);
$("#removeSelectedFromStoryboard")?.addEventListener("click", removeSelectedFromStoryboard);
$("#moveStoryboardUp")?.addEventListener("click", () => moveSelectedStoryboardItems(-1));
$("#moveStoryboardDown")?.addEventListener("click", () => moveSelectedStoryboardItems(1));
$("#exportStoryboard")?.addEventListener("click", exportActiveStoryboard);
$("#canvasSelect")?.addEventListener("change", e => setActiveCanvas(e.target.value || ""));
$("#newCanvas")?.addEventListener("click", createCanvasPrompt);
$("#toggleCanvasView")?.addEventListener("click", toggleCanvasView);
$("#canvasWorkMarksToggle")?.addEventListener("click", toggleCanvasWorkMarks);
$("#addSelectedToCanvas")?.addEventListener("click", addSelectedToCanvas);
$("#addStoryboardToCanvas")?.addEventListener("click", addStoryboardToCanvas);
$("#addCanvasBubble")?.addEventListener("click", createCanvasBubblePrompt);
$("#bubbleTypeButton")?.addEventListener("click", cycleSelectedCanvasBubbleType);
$("#bubbleShapeButton")?.addEventListener("click", cycleSelectedCanvasBubbleShape);
$("#bubbleJoinSelected")?.addEventListener("click", joinSelectedSpeechBubbles);
$("#bubbleUnjoinSelected")?.addEventListener("click", unjoinSelectedSpeechBubbles);
$("#bubbleMakeMainJoined")?.addEventListener("click", makeMainJoinedBubble);
$("#bubbleAddSecondary")?.addEventListener("click", addSelectedCanvasSecondaryBubble);
$("#bubbleEditSecondary")?.addEventListener("click", editSelectedCanvasSecondaryBubble);
$("#bubbleRemoveSecondary")?.addEventListener("click", removeSelectedCanvasSecondaryBubble);
$("#bubbleSecondaryBridgeToggle")?.addEventListener("change", e => setSelectedCanvasBubbleSecondaryBridge(e.target.checked));
$("#bubbleSecondaryBooleanToggle")?.addEventListener("change", e => setSelectedCanvasBubbleSecondaryBoolean(e.target.checked));
$("#bubbleSecondaryThoughtBooleanToggle")?.addEventListener("change", e => setSelectedCanvasBubbleSecondaryThoughtBoolean(e.target.checked));
$("#bubbleSecondaryBridgeBaseASlider")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("secondaryBridgeBaseA", e.target.value));
$("#bubbleSecondaryBridgeBaseAValue")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("secondaryBridgeBaseA", e.target.value));
$("#bubbleSecondaryBridgeBaseBSlider")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("secondaryBridgeBaseB", e.target.value));
$("#bubbleSecondaryBridgeBaseBValue")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("secondaryBridgeBaseB", e.target.value));
$("#bubbleSecondaryBridgeCurveSlider")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("secondaryBridgeCurve", e.target.value));
$("#bubbleSecondaryBridgeCurveValue")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("secondaryBridgeCurve", e.target.value));
$("#bubbleBurstSpikeCountSlider")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("burstSpikeCount", e.target.value));
$("#bubbleBurstSpikeCountValue")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("burstSpikeCount", e.target.value));
$("#bubbleBurstJaggedToggle")?.addEventListener("change", e => setSelectedCanvasBubbleBurstJagged(e.target.checked));
$("#bubbleBurstPeakOffsetSlider")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("burstPeakOffset", e.target.value));
$("#bubbleBurstPeakOffsetValue")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("burstPeakOffset", e.target.value));
$("#bubbleBurstValleyOffsetSlider")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("burstValleyOffset", e.target.value));
$("#bubbleBurstValleyOffsetValue")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("burstValleyOffset", e.target.value));
$("#bubbleBurstRandomnessSlider")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("burstRandomness", e.target.value));
$("#bubbleBurstRandomnessValue")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("burstRandomness", e.target.value));
$("#bubbleBurstHeightRandomnessSlider")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("burstRandomness2", e.target.value));
$("#bubbleBurstHeightRandomnessValue")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("burstRandomness2", e.target.value));
$("#bubbleCloudCircleCountSlider")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("cloudCircleCount", e.target.value));
$("#bubbleCloudCircleCountValue")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("cloudCircleCount", e.target.value));
$("#bubbleCloudCircleSizeSlider")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("cloudCircleSize", e.target.value));
$("#bubbleCloudCircleSizeValue")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("cloudCircleSize", e.target.value));
$("#bubbleCloudRandomnessSlider")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("cloudRandomness", e.target.value));
$("#bubbleCloudRandomnessValue")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("cloudRandomness", e.target.value));
$("#bubbleCloudRandomness2Slider")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("cloudRandomness2", e.target.value));
$("#bubbleCloudRandomness2Value")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("cloudRandomness2", e.target.value));
$("#bubbleBurstRandomizeButton")?.addEventListener("click", randomizeSelectedCanvasBubbleBurst);
$("#bubbleCloudRandomizeButton")?.addEventListener("click", randomizeSelectedCanvasBubbleCloud);
$("#bubbleTailPathModeButton")?.addEventListener("click", cycleSelectedCanvasBubbleTailPathMode);
$("#bubbleTailCurvedToggle")?.addEventListener("change", e => setSelectedCanvasBubbleCurved(e.target.checked));
$("#bubbleTailBrokenToggle")?.addEventListener("change", e => setSelectedCanvasBubbleBroken(e.target.checked));
$("#bubbleTailJaggedCountSlider")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("tailJaggedCount", e.target.value));
$("#bubbleTailJaggedCountValue")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("tailJaggedCount", e.target.value));
$("#bubbleTailJaggedLengthOffsetSlider")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("tailJaggedLengthOffset", e.target.value));
$("#bubbleTailJaggedLengthOffsetValue")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("tailJaggedLengthOffset", e.target.value));
$("#bubbleTailJaggedWidthOffsetSlider")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("tailJaggedWidthOffset", e.target.value));
$("#bubbleTailJaggedWidthOffsetValue")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("tailJaggedWidthOffset", e.target.value));
$("#bubbleTailJaggedSpacingSlider")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("tailJaggedSpacing", e.target.value));
$("#bubbleTailJaggedSpacingValue")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("tailJaggedSpacing", e.target.value));
$("#bubbleTailRelativeToggle")?.addEventListener("change", e => setSelectedCanvasBubbleRelativeFollow(e.target.checked));
$("#bubbleTailCurveModeButton")?.addEventListener("click", toggleSelectedCanvasBubbleCurveMode);
$("#bubbleTailBaseCustomToggle")?.addEventListener("change", e => setSelectedCanvasBubbleBaseCustom(e.target.checked));
$("#bubbleTailBaseRelativeToggle")?.addEventListener("change", e => setSelectedCanvasBubbleBaseRelativeFollow(e.target.checked));
$("#bubbleTailBaseRelativeButton")?.addEventListener("click", toggleSelectedCanvasBubbleBaseRelativeFollow);
$("#bubbleTailBaseSlider")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("tailBaseWidth", e.target.value));
$("#bubbleTailBaseValue")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("tailBaseWidth", e.target.value));
$("#bubbleTailBasePositionSlider")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("tailBaseShift", e.target.value));
$("#bubbleTailBasePositionValue")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("tailBaseShift", e.target.value));
$("#bubbleTailOuterSlider")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("tailOuterStroke", e.target.value));
$("#bubbleTailOuterValue")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("tailOuterStroke", e.target.value));
$("#bubbleTailOffsetSlider")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("tailAnchorOffset", e.target.value));
$("#bubbleTailOffsetValue")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("tailAnchorOffset", e.target.value));
$("#bubbleThoughtScaleXSlider")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("thoughtScaleX", e.target.value));
$("#bubbleThoughtScaleXValue")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("thoughtScaleX", e.target.value));
$("#bubbleThoughtScaleYSlider")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("thoughtScaleY", e.target.value));
$("#bubbleThoughtScaleYValue")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("thoughtScaleY", e.target.value));
$("#bubbleThoughtSpacingSlider")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("thoughtSpacing", e.target.value));
$("#bubbleThoughtSpacingValue")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("thoughtSpacing", e.target.value));
$("#bubbleThoughtFalloffSlider")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("thoughtFalloff", e.target.value));
$("#bubbleThoughtFalloffValue")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("thoughtFalloff", e.target.value));
$("#bubbleThoughtBaseSizeSlider")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("thoughtBaseSize", e.target.value));
$("#bubbleThoughtBaseSizeValue")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("thoughtBaseSize", e.target.value));
$("#bubbleThoughtBaseOffsetSlider")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("thoughtBaseOffset", e.target.value));
$("#bubbleThoughtBaseOffsetValue")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("thoughtBaseOffset", e.target.value));
$("#bubbleThoughtJoinToggle")?.addEventListener("change", e => setSelectedCanvasBubbleThoughtJoin(e.target.checked));
$("#bubbleThoughtJoinWidthSlider")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("thoughtJoinWidth", e.target.value));
$("#bubbleThoughtJoinWidthValue")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("thoughtJoinWidth", e.target.value));
$("#bubbleThoughtJoinLengthSlider")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("thoughtJoinLength", e.target.value));
$("#bubbleThoughtJoinLengthValue")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("thoughtJoinLength", e.target.value));
$("#bubbleThoughtCountSlider")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("thoughtCount", e.target.value));
$("#bubbleThoughtCountValue")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("thoughtCount", e.target.value));
$("#bubbleThoughtAngleSlider")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("thoughtAngle", e.target.value));
$("#bubbleThoughtAngleValue")?.addEventListener("input", e => setSelectedCanvasBubbleTailControl("thoughtAngle", e.target.value));
$("#bubbleThoughtHorizontalToggle")?.addEventListener("change", e => setSelectedCanvasBubbleThoughtHorizontal(e.target.checked));
$("#bubbleTailResetControls")?.addEventListener("click", resetSelectedCanvasBubbleTailControls);
$("#canvasPanelStrokeSlider")?.addEventListener("input", e => setSelectedCanvasPanelStrokeControl(e.target.value, null));
$("#canvasPanelStrokeValue")?.addEventListener("input", e => setSelectedCanvasPanelStrokeControl(e.target.value, null));
$("#canvasPanelStrokeColor")?.addEventListener("change", e => setSelectedCanvasPanelStrokeControl(null, e.target.value));
$("#canvasPanelStrokeSeparateToggle")?.addEventListener("change", e => setSelectedCanvasPanelStrokeSeparate(e.target.checked));
[["Top", "top"], ["Right", "right"], ["Bottom", "bottom"], ["Left", "left"]].forEach(([label, key]) => {
  $(`#canvasPanelStroke${label}Slider`)?.addEventListener("input", e => setSelectedCanvasPanelStrokeSide(key, e.target.value));
  $(`#canvasPanelStroke${label}Value`)?.addEventListener("input", e => setSelectedCanvasPanelStrokeSide(key, e.target.value));
});
$("#canvasPanelStrokeReset")?.addEventListener("click", resetSelectedCanvasPanelStroke);
$("#canvasPanelShapeToggle")?.addEventListener("change", e => setSelectedCanvasPanelShape(e.target.checked));
$("#canvasPanelShapeReset")?.addEventListener("click", resetSelectedCanvasPanelShape);
$("#canvasFitPanel")?.addEventListener("click", () => setSelectedCanvasFit("fit"));
$("#canvasFillPanel")?.addEventListener("click", () => setSelectedCanvasFit("fill"));
$("#canvasBringFront")?.addEventListener("click", () => reorderSelectedCanvasPanel(true));
$("#canvasSendBack")?.addEventListener("click", () => reorderSelectedCanvasPanel(false));
$("#canvasStrokeMinus")?.addEventListener("click", () => adjustSelectedCanvasStroke(-1));
$("#canvasStrokePlus")?.addEventListener("click", () => adjustSelectedCanvasStroke(1));
$("#canvasStrokeColor")?.addEventListener("click", cycleSelectedCanvasStrokeColor);
$("#canvasDeletePanel")?.addEventListener("click", deleteSelectedCanvasPanel);
$("#exportCanvas")?.addEventListener("click", exportActiveCanvas);
$("#comicCanvas")?.addEventListener("pointerdown", startCanvasPointer);
document.addEventListener("pointermove", updateCanvasPointer, { passive: false, capture: true });
document.addEventListener("pointerup", finishCanvasPointer, { passive: false, capture: true });
document.addEventListener("pointercancel", finishCanvasPointer, { passive: false, capture: true });
// v2.31.52 fallback: some embedded/browser contexts start pointerdown but
// continue with mousemove/mouseup; keep the canvas selection box responsive.
document.addEventListener("mousemove", updateCanvasPointer, { passive: false, capture: true });
document.addEventListener("mouseup", finishCanvasPointer, { passive: false, capture: true });
$("#comicCanvas")?.addEventListener("wheel", handleCanvasWheel, { passive: false });
$("#comicCanvas")?.addEventListener("dblclick", e => {
  const bubbleEl = e.target.closest?.(".canvas-bubble[data-bubble-id]");
  if (!bubbleEl?.dataset?.bubbleId) return;
  selectCanvasBubble(bubbleEl.dataset.bubbleId);
  const secondaryEl = e.target.closest?.(".canvas-bubble-secondary[data-secondary-bubble]");
  if (secondaryEl) {
    e.preventDefault?.();
    e.stopPropagation?.();
    editSelectedCanvasSecondaryBubble(Math.max(1, Math.min(3, Math.round(Number(secondaryEl.dataset.secondaryBubble) || 1))));
    return;
  }
  editSelectedCanvasBubbleText();
});

$("#collectionFilter")?.addEventListener("change", e => setCollectionFilter(e.target.value || "all"));
$("#newCollection")?.addEventListener("click", createCollectionPrompt);
$("#renameCollection")?.addEventListener("click", renameActiveCollection);
$("#deleteCollection")?.addEventListener("click", deleteActiveCollection);
$("#hideCollectionMain")?.addEventListener("click", toggleActiveCollectionMainVisibility);
$("#addSelectedToCollection")?.addEventListener("click", addSelectedToTargetCollection);
$("#removeSelectedFromCollection")?.addEventListener("click", removeSelectedFromTargetCollection);

$("#lightboxRatingSlider")?.addEventListener("input", e => {
  const itemId = e.currentTarget.dataset.itemId || currentList[lightboxIndex]?.id || "";
  const n = normalizeRatingValue(e.currentTarget.value);
  const value = $("#lightboxRatingValue");
  if (value) value.textContent = n == null ? "Unrated" : n.toFixed(1);
  const panel = $("#lightboxRatingPanel");
  if (panel) panel.classList.toggle("is-unrated", n == null);
  const clear = $("#clearLightboxRating");
  if (clear) clear.disabled = n == null;
  if (itemId && n != null) setItemRating(itemId, n);
});
$("#clearLightboxRating")?.addEventListener("click", () => {
  const itemId = $("#lightboxRatingSlider")?.dataset?.itemId || currentList[lightboxIndex]?.id || "";
  if (itemId) setItemRating(itemId, null);
});
$("#compareStage")?.addEventListener("input", e => {
  const slider = e.target.closest?.("[data-compare-rating][data-item-id]");
  if (!slider) return;
  const itemId = slider.dataset.itemId || "";
  const n = normalizeRatingValue(slider.value);
  const root = slider.closest(".compare-rating-control");
  const value = root?.querySelector(".compare-rating-value");
  const clear = root?.querySelector("[data-clear-compare-rating]");
  if (value) value.textContent = n == null ? "Unrated" : n.toFixed(1);
  if (root) root.classList.toggle("is-unrated", n == null);
  if (clear) clear.disabled = n == null;
  if (itemId && n != null) setItemRating(itemId, n);
});
$("#compareStage")?.addEventListener("click", e => {
  const clear = e.target.closest?.("[data-clear-compare-rating][data-item-id]");
  if (!clear) return;
  const itemId = clear.dataset.itemId || "";
  if (itemId) setItemRating(itemId, null);
});
$("#lightboxCollections")?.addEventListener("click", async e => {
  if (!e.target.closest("#lightboxAddCollection")) return;
  const a = currentList[lightboxIndex];
  if (!a) return;
  const cols = sortedCollections();
  if (!cols.length) { await createCollectionPrompt(); return; }
  const nameList = cols.map((c, i) => `${i + 1}: ${c.name}`).join("\n");
  const raw = prompt(`Add this item to collection number:\n${nameList}`);
  const idx = Math.max(0, Number(raw || 0) - 1);
  const col = cols[idx];
  if (!col) return;
  const ids = new Set(state.itemCollections[a.id] || []);
  ids.add(col.id);
  state.itemCollections[a.id] = Array.from(ids);
  await saveCollectionsState();
  renderLightbox();
  const card = cardNodeForId(a.id);
  if (card) card.replaceWith(createCardNode(a));
});

$("#compareSelected")?.addEventListener("click", e => openCompareFromSelection(e));
$("#miniCompareSelected")?.addEventListener("click", e => openCompareFromSelection(e));
$("#closeCompare")?.addEventListener("click", closeCompare);
$("#compareModal")?.addEventListener("click", e => { if (e.target === $("#compareModal")) closeCompare(); });
$("#compareRailA")?.addEventListener("click", e => { const btn = e.target.closest("[data-compare-side][data-id]"); if (btn) setCompareSide("a", btn.dataset.id); });
$("#compareRailB")?.addEventListener("click", e => { const btn = e.target.closest("[data-compare-side][data-id]"); if (btn) setCompareSide("b", btn.dataset.id); });
$("#compareModeSide")?.addEventListener("click", () => setCompareMode("side"));
$("#compareModeReveal")?.addEventListener("click", () => setCompareMode("reveal"));
$("#compareSwap")?.addEventListener("click", swapCompare);
document.addEventListener("pointerdown", e => {
  const target = e.target.closest("#compareRevealHandle, #compareRevealBox");
  if (!target || !compareIsOpen() || compareState.mode !== "reveal") return;
  compareState.revealPointerId = e.pointerId;
  try { target.setPointerCapture?.(e.pointerId); } catch (_) {}
  e.preventDefault();
  scheduleCompareRevealMove(e.clientX);
}, { passive: false });
document.addEventListener("pointermove", e => {
  if (!compareState.revealPointerId || e.pointerId !== compareState.revealPointerId) return;
  e.preventDefault();
  scheduleCompareRevealMove(e.clientX);
}, { passive: false });
document.addEventListener("pointerup", e => {
  if (compareState.revealPointerId && e.pointerId === compareState.revealPointerId) compareState.revealPointerId = null;
}, { passive: true });

// v2.18: no automatic catalogue polling. Use Refresh new for captured/local updates.
refreshState().then(() => {
  startSourceKeepAlive();
  if (activeSource() === "local") return loadLocalDirectory({ choose: false, silent: true });
}).catch(() => {});



Object.keys(BUBBLE_TUNING_DEFAULTS).forEach(key => {
  const input = document.getElementById(`bubbleTuning_${key}`);
  input?.addEventListener("input", e => setBubbleTuningValue(key, e.target.value));
});
document.getElementById("bubbleTuningReset")?.addEventListener("click", resetBubbleTuningState);
document.getElementById("bubbleTuningCopyButton")?.addEventListener("click", async () => {
  updateBubbleTuningDebugUi();
  const text = bubbleTuningCopyText();
  try { await navigator.clipboard?.writeText(text); } catch {}
});
updateBubbleTuningDebugUi();

