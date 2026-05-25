import { execFile as execFileCb } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

export interface GitRef {
  owner: string;
  repo: string;
  ref?: string;
  subpath: string;
}

const DEFAULT_SUBPATH = "agent-docs";

// Host of the parsed ref. Kept out of the public GitRef shape so consumers
// (and `toEqual` in tests) don't see it, but available to `cloneUrlFor`.
const hostByRef = new WeakMap<GitRef, string>();

const PATTERNS = [
  {
    host: "github.com",
    re: /^git@github\.com:(?<owner>[^/]+)\/(?<repo>[^/@#]+?)(?:\.git)?(?:@(?<ref>.+))?$/,
  },
  {
    host: "github.com",
    re: /^https:\/\/github\.com\/(?<owner>[^/]+)\/(?<repo>[^/@#]+?)(?:\.git)?(?:@(?<ref>.+))?$/,
  },
  {
    host: "bitbucket.org",
    re: /^git@bitbucket\.org:(?<owner>[^/]+)\/(?<repo>[^/@#]+?)(?:\.git)?(?:@(?<ref>.+))?$/,
  },
  {
    host: "bitbucket.org",
    re: /^https:\/\/bitbucket\.org\/(?<owner>[^/]+)\/(?<repo>[^/@#]+?)(?:\.git)?(?:@(?<ref>.+))?$/,
  },
  // bitbucket:owner/repo must be checked before the generic shorthand below.
  {
    host: "bitbucket.org",
    re: /^bitbucket:(?<owner>[^/\s:]+)\/(?<repo>[^/@#\s]+?)(?:@(?<ref>[^\s]+))?$/,
  },
  {
    host: "github.com",
    re: /^(?:github:)?(?<owner>[^/\s]+)\/(?<repo>[^/@#\s]+?)(?:@(?<ref>[^\s]+))?$/,
  },
] as const;

export function parseGitRef(input: string): GitRef | null {
  if (!input) return null;
  if (input.startsWith("/") || input.startsWith("./") || input.startsWith("../")) {
    return null;
  }

  for (const { re, host } of PATTERNS) {
    const match = re.exec(input);
    if (!match?.groups) continue;
    const { owner, repo, ref } = match.groups as {
      owner: string;
      repo: string;
      ref?: string;
    };
    const out: GitRef = { owner, repo, ref, subpath: DEFAULT_SUBPATH };
    hostByRef.set(out, host);
    return out;
  }
  return null;
}

export const looksLikeGitRef = (input: string): boolean =>
  parseGitRef(input) !== null;

const cloneUrlFor = (ref: GitRef): string =>
  `git@${hostByRef.get(ref) ?? "github.com"}:${ref.owner}/${ref.repo}.git`;

export async function ensureRepoCached(
  ref: GitRef,
  cacheDir: string,
): Promise<string> {
  try {
    await execFile("git", ["--version"]);
  } catch {
    throw new Error("git is not installed or not in PATH.");
  }

  const repoDir = path.join(cacheDir, ref.repo);

  if (existsSync(path.join(repoDir, ".git"))) {
    try {
      const fetchArgs = ["fetch", "--depth", "1", "origin"];
      if (ref.ref) fetchArgs.push(ref.ref);
      await execFile("git", fetchArgs, { cwd: repoDir, timeout: 60_000 });
      const resetTarget = ref.ref ? `origin/${ref.ref}` : "FETCH_HEAD";
      await execFile("git", ["reset", "--hard", resetTarget], {
        cwd: repoDir,
        timeout: 15_000,
      });
      return repoDir;
    } catch {
      rmSync(repoDir, { recursive: true, force: true });
    }
  }

  mkdirSync(cacheDir, { recursive: true });

  const cloneArgs = [
    "clone",
    "--depth",
    "1",
    ...(ref.ref ? ["--branch", ref.ref] : []),
    cloneUrlFor(ref),
    repoDir,
  ];

  try {
    await execFile("git", cloneArgs, { timeout: 120_000 });
  } catch (err) {
    rmSync(repoDir, { recursive: true, force: true });
    throw err;
  }

  return repoDir;
}
