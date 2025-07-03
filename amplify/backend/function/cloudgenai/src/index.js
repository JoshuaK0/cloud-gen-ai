// index.js

const { SecretsManagerClient, GetSecretValueCommand } =
  require("@aws-sdk/client-secrets-manager");
const { BedrockRuntimeClient, InvokeModelCommand } =
  require("@aws-sdk/client-bedrock-runtime"); // AWS SDK v3

// Region
const REGION = "eu-north-1";

// Secrets Manager client for OpenAI key
const sm = new SecretsManagerClient({ region: REGION });
let cachedOpenAIKey = null;
async function getOpenAIKey() {
  if (cachedOpenAIKey) return cachedOpenAIKey;
  const resp = await sm.send(
    new GetSecretValueCommand({ SecretId: "/cloudgenai/openai-api-key" })
  );
  const secret = JSON.parse(resp.SecretString);
  cachedOpenAIKey = secret.OPENAI_API_KEY;
  return cachedOpenAIKey;
}

// Bedrock client
const bedrock = new BedrockRuntimeClient({ region: REGION });

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    let reply;

    // 1) If openai prompt provided, call OpenAI REST API:
    if (body.openai) {
      const key = await getOpenAIKey();
      const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${key}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: body.openai }]
        })
      });
      const aiData = await aiRes.json();
      if (aiData.error?.code === "insufficient_quota") {
        return {
          statusCode: 402,
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({
            error: "Your billing quota has been exceeded. Please check your plan."
          })
        };
      }
      if (!aiRes.ok) {
        throw new Error(aiData.error?.message || "OpenAI API error");
      }
      reply = aiData.choices[0].message.content;
    }
    // 2) Else if bedrock prompt provided, invoke Bedrock:
    else if (body.bedrock) {
      const params = {
        modelId: "amazon.titan-embed-text-v2:0",  // or your chosen Bedrock model
        contentType: "application/json",
        accept:      "application/json",
        body: JSON.stringify({
          prompt: body.bedrock,
          max_tokens_to_sample: 512
        })
      };
      const cmd = new InvokeModelCommand(params);
      const resp = await bedrock.send(cmd);
      // resp.body is a stream; convert to string
      const stream = resp.body;
      const chunks = [];
      for await (let chunk of stream) chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
      const text = chunks.join("");
      // Bedrock responses often come back as { completion: "..." }
      const parsed = JSON.parse(text);
      reply = parsed.completion || parsed.choices?.[0]?.delta?.content || "";
    }
    // 3) Neither provided
    else {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "No prompt provided." })
      };
    }

    // 200 OK
    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ reply })
    };

  } catch (err) {
    console.error("Handler error:", err);
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: err.message })
    };
  }
};
