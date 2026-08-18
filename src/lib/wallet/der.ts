/**
 * Minimal ASN.1 DER encoder plus the sliver of an X.509 reader needed to
 * build a detached PKCS#7 / CMS signature for an Apple Wallet pass.
 *
 * Analogy: DER is a set of nesting boxes. Every box has a label saying what
 * kind of box it is (the tag), a note saying how big it is (the length), and
 * the contents (the value). Nothing here interprets the contents beyond what
 * signing requires — we mostly re-wrap bytes that came out of a certificate.
 */

export const TAG_INTEGER = 0x02;
export const TAG_BIT_STRING = 0x03;
export const TAG_OCTET_STRING = 0x04;
export const TAG_NULL = 0x05;
export const TAG_OID = 0x06;
export const TAG_UTC_TIME = 0x17;
export const TAG_SEQUENCE = 0x30;
export const TAG_SET = 0x31;

/** Context-specific constructed tag `[n]`, e.g. `[0]` is `0xa0`. */
export function contextTag(n: number): number {
    return 0xa0 | n;
}

/** Encode a DER length prefix (short form under 128, long form above). */
function encodeLength(length: number): Buffer {
    if (length < 0x80) return Buffer.from([length]);

    const bytes: number[] = [];
    let remaining = length;
    while (remaining > 0) {
        bytes.unshift(remaining & 0xff);
        remaining = Math.floor(remaining / 256);
    }
    return Buffer.from([0x80 | bytes.length, ...bytes]);
}

/** Wrap raw content bytes in a tag-length-value triple. */
export function derEncode(tag: number, content: Buffer): Buffer {
    return Buffer.concat([Buffer.from([tag]), encodeLength(content.length), content]);
}

export function derSequence(parts: Buffer[]): Buffer {
    return derEncode(TAG_SEQUENCE, Buffer.concat(parts));
}

/**
 * DER requires the members of a SET OF to be sorted by their encodings, so
 * callers hand us the encoded members and we order them here.
 */
export function derSet(parts: Buffer[]): Buffer {
    const sorted = [...parts].sort(Buffer.compare);
    return derEncode(TAG_SET, Buffer.concat(sorted));
}

export function derNull(): Buffer {
    return Buffer.from([TAG_NULL, 0x00]);
}

export function derOctetString(content: Buffer): Buffer {
    return derEncode(TAG_OCTET_STRING, content);
}

/** Encode a dotted object identifier such as `1.2.840.113549.1.7.2`. */
export function derOid(dotted: string): Buffer {
    const arcs = dotted.split(".").map((part) => Number.parseInt(part, 10));
    if (arcs.length < 2 || arcs.some((arc) => !Number.isInteger(arc) || arc < 0)) {
        throw new Error(`Invalid OID: ${dotted}`);
    }

    const bytes: number[] = [arcs[0] * 40 + arcs[1]];
    for (const arc of arcs.slice(2)) {
        const base128: number[] = [arc & 0x7f];
        let remaining = Math.floor(arc / 128);
        while (remaining > 0) {
            base128.unshift((remaining & 0x7f) | 0x80);
            remaining = Math.floor(remaining / 128);
        }
        bytes.push(...base128);
    }

    return derEncode(TAG_OID, Buffer.from(bytes));
}

/** Encode a small non-negative integer (enough for CMS version numbers). */
export function derInteger(value: number): Buffer {
    if (!Number.isInteger(value) || value < 0) {
        throw new Error(`derInteger only encodes non-negative integers, got ${value}`);
    }

    const bytes: number[] = [];
    let remaining = value;
    do {
        bytes.unshift(remaining & 0xff);
        remaining = Math.floor(remaining / 256);
    } while (remaining > 0);

    // A leading bit of 1 would read as negative, so pad with a zero byte.
    if ((bytes[0] & 0x80) !== 0) bytes.unshift(0x00);
    return derEncode(TAG_INTEGER, Buffer.from(bytes));
}

