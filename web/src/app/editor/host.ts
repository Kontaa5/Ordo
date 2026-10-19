import { Facet } from '@codemirror/state';

/** What an editor needs from the view that owns it. */
export interface EditorHost {
  path(): string;
  openLink(target: string, newLeaf: boolean): void;
  openTag(tag: string): void;
  openImage(path: string, url: string): void;
  editImage(path: string, url: string): void;
  readNote(target: string): Promise<{ path: string; text: string } | null>;
}

export const editorHost = Facet.define<EditorHost, EditorHost | null>({ combine: v => v[0] ?? null });
