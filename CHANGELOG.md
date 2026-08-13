# Changelog

## v2.0.0 — MVP Release (August 2026)

### AI & Models
- Added 4 free NVIDIA NIM models: Llama 3.3 70B, Qwen 2.5 Coder, Nemotron 49B, Llama 3.1 8B
- Fixed AI answer generation (SSE streaming rebuilt for Electron's Chromium)
- Smart context memory for long sessions (summary + recent window)
- Improved interview persona system prompt

### Design
- New app logo everywhere (toolbar, mini pill, dock, app icon)
- Transparent mini pill — logo + countdown timer floating on desktop (no background)
- Quick model switcher from toolbar badge (focused popup)
- Compact hamburger menu with model dropdown (optgroups for paid/free)
- Tooltips on all toolbar buttons
- Semi-transparent overlay (65% opacity default)

### Reliability
- Network-safe auth — no logout on wifi blip
- Single-device session enforcement with heartbeat
- Speechmatics auto-reconnect with fresh JWT on disconnect
- External display disconnect recovery (moves to primary screen)
- Screenshot captures correct monitor (not always primary)
- Audio device change handling while recording

### Infrastructure
- Migrated backend from Railway to Fly.io
- NVIDIA NIM integration via OpenAI-compatible API
- Database indexes for scale
- Token budget management (100k context for NVIDIA models)

## v1.1.0 — 2026-07-06

### New Features
- Smart AI memory system (summary + recent window for long sessions)
- Extra context now properly sent to AI
- Responsive width (1/3 screen)
- Font size control in settings
- Smoother answer streaming with fade-in and cursor
- Separate popover window for hamburger menu (no jumping)
- Multi-monitor support (move app between displays)
- Position grid directly in toolbar
- Global launch shortcut (Ctrl+Cmd+I)
- Snap position keyboard shortcuts (Cmd+Shift+Arrow)
- Ctrl+Cmd+H to hide/show app (macOS) / Ctrl+H (Windows)
- Animated waveform icon (replaces IA logo)
- Premium mini pill redesign
- Smart auto-scroll (doesn't interrupt reading)

### Bug Fixes
- Fixed regenerate duplicating history
- Fixed conversation history order in web dashboard
- Fixed window resizing from sides
- Fixed bottom position hamburger menu
- Fixed second deep link launch not bringing app to front
- Fixed screen module crash on startup
- Fixed app disappearing at bottom positions

### Improvements
- Improved system prompt quality (better AI answers)
- In-memory system prompt cache (faster responses)
- Compact hamburger menu with side-by-side options
- Single toolbar row layout
- Remove context character limit

## Known Platform Notes

### macOS
- **Unsigned build**: first launch requires right-click → Open (or
  `xattr -cr /Applications/IAI.app`) — see README-INSTALL.md. Code-signing
  prep (entitlements, electron-builder `identity` config) is in place;
  actual signing needs an Apple Developer ID cert.
- App does not appear in the Dock by default (`HIDE_DOCK_ICON`, packaged
  builds only) — look for the floating overlay bar instead.

### Windows
- **First install**: SmartScreen will likely show "Windows protected your
  PC" (unsigned) — click "More info" → "Run anyway".
- **Auto-update**: uses the NSIS installer target
  (`build.win.target: nsis` in package.json), which electron-updater
  supports natively — no separate Squirrel.Windows config needed.
- **Deep links** (`iai-desktop://`): registered via
  `app.setAsDefaultProtocolClient`, which writes a
  `HKEY_CURRENT_USER\Software\Classes\<scheme>\shell\open\command` registry
  key on Windows (vs. Info.plist on macOS) — see the comment above that call
  in `src/main/index.ts` if deep links stop launching the app after a
  reinstall to a different path.
- Global shortcuts all use `CommandOrControl`, which maps to Ctrl
  automatically — audited against Windows-reserved combos, no conflicts
  found (see `src/main/index.ts`'s `registerShortcuts`).
