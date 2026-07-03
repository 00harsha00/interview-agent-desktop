# App icon placeholder

electron-builder is configured with `"icon": "resources/icon"` in package.json.
Drop the real icon files in THIS folder with these exact names — no further
config changes needed; the next build picks them up automatically:

| File        | Platform | Requirements                                      |
|-------------|----------|---------------------------------------------------|
| `icon.icns` | macOS    | Generated from a 1024×1024 source (use `iconutil`)|
| `icon.ico`  | Windows  | Multi-size .ico (256/128/64/48/32/16)             |
| `icon.png`  | Linux    | 512×512 PNG                                       |

Until these exist, electron-builder falls back to the default Electron icon
(and logs "default Electron icon is used" during the build — harmless).
