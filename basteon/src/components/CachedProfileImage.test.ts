import { describe, expect, it } from "vitest";
import { profileImageCacheKey } from "./profileImageCache";

describe("profile image cache keys", () => {
  it("shares a cached image between signed URLs while keeping the object path", () => {
    const first = "https://storage.example/storage/v1/object/sign/kiki-profile-images/user/avatar.webp?token=old";
    const renewed = "https://storage.example/storage/v1/object/sign/kiki-profile-images/user/avatar.webp?token=new";
    expect(profileImageCacheKey(first)).toBe(profileImageCacheKey(renewed));
    expect(profileImageCacheKey(first)).toContain("/user/avatar.webp");
  });
});
