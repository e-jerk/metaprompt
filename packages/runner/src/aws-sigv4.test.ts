import { describe, expect, it } from "bun:test";
import { signAwsRequest } from "./aws-sigv4.js";

describe("sigv4", () => {
  it("is stable for a fixed timestamp and empty body", () => {
    const headers = signAwsRequest({
      method: "POST",
      url: new URL(
        "https://bedrock-agentcore.us-east-1.amazonaws.com/harnesses/invoke?harnessArn=arn:aws:bedrock-agentcore:us-east-1:1:harness/demo-abcdefghij",
      ),
      region: "us-east-1",
      service: "bedrock-agentcore",
      credentials: { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" },
      headers: { "content-type": "application/json" },
      body: "{}",
      timestamp: new Date("2015-08-30T12:36:00.000Z"),
    });
    expect(headers["x-amz-date"]).toBe("20150830T123600Z");
    expect(headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20150830\/us-east-1\/bedrock-agentcore\/aws4_request/);
    expect(headers.authorization).toContain("SignedHeaders=");
    expect(headers.authorization).toContain("Signature=");
    expect(headers["x-amz-content-sha256"]).toHaveLength(64);
  });
});
