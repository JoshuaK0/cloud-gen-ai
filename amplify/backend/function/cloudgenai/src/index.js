import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import OpenAI from "openai";

const sm = new SecretsManagerClient({ region: "eu-west-2" });
let openai;

async function getOpenAI() {
  if (!openai) {
    const cmd = new GetSecretValueCommand({
      SecretId: "/chatgpt/openai"  // your secret’s name or ARN
    });
    const resp = await sm.send(cmd);
    // SecretString is a JSON blob or plain text; adjust parsing if you stored JSON
    const secret = JSON.parse(resp.SecretString);
    openai = new OpenAI({ apiKey: secret.OPENAI_API_KEY });
  }
  return openai;
}

export const handler = async (event) => {
  try {
    const { message } = JSON.parse(event.body);
    const ai = await getOpenAI();
    const completion = await ai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: message }]
    });
    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ reply: completion.choices[0].message.content })
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: err.message })
    };
  }
};
