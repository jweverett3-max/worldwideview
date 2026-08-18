/**
 * A tiny ZIP writer using the "stored" (uncompressed) method.
 *
 * A `.pkpass` file is just a ZIP archive with a fixed set of members, and the
 * files inside it are already-compressed PNGs plus a few small JSON documents,
 * so deflating them would buy nothing. Writing the container by hand keeps the
 * dependency count at zero.
 */

export interface ZipEntry {
    /** Path inside the archive, e.g. `pass.json`. */
    name: string;
    data: Buffer;
}

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const VERSION_STORED = 20;
const METHOD_STORED = 0;

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
    if (crcTable) return crcTable;

    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
        let value = i;
        for (let bit = 0; bit < 8; bit += 1) {
            value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        table[i] = value >>> 0;
    }
    crcTable = table;
    return table;
}

export function crc32(data: Buffer): number {
    const table = getCrcTable();
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i += 1) {
        crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

/** Convert a date into the packed DOS time and date fields ZIP still uses. */
function toDosDateTime(date: Date): { time: number; date: number } {
    const year = Math.max(date.getUTCFullYear(), 1980);
    return {
        time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1),
        date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
    };
}

/**
 * Build a ZIP archive containing `entries`.
 *
 * @param entries  Files to store, in the order they should appear.
 * @param modified Timestamp stamped onto every member.
 */
export function createZip(entries: ZipEntry[], modified: Date): Buffer {
    const { time, date } = toDosDateTime(modified);
    const localChunks: Buffer[] = [];
    const centralChunks: Buffer[] = [];
    let offset = 0;

    for (const entry of entries) {
        const nameBytes = Buffer.from(entry.name, "utf8");
        const checksum = crc32(entry.data);

        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
        localHeader.writeUInt16LE(VERSION_STORED, 4);
        localHeader.writeUInt16LE(0, 6);
        localHeader.writeUInt16LE(METHOD_STORED, 8);
        localHeader.writeUInt16LE(time, 10);
        localHeader.writeUInt16LE(date, 12);
        localHeader.writeUInt32LE(checksum, 14);
        localHeader.writeUInt32LE(entry.data.length, 18);
        localHeader.writeUInt32LE(entry.data.length, 22);
        localHeader.writeUInt16LE(nameBytes.length, 26);
        localHeader.writeUInt16LE(0, 28);

        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0);
        centralHeader.writeUInt16LE(VERSION_STORED, 4);
        centralHeader.writeUInt16LE(VERSION_STORED, 6);
        centralHeader.writeUInt16LE(0, 8);
        centralHeader.writeUInt16LE(METHOD_STORED, 10);
        centralHeader.writeUInt16LE(time, 12);
        centralHeader.writeUInt16LE(date, 14);
        centralHeader.writeUInt32LE(checksum, 16);
        centralHeader.writeUInt32LE(entry.data.length, 20);
        centralHeader.writeUInt32LE(entry.data.length, 24);
        centralHeader.writeUInt16LE(nameBytes.length, 28);
        centralHeader.writeUInt16LE(0, 30);
        centralHeader.writeUInt16LE(0, 32);
        centralHeader.writeUInt16LE(0, 34);
        centralHeader.writeUInt16LE(0, 36);
        centralHeader.writeUInt32LE(0, 38);
        centralHeader.writeUInt32LE(offset, 42);

        localChunks.push(localHeader, nameBytes, entry.data);
        centralChunks.push(centralHeader, nameBytes);
        offset += localHeader.length + nameBytes.length + entry.data.length;
    }

    const centralDirectory = Buffer.concat(centralChunks);
    const endRecord = Buffer.alloc(22);
    endRecord.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
    endRecord.writeUInt16LE(0, 4);
    endRecord.writeUInt16LE(0, 6);
    endRecord.writeUInt16LE(entries.length, 8);
    endRecord.writeUInt16LE(entries.length, 10);
    endRecord.writeUInt32LE(centralDirectory.length, 12);
    endRecord.writeUInt32LE(offset, 16);
    endRecord.writeUInt16LE(0, 20);

    return Buffer.concat([...localChunks, centralDirectory, endRecord]);
}
