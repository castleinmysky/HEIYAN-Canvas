// Attachments stay local and scoped; never insert base64 files into project text/history.
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('heiyan-chat-attachments', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('images');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function writeMessageImages(canvas: string, message: string, images: string[]) {
  if (!images.length) return;
  const db = await database();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('images', 'readwrite');
    tx.objectStore('images').put(images.slice(0, 4), JSON.stringify([canvas, message]));
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
export async function readMessageImages(canvas: string, message: string): Promise<string[]> {
  const db = await database();
  try { return await new Promise<string[]>((resolve, reject) => {
    const request = db.transaction('images').objectStore('images').get(JSON.stringify([canvas, message]));
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result.filter((value: unknown) => typeof value === 'string' && /^data:image\/(png|jpeg|webp);base64,/i.test(value)).slice(0, 4) : []);
    request.onerror = () => reject(request.error);
  }); } finally { db.close(); }
}
