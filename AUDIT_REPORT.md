# Parakeet — Full QA / Edge-Case Audit Report

**Date:** 2026-07-11
**Scope:** `parakeet-desktop` (Electron overlay), `parakeet-backend` (API), `parakeet-frontend` (Next.js website)
**Method:** Read-only source audit. No code was changed. Four parallel passes were run, each reading the actual implementation (main process, renderer hooks/components, backend routers/lib, frontend pages) and citing `file:line` evidence for every claim — not inferred from feature names. All severities below are this audit's judgment, not existing code comments.

> **Note on desktop CLAUDE.md context**: this is a solo-dev, pre-signing, unsigned-build product (`CLAUDE.md`) — several findings below (no code signing, no update UI) are consistent with a pre-launch product but are called out because the audit was explicitly asked to assess launch-readiness.

---

# DESKTOP APP

## 1. Window Management (6 snap positions)

| Edge Case | Currently Handled? | Severity if Not | Notes |
|---|---|---|---|
| Window moves to other screen when minimizing/restoring | ✅ | LOW | Standard Electron `minimize()`/`show()`/`focus()` (`src/main/index.ts:671, 1198-1201`) — no custom logic to misplace it. |
| Window position when display disconnected mid-session | ❌ | HIGH | No `display-removed` listener exists anywhere in `src/main/index.ts` (confirmed via grep; a comment at line 43 explicitly notes `display-metrics-changed` is deliberately not watched). `bringToFront()` never re-clamps `x/y` into a currently-valid display. Recovery requires a full relaunch. |
| Window position on app relaunch — does it persist? | ⚠️ | MEDIUM | The **named** snap position persists (`snap-pos` file, `src/main/index.ts:284-294`), but the display id is not — it's always recomputed against `screen.getPrimaryDisplay()`, so a window left on an external monitor reopens on the primary display after relaunch. |
| Multiple monitors, different resolutions/scaling | ✅ | — | `moveToSnap`/`window:move-to-display` (`src/main/index.ts:321-338, 799-814`) look up the target display's own `workArea` and clamp width per-display. |
| Snap position off-screen after display change | ❌ | HIGH | Same root cause as row 2 — no reactive recomputation when the current display disappears. |
| Window at bottom when dock auto-hides vs. always visible | ✅ | — | Uses `display.workArea`, which already nets out Dock reservation. |
| Retina vs non-Retina display scaling | ✅ | — | All coordinates are DIPs from `screen`/`getBounds()`; no manual scale-factor math needed. |

**Scale concern:** N/A — single-machine feature, no shared state.
**Missing:** `computeAppWidth()` is only computed once against the *primary* display at startup and never re-derived when the user moves the window to a differently-sized external display (`src/main/index.ts:44-48`).
**Recommendation:** (1) Add `screen.on('display-removed', ...)` to re-snap onto a remaining display. (2) Persist a display identifier alongside the named snap position. (3) Re-derive `appWidth` on `window:move-to-display`.

---

## 2. Multi-Monitor Support

| Edge Case | Currently Handled? | Severity if Not | Notes |
|---|---|---|---|
| Display disconnected while app is on it | ❌ | HIGH | Same gap as Feature 1 — no `display-removed` handler. |
| Display added while app is running | ❌ | LOW/MEDIUM | No `display-added` listener; new displays only appear in the picker on next popover open (`window:get-displays` is queried fresh on mount, `SessionOverlay.tsx:280-288`) — eventually consistent, not live. |
| Different DPI/scaling between monitors | ✅ | — | Per-display `workArea` lookups handle this without extra code. |
| App position after switching display configs (via UI) | ✅ | — | `window:move-to-display` recomputes the snap position against the target display and explicitly closes the popover first since its position is a screen-coordinate snapshot (`src/main/index.ts:799-814`). |
| Popover position near screen edge on any monitor | ✅ | — | `positionPopoverWindow()` clamps both axes with an 8px margin and flips growth direction as needed (`src/main/index.ts:172-212`). |

**Scale concern:** N/A.
**Missing:** Display list in the popover's Settings panel goes stale if a monitor is plugged/unplugged while the popover is open (`SettingsPanel`'s `getDisplays()` only runs once on mount).
**Recommendation:** Add `display-added`/`display-removed` listeners in main and push a live update to any open popover/settings panel.

---

## 3. Deep Link / Session Launch

