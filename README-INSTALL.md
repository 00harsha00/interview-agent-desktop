# Installing IAI (Test Build)

The app is not code-signed yet (Apple Developer ID / Windows code-signing
cert both cost money and aren't set up), so both OSes show a security
warning on first run — this is expected, not a sign of a bad build.

## macOS
1. Download the `.dmg` (e.g. `IAI-1.1.0-arm64.dmg`)
2. Double-click to open
3. Drag **IAI** to Applications
4. First launch: **right-click IAI in Applications → Open → click Open**
   (Required because the app is not yet signed. You only need to do this once.)
   - If macOS still blocks it: System Settings → Privacy & Security → scroll down → "Open Anyway"
   - Or run: `xattr -cr /Applications/IAI.app`
5. Grant permissions when prompted (Microphone, Screen Recording) — required for
   transcription and screenshots.

## Windows
1. Download the installer (e.g. `IAI Setup 1.1.0.exe`)
2. Run it — if Windows shows **"Windows protected your PC"**, click **"More info" → "Run anyway"**
3. Follow the installer

## Auto-update
Both platforms auto-update from GitHub Releases once installed — no
re-download needed for future versions. (Windows uses the NSIS installer's
built-in update support; no separate config needed.)

## Requirements
- The backend must be running (ask the developer for the current URL — it's baked
  into this build, so if the URL changed you need a newer build)
- macOS 12+ (Apple Silicon) or Windows 10+
- Note: the app runs as a floating overlay. On macOS it does NOT appear in the
  dock in this build — look for the overlay bar at the top of your screen.
