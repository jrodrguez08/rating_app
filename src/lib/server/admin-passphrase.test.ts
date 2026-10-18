import { randomBytes, scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import { parseScryptConfig, verifyAdminPassphrase } from "./admin-passphrase";

describe("admin passphrase", () => {
  it("verifies a salted scrypt digest", async () => {
    const passphrase = "a long independent passphrase";
    const salt = randomBytes(16);
    const digest = scryptSync(passphrase, salt, 32, { N: 16_384, r: 8, p: 1 });
    const environment = {
      ADMIN_PASSPHRASE_SCRYPT: `scrypt$v1$16384$8$1$${salt.toString("base64")}$${digest.toString("base64")}`,
    };
    await expect(verifyAdminPassphrase(passphrase, environment)).resolves.toBe(
      true,
    );
    await expect(
      verifyAdminPassphrase("an incorrect passphrase", environment),
    ).resolves.toBe(false);
    await expect(verifyAdminPassphrase("", environment)).resolves.toBe(false);
  });

  it("rejects malformed configuration", () => {
    expect(() => parseScryptConfig("plain-text-secret")).toThrow(
      /unavailable/i,
    );
    expect(() => parseScryptConfig(undefined)).toThrow(/unavailable/i);
  });
});
