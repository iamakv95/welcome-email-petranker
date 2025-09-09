// vercel-app/api/sendVerification.js
// POST { email, redirectUrl? }
// Requires env: APPWRITE_ENDPOINT, APPWRITE_PROJECT (optional), APPWRITE_API_KEY
import fetch from "node-fetch";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    const { email, redirectUrl } = req.body || {};
    if (!email) return res.status(400).json({ ok: false, error: "Missing email" });

    const APPWRITE_ENDPOINT = process.env.APPWRITE_ENDPOINT; // e.g. https://cloud.appwrite.io/v1
    const APPWRITE_PROJECT = process.env.APPWRITE_PROJECT || "";
    const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY; // create in Appwrite console (account scope)

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
