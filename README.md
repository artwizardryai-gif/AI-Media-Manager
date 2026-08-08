# AI Media Manager

## v2.32.98 — Share-ready Help and naming

- Renamed the extension to **AI Media Manager**.
- Keeps the HAR-verified v2.32.97 Grok Imagine history sync unchanged.
- Removes the redundant main-page **Refresh** button; press **Connect** again to discover new source media.
- Adds a three-tab Help dialog: Media Manager, Comic Canvas, and Privacy & Data.
- Documents selections, custom Collections, ratings/ranking, filtering, Compare, downloads, Local Files, organizer backups and cache behavior.
- Documents Comic Canvas panel/crop/bubble workflows and common keyboard/mouse gestures.
- Explains that no OpenAI/xAI developer API key is required and the extension never asks the user to enter an account password.

## v2.32.97 HAR-verified Imagine history

- Uses the exact conversation-list query observed in the user HAR: `kind=CONVERSATION_KIND_IMAGINE`.
- Paginates every conversation page via `pageToken`.
- Reads `latestAssetMetadata` directly from every conversation page.
- Fetches full conversation histories with the exact observed responses query: `conversationKind=CONVERSATION_KIND_IMAGINE`.
- Fetches response histories with bounded concurrency 24; no sleeps or polling.
- Ingests only Grok model-generated root assets; self-upload/reference assets are excluded.

## v2.32.97 HAR-Verified Imagine History

- Keeps the fast direct conversation connection from v2.32.95.
- Recursively discovers response containers at any JSON depth, including JSON-encoded strings.
- Prefers authoritative `fileAttachmentAssetMetadata`.
- Falls back to `fileAttachmentsMetadata` only for ASSISTANT Imagine responses, because Grok can label generated outputs there as `SELF_UPLOAD_FILE_SOURCE`.
- Uploaded/user input attachments are not ingested.
- Adds detailed parser counters without adding sleeps or polling.

## v2.32.97 HAR-Verified Imagine History

- Rebuilds Grok sync around `/rest/app-chat/conversations?...conversationKind=CONVERSATION_KIND_IMAGINE` and each conversation's `/responses`.
- Parses authoritative `fileAttachmentAssetMetadata` relative keys (`users/.../generated/...`) instead of searching only absolute asset URLs.
- Keeps only `IMAGINE_GENERATED_FILE_SOURCE` + `isModelGenerated=true` + `isRootAssetCreatedByModel=true`.
- Uploaded/reference metadata is not ingested.
- Fetches all conversation responses concurrently and merges the catalog once.
- No Grok page hook, source enum feeds, network capture, polling jobs, or artificial sleeps.
- Reuses an existing Grok tab; opens `/imagine/saved` only if none exists.

## v2.32.97 Imagine asset capture debug

- Restores all known Grok `MEDIA_POST_SOURCE_*` categories using full enum names.
- Every source is filtered to concrete private generated URLs under `assets.grok.com/users/.../generated/...`.
- Discover/public fallback results are counted in diagnostics but not merged into the catalog.
- Keeps direct Imagine conversation diagnostics and passive generated-asset fallback.

## v2.32.82 Imagine history runtime fix

- Directly queries `/rest/app-chat/conversations?pageSize=60&excludeProjects=true&conversationKind=CONVERSATION_KIND_IMAGINE`.
- Replays only conversation IDs returned by that list through `/responses?includeThreads=false`.
- Keeps only concrete private `assets.grok.com/users/.../generated/...` media from Imagine history and SAVED/LIKED.
- Skips `imagine-public.x.ai` Discover/public media from SAVED/LIKED so cache rebuilds do not repopulate Discover items.
- No scrolling, hover, or speculative source enum probing.