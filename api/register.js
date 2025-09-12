// api/register.js
// Server-side registration endpoint that works in both Vercel Edge and Node serverless runtimes.
// Expects JSON POST body: { name, email, password }
const crypto = require("crypto"); // top of file, if not already present
const APPWRITE_ENDPOINT = (process.env.APPWRITE_ENDPOINT || "").replace(/\/+$/, "").replace(/\/v1$/, "");
const APPWRITE_PROJECT = process.env.APPWRITE_PROJECT || "";
const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY || "";
const TOKEN_EXPIRE_SECONDS = parseInt(process.env.REGISTER_TOKEN_EXPIRE_SECONDS || "120", 10);
const WELCOME_ENDPOINT = process.env.VERIFY_WELCOME_ENDPOINT || "";

function makeJsonResponseNode(res, status = 200, body = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function makeJsonResponseEdge(status = 200, body = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// safe body parser that works for both node/edge
async function parseBody(req, res) {
  // Edge runtime: req is a Fetch Request with json()
  if (typeof req.json === "function") {
    return await req.json();
  }

  // Node serverless: express-like req,res pair. First check req.body (if already parsed by platform)
  if (req.body) return req.body;

  // Otherwise, read raw stream
  return await new Promise((resolve, reject) => {
    try {
      let data = "";
      req.setEncoding && req.setEncoding("utf8");
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => {
        try {
          if (!data) return resolve({});
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({});
        }
      });
      req.on("error", reject);
    } catch (e) {
      resolve({});
    }
  });
}

// replace existing createAppwriteUser with this version

async function createAppwriteUser(email, password, name) {
  const createUserUrl = `${APPWRITE_ENDPOINT}/v1/users`;

  // generate a safe userId (UUID v4) — allowed characters and length (36)
  const userId = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");

  const payload = { userId, email, password, name };

  const resp = await fetch(createUserUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Appwrite-Project": APPWRITE_PROJECT,
      "X-Appwrite-Key": APPWRITE_API_KEY,
    },
    body: JSON.stringify(payload),
  });

  const text = await resp.text().catch(() => "");
  if (!resp.ok) {
    return { ok: false, status: resp.status, text };
  }
  let parsed = {};
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    parsed = { $id: text };
  }
  return { ok: true, body: parsed };
}


async function createAppwriteToken(userId) {
  const tokenUrl = `${APPWRITE_ENDPOINT}/v1/users/${encodeURIComponent(userId)}/tokens`;
  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Appwrite-Project": APPWRITE_PROJECT,
      "X-Appwrite-Key": APPWRITE_API_KEY,
    },
    body: JSON.stringify({ expire: TOKEN_EXPIRE_SECONDS }),
  });
  const text = await resp.text().catch(() => "");
  if (!resp.ok) {
    return { ok: false, status: resp.status, text };
  }
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch (e) {
    return { ok: true, body: { raw: text } };
  }
}

async function fireWelcomeAsync(email, name, userId) {
  if (!WELCOME_ENDPOINT) return;
  try {
    await fetch(WELCOME_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, name, userId }),
    });
  } catch (e) {
    // swallow
    console.warn("welcome fire failed", e);
  }
}

/**
 * Handler exported in a way that works for Vercel Node serverless (req,res)
 * and Edge (Request -> Response).
 */
export default async function handler(reqOrReq, maybeRes) {
  // Detect Edge runtime: a single Request object passed (no second param)
  const isEdge = typeof maybeRes === "undefined";

  // Node serverless: handler(req, res)
  if (!isEdge) {
    const req = reqOrReq;
    const res = maybeRes;
    try {
      if (req.method !== "POST") return makeJsonResponseNode(res, 405, { ok: false, message: "Method not allowed" });

      const body = await parseBody(req, res);
      const { name = "", email = "", password = "" } = body || {};

      if (!email || !password) return makeJsonResponseNode(res, 400, { ok: false, message: "email and password required" });

      if (!APPWRITE_ENDPOINT || !APPWRITE_PROJECT || !APPWRITE_API_KEY) {
        return makeJsonResponseNode(res, 500, { ok: false, message: "Server not configured (missing APPWRITE envs)" });
      }

      // Basic validation
      if (typeof email !== "string" || !email.includes("@")) {
        return makeJsonResponseNode(res, 400, { ok: false, message: "Invalid email" });
      }

      // Create user
      const created = await createAppwriteUser(email, password, name);
      if (!created.ok) {
        return makeJsonResponseNode(res, created.status || 500, { ok: false, message: "Appwrite create user failed", details: created.text || created.body });
      }
      const userId = created.body.$id || created.body.id || created.body.userId || created.body["$id"];
      if (!userId) return makeJsonResponseNode(res, 500, { ok: false, message: "Appwrite did not return user id", details: created.body });

      // Create token
      const token = await createAppwriteToken(userId);
      if (!token.ok) {
        return makeJsonResponseNode(res, token.status || 500, { ok: false, message: "Appwrite token creation failed", details: token.text || token.body });
      }

      // Fire welcome email non-blocking
      fireWelcomeAsync(email, name, userId);

      return makeJsonResponseNode(res, 200, {
        ok: true,
        userId,
        secret: token.body.secret,
        expire: token.body.expire || TOKEN_EXPIRE_SECONDS,
      });
    } catch (err) {
      console.error("api/register error", err);
      return makeJsonResponseNode(res, 500, { ok: false, message: "server error", error: String(err) });
    }
  }

  // Edge runtime: reqOrReq is a Request, we must return a Response
  const req = reqOrReq;
  try {
    if (req.method !== "POST") return makeJsonResponseEdge(405, { ok: false, message: "Method not allowed" });

    const body = await parseBody(req);
    const { name = "", email = "", password = "" } = body || {};

    if (!email || !password) return makeJsonResponseEdge(400, { ok: false, message: "email and password required" });

    if (!APPWRITE_ENDPOINT || !APPWRITE_PROJECT || !APPWRITE_API_KEY) {
      return makeJsonResponseEdge(500, { ok: false, message: "Server not configured (missing APPWRITE envs)" });
    }

    // Basic validation
    if (typeof email !== "string" || !email.includes("@")) {
      return makeJsonResponseEdge(400, { ok: false, message: "Invalid email" });
    }

    // Create user
    const created = await createAppwriteUser(email, password, name);
    if (!created.ok) {
      return makeJsonResponseEdge(created.status || 500, { ok: false, message: "Appwrite create user failed", details: created.text || created.body });
    }
    const userId = created.body.$id || created.body.id || created.body.userId || created.body["$id"];
    if (!userId) return makeJsonResponseEdge(500, { ok: false, message: "Appwrite did not return user id", details: created.body });

    // Create token
    const token = await createAppwriteToken(userId);
    if (!token.ok) {
      return makeJsonResponseEdge(token.status || 500, { ok: false, message: "Appwrite token creation failed", details: token.text || token.body });
    }

    // Fire welcome email non-blocking
    fireWelcomeAsync(email, name, userId);

    return makeJsonResponseEdge(200, {
      ok: true,
      userId,
      secret: token.body.secret,
      expire: token.body.expire || TOKEN_EXPIRE_SECONDS,
    });
  } catch (err) {
    console.error("api/register error", err);
    return makeJsonResponseEdge(500, { ok: false, message: "server error", error: String(err) });
  }
}
