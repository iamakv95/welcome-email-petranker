// vercel-app/api/sendWelcomeBrevo.js
// POST { email, name? }
// Requires env: BREVO_API_KEY, BREVO_SENDER_EMAIL, BREVO_SENDER_NAME
import fetch from "node-fetch";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    const { email, name } = req.body || {};
    if (!email) return res.status(400).json({ ok: false, error: "Missing email" });

    const BREVO_KEY = process.env.BREVO_API_KEY;
    const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL; // e.g. no-reply@yourdomain.com
    const SENDER_NAME = process.env.BREVO_SENDER_NAME || "petRanker";

    if (!BREVO_KEY || !SENDER_EMAIL) {
      console.error("sendWelcomeBrevo: Missing Brevo env vars");
      return res.status(500).json({ ok: false, error: "Server misconfigured" });
    }

    const payload = {
      sender: { name: SENDER_NAME, email: SENDER_EMAIL },
      to: [{ email, name: name || "" }],
      subject: "Welcome to petRanker — next steps",
      htmlContent: `<p>Hi ${name || ""},</p>
        <p>Welcome to <strong>petRanker</strong>! We sent you an email to verify your address — if it doesn't arrive, please check spam or click the verification link when it arrives.</p>
        <p>If you need help, reply to this email.</p>
        <p>— petRanker Team</p>`,
    };

    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": BREVO_KEY,
      },
      body: JSON.stringify(payload),
    });

    const json = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error("sendWelcomeBrevo: Brevo error", r.status, json);
      return res.status(500).json({ ok: false, error: json || `Brevo error ${r.status}` });
    }

    return res.status(200).json({ ok: true, result: json });
  } catch (err) {
    console.error("sendWelcomeBrevo exception", err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
}
