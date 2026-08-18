/**
 * PNG sanity checks for images arriving from the browser.
 *
 * The client resizes the uploaded picture on a canvas before posting it, so by
 * the time bytes reach the server they should already be PNGs of an exact size.
 * We re-check that here rather than trust it: the client is just the first
 * check, never the only one.
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IHDR_OFFSET = 8;
const IHDR_TYPE = "IHDR";

export interface PngDimensions {
    width: number;
    height: number;
}

/** Read the width and height from a PNG's IHDR chunk. */
export function readPngDimensions(data: Buffer): PngDimensions {
    if (data.length < 24 || !data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
        throw new Error("Not a PNG image");
    }
    if (data.toString("ascii", IHDR_OFFSET + 4, IHDR_OFFSET + 8) !== IHDR_TYPE) {
        throw new Error("PNG is missing its IHDR header chunk");
    }

    return {
        width: data.readUInt32BE(IHDR_OFFSET + 8),
        height: data.readUInt32BE(IHDR_OFFSET + 12),
    };
}

/**
 * Decode a base64 (or data-URL) PNG and assert its exact pixel dimensions.
 *
 * @param encoded    Base64 payload, with or without a `data:image/png;base64,` prefix.
 * @param expected   The dimensions the image must have.
 * @param maxBytes   Reject anything larger, before decoding cost is incurred.
 * @param label      Used in error messages so the caller knows which image failed.
 */
export function decodePngExactly(
    encoded: string,
    expected: PngDimensions,
    maxBytes: number,
    label: string,
): Buffer {
    const base64 = encoded.startsWith("data:")
        ? encoded.slice(encoded.indexOf(",") + 1)
        : encoded;

    // Base64 inflates by 4/3; check the encoded length before allocating.
    if (Math.ceil((base64.length * 3) / 4) > maxBytes) {
        throw new Error(`${label} exceeds the ${Math.floor(maxBytes / 1024)} KB limit`);
    }

    const data = Buffer.from(base64, "base64");
    const { width, height } = readPngDimensions(data);
    if (width !== expected.width || height !== expected.height) {
        throw new Error(
            `${label} must be exactly ${expected.width}x${expected.height}px, got ${width}x${height}px`,
        );
    }

    return data;
}
