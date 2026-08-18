"use client";

import type { ChangeEvent } from "react";

import type { usePassDraft } from "./usePassDraft";

import styles from "./thing2.module.css";

/** The editing surface: pick a picture, frame it, then label it. */
export default function PassEditor({ draft }: { draft: ReturnType<typeof usePassDraft> }) {
    const { state, update, setField, addField, removeField, crop, setCrop } = draft;

    function onFileChange(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        if (file) void draft.selectFile(file);
    }

    return (
        <div className={styles.editor}>
            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>1 · Your picture</h2>
                <label className={styles.dropzone} htmlFor="thing2-file">
                    <input
                        accept="image/*"
                        className={styles.fileInput}
                        id="thing2-file"
                        onChange={onFileChange}
                        type="file"
                    />
                    <span className={styles.dropzoneText}>
                        {draft.image ? "Choose a different picture" : "Choose a picture"}
                    </span>
                    <span className={styles.hint}>PNG, JPEG, HEIC, WebP — never leaves your device unsigned</span>
                </label>
                {draft.imageError ? <p className={styles.error}>{draft.imageError}</p> : null}

                <fieldset className={styles.choiceGroup}>
                    <legend className={styles.label}>Shape</legend>
                    {(["banner", "square"] as const).map((layout) => (
                        <label className={styles.choice} key={layout}>
                            <input
                                checked={state.layout === layout}
                                name="layout"
                                onChange={() => update("layout", layout)}
                                type="radio"
                                value={layout}
                            />
                            {layout === "banner" ? "Wide banner" : "Square thumbnail"}
                        </label>
                    ))}
                </fieldset>

                {draft.image ? (
                    <div className={styles.sliders}>
                        <label className={styles.slider}>
                            <span className={styles.label}>Zoom</span>
                            <input
                                max="3" min="1" step="0.01" type="range"
                                onChange={(e) => setCrop({ ...crop, zoom: Number(e.target.value) })}
                                value={crop.zoom}
                            />
                        </label>
                        <label className={styles.slider}>
                            <span className={styles.label}>Move across</span>
                            <input
                                max="1" min="-1" step="0.01" type="range"
                                onChange={(e) => setCrop({ ...crop, offsetX: Number(e.target.value) })}
                                value={crop.offsetX}
                            />
                        </label>
                        <label className={styles.slider}>
                            <span className={styles.label}>Move up / down</span>
                            <input
                                max="1" min="-1" step="0.01" type="range"
                                onChange={(e) => setCrop({ ...crop, offsetY: Number(e.target.value) })}
                                value={crop.offsetY}
                            />
                        </label>
                    </div>
                ) : null}
            </section>

            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>2 · Words</h2>
                <label className={styles.field}>
                    <span className={styles.label}>Title</span>
                    <input
                        maxLength={40}
                        onChange={(e) => update("title", e.target.value)}
                        type="text"
                        value={state.title}
                    />
                </label>
                <label className={styles.field}>
                    <span className={styles.label}>Headline <em>optional</em></span>
                    <input
                        maxLength={40}
                        onChange={(e) => update("headline", e.target.value)}
                        placeholder="Large text over the picture"
                        type="text"
                        value={state.headline}
                    />
                </label>
                <label className={styles.field}>
                    <span className={styles.label}>Description</span>
                    <input
                        maxLength={120}
                        onChange={(e) => update("description", e.target.value)}
                        type="text"
                        value={state.description}
                    />
                    <span className={styles.hint}>Required by Apple; VoiceOver reads it aloud.</span>
                </label>

                <div className={styles.field}>
                    <span className={styles.label}>Detail rows</span>
                    {state.fields.map((field, index) => (
                        <div className={styles.fieldRow} key={index}>
                            <input
                                maxLength={40}
                                onChange={(e) => setField(index, { ...field, label: e.target.value })}
                                placeholder="Label"
                                type="text"
                                value={field.label}
                            />
                            <input
                                maxLength={120}
                                onChange={(e) => setField(index, { ...field, value: e.target.value })}
                                placeholder="Value"
                                type="text"
                                value={field.value}
                            />
                            <button
                                aria-label={`Remove detail row ${index + 1}`}
                                className={styles.rowButton}
                                onClick={() => removeField(index)}
                                type="button"
                            >
                                ×
                            </button>
                        </div>
                    ))}
                    {state.fields.length < 4 ? (
                        <button className={styles.secondaryButton} onClick={addField} type="button">
                            Add a row
                        </button>
                    ) : null}
                </div>

                <label className={styles.field}>
                    <span className={styles.label}>Note on the back <em>optional</em></span>
                    <textarea
                        maxLength={500}
                        onChange={(e) => update("backNote", e.target.value)}
                        rows={3}
                        value={state.backNote}
                    />
                </label>
                <label className={styles.field}>
                    <span className={styles.label}>QR code contents <em>optional</em></span>
                    <input
                        maxLength={300}
                        onChange={(e) => update("barcodeMessage", e.target.value)}
                        placeholder="A link, a name, anything"
                        type="text"
                        value={state.barcodeMessage}
                    />
                </label>
            </section>

            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>3 · Colours</h2>
                <div className={styles.colourRow}>
                    {([
                        ["backgroundColor", "Background"],
                        ["foregroundColor", "Text"],
                        ["labelColor", "Labels"],
                    ] as const).map(([key, label]) => (
                        <label className={styles.colour} key={key}>
                            <span className={styles.label}>{label}</span>
                            <input
                                onChange={(e) => update(key, e.target.value)}
                                type="color"
                                value={state[key]}
                            />
                        </label>
                    ))}
                </div>
                <p className={styles.hint}>Picked from your photo automatically — change them if you like.</p>
            </section>
        </div>
    );
}