| Edge Case | Currently Handled? | Severity if Not | Notes |
|---|---|---|---|
| App not running when link clicked | ✅ | — | `app.setAsDefaultProtocolClient` registers the protocol; URL is queued in `pendingProtocolUrl` and dispatched on `ready-to-show` (`src/main/index.ts:417-425, 1124-1146`). |
| App already running with active session | ❌ | HIGH | `App.tsx:297-304` calls `loadSession(id)` on **every** `protocol:session` event with no check for an already-running session, and `SessionOverlay` has no `key={session.id}` so it never remounts. A second deep link while a session is active can desync transcript-saving/billing/answers from the visible session with no user-facing error. Backend does block two `ACTIVE` sessions, but only via `status.activate`, which this path never re-invokes. |
| App in mini/pill mode when link clicked | ✅ | — | `loadSession` sets `view='session'`/`miniMode=false` and calls `forceShow()` (`App.tsx:282-289`). |
| Multiple links clicked rapidly | ⚠️ | MEDIUM | An in-flight guard/queue exists, but only the **last** queued URL survives — intermediate links are silently dropped (`src/main/index.ts:500-501, 576-645`). |
| Link clicked while app is loading | ✅ | — | `open-url`/`second-instance` check `app.isReady()` and queue otherwise (`src/main/index.ts:1109-1146`). |
| App minimized to dock when link clicked | ✅ | — | `bringToFront()` re-asserts visibility/always-on-top and un-hides the dock icon if not in stealth mode. |
| Invalid/expired session payload in link | ⚠️ | MEDIUM | Unparseable payloads only `console.error` silently. Parseable-but-stale session IDs do surface `'Session not found.'`/`'This session has already ended.'` (`App.tsx:284-286`). |
| Network offline when deep link fires | ❌ | **CRITICAL** | `verifyAuthToken` makes a live HTTP call; **any** failure (including simply being offline) is treated identically to "token invalid," and the code unconditionally calls `clearAuthState()`, which wipes the in-memory token, the cookie jar, **and deletes the persisted token file on disk** (`src/main/index.ts:120-139, 435-443, 600-624`). A transient network hiccup while handling a deep link force-logs-out a previously-authenticated user. |

**Scale concern:** N/A (client-side), but see Feature 15 for the auth architecture this interacts with.
**Missing:** Deep-link "already active session" desync has no remount guard at all.
**Recommendation:** (1) Distinguish "backend rejected token" from "request failed/offline" in `verifyAuthToken`; only clear auth state on the former. (2) Give `<SessionOverlay key={session.id}>` a stable key, or ignore `protocol:session` while a session is already running.

---

## 4. Session Lifecycle (start → active → end)

| Edge Case | Currently Handled? | Severity if Not | Notes |
|---|---|---|---|
| End session while AI is generating | ✅ | — | `endSession()` calls `ai.abort()`, which aborts the in-flight fetch; `AbortError` is swallowed cleanly. |
| Network drops mid-session | ⚠️ | MEDIUM | Ping/transcript-save failures are swallowed with no user-visible "you're offline" indicator; countdown timer keeps running client-side regardless of connectivity. |
| Session timer expires (30-min blocks) | ✅ | — | `handleTimerExpire` auto-extends for paid mode / ends for FREE mode client-side; backend's `sessionWatchdog.ts` independently force-ends FREE sessions past 10 min server-side as defense in depth. |
| Credits run out mid-session | ✅ | — | Client tears down cleanly and shows "Out of Credits"; backend deduction is atomic (`SELECT ... FOR UPDATE`) and force-ends the session server-side on hard-stop even if the client never calls back. |
| App crashes mid-session — stuck ACTIVE on backend? | ✅ (crash) / ⚠️ (clean quit) | LOW | Backend watchdog auto-ends any session with a stale heartbeat (>90s). But the desktop app has **no `before-quit`/`will-quit` handler** that ends the session synchronously — even a *clean* quit relies on the 90s watchdog, so a session stays billed/ACTIVE for up to 90s after a normal quit. |
| Multiple sessions open simultaneously | ✅ (server) / ❌ (client UX) | MEDIUM | Backend hard-blocks a second ACTIVE session with a `CONFLICT` error, but the desktop surfaces it as a generic "Activation failed: ..." string rather than a clear "you already have an active session, resume it?" UX. |
| Session created on desktop vs. browser — data consistency | ✅ | — | Both surfaces share the same `callSession` model, keyed by `callSessionId` regardless of origin. |

**Scale concern:** N/A directly, but the watchdog's full-table scan (see Feature 14) affects how many concurrent ACTIVE sessions can be tracked cheaply.
**Missing:** No `will-quit` handler ends the session on clean exit — relies entirely on watchdog timeout.
**Recommendation:** Add a synchronous "end session" call on `before-quit` when a session is active, rather than depending solely on the heartbeat timeout.

---

## 5. Audio Capture (system audio + mic)

| Edge Case | Currently Handled? | Severity if Not | Notes |
|---|---|---|---|
| No microphone connected | ⚠️ | MEDIUM | `getUserMedia` failure is caught and surfaces "Microphone unavailable..." + `stop()` (`useSystemAudio.ts:139-148`), but combined mic+system-audio partial-failure states aren't clearly disambiguated. |
| Microphone permission denied | ✅ | — | Same catch path surfaces a clear "Check microphone permission…" message pointing at System Settings. |
| Audio device changes mid-session (unplug headphones) | ❌ | HIGH | No `navigator.mediaDevices.ondevicechange` listener anywhere in the renderer, and no `track.onended` handler on mic/system tracks. If the OS silently swaps the default input or the selected device disappears, the app doesn't notice — no dead-air detection, no toast, no auto-reconnect. |
| System audio permission denied on macOS | ✅ | — | Falls back to mic-only with explicit permission guidance (`useSystemAudio.ts:110-121`). |
| Multiple audio devices — which one is used | ❌ | LOW/MEDIUM | Always OS default input, no `deviceId` constraint. A fully-built `MicSelector.tsx` device-picker exists but is **dead code** — never rendered by the live app. |
| Audio drops/reconnects during session | ⚠️ | MEDIUM | No stream-health monitoring; a muted/ended `MediaStreamTrack` is only recovered via a user-initiated mic/sys toggle, not automatically. |
| Very quiet / very loud audio (STT quality, clipping) | ❌ | LOW | Only `autoGainControl: true` on mic constraints; system audio has no gain control. PCM16 conversion hard-clamps with no clipping warning. |

