downloadWorkbook().catch((error) => {
  document.getElementById("status").textContent = `导出失败：${error.message}`;
});

async function downloadWorkbook() {
  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  if (!id) throw new Error("缺少下载任务 ID");
  const port = chrome.runtime.connect({ name: "workbook-download" });
  const chunks = [];
  let fileName = "带截图.xlsx";
  let mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  let statusLabel = "正在接收带截图 Excel";
  let totalSize = 0;
  let receivedSize = 0;
  await new Promise((resolve, reject) => {
    port.onMessage.addListener((message) => {
      if (message.type === "ERROR") {
        reject(new Error(message.error || "导出失败"));
        return;
      }
      if (message.type === "START") {
        fileName = message.fileName || fileName;
        mimeType = message.mimeType || mimeType;
        statusLabel = message.statusLabel || statusLabel;
        totalSize = message.totalSize || 0;
        updateStatus(receivedSize, totalSize, statusLabel);
        return;
      }
      if (message.type === "CHUNK") {
        const bytes = base64ToBytes(message.data || "");
        chunks.push(bytes);
        receivedSize += bytes.length;
        updateStatus(receivedSize, totalSize, statusLabel);
        port.postMessage({ type: "CHUNK_RECEIVED", id });
        return;
      }
      if (message.type === "DONE") resolve();
    });
    port.onDisconnect.addListener(() => {
      if (receivedSize < totalSize) reject(new Error("导出数据传输中断"));
    });
    port.postMessage({ type: "READY", id });
  });
  const blob = new Blob(chunks, { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const downloadId = await chrome.downloads.download({
      url,
      filename: fileName,
      saveAs: false,
      conflictAction: "uniquify",
    });
    if (!downloadId) throw new Error("下载未启动");
    document.getElementById("status").textContent = `已触发下载：${fileName}`;
    port.postMessage({ type: "DOWNLOADED", id });
    setTimeout(() => window.close(), 3000);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

function updateStatus(receivedSize, totalSize, statusLabel) {
  const receivedMb = (receivedSize / 1024 / 1024).toFixed(1);
  const totalMb = totalSize ? (totalSize / 1024 / 1024).toFixed(1) : "?";
  document.getElementById("status").textContent = `${statusLabel || "正在接收文件"}：${receivedMb}/${totalMb} MB`;
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
