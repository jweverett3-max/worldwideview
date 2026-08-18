// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildPassJson, type PassIdentity } from "./passJson";
import type { PassDraft } from "./passSpec";

const IDENTITY: PassIdentity = {
    passTypeIdentifier: "pass.app.worldwideview.thing2",
    teamIdentifier: "ABCDE12345",
    organizationName: "WorldWideView",
};

function draft(overrides: Partial<PassDraft> = {}): PassDraft {
    return {
        layout: "banner",
        title: "Holiday",
        description: "A picture in my wallet",
        fields: [{ label: "Where", value: "Lisbon" }],
        backgroundColor: "#102030",
        foregroundColor: "#ffffff",
        labelColor: "#aabbcc",
        images: {},
        ...overrides,
    };
}

describe("buildPassJson", () => {
    it("emits the top-level keys Apple requires", () => {
        const pass = buildPassJson(draft(), IDENTITY, "serial-1");
        expect(pass.formatVersion).toBe(1);
        expect(pass.passTypeIdentifier).toBe(IDENTITY.passTypeIdentifier);
        expect(pass.teamIdentifier).toBe(IDENTITY.teamIdentifier);
        expect(pass.organizationName).toBe(IDENTITY.organizationName);
        expect(pass.serialNumber).toBe("serial-1");
        expect(pass.description).toBe("A picture in my wallet");
    });

    it("converts hex colours to the rgb() form Apple expects", () => {
        const pass = buildPassJson(draft(), IDENTITY, "s");
        expect(pass.backgroundColor).toBe("rgb(16, 32, 48)");
        expect(pass.foregroundColor).toBe("rgb(255, 255, 255)");
        expect(pass.labelColor).toBe("rgb(170, 187, 204)");
    });

    it("uses storeCard for a banner layout and generic for a square one", () => {
        expect(buildPassJson(draft({ layout: "banner" }), IDENTITY, "s").storeCard).toBeDefined();
        expect(buildPassJson(draft({ layout: "banner" }), IDENTITY, "s").generic).toBeUndefined();
        expect(buildPassJson(draft({ layout: "square" }), IDENTITY, "s").generic).toBeDefined();
        expect(buildPassJson(draft({ layout: "square" }), IDENTITY, "s").storeCard).toBeUndefined();
    });

    it("puts the first two detail rows in secondary fields and the rest in auxiliary", () => {
        const fields = [
            { label: "A", value: "1" },
            { label: "B", value: "2" },
            { label: "C", value: "3" },
        ];
        const content = buildPassJson(draft({ fields }), IDENTITY, "s").storeCard;
        expect(content?.secondaryFields.map((f) => f.value)).toEqual(["1", "2"]);
        expect(content?.auxiliaryFields.map((f) => f.value)).toEqual(["3"]);
        expect(content?.secondaryFields.map((f) => f.key)).toEqual(["secondary1", "secondary2"]);
    });

    it("omits the label key entirely when a row has no label", () => {
        const content = buildPassJson(draft({ fields: [{ label: "", value: "1" }] }), IDENTITY, "s").storeCard;
        expect(content?.secondaryFields[0]).not.toHaveProperty("label");
    });

    it("adds a headline as the primary field only when one is given", () => {
        expect(buildPassJson(draft(), IDENTITY, "s").storeCard?.primaryFields).toEqual([]);
        expect(buildPassJson(draft({ headline: "Day one" }), IDENTITY, "s").storeCard?.primaryFields)
            .toEqual([{ key: "headline", value: "Day one" }]);
    });

    it("adds a QR barcode only when a message is given", () => {
        expect(buildPassJson(draft(), IDENTITY, "s").barcodes).toBeUndefined();
        expect(buildPassJson(draft({ barcodeMessage: "hello" }), IDENTITY, "s").barcodes)
            .toEqual([{ format: "PKBarcodeFormatQR", message: "hello", messageEncoding: "iso-8859-1" }]);
    });

    it("puts a back note on the reverse of the pass", () => {
        const content = buildPassJson(draft({ backNote: "Taken in 2019" }), IDENTITY, "s").storeCard;
        expect(content?.backFields).toEqual([{ key: "note", label: "Note", value: "Taken in 2019" }]);
    });
});
