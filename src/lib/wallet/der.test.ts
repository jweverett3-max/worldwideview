// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
    contextTag,
    derInteger,
    derOid,
    derSequence,
    derSet,
    derUtcTime,
    readCertificateIdentity,
    readTlv,
    TAG_INTEGER,
    TAG_OID,
    TAG_SEQUENCE,
} from "./der";

describe("derOid", () => {
    it("encodes the CMS signedData identifier", () => {
        // 1.2.840.113549.1.7.2 is the well-known DER encoding below.
        expect(derOid("1.2.840.113549.1.7.2").toString("hex")).toBe("06092a864886f70d010702");
    });

    it("packs the first two arcs into a single byte", () => {
        expect(derOid("2.5.4.3").toString("hex")).toBe("0603550403");
    });

    it("rejects a malformed identifier", () => {
        expect(() => derOid("1")).toThrow();
        expect(() => derOid("1.two.3")).toThrow();
    });
});

describe("derInteger", () => {
    it("encodes small values in one byte", () => {
        expect(derInteger(1).toString("hex")).toBe("020101");
    });

    it("pads values whose top bit would read as negative", () => {
        expect(derInteger(0x80).toString("hex")).toBe("02020080");
    });

    it("rejects negative values", () => {
        expect(() => derInteger(-1)).toThrow();
    });
});

describe("derSet", () => {
    it("orders members by their encodings, as DER requires", () => {
        const set = readTlv(derSet([Buffer.from([0x02, 0x01, 0x05]), Buffer.from([0x02, 0x01, 0x01])]));
        expect(set.value.toString("hex")).toBe("020101020105");
    });
});

describe("derUtcTime", () => {
    it("formats a date as YYMMDDHHMMSSZ", () => {
        const encoded = readTlv(derUtcTime(new Date("2026-08-18T09:07:06Z")));
        expect(encoded.value.toString("ascii")).toBe("260818090706Z");
    });

    it("refuses dates it cannot represent unambiguously", () => {
        expect(() => derUtcTime(new Date("2050-01-01T00:00:00Z"))).toThrow();
    });
});

describe("readTlv", () => {
    it("reads a long-form length", () => {
        const inner = Buffer.concat([Buffer.from([0x04, 0x82, 0x01, 0x2c]), Buffer.alloc(300, 0x41)]);
        const tlv = readTlv(derSequence([inner]));
        expect(tlv.tag).toBe(TAG_SEQUENCE);
        expect(tlv.value).toHaveLength(inner.length);
    });

    it("throws when the value overruns the buffer", () => {
        expect(() => readTlv(Buffer.from([0x30, 0x10, 0x00]))).toThrow(/truncated/);
    });

    it("reports the offset just past the triple", () => {
        const buffer = Buffer.concat([derInteger(7), derInteger(9)]);
        const first = readTlv(buffer);
        expect(first.tag).toBe(TAG_INTEGER);
        expect(readTlv(buffer, first.end).value[0]).toBe(9);
    });
});

describe("contextTag", () => {
    it("builds constructed context-specific tags", () => {
        expect(contextTag(0)).toBe(0xa0);
        expect(contextTag(3)).toBe(0xa3);
    });
});

describe("readCertificateIdentity", () => {
    /** A stand-in certificate: SEQUENCE { tbs SEQUENCE { [0] ver, serial, algid, issuer } }. */
    function fakeCertificate(withVersion: boolean): Buffer {
        const version = Buffer.from([contextTag(0), 0x03, 0x02, 0x01, 0x02]);
        const serial = derInteger(0x1234);
        const algorithm = derSequence([derOid("1.2.840.113549.1.1.11")]);
        const issuer = derSequence([derSet([derSequence([derOid("2.5.4.3"), Buffer.from([0x0c, 0x02, 0x43, 0x41])])])]);
        const tbs = derSequence(withVersion ? [version, serial, algorithm, issuer] : [serial, algorithm, issuer]);
        return derSequence([tbs]);
    }

    it("extracts the serial and issuer when a version field is present", () => {
        const identity = readCertificateIdentity(fakeCertificate(true));
        expect(readTlv(identity.serialNumberDer).tag).toBe(TAG_INTEGER);
        expect(identity.serialNumberDer.toString("hex")).toBe(derInteger(0x1234).toString("hex"));
        expect(readTlv(identity.issuerDer).tag).toBe(TAG_SEQUENCE);
    });

    it("extracts the serial when the optional version field is absent", () => {
        const identity = readCertificateIdentity(fakeCertificate(false));
        expect(identity.serialNumberDer.toString("hex")).toBe(derInteger(0x1234).toString("hex"));
    });

    it("rejects input that is not a certificate", () => {
        expect(() => readCertificateIdentity(derOid("1.2.3"))).toThrow(/not a DER SEQUENCE/);
        expect(() => readCertificateIdentity(derSequence([derSequence([derOid("1.2.3")])])))
            .toThrow(/serialNumber not found/);
    });

    it("only ever reports OID tags for the algorithm it skips", () => {
        expect(readTlv(derOid("1.2.3")).tag).toBe(TAG_OID);
    });
});
