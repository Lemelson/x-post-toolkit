import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const contentSource = await readFile(new URL("../content.js", import.meta.url), "utf8");

test("captures extension action clicks before X player controls can stop bubbling", () => {
  assert.match(
    contentSource,
    /document\.addEventListener\(\s*["']click["'],[\s\S]*?\},\s*true\s*\);/,
    "X player controls may stop click propagation, so the delegated listener must run in the capture phase"
  );
});
