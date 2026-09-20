import { createHash, randomUUID } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  promises as filesystem,
} from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { fileTypeFromFile } from 'file-type';

import {
  StoredMediaNotFoundError,
  UnsupportedMediaTypeError,
  type MediaStorage,
  type OpenedMediaFile,
  type SavedMediaFile,
} from './media-storage.js';

const supportedMediaTypes = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
] as const);

export class LocalMediaStorage implements MediaStorage {
  readonly #root: string;

  constructor(root: string) {
    this.#root = path.resolve(root);
  }

  #resolveStorageKey(storageKey: string): string {
    if (storageKey.length === 0 || path.isAbsolute(storageKey)) {
      throw new Error('Invalid storage key');
    }

    const resolved = path.resolve(this.#root, storageKey);
    const relative = path.relative(this.#root, resolved);

    if (
      relative === '' ||
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error('Invalid storage key');
    }

    return resolved;
  }

  async save(source: Readable): Promise<SavedMediaFile> {
    const temporaryKey = path.join('.tmp', `${randomUUID()}.tmp`);
    const temporaryPath = this.#resolveStorageKey(temporaryKey);
    await filesystem.mkdir(path.dirname(temporaryPath), { recursive: true });

    const hash = createHash('sha256');
    let sizeBytes = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        sizeBytes += chunk.length;
        hash.update(chunk);
        callback(null, chunk);
      },
    });

    try {
      await pipeline(
        source,
        meter,
        createWriteStream(temporaryPath, { flags: 'wx' }),
      );

      const detectedType = await fileTypeFromFile(temporaryPath);
      const extension =
        detectedType === undefined
          ? undefined
          : supportedMediaTypes.get(
              detectedType.mime as
                | 'image/jpeg'
                | 'image/png'
                | 'image/webp',
            );

      if (detectedType === undefined || extension === undefined) {
        throw new UnsupportedMediaTypeError();
      }

      const storageKey = path.posix.join(
        'media',
        `${randomUUID()}.${extension}`,
      );
      const destinationPath = this.#resolveStorageKey(storageKey);
      await filesystem.mkdir(path.dirname(destinationPath), {
        recursive: true,
      });
      await filesystem.rename(temporaryPath, destinationPath);

      return {
        storageKey,
        mimeType: detectedType.mime as SavedMediaFile['mimeType'],
        sizeBytes,
        sha256: hash.digest('hex'),
      };
    } catch (error) {
      await filesystem.rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  async open(storageKey: string): Promise<OpenedMediaFile> {
    const storedPath = this.#resolveStorageKey(storageKey);

    try {
      const stats = await filesystem.stat(storedPath);

      if (!stats.isFile()) {
        throw new StoredMediaNotFoundError();
      }

      return {
        stream: createReadStream(storedPath),
        sizeBytes: stats.size,
      };
    } catch (error) {
      if (
        error instanceof StoredMediaNotFoundError ||
        (typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code?: unknown }).code === 'ENOENT')
      ) {
        throw new StoredMediaNotFoundError();
      }

      throw error;
    }
  }

  async delete(storageKey: string): Promise<void> {
    const storedPath = this.#resolveStorageKey(storageKey);
    await filesystem.rm(storedPath, { force: true });
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      const storedPath = this.#resolveStorageKey(storageKey);
      const stats = await filesystem.stat(storedPath);
      return stats.isFile();
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: unknown }).code === 'ENOENT'
      ) {
        return false;
      }

      throw error;
    }
  }
}
