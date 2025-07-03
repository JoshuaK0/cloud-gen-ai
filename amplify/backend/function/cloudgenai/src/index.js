// index.js

const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");

// ── CONFIG ─────────────────────────────────────────────────────────────────────
const REGION           = "eu-north-1";
const OPENAI_SECRET_ID = "/cloudgenai/openai-api-key";
const NOVA_PROFILE_ARN = "arn:aws:bedrock:eu-north-1:900808296174:inference-profile/eu.amazon.nova-micro-v1:0";

// ── CLIENTS ────────────────────────────────────────────────────────────────────
const sm      = new SecretsManagerClient({ region: REGION });
const bedrock = new BedrockRuntimeClient({ region: REGION });

// ── CACHE OPENAI KEY ───────────────────────────────────────────────────────────
let cachedOpenAIKey = null;
async function getOpenAIKey() {
  if (cachedOpenAIKey) return cachedOpenAIKey;
  const resp   = await sm.send(new GetSecretValueCommand({ SecretId: OPENAI_SECRET_ID }));
  const secret = JSON.parse(resp.SecretString);
  cachedOpenAIKey = secret.OPENAI_API_KEY;
  return cachedOpenAIKey;
}

// ── HANDLER ────────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    let reply;

    // — OpenAI path —
    if (body.openai) {
      const key = await getOpenAIKey();
      const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${key}`
        },
        body: JSON.stringify({
          model:    "gpt-4o-mini",
          messages: [{ role: "user", content: body.openai }]
        })
      });
      const data = await openaiRes.json();
      if (data.error?.code === "insufficient_quota") {
        return {
          statusCode: 402,
          headers:    { "Access-Control-Allow-Origin": "*" },
          body:       JSON.stringify({ error: "Your billing quota has been exceeded." })
        };
      }
      if (!openaiRes.ok) throw new Error(data.error?.message || "OpenAI API error");
      reply = data.choices[0].message.content;
    }

    // — Bedrock Nova-Micro via inference profile —
    else if (body.bedrock) {
      const payload = {
        inferenceConfig: { max_new_tokens: 1000 },
        messages: [
          { role: "user", content: [{ text: body.bedrock }] }
        ]
      };

      const cmd = new InvokeModelCommand({
        modelId:     NOVA_PROFILE_ARN,      // inference-profile ARN in modelId
        contentType: "application/json",
        accept:      "application/json",
        body:        JSON.stringify(payload)
      });

      const resp = await bedrock.send(cmd);
      const text = await resp.body.transformToString();
      const data = JSON.parse(text);

      // Extract from data.output.message.content[0].text
      const assistantMsg = data.output?.message?.content?.[0]?.text;
      if (!assistantMsg) {
        console.error("Unexpected Nova-Micro payload:", JSON.stringify(data));
        throw new Error("Invalid Nova-Micro response schema");
      }
      reply = assistantMsg;
    }

    // — No prompt provided —
    else {
      return {
        statusCode: 400,
        headers:    { "Access-Control-Allow-Origin": "*" },
        body:       JSON.stringify({ error: "No prompt provided; use either ‘openai’ or ‘bedrock’." })
      };
    }

    // — Success —
    return {
      statusCode: 200,
      headers:    { "Access-Control-Allow-Origin": "*" },
      body:       JSON.stringify({ reply })
    };

  } catch (err) {
    console.error("Handler error:", err);
    return {
      statusCode: 500,
      headers:    { "Access-Control-Allow-Origin": "*" },
      body:       JSON.stringify({ error: err.message })
    };
  }
};
