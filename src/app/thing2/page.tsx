"use client";

import { useEffect, useRef, useState } from "react";

import PassEditor from "./PassEditor";
import PassPreview from "./PassPreview";
import { renderCrop } from "./passImages";
import { usePassDraft } from "./usePassDraft";

import styles from "./thing2.module.css";

/**
 * Thing 2 — turn a picture into a pass you can add to Apple Wallet.
 *
 * The heavy lifting happens in two places: the browser frames the picture into
 * the exact sizes Apple insists on, and the server seals the result with an
 * Apple-issued certificate. That seal is the part nobody can skip — an unsigned
 * pass is simply refused by iOS — so the page checks up front whether this
 * server holds the credentials and says so plainly if it does not.
 */

interface SigningStatus {
    configured: boolean;
    missing: string[];
    signedIn: boolean;
    error?: string;
}

export default function Thing2Page() {
    const draft = usePassDraft();
    const [status, setStatus] = useState<SigningStatus | null>(null);
    const [error, setError] = useState("");
    const formRef = useRef<HTMLFormElement>(null);
    const payloadRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        let cancelled = false;
        fetch("/api/thing2/status")
            .then((response) => response.json() as Promise<SigningStatus>)
            .then((result) => { if (!cancelled) setStatus(result); })
            .catch(() => { if (!cancelled) setStatus({ configured: false, missing: [], signedIn: false }); });
        return () => { cancelled = true; };
    }, []);

    /**
     * Submit a real form rather than fetch: the response must arrive as a
     * top-level navigation for iOS to offer "Add to Apple Wallet".
     */
    function handleAddToWallet() {
        setError("");
        try {
            const payload = JSON.stringify(draft.buildDraft());
            if (payloadRef.current && formRef.current) {
                payloadRef.current.value = payload;
                formRef.current.submit();
            }
        } catch (buildError) {
            setError(buildError instanceof Error ? buildError.message : "Could not build the pass.");
        }
    }

    function handleSavePicture() {
        if (!draft.image) return;
        const spec = draft.state.layout === "banner"
            ? { width: 1125, height: 369 }
            : { width: 270, height: 270 };
        const canvas = renderCrop(draft.image, spec.width, spec.height, draft.crop);
        const link = document.createElement("a");
        link.href = canvas.toDataURL("image/png");
        link.download = "thing2-picture.png";
        link.click();
    }

    const canSign = status === null || (status.configured && status.signedIn);
    const ready = draft.image !== null && draft.state.title.trim().length > 0
        && draft.state.description.trim().length > 0;

    return (
        <main className={styles.page}>
            <header className={styles.pageHeader}>
                <h1 className={styles.pageTitle}>Thing 2</h1>
                <p className={styles.pageSubtitle}>
                    Upload a picture, frame it, and add it to Apple Wallet as a real signed pass.
                </p>
            </header>

            {status && !status.signedIn ? (
                <div className={styles.notice} role="status">
                    <strong>Sign in to build a pass.</strong>
                    <p>
                        Building a pass spends this server&rsquo;s Apple signing certificate, so it
                        is only available to signed-in users.{" "}
                        <a href="/login?callbackUrl=/thing2">Sign in</a> and come back — your
                        design is not saved, so do it before you start.
                    </p>
                </div>
            ) : null}

            {status && !status.configured ? (
                <div className={styles.notice} role="status">
                    <strong>Wallet signing is not set up on this server yet.</strong>
                    <p>
                        Apple only accepts passes sealed with a Pass Type ID certificate from a paid
                        Apple Developer account. Everything else on this page works now; the
                        &ldquo;Add to Apple Wallet&rdquo; button starts working once these environment
                        variables are set:
                    </p>
                    <ul>
                        {(status.missing.length > 0
                            ? status.missing
                            : ["WALLET_PASS_CERTIFICATE", "WALLET_PASS_PRIVATE_KEY", "WALLET_WWDR_CERTIFICATE"]
                        ).map((name) => <li key={name}><code>{name}</code></li>)}
                    </ul>
                    {status.error ? <p className={styles.error}>{status.error}</p> : null}
                    <p className={styles.hint}>
                        Step-by-step setup lives in <code>docs/thing2-apple-wallet.md</code>.
                    </p>
                </div>
            ) : null}

            <div className={styles.layout}>
                <PassEditor draft={draft} />

                <aside className={styles.previewColumn}>
                    <h2 className={styles.sectionTitle}>Preview</h2>
                    <PassPreview
                        backgroundColor={draft.state.backgroundColor}
                        barcodeMessage={draft.state.barcodeMessage}
                        fields={draft.state.fields.filter((field) => field.value.trim().length > 0)}
                        foregroundColor={draft.state.foregroundColor}
                        headline={draft.state.headline}
                        iconUrl={draft.iconUrl}
                        labelColor={draft.state.labelColor}
                        layout={draft.state.layout}
                        photoUrl={draft.photoUrl}
                        title={draft.state.title}
                    />

                    {error ? <p className={styles.error}>{error}</p> : null}

                    <form action="/api/thing2/pkpass" method="post" ref={formRef}>
                        <input name="draft" ref={payloadRef} type="hidden" />
                    </form>

                    <button
                        className={styles.primaryButton}
                        disabled={!ready || !canSign}
                        onClick={handleAddToWallet}
                        type="button"
                    >
                        Add to Apple Wallet
                    </button>
                    <button
                        className={styles.secondaryButton}
                        disabled={!draft.image}
                        onClick={handleSavePicture}
                        type="button"
                    >
                        Save the framed picture
                    </button>
                    <p className={styles.hint}>
                        Open this page on your iPhone to add the pass straight to Wallet. On a
                        computer the pass downloads as a <code>.pkpass</code> file you can AirDrop
                        or email to yourself.
                    </p>
                </aside>
            </div>
        </main>
    );
}
