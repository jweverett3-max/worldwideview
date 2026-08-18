import { z } from "zod";

/**
 * The shape of a pass the user is designing, plus the exact image sizes Apple
 * Wallet expects. Shared by the browser (which renders the images) and the API
 * route (which validates and signs them).
 */

/** How the uploaded picture is placed on the pass. */
export type PassLayout = "banner" | "square";

export interface PassImageSpec {
    /** Filename inside the `.pkpass` bundle. */
    name: string;
    width: number;
    height: number;
}

/** Required on every pass, at all three screen densities. */
export const ICON_SPECS: readonly PassImageSpec[] = [
    { name: "icon.png", width: 29, height: 29 },
    { name: "icon@2x.png", width: 58, height: 58 },
    { name: "icon@3x.png", width: 87, height: 87 },
];

/** Wide photo across the top of a store card. */
export const STRIP_SPECS: readonly PassImageSpec[] = [
    { name: "strip.png", width: 375, height: 123 },
    { name: "strip@2x.png", width: 750, height: 246 },
    { name: "strip@3x.png", width: 1125, height: 369 },
];

/** Square photo on the right of a generic pass. */
export const THUMBNAIL_SPECS: readonly PassImageSpec[] = [
    { name: "thumbnail.png", width: 90, height: 90 },
    { name: "thumbnail@2x.png", width: 180, height: 180 },
    { name: "thumbnail@3x.png", width: 270, height: 270 },
];

/** Every image a pass of the given layout must contain. */
export function imageSpecsForLayout(layout: PassLayout): PassImageSpec[] {
    const photoSpecs = layout === "banner" ? STRIP_SPECS : THUMBNAIL_SPECS;
    return [...ICON_SPECS, ...photoSpecs];
}

/** Largest single image we accept, generously above a 1125x369 PNG. */
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Expected a #rrggbb colour");

const passFieldSchema = z.object({
    label: z.string().trim().max(40),
    value: z.string().trim().min(1).max(120),
});

export const passDraftSchema = z.object({
    layout: z.enum(["banner", "square"]),
    /** Shown in the pass header, next to the icon. */
    title: z.string().trim().min(1).max(40),
    /** Required by Apple; read aloud by VoiceOver. */
    description: z.string().trim().min(1).max(120),
    /** Optional large text. On a banner pass it overlays the photo. */
    headline: z.string().trim().max(40).optional(),
    fields: z.array(passFieldSchema).max(4),
    backNote: z.string().trim().max(500).optional(),
    /** Encoded into a QR code on the pass when present. */
    barcodeMessage: z.string().trim().max(300).optional(),
    backgroundColor: hexColor,
    foregroundColor: hexColor,
    labelColor: hexColor,
    /** Image spec name to base64-encoded PNG. */
    images: z.record(z.string(), z.string()),
});

export type PassDraft = z.infer<typeof passDraftSchema>;
export type PassField = z.infer<typeof passFieldSchema>;

/** Apple writes colours as `rgb(r, g, b)` rather than hex. */
export function hexToRgbString(hex: string): string {
    const r = Number.parseInt(hex.slice(1, 3), 16);
    const g = Number.parseInt(hex.slice(3, 5), 16);
    const b = Number.parseInt(hex.slice(5, 7), 16);
    return `rgb(${r}, ${g}, ${b})`;
}
