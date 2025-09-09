// api/sendVerification.js (improved logging + endpoint normalization)
import fetch from "node-fetch";

function normalizeEndpoint(e) {
  if (!e) return null;
  // strip trailing slash
  let ep = e.trim().replace(/\/$/, "");
  // ensure it contains /v1
  if (!/\/v1(\/|$)/.test(ep)) {
    ep = `${ep}/v1`;
  }
  return ep;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    const { email, redirectUrl } = req.body || {};
    if (!email) return res.status(400).json({ ok: false, error: "Missing email" });

    const rawEndpoint = process.env.APPWRITE_ENDPOINT;
    const APPWRITE_ENDPOINT = normalizeEndpoint(rawEndpoint);
    const APPWRITE_PROJECT = process.env.APPWRITE_PROJECT || "";
    const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY;

    if (!APPWRITE_ENDPOINT || !APPWRITE_API_KEY) {
      console.error("sendVerification: Missing APPWRITE env vars", { hasEndpoint: !!APPWRITE_ENDPOINT, hasKey: !!APPWRITE_API_KEY });
      return res.status(500).json({ ok: false, error: "Server misconfigured" });
    }

    const body = { email };
    if (redirectUrl) body.url = redirectUrl;

    const url = `${APPWRITE_ENDPOINT}/account/verification`;
    console.log("sendVerification: calling Appwrite at", url, "with project:", !!APPWRITE_PROJECT);

    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Appwrite-Project": APPWRITE_PROJECT,
        "X-Appwrite-Key": APPWRITE_API_KEY,
      },
      body: JSON.stringify(body),
    });

    // read raw text first for best debugging (some errors not JSON)
    const text = await r.text().catch(() => "");
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch (e) { parsed = null; }

    if (!r.ok) {
      console.error("sendVerification: Appwrite returned non-OK", { status: r.status, text, parsed });
      // return raw text to client for debugging (safe here)
      return res.status(500).json({ ok: false, error: parsed || text || `Appwrite error ${r.status}` });
    }

    console.log("sendVerification: Appwrite success", { status: r.status, body: parsed || text });
    return res.status(200).json({ ok: true, result: parsed || text });
  } catch (err) {
    console.error("sendVerification exception", err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
}
