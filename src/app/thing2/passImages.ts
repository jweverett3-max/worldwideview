import { imageSpecsForLayout, type PassImageSpec, type PassLayout } from "@/lib/wallet/passSpec";

/**
 * Browser-side artwork preparation for a Wallet pass.
 *
 * Apple wants each image at an exact pixel size and only accepts PNG, so the
 * uploaded picture is redrawn onto a canvas once per required size. Doing it
 * here rather than on the server keeps image decoding out of the API and means
 * the preview the user sees is rendered from the very same pixels that get
 * signed.
 */

/** How the picture is cropped into a frame that rarely matches its own shape. */
export interface CropTransform {
    /** 1 = fill the frame exactly; above 1 zooms in. */
    zoom: number;
    /** -1 (hard left) to 1 (hard right); 0 is centred. */
    offsetX: number;
    /** -1 (top) to 1 (bottom); 0 is centred. */
    offsetY: number;
}

export const DEFAULT_CROP: CropTransform = { zoom: 1, offsetX: 0, offsetY: 0 };

/** Decode a picked file into an image element, revoking the URL afterwards. */
export function loadImageFromFile(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(image);
        };
        image.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error("That file could not be read as an image."));
        };
        image.src = objectUrl;
    });
}

/**
 * Draw `image` to fill a `width` x `height` frame, cropping the overflow.
 *
 * Analogy: sliding a photo behind a mat board. The photo keeps its proportions;
 * whatever falls outside the window is simply not shown.
 */
export function renderCrop(
    image: HTMLImageElement,
    width: number,
    height: number,
    transform: CropTransform,
): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot render the pass artwork.");

    const coverScale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const scale = coverScale * Math.max(transform.zoom, 1);
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;

    // How far the image can slide before an edge would show through.
    const slackX = Math.max((drawWidth - width) / 2, 0);
    const slackY = Math.max((drawHeight - height) / 2, 0);

    context.imageSmoothingQuality = "high";
    context.drawImage(
        image,
        (width - drawWidth) / 2 + transform.offsetX * slackX,
        (height - drawHeight) / 2 + transform.offsetY * slackY,
        drawWidth,
        drawHeight,
    );

    return canvas;
}

/** Render every image the layout requires, as `data:image/png;base64,` strings. */
export function renderPassImages(
    image: HTMLImageElement,
    layout: PassLayout,
    transform: CropTransform,
): Record<string, string> {
    const images: Record<string, string> = {};
    for (const spec of imageSpecsForLayout(layout)) {
        // Icons are square regardless of layout, so they use a centred square crop.
        const iconLike = spec.width === spec.height;
        const cropped = renderCrop(
            image,
            spec.width,
            spec.height,
            iconLike ? { ...transform, offsetX: 0 } : transform,
        );
        images[spec.name] = cropped.toDataURL("image/png");
    }
    return images;
}

/** The spec used for the on-screen preview of the photo area. */
export function previewSpec(layout: PassLayout): PassImageSpec {
    return layout === "banner"
        ? { name: "strip@2x.png", width: 750, height: 246 }
        : { name: "thumbnail@2x.png", width: 180, height: 180 };
}

export interface SuggestedTheme {
    backgroundColor: string;
    foregroundColor: string;
    labelColor: string;
}

function toHex(value: number): string {
    return Math.round(Math.min(Math.max(value, 0), 255)).toString(16).padStart(2, "0");
}

/**
 * Derive a readable colour scheme from the picture's average colour, so the
 * pass looks deliberate the moment an image is chosen.
 */
export function suggestTheme(image: HTMLImageElement): SuggestedTheme {
    const canvas = renderCrop(image, 16, 16, DEFAULT_CROP);
    const context = canvas.getContext("2d");
    if (!context) return { backgroundColor: "#1c1c22", foregroundColor: "#ffffff", labelColor: "#b6b6c2" };

    const { data } = context.getImageData(0, 0, 16, 16);
    let red = 0;
    let green = 0;
    let blue = 0;
    const pixels = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
        red += data[i];
        green += data[i + 1];
        blue += data[i + 2];
    }
    red /= pixels;
    green /= pixels;
    blue /= pixels;

    // Deepen the average so pass text always has something dark to sit on.
    const background = `#${toHex(red * 0.45)}${toHex(green * 0.45)}${toHex(blue * 0.45)}`;
    const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) * 0.45;
    const light = luminance < 140;

    return {
        backgroundColor: background,
        foregroundColor: light ? "#ffffff" : "#141418",
        labelColor: light ? "#c9c9d6" : "#3d3d4a",
    };
}
