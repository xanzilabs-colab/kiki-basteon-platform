import { describe, expect, it } from "vitest";
import { isExpiredAuthError } from "./authSession";

describe("expired authentication errors", () => {
  it("recognises expired JWT and PostgREST authentication errors", () => {
    expect(isExpiredAuthError({ message: "JWT expired" })).toBe(true);
    expect(isExpiredAuthError({ message: "The access token has expired" })).toBe(true);
    expect(isExpiredAuthError({ code: "PGRST301", message: "JWT verification failed" })).toBe(true);
  });

  it("does not classify unrelated request errors as expired sessions", () => {
    expect(isExpiredAuthError({ message: "Network error" })).toBe(false);
    expect(isExpiredAuthError(null)).toBe(false);
  });
});
