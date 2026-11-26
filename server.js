
import express from "express";
import dotenv from "dotenv";
import crypto from "node:crypto";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

let botEnabled = true;
const processed = new Set();

app.get("/", (req, res) => {
  res.send("WhatsApp AI Reply Server is running!");
});

// Meta webhook verification
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (
    mode === "subscribe" &&
    token === process.env.WA_VERIFY_TOKEN
  ) {
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

// Generate AI response using Gemini
async function askAI(message) {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [{ text:
          "তুমি একজন সহায়ক কাস্টমার সার্ভিস অ্যাসিস্ট্যান্ট। বাংলায় সংক্ষিপ্ত উত্তর দাও। গ্রাহকের প্রশ্ন: " + message
        }]
      }]
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error("Gemini API error");
  }

  return data.candidates[0].content.parts
    .map(p => p.text || "")
    .join("");
}

// Send WhatsApp message
async function sendReply(to, message) {
  const version = process.env.WA_API_VERSION || "v26.0";

  const url =
    `https://graph.facebook.com/${version}/${process.env.WA_PHONE_NUMBER_ID}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: message }
    })
  });

  if (!response.ok) {
    throw new Error("WhatsApp API error");
  }
}

// Receive incoming messages
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  const messages =
    req.body.entry?.flatMap(e =>
      e.changes?.flatMap(c =>
        c.value?.messages || []
      ) || []
    ) || [];

  for (const msg of messages) {
    if (!msg.id || !msg.from || !msg.text?.body) continue;
    if (processed.has(msg.id)) continue;

    processed.add(msg.id);

    if (!botEnabled) continue;

    try {
      const answer = await askAI(msg.text.body);
      await sendReply(msg.from, answer);
      console.log("Reply sent to:", msg.from);
    } catch (error) {
      console.error(error.message);
    }
  }
});

// Dashboard control
app.post("/api/bot", (req, res) => {
  botEnabled = Boolean(req.body.enabled);
  res.json({ botEnabled });
});

app.get("/api/status", (req, res) => {
  res.json({
    server: "online",
    botEnabled
  });
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