**Scale concern:** N/A (client-side).
**Missing:** Transcript speaker attribution is **always** hard-coded `'SYSTEM'` at save time regardless of whether audio came from mic, system, or both (`SessionOverlay.tsx:1199, 1216, 1235`) — post-session transcripts always attribute everything to "SYSTEM" even in mic-only sessions.
**Recommendation:** (1) Add `ondevicechange`/`track.onended` handling with auto-recovery. (2) Wire up the existing (dead) `MicSelector` UI. (3) Fix speaker attribution to reflect actual source.

---

## 6. Speechmatics / Transcription (real-time WebSocket STT)

| Edge Case | Currently Handled? | Severity if Not | Notes |
|---|---|---|---|
| WebSocket disconnects mid-session — auto-reconnect? | ✅ (bounded) | — | Linear back-off retry, capped at 3 attempts (`useSpeechmatics.ts:28-29, 128-147`); after that, gives up with no further automatic recovery. |
| JWT expiry across reconnects | ❌ | **HIGH** | Reconnect reuses the **same cached JWT**, but the backend-issued JWT has only a **60-second TTL** (`callSession.ts:432`). Any reconnect attempt occurring more than ~60s after the JWT was minted will likely be rejected, silently exhausting all 3 retries — a permanent transcription outage until the user manually changes language or restarts the session. This is a structural bug, not just an edge case. |
| Very fast speech / heavy accent / multiple speakers / background noise | N/A (server-side) | — | Delegated to Speechmatics' `enhanced` operating point; no diarization surfaced client-side. |
| Long silence — connection timeout? | ⚠️ | LOW | No explicit client-side idle timeout; relies on Speechmatics' own server behavior. |
| Transcript continuity across reconnect | ⚠️ | MEDIUM | Sequence numbers reset on every reconnect with no resumption protocol — words spoken during the ~2-6s reconnect window are lost entirely, not buffered. |
| Rate limits on Speechmatics API | ❌ | LOW | Errors are not differentiated by type; combined with the JWT issue above, a rate-limit error would also exhaust retries without a fresh-JWT retry. |

**Scale concern:** JWTs are minted per-activate/per-language-change via a live outbound call with a 60s TTL — at higher concurrent session-start volume this adds latency to the activation path, and the reconnect-reuse bug above gets **worse** under load (more frequent transient WS drops at scale = more silent outages).
**Missing:** none beyond the above.
**Recommendation:** **Highest-impact fix in the whole desktop audit** — have the reconnect path fetch a *fresh* JWT (mirroring the language-change flow) instead of reusing the cached one.

---

## 7. AI Answer Generation (streaming SSE)

| Edge Case | Currently Handled? | Severity if Not | Notes |
|---|---|---|---|
| Network drops mid-stream | ⚠️ | MEDIUM | Non-abort errors are caught and surfaced, but the **partial answer text already streamed is discarded**, not saved as a partial answer — the user loses whatever had already rendered. |
| AI API rate limit hit | ✅ | — | Backend caps at 15 req/min/user, returns 429 with a friendly message; client surfaces it via a generic "AI error: ..." string. |
| AI API returns error (500, timeout) | ✅ | — | Backend catches and returns either a JSON 500 or an SSE `{error}` event depending on whether headers were already sent; client handles both paths. |
| Very long answer generation (>30s) | ⚠️ | LOW | No client-side timeout/deadline on the fetch — a hung backend stream can leave "Answer" disabled indefinitely with no automatic recovery (user can still manually retrigger, which aborts first). |
| User clicks Answer again while generating | ✅ | — | `ask()` aborts any in-flight request first. |
| User ends session while generating | ✅ | — | Same abort path as Feature 4. |
| Model switched mid-generation | ✅ | — | In-flight stream continues with the model it started with; no crash, next request picks up the new model. |
| Context window exceeded on very long session | ✅ | — | Backend auto-summarizes history past 10 exchanges, sending only the tail + summary — see Feature 13 for a caveat on the summary-update race. |

**Scale concern:** SSE responses hold a Node HTTP connection open for the full generation duration with no server-side timeout — see backend scale notes (Feature 14) for connection-pool exhaustion risk under concurrent long generations.
**Missing:** none beyond the above.
**Recommendation:** Persist partial streamed text as a best-effort partial answer on network-drop, so the user doesn't lose already-generated content.

---

## 8. Screenshot Capture (single + queue)

| Edge Case | Currently Handled? | Severity if Not | Notes |
|---|---|---|---|
| Permission denied for screen capture | ✅ | — | Clear "check Screen Recording permission" message on catch (excluding user-cancelled picker). |
| Screenshot of protected/DRM content | ❌ | LOW | Not addressed — Chromium/OS would return a black/blank frame with no detection or warning. |
| Very large screenshot (memory) | ❌ | LOW/MEDIUM | No downscaling before JPEG/base64 encoding — a 5K/6K screenshot is fully captured and encoded before any size check; backend then rejects oversized images with a generic "Invalid request" after the (slow) client-side work is already done. |
| Screenshot taken on wrong display | ❌ | HIGH | `setDisplayMediaRequestHandler` **always** resolves with `sources[0]` from `desktopCapturer.getSources()` — it never checks which display the app/user is actually on. On multi-monitor setups (which the app explicitly supports via a display-move feature), a screenshot silently captures the *wrong* monitor, so the AI gets the wrong screen's contents with no indication to the user. |
| Queue fills up (>5 screenshots) | ❌ | MEDIUM | No client-side cap — the backend rejects requests with >5 images with a generic 400 that fails the **entire** request (including the valid images within the limit), with no client-side warning or way to know which to drop. |
| Screenshot sent with no question | ✅ | — | Defaults to "Analyze this screenshot and provide relevant interview assistance." when the question field is empty but screenshots exist. |

