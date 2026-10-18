import { scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
const MAX_MEMORY = 64 * 1024 * 1024;

type Environment = Readonly<Record<string, string | undefined>>;

interface ScryptConfig {
  cost: number;
  blockSize: number;
  parallelization: number;
  salt: Buffer;
  expected: Buffer;
}

export async function verifyAdminPassphrase(
  passphrase: string,
  environment: Environment = process.env,
): Promise<boolean> {
  const config = parseScryptConfig(environment.ADMIN_PASSPHRASE_SCRYPT);
  if (passphrase.length < 16 || passphrase.length > 256) return false;
  const actual = await new Promise<Buffer>((resolve, reject) => {
    scryptCallback(
      passphrase,
      config.salt,
      config.expected.length,
      {
        N: config.cost,
        r: config.blockSize,
        p: config.parallelization,
        maxmem: MAX_MEMORY,
      },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
  return timingSafeEqual(actual, config.expected);
}

export function parseScryptConfig(value: string | undefined): ScryptConfig {
  const parts = value?.split("$") ?? [];
  if (parts.length !== 7 || parts[0] !== "scrypt" || parts[1] !== "v1") {
    throw new Error("Admin passphrase configuration is unavailable.");
  }
  const cost = Number(parts[2]);
  const blockSize = Number(parts[3]);
  const parallelization = Number(parts[4]);
  const salt = decodeBase64(parts[5]);
  const expected = decodeBase64(parts[6]);
  if (
    !Number.isInteger(cost) ||
    cost < 16_384 ||
    cost > 65_536 ||
    (cost & (cost - 1)) !== 0 ||
    blockSize !== 8 ||
    parallelization < 1 ||
    parallelization > 4 ||
    salt.length < 16 ||
    expected.length < 32
  ) {
    throw new Error("Admin passphrase configuration is unavailable.");
  }
  return { cost, blockSize, parallelization, salt, expected };
}

function decodeBase64(value: string | undefined): Buffer {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return Buffer.alloc(0);
  return Buffer.from(value, "base64");
}
