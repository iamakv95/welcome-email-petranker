// api/verify.js
// Validate verification token and mark Appwrite user as verified (server-side).
// Deploy to Vercel and set environment variables:
// - VERIFY_BASE  (e.g. https://verify-emails.vercel.app)
// - TOKEN_SECRET
// - APPWRITE_ENDPOINT
// - APPWRITE_PROJECT
// - APPWRITE_API_KEY

import crypto from "crypto";

const VERIFY_BASE = process.env.VERIFY_BASE || "";
const TOKEN_SECRET = process.env.TOKEN_SECRET || "";
const APPWRITE_ENDPOINT = (process.env.APPWRITE_ENDPOINT || "").replace(/\/$/, "");
const APPWRITE_PROJECT = process.env.APPWRITE_PROJECT || "";
const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY || "";

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

function urlRedirect(path) {
  // ensure no leading slash double
  if (!VERIFY_BASE) return "/"; // fallback
  return `${VERIFY_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

export default async function handler(req, res) {
  try {
    // Accept token in query param: ?token=...
    const token = (req.query?.token || (req.url && req.url.split("?token=")?.[1]) || "")?.toString();
    if (!token) {
      return res.redirect(`${VERIFY_BASE}/?verified=0&reason=missing_token`);
    }

    const parts = token.split(".");
    if (parts.length !== 3) {
      return res.redirect(`${VERIFY_BASE}/?verified=0&reason=bad_token`);
    }

    const [b64User, expiresStr, hmac] = parts;
    const payload = `${b64User}.${expiresStr}`;

    if (!TOKEN_SECRET) {
      console.error("TOKEN_SECRET not set in environment");
      return res.redirect(`${VERIFY_BASE}/?verified=0&reason=server_config`);
    }

    const expected = crypto.createHmac("sha256", TOKEN_SECRET).update(payload).digest("hex");

    if (!timingSafeEqualHex(expected, hmac)) {
      console.warn("verify: invalid signature");
      return res.redirect(`${VERIFY_BASE}/?verified=0&reason=invalid_signature`);
    }

    const expires = parseInt(expiresStr, 10);
    if (isNaN(expires) || Date.now() > expires) {
      console.warn("verify: token expired");
      return res.redirect(`${VERIFY_BASE}/?verified=0&reason=expired`);
    }

    const userId = base64UrlDecode(b64User);

    // Validate Appwrite admin config
    if (!APPWRITE_ENDPOINT || !APPWRITE_PROJECT || !APPWRITE_API_KEY) {
      console.error("Appwrite admin config missing");
      return res.redirect(`${VERIFY_BASE}/?verified=0&reason=server_config`);
    }

    // Attempt to mark user as verified via Appwrite admin endpoints.
    // Depending on Appwrite version the endpoint may vary. We try PATCH /v1/users/{userId}/verification
    // and fallback to a generic /v1/users/{userId} approach if necessary.
    try {
      // Preferred endpoint (may work in newer Appwrite): PATCH /v1/users/{userId}/verification
      const patchUrl = `${APPWRITE_ENDPOINT}/v1/users/${encodeURIComponent(userId)}/verification`;
      const pResp = await fetch(patchUrl, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Appwrite-Project": APPWRITE_PROJECT,
          "X-Appwrite-Key": APPWRITE_API_KEY,
        },
        body: JSON.stringify({ emailVerification: true }),
      });

      if (pResp.ok) {
        return res.redirect(`${VERIFY_BASE}/?verified=1&userId=${encodeURIComponent(userId)}`);
      } else {
        // Try fallback PUT/POST update (some Appwrite versions differ)
        const pText = await pResp.text().catch(() => "");
        console.warn("Appwrite patch verification responded:", pResp.status, pText);

        // fallback attempt: put to /v1/users/{userId}
        const putUrl = `${APPWRITE_ENDPOINT}/v1/users/${encodeURIComponent(userId)}`;
        const putResp = await fetch(putUrl, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "X-Appwrite-Project": APPWRITE_PROJECT,
            "X-Appwrite-Key": APPWRITE_API_KEY,
          },
          body: JSON.stringify({ emailVerification: true }),
        });

        if (putResp.ok) {
          return res.redirect(`${VERIFY_BASE}/?verified=1&userId=${encodeURIComponent(userId)}`);
        }

        const putText = await putResp.text().catch(() => "");
        console.error("Appwrite fallback failed:", putResp.status, putText);
        return res.redirect(`${VERIFY_BASE}/?verified=0&reason=appwrite_failed`);
      }
    } catch (e) {
      console.error("verify: appwrite call error", e);
      return res.redirect(`${VERIFY_BASE}/?verified=0&reason=appwrite_error`);
    }
  } catch (err) {
    console.error("verify: unexpected error", err);
    return res.redirect(`${VERIFY_BASE}/?verified=0&reason=server_error`);
  }
}
