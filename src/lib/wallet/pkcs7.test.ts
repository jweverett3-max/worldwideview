// @vitest-environment node
import { execFileSync } from "node:child_process";
import { createPrivateKey } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readTlv, TAG_SEQUENCE } from "./der";
import { signDetached, type SignerMaterial } from "./pkcs7";

/**
 * These tests mint a throwaway certificate chain with the OpenSSL CLI, sign a
 * payload with our own DER builder, and then ask OpenSSL to verify it. If
 * OpenSSL accepts the structure, Apple's verifier will parse it too.
 */

function hasOpenssl(): boolean {
    try {
        execFileSync("openssl", ["version"], { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

const openssl = hasOpenssl();
let workDir = "";
let material: SignerMaterial;

function pemToDer(pem: string): Buffer {
    const body = pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "");
    return Buffer.from(body, "base64");
}

beforeAll(() => {
    if (!openssl) return;
    workDir = mkdtempSync(join(tmpdir(), "wwv-pkcs7-"));

    const run = (args: string[]): string =>
        execFileSync("openssl", args, { cwd: workDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

    // A stand-in for Apple's WWDR intermediate.
    run(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.pem",
        "-days", "2", "-subj", "/CN=Test WWDR"]);
    // A stand-in for the Pass Type ID certificate.
    run(["req", "-newkey", "rsa:2048", "-nodes", "-keyout", "leaf.key", "-out", "leaf.csr",
        "-subj", "/CN=pass.test.worldwideview"]);
    run(["x509", "-req", "-in", "leaf.csr", "-CA", "ca.pem", "-CAkey", "ca.key",
        "-CAcreateserial", "-out", "leaf.pem", "-days", "1"]);

    material = {
        signerCertificateDer: pemToDer(run(["x509", "-in", "leaf.pem"])),
        intermediateCertificateDer: pemToDer(run(["x509", "-in", "ca.pem"])),
        privateKey: createPrivateKey(
            execFileSync("openssl", ["pkey", "-in", "leaf.key"], { cwd: workDir, encoding: "utf8" }),
        ),
    };
});

afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe.skipIf(!openssl)("signDetached", () => {
    it("produces a DER SignedData that OpenSSL verifies against the detached content", () => {
        const content = Buffer.from(JSON.stringify({ "pass.json": "abc123" }), "utf8");
        const signature = signDetached(content, material, new Date("2026-01-02T03:04:05Z"));

        writeFileSync(join(workDir, "content.bin"), content);
        writeFileSync(join(workDir, "signature.der"), signature);

        expect(() =>
            execFileSync("openssl", [
                "cms", "-verify",
                "-inform", "DER", "-in", "signature.der",
                "-content", "content.bin", "-binary",
                "-CAfile", "ca.pem", "-purpose", "any",
                "-out", "/dev/null",
            ], { cwd: workDir, stdio: ["ignore", "ignore", "pipe"] }),
        ).not.toThrow();
    });

    it("rejects content that was altered after signing", () => {
        const content = Buffer.from("original manifest", "utf8");
        const signature = signDetached(content, material, new Date("2026-01-02T03:04:05Z"));

        writeFileSync(join(workDir, "tampered.bin"), Buffer.from("tampered manifest", "utf8"));
        writeFileSync(join(workDir, "tampered.der"), signature);

        expect(() =>
            execFileSync("openssl", [
                "cms", "-verify",
                "-inform", "DER", "-in", "tampered.der",
                "-content", "tampered.bin", "-binary",
                "-CAfile", "ca.pem", "-purpose", "any",
                "-out", "/dev/null",
            ], { cwd: workDir, stdio: ["ignore", "ignore", "pipe"] }),
        ).toThrow();
    });

    it("embeds both the signer and intermediate certificates", () => {
        const signature = signDetached(Buffer.from("x"), material, new Date("2026-01-02T03:04:05Z"));
        expect(signature.includes(material.signerCertificateDer)).toBe(true);
        expect(signature.includes(material.intermediateCertificateDer)).toBe(true);
    });

    it("emits a well-formed outer SEQUENCE spanning the whole buffer", () => {
        const signature = signDetached(Buffer.from("x"), material, new Date("2026-01-02T03:04:05Z"));
        const outer = readTlv(signature);
        expect(outer.tag).toBe(TAG_SEQUENCE);
        expect(outer.end).toBe(signature.length);
    });
});
