"use client";

import { useCallback, useMemo, useState } from "react";

import type { PassDraft, PassField, PassLayout } from "@/lib/wallet/passSpec";

import {
    DEFAULT_CROP,
    loadImageFromFile,
    previewSpec,
    renderCrop,
    renderPassImages,
    suggestTheme,
    type CropTransform,
} from "./passImages";

/**
 * Holds everything the user is editing plus the picture they uploaded.
 *
 * The full-size artwork is deliberately *not* re-rendered while the crop
 * sliders move — only the small preview is. The expensive set of exact-size
 * PNGs is produced once, at the moment the pass is actually built.
 */

export interface PassDraftState {
    layout: PassLayout;
    title: string;
    description: string;
    headline: string;
    fields: PassField[];
    backNote: string;
    barcodeMessage: string;
    backgroundColor: string;
    foregroundColor: string;
    labelColor: string;
}

const INITIAL_STATE: PassDraftState = {
    layout: "banner",
    title: "My Pass",
    description: "A picture I put in my Apple Wallet",
    headline: "",
    fields: [{ label: "", value: "" }],
    backNote: "",
    barcodeMessage: "",
    backgroundColor: "#1c1c22",
    foregroundColor: "#ffffff",
    labelColor: "#b6b6c2",
};

export function usePassDraft() {
    const [state, setState] = useState<PassDraftState>(INITIAL_STATE);
    const [image, setImage] = useState<HTMLImageElement | null>(null);
    const [crop, setCrop] = useState<CropTransform>(DEFAULT_CROP);
    const [imageError, setImageError] = useState<string>("");

    const update = useCallback(<K extends keyof PassDraftState>(key: K, value: PassDraftState[K]) => {
        setState((previous) => ({ ...previous, [key]: value }));
    }, []);

    const setField = useCallback((index: number, field: PassField) => {
        setState((previous) => ({
            ...previous,
            fields: previous.fields.map((existing, i) => (i === index ? field : existing)),
        }));
    }, []);

    const addField = useCallback(() => {
        setState((previous) => (previous.fields.length >= 4
            ? previous
            : { ...previous, fields: [...previous.fields, { label: "", value: "" }] }));
    }, []);

    const removeField = useCallback((index: number) => {
        setState((previous) => ({
            ...previous,
            fields: previous.fields.filter((_, i) => i !== index),
        }));
    }, []);

    /** Load a picked file and adopt a colour scheme drawn from it. */
    const selectFile = useCallback(async (file: File) => {
        setImageError("");
        try {
            const loaded = await loadImageFromFile(file);
            setImage(loaded);
            setCrop(DEFAULT_CROP);
            setState((previous) => ({ ...previous, ...suggestTheme(loaded) }));
        } catch (error) {
            setImageError(error instanceof Error ? error.message : "That picture could not be loaded.");
        }
    }, []);

    // Cheap, preview-sized renders that follow the crop sliders in real time.
    const photoUrl = useMemo(() => {
        if (!image) return null;
        const spec = previewSpec(state.layout);
        return renderCrop(image, spec.width, spec.height, crop).toDataURL("image/png");
    }, [image, state.layout, crop]);

    const iconUrl = useMemo(() => {
        if (!image) return null;
        return renderCrop(image, 58, 58, { ...crop, offsetX: 0 }).toDataURL("image/png");
    }, [image, crop]);

    /** Produce the exact-size artwork and the payload the API expects. */
    const buildDraft = useCallback((): PassDraft => {
        if (!image) throw new Error("Choose a picture first.");

        const trimmedFields = state.fields
            .map((field) => ({ label: field.label.trim(), value: field.value.trim() }))
            .filter((field) => field.value.length > 0);

        return {
            layout: state.layout,
            title: state.title.trim(),
            description: state.description.trim(),
            ...(state.headline.trim() ? { headline: state.headline.trim() } : {}),
            fields: trimmedFields,
            ...(state.backNote.trim() ? { backNote: state.backNote.trim() } : {}),
            ...(state.barcodeMessage.trim() ? { barcodeMessage: state.barcodeMessage.trim() } : {}),
            backgroundColor: state.backgroundColor,
            foregroundColor: state.foregroundColor,
            labelColor: state.labelColor,
            images: renderPassImages(image, state.layout, crop),
        };
    }, [image, state, crop]);

    return {
        state,
        update,
        setField,
        addField,
        removeField,
        image,
        imageError,
        selectFile,
        crop,
        setCrop,
        photoUrl,
        iconUrl,
        buildDraft,
    };
}
