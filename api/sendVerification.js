// vercel-app/api/sendVerification.js
// POST { email, redirectUrl? }
// Requires env: APPWRITE_ENDPOINT, APPWRITE_PROJECT (optional), APPWRITE_API_KEY
import fetch from "node-fetch";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    const { email, redirectUrl } = req.body || {};
    if (!email) return res.status(400).json({ ok: false, error: "Missing email" });

    // vercel-app/api/sendVerification.js
// POST { email, redirectUrl? }
// Requires env: APPWRITE_ENDPOINT, APPWRITE_PROJECT (optional), APPWRITE_API_KEY
import fetch from "node-fetch";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    const { email, redirectUrl } = req.body || {};
    if (!email) return res.status(400).json({ ok: false, error: "Missing email" });

    const APPWRITE_ENDPOINT = "https://fra.cloud.appwrite.io/v1";
    const APPWRITE_PROJECT = "68ba898e9d32be184432" ;
    const APPWRITE_API_KEY = standard_114e3b6f2753db205a704eae633e81857d6d69be1e5ffd1602707b415eb4304846399f54841cde16e2a05b5df5e86e78230ce0d0b24c6036b05dc95f77ac9dc43bb9aed35f844e56684dd0c3ee0618f0be3e043fa0d26d95fc4a2aa98ff9b53b43653373c5be79c25c386df6a41c0dedaf126732d15dcaabb42e157dc534685d;

    if (!APPWRITE_ENDPOINT || !APPWRITE_API_KEY) {
      console.error("sendVerification: Missing APPWRITE env vars");
      return res.status(500).json({ ok: false, error: "Server misconfigured" });
    }

    const body = { email };
    if (redirectUrl) body.url = redirectUrl;

    const r = await fetch(`${APPWRITE_ENDPOINT}/account/verification`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Appwrite-Project": APPWRITE_PROJECT,
        "X-Appwrite-Key": APPWRITE_API_KEY,
      },
      body: JSON.stringify(body),
    });

    const json = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error("sendVerification: Appwrite error", r.status, json);
      return res.status(500).json({ ok: false, error: json || `Appwrite error ${r.status}` });
    }

    return res.status(200).json({ ok: true, result: json });
  } catch (err) {
    console.error("sendVerification exception", err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
}


    if (!APPWRITE_ENDPOINT || !APPWRITE_API_KEY) {
      console.error("sendVerification: Missing APPWRITE env vars");
      return res.status(500).json({ ok: false, error: "Server misconfigured" });
    }

    const body = { email };
    if (redirectUrl) body.url = redirectUrl;

    const r = await fetch(`${APPWRITE_ENDPOINT}/account/verification`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Appwrite-Project": APPWRITE_PROJECT,
        "X-Appwrite-Key": APPWRITE_API_KEY,
      },
      body: JSON.stringify(body),
    });

    const json = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error("sendVerification: Appwrite error", r.status, json);
      return res.status(500).json({ ok: false, error: json || `Appwrite error ${r.status}` });
    }

    return res.status(200).json({ ok: true, result: json });
  } catch (err) {
    console.error("sendVerification exception", err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
}
