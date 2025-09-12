// api/welcome.js (corrected Brevo header)
// Generates a signed token and sends welcome email via Brevo (Sendinblue).
// IMPORTANT: Ensure env vars are set in Vercel:
// - VERIFY_BASE (e.g. https://verify-emails.vercel.app)
// - TOKEN_SECRET
// - BREVO_API_KEY
// - FROM_EMAIL

import crypto from "crypto";

const VERIFY_BASE = process.env.VERIFY_BASE;
const TOKEN_SECRET = process.env.TOKEN_SECRET;
const FROM_EMAIL = process.env.FROM_EMAIL || "admin@petranker.in";
const BREVO_API_KEY = process.env.BREVO_API_KEY; // must be set in Vercel

function base64UrlEncode(s) {
  return Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function hmacFor(payload) {
  return crypto.createHmac("sha256", TOKEN_SECRET).update(payload).digest("hex");
}

function buildEmailHtml({ name, verifyUrl }) {
  const plainName = name || "friend";
  return `
    <div style="font-family: system-ui, -apple-system, Roboto, Arial; color:#222;">
      <h2 style="color:#015055">Bravo — welcome!</h2>
      <p>Hi ${plainName},</p>
      <p>We’ve set everything up early — click the button below to verify your email and complete setup:</p>
      <p style="margin:20px 0;">
        <a href="${verifyUrl}" style="display:inline-block;padding:10px 16px;background:#015055;color:#fff;border-radius:6px;text-decoration:none;">Verify email</a>
      </p>
      <p style="font-size:13px;color:#666">If the button doesn't work, paste this link into your browser:<br/><a href="${verifyUrl}">${verifyUrl}</a></p>
      <hr style="border:none;border-top:1px solid #eee;margin:18px 0;" />
      <p style="font-size:13px;color:#777">If you didn't sign up, please ignore this email.</p>
    </div>
  `;
}

async function sendBrevo(email, subject, html, name) {
  // Brevo (Sendinblue) transactional email API v3
  const endpoint = "https://api.brevo.com/v3/smtp/email";
  const payload = {
    sender: { email: FROM_EMAIL },
    to: [{ email, name: name || "" }],
    subject,
    htmlContent: html,
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // CORRECT header for Brevo:
      "api-key": BREVO_API_KEY,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Brevo send failed: ${res.status} ${text}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }

  return res.json();
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const { email, name, userId } = req.body || {};
    if (!email || !userId) return res.status(400).json({ error: "Missing email or userId" });

    // DEBUG: temporary - log presence of BREVO_API_KEY (remove after verified)
    console.log("DEBUG: BREVO_API_KEY present:", !!process.env.BREVO_API_KEY, "len:", process.env.BREVO_API_KEY ? process.env.BREVO_API_KEY.length : 0);

    // Build token: <b64User>.<expiresUnixMs>.<hmac>
    const b64User = base64UrlEncode(userId);
    const expires = Date.now() + 1000 * 60 * 60 * 24; // 24h
    const payload = `${b64User}.${expires}`;
    const hmac = hmacFor(payload);
    const token = `${payload}.${hmac}`;

    const verifyUrl = `${VERIFY_BASE}/api/verify?token=${encodeURIComponent(token)}`;

    // If Brevo not configured return dev link (handy for local dev)
    if (!BREVO_API_KEY) {
      return res.status(200).json({ ok: true, devVerifyUrl: verifyUrl });
    }

    // send via Brevo
    const html = buildEmailHtml({ name, verifyUrl });
    await sendBrevo(email, "Bravo — verify your email", html, name);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("welcome API error:", err);
    // Return useful error info for debugging (but avoid leaking secrets)
    return res.status(500).json({ error: String(err?.message || err), details: err?.body || null });
  }
}
