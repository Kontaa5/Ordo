// Messaging with the Swift host (WKScriptMessageHandlerWithReply).

declare global {
  interface Window {
    webkit?: { messageHandlers: { ordo: { postMessage(msg: unknown): Promise<unknown> } } };
  }
}

export function post(msg: Record<string, unknown>) {
  try { window.webkit?.messageHandlers.ordo.postMessage(msg)?.catch?.(() => {}); }
  catch { console.log('[ordo→native]', msg); }
}

export async function request<T = unknown>(msg: Record<string, unknown>): Promise<T> {
  const h = window.webkit?.messageHandlers.ordo;
  if (!h) throw new Error('kein Host');
  return (await h.postMessage(msg)) as T;
}

export function blobToBase64(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] ?? '');
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });
}
