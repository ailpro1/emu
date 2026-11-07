import { db, getSetting, setSetting, requestPersist } from "./db.js";
import { SYSTEMS, detectSystem } from "./systems.js";
import { toast, fmtTime, fmtSize, downloadBlob, b64encode, b64decode } from "./util.js";

const $ = (s) => document.querySelector(s);

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
const standalone = window.navigator.standalone || matchMedia("(display-mode: standalone)").matches;
if (!standalone && /iPhone|iPad/.test(navigator.userAgent)) $("#installHint").hidden = false;

// ---------- Library ----------
async function render() {
  const roms = (await db.all("roms")).sort((a, b) => (b.lastPlayed || b.added) - (a.lastPlayed || a.added));
  const lib = $("#library");
  lib.innerHTML = "";
  $("#empty").hidden = roms.length > 0;
  const saves = await db.all("saves");
  for (const r of roms) {
    const el = document.createElement("div");
    el.className = "game";
    const thumb = saves.find(s => s.romId === r.id && s.slot === "auto" && s.thumb)
      || saves.find(s => s.romId === r.id && s.thumb);
    el.innerHTML = `<div class="thumb"></div><div class="meta"><div class="name"></div><div class="sys"></div></div>`;
    const t = el.querySelector(".thumb");
    if (thumb) t.style.backgroundImage = `url(${thumb.thumb})`; else t.textContent = r.system.toUpperCase();
    el.querySelector(".name").textContent = r.name;
    el.querySelector(".sys").textContent = `${SYSTEMS[r.system].name.split(" (")[0]} · ${fmtSize(r.size)}`;
    el.onclick = () => openGame(r.id);
    lib.appendChild(el);
  }
}

// ---------- Import ROMs ----------
$("#romInput").onchange = async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  for (const f of files) await importRom(f);
  requestPersist();
  render();
};

function pickSystem(file, choices) {
  return new Promise((resolve) => {
    const dlg = $("#dlgSystem");
    $("#dlgSystemFile").textContent = file.name;
    const box = $("#dlgSystemChoices");
    box.innerHTML = "";
    for (const id of choices) {
      const b = document.createElement("button");
      b.value = id;
      b.textContent = SYSTEMS[id].name;
      box.appendChild(b);
    }
    dlg.onclose = () => resolve(dlg.returnValue === "cancel" ? null : dlg.returnValue);
    dlg.returnValue = "cancel";
    dlg.showModal();
  });
}

async function importRom(file) {
  const det = detectSystem(file.name);
  let system = det.system;
  if (system && !SYSTEMS[system].supported) {
    alert(`${SYSTEMS[system].name}: not supported.\n\n${SYSTEMS[system].why}`);
    return;
  }
  if (!system) system = await pickSystem(file, det.choices);
  if (!system) return;
  const id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
  const name = file.name.replace(/\.[^.]+$/, "");
  try {
    await db.put("roms", {
      id, name, fileName: file.name, system, size: file.size, added: Date.now(),
      // Copy into a plain Blob so iOS keeps the bytes after the picker closes.
      blob: new Blob([await file.arrayBuffer()], { type: "application/octet-stream" }),
    });
    toast(`Added ${name}`);
  } catch (err) {
    alert("Could not save ROM (storage full?).\n" + err);
  }
}

// ---------- Game dialog ----------
let current;
async function openGame(id) {
  const r = await db.get("roms", id);
  if (!r) return;
  current = r;
  const sys = SYSTEMS[r.system];
  $("#gTitle").textContent = r.name;
  $("#gInfo").textContent = `${sys.name} · ${r.fileName} · ${fmtSize(r.size)}`;
  const sel = $("#gCore");
  $("#gCoreRow").hidden = !sys.cores;
  if (sys.cores) {
    sel.innerHTML = sys.cores.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
    sel.value = r.core || sys.cores[0][0];
    sel.onchange = async () => { r.core = sel.value; await db.put("roms", r); };
  }
  await renderSaves();
  $("#dlgGame").showModal();
}

async function renderSaves() {
  const box = $("#gSaves");
  const saves = (await db.all("saves")).filter(s => s.romId === current.id)
    .sort((a, b) => String(a.slot).localeCompare(String(b.slot)));
  box.innerHTML = saves.length ? "" : `<p class="muted">No saves yet. In-game saves are kept automatically.</p>`;
  for (const s of saves) {
    const line = document.createElement("div");
    line.className = "saveline";
    const label = s.slot === "auto" ? "Auto-save" : s.slot === "sram" ? "In-game save (SRAM backup)" : `Slot ${s.slot}`;
    line.innerHTML = `<span><b></b><br><span class="muted"></span></span>`;
    line.querySelector("b").textContent = label;
    line.querySelector(".muted").textContent = fmtTime(s.time);
    const del = document.createElement("button");
    del.type = "button"; del.textContent = "Delete"; del.className = "danger";
    del.onclick = async () => { if (confirm(`Delete ${label}?`)) { await db.del("saves", s.key); renderSaves(); render(); } };
    line.appendChild(del);
    box.appendChild(line);
  }
}

const play = (fresh) => {
  location.href = `play.html?id=${encodeURIComponent(current.id)}${fresh ? "&fresh=1" : ""}`;
};
$("#gPlay").onclick = () => play(false);
$("#gFresh").onclick = () => play(true);

$("#gRename").onclick = async () => {
  const n = prompt("Name", current.name);
  if (n) { current.name = n; await db.put("roms", current); $("#gTitle").textContent = n; render(); }
};
$("#gDelete").onclick = async () => {
  if (!confirm(`Delete ${current.name} and all its saves?`)) return;
  await db.del("roms", current.id);
  await db.delPrefix("saves", current.id + "|");
  $("#dlgGame").close();
  render();
};

