const Anthropic = require("@anthropic-ai/sdk");
const { getSupportStore } = require("./lib/blobs");
const { buildSystemPrompt } = require("./lib/knowledge");
const { isValidSessionId } = require("./lib/validate");

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

const MODEL = "claude-opus-5";
const MAX_MESSAGE_CHARS = 800;
const MAX_STORED_MESSAGES = 30; // trimmed (oldest first) once exceeded
const MAX_HISTORY_TO_MODEL = 12; // last N messages sent as context per turn
const MAX_TURNS_BEFORE_FORCED_ESCALATE = 20; // 20 user+assistant pairs = 40 stored messages

const FALLBACK_REPLY = "I'm having trouble reaching our assistant right now — let me connect you with our team instead.";

function extractJson(text) {
  let t = text.trim();
  // Strip markdown code fences if the model added them despite instructions
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) t = fence[1].trim();
  try {
    const parsed = JSON.parse(t);
    if (typeof parsed.reply === "string") {
      return { reply: parsed.reply, escalate: !!parsed.escalate };
    }
  } catch {
    // fall through
  }
  return { reply: t, escalate: false };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: "Chat is not configured on the server" });

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const { session_id, message } = payload;
  if (!isValidSessionId(session_id)) {
    return json(400, { error: "Invalid session_id" });
  }
  const trimmedMessage = String(message || "").trim().slice(0, MAX_MESSAGE_CHARS);
  if (!trimmedMessage) return json(400, { error: "Empty message" });

  const store = getSupportStore();
  const now = new Date().toISOString();
  let doc = await store.get(session_id, { type: "json" });
  if (!doc) {
    doc = { session_id, messages: [], escalated: false, status: "open", created_at: now, updated_at: now };
  }

  doc.messages.push({ role: "user", content: trimmedMessage, ts: now });

  // Hard ceiling — stop calling the paid API once a conversation runs long;
  // hand off to a human instead of letting cost grow unbounded.
  if (doc.messages.length > MAX_TURNS_BEFORE_FORCED_ESCALATE * 2) {
    doc.escalated = true;
    doc.status = "escalated";
    doc.updated_at = now;
    await store.setJSON(session_id, doc);
    return json(200, {
      reply: "This has been a long conversation — let's continue over WhatsApp so our team can help directly.",
      escalate: true
    });
  }

  const history = doc.messages
    .slice(-MAX_HISTORY_TO_MODEL)
    .map(m => ({ role: m.role, content: m.content }));

  let result;
  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: buildSystemPrompt(),
      output_config: { effort: "low" },
      messages: history
    });
    const textBlock = response.content.find(b => b.type === "text");
    result = extractJson(textBlock ? textBlock.text : "");
  } catch (e) {
    result = { reply: FALLBACK_REPLY, escalate: true };
  }

  doc.messages.push({ role: "assistant", content: result.reply, ts: new Date().toISOString() });
  if (doc.messages.length > MAX_STORED_MESSAGES) {
    doc.messages = doc.messages.slice(-MAX_STORED_MESSAGES);
  }
  if (result.escalate) {
    doc.escalated = true;
    doc.status = "escalated";
  }
  doc.updated_at = new Date().toISOString();
  await store.setJSON(session_id, doc);

  return json(200, { reply: result.reply, escalate: !!result.escalate });
};
