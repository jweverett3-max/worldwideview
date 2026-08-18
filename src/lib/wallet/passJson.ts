import { hexToRgbString, type PassDraft, type PassField } from "./passSpec";

/**
 * Turns a user's draft into the `pass.json` document at the heart of a
 * `.pkpass` bundle.
 *
 * Analogy: `pass.json` is the printed side of a loyalty card — the words,
 * colours, and which slots the words sit in. The images are the artwork glued
 * on top, and the signature is the hologram proving it is not a photocopy.
 */

export interface PassIdentity {
    /** e.g. `pass.com.example.thing2`, from the Apple Developer portal. */
    passTypeIdentifier: string;
    /** The 10-character Apple Developer Team ID. */
    teamIdentifier: string;
    /** Displayed by iOS when asking the user to add the pass. */
    organizationName: string;
}

interface PassJsonField {
    key: string;
    label?: string;
    value: string;
}

type PassStyleKey = "storeCard" | "generic";

interface PassStyleContent {
    primaryFields: PassJsonField[];
    secondaryFields: PassJsonField[];
    auxiliaryFields: PassJsonField[];
    backFields: PassJsonField[];
}

export interface PassJson {
    formatVersion: 1;
    passTypeIdentifier: string;
    teamIdentifier: string;
    organizationName: string;
    serialNumber: string;
    description: string;
    logoText?: string;
    foregroundColor: string;
    backgroundColor: string;
    labelColor: string;
    barcodes?: Array<{ format: string; message: string; messageEncoding: string }>;
    storeCard?: PassStyleContent;
    generic?: PassStyleContent;
}

function toJsonFields(fields: PassField[], keyPrefix: string): PassJsonField[] {
    return fields.map((field, index) => ({
        key: `${keyPrefix}${index + 1}`,
        ...(field.label ? { label: field.label } : {}),
        value: field.value,
    }));
}

function buildStyleContent(draft: PassDraft): PassStyleContent {
    const primaryFields: PassJsonField[] = draft.headline
        ? [{ key: "headline", value: draft.headline }]
        : [];

    // Wallet gives secondary fields the most room, so fill those first.
    const secondary = draft.fields.slice(0, 2);
    const auxiliary = draft.fields.slice(2);

    const backFields: PassJsonField[] = draft.backNote
        ? [{ key: "note", label: "Note", value: draft.backNote }]
        : [];

    return {
        primaryFields,
        secondaryFields: toJsonFields(secondary, "secondary"),
        auxiliaryFields: toJsonFields(auxiliary, "auxiliary"),
        backFields,
    };
}

/**
 * Build the `pass.json` document.
 *
 * @param draft        The user's design.
 * @param identity     Values tied to the Apple Developer account signing it.
 * @param serialNumber Unique per pass; iOS uses it to replace rather than duplicate.
 */
export function buildPassJson(
    draft: PassDraft,
    identity: PassIdentity,
    serialNumber: string,
): PassJson {
    const styleKey: PassStyleKey = draft.layout === "banner" ? "storeCard" : "generic";

    return {
        formatVersion: 1,
        passTypeIdentifier: identity.passTypeIdentifier,
        teamIdentifier: identity.teamIdentifier,
        organizationName: identity.organizationName,
        serialNumber,
        description: draft.description,
        ...(draft.title ? { logoText: draft.title } : {}),
        foregroundColor: hexToRgbString(draft.foregroundColor),
        backgroundColor: hexToRgbString(draft.backgroundColor),
        labelColor: hexToRgbString(draft.labelColor),
        ...(draft.barcodeMessage
            ? {
                barcodes: [{
                    format: "PKBarcodeFormatQR",
                    message: draft.barcodeMessage,
                    messageEncoding: "iso-8859-1",
                }],
            }
            : {}),
        [styleKey]: buildStyleContent(draft),
    };
}
