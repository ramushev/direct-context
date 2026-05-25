import { describe, expect, it } from "vitest";
import { looksLikeGitRef, parseGitRef } from "../src/git.js";

describe("parseGitRef", () => {
  it("parses owner/repo shorthand", () => {
    const ref = parseGitRef("acme/api");
    expect(ref).toEqual({
      owner: "acme",
      repo: "api",
      ref: undefined,
      subpath: "agent-docs",
    });
  });

  it("parses owner/repo@branch shorthand", () => {
    const ref = parseGitRef("acme/api@feature-branch");
    expect(ref).toEqual({
      owner: "acme",
      repo: "api",
      ref: "feature-branch",
      subpath: "agent-docs",
    });
  });

  it("parses github: prefix", () => {
    const ref = parseGitRef("github:acme/api");
    expect(ref).toEqual({
      owner: "acme",
      repo: "api",
      ref: undefined,
      subpath: "agent-docs",
    });
  });

  it("parses github: prefix with ref", () => {
    const ref = parseGitRef("github:acme/api@v2.0");
    expect(ref).toEqual({
      owner: "acme",
      repo: "api",
      ref: "v2.0",
      subpath: "agent-docs",
    });
  });

  it("parses HTTPS URL", () => {
    const ref = parseGitRef("https://github.com/acme/api");
    expect(ref).toEqual({
      owner: "acme",
      repo: "api",
      ref: undefined,
      subpath: "agent-docs",
    });
  });

  it("parses HTTPS URL with .git suffix", () => {
    const ref = parseGitRef("https://github.com/acme/api.git");
    expect(ref).toEqual({
      owner: "acme",
      repo: "api",
      ref: undefined,
      subpath: "agent-docs",
    });
  });

  it("parses HTTPS URL with ref", () => {
    const ref = parseGitRef("https://github.com/acme/api@main");
    expect(ref).toEqual({
      owner: "acme",
      repo: "api",
      ref: "main",
      subpath: "agent-docs",
    });
  });

  it("parses SSH URL", () => {
    const ref = parseGitRef("git@github.com:acme/api.git");
    expect(ref).toEqual({
      owner: "acme",
      repo: "api",
      ref: undefined,
      subpath: "agent-docs",
    });
  });

  it("parses SSH URL with ref", () => {
    const ref = parseGitRef("git@github.com:acme/api.git@develop");
    expect(ref).toEqual({
      owner: "acme",
      repo: "api",
      ref: "develop",
      subpath: "agent-docs",
    });
  });

  it("handles repos with dots and underscores", () => {
    const ref = parseGitRef("my-org/my_repo.js");
    expect(ref).toEqual({
      owner: "my-org",
      repo: "my_repo.js",
      ref: undefined,
      subpath: "agent-docs",
    });
  });

  it("returns null for local paths", () => {
    expect(parseGitRef("/Users/me/repos/api")).toBeNull();
    expect(parseGitRef("./relative/path")).toBeNull();
    expect(parseGitRef("../parent/path")).toBeNull();
  });

  it("returns null for empty or garbage input", () => {
    expect(parseGitRef("")).toBeNull();
    expect(parseGitRef("just-a-word")).toBeNull();
  });
});

describe("looksLikeGitRef", () => {
  it("returns true for GitHub HTTPS URLs", () => {
    expect(looksLikeGitRef("https://github.com/acme/api")).toBe(true);
  });

  it("returns true for GitHub SSH URLs", () => {
    expect(looksLikeGitRef("git@github.com:acme/api.git")).toBe(true);
  });

  it("returns true for github: prefix", () => {
    expect(looksLikeGitRef("github:acme/api")).toBe(true);
  });

  it("returns true for owner/repo shorthand", () => {
    expect(looksLikeGitRef("acme/api")).toBe(true);
    expect(looksLikeGitRef("acme/api@main")).toBe(true);
  });

  it("returns false for absolute paths", () => {
    expect(looksLikeGitRef("/home/user/repo")).toBe(false);
    expect(looksLikeGitRef("/Users/me/code/api")).toBe(false);
  });

  it("returns false for relative paths", () => {
    expect(looksLikeGitRef("./my-repo")).toBe(false);
    expect(looksLikeGitRef("../my-repo")).toBe(false);
  });

  it("returns false for paths with multiple segments", () => {
    expect(looksLikeGitRef("some/deep/local/path")).toBe(false);
  });
});
