// api/verify.js (fixed: normalizes APPWRITE_ENDPOINT, adds helpful logs)
import crypto from "crypto";

const VERIFY_BASE = process.env.VERIFY_BASE || "";
const TOKEN_SECRET = process.env.TOKEN_SECRET || "";
// Normalize APPWRITE_ENDPOINT to NOT include trailing /v1 or trailing slash
let APPWRITE_ENDPOINT = (process.env.APPWRITE_ENDPOINT || "").replace(/\/+$/, "");
APPWRITE_ENDPOINT = APPWRITE_ENDPOINT.replace(/\/v1$/, ""); // remove trailing /v1 if present
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

export default async function handler(req, res) {
  try {
    const token = (req.query?.token || (req.url && req.url.split("?token=")?.[1]) || "")?.toString();
    if (!token) return res.redirect(`${VERIFY_BASE}/?verified=0&reason=missing_token`);

    const parts = token.split(".");
    if (parts.length !== 3) return res.redirect(`${VERIFY_BASE}/?verified=0&reason=bad_token`);

    const [b64User, expiresStr, hmac] = parts;
    const payload = `${b64User}.${expiresStr}`;

    if (!TOKEN_SECRET) {
      console.error("verify: TOKEN_SECRET not set");
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
      console.error("verify: Appwrite admin config missing", { APPWRITE_ENDPOINT, APPWRITE_PROJECT: !!APPWRITE_PROJECT, APPWRITE_API_KEY: !!APPWRITE_API_KEY });
      return res.redirect(`${VERIFY_BASE}/?verified=0&reason=server_config`);
    }

    // Build the correct URL we will call
    const verifyUrl = `${APPWRITE_ENDPOINT}/v1/users/${encodeURIComponent(userId)}/verification`;
    console.log("verify: calling Appwrite URL:", verifyUrl);

    try {
      const pResp = await fetch(verifyUrl, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Appwrite-Project": APPWRITE_PROJECT,
          "X-Appwrite-Key": APPWRITE_API_KEY,
        },
        body: JSON.stringify({ emailVerification: true }),
      });

      const text = await pResp.text().catch(() => "");
      console.log("verify: Appwrite response status:", pResp.status, "body:", text);

      if (pResp.ok) {
        return res.redirect(`${VERIFY_BASE}/?verified=1&userId=${encodeURIComponent(userId)}`);
      }

      // If first endpoint failed with 404 or other, give helpful redirect reason
      if (pResp.status === 404) {
        console.warn("verify: Appwrite returned 404 for verification endpoint. Confirm Appwrite version and endpoint path.");
        return res.redirect(`${VERIFY_BASE}/?verified=0&reason=appwrite_route_not_found`);
      }

      console.error("verify: Appwrite verification failed", pResp.status, text);
      return res.redirect(`${VERIFY_BASE}/?verified=0&reason=appwrite_failed`);
    } catch (e) {
      console.error("verify: appwrite call error", e);
      return res.redirect(`${VERIFY_BASE}/?verified=0&reason=appwrite_error`);
    }
  } catch (err) {
    console.error("verify: unexpected error", err);
    return res.redirect(`${VERIFY_BASE}/?verified=0&reason=server_error`);
  }
}
