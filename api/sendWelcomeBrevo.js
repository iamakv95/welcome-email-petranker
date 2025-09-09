// api/sendWelcomeBrevo.js
// Vercel Serverless Function to send a welcome email via Brevo (Sendinblue).
// Deployed under your Vercel project (e.g. https://verify-emails.vercel.app/api/sendWelcomeBrevo).
//
// Requirements:
// - Set BREVO_API_KEY in your Vercel Project Settings → Environment Variables.
// - Replace "noreply@yourapp.com" with your verified sender email in Brevo.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { email, name } = req.body || {};

    if (!email) {
      return res.status(400).json({ error: "Missing email" });
    }

    const payload = {
      sender: { email: "noreply@yourapp.com", name: "PetRanker" },
      to: [{ email, name: name || "" }],
      subject: "Welcome to PetRanker 🎉",
      htmlContent: `
        <h2>Hi ${name || "there"},</h2>
        <p>Welcome to <b>PetRanker</b>! 🐾</p>
        <p>You can now log in to your account and select your exam to start practicing.</p>
        <br/>
        <p>Good luck! 🚀</p>
      `,
    };

    const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": process.env.BREVO_API_KEY,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("Brevo API error:", text);
      return res.status(500).json({ error: text });
    }

    const data = await resp.json();
    console.log("Brevo send success:", data);

    return res.status(200).json({ ok: true, data });
  } catch (err) {
    console.error("sendWelcomeBrevo error:", err);
    return res.status(500).json({ error: err.message || String(err) });
  }
}
