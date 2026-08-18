import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { isAuthEnabled } from "@/core/edition";
import { auth } from "@/lib/auth";
import { getClientIp } from "@/lib/rateLimit";
import { pkpassLimiter } from "@/lib/rateLimiters";
import { buildPkpass } from "@/lib/wallet/buildPass";
import { passDraftSchema } from "@/lib/wallet/passSpec";
import { getSignerConfig } from "@/lib/wallet/signerConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Three PNG densities of artwork, base64-encoded, plus text. 8 MB is ample. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

/**
 * The page submits a real HTML form so that the response is a top-level
 * navigation — that is what lets iOS Safari hand the pass to Wallet instead of
 * filing it away as a download. Form posts arrive URL-encoded, so unwrap the
 * `draft` field; direct JSON posts are passed through untouched.
 */
function extractDraftJson(body: string, contentType: string | null): string {
    if (!contentType?.includes("application/x-www-form-urlencoded")) return body;

    const draft = new URLSearchParams(body).get("draft");
    if (draft === null) throw new Error("Form post is missing the draft field");
    return draft;
}

function safeFilename(title: string): string {
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return `${slug || "pass"}.pkpass`;
}

/**
 * Builds and signs a `.pkpass` from a pass draft.
 *
 * Responds with the raw bundle so that opening the URL on an iPhone hands the
 * file straight to Wallet — that handoff is driven entirely by the
 * `application/vnd.apple.pkpass` content type.
 */
export async function POST(request: Request) {
    const rateLimited = pkpassLimiter.check(getClientIp(request));
    if (rateLimited) return rateLimited;

    // Signing spends the deployment's Apple Pass Type ID certificate, so the
    // endpoint is gated exactly like the app's other credential-bearing routes.
    if (isAuthEnabled && !(await auth())?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_BODY_BYTES) {
        return NextResponse.json({ error: "Pass payload is too large" }, { status: 413 });
    }

    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) {
        return NextResponse.json({ error: "Pass payload is too large" }, { status: 413 });
    }

    let parsedBody: unknown;
    try {
        parsedBody = JSON.parse(extractDraftJson(body, request.headers.get("content-type")));
    } catch {
        return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
    }

    const draft = passDraftSchema.safeParse(parsedBody);
    if (!draft.success) {
        return NextResponse.json(
            { error: "Invalid pass", issues: draft.error.issues.map((issue) => issue.message) },
            { status: 400 },
        );
    }

    let signer;
    try {
        signer = getSignerConfig();
    } catch (error) {
        console.error("[Thing2] Signing credentials could not be loaded:", error);
        return NextResponse.json(
            { error: "Apple Wallet signing credentials are configured but unreadable." },
            { status: 500 },
        );
    }

    if (!signer.configured) {
        return NextResponse.json(
            {
                error: "Apple Wallet signing is not configured on this server.",
                missing: signer.missing,
            },
            { status: 501 },
        );
    }

    try {
        const pkpass = buildPkpass({
            draft: draft.data,
            identity: signer.config.identity,
            material: signer.config.material,
            serialNumber: randomUUID(),
            now: new Date(),
        });

        return new NextResponse(new Uint8Array(pkpass), {
            headers: {
                "Content-Type": "application/vnd.apple.pkpass",
                // `inline` matters: with `attachment`, iOS files the pass away
                // in Files instead of offering to add it to Wallet.
                "Content-Disposition": `inline; filename="${safeFilename(draft.data.title)}"`,
                "Content-Length": String(pkpass.length),
                "Cache-Control": "no-store",
            },
        });
    } catch (error) {
        // Image validation failures are the user's to fix, so surface the reason.
        const message = error instanceof Error ? error.message : "Could not build the pass";
        console.error("[Thing2] Pass build failed:", error);
        return NextResponse.json({ error: message }, { status: 422 });
    }
}
