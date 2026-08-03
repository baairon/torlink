import { describe, it, expect } from "vitest";
import { isAuthorized, hostHeaderOk } from "./auth";

describe("isAuthorized", () => {
  it("is open when no token is configured", () => {
    expect(isAuthorized(null, undefined)).toBe(true);
  });
  it("accepts a matching bearer token or raw token", () => {
    expect(isAuthorized("s3cret", "Bearer s3cret")).toBe(true);
    expect(isAuthorized("s3cret", "s3cret")).toBe(true);
  });
  it("rejects a missing, wrong, or different-length token", () => {
    expect(isAuthorized("s3cret", undefined)).toBe(false);
    expect(isAuthorized("s3cret", "Bearer nope")).toBe(false);
    expect(isAuthorized("s3cret", "s3cret-plus-suffix")).toBe(false);
    expect(isAuthorized("s3cret", "s3cre")).toBe(false);
  });
});

describe("hostHeaderOk", () => {
  it("accepts loopback hosts with or without a port", () => {
    expect(hostHeaderOk("127.0.0.1")).toBe(true);
    expect(hostHeaderOk("127.0.0.1:9161")).toBe(true);
    expect(hostHeaderOk("localhost:9160")).toBe(true);
    expect(hostHeaderOk("LOCALHOST")).toBe(true);
    expect(hostHeaderOk("[::1]:9161")).toBe(true);
    expect(hostHeaderOk("[::1]")).toBe(true);
  });
  it("rejects external names and addresses (DNS rebinding)", () => {
    expect(hostHeaderOk("attacker.example")).toBe(false);
    expect(hostHeaderOk("attacker.example:9161")).toBe(false);
    expect(hostHeaderOk("192.168.1.20:9161")).toBe(false);
    expect(hostHeaderOk("localhost.attacker.example")).toBe(false);
  });
  it("rejects a missing or malformed header", () => {
    expect(hostHeaderOk(undefined)).toBe(false);
    expect(hostHeaderOk("")).toBe(false);
    expect(hostHeaderOk("[::1")).toBe(false);
  });
});
