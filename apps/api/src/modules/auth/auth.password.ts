import {
  argon2,
  randomBytes,
  timingSafeEqual,
  type Argon2Parameters,
} from 'node:crypto';

const PASSWORD_FORMAT = 'evolqity';
const PASSWORD_FORMAT_VERSION = 1;
const ARGON2_ALGORITHM = 'argon2id';
const ARGON2_MEMORY_KIB = 64 * 1024;
const ARGON2_PASSES = 3;
const ARGON2_PARALLELISM = 1;
const ARGON2_SALT_LENGTH = 16;
const ARGON2_HASH_LENGTH = 32;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_BYTES = 1024;

// Stored format:
// $evolqity$argon2id$v=1$m=<KiB>,t=<passes>,p=<parallelism>,l=<bytes>$<salt>$<hash>
interface ParsedPasswordHash {
  salt: Buffer;
  hash: Buffer;
}

function validatePassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `Password must contain at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }

  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new Error('Password is too long.');
  }
}

function derivePasswordHash(password: string, salt: Buffer): Promise<Buffer> {
  const parameters: Argon2Parameters = {
    message: Buffer.from(password, 'utf8'),
    nonce: salt,
    parallelism: ARGON2_PARALLELISM,
    tagLength: ARGON2_HASH_LENGTH,
    memory: ARGON2_MEMORY_KIB,
    passes: ARGON2_PASSES,
  };

  return new Promise((resolve, reject) => {
    argon2(ARGON2_ALGORITHM, parameters, (error, derivedKey) => {
      if (error !== null) {
        reject(error);
        return;
      }

      resolve(derivedKey);
    });
  });
}

function decodeBase64Url(value: string, expectedLength: number): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }

  const decoded = Buffer.from(value, 'base64url');

  if (
    decoded.length !== expectedLength ||
    decoded.toString('base64url') !== value
  ) {
    return null;
  }

  return decoded;
}

function parseStoredHash(storedHash: string): ParsedPasswordHash | null {
  const parts = storedHash.split('$');

  if (
    parts.length !== 7 ||
    parts[0] !== '' ||
    parts[1] !== PASSWORD_FORMAT ||
    parts[2] !== ARGON2_ALGORITHM ||
    parts[3] !== `v=${PASSWORD_FORMAT_VERSION}` ||
    parts[4] !==
      `m=${ARGON2_MEMORY_KIB},t=${ARGON2_PASSES},p=${ARGON2_PARALLELISM},l=${ARGON2_HASH_LENGTH}`
  ) {
    return null;
  }

  const saltValue = parts[5];
  const hashValue = parts[6];

  if (saltValue === undefined || hashValue === undefined) {
    return null;
  }

  const salt = decodeBase64Url(saltValue, ARGON2_SALT_LENGTH);
  const hash = decodeBase64Url(hashValue, ARGON2_HASH_LENGTH);

  if (salt === null || hash === null) {
    return null;
  }

  return { salt, hash };
}

export async function hashPassword(password: string): Promise<string> {
  validatePassword(password);

  const salt = randomBytes(ARGON2_SALT_LENGTH);
  const hash = await derivePasswordHash(password, salt);
  const parameters =
    `m=${ARGON2_MEMORY_KIB},t=${ARGON2_PASSES},` +
    `p=${ARGON2_PARALLELISM},l=${ARGON2_HASH_LENGTH}`;

  return [
    '',
    PASSWORD_FORMAT,
    ARGON2_ALGORITHM,
    `v=${PASSWORD_FORMAT_VERSION}`,
    parameters,
    salt.toString('base64url'),
    hash.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const parsed = parseStoredHash(storedHash);

  if (parsed === null) {
    return false;
  }

  try {
    validatePassword(password);
    const candidateHash = await derivePasswordHash(password, parsed.salt);

    return timingSafeEqual(candidateHash, parsed.hash);
  } catch {
    return false;
  }
}
