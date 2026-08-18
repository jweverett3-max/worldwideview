// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { getSignerConfig, resetSignerConfigCache } from "./signerConfig";

const VARS = [
    "WALLET_PASS_TYPE_IDENTIFIER",
    "WALLET_TEAM_IDENTIFIER",
    "WALLET_ORGANIZATION_NAME",
    "WALLET_PASS_CERTIFICATE",
    "WALLET_PASS_PRIVATE_KEY",
    "WALLET_PASS_PRIVATE_KEY_PASSPHRASE",
    "WALLET_WWDR_CERTIFICATE",
] as const;

let workDir = "";
let certificatePem = "";
let privateKeyPem = "";
let openssl = true;

beforeAll(() => {
    try {
        workDir = mkdtempSync(join(tmpdir(), "wwv-signer-"));
        execFileSync("openssl", [
            "req", "-x509", "-newkey", "rsa:2048", "-nodes",
            "-keyout", "key.pem", "-out", "cert.pem", "-days", "2", "-subj", "/CN=Test",
        ], { cwd: workDir, stdio: "ignore" });
        certificatePem = readFileSync(join(workDir, "cert.pem"), "utf8");
        privateKeyPem = readFileSync(join(workDir, "key.pem"), "utf8");
    } catch {
        openssl = false;
    }
});

afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
});

afterEach(() => {
    for (const name of VARS) delete process.env[name];
    resetSignerConfigCache();
});

function configureEnv(overrides: Partial<Record<(typeof VARS)[number], string>> = {}) {
    process.env.WALLET_PASS_TYPE_IDENTIFIER = "pass.app.worldwideview.thing2";
    process.env.WALLET_TEAM_IDENTIFIER = "ABCDE12345";
    process.env.WALLET_PASS_CERTIFICATE = certificatePem;
    process.env.WALLET_PASS_PRIVATE_KEY = privateKeyPem;
    process.env.WALLET_WWDR_CERTIFICATE = certificatePem;
    Object.assign(process.env, overrides);
    resetSignerConfigCache();
}

describe("getSignerConfig", () => {
    it("reports every missing variable rather than failing on the first", () => {
        resetSignerConfigCache();
        const result = getSignerConfig();
        expect(result.configured).toBe(false);
        if (!result.configured) {
            expect(result.missing).toEqual([
                "WALLET_PASS_TYPE_IDENTIFIER",
                "WALLET_TEAM_IDENTIFIER",
                "WALLET_PASS_CERTIFICATE",
                "WALLET_PASS_PRIVATE_KEY",
                "WALLET_WWDR_CERTIFICATE",
            ]);
        }
    });

    it("treats a blank variable as missing", () => {
        if (!openssl) return;
        configureEnv({ WALLET_TEAM_IDENTIFIER: "   " });
        const result = getSignerConfig();
        expect(result.configured).toBe(false);
        if (!result.configured) expect(result.missing).toContain("WALLET_TEAM_IDENTIFIER");
    });

    it("loads PEM credentials and defaults the organisation name", () => {
        if (!openssl) return;
        configureEnv();
        const result = getSignerConfig();
        expect(result.configured).toBe(true);
        if (result.configured) {
            expect(result.config.identity.organizationName).toBe("WorldWideView");
            expect(result.config.material.signerCertificateDer.length).toBeGreaterThan(100);
            expect(result.config.material.privateKey.type).toBe("private");
        }
    });

    it("accepts base64-wrapped PEM, which some hosts require for multi-line secrets", () => {
        if (!openssl) return;
        configureEnv({
            WALLET_PASS_CERTIFICATE: Buffer.from(certificatePem, "utf8").toString("base64"),
            WALLET_PASS_PRIVATE_KEY: Buffer.from(privateKeyPem, "utf8").toString("base64"),
        });
        const result = getSignerConfig();
        expect(result.configured).toBe(true);
    });

    it("throws a named error when a certificate variable holds something else", () => {
        if (!openssl) return;
        configureEnv({ WALLET_WWDR_CERTIFICATE: "not-a-certificate" });
        expect(() => getSignerConfig()).toThrow(/neither a PEM block nor base64/);
    });

    it("memoises the result until the cache is reset", () => {
        if (!openssl) return;
        configureEnv();
        const first = getSignerConfig();
        expect(getSignerConfig()).toBe(first);
        resetSignerConfigCache();
        expect(getSignerConfig()).not.toBe(first);
    });
});
