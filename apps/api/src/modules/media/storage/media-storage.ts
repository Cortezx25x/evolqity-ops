import type { Readable } from 'node:stream';

export interface SavedMediaFile {
  storageKey: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  sizeBytes: number;
  sha256: string;
}

export interface OpenedMediaFile {
  stream: Readable;
  sizeBytes: number;
}

export interface MediaStorage {
  save(source: Readable): Promise<SavedMediaFile>;
  open(storageKey: string): Promise<OpenedMediaFile>;
  delete(storageKey: string): Promise<void>;
  exists(storageKey: string): Promise<boolean>;
}

export class UnsupportedMediaTypeError extends Error {
  constructor() {
    super('Unsupported media type');
    this.name = 'UnsupportedMediaTypeError';
  }
}

export class StoredMediaNotFoundError extends Error {
  constructor() {
    super('Stored media not found');
    this.name = 'StoredMediaNotFoundError';
  }
}