**Scale concern:** The "wrong display" bug scales its impact linearly with the fraction of users on multi-monitor setups — worth fixing before it becomes a recurring support issue.
**Missing:** none beyond the above.
**Recommendation:** (1) Fix `setDisplayMediaRequestHandler` to match the display the main window is currently on (`screen.getDisplayMatching`, already used elsewhere in the codebase) instead of hardcoding `sources[0]`. (2) Cap the client-side screenshot queue at 5 to match the backend limit, with a clear toast.

---

## 9. Hamburger Popover (separate window)

| Edge Case | Currently Handled? | Severity if Not | Notes |
|---|---|---|---|
| Popover at all 6 snap positions | ✅ | — | Growth direction (up/down) is derived from the current snap position and passed to the popover window. |
| Popover near screen edges on any monitor | ✅ | — | Same edge-clamping logic as Feature 2. |
| Display switch while popover open | ❌ | MEDIUM | The display list is only fetched once on mount — plugging/unplugging a monitor while the popover is open leaves it stale until closed and reopened. |
| Multiple rapid clicks on hamburger | ✅ | — | A synchronous ref-based toggle prevents duplicate popover windows from spawning. |
| Popover window crashes/errors | ⚠️ | MEDIUM | `did-fail-load` is logged, but there's no `render-process-gone` handler — if the popover's renderer actually crashes (not just fails initial navigation), the hamburger button appears to do nothing forever until app restart. The "report-height never arrives" case, however, is well handled with a sane default-height fallback. |
| Settings change while AI generating | ✅ | — | All popover actions are plain state setters that don't touch the in-flight AI stream — no observed race. |

**Scale concern:** N/A.
**Missing:** No recovery path if the popover's renderer process dies.
**Recommendation:** Add a `render-process-gone` handler that recreates the popover window automatically.

---

## 10. Mini Pill / Hide Mode

| Edge Case | Currently Handled? | Severity if Not | Notes |
|---|---|---|---|
| Pill position after display change | ❌ | HIGH | Position is tracked entirely in renderer `localStorage`, restored with a raw `setPosition(x,y)` call — **no bounds/display validation**. If the display it was on is gone, it can restore fully or partially off-screen. |
| Cmd+H shortcut conflicts | ❌ | HIGH | `CommandOrControl+H` is globally registered for toggle-collapse. On macOS, Cmd+H is the **system-wide "Hide current application"** shortcut — registering it OS-wide means the user loses native Hide everywhere (not just in this app) for as long as it's running, with no conflict detection or warning. |
| Restore from pill while session ending | ⚠️ | LOW | Session end doesn't clear `miniMode`, so the pill keeps rendering (now inert) until the user clicks it — a missed-notification UX gap, not a crash. |
| Pill dragged off screen | ❌ | MEDIUM | Drag handling applies raw deltas with **no clamping to any display bounds**, and the off-screen position is then persisted to `localStorage`, making it unreachable on next launch too. |
| Pill on wrong display after monitor change | ❌ | MEDIUM | Same root cause as row 1 — absolute `x,y` in `localStorage` has no display-awareness. |

**Scale concern:** N/A.
**Missing:** `minibar-position` (localStorage) and `overlay-snap-pos` (main-process file) are two separate, uncoordinated persistence stores that can drift out of sync.
**Recommendation:** Clamp both the drag and restore paths to the current display's work area, and persist a display identifier alongside the raw coordinates (top overall recommendation for this cluster, shared with Features 1/2).

---

## 11. Keyboard Shortcuts

| Edge Case | Currently Handled? | Severity if Not | Notes |
|---|---|---|---|
| Shortcut conflicts with other apps | ⚠️ | HIGH | The "bring to front" shortcut has a well-designed 4-accelerator fallback chain. The other ~8 shortcuts are registered blind with only a console warning on failure — no fallback or user notification if they're already claimed system-wide. Windows' extra `Control+Shift+I` bind also collides with the native browser DevTools shortcut for the whole OS session. |
| Shortcuts when app in background | ✅ | — | `globalShortcut` is OS-level by design; handlers fire regardless of focus. |
| Shortcuts when app in mini mode | ⚠️ | LOW | Listeners stay mounted (intentionally, so background audio/AI keep running) but fire with no visual acknowledgment while collapsed. When no session is active, listeners aren't mounted at all — safe no-op. |
| Shortcuts when session not active | ✅ | — | Listeners simply aren't mounted outside an active session. |
| Accessibility permission not granted | ⚠️ | MEDIUM | Checked and re-prompted, but only console-logged — no renderer-facing banner warning the user that shortcuts may silently fail to *fire* even when registration succeeded. |
| Windows vs Mac shortcut differences | ✅ | — | `CommandOrControl` used throughout; each OS gets its platform-specific extras (accessibility check on Mac, extra binding on Windows). |

**Scale concern:** N/A.
**Missing:** none beyond the above.
**Recommendation:** Reconsider `CommandOrControl+H` given it silently hijacks macOS's system Hide shortcut; surface a renderer banner when a shortcut fails to register or when accessibility permission is missing.

