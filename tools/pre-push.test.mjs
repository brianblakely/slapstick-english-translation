import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const hook = fileURLToPath(new URL("../.githooks/pre-push", import.meta.url));
const patchFiles = [
  "dist/Slap Stick (Japan) [EN].bps",
  "dist/Slap Stick (Japan) [EN].ips",
  "dist/manifest.json",
];

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "slapstick-pre-push-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const repository = path.join(directory, "repository");
  const remote = path.join(directory, "remote.git");
  const binaries = path.join(directory, "bin");
  for (const name of [repository, binaries, path.join(repository, ".githooks"), path.join(repository, "translation/script"), path.join(repository, "dist")]) {
    mkdirSync(name, { recursive: true });
  }
  const env = { ...process.env, PATH: `${binaries}${path.delimiter}${process.env.PATH}` };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete env[name];
  function run(command, args, success = true) {
    const result = spawnSync(command, args, { cwd: repository, env, encoding: "utf8" });
    assert.equal(result.status === 0, success, `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
    return result;
  }
  const git = (...args) => run("git", args).stdout.trim();
  const write = (name, contents) => writeFileSync(path.join(repository, name), contents);
  copyFileSync(hook, path.join(repository, ".githooks/pre-push"));
  chmodSync(path.join(repository, ".githooks/pre-push"), 0o755);
  writeFileSync(path.join(binaries, "npm"), `#!/usr/bin/env node
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
if (process.argv.slice(2).join(" ") !== "run build") process.exit(2);
if (process.env.FAIL_BUILD === "1") process.exit(1);
const source = readFileSync("translation/script/console.json", "utf8");
mkdirSync("dist", { recursive: true });
for (const file of ${JSON.stringify(patchFiles)}) writeFileSync(file, source);
`, { mode: 0o755 });
  git("init", "--initial-branch=master");
  git("init", "--bare", "--initial-branch=master", remote);
  git("config", "user.name", "Hook test");
  git("config", "user.email", "hook-test@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "core.hooksPath", ".githooks");
  git("remote", "add", "origin", remote);
  write("translation/script/console.json", '[{"translation":"Home"}]\n');
  write("README.md", "Original documentation\n");
  run("npm", ["run", "build"]);
  git("add", ".");
  git("commit", "-m", "Initial source and patches");
  git("push", "origin", "master");
  const initial = git("rev-parse", "HEAD");
  return { directory, repository, remote, env, run, git, write, initial };
}

test("pre-push commits rebuilt patches and preserves unrelated staged and unstaged edits", (t) => {
  const f = fixture(t);
  f.write("translation/script/console.json", '[{"translation":"Main"}]\n');
  f.git("add", "translation/script/console.json");
  f.git("commit", "-m", "Update translation");
  const sourceCommit = f.git("rev-parse", "HEAD");
  f.write("README.md", "Staged documentation\n");
  f.git("add", "README.md");
  const staged = f.git("rev-parse", ":README.md");
  f.write("README.md", "Unstaged documentation\n");

  const firstPush = f.run("git", ["push", "origin", "master"], false);
  assert.match(firstPush.stderr, /Push again/);
  assert.equal(f.git("log", "-1", "--format=%s"), "Rebuild translation patches");
  assert.equal(f.git("rev-parse", "HEAD^"), sourceCommit);
  assert.deepEqual(f.git("-c", "core.quotePath=false", "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").split("\n").sort(), [...patchFiles].sort());
  assert.equal(f.git("rev-parse", ":README.md"), staged);
  assert.equal(readFileSync(path.join(f.repository, "README.md"), "utf8"), "Unstaged documentation\n");
  assert.equal(f.git("--git-dir", f.remote, "rev-parse", "master"), f.initial);

  const rebuilt = f.git("rev-parse", "HEAD");
  f.git("push", "origin", "HEAD:master");
  assert.equal(f.git("rev-parse", "HEAD"), rebuilt);
  assert.equal(f.git("--git-dir", f.remote, "rev-parse", "master"), rebuilt);
});

test("pre-push permits unchanged patches without creating a commit", (t) => {
  const f = fixture(t);
  f.write("README.md", "Documentation update\n");
  f.git("add", "README.md");
  f.git("commit", "-m", "Update documentation");
  const before = f.git("rev-parse", "HEAD");
  const result = f.run("git", ["push", "origin", "master"]);
  assert.match(result.stderr, /Patches are current/);
  assert.equal(f.git("rev-parse", "HEAD"), before);
  assert.equal(f.git("--git-dir", f.remote, "rev-parse", "master"), before);
});

test("pre-push rejects uncommitted build inputs and failed builds", (t) => {
  const f = fixture(t);
  f.write("README.md", "Documentation update\n");
  f.git("add", "README.md");
  f.git("commit", "-m", "Update documentation");
  const before = f.git("rev-parse", "HEAD");
  const source = readFileSync(path.join(f.repository, "translation/script/console.json"), "utf8");
  f.write("translation/script/console.json", "[]\n");
  assert.match(f.run("git", ["push", "origin", "master"], false).stderr, /Commit or stash/);
  f.git("add", "translation/script/console.json");
  assert.match(f.run("git", ["push", "origin", "master"], false).stderr, /Commit or stash/);
  f.write("translation/script/console.json", source);
  f.git("add", "translation/script/console.json");
  f.write("translation/script/new.json", "[]\n");
  assert.match(f.run("git", ["push", "origin", "master"], false).stderr, /Commit or stash/);
  rmSync(path.join(f.repository, "translation/script/new.json"));
  f.env.FAIL_BUILD = "1";
  f.run("git", ["push", "origin", "master"], false);
  assert.equal(f.git("rev-parse", "HEAD"), before);
  assert.equal(f.git("--git-dir", f.remote, "rev-parse", "master"), f.initial);
});

test("pre-push skips tags and deletions, and rejects builds for another branch", (t) => {
  const f = fixture(t);
  f.env.FAIL_BUILD = "1";
  f.git("tag", "test-tag");
  f.git("push", "origin", "test-tag");
  f.git("--git-dir", f.remote, "update-ref", "refs/heads/old", f.initial);
  f.git("push", "origin", "--delete", "old");
  f.git("branch", "other");
  assert.match(f.run("git", ["push", "origin", "other"], false).stderr, /Check out the branch/);
});
