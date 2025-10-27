// api/register.js
// Works on both Vercel Node serverless and Edge runtimes.
// Creates an Appwrite user (with a generated safe userId) and a short-lived token.

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

// Pocket UUID v4 generator (works in all JS runtimes)
function generateUuidV4() {
  // If crypto.randomUUID is available (browser/edge/node), use it
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch (e) {
    // ignore
  }
  // Otherwise fallback to RFC4122 v4 generator (safe)
  // eslint-disable-next-line no-bitwise
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    // eslint-disable-next-line no-bitwise
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// universal body parser for Node/Edge
async function parseBody(req, res) {
  if (typeof req.json === "function") return await req.json();
  if (req.body) return req.body;
  return await new Promise((resolve) => {
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
    req.on("error", () => resolve({}));
  });
}

async function callAppwriteCreateUser(userId, email, password, name) {
  const url = `${APPWRITE_ENDPOINT}/v1/users`;
  const payload = { userId, email, password, name };
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Appwrite-Project": APPWRITE_PROJECT, "X-Appwrite-Key": APPWRITE_API_KEY },
    body: JSON.stringify(payload),
  });
  const text = await resp.text().catch(() => "");
  if (!resp.ok) return { ok: false, status: resp.status, text };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch (e) {
    return { ok: true, body: { $id: text } };
  }
}

async function callAppwriteCreateToken(userId) {
  const url = `${APPWRITE_ENDPOINT}/v1/users/${encodeURIComponent(userId)}/tokens`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Appwrite-Project": APPWRITE_PROJECT, "X-Appwrite-Key": APPWRITE_API_KEY },
    body: JSON.stringify({ expire: TOKEN_EXPIRE_SECONDS }),
  });
  const text = await resp.text().catch(() => "");
  if (!resp.ok) return { ok: false, status: resp.status, text };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch (e) {
    return { ok: true, body: { raw: text } };
  }
}

async function fireWelcome(email, name, userId) {
  if (!WELCOME_ENDPOINT) return;
  try {
    await fetch(WELCOME_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, name, userId }),
    });
  } catch (e) {
    // swallow
    console.warn("welcome send failed", e);
  }
}

export default async function handler(reqOrReq, maybeRes) {
  const isEdge = typeof maybeRes === "undefined";

  // Node serverless (req,res)
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

      // basic validation
      if (typeof email !== "string" || !email.includes("@")) {
        return makeJsonResponseNode(res, 400, { ok: false, message: "Invalid email" });
      }

      // generate safe user id
      const userId = generateUuidV4();

      // create user
      const created = await callAppwriteCreateUser(userId, email, password, name);
      if (!created.ok) {
        // forward Appwrite details for debugging
        return makeJsonResponseNode(res, created.status || 400, { ok: false, message: "Appwrite create user failed", details: created.text || created.body });
      }

      // create token
      const token = await callAppwriteCreateToken(userId);
      if (!token.ok) {
        return makeJsonResponseNode(res, token.status || 500, { ok: false, message: "Appwrite token creation failed", details: token.text || token.body });
      }

      // fire welcome async
      fireWelcome(email, name, userId);

      return makeJsonResponseNode(res, 200, { ok: true, userId, secret: token.body.secret, expire: token.body.expire || TOKEN_EXPIRE_SECONDS });
    } catch (err) {
      console.error("api/register error node:", err);
      return makeJsonResponseNode(res, 500, { ok: false, message: "server error", error: String(err) });
    }
  }

  // Edge runtime (Request -> Response)
  const req = reqOrReq;
  try {
    if (req.method !== "POST") return makeJsonResponseEdge(405, { ok: false, message: "Method not allowed" });

    const body = await parseBody(req);
    const { name = "", email = "", password = "" } = body || {};

    if (!email || !password) return makeJsonResponseEdge(400, { ok: false, message: "email and password required" });

    if (!APPWRITE_ENDPOINT || !APPWRITE_PROJECT || !APPWRITE_API_KEY) {
      return makeJsonResponseEdge(500, { ok: false, message: "Server not configured (missing APPWRITE envs)" });
    }

    if (typeof email !== "string" || !email.includes("@")) {
      return makeJsonResponseEdge(400, { ok: false, message: "Invalid email" });
    }

    const userId = generateUuidV4();
    const created = await callAppwriteCreateUser(userId, email, password, name);
    if (!created.ok) {
      return makeJsonResponseEdge(created.status || 400, { ok: false, message: "Appwrite create user failed", details: created.text || created.body });
    }
    const token = await callAppwriteCreateToken(userId);
    if (!token.ok) {
      return makeJsonResponseEdge(token.status || 500, { ok: false, message: "Appwrite token creation failed", details: token.text || token.body });
    }
    fireWelcome(email, name, userId);
    return makeJsonResponseEdge(200, { ok: true, userId, secret: token.body.secret, expire: token.body.expire || TOKEN_EXPIRE_SECONDS });
  } catch (err) {
    console.error("api/register error edge:", err);
    return makeJsonResponseEdge(500, { ok: false, message: "server error", error: String(err) });
  }
}