---

## 12. Auto-Update (electron-updater)

| Edge Case | Currently Handled? | Severity if Not | Notes |
|---|---|---|---|
| Update available mid-session | ❌ | HIGH | `checkForUpdatesAndNotify()` runs exactly once, 5s after launch, with no periodic re-check and no session-aware deferral. `autoInstallOnAppQuit=true` means a completed download installs silently on next quit with **zero in-app UI** anywhere (confirmed via grep — no update-related strings in the renderer). All update events are `console.log`-only, invisible in a packaged build. |
| No internet for update check | ⚠️ | LOW | Failure is caught (no crash) but silent — indistinguishable from "no update available." |
| Corrupted update download | ✅ | — | electron-updater verifies checksums internally before installing; the app doesn't override this. |
| User on old version, breaking API changes | ❌ | MEDIUM | No app-side minimum-supported-version check — failures only surface as generic API errors, not a "please update" prompt. |

**Scale concern:** The app's `package.json` publishes to a **private** GitHub repo. electron-updater's GitHub provider typically needs a public repo or an embedded token to fetch private release assets at check time — no such token is referenced anywhere in runtime code. If this silently 404s, it's not a per-user issue — it could mean **no end user** is receiving updates at all, masquerading as a per-machine problem. **This should be verified against a real packaged build before the next release.**
**Missing:** none beyond the above.
**Recommendation:** (1) Verify update checks actually succeed against the private repo in a real packaged build. (2) Build minimal update UX (a toast: "Update ready — will install on restart") instead of console-only logging. (3) Add a session-aware deferral so updates don't install mid-interview.

---

# BACKEND

## 13. AI Context / System Prompt (resume, JD, extra context, history)

