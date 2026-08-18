// @vitest-environment node
import { execFileSync } from "node:child_process";
import { createHash, createPrivateKey } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makePng } from "./__testFixtures__/png";
import { buildPkpass } from "./buildPass";
import type { PassIdentity } from "./passJson";
import { imageSpecsForLayout, type PassDraft, type PassLayout } from "./passSpec";
import type { SignerMaterial } from "./pkcs7";

/**
 * End-to-end check on the `.pkpass` bundle: unzip it, confirm every manifest
 * hash matches the file it names, and have OpenSSL verify the detached
 * signature over that manifest. That is exactly the chain iOS walks.
 */

const IDENTITY: PassIdentity = {
    passTypeIdentifier: "pass.app.worldwideview.thing2",
    teamIdentifier: "ABCDE12345",
    organizationName: "WorldWideView",
};

function toolAvailable(name: string, args: string[]): boolean {
    try {
        execFileSync(name, args, { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

const openssl = toolAvailable("openssl", ["version"]);
const unzip = toolAvailable("unzip", ["-v"]);

let workDir = "";
let material: SignerMaterial;

function pemToDer(pem: string): Buffer {
    return Buffer.from(
        pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, ""),
        "base64",
    );
}

beforeAll(() => {
    if (!openssl) return;
    workDir = mkdtempSync(join(tmpdir(), "wwv-pkpass-"));
    const run = (args: string[]): string =>
        execFileSync("openssl", args, { cwd: workDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

    run(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.pem",
        "-days", "2", "-subj", "/CN=Test WWDR"]);
    run(["req", "-newkey", "rsa:2048", "-nodes", "-keyout", "leaf.key", "-out", "leaf.csr",
        "-subj", "/CN=pass.app.worldwideview.thing2"]);
    run(["x509", "-req", "-in", "leaf.csr", "-CA", "ca.pem", "-CAkey", "ca.key",
        "-CAcreateserial", "-out", "leaf.pem", "-days", "1"]);

    material = {
        signerCertificateDer: pemToDer(run(["x509", "-in", "leaf.pem"])),
        intermediateCertificateDer: pemToDer(run(["x509", "-in", "ca.pem"])),
        privateKey: createPrivateKey(readFileSync(join(workDir, "leaf.key"), "utf8")),
    };
});

afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
});

function makeDraft(layout: PassLayout, overrides: Partial<PassDraft> = {}): PassDraft {
    const images: Record<string, string> = {};
    for (const spec of imageSpecsForLayout(layout)) {
        images[spec.name] = `data:image/png;base64,${makePng(spec.width, spec.height).toString("base64")}`;
    }
    return {
        layout,
        title: "Holiday",
        description: "A picture in my wallet",
        headline: "Lisbon",
        fields: [{ label: "Where", value: "Lisbon" }],
        backNote: "Taken in 2019",
        barcodeMessage: "https://example.test/pass",
        backgroundColor: "#102030",
        foregroundColor: "#ffffff",
        labelColor: "#aabbcc",
        images,
        ...overrides,
    };
}

function build(layout: PassLayout, overrides: Partial<PassDraft> = {}): Buffer {
    return buildPkpass({
        draft: makeDraft(layout, overrides),
        identity: IDENTITY,
        material,
        serialNumber: "serial-1",
        now: new Date("2026-03-04T05:06:08Z"),
    });
}

describe.skipIf(!openssl)("buildPkpass", () => {
    it.each(["banner", "square"] as const)(
        "produces a %s bundle whose manifest and signature both verify",
        (layout) => {
            const bundleDir = join(workDir, `bundle-${layout}`);
            const archivePath = join(workDir, `${layout}.pkpass`);
            writeFileSync(archivePath, build(layout));

            if (unzip) {
                execFileSync("unzip", ["-t", archivePath], { stdio: ["ignore", "ignore", "pipe"] });
                execFileSync("unzip", ["-o", archivePath, "-d", bundleDir], {
                    stdio: ["ignore", "ignore", "pipe"],
                });

                const manifest = JSON.parse(
                    readFileSync(join(bundleDir, "manifest.json"), "utf8"),
                ) as Record<string, string>;

                // Every file except the manifest and its signature must be listed.
                const listed = new Set(Object.keys(manifest));
                const onDisk = readdirSync(bundleDir)
                    .filter((name) => name !== "manifest.json" && name !== "signature");
                expect(new Set(onDisk)).toEqual(listed);

                for (const [name, digest] of Object.entries(manifest)) {
                    const actual = createHash("sha1").update(readFileSync(join(bundleDir, name))).digest("hex");
                    expect(actual, `${name} digest`).toBe(digest);
                }

                expect(() =>
                    execFileSync("openssl", [
                        "cms", "-verify", "-inform", "DER",
                        "-in", join(bundleDir, "signature"),
                        "-content", join(bundleDir, "manifest.json"), "-binary",
                        "-CAfile", "ca.pem", "-purpose", "any", "-out", "/dev/null",
                    ], { cwd: workDir, stdio: ["ignore", "ignore", "pipe"] }),
                ).not.toThrow();

                const pass = JSON.parse(readFileSync(join(bundleDir, "pass.json"), "utf8"));
                expect(pass.serialNumber).toBe("serial-1");
                expect(pass[layout === "banner" ? "storeCard" : "generic"]).toBeDefined();
            }
        },
    );

    it("includes exactly the images the layout calls for", () => {
        const archive = build("banner");
        for (const spec of imageSpecsForLayout("banner")) {
            expect(archive.includes(Buffer.from(spec.name, "utf8")), spec.name).toBe(true);
        }
        // Thumbnails belong to the square layout only.
        expect(archive.includes(Buffer.from("thumbnail.png", "utf8"))).toBe(false);
    });

    it("refuses to build when an image is missing", () => {
        const draft = makeDraft("banner");
        delete draft.images["icon@2x.png"];
        expect(() => buildPkpass({
            draft, identity: IDENTITY, material, serialNumber: "s", now: new Date(),
        })).toThrow(/Missing pass image: icon@2x\.png/);
    });

    it("refuses to build when an image is the wrong size", () => {
        const draft = makeDraft("banner");
        draft.images["icon.png"] = makePng(30, 30).toString("base64");
        expect(() => buildPkpass({
            draft, identity: IDENTITY, material, serialNumber: "s", now: new Date(),
        })).toThrow(/icon\.png must be exactly 29x29px/);
    });

    it("is byte-for-byte reproducible for the same input", () => {
        expect(build("banner").equals(build("banner"))).toBe(true);
    });
});
