// System catalogue. `core` = EmulatorJS core id. `supported:false` = cannot run in a browser.
export const SYSTEMS = {
  gba:  { name: "Game Boy Advance", core: "gba", exts: ["gba"], supported: true },
  gb:   { name: "Game Boy / Color", core: "mgba", exts: ["gb", "gbc"], supported: true },
  nds:  { name: "Nintendo DS", core: "nds", exts: ["nds"], supported: true, touch: true,
          cores: [["melonds", "melonDS (default)"], ["desmume", "DeSmuME (try if slow)"]] },
  psx:  { name: "PlayStation 1", core: "psx", exts: ["cue", "bin", "chd", "pbp", "img", "m3u", "ccd", "mds"], supported: true,
          bios: "Optional: scph5501.bin (better compatibility). Built-in HLE BIOS used if empty." },
  psp:  { name: "PSP (experimental, slow on iPhone)", core: "psp", exts: ["cso"], supported: true, threads: true },
  "3ds":{ name: "Nintendo 3DS", exts: ["3ds", "cia", "cxi", "cci", "3dsx", "app"], supported: false,
          why: "No 3DS emulator runs in a web browser. On iPhone use a native app (e.g. Folium, from the App Store)." },
  switch:{ name: "Nintendo Switch", exts: ["nsp", "xci", "nsz", "xcz", "nro"], supported: false,
          why: "Switch emulation needs native code + JIT. Not possible in a browser or on iPhone 12." },
  ps2:  { name: "PlayStation 2", exts: [], supported: false,
          why: "No PS2 emulator runs in a web browser. On iPhone, native apps with JIT are needed." },
};

// Extensions that could be more than one system -> user chooses.
export const AMBIGUOUS = { zip: ["gba", "gb", "nds", "psx"], "7z": ["gba", "gb", "nds", "psx"], iso: ["psx", "psp"] };

export function detectSystem(filename) {
  const ext = filename.split(".").pop().toLowerCase();
  if (AMBIGUOUS[ext]) return { ext, choices: AMBIGUOUS[ext] };
  for (const [id, s] of Object.entries(SYSTEMS)) if (s.exts.includes(ext)) return { ext, system: id };
  return { ext, choices: ["gba", "gb", "nds", "psx", "psp"] };
}