| Edge Case | Currently Handled? | Severity if Not | Notes |
|---|---|---|---|
| Resume very long (>20k chars) — token limit | ❌ | **CRITICAL** | `buildSystemPrompt` only sanitizes (tag-strips), never length-caps or token-counts. Upload only caps file *size* (20MB), not extracted text length — `Resume.parsedContent` is unbounded text in the DB. A large PDF can inject 100k+ chars into the prompt with no truncation, risking a provider context-window overflow that surfaces only as a generic 500. |
| JD very long | ❌ | HIGH | `jobDescription` has **no max length** in the zod schema (unlike `question`/`extraContext`, both capped at 10,000 chars). The auto-scraper path caps at 8,000 chars, but manual paste has no limit. |
| No resume attached | ✅ | — | `resumeId` is optional; the prompt only includes a background section if content is present. |
| No JD provided | ✅ | — | Blocked at input validation (`min(1)`). |
| Extra context very long | ✅ (partial) | LOW | Capped at 10,000 chars, but not coordinated with the uncapped resume/JD — the three fields combined can still exceed a safe token budget. |
| Conversation history >50 exchanges | ✅ | — | Well-designed: older messages fold into a running summary past 10 exchanges, keeping only the 8 most recent verbatim — bounds token growth regardless of session length. |
| Summary generation fails — fallback | ⚠️ | MEDIUM | Fails safely (fire-and-forget, doesn't break live chat), but the message-count cursor isn't advanced on failure — repeated failures compound the un-summarized batch size, which could itself eventually exceed the summarizer's own context window. |
| Cache invalidation race conditions | ⚠️ | MEDIUM | Correct for a single instance, but the prompt cache is an in-process `Map` — the code's own comment acknowledges it wouldn't be safely shared if horizontally scaled. |
| Multiple simultaneous requests, same session | ❌ | HIGH | No per-session lock. Two concrete races found: (1) the conversation-summary read-modify-write has no row lock (unlike the careful pattern in credit deduction) — classic lost-update under concurrent summarization triggers. (2) The "regenerate" flow's delete-last-two-messages step can race a concurrent normal request's inserts on the same session. |

**Scale concern:** Prompt cache and rate limiting are per-process in-memory state — safe today at single-instance scale, but would silently break (stale cache served, rate limits multiplied by instance count) the moment the backend is horizontally scaled.
**Missing:** No code path ever upgrades a user to a `PRO` plan — Stripe checkout is one-time payment only; subscription webhook events aren't handled, so `Subscription` model / plan-bypass logic is currently dead/unreachable in production.
**Recommendation:** (1) Cap `jobDescription` and resume/document text length (mirror the existing 10k-char cap) with truncation before the model call. (2) Wrap summary read-modify-write in a transaction with row locking, matching the credit-deduction pattern.

---

## 14. Session Management (Backend) — credits, timers, billing

| Edge Case | Currently Handled? | Severity if Not | Notes |
|---|---|---|---|
| Credits hit 0 mid-answer generation | ✅ | — | Billing is time-based (not per-message), so nothing needs interrupting mid-stream by design. Deduction is atomic (`SELECT ... FOR UPDATE` in a transaction); a hard-stop immediately ends the session server-side. Verified both desktop and web clients tear down cleanly and show an "Out of Credits" UI. |
| Multiple devices, same session | ❌ | **CRITICAL** | `takeOver` unconditionally overwrites the lock owner **without ever reading the previous value**, and always reports "not locked by another client" — it cannot actually detect or block a second device. The "one active session per user" check only blocks two *different* session IDs, not the same session opened twice. Separately, `User.activeSessionToken` — explicitly commented in the schema as "single device enforcement" — is **never read or written anywhere in the codebase**: fully dead code. |
| Session auto-extend fails (payment issue) | ⚠️ | MEDIUM | Server-side is correctly typed (real hard-stop vs. other errors), but both desktop and web clients treat **any** rejection of the extend call identically — a transient network blip during auto-extend would incorrectly end a session the user still has balance for, same as a real "out of credits." |
| Very long session (4+ hours) | ⚠️ | LOW | No hard cap on paid session duration by design (pay-as-you-go via repeated extends); watchdog only ends on missed heartbeat or FREE-mode's 10-min cap. Not a defect. |
| Database connection drops mid-session | ❌ | HIGH | No retry/backoff around any Prisma call in the hot paths. Specifically: the assistant's answer is persisted **after** the SSE response has already ended — if that write fails, the answer the user already saw streamed to their screen is silently **never saved** to history, with no user-visible error. |
| Concurrent writes to AIMessage table | ⚠️ | MEDIUM | No de-duplication/idempotency key on message inserts — combined with the device-lock gap above, two concurrent requests from two devices on the same session produce duplicated/interleaved history rather than a hard conflict error. |

**Scale concern (biggest single finding in the audit):** **No non-unique indexes exist anywhere in the schema** — every index backs only a `@unique`/`@id` constraint. There is no index on `CallSession.userId`, `CallSession.status`, `CallSession.lastPingAt` (exactly what the 60-second watchdog filters on), `AIMessage.callSessionId` (queried on every single chat/completion request), `Transcription.callSessionId`, `CreditTransaction.userId`, `Resume.userId`, or `Document.userId`. Every hot-path query degrades to a sequential scan as tables grow — this is the single biggest scale risk found across all three codebases. Additionally: no DB connection pool tuning (bare `new PrismaClient()`, no `connection_limit`/pgbouncer params), and SSE responses hold a connection open for the full generation duration with no server-side timeout — this pool will likely exhaust well before 1,000 concurrent users.
**Missing:** `chat.ts` persists the assistant's answer **after** the stream has already ended to the client — a late DB failure silently drops an answer the user already saw.
**Recommendation:** (1) Add indexes: `CallSession(userId, status)`, `CallSession(status, lastPingAt)`, `AIMessage(callSessionId, createdAt)`, `Transcription(callSessionId)`, `CreditTransaction(userId)` — cheapest, highest-leverage fix before any load test. (2) Make device/session-conflict enforcement real (wire up `activeSessionToken` or fix `takeOver` to actually compare against the existing lock owner). (3) Add DB connection pool configuration.

---

## 15. Auth / Security — Google OAuth + NextAuth

| Edge Case | Currently Handled? | Severity if Not | Notes |
|---|---|---|---|
| Token expires mid-session | ⚠️ | MEDIUM | JWT `maxAge` is 7 days. The plumbing to re-check a revocation flag on every request exists — but see below, the flag is never written, so in practice a token is valid unconditionally for the full 7 days with no refresh/silent-renewal endpoint. |
| User signs out on website while desktop active | ❌ | **CRITICAL** | Session strategy is stateless `jwt` — there is no server-side session store to revoke. Website sign-out only clears the browser's local cookie; it does **not** invalidate the JWT itself. The desktop app copies the raw JWT via deep link into its own persistent cookie jar and keeps using it — fully valid against the backend — for up to 7 days regardless of website sign-out. The one mechanism that could close this gap (`forcedLogoutAt`) is read in the auth code but **never written anywhere in the codebase**. |
| Same account, two desktop instances simultaneously | ❌ | HIGH | Same root cause as Feature 14's device-lock gap — JWTs have no single-use/device binding, so both instances can independently authenticate and drive sessions concurrently. |
| Deep link with invalid auth token | ✅ (partial) | — | The desktop client validates the token at receipt via a live session-check call. Gap: on app **restart**, a previously-saved token is reloaded from disk and replayed without re-validation — an invalidated/stale token is only caught the moment a real API call 401s, not proactively. |
| CORS issues on different networks | ✅ | — | Origin-based allowlist (frontend URL + Electron's `"null"` origin + dev localhost) with per-request echoed `Access-Control-Allow-Origin` and explicit `OPTIONS` handling — switching networks doesn't affect it. |

**Scale concern:** N/A directly, but see Feature 14 for the shared device-lock infrastructure gap.
**Missing:** none beyond the above.
**Recommendation (most severe single finding in the whole audit):** Implement real sign-out propagation — wire an explicit sign-out endpoint (and/or admin action) that writes `forcedLogoutAt`, so "signing out on the website" actually invalidates the desktop app's copy of the token instead of being a dead schema field that gives a false sense of security.

---

# FRONTEND (WEBSITE)

## 16. Session Creation (NewSessionModal + resume upload)

*Architecture note: resume file upload is not inside the session-creation modal itself — the modal only **selects** a previously-uploaded resume; the actual upload happens on the separate Resumes page.*

| Edge Case | Currently Handled? | Severity if Not | Notes |
|---|---|---|---|
| Very long resume upload (huge file) | ✅ | — | 20MB cap enforced server-side by `formidable`; parse is aborted and the frontend shows an error toast. |
| Unsupported file format | ⚠️ | MEDIUM | The `<input accept>` hint is not enforced; server-side MIME validation trusts the **client-supplied** `Content-Type` header rather than sniffing actual file bytes. A renamed file with a spoofed MIME type would pass the allow-list and only fail later at parse time with a generic error — functionally handled (rejected with a toast) but weaker validation than it appears. |
| Resume parsing fails (corrupt/scanned PDF) | ✅ | — | Parse errors are caught with a generic message; the common "scanned image, no extractable text" case gets a specific, friendly error. |
| No JD provided | ✅ | — | Blocked client-side (toast + disabled Next button) and re-validated server-side — defense in depth. |
| Context field very long ("now unlimited") | ✅ (confirmed unlimited) | — | Confirmed genuinely unlimited on both the `<textarea>` (no `maxLength`) and the backend schema (no `.max()`). Downstream, this content is spliced into the LLM prompt with **no truncation** — same root cause as backend Feature 13's CRITICAL finding. |
| Slow network during file upload | ⚠️ | LOW | No progress percentage and no client-side timeout — eventually resolves or errors, just no feedback for large files on slow connections. |
| User navigates away mid-upload | ❌ | LOW | No `AbortController` tied to unmount — the upload silently continues/completes in the background with no UI feedback and no cancellation path. Self-healing, not harmful. |

**Scale concern:** Upload is rate-limited (20/hour/user) and size-capped — no obvious per-request cost problem. The real cost risk is the unlimited-context issue shared with backend Feature 13.
**Missing:** MIME-type spoofing is possible (not currently exploited for anything dangerous since files are only parsed for text, never executed).
**Recommendation:** (1) Add an explicit, sane max length to the Extra Context field on both client and server. (2) Sniff file bytes/magic numbers server-side instead of trusting client-supplied MIME type. (3) Add upload cancellation on navigation-away.

---

## 17. Dashboard — session history, replay

| Edge Case | Currently Handled? | Severity if Not | Notes |
|---|---|---|---|
| Very many sessions (pagination) | ✅ (list page) / ⚠️ (overview page) | MEDIUM | The dedicated sessions list page has real server-backed pagination (page size 10, capped at 100/request). **However**, the dashboard overview page fetches only the first 100 sessions and derives its "Sessions created" and "AI minutes used" stat cards from that capped local array **instead of the API's own `total` field** — this is a real, currently-reachable bug: any user with >100 sessions sees frozen/undercounted stats, not a theoretical scale ceiling. |
| Session with no answers (empty state) | ✅ | — | Explicit, friendly empty states exist at both the transcript-tab level and the session-list level. |
| Long session with 100+ Q&A pairs | ❌ | MEDIUM | No virtualization anywhere (confirmed no windowing library in the repo) — the transcript modal does a plain `.map()` over the full merged feed. The underlying backend queries (`transcription.get`, `aiMessages.get`) are also **unbounded** — no `take`/pagination — so a long interview (continuous transcription saved every 5s) can return and render thousands of rows in one response. Not a crash, but a real performance cliff for marathon sessions. |

**Scale concern:** The two structural risks above — the overview-stats bug (incorrect data, live today) and unbounded transcript/message queries (real perf cliff for long sessions, worse as usage grows) — are the dashboard's main exposure. Otherwise reasonably well protected (rate-limited uploads, credit-gated session creation).
**Missing:** none beyond the above.
**Recommendation:** (1) Fix the overview dashboard to use the API's `total` count instead of `array.length` on a capped fetch. (2) Add `take`/cursor pagination to the transcript/message backend queries and virtualize (or lazy-load) the modal's feed render.

---

# FINAL SUMMARY

## 1. CRITICAL — must fix before launch

| # | Issue | Where |
|---|---|---|
| 1 | **Website sign-out doesn't revoke the desktop app's session.** JWT strategy has no server-side revocation; `forcedLogoutAt` is read but never written anywhere. A user who signs out on the website (e.g. on a shared/public computer) leaves the desktop app fully authenticated for up to 7 days. | Backend Feature 15 |
| 2 | **No real single-device/session-lock enforcement.** `takeOver` always overwrites the lock without checking the previous owner and always reports "not locked." `User.activeSessionToken` is dead code. Two devices (or two instances) can drive the same session/account concurrently, corrupting conversation history and billing state. | Backend Features 14 & 15 |
| 3 | **Resume/JD content has no length cap or token budget before hitting the LLM.** A large resume or pasted JD/extra-context can overflow the model's context window, surfaced only as a generic 500. Extra-context field is confirmed genuinely unlimited end-to-end. | Backend Feature 13, Frontend Feature 16 |
| 4 | **A network blip during deep-link auth verification force-logs-out the user**, deleting the persisted auth token from disk. "Couldn't reach backend" and "token is invalid" are treated identically. | Desktop Feature 3 |

## 2. HIGH — fix soon

- Speechmatics WebSocket reconnect reuses a JWT with only a 60s TTL — reconnects delayed past that window silently and permanently fail (Desktop Feature 6).
- Second session deep-link while one is already active desyncs the UI from the actual running session — no remount guard (Desktop Feature 3).
- No display-disconnect handling anywhere (window snap, multi-monitor, mini pill all share this root cause) — window/pill can end up off-screen with no recovery short of relaunch (Desktop Features 1, 2, 10).
- Screenshot capture always grabs the OS-default display, ignoring which monitor the app/user is actually on — wrong-screen screenshots on multi-monitor setups (Desktop Feature 8).
- No audio-device-change detection (headphones unplugged mid-session) — silent audio loss with no recovery (Desktop Feature 5).
- `Cmd+H` global shortcut hijacks macOS's system-wide "Hide app" shortcut for the whole OS session, with no conflict detection anywhere (Desktop Features 10, 11).
- Auto-update runs once, silently, with zero in-app UI, and publishes to a private GitHub repo whose update-check auth path is unverified — could mean **no** end user is receiving updates (Desktop Feature 12).
- No transaction/row-lock around conversation-summary updates, unlike the correctly-atomic credit deduction — concurrent requests to the same session can lose an update (Backend Feature 13).
- Assistant answers are persisted to the database **after** the SSE stream has already ended to the client — a DB hiccup silently drops an answer the user already saw, with no retry (Backend Feature 14).
- **No non-unique indexes anywhere in the database schema** — every hot-path query (watchdog, chat history, transcripts) will degrade to sequential scans as data grows (Backend Feature 14 — see Scale Bottlenecks below).
- `JD` field has no max length while every sibling field does (Backend Feature 13).

## 3. MEDIUM / LOW — nice to have

- No `will-quit` handler ends the session synchronously on clean app exit; relies on a 90s watchdog timeout (Desktop Feature 4).
- No user-visible "you're offline" indicator during a session; countdown timer keeps running regardless of connectivity (Desktop Feature 4).
- Client-side screenshot queue has no cap, so the 6th screenshot fails the *entire* send with a generic error (Desktop Feature 8).
- Popover doesn't recover automatically from a renderer-process crash (Desktop Feature 9).
- Mini-pill can be dragged fully off-screen and that position persists across launches (Desktop Feature 10).
- Accessibility-permission and shortcut-registration failures are console-log only, invisible to the user (Desktop Feature 11).
- Transcript speaker attribution is hard-coded to `'SYSTEM'` regardless of actual audio source (Desktop Feature 5).
- Dead code: `MicSelector.tsx` device picker is fully built but never rendered (Desktop Feature 5); `Subscription`/PRO-plan logic is unreachable since Stripe webhook only handles one-time payments (Backend Feature 13).
- Dashboard overview stats silently cap/undercount for users with >100 sessions — live bug, not hypothetical (Frontend Feature 17).
- No virtualization/pagination for long-session transcripts — real perf cliff, not a crash (Frontend Feature 17).
- Resume MIME-type validation trusts client-supplied header rather than sniffing file bytes (Frontend Feature 16).
- In-memory rate limiting and prompt cache are per-process — fine today, will silently break the moment the backend is horizontally scaled (Backend Feature 13/14).

## 4. Scale bottlenecks — what breaks first at scale

Ranked by how early they'd bite as usage grows:

1. **Missing database indexes** (Backend Feature 14) — the single biggest structural risk found. `CallSession`, `AIMessage`, `Transcription`, and `CreditTransaction` all have zero non-unique indexes despite being queried on every chat request and every 60-second watchdog tick. This degrades gracefully-looking-fine → suddenly-terrible as row counts grow, and is the first thing that would show up under any real load test.
2. **No DB connection pool tuning**, combined with SSE responses holding a connection open for the full duration of every AI generation — pool exhaustion is a realistic risk well under 1,000 concurrent users on current configuration.
3. **In-memory rate limiting and prompt caching** are per-process. The system works correctly today because the backend runs as a single instance; the moment it's horizontally scaled, rate limits silently multiply by instance count (abuse-protection gap) and cache invalidation stops being reliable across instances (stale prompts served).
4. **Unbounded transcript/message queries** on the dashboard and in `buildMessageHistory` — no `take`/pagination, so a single very long session can return and render thousands of rows in one response, and this gets more common as users run longer sessions over time.
5. **Speechmatics JWT minting is a live external call per session-activate/language-change** with only a 60s TTL — at higher concurrent session-start volume this adds latency to the critical activation path, and the (currently broken) reconnect-JWT-reuse bug gets materially worse the more concurrent sessions experience transient network drops.

## 5. Overall app stability score

**5.5 / 10 — functional and thoughtfully built in several places (atomic credit deduction, conversation summarization, snap-position/multi-display math, deep-link queueing) but not launch-ready for a paid, multi-user product.**

What holds it back from a higher score:
- Two **CRITICAL security/integrity gaps** (no real sign-out propagation to desktop, no real single-device enforcement) that undermine the basic trust model of an authenticated, billed product — these aren't edge cases, they're core guarantees that don't currently hold.
- A **CRITICAL cost/reliability gap** (unbounded LLM context) that can cause outright request failures or unexpected AI provider cost, not just degraded UX.
- The database has **zero indexes** outside of unique constraints — this alone means the product is not close to being scale-tested, regardless of how correct the business logic is.
- Several HIGH-severity desktop bugs (Speechmatics reconnect, screenshot wrong-display, multi-monitor disconnect handling) directly break the product's core promise (uninterrupted real-time transcription/assistance during a live interview) under conditions (interview happening on a laptop connected to an external monitor, headphones unplugging, brief WiFi hiccup) that are common in real interview settings, not rare.

What's genuinely solid: the credit-deduction concurrency model (`SELECT ... FOR UPDATE`), the conversation-summarization design for long sessions, the snap/multi-display coordinate math, CORS handling, and the defense-in-depth pattern between client and server validation (JD required, credits, session-timer) that shows up repeatedly. The fixes above are for the most part narrow and well-localized — this reads as a codebase that needs a focused hardening pass, not a rewrite.
