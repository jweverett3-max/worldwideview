// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { crc32, createZip } from "./zip";

const MODIFIED = new Date("2026-03-04T05:06:08Z");

describe("crc32", () => {
    it("matches the known CRC-32 of a reference string", () => {
        // "123456789" has the canonical CRC-32 check value 0xcbf43926.
        expect(crc32(Buffer.from("123456789", "ascii"))).toBe(0xcbf43926);
    });

    it("returns 0 for empty input", () => {
        expect(crc32(Buffer.alloc(0))).toBe(0);
    });
});

describe("createZip", () => {
    it("writes an archive that the system unzip can list and extract", () => {
        const entries = [
            { name: "pass.json", data: Buffer.from('{"formatVersion":1}', "utf8") },
            { name: "manifest.json", data: Buffer.from('{"pass.json":"abc"}', "utf8") },
            { name: "signature", data: Buffer.from([0x30, 0x82, 0x01, 0x02]) },
        ];

        const workDir = mkdtempSync(join(tmpdir(), "wwv-zip-"));
        try {
            const archivePath = join(workDir, "test.zip");
            writeFileSync(archivePath, createZip(entries, MODIFIED));

            // `unzip -t` walks the central directory and verifies every CRC.
            execFileSync("unzip", ["-t", archivePath], { stdio: ["ignore", "ignore", "pipe"] });
            execFileSync("unzip", ["-o", archivePath, "-d", join(workDir, "out")], {
                stdio: ["ignore", "ignore", "pipe"],
            });

            for (const entry of entries) {
                expect(readFileSync(join(workDir, "out", entry.name))).toEqual(entry.data);
            }
        } finally {
            rmSync(workDir, { recursive: true, force: true });
        }
    });

    it("records one central directory entry per file", () => {
        const archive = createZip([
            { name: "a.txt", data: Buffer.from("a") },
            { name: "b.txt", data: Buffer.from("bb") },
        ], MODIFIED);

        // Entry count lives 8 bytes into the 22-byte end-of-central-directory record.
        expect(archive.readUInt16LE(archive.length - 22 + 8)).toBe(2);
        expect(archive.readUInt32LE(archive.length - 22)).toBe(0x06054b50);
    });

    it("produces an empty but valid archive for no entries", () => {
        const archive = createZip([], MODIFIED);
        expect(archive).toHaveLength(22);
        expect(archive.readUInt16LE(8)).toBe(0);
    });
});
