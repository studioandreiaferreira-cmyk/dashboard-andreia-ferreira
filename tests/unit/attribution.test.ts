import { describe, expect, it } from "vitest";
import { attributeMessage } from "../../src/lib/attribution";

describe("attributeMessage", () => {
  it("uses the message sender first", () => {
    expect(attributeMessage({ type: "USER", user_id: "u1" }, { user_id: "u2" }, "u3")).toEqual({ attributed_user_id: "u1", attribution: "direct" });
  });
  it("falls back to the chat attendant", () => {
    expect(attributeMessage({ type: "USER", user_id: null }, { user_id: "u2" }, "u3")).toEqual({ attributed_user_id: "u2", attribution: "chat" });
  });
  it("falls back to the open deal owner", () => {
    expect(attributeMessage({ type: "USER", user_id: null }, { user_id: null }, "u3")).toEqual({ attributed_user_id: "u3", attribution: "deal" });
  });
  it("ends with no seller", () => {
    expect(attributeMessage({ type: "USER", user_id: null }, { user_id: null }, null)).toEqual({ attributed_user_id: null, attribution: "none" });
  });
  it("never attributes lead or system messages", () => {
    expect(attributeMessage({ type: "CUSTOMER", user_id: "u1" }, { user_id: "u2" }, "u3")).toEqual({ attributed_user_id: null, attribution: "none" });
    expect(attributeMessage({ type: "EVENT", user_id: "u1" }, { user_id: "u2" }, "u3")).toEqual({ attributed_user_id: null, attribution: "none" });
  });
});
