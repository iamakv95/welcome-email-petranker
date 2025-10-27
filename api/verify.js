// api/verify.js (auto-login friendly)
// Make sure env vars are set:
// VERIFY_BASE, TOKEN_SECRET, APPWRITE_ENDPOINT (no trailing /v1), APPWRITE_PROJECT, APPWRITE_API_KEY, MOBILE_DEEP_LINK_SCHEME (e.g. petranker://)

import crypto from "crypto";

const VERIFY_BASE = process.env.VERIFY_BASE || "";
const TOKEN_SECRET = process.env.TOKEN_SECRET || "";
// Ensure endpoint doesn't have trailing slash or /v1
let APPWRITE_ENDPOINT = (process.env.APPWRITE_ENDPOINT || "").trim().replace(/\/+$/, "");
APPWRITE_ENDPOINT = APPWRITE_ENDPOINT.replace(/\/v1$/, "");
const APPWRITE_PROJECT = process.env.APPWRITE_PROJECT || "";
const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY || "";
const MOBILE_SCHEME = process.env.MOBILE_DEEP_LINK_SCHEME || "petranker://auth/verified";

// Log configuration (remove in production)
console.log("Verify API Config:", {
  VERIFY_BASE,
  APPWRITE_ENDPOINT,
  APPWRITE_PROJECT: APPWRITE_PROJECT ? "SET" : "MISSING",
  APPWRITE_API_KEY: APPWRITE_API_KEY ? "SET" : "MISSING",
  MOBILE_SCHEME
});

function timingSafeEqualHex(a, b) {
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
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

    if (!TOKEN_SECRET) return res.redirect(`${VERIFY_BASE}/?verified=0&reason=server_config`);

    const expected = crypto.createHmac("sha256", TOKEN_SECRET).update(payload).digest("hex");
    if (!timingSafeEqualHex(expected, hmac)) {
      return res.redirect(`${VERIFY_BASE}/?verified=0&reason=invalid_signature`);
    }

    const expires = parseInt(expiresStr, 10);
    if (isNaN(expires) || Date.now() > expires) {
      return res.redirect(`${VERIFY_BASE}/?verified=0&reason=expired`);
    }

    const userId = base64UrlDecode(b64User);

    // verify user via Appwrite admin
    if (!APPWRITE_ENDPOINT || !APPWRITE_PROJECT || !APPWRITE_API_KEY) {
      return res.redirect(`${VERIFY_BASE}/?verified=0&reason=server_config`);
    }

    // Attempt verification using PATCH on the user endpoint
    // Appwrite API: PATCH /v1/users/{userId}
    const verifyUrl = `${APPWRITE_ENDPOINT}/v1/users/${encodeURIComponent(userId)}`;
    let verificationSuccess = false;
    
    try {
      const rv = await fetch(verifyUrl, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Appwrite-Project": APPWRITE_PROJECT,
          "X-Appwrite-Key": APPWRITE_API_KEY,
        },
        body: JSON.stringify({ emailVerification: true }),
      });

      const rtext = await rv.text().catch(() => "");
      console.log("Appwrite verification response:", rv.status, rtext);
      
      if (rv.ok) {
        verificationSuccess = true;
      } else {
        console.error("Appwrite verification failed:", rv.status, rtext);
        // Don't fail completely - continue to create token for auto-login
        // The app can handle verification status separately
      }
    } catch (e) {
      console.error("verify: appwrite error", e);
      // Don't fail completely - continue to create token for auto-login
    }

    // --- create a short lived custom token for mobile auto-login ---
    // POST /v1/users/{userId}/tokens
    // docs: returns token object { $id, secret, ... } (secret used by client)
    try {
      const tokenCreateUrl = `${APPWRITE_ENDPOINT}/v1/users/${encodeURIComponent(userId)}/tokens`;
      // choose expire seconds small (e.g. 120) - adjust as you like
      const expireSeconds = 120;
      const tokenResp = await fetch(tokenCreateUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Appwrite-Project": APPWRITE_PROJECT,
          "X-Appwrite-Key": APPWRITE_API_KEY,
        },
        body: JSON.stringify({ expire: expireSeconds }),
      });
      const tokenBody = await tokenResp.json().catch(() => ({}));
      if (!tokenResp.ok || !tokenBody || !tokenBody.secret) {
        // token creation failed — redirect to web success page (no auto-login)
        const verifiedParam = verificationSuccess ? "1" : "partial";
        return res.redirect(`${VERIFY_BASE}/?verified=${verifiedParam}&userId=${encodeURIComponent(userId)}&autologin=0`);
      }

      // We have a token secret. Build a deep link that contains userId + secret.
      // **NOTE**: secret is short-lived; use HTTPS redirect for desktop fallback WITHOUT exposing secret publicly (we won't include secret on web).
      const secret = encodeURIComponent(tokenBody.secret);
      const deepLink = `${MOBILE_SCHEME}?userId=${encodeURIComponent(userId)}&secret=${secret}&verified=${verificationSuccess ? '1' : '0'}`;

      // If the client is mobile (user-agent), redirect to deep link; otherwise redirect to web page with autologin disabled.
      const ua = (req.headers["user-agent"] || req.headers["User-Agent"] || "").toLowerCase();
      const looksLikeMobile = /android|iphone|ipad|mobile/i.test(ua);

      if (looksLikeMobile) {
        // redirect to deep link (mobile will open the app)
        return res.redirect(deepLink);
      } else {
        // Desktop: redirect to web page (do not expose token secret in URL on desktop)
        // The web page can render a button to open the app with the deep link (optionally provide a server-side exchange)
        const verifiedParam = verificationSuccess ? "1" : "partial";
        return res.redirect(`${VERIFY_BASE}/?verified=${verifiedParam}&userId=${encodeURIComponent(userId)}&autologin=0`);
      }
    } catch (e) {
      console.error("verify: token create error", e);
      const verifiedParam = verificationSuccess ? "1" : "partial";
      return res.redirect(`${VERIFY_BASE}/?verified=${verifiedParam}&userId=${encodeURIComponent(userId)}&autologin=0`);
    }
  } catch (err) {
    console.error("verify: unexpected", err);
    return res.redirect(`${VERIFY_BASE}/?verified=0&reason=server_error`);
  }
}
