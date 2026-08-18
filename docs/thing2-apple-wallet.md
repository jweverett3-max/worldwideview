# Thing 2 — picture → Apple Wallet pass

Thing 2 lives at `/thing2`. You upload a picture, frame it, add a few words, and
download it as a real `.pkpass` file that iOS will add to Apple Wallet.

## How a Wallet pass actually works

A `.pkpass` file is a ZIP archive containing four kinds of thing:

| Member | What it is |
|---|---|
| `pass.json` | The words, colours, and which slots the words sit in |
| `icon*.png`, `strip*.png` / `thumbnail*.png` | The artwork, at exact pixel sizes |
| `manifest.json` | A SHA-1 of every other file in the bundle |
| `signature` | A detached PKCS#7 signature over `manifest.json` |

The analogy is a sealed envelope. `pass.json` and the images are the letter,
`manifest.json` is a list of the letter's page-by-page fingerprints, and
`signature` is a wax seal pressed over that list. Change any byte of any file
and the fingerprints stop matching; forge the fingerprint list and the seal
stops matching.

**The seal is not optional.** iOS refuses an unsigned or wrongly-signed pass with
no explanation. The signet ring is a *Pass Type ID certificate*, and Apple only
issues those to a paid Apple Developer Program membership. There is no way
around this — not a workaround this project chose not to implement, but a
requirement built into the platform.

Until the certificate is configured, `/thing2` still works: you can design the
pass, see the preview, and download the framed picture as a PNG. The
"Add to Apple Wallet" button is disabled and the page says why.

## Getting the certificates

1. In the [Apple Developer portal](https://developer.apple.com/account/resources/identifiers/list/passTypeId),
   create a **Pass Type ID** — e.g. `pass.app.worldwideview.thing2`.
2. Create a certificate for that Pass Type ID and download it
   (`pass.cer`). Note your 10-character **Team ID** from Membership details.
3. Download Apple's **Worldwide Developer Relations G4 intermediate**
   certificate from https://www.apple.com/certificateauthority/.
4. Convert everything to PEM. Starting from the `.p12` that Keychain Access
   exports (certificate *and* private key together):

   ```bash
   # Certificate only
   openssl pkcs12 -in Certificates.p12 -clcerts -nokeys -out pass-cert.pem

   # Private key only, unencrypted
   openssl pkcs12 -in Certificates.p12 -nocerts -nodes -out pass-key.pem

   # Apple's intermediate, DER → PEM
   openssl x509 -inform DER -in AppleWWDRCAG4.cer -out wwdr.pem
   ```

## Configuration

| Variable | Required | Description |
|---|---|---|
| `WALLET_PASS_TYPE_IDENTIFIER` | yes | e.g. `pass.app.worldwideview.thing2` |
| `WALLET_TEAM_IDENTIFIER` | yes | Your 10-character Apple Team ID |
| `WALLET_PASS_CERTIFICATE` | yes | PEM of the Pass Type ID certificate |
| `WALLET_PASS_PRIVATE_KEY` | yes | PEM of the matching private key |
| `WALLET_WWDR_CERTIFICATE` | yes | PEM of Apple's WWDR G4 intermediate |
| `WALLET_PASS_PRIVATE_KEY_PASSPHRASE` | no | Only if the key PEM is encrypted |
| `WALLET_ORGANIZATION_NAME` | no | Shown by iOS when adding; defaults to `WorldWideView` |

Each PEM variable accepts either the raw PEM text or a base64 encoding of it,
since some hosts mangle multi-line secrets:

```bash
base64 -w0 pass-cert.pem
```

`GET /api/thing2/status` reports which variables are still missing (names only —
never values) and whether the caller is signed in. That is what the banners on
the page are reading.

## Who can build a pass

Signing spends the deployment's Apple Pass Type ID certificate — passes minted
with it carry your organisation name — so `POST /api/thing2/pkpass` requires a
signed-in session on every edition where auth is enabled (that is, everything
except the `demo` edition). It is also rate limited to 20 requests per minute
per IP. Designing, previewing, and saving the framed picture need no session;
only the signed download does.

## Using it

Open `/thing2` **on the iPhone** for the smoothest path: the response is served
as `application/vnd.apple.pkpass` with an `inline` disposition, so Safari shows
the pass and an "Add" button. On a desktop browser the same request downloads a
`.pkpass` file you can AirDrop or email to yourself.

Two layouts are offered:

- **Wide banner** — a `storeCard` with the picture as a full-width strip.
- **Square thumbnail** — a `generic` pass with the picture on the right.

The browser crops the picture to Apple's exact sizes on a canvas before posting
it, so the preview is rendered from the very same pixels that get signed. The
server re-validates every image's format and dimensions rather than trusting
that.

## Implementation notes

Everything is written against Node's built-in `crypto` — no new dependencies:

| File | Role |
|---|---|
| `src/lib/wallet/der.ts` | Minimal ASN.1 DER encoder, plus enough of an X.509 reader to pull the signer's issuer and serial |
| `src/lib/wallet/pkcs7.ts` | Detached CMS `SignedData` builder |
| `src/lib/wallet/zip.ts` | Stored-method ZIP writer (the artwork is already compressed) |
| `src/lib/wallet/png.ts` | PNG signature and dimension checks |
| `src/lib/wallet/passJson.ts` | Builds `pass.json` from a draft |
| `src/lib/wallet/buildPass.ts` | Assembles and signs the bundle |
| `src/lib/wallet/signerConfig.ts` | Loads credentials from the environment |

The tests mint a throwaway certificate chain with the OpenSSL CLI, build a
complete bundle, and then have OpenSSL verify the detached signature and the
system `unzip` verify the archive — the same chain iOS walks. They skip
themselves if those tools are unavailable.
