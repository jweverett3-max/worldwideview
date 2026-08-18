import { deflateSync } from "node:zlib";

import { crc32 } from "../zip";

/**
 * A minimal PNG encoder used only by tests, so fixtures can be produced at any
 * exact size without pulling in an image library or a headless canvas.
 */

function chunk(type: string, data: Buffer): Buffer {
    const typeBytes = Buffer.from(type, "ascii");
    const body = Buffer.concat([typeBytes, data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([length, body, checksum]);
}

/** Build a solid-colour RGB PNG of the requested size. */
export function makePng(width: number, height: number, rgb: [number, number, number] = [200, 30, 30]): Buffer {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8; // bit depth
    header[9] = 2; // colour type: truecolour
    header[10] = 0; // deflate
    header[11] = 0; // adaptive filtering
    header[12] = 0; // no interlace

    const stride = width * 3 + 1;
    const raw = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y += 1) {
        const rowStart = y * stride;
        raw[rowStart] = 0; // filter type: none
        for (let x = 0; x < width; x += 1) {
            const offset = rowStart + 1 + x * 3;
            raw[offset] = rgb[0];
            raw[offset + 1] = rgb[1];
            raw[offset + 2] = rgb[2];
        }
    }

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", header),
        chunk("IDAT", deflateSync(raw)),
        chunk("IEND", Buffer.alloc(0)),
    ]);
}
