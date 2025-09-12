// api/verify.js
import crypto from "crypto";

const APPWRITE_ENDPOINT = (process.env.APPWRITE_ENDPOINT || "").replace(/\/$/, "");
const APPWRITE_PROJECT = process.env.APPWRITE_PROJECT;
const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY;
const VERIFY_BASE = process.env.VERIFY_BASE;
const TOKEN_SECRET = process.env.TOKEN_SECRET;

function timingSafeEqualHex(a, b) {
  try {
    const ab = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  } catch (e) {
    return false;
  }
}

function base64UrlDecode(s) {
  let str = s.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return Buffer.from(str, "base64").toString();
}

export default async function handler(req, res) {
  try {
    const token = (req.query?.token || (req.url && req.url.split("?token=")?.[1]) || "")?.toString();
    if (!token) return res.redirect(`${VERIFY_BASE}/?verified=0&reason=missing_token`);

    const parts = token.split(".");
    if (parts.length !== 3) return res.redirect(`${VERIFY_BASE}/?verified=0&reason=bad_token`);

    const [b64User, expiresStr, hmac] = parts;
    const payload = `${b64User}.${expiresStr}`;
    const expected = crypto.createHmac("sha256", TOKEN_SECRET).update(payload).digest("hex");

    if (!timingSafeEqualHex(expected, hmac)) {
      return res.redirect(`${VERIFY_BASE}/?verified=0&reason=invalid_signature`);
    }
    const expires = parseInt(expiresStr, 10);
    if (isNaN(expires) || Date.now() > expires) {
      return res.redirect(`${VERIFY_BASE}/?verified=0&reason=expired`);
    }

    const userId = base64UrlDecode(b64User);

    // Call Appwrite Admin API to mark user as verified. Appwrite may require a different endpoint; using PATCH /users/{userId}/verification or /users/{userId}
    // Here we try PATCH /users/{userId}/verification if supported, otherwise /users/{userId}
    try {
      // Preferred: if your Appwrite supports updating user via patch:
      const url = `${APPWRITE_ENDPOINT}/v1/users/${encodeURIComponent(userId)}/verification`;
      const r = await fetch(url, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Appwrite-Project": APPWRITE_PROJECT,
          "X-Appwrite-Key": APPWRITE_API_KEY,
        },
        body: JSON.stringify({ emailVerification: true }),
      });

      if (!r.ok) {
        // Fallback: try updating user document (some Appwrite versions may differ)
        const txt = await r.text().catch(() => "");
        console.warn("appwrite verify patch failed", r.status, txt);

        // Attempt alternative: update user (may require Admin endpoint specifics)
        const altUrl = `${APPWRITE_ENDPOINT}/v1/users/${encodeURIComponent(userId)}`;
        const r2 = await fetch(altUrl, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "X-Appwrite-Project": APPWRITE_PROJECT,
            "X-Appwrite-Key": APPWRITE_API_KEY,
          },
          body: JSON.stringify({ emailVerification: true }),
        });
        if (!r2.ok) {
          const t2 = await r2.text().catch(() => "");
          console.warn("appwrite alternative update failed", r2.status, t2);
          return res.redirect(`${VERIFY_BASE}/?verified=0&reason=appwrite_failed`);
        }
      }
    } catch (e) {
      console.error("appwrite call error:", e);
      return res.redirect(`${VERIFY_BASE}/?verified=0&reason=appwrite_error`);
    }

    // success
    return res.redirect(`${VERIFY_BASE}/?verified=1&userId=${encodeURIComponent(userId)}`);
  } catch (err) {
    console.error("verify error", err);
    return res.redirect(`${VERIFY_BASE}/?verified=0&reason=server_error`);
  }
}
