// @vitest-environment node
import { describe, expect, it } from "vitest";

import { makePng } from "./__testFixtures__/png";
import { decodePngExactly, readPngDimensions } from "./png";

describe("readPngDimensions", () => {
    it("reads the size from the IHDR chunk", () => {
        expect(readPngDimensions(makePng(58, 29))).toEqual({ width: 58, height: 29 });
    });

    it("rejects data that is not a PNG", () => {
        expect(() => readPngDimensions(Buffer.from("this is a JPEG, honest", "utf8")))
            .toThrow(/Not a PNG/);
    });

    it("rejects a PNG whose first chunk is not IHDR", () => {
        const png = makePng(4, 4);
        png.write("IDAT", 12, "ascii");
        expect(() => readPngDimensions(png)).toThrow(/IHDR/);
    });
});

describe("decodePngExactly", () => {
    const png = makePng(29, 29);
    const base64 = png.toString("base64");

    it("accepts a bare base64 payload of the expected size", () => {
        expect(decodePngExactly(base64, { width: 29, height: 29 }, 100_000, "icon.png")).toEqual(png);
    });

    it("accepts a data URL and strips the prefix", () => {
        const dataUrl = `data:image/png;base64,${base64}`;
        expect(decodePngExactly(dataUrl, { width: 29, height: 29 }, 100_000, "icon.png")).toEqual(png);
    });

    it("rejects an image of the wrong size, naming the file", () => {
        expect(() => decodePngExactly(base64, { width: 58, height: 58 }, 100_000, "icon@2x.png"))
            .toThrow(/icon@2x\.png must be exactly 58x58px, got 29x29px/);
    });

    it("rejects oversized payloads before decoding them", () => {
        expect(() => decodePngExactly(base64, { width: 29, height: 29 }, 16, "icon.png"))
            .toThrow(/exceeds the/);
    });
});
