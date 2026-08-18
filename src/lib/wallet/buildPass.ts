import { createHash } from "node:crypto";

import { decodePngExactly } from "./png";
import { buildPassJson, type PassIdentity } from "./passJson";
import { imageSpecsForLayout, MAX_IMAGE_BYTES, type PassDraft } from "./passSpec";
import { signDetached, type SignerMaterial } from "./pkcs7";
import { createZip, type ZipEntry } from "./zip";

/**
 * Assembles a signed `.pkpass` bundle.
 *
 * The bundle is a ZIP holding four kinds of member: `pass.json` (the content),
 * the PNG artwork, `manifest.json` (a SHA-1 of every other file), and
 * `signature` (a detached signature over the manifest). Change any byte of any
 * file and the manifest no longer matches; change the manifest and the
 * signature no longer matches.
 */

export interface BuildPassInput {
    draft: PassDraft;
    identity: PassIdentity;
    material: SignerMaterial;
    /** Unique per pass — iOS replaces a pass that arrives with a known serial. */
    serialNumber: string;
    /** Timestamp for the signature and the ZIP member dates. */
    now: Date;
}

function sha1Hex(data: Buffer): string {
    return createHash("sha1").update(data).digest("hex");
}

/** Decode and validate every image the layout requires. */
function collectImageEntries(draft: PassDraft): ZipEntry[] {
    return imageSpecsForLayout(draft.layout).map((spec) => {
        const encoded = draft.images[spec.name];
        if (typeof encoded !== "string" || encoded.length === 0) {
            throw new Error(`Missing pass image: ${spec.name}`);
        }
        return {
            name: spec.name,
            data: decodePngExactly(
                encoded,
                { width: spec.width, height: spec.height },
                MAX_IMAGE_BYTES,
                spec.name,
            ),
        };
    });
}

/**
 * Build the complete, signed `.pkpass` archive.
 *
 * @throws If an image is missing, malformed, or the wrong size.
 */
export function buildPkpass(input: BuildPassInput): Buffer {
    const passJson = buildPassJson(input.draft, input.identity, input.serialNumber);
    const passJsonEntry: ZipEntry = {
        name: "pass.json",
        // Two spaces keeps the file readable if anyone unzips it to debug.
        data: Buffer.from(JSON.stringify(passJson, null, 2), "utf8"),
    };

    const contentEntries: ZipEntry[] = [passJsonEntry, ...collectImageEntries(input.draft)];

    const manifest: Record<string, string> = {};
    for (const entry of contentEntries) {
        manifest[entry.name] = sha1Hex(entry.data);
    }
    const manifestEntry: ZipEntry = {
        name: "manifest.json",
        data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8"),
    };

    const signatureEntry: ZipEntry = {
        name: "signature",
        data: signDetached(manifestEntry.data, input.material, input.now),
    };

    return createZip([...contentEntries, manifestEntry, signatureEntry], input.now);
}
