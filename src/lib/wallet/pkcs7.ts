import { createHash, createPublicKey, sign as cryptoSign, type KeyObject } from "node:crypto";

import {
    contextTag,
    derAlgorithmIdentifier,
    derEncode,
    derInteger,
    derOctetString,
    derOid,
    derSequence,
    derSet,
    derUtcTime,
    readCertificateIdentity,
    TAG_SET,
} from "./der";

/**
 * Builds the detached PKCS#7 / CMS signature that Apple Wallet requires in a
 * `.pkpass` bundle (the `signature` file).
 *
 * Analogy: it is a wax seal. The seal is not the letter — it sits beside it
 * ("detached"), and it proves two things at once: that the letter has not been
 * altered, and that the signet ring pressing it belonged to us.
 */

const OID_SIGNED_DATA = "1.2.840.113549.1.7.2";
const OID_DATA = "1.2.840.113549.1.7.1";
const OID_SHA256 = "2.16.840.1.101.3.4.2.1";
const OID_RSA_ENCRYPTION = "1.2.840.113549.1.1.1";
const OID_ATTR_CONTENT_TYPE = "1.2.840.113549.1.9.3";
const OID_ATTR_MESSAGE_DIGEST = "1.2.840.113549.1.9.4";
const OID_ATTR_SIGNING_TIME = "1.2.840.113549.1.9.5";

export interface SignerMaterial {
    /** DER bytes of the Apple Pass Type ID certificate that signs the pass. */
    signerCertificateDer: Buffer;
    /** DER bytes of the Apple WWDR intermediate certificate. */
    intermediateCertificateDer: Buffer;
    /** The private key matching the Pass Type ID certificate. */
    privateKey: KeyObject;
}

/**
 * RFC 5754 says SHA-2 digest algorithm identifiers are generated with the
 * parameters field absent, so this one is a bare SEQUENCE around the OID.
 */
function digestAlgorithmIdentifier(): Buffer {
    return derSequence([derOid(OID_SHA256)]);
}

function attribute(oid: string, values: Buffer[]): Buffer {
    return derSequence([derOid(oid), derSet(values)]);
}

/**
 * Assemble the signed attributes. The signature covers these bytes rather than
 * the content itself, which is what lets the content stay detached.
 */
function buildSignedAttributes(contentDigest: Buffer, signedAt: Date): Buffer[] {
    return [
        attribute(OID_ATTR_CONTENT_TYPE, [derOid(OID_DATA)]),
        attribute(OID_ATTR_SIGNING_TIME, [derUtcTime(signedAt)]),
        attribute(OID_ATTR_MESSAGE_DIGEST, [derOctetString(contentDigest)]),
    ];
}

function assertRsaKey(privateKey: KeyObject): void {
    const type = createPublicKey(privateKey).asymmetricKeyType;
    if (type !== "rsa" && type !== "rsa-pss") {
        throw new Error(
            `Apple Wallet pass signing requires an RSA key, but the configured key is "${type ?? "unknown"}".`,
        );
    }
}

/**
 * Produce a detached CMS SignedData structure over `content`.
 *
 * @param content  The bytes being signed — for a pass, `manifest.json`.
 * @param material The certificate chain and private key to sign with.
 * @param signedAt Timestamp recorded in the signing-time attribute.
 * @returns DER bytes to store as the pass's `signature` file.
 */
export function signDetached(content: Buffer, material: SignerMaterial, signedAt: Date): Buffer {
    assertRsaKey(material.privateKey);

    const contentDigest = createHash("sha256").update(content).digest();
    const signedAttributes = buildSignedAttributes(contentDigest, signedAt);

    // The signature is computed over an explicit SET OF, while the structure
    // carries the same members under an implicit [0]. Same bytes, different tag.
    const sortedAttributes = [...signedAttributes].sort(Buffer.compare);
    const attributesContent = Buffer.concat(sortedAttributes);
    const attributesToSign = derEncode(TAG_SET, attributesContent);
    const attributesInStructure = derEncode(contextTag(0), attributesContent);

    const signature = cryptoSign("sha256", attributesToSign, material.privateKey);

    const { issuerDer, serialNumberDer } = readCertificateIdentity(material.signerCertificateDer);

    const signerInfo = derSequence([
        derInteger(1),
        derSequence([issuerDer, serialNumberDer]),
        digestAlgorithmIdentifier(),
        attributesInStructure,
        derAlgorithmIdentifier(OID_RSA_ENCRYPTION),
        derOctetString(signature),
    ]);

    const certificates = derEncode(
        contextTag(0),
        Buffer.concat([material.signerCertificateDer, material.intermediateCertificateDer]),
    );

    const signedData = derSequence([
        derInteger(1),
        derSet([digestAlgorithmIdentifier()]),
        // Detached: the encapsulated content info names a type but carries no content.
        derSequence([derOid(OID_DATA)]),
        certificates,
        derSet([signerInfo]),
    ]);

    return derSequence([derOid(OID_SIGNED_DATA), derEncode(contextTag(0), signedData)]);
}
