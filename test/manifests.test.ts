import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { detectManifests, type ProjectManifest } from "../src/manifests.js";

describe("detectManifests", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "context-manifests-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** Writes the given files and detects manifests over their basenames. */
  const detect = async (
    files: Record<string, string>,
  ): Promise<ProjectManifest[]> => {
    for (const [name, body] of Object.entries(files))
      await writeFile(path.join(dir, name), body);
    return detectManifests(dir, Object.keys(files));
  };

  const byEcosystem = (ms: ProjectManifest[], eco: string): ProjectManifest =>
    ms.find((m) => m.ecosystem === eco)!;

  it("parses package.json (node) — name, scripts, deps, entry points, runner", async () => {
    const [m] = await detect({
      "package.json": JSON.stringify({
        name: "demo",
        version: "1.2.3",
        description: "A demo.",
        main: "dist/index.js",
        bin: { "demo-cli": "dist/cli.js" },
        scripts: { build: "tsc", test: "vitest run" },
        dependencies: { zod: "^3" },
        devDependencies: { vitest: "^2" },
      }),
    });
    expect(m?.ecosystem).toBe("node");
    expect(m?.name).toBe("demo");
    expect(m?.version).toBe("1.2.3");
    expect(m?.description).toBe("A demo.");
    expect(m?.entryPoints.map((e) => e.path)).toEqual(["dist/index.js", "dist/cli.js"]);
    expect(m?.scripts).toContainEqual({ name: "build", command: "tsc" });
    expect(m?.runtimeDeps).toEqual(["zod"]);
    expect(m?.devDeps).toEqual(["vitest"]);
    expect(m?.testRunner).toBe("vitest");
  });

  it("parses pyproject.toml (PEP 621)", async () => {
    const [m] = await detect({
      "pyproject.toml": [
        "[project]",
        'name = "mypkg"',
        'version = "0.4.0"',
        'description = "Py pkg."',
        'dependencies = ["requests>=2.0", "click"]',
        "",
        "[project.optional-dependencies]",
        'test = ["pytest>=7"]',
        "",
        "[project.scripts]",
        'mycli = "mypkg.cli:main"',
      ].join("\n"),
    });
    expect(m?.ecosystem).toBe("python");
    expect(m?.name).toBe("mypkg");
    expect(m?.version).toBe("0.4.0");
    expect(m?.runtimeDeps).toEqual(["requests", "click"]);
    expect(m?.devDeps).toEqual(["pytest"]);
    expect(m?.testRunner).toBe("pytest");
    expect(m?.scripts).toContainEqual({ name: "mycli", command: "mypkg.cli:main" });
    expect(m?.buildCommands).toContainEqual({ label: "test", command: "pytest" });
  });

  it("parses pyproject.toml (Poetry)", async () => {
    const [m] = await detect({
      "pyproject.toml": [
        "[tool.poetry]",
        'name = "poetrypkg"',
        'version = "9.9.9"',
        'description = "Poetry pkg."',
        "",
        "[tool.poetry.dependencies]",
        'python = "^3.11"',
        'httpx = "^0.27"',
        "",
        "[tool.poetry.group.dev.dependencies]",
        'pytest = "^8"',
      ].join("\n"),
    });
    expect(m?.name).toBe("poetrypkg");
    expect(m?.runtimeDeps).toEqual(["httpx"]); // python excluded
    expect(m?.devDeps).toEqual(["pytest"]);
    expect(m?.testRunner).toBe("pytest");
  });

  it("parses Cargo.toml (rust) with [[bin]] entry points", async () => {
    const [m] = await detect({
      "Cargo.toml": [
        "[package]",
        'name = "crate"',
        'version = "0.1.0"',
        'description = "A crate."',
        "",
        "[dependencies]",
        'serde = "1"',
        "",
        "[dev-dependencies]",
        'criterion = "0.5"',
        "",
        "[[bin]]",
        'name = "cli"',
        'path = "src/bin/cli.rs"',
      ].join("\n"),
    });
    expect(m?.ecosystem).toBe("rust");
    expect(m?.name).toBe("crate");
    expect(m?.runtimeDeps).toEqual(["serde"]);
    expect(m?.devDeps).toEqual(["criterion"]);
    expect(m?.entryPoints.map((e) => e.path)).toEqual(["src/bin/cli.rs"]);
    expect(m?.buildCommands).toContainEqual({ label: "build", command: "cargo build" });
  });

  it("parses go.mod (go) — module name and require block", async () => {
    const [m] = await detect({
      "go.mod": [
        "module github.com/acme/widget",
        "",
        "go 1.22",
        "",
        "require (",
        "\tgithub.com/spf13/cobra v1.8.0",
        "\tgithub.com/stretchr/testify v1.9.0",
        ")",
        "",
        "require github.com/pkg/errors v0.9.1",
      ].join("\n"),
    });
    expect(m?.ecosystem).toBe("go");
    expect(m?.name).toBe("widget");
    expect(m?.runtimeDeps).toEqual([
      "github.com/spf13/cobra",
      "github.com/stretchr/testify",
      "github.com/pkg/errors",
    ]);
    expect(m?.buildCommands).toContainEqual({ label: "test", command: "go test ./..." });
  });

  it("parses composer.json (php)", async () => {
    const [m] = await detect({
      "composer.json": JSON.stringify({
        name: "acme/app",
        description: "PHP app.",
        require: { php: ">=8.1", "monolog/monolog": "^3" },
        "require-dev": { "phpunit/phpunit": "^11" },
        bin: ["bin/console"],
        scripts: { test: ["phpunit"] },
      }),
    });
    expect(m?.ecosystem).toBe("php");
    expect(m?.name).toBe("acme/app");
    expect(m?.runtimeDeps).toEqual(["monolog/monolog"]); // php excluded
    expect(m?.devDeps).toEqual(["phpunit/phpunit"]);
    expect(m?.testRunner).toBe("phpunit");
    expect(m?.entryPoints.map((e) => e.path)).toEqual(["bin/console"]);
    expect(m?.scripts).toContainEqual({ name: "test", command: "phpunit" });
  });

  it("parses setup.cfg (python INI) with multiline install_requires", async () => {
    const [m] = await detect({
      "setup.cfg": [
        "[metadata]",
        "name = cfgpkg",
        "version = 2.0",
        "description = Cfg pkg.",
        "",
        "[options]",
        "install_requires =",
        "    flask>=2",
        "    pytest",
      ].join("\n"),
    });
    expect(m?.ecosystem).toBe("python");
    expect(m?.name).toBe("cfgpkg");
    expect(m?.version).toBe("2.0");
    expect(m?.runtimeDeps).toEqual(["flask", "pytest"]);
    expect(m?.testRunner).toBe("pytest");
  });

  it("parses setup.py (python regex)", async () => {
    const [m] = await detect({
      "setup.py": [
        "from setuptools import setup",
        "setup(",
        '    name="legacy",',
        '    version="1.0",',
        '    description="Legacy pkg.",',
        '    install_requires=["numpy", "pandas>=1.0"],',
        ")",
      ].join("\n"),
    });
    expect(m?.name).toBe("legacy");
    expect(m?.runtimeDeps).toEqual(["numpy", "pandas"]);
  });

  it("parses requirements.txt (python)", async () => {
    const [m] = await detect({
      "requirements.txt": "# deps\nflask==2.3.0\nrequests\n-r other.txt\n",
    });
    expect(m?.ecosystem).toBe("python");
    expect(m?.runtimeDeps).toEqual(["flask", "requests"]);
  });

  it("parses pom.xml (java) — project name and dependencies, test scope", async () => {
    const [m] = await detect({
      "pom.xml": [
        "<project>",
        "  <artifactId>my-service</artifactId>",
        "  <version>3.1.0</version>",
        "  <description>Maven service.</description>",
        "  <dependencies>",
        "    <dependency><groupId>com.google.guava</groupId><artifactId>guava</artifactId></dependency>",
        "    <dependency><groupId>junit</groupId><artifactId>junit</artifactId><scope>test</scope></dependency>",
        "  </dependencies>",
        "</project>",
      ].join("\n"),
    });
    expect(m?.ecosystem).toBe("java");
    expect(m?.name).toBe("my-service");
    expect(m?.version).toBe("3.1.0");
    expect(m?.runtimeDeps).toEqual(["guava"]);
    expect(m?.devDeps).toEqual(["junit"]);
  });

  it("parses *.csproj (dotnet)", async () => {
    const [m] = await detect({
      "App.csproj": [
        "<Project>",
        "  <PropertyGroup>",
        "    <AssemblyName>MyApp</AssemblyName>",
        "    <Version>5.0.0</Version>",
        "    <Description>.NET app.</Description>",
        "  </PropertyGroup>",
        "  <ItemGroup>",
        '    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />',
        "  </ItemGroup>",
        "</Project>",
      ].join("\n"),
    });
    expect(m?.ecosystem).toBe("dotnet");
    expect(m?.name).toBe("MyApp");
    expect(m?.version).toBe("5.0.0");
    expect(m?.runtimeDeps).toEqual(["Newtonsoft.Json"]);
  });

  it("parses Gemfile and *.gemspec (ruby)", async () => {
    const ms = await detect({
      Gemfile: [
        'source "https://rubygems.org"',
        'gem "rails"',
        "group :test, :development do",
        '  gem "rspec"',
        "end",
      ].join("\n"),
      "thing.gemspec": [
        "Gem::Specification.new do |spec|",
        '  spec.name = "thing"',
        '  spec.version = "0.2.0"',
        '  spec.summary = "A thing."',
        '  spec.add_development_dependency "rspec"',
        "end",
      ].join("\n"),
    });
    const gemfile = ms.find((m) => m.manifestFile === "Gemfile")!;
    expect(gemfile.ecosystem).toBe("ruby");
    expect(gemfile.runtimeDeps).toEqual(["rails"]);
    expect(gemfile.devDeps).toEqual(["rspec"]);

    const gemspec = ms.find((m) => m.manifestFile === "thing.gemspec")!;
    expect(gemspec.name).toBe("thing");
    expect(gemspec.description).toBe("A thing.");
    expect(gemspec.devDeps).toEqual(["rspec"]);
  });

  it("parses build.gradle (java) dependency lines", async () => {
    const [m] = await detect({
      "build.gradle": [
        "dependencies {",
        "    implementation 'org.apache.commons:commons-lang3:3.14.0'",
        '    testImplementation "org.junit.jupiter:junit-jupiter:5.10.0"',
        "}",
      ].join("\n"),
    });
    expect(m?.ecosystem).toBe("java");
    expect(m?.runtimeDeps).toEqual(["commons-lang3"]);
    expect(m?.devDeps).toEqual(["junit-jupiter"]);
  });

  it("detects and merges multiple manifests, sorted by ecosystem priority", async () => {
    const ms = await detect({
      "package.json": JSON.stringify({ name: "front", dependencies: { react: "^18" } }),
      "pyproject.toml": '[project]\nname = "back"\ndependencies = ["fastapi"]\n',
    });
    expect(ms.map((m) => m.ecosystem)).toEqual(["node", "python"]); // node before python
    expect(ms.map((m) => m.name)).toEqual(["front", "back"]);
  });

  it("returns nothing for a repo with no recognized manifest", async () => {
    const ms = await detect({ "README.md": "# Hi\n", "main.go": "package main\n" });
    expect(ms).toEqual([]);
  });

  it("ignores non-root manifests", async () => {
    // A nested package.json must not be picked up (root-level only for now).
    const ms = await detectManifests(dir, ["sub/package.json"]);
    expect(ms).toEqual([]);
  });
});
