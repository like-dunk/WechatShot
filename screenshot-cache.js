(() => {
  const DB_NAME = "shipinhao-screenshot-cache";
  const DB_VERSION = 1;
  const STORE_NAME = "screenshots";
  const RUN_INDEX = "runId";
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
        if (!store.indexNames.contains(RUN_INDEX)) store.createIndex(RUN_INDEX, "runId", { unique: false });
        if (!store.indexNames.contains(CREATED_INDEX)) store.createIndex(CREATED_INDEX, "createdAt", { unique: false });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("打开截图缓存失败"));
    });
  }

  function withStore(mode, callback) {
    return openDb().then((db) => new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      let callbackResult;
      transaction.oncomplete = () => {
        db.close();
        resolve(callbackResult);
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error || new Error("截图缓存事务失败"));
      };
      transaction.onabort = () => {
        db.close();
        reject(transaction.error || new Error("截图缓存事务中断"));
      };
      try {
        callbackResult = callback(store);
      } catch (error) {
        transaction.abort();
        reject(error);
      }
    }));
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("截图缓存请求失败"));
    });
  }

  async function dataUrlToBlob(dataUrl) {
    const text = String(dataUrl || "");
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(text);
    if (!match) throw new Error("截图数据格式无效");
    const mimeType = match[1] || "image/png";
    const isBase64 = Boolean(match[2]);
    const payload = match[3] || "";
    if (isBase64) {
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return new Blob([bytes], { type: mimeType });
    }
    return new Blob([decodeURIComponent(payload)], { type: mimeType });
  }

  function buildScreenshotCacheId(runId, taskId) {
    return `${runId || "run"}:${taskId || Math.random().toString(36).slice(2)}`;
  }

  async function putScreenshot(record) {
    if (!record || !record.runId || !record.taskId || !record.blob) throw new Error("截图缓存记录不完整");
    const id = record.id || buildScreenshotCacheId(record.runId, record.taskId);
    const stored = {
      id,
      runId: record.runId,
      taskId: record.taskId,
      fileName: record.fileName || "截图.png",
      task: record.task || null,
      blob: record.blob,
      createdAt: record.createdAt || Date.now(),
    };
    await withStore("readwrite", (store) => store.put(stored));
    return id;
  }

  async function getScreenshot(id) {
    if (!id) return null;
    const db = await openDb();
    try {
      const transaction = db.transaction(STORE_NAME, "readonly");
      return await requestToPromise(transaction.objectStore(STORE_NAME).get(id));
    } finally {
      db.close();
    }
  }

  async function getScreenshotsByRun(runId) {
    if (!runId) return [];
    const db = await openDb();
    try {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const index = transaction.objectStore(STORE_NAME).index(RUN_INDEX);
      const records = await requestToPromise(index.getAll(runId));
      return records.sort((left, right) => {
        const leftIndex = Number(left.task && left.task.listIndex);
        const rightIndex = Number(right.task && right.task.listIndex);
        if (Number.isFinite(leftIndex) && Number.isFinite(rightIndex) && leftIndex !== rightIndex) return leftIndex - rightIndex;
        return String(left.fileName || "").localeCompare(String(right.fileName || ""), "zh-CN");
      });
    } finally {
      db.close();
    }
  }

  async function deleteRun(runId) {
    if (!runId) return 0;
    const records = await getScreenshotsByRun(runId);
    await withStore("readwrite", (store) => records.forEach((record) => store.delete(record.id)));
    return records.length;
  }

  async function cleanupOld(maxAgeMs = DEFAULT_MAX_AGE_MS) {
    const cutoff = Date.now() - maxAgeMs;
    const db = await openDb();
    try {
      const deleted = await new Promise((resolve, reject) => {
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
        request.onerror = () => reject(request.error || new Error("读取旧截图缓存失败"));
        transaction.oncomplete = () => resolve(count);
        transaction.onerror = () => reject(transaction.error || new Error("清理旧截图缓存失败"));
        transaction.onabort = () => reject(transaction.error || new Error("清理旧截图缓存中断"));
      });
      return deleted;
    } finally {
      db.close();
    }
  }

  async function blobToBytes(blob) {
    return new Uint8Array(await blob.arrayBuffer());
  }

  const api = {
    buildScreenshotCacheId,
    dataUrlToBlob,
    putScreenshot,
    getScreenshot,
    getScreenshotsByRun,
    deleteRun,
    cleanupOld,
    blobToBytes,
  };

  if (typeof self !== "undefined") self.ScreenshotCache = api;
  if (typeof window !== "undefined") window.ScreenshotCache = api;
})();
