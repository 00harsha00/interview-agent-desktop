# IAI Desktop (Electron overlay)

Real-time AI interview assistant overlay. electron-vite (out/) + electron-builder (dist/).

## Build & distribute

- Dev: `npm run dev` (stealth OFF: visible in screen shares, dock icon shown)
- Distribution: set the ngrok URL in `.env.production` (`VITE_API_BASE_URL`), then
  `npm run dist:mac` / `dist:win` / `dist:all`. The URL is baked in at build time —
  rebuild after every ngrok restart.
- Local install: `npm run install:mac` (builds, ditto-installs to /Applications,
  removes the dist copy so Spotlight doesn't show a duplicate app).
- Icons: generated from `resources/icon.svg` via `npm run icons` (sharp + iconutil +
  png-to-ico). Replace icon.svg and re-run to change branding.

## Releasing a new version
1. Make and test your changes
2. `npm version patch` (patch=bugfix, minor=feature, major=breaking)
3. Set real GH_TOKEN in .env.production
4. `npm run release:all`
5. GitHub Release created automatically with DMG + EXE
6. `git push origin main --tags`
7. Installed apps auto-update on next launch

## Stealth flags (automatic — no manual flipping)

`CONTENT_PROTECTION` and `HIDE_DOCK_ICON` in `src/main/index.ts` are `!IS_DEV`:
OFF in dev / unpackaged runs, ON in packaged .dmg/.exe builds.

## Before release checklist

- [ ] `.env.production` has the current backend URL
- [ ] Code-sign + notarize (no Developer ID identity configured yet — builds are
      unsigned; testers follow README-INSTALL.md to bypass Gatekeeper/SmartScreen)
