import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(here, "..");
export const EXAMPLE_DOCS_DIR = path.join(
  here,
  "fixtures",
  "example-docs",
);
export const PROMPTS_DIR = path.join(REPO_ROOT, "prompts");
