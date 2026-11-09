import { describe, expect, it } from "vitest";
import { mapMessages } from "../../src/chat/viewer";
import type { ClintMessage } from "../../src/clint/types";
import { fixtures } from "../helpers/clintMock";

const users = new Map([
  ["u1", "Carina Pimentel"],
  ["u2", "Charlynne Macedo"],
]);
const ch1 = fixtures.messages.ch1.data as unknown as ClintMessage[];
const ch3 = fixtures.messages.ch3.data as unknown as ClintMessage[];

describe("mapMessages", () => {
  it("maps sides, seller names, media and folds reactions", () => {
    const out = mapMessages(ch1, users, "u2");
    const byId = Object.fromEntries(out.map((m) => [m.id, m]));
    expect(out.map((m) => m.id)).toEqual(["m5", "m4", "m3", "m2", "m1"]); // reaction m6 removed
    expect(byId.m1).toMatchObject({ side: "seller", seller_name: "Carina Pimentel", text: "Oi Maria, tudo bem?" });
    expect(byId.m2).toMatchObject({ side: "seller", seller_name: "Charlynne Macedo", media: { seconds: 20.112 }, reactions: ["🙏"] });
    expect(byId.m3).toMatchObject({ side: "lead", seller_name: null });
    expect(byId.m4.media).toEqual({ url: "https://file.clint.digital/x/img.jpeg", name: "foto.jpeg", seconds: null });
    expect(byId.m5).toMatchObject({ side: "system", text: "Conversa transferida" });
  });

  it('falls back to "Vendedor" without sender or chat attendant', () => {
    const out = mapMessages(ch3, users, null);
    expect(out.find((m) => m.id === "p0")?.seller_name).toBe("Vendedor");
  });
});
