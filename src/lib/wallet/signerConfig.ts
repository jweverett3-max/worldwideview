import { createPrivateKey } from "node:crypto";

import type { PassIdentity } from "./passJson";
import type { SignerMaterial } from "./pkcs7";

/**
 * Loads the Apple Wallet signing credentials from the environment.
 *
 * Apple will not let just anyone mint a Wallet pass: every pass must be sealed
 * with a Pass Type ID certificate issued to a paid Apple Developer account.
 * Without those credentials this feature can build a pass but cannot sign one,
 * and iOS will refuse it — so the absence is reported clearly rather than
 * failing deep inside the signing code.
 */

const CERTIFICATE_PEM_PATTERN = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/;

export interface SignerConfig {
    identity: PassIdentity;
    material: SignerMaterial;
}

export type SignerConfigResult =
    | { configured: true; config: SignerConfig }
    | { configured: false; missing: string[] };

/**
 * Accept either a raw PEM or a base64 blob containing one — environments vary
 * in how gracefully they carry multi-line secrets.
 */
function normalisePem(value: string): string {
    if (value.includes("-----BEGIN")) return value;
    const decoded = Buffer.from(value, "base64").toString("utf8");
    if (decoded.includes("-----BEGIN")) return decoded;
    throw new Error("Value is neither a PEM block nor base64-encoded PEM");
}

function pemCertificateToDer(pem: string, label: string): Buffer {
    const match = CERTIFICATE_PEM_PATTERN.exec(normalisePem(pem));
    if (!match) throw new Error(`${label} does not contain a CERTIFICATE block`);
    return Buffer.from(match[1].replace(/\s+/g, ""), "base64");
}

function readEnv(name: string): string | undefined {
    const value = process.env[name];
    return value && value.trim().length > 0 ? value : undefined;
}

const REQUIRED_VARS = [
    "WALLET_PASS_TYPE_IDENTIFIER",
    "WALLET_TEAM_IDENTIFIER",
    "WALLET_PASS_CERTIFICATE",
    "WALLET_PASS_PRIVATE_KEY",
    "WALLET_WWDR_CERTIFICATE",
] as const;

let cached: SignerConfigResult | null = null;

/** Build the signer config from environment variables, throwing on bad input. */
function loadSignerConfig(): SignerConfigResult {
    const missing = REQUIRED_VARS.filter((name) => readEnv(name) === undefined);
    if (missing.length > 0) return { configured: false, missing: [...missing] };

    const passphrase = readEnv("WALLET_PASS_PRIVATE_KEY_PASSPHRASE");

    return {
        configured: true,
        config: {
            identity: {
                passTypeIdentifier: readEnv("WALLET_PASS_TYPE_IDENTIFIER") as string,
                teamIdentifier: readEnv("WALLET_TEAM_IDENTIFIER") as string,
                organizationName: readEnv("WALLET_ORGANIZATION_NAME") ?? "WorldWideView",
            },
            material: {
                signerCertificateDer: pemCertificateToDer(
                    readEnv("WALLET_PASS_CERTIFICATE") as string,
                    "WALLET_PASS_CERTIFICATE",
                ),
                intermediateCertificateDer: pemCertificateToDer(
                    readEnv("WALLET_WWDR_CERTIFICATE") as string,
                    "WALLET_WWDR_CERTIFICATE",
                ),
                privateKey: createPrivateKey({
                    key: normalisePem(readEnv("WALLET_PASS_PRIVATE_KEY") as string),
                    ...(passphrase ? { passphrase } : {}),
                }),
            },
        },
    };
}

/**
 * Memoised accessor — environment variables do not change while the server is
 * running, and parsing a private key on every request would be wasteful.
 */
export function getSignerConfig(): SignerConfigResult {
    if (!cached) cached = loadSignerConfig();
    return cached;
}

/** Test seam: forget the memoised config so a new environment is picked up. */
export function resetSignerConfigCache(): void {
    cached = null;
}