function saveToJson(s) {
  return { slot: s.slot, time: s.time, data: b64encode(s.data), thumb: s.thumb || null };
}
$("#gExport").onclick = async () => {
  const saves = (await db.all("saves")).filter(s => s.romId === current.id);
  if (!saves.length) return toast("No saves to export");
  const out = { app: "PocketEmu", type: "game-saves", rom: current.fileName, saves: saves.map(saveToJson) };
  downloadBlob(new Blob([JSON.stringify(out)], { type: "application/json" }), `${current.name}.saves.json`);
};
$("#gImport").onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  const ext = f.name.split(".").pop().toLowerCase();
  const put = (slot, data, extra = {}) =>
    db.put("saves", { key: `${current.id}|${slot}`, romId: current.id, slot, data, time: Date.now(), ...extra });
  try {
    if (ext === "json") {
      const j = JSON.parse(await f.text());
      for (const s of j.saves || []) await put(s.slot, b64decode(s.data), { thumb: s.thumb, pending: s.slot === "sram" });
    } else if (["sav", "srm", "dsv", "mcr", "mcd"].includes(ext)) {
      await put("sram", new Uint8Array(await f.arrayBuffer()), { pending: true });
    } else if (ext === "state" || /^state\d*$/.test(ext)) {
      await put("1", new Uint8Array(await f.arrayBuffer()));
    } else {
      return alert("Use .json (PocketEmu export), .sav/.srm/.dsv (in-game save) or .state");
    }
    toast("Save imported");
    renderSaves(); render();
  } catch (err) { alert("Import failed: " + err); }
};

// ---------- Settings ----------
const DEFAULTS = { autoInterval: 60, autoExit: true, resume: true, ndsTouch: true };
async function loadSettings() {
  $("#sAutoInt").value = String(await getSetting("autoInterval", DEFAULTS.autoInterval));
  $("#sAutoExit").checked = await getSetting("autoExit", DEFAULTS.autoExit);
  $("#sResume").checked = await getSetting("resume", DEFAULTS.resume);
  $("#sTouch").checked = await getSetting("ndsTouch", DEFAULTS.ndsTouch);
}
$("#sAutoInt").onchange = (e) => setSetting("autoInterval", Number(e.target.value));
$("#sAutoExit").onchange = (e) => setSetting("autoExit", e.target.checked);
$("#sResume").onchange = (e) => setSetting("resume", e.target.checked);
$("#sTouch").onchange = (e) => setSetting("ndsTouch", e.target.checked);

async function renderBios() {
  const box = $("#biosList");
  box.innerHTML = "";
  for (const [id, s] of Object.entries(SYSTEMS)) {
    if (!s.bios) continue;
    const have = await db.get("bios", id);
    const row = document.createElement("div");
    row.className = "saveline";
    row.innerHTML = `<span><b></b><br><span class="muted"></span></span><span class="row"></span>`;
    row.querySelector("b").textContent = s.name;
    row.querySelector(".muted").textContent = have ? `Loaded: ${have.fileName}` : s.bios;
    const btns = row.querySelector(".row");
    const lab = document.createElement("label");
    lab.className = "btn"; lab.textContent = have ? "Replace" : "Add";
    const inp = document.createElement("input");
    inp.type = "file"; inp.hidden = true;
    inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) return;
      await db.put("bios", { system: id, fileName: f.name, blob: new Blob([await f.arrayBuffer()]) });
      renderBios();
    };
    lab.appendChild(inp); btns.appendChild(lab);
    if (have) {
      const d = document.createElement("button");
      d.type = "button"; d.className = "danger"; d.textContent = "✕";
      d.onclick = async () => { await db.del("bios", id); renderBios(); };
      btns.appendChild(d);
    }
    box.appendChild(row);
  }
}

$("#btnSettings").onclick = async () => {
  await loadSettings();
  await renderBios();
  try {
    const est = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    $("#storageInfo").textContent = `Used ${fmtSize(est.usage)} of ~${fmtSize(est.quota)}. ` +
      (persisted ? "Protected from auto-clear." : "Tip: install to Home Screen so iOS keeps your data.");
  } catch (e) {}
  $("#dlgSettings").showModal();
};

$("#sBackup").onclick = async () => {
  const saves = await db.all("saves");
  const roms = await db.all("roms");
  const names = Object.fromEntries(roms.map(r => [r.id, r.fileName]));
  const out = { app: "PocketEmu", type: "backup", time: Date.now(),
    saves: saves.map(s => ({ rom: names[s.romId] || s.romId, ...saveToJson(s) })) };
  downloadBlob(new Blob([JSON.stringify(out)], { type: "application/json" }), `pocketemu-backup-${new Date().toISOString().slice(0, 10)}.json`);
};
$("#sRestore").onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    const roms = await db.all("roms");
    let n = 0, miss = 0;
    for (const s of j.saves || []) {
      const r = roms.find(x => x.fileName === s.rom);
      if (!r) { miss++; continue; }
      await db.put("saves", { key: `${r.id}|${s.slot}`, romId: r.id, slot: s.slot, time: s.time,
        data: b64decode(s.data), thumb: s.thumb, pending: s.slot === "sram" });
      n++;
    }
    toast(`Restored ${n} saves${miss ? `, ${miss} skipped (add matching ROM first)` : ""}`);
    render();
  } catch (err) { alert("Restore failed: " + err); }
};

render();
