(() => {
  const DB_NAME = "shipinhao-fan-source-cache";
  const DB_VERSION = 1;
  const STORE_NAME = "fanSources";
  const CREATED_INDEX = "createdAt";
  const DEFAULT_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        const store = db.objectStoreNames.contains(STORE_NAME)
          ? request.transaction.objectStore(STORE_NAME)
          : db.createObjectStore(STORE_NAME, { keyPath: "id" });
        if (!store.indexNames.contains(CREATED_INDEX)) store.createIndex(CREATED_INDEX, "createdAt", { unique: false });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("打开粉丝截图缓存失败"));
    });
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("粉丝截图缓存请求失败"));
    });
  }

  function buildFanSourceId() {
    return `fan-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  async function putFanSource(record) {
    if (!record || !Array.isArray(record.files) || !record.files.length) throw new Error("粉丝截图缓存记录不完整");
    const id = record.id || buildFanSourceId();
    const stored = {
      id,
      name: record.name || "粉丝量截图",
      files: record.files.map((file) => ({
        fileName: file.fileName || "截图.png",
        blob: file.blob,
      })),
      createdAt: record.createdAt || Date.now(),
    };
    const db = await openDb();
    try {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(stored);
      await new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error("写入粉丝截图缓存失败"));
        transaction.onabort = () => reject(transaction.error || new Error("写入粉丝截图缓存中断"));
      });
    } finally {
      db.close();
    }
    return id;
  }

  async function getFanSource(id) {
    if (!id) return null;
    const db = await openDb();
    try {
      const transaction = db.transaction(STORE_NAME, "readonly");
      return await requestToPromise(transaction.objectStore(STORE_NAME).get(id));
    } finally {
      db.close();
    }
  }

  async function deleteFanSource(id) {
    if (!id) return;
    const db = await openDb();
    try {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(id);
      await new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error("删除粉丝截图缓存失败"));
        transaction.onabort = () => reject(transaction.error || new Error("删除粉丝截图缓存中断"));
      });
    } finally {
      db.close();
    }
  }

  async function cleanupOldFanSources(maxAgeMs = DEFAULT_MAX_AGE_MS) {
    const cutoff = Date.now() - maxAgeMs;
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        let count = 0;
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const index = transaction.objectStore(STORE_NAME).index(CREATED_INDEX);
        const request = index.openCursor(IDBKeyRange.upperBound(cutoff));
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          cursor.delete();
          count += 1;
          cursor.continue();
        };
        request.onerror = () => reject(request.error || new Error("读取旧粉丝截图缓存失败"));
        transaction.oncomplete = () => resolve(count);
        transaction.onerror = () => reject(transaction.error || new Error("清理旧粉丝截图缓存失败"));
        transaction.onabort = () => reject(transaction.error || new Error("清理旧粉丝截图缓存中断"));
      });
    } finally {
      db.close();
    }
  }

  const api = {
    putFanSource,
    getFanSource,
    deleteFanSource,
    cleanupOldFanSources,
  };

  if (typeof self !== "undefined") self.FanSourceCache = api;
  if (typeof window !== "undefined") window.FanSourceCache = api;
})();