/** Encode a UTCTime (`YYMMDDHHMMSSZ`). Valid for dates before 2050. */
export function derUtcTime(date: Date): Buffer {
    if (date.getUTCFullYear() >= 2050) {
        throw new Error("derUtcTime cannot encode dates from 2050 onwards");
    }
    const pad = (n: number): string => String(n).padStart(2, "0");
    const text = [
        pad(date.getUTCFullYear() % 100),
        pad(date.getUTCMonth() + 1),
        pad(date.getUTCDate()),
        pad(date.getUTCHours()),
        pad(date.getUTCMinutes()),
        pad(date.getUTCSeconds()),
    ].join("") + "Z";
    return derEncode(TAG_UTC_TIME, Buffer.from(text, "ascii"));
}

/** An `AlgorithmIdentifier` with absent-as-NULL parameters. */
export function derAlgorithmIdentifier(oid: string): Buffer {
    return derSequence([derOid(oid), derNull()]);
}

export interface DerTlv {
    tag: number;
    /** The complete tag-length-value bytes as they appear in the source. */
    raw: Buffer;
    /** The value bytes, without tag or length. */
    value: Buffer;
    /** Offset of the first byte after this triple. */
    end: number;
}

/** Read a single tag-length-value triple starting at `offset`. */
export function readTlv(buffer: Buffer, offset = 0): DerTlv {
    if (offset + 2 > buffer.length) throw new Error("DER truncated: no tag/length");

    const tag = buffer[offset];
    const lengthByte = buffer[offset + 1];
    let length: number;
    let headerLength: number;

    if ((lengthByte & 0x80) === 0) {
        length = lengthByte;
        headerLength = 2;
    } else {
        const lengthBytes = lengthByte & 0x7f;
        if (lengthBytes === 0 || lengthBytes > 4) {
            throw new Error("DER truncated: unsupported length encoding");
        }
        if (offset + 2 + lengthBytes > buffer.length) {
            throw new Error("DER truncated: incomplete length");
        }
        length = 0;
        for (let i = 0; i < lengthBytes; i += 1) {
            length = length * 256 + buffer[offset + 2 + i];
        }
        headerLength = 2 + lengthBytes;
    }

    const end = offset + headerLength + length;
    if (end > buffer.length) throw new Error("DER truncated: value overruns buffer");

    return {
        tag,
        raw: buffer.subarray(offset, end),
        value: buffer.subarray(offset + headerLength, end),
        end,
    };
}

export interface CertificateIdentity {
    /** The raw DER of the certificate's issuer `Name`. */
    issuerDer: Buffer;
    /** The raw DER of the certificate's `serialNumber` INTEGER. */
    serialNumberDer: Buffer;
}

/**
 * Pull the issuer and serial number out of a DER certificate. CMS identifies
 * a signer by that pair, and re-using the original bytes avoids any risk of
 * re-encoding them differently than the certificate authority did.
 */
export function readCertificateIdentity(certificateDer: Buffer): CertificateIdentity {
    const certificate = readTlv(certificateDer);
    if (certificate.tag !== TAG_SEQUENCE) throw new Error("Certificate is not a DER SEQUENCE");

    const tbsCertificate = readTlv(certificate.value);
    if (tbsCertificate.tag !== TAG_SEQUENCE) throw new Error("tbsCertificate is not a DER SEQUENCE");

    let cursor = 0;
    let field = readTlv(tbsCertificate.value, cursor);

    // `version` is `[0] EXPLICIT` and optional — skip it when present.
    if (field.tag === contextTag(0)) {
        cursor = field.end;
        field = readTlv(tbsCertificate.value, cursor);
    }

    if (field.tag !== TAG_INTEGER) throw new Error("Certificate serialNumber not found");
    const serialNumberDer = Buffer.from(field.raw);

    const signatureAlgorithm = readTlv(tbsCertificate.value, field.end);
    const issuer = readTlv(tbsCertificate.value, signatureAlgorithm.end);
    if (issuer.tag !== TAG_SEQUENCE) throw new Error("Certificate issuer not found");

    return { issuerDer: Buffer.from(issuer.raw), serialNumberDer };
}
