// api/register.js
// Server-side registration endpoint for secure auto-login.
// Expects JSON body: { name, email, password }
// Returns { ok: true, userId, secret } on success.

const APPWRITE_ENDPOINT = (process.env.APPWRITE_ENDPOINT || "").replace(/\/+$/, "").replace(/\/v1$/, "");
const APPWRITE_PROJECT = process.env.APPWRITE_PROJECT || "";
const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY || "";
const TOKEN_EXPIRE_SECONDS = parseInt(process.env.REGISTER_TOKEN_EXPIRE_SECONDS || "120", 10);
const WELCOME_ENDPOINT = process.env.VERIFY_WELCOME_ENDPOINT || "https://verify-emails.vercel.app/api/welcome";

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async function handler(req) {
  try {
    if (req.method !== "POST") return json(405, { ok: false, message: "Method not allowed" });

    const body = await req.json().catch(() => ({}));
    const { name = "", email = "", password = "" } = body;

    if (!email || !password) return json(400, { ok: false, message: "email and password required" });

    if (!APPWRITE_ENDPOINT || !APPWRITE_PROJECT || !APPWRITE_API_KEY) {
      return json(500, { ok: false, message: "Server not configured" });
    }

    // (Optional) Basic abuse mitigation: block suspicious requests (very minimal)
    // You should replace this with real captcha/rate-limit in production.
    if (typeof email !== "string" || !email.includes("@")) {
      return json(400, { ok: false, message: "Invalid email" });
    }

    // 1) Create user (admin)
    // API: POST /v1/users
    const createUserUrl = `${APPWRITE_ENDPOINT}/v1/users`;
    const createResp = await fetch(createUserUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Appwrite-Project": APPWRITE_PROJECT,
        "X-Appwrite-Key": APPWRITE_API_KEY,
      },
      body: JSON.stringify({
        userId: "unique()", // Appwrite supports "unique()" by SDKs; REST sometimes requires client id - fallback below
        email,
        password,
        name,
      }),
    });

    // Appwrite REST sometimes expects slightly different body; if 400 due to userId handle fallback:
    let createBodyText = await createResp.text().catch(() => "");
    let created = null;
    if (createResp.ok) {
      try {
        created = JSON.parse(createBodyText);
      } catch (e) {
        created = { $id: createBodyText };
      }
    } else {
      // If server complains about userId, try fallback: omit userId so Appwrite generates id
      if (createResp.status === 400 || createResp.status === 409) {
        const createResp2 = await fetch(createUserUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Appwrite-Project": APPWRITE_PROJECT,
            "X-Appwrite-Key": APPWRITE_API_KEY,
          },
          body: JSON.stringify({ email, password, name }),
        });
        createBodyText = await createResp2.text().catch(() => "");
        if (!createResp2.ok) {
          return json(createResp2.status, { ok: false, message: "Appwrite create user failed", details: createBodyText });
        }
        try {
          created = JSON.parse(createBodyText);
        } catch (e) {
          created = { $id: createBodyText };
        }
      } else {
        return json(createResp.status, { ok: false, message: "Appwrite create user failed", details: createBodyText });
      }
    }

    const userId = created.$id || created.$uid || created.id || created.userId || created["$id"] || null;
    if (!userId) {
      return json(500, { ok: false, message: "Appwrite did not return user id", details: created });
    }

    // 2) Create short-lived token: POST /v1/users/{userId}/tokens
    const tokenUrl = `${APPWRITE_ENDPOINT}/v1/users/${encodeURIComponent(userId)}/tokens`;
    const tokenResp = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Appwrite-Project": APPWRITE_PROJECT,
        "X-Appwrite-Key": APPWRITE_API_KEY,
      },
      body: JSON.stringify({ expire: TOKEN_EXPIRE_SECONDS }),
    });

    const tokenText = await tokenResp.text().catch(() => "");
    if (!tokenResp.ok) {
      return json(tokenResp.status, { ok: false, message: "Appwrite token creation failed", details: tokenText });
    }
    let tokenBody = {};
    try { tokenBody = JSON.parse(tokenText); } catch (e) { tokenBody = {}; }

    if (!tokenBody.secret) {
      return json(500, { ok: false, message: "Token secret missing", details: tokenBody });
    }

    // 3) Optionally trigger welcome email (non-blocking)
    (async function fireWelcome() {
      try {
        await fetch(WELCOME_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, name, userId }),
        });
      } catch (e) {
        // swallow; optional
        console.warn("welcome fire failed", e);
      }
    })();

    // 4) Return userId and secret to client
    return json(200, {
      ok: true,
      userId,
      secret: tokenBody.secret,
      expire: tokenBody.expire || TOKEN_EXPIRE_SECONDS,
    });
  } catch (err) {
    console.error("api/register error", err);
    return json(500, { ok: false, message: "server error", error: String(err) });
  }
}
