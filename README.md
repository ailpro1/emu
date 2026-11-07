# PocketEmu

Offline web emulator for iPhone (PWA). ROMs and saves stay on the phone.

## Systems

| System | Status | Core |
|---|---|---|
| GBA | ✅ | mGBA |
| GB / GBC | ✅ | mGBA |
| NDS | ✅ touch screen | melonDS (default) / DeSmuME |
| PS1 | ✅ | PCSX-ReARMed (BIOS optional) |
| PSP | ⚠️ experimental, slow on iPhone 12 | PPSSPP |
| 3DS | ❌ | no browser emulator exists |
| Switch | ❌ | needs native code + JIT |
| PS2 | ❌ | no browser emulator exists |

ROM formats: `.gba .gb .gbc .nds .cue/.bin .chd .pbp .iso .cso .zip .7z`.
PS1 multi-file games: use `.chd`, `.pbp`, or a `.zip` holding the `.cue` + `.bin`.

## Features

- ROM library stored on device (IndexedDB). Works offline after first load.
- Auto-save: timer (30 s – 5 min), on app switch/lock, on exit. Resume on start.
- Manual save: 3 slots with screenshot. In-game saves (SRAM) kept + backed up.
- Export / import saves per game, full backup / restore (via Files app).
- NDS touch: drag on bottom screen = stylus.
- TV: AirPlay Screen Mirroring or Lightning→HDMI adapter. 📺 button = clean picture, hides on-screen pad (use Bluetooth controller).
- Bluetooth controllers (PS / Xbox / MFi) supported.

## Install on iPhone

1. Host the folder over HTTPS (GitHub Pages: Settings → Pages → Source = **GitHub Actions**, push to `main`).
2. Open the URL in **Safari** → Share → **Add to Home Screen**.
3. Open PocketEmu from Home Screen → **+ Add ROM** → pick file in Files app.

Tip: open each system once while online so its core is cached for offline use.

## Run locally (PC)

```
python3 -m http.server 8080
```
Open http://localhost:8080.

## Notes

- Use only ROMs/BIOS you legally own (own dumps).
- iOS may clear website data if storage is low or app unused for long. Install to Home Screen and use **Backup all saves** regularly.
- Emulation: [EmulatorJS](https://github.com/EmulatorJS/EmulatorJS) 4.2.3 (GPL-3.0), vendored in `vendor/emulatorjs/`.
