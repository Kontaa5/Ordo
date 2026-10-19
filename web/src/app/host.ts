// Bridge to the native side (Swift). Requests go through the WebKit message
// handler; native → web events arrive via window.ordo.host.*.

import { request as rawRequest } from '../bridge';

type Handler = (data: any) => void;
const handlers = new Map<string, Set<Handler>>();

export function on(event: string, fn: Handler) {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event)!.add(fn);
  return () => handlers.get(event)!.delete(fn);
}

export function emit(event: string, data?: any) {
  handlers.get(event)?.forEach(fn => { try { fn(data); } catch (e) { console.error(event, e); } });
}

export async function request<T = any>(type: string, data: Record<string, unknown> = {}): Promise<T> {
  return rawRequest<T>({ type, ...data });
}

export const isMac = /Mac/.test(navigator.platform) && !('ontouchend' in document);
export const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Mac/.test(navigator.platform) && 'ontouchend' in document);

// native → web
const hostApi = {
  vaultOpened: (info: any) => emit('vault-opened', info),
  vaultClosed: (boot: any) => emit('vault-closed', boot),
  index: (snapshot: any) => emit('index', snapshot),
  renamed: (d: { from: string; to: string }) => emit('renamed', d),
  externalChange: (d: { path: string; text: string }) => emit('external-change', d),
  deleted: (path: string) => emit('deleted', path),
  hotkey: (combo: string) => emit('hotkey', combo),
  command: (id: string) => emit('command', id),
  exportProgress: (p: number) => emit('export-progress', p),
  flush: () => emit('flush'),
  gitStatus: (s: any) => emit('git-status', s),
};

declare global { interface Window { ordo: { host: typeof hostApi; [k: string]: any } } }
window.ordo = Object.assign(window.ordo ?? {}, { host: hostApi });
