import { db, getSetting } from "./db.js";
import { SYSTEMS } from "./systems.js";
import { toast, fmtTime } from "./util.js";

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const romId = params.get("id");
const fresh = params.get("fresh") === "1";

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

let emu, gm, started = false, saving = false, autoTimer;
const S = {};

function fail(msg) {
  document.body.innerHTML = `<div class="err"><p></p><p><a href="index.html">← Back to library</a></p></div>`;
  document.querySelector(".err p").textContent = msg;
}

async function boot() {
  const rom = romId && await db.get("roms", romId);
  if (!rom) return fail("Game not found.");
  const sys = SYSTEMS[rom.system];
  if (!sys || !sys.supported) return fail("System not supported.");

  S.rom = rom;
  S.sys = sys;
  S.autoInterval = await getSetting("autoInterval", 60);
  S.autoExit = await getSetting("autoExit", true);
  S.resume = await getSetting("resume", true);
  S.ndsTouch = await getSetting("ndsTouch", true);
  document.title = rom.name;

  if (sys.threads && typeof SharedArrayBuffer !== "function") {
    // PSP needs cross-origin isolation; the service worker adds the headers. Reload once it controls the page.
    if (!sessionStorage.getItem("coi-reload")) {
      sessionStorage.setItem("coi-reload", "1");
      await navigator.serviceWorker.ready;
      location.reload();
      return;
    }
    return fail("PSP needs SharedArrayBuffer, which this browser has not enabled. Try installing to Home Screen and reopening.");
  }
  sessionStorage.removeItem("coi-reload");

  const bios = await db.get("bios", rom.system);
  const stem = rom.fileName.replace(/\.[^.]+$/, "");

  Object.assign(window, {
    EJS_player: "#game",
    EJS_core: (sys.cores && rom.core) || sys.core,
    EJS_gameName: stem,                       // stable key for in-game (SRAM) saves
    EJS_gameUrl: new File([rom.blob], rom.fileName),
    EJS_pathtodata: "vendor/emulatorjs/data/",
    EJS_biosUrl: bios ? new File([bios.blob], bios.fileName) : "",
    EJS_color: "#e53935",
    EJS_startOnLoaded: false,                 // one tap to start = iOS allows audio
    EJS_threads: !!sys.threads,
    EJS_disableDatabases: false,
    EJS_backgroundColor: "#000",
    EJS_Buttons: { exitEmulation: false, saveState: true, loadState: true },
    EJS_onGameStart: onStart,
  });

  const s = document.createElement("script");
  s.src = "vendor/emulatorjs/data/loader.js";
  document.body.appendChild(s);

  rom.lastPlayed = Date.now();
  db.put("roms", rom);
}

// ---------- After game starts ----------
async function onStart() {
  emu = window.EJS_emulator;
  gm = emu.gameManager;
  started = true;

  // Make sure on-screen controls show on touch devices.
  try {
    if (navigator.maxTouchPoints > 0 && emu.virtualGamepad && emu.getSettingValue("virtual-gamepad") !== "disabled") {
      emu.touch = true;
      emu.toggleVirtualGamepad(true);
      emu.handleResize();
    }
  } catch (e) {}

  // Restore imported in-game save (SRAM) if pending.
  const sram = await db.get("saves", `${romId}|sram`);
  let restoredSram = false;
  if (sram && sram.pending) {
    try {
      const p = gm.getSaveFilePath();
      gm.FS.writeFile(p, sram.data);
      gm.loadSaveFiles();
      sram.pending = false;
      await db.put("saves", sram);
      restoredSram = true;
      toast("In-game save restored — restart game in its menu if needed");
    } catch (e) { console.warn("SRAM restore failed", e); }
  }

  // Resume from auto-save.
  if (!fresh && !restoredSram && S.resume) {
    const auto = await db.get("saves", `${romId}|auto`);
    if (auto) setTimeout(() => {
      try { gm.loadState(auto.data); toast("Resumed from auto-save"); } catch (e) { console.warn(e); }
    }, 600);
  }

  if (S.autoInterval > 0) autoTimer = setInterval(() => {
    if (!document.hidden && !emu.paused) saveSlot("auto", true);
  }, S.autoInterval * 1000);

  if (S.sys.touch && S.ndsTouch) setupStylus();
}

async function screenshotDataUrl() {
  try {
    const png = await Promise.race([gm.screenshot(), new Promise((_, r) => setTimeout(() => r("timeout"), 1500))]);
    const blob = new Blob([png], { type: "image/png" });
    const bmp = await createImageBitmap(blob);
    const w = 160, h = Math.round(bmp.height * w / bmp.width) || 120;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").drawImage(bmp, 0, 0, w, h);
    return c.toDataURL("image/jpeg", 0.7);
  } catch (e) { return null; }
}

