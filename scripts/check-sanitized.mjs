#!/usr/bin/env node
// Fails when the working tree contains strings that must never be published:
// the original employer context, licensed data vendors, real firm names,
// original rubric wording, and training-stack identifiers. Runs first in
// `npm run check`.
//
// The guarded phrases are stored only as salted SHA-256 hashes, so this file
// doesn't spell out what it guards (short entries could still be recovered by
// brute force; the point is not to publish them in plain text). Each line is split into alphanumeric words;
// the guard hashes every lowercased 1–4 word n-gram ("word"), each lowercased
// word's substrings of a guarded length ("sub"), and each word in its original
// case ("case"), and fails on any match.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".data", ".vercel"]);
const SKIP_FILES = new Set(["scripts/check-sanitized.mjs", "package-lock.json"]);
const TEXT_EXT = /\.(ts|tsx|js|mjs|cjs|json|md|html|css|svg|yml|yaml|txt)$/i;
const MAX_NGRAM = 4;

/** Structural patterns that identify nothing on their own. */
const PATTERNS = [
  { name: "Foundry resource id", re: /\bri\.[a-z-]+\.main\./ },
  { name: "OSDK meta tag", re: /osdk-(clientId|redirectUrl|foundryUrl|ontologyRid)/ },
];

const HASHED = [
  {
    name: "former employer",
    mode: "sub",
    hash: "fea3d307bdbceb601ea236a5bdc69d01375c231f60a84d88dfc5673d83aabb2b",
    len: 8,
  },
  {
    name: "former employer",
    mode: "case",
    hash: "013e60d21f97ccbc3f848f0072b87784b3ce6cd0b1110647858d396852dd3177",
  },
  {
    name: "former employer",
    mode: "word",
    hash: "74191bb6c6729780bdc1d02f49c3dc675b93bb79f3a24e29b5741e3be73bcc68",
  },
  {
    name: "licensed data vendor",
    mode: "sub",
    hash: "c36b3aa7c13c698965b9a4232b85999703bf282c6eec37ee208fa85ae6654864",
    len: 5,
  },
  {
    name: "licensed data vendor",
    mode: "sub",
    hash: "9c3d0c77122c3776d49fada05b85bbb287f928ec76decab5563459579ec9f9ec",
    len: 9,
  },
  {
    name: "licensed data vendor",
    mode: "word",
    hash: "92342420750d9154054dcb1876492ec49b2c999377729c023e301dcbe505c3cb",
  },
  {
    name: "licensed data vendor",
    mode: "word",
    hash: "fe19b6873964452f76df5467a164a9d0e65ffb24239a50a0602cb9160acf3119",
  },
  {
    name: "licensed data vendor",
    mode: "sub",
    hash: "5372715994400e33e567edeaa9475b68ebcf6eda63d328b63e70da550cfb0b99",
    len: 9,
  },
  {
    name: "licensed data vendor",
    mode: "word",
    hash: "4746a32f6c76c64db9f699cb7c37c48ceb12ab9afa58a0d15582b412b533d788",
  },
  {
    name: "training stack host",
    mode: "sub",
    hash: "a1830d04e7ec0a2c9d0e16b63e6426e9d5ee1b8d464f1d03babb0de9710f9515",
    len: 10,
  },
  {
    name: "training stack host",
    mode: "sub",
    hash: "da3550d15f00546ee2ee2f912efa5262fb92da943a206f07c7284469fe2b2c7e",
    len: 15,
  },
  {
    name: "real firm name",
    mode: "sub",
    hash: "349b8222c4d37d7f67534c5defa53d8c3e865124044f30a6d8c062a0b6cf3c5b",
    len: 7,
  },
  {
    name: "real firm name",
    mode: "sub",
    hash: "b740b122b59f5f3e836c53cf88eba7744d71be22e7756d030de4520776b4fc43",
    len: 7,
  },
  {
    name: "real firm name",
    mode: "word",
    hash: "8bb033fbd7aa1dcd7acdbcffc2859e7483310fcbbf84c0df3a3ad00765f7faa8",
  },
  {
    name: "real firm name",
    mode: "word",
    hash: "62bce4957d3d1776c3cf9480ed74c821be8dae3ad062268253700baa19a820a9",
  },
  {
    name: "real firm name",
    mode: "word",
    hash: "13effde4f5e8a6fd07c8b818107c1d68207ab24b3a3b981a6b695b46935ec729",
  },
  {
    name: "real firm name",
    mode: "word",
    hash: "3dd29cd8f28fad809df2b808fa0a5cf5f4a55d2fdacb8154c88d53b5564f161b",
  },
  {
    name: "real firm name",
    mode: "word",
    hash: "7dd0b19056bcf5264cc44a9c39cc116f83ba7a648881b7bbc603977f36f0df45",
  },
  {
    name: "original rubric wording",
    mode: "word",
    hash: "894a3fe6402e82080916c4fb5b613c755c6611a416c29b64f0e6f0a781f5ea9a",
  },
  {
    name: "original rubric wording",
    mode: "word",
    hash: "8c0ca18212e6f17e59cdc953626e32e0153051813f5e2aed13ea90297aea1efa",
  },
  {
    name: "original rubric wording",
    mode: "word",
    hash: "c262b1144c99b98a1eb920d1485b96e10fdf765d5fc0db303b29908e13e32486",
  },
  {
    name: "original rubric wording",
    mode: "word",
    hash: "7384ed382ad49220280e23c8196f3948f045277f00f8554f2440d4439ea44f71",
  },
];

const hash = (s) =>
  createHash("sha256")
    .update("beacon-guard:" + s)
    .digest("hex");
const byMode = (mode) =>
  new Map(HASHED.filter((e) => e.mode === mode).map((e) => [e.hash, e.name]));
const WORD = byMode("word");
const SUB = byMode("sub");
const CASE = byMode("case");
const SUB_LENGTHS = [...new Set(HASHED.filter((e) => e.mode === "sub").map((e) => e.len))];

/** Names of the guarded phrases found in one line. */
function hashedHits(line) {
  const hits = new Set();
  const raw = line.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const words = raw.map((w) => w.toLowerCase());
  for (const w of raw) {
    const name = CASE.get(hash(w));
    if (name) {
      hits.add(name);
    }
  }
  for (let i = 0; i < words.length; i++) {
    for (let n = 1; n <= MAX_NGRAM && i + n <= words.length; n++) {
      const name = WORD.get(hash(words.slice(i, i + n).join(" ")));
      if (name) {
        hits.add(name);
      }
    }
    for (const len of SUB_LENGTHS) {
      for (let s = 0; s + len <= words[i].length; s++) {
        const name = SUB.get(hash(words[i].slice(s, s + len)));
        if (name) {
          hits.add(name);
        }
      }
    }
  }
  return hits;
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) {
      continue;
    }
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      yield* walk(path);
    } else {
      yield path;
    }
  }
}

let failures = 0;
for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file);
  if (SKIP_FILES.has(rel) || !TEXT_EXT.test(rel)) {
    continue;
  }
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      const names = hashedHits(line);
      for (const rule of PATTERNS) {
        if (rule.re.test(line)) {
          names.add(rule.name);
        }
      }
      for (const name of names) {
        console.error(`${rel}:${i + 1}  [${name}]  ${line.trim().slice(0, 120)}`);
        failures++;
      }
    });
}
if (failures > 0) {
  console.error(`\n${failures} forbidden reference(s). Remove them before committing.`);
  process.exit(1);
}
console.log("check-sanitized: clean");
