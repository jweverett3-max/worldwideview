import { NextResponse } from "next/server";

import { isAuthEnabled } from "@/core/edition";
import { auth } from "@/lib/auth";
import { getSignerConfig } from "@/lib/wallet/signerConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reports whether the Thing 2 page can actually produce a pass: are the Apple
 * signing credentials present, and is the caller allowed to use them. Answering
 * up front lets the page explain what is missing before the user designs a pass
 * rather than after. Only variable *names* are returned — never their values.
 */
export async function GET() {
    const signedIn = isAuthEnabled ? Boolean((await auth())?.user) : true;

    try {
        const result = getSignerConfig();
        return NextResponse.json({
            configured: result.configured,
            missing: result.configured ? [] : result.missing,
            signedIn,
        });
    } catch (error) {
        return NextResponse.json({
            configured: false,
            missing: [],
            signedIn,
            error: error instanceof Error ? error.message : "Signing credentials are invalid",
        });
    }
}