async function backupSram() {
  try {
    gm.saveSaveFiles();
    const data = gm.FS.readFile(gm.getSaveFilePath());
    if (data && data.length) {
      const old = await db.get("saves", `${romId}|sram`);
      if (old && old.pending) return;   // do not overwrite an import not yet applied
      await db.put("saves", { key: `${romId}|sram`, romId, slot: "sram", data: new Uint8Array(data), time: Date.now() });
    }
  } catch (e) { /* game has no in-game save yet */ }
}

async function saveSlot(slot, quiet) {
  if (!started || saving) return false;
  saving = true;
  try {
    const data = gm.getState();
    const rec = { key: `${romId}|${slot}`, romId, slot, data, time: Date.now() };
    await db.put("saves", rec);           // write state first (fast path for app-switch)
    await backupSram();
    rec.thumb = await screenshotDataUrl();
    if (rec.thumb) await db.put("saves", rec);
    if (!quiet) toast(slot === "auto" ? "Auto-saved" : `Saved to slot ${slot}`);
    return true;
  } catch (e) {
    console.warn(e);
    if (!quiet) toast("Save failed: " + (e.message || e));
    return false;
  } finally { saving = false; }
}

async function loadSlot(slot) {
  const rec = await db.get("saves", `${romId}|${slot}`);
  if (!rec) return toast("Empty slot");
  try { gm.loadState(rec.data); toast(slot === "auto" ? "Loaded auto-save" : `Loaded slot ${slot}`); }
  catch (e) { toast("Load failed"); }
}

// ---------- Auto-save on leave ----------
function saveOnLeave() {
  if (started && S.autoExit) saveSlot("auto", true);
}
document.addEventListener("visibilitychange", () => { if (document.hidden) saveOnLeave(); });
window.addEventListener("pagehide", saveOnLeave);

// ---------- Toolbar ----------
async function openSlots(mode) {
  const box = $("#slots");
  $("#slotsTitle").textContent = mode === "save" ? "Save state" : "Load state";
  box.innerHTML = "";
  const slots = mode === "save" ? ["1", "2", "3"] : ["auto", "1", "2", "3"];
  for (const slot of slots) {
    const rec = await db.get("saves", `${romId}|${slot}`);
    const b = document.createElement("button");
    b.type = "button"; b.className = "slot";
    b.innerHTML = rec && rec.thumb ? `<img alt="">` : `<span class="noimg"></span>`;
    if (rec && rec.thumb) b.querySelector("img").src = rec.thumb;
    const t = document.createElement("span");
    t.innerHTML = `<b></b><small></small>`;
    t.querySelector("b").textContent = slot === "auto" ? "Auto-save" : `Slot ${slot}`;
    t.querySelector("small").textContent = rec ? fmtTime(rec.time) : "Empty";
    b.appendChild(t);
    b.onclick = async () => {
      $("#dlgSlots").close();
      if (mode === "save") {
        if (rec && !confirm(`Overwrite slot ${slot}?`)) return;
        saveSlot(slot);
      } else loadSlot(slot);
    };
    box.appendChild(b);
  }
  $("#dlgSlots").showModal();
}

$("#bSave").onclick = () => started ? openSlots("save") : toast("Start the game first");
$("#bLoad").onclick = () => started ? openSlots("load") : toast("Start the game first");
$("#bBack").onclick = async () => {
  if (started) { clearInterval(autoTimer); if (S.autoExit) await saveSlot("auto", true); }
  location.href = "index.html";
};
$("#bTV").onclick = () => {
  const on = document.body.classList.toggle("tv");
  toast(on ? "TV mode: on-screen pad hidden. Use a Bluetooth controller + Screen Mirroring."
           : "TV mode off");
  try { if (on && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen(); } catch (e) {}
};
$("#bHide").onclick = () => { $("#bar").hidden = true; $("#bShow").hidden = false; };
$("#bShow").onclick = () => { $("#bar").hidden = false; $("#bShow").hidden = true; };

// ---------- NDS stylus: convert touch drags on the game canvas into mouse events ----------
function setupStylus() {
  const canvas = emu.canvas;
  if (!canvas) return;
  let id = null;
  const send = (type, t) => {
    canvas.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, view: window, button: 0, buttons: type === "mouseup" ? 0 : 1,
      clientX: t.clientX, clientY: t.clientY, screenX: t.screenX, screenY: t.screenY,
    }));
  };
  canvas.addEventListener("touchstart", (e) => {
    if (id !== null) return;
    const t = e.changedTouches[0];
    id = t.identifier;
    e.preventDefault();
    send("mousemove", t);
    send("mousedown", t);
  }, { passive: false });
  canvas.addEventListener("touchmove", (e) => {
    const t = [...e.changedTouches].find(x => x.identifier === id);
    if (!t) return;
    e.preventDefault();
    send("mousemove", t);
  }, { passive: false });
  const end = (e) => {
    const t = [...e.changedTouches].find(x => x.identifier === id);
    if (!t) return;
    e.preventDefault();
    send("mouseup", t);
    id = null;
  };
  canvas.addEventListener("touchend", end, { passive: false });
  canvas.addEventListener("touchcancel", end, { passive: false });
}

boot();
