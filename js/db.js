// IndexedDB storage: ROMs, BIOS files, save states, SRAM backups, settings.
const DB_NAME = "pocketemu";
const DB_VER = 1;
let _db;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("roms")) db.createObjectStore("roms", { keyPath: "id" });
      if (!db.objectStoreNames.contains("bios")) db.createObjectStore("bios", { keyPath: "system" });
      // key: `${romId}|${slot}`  slot = auto | 1 | 2 | 3 | sram
      if (!db.objectStoreNames.contains("saves")) db.createObjectStore("saves", { keyPath: "key" });
      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings");
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

async function tx(store, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    const r = fn(s);
    if (r && "onsuccess" in r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const db = {
  put: (store, val, key) => tx(store, "readwrite", s => key === undefined ? s.put(val) : s.put(val, key)),
  get: (store, key) => tx(store, "readonly", s => s.get(key)),
  del: (store, key) => tx(store, "readwrite", s => s.delete(key)),
  all: (store) => tx(store, "readonly", s => s.getAll()),
  async delPrefix(store, prefix) {
    const items = await this.all(store);
    for (const it of items) if (it.key && it.key.startsWith(prefix)) await this.del(store, it.key);
  },
};

export async function getSetting(name, def) {
  const v = await db.get("settings", name);
  return v === undefined ? def : v;
}
export const setSetting = (name, v) => db.put("settings", v, name);

// Ask iOS not to evict our storage.
export async function requestPersist() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) {}
  return false;
}
