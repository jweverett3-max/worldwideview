"use client";

/* eslint-disable @next/next/no-img-element -- the sources are canvas data URLs,
   which next/image cannot optimise and would only add a round trip to. */
import type { PassField, PassLayout } from "@/lib/wallet/passSpec";

import styles from "./thing2.module.css";

/**
 * An approximation of how iOS will draw the pass. It is a preview, not a
 * simulator — Wallet applies its own gloss, rounding, and font metrics — but it
 * gets the layout, colours, and crop right, which is what the user is deciding.
 */

export interface PassPreviewProps {
    layout: PassLayout;
    title: string;
    headline: string;
    fields: PassField[];
    backgroundColor: string;
    foregroundColor: string;
    labelColor: string;
    barcodeMessage: string;
    /** Data URL of the cropped photo, or null before one is chosen. */
    photoUrl: string | null;
    /** Data URL of the square icon, shown in the pass header. */
    iconUrl: string | null;
}

function FieldRow({ fields, labelColor, foregroundColor }: {
    fields: PassField[];
    labelColor: string;
    foregroundColor: string;
}) {
    if (fields.length === 0) return null;

    return (
        <div className={styles.previewFieldRow}>
            {fields.map((field, index) => (
                <div className={styles.previewField} key={`${field.label}-${index}`}>
                    {field.label ? (
                        <span className={styles.previewFieldLabel} style={{ color: labelColor }}>
                            {field.label.toUpperCase()}
                        </span>
                    ) : null}
                    <span className={styles.previewFieldValue} style={{ color: foregroundColor }}>
                        {field.value}
                    </span>
                </div>
            ))}
        </div>
    );
}

export default function PassPreview(props: PassPreviewProps) {
    const {
        layout, title, headline, fields, backgroundColor, foregroundColor,
        labelColor, barcodeMessage, photoUrl, iconUrl,
    } = props;

    const isBanner = layout === "banner";

    return (
        <div className={styles.previewCard} style={{ background: backgroundColor }}>
            <header className={styles.previewHeader}>
                <span className={styles.previewIcon} aria-hidden="true">
                    {iconUrl ? <img alt="" src={iconUrl} /> : null}
                </span>
                <span className={styles.previewLogoText} style={{ color: foregroundColor }}>
                    {title || "Untitled pass"}
                </span>
            </header>

            {isBanner ? (
                <div className={styles.previewStrip}>
                    {photoUrl ? <img alt="" src={photoUrl} /> : <span className={styles.previewEmpty}>Your picture</span>}
                    {headline ? (
                        <span className={styles.previewStripHeadline}>{headline}</span>
                    ) : null}
                </div>
            ) : (
                <div className={styles.previewGenericBody}>
                    <div className={styles.previewGenericText}>
                        <span className={styles.previewFieldValue} style={{ color: foregroundColor, fontSize: "1.35rem" }}>
                            {headline}
                        </span>
                    </div>
                    <span className={styles.previewThumbnail}>
                        {photoUrl ? <img alt="" src={photoUrl} /> : <span className={styles.previewEmpty}>Picture</span>}
                    </span>
                </div>
            )}

            <div className={styles.previewBody}>
                <FieldRow
                    fields={fields.slice(0, 2)}
                    labelColor={labelColor}
                    foregroundColor={foregroundColor}
                />
                <FieldRow
                    fields={fields.slice(2)}
                    labelColor={labelColor}
                    foregroundColor={foregroundColor}
                />
            </div>

            {barcodeMessage ? (
                <div className={styles.previewBarcode}>
                    <span className={styles.previewBarcodeGrid} aria-hidden="true" />
                    <span className={styles.previewBarcodeCaption}>{barcodeMessage}</span>
                </div>
            ) : null}
        </div>
    );
}
