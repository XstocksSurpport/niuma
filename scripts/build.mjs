import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JavaScriptObfuscator from "javascript-obfuscator";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const source = path.join(root, "src", "app.js");

const staticEntries = [
  "index.html",
  "styles.css",
  "stats.json",
  "niuma.png"
];

const staticDirs = ["assets"];

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyDir(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const srcPath = path.join(from, entry.name);
    const destPath = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(srcPath, destPath);
    else copyFile(srcPath, destPath);
  }
}

function prepareDist() {
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });

  for (const entry of staticEntries) {
    copyFile(path.join(root, entry), path.join(dist, entry));
  }
  for (const dir of staticDirs) {
    copyDir(path.join(root, dir), path.join(dist, dir));
  }

  const htmlPath = path.join(dist, "index.html");
  let html = fs.readFileSync(htmlPath, "utf8");
  html = html.replace(
    /<script src="\.\/app\.js"><\/script>/,
    '<script src="./app.bundle.js" defer></script>'
  );
  html = html.replace(
    /<script src="\.\/app\.bundle\.js"( defer)?><\/script>/,
    '<script src="./app.bundle.js" defer></script>'
  );
  fs.writeFileSync(htmlPath, html);
}

function obfuscateBundle() {
  const code = fs.readFileSync(source, "utf8");
  const result = JavaScriptObfuscator.obfuscate(code, {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.75,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.2,
    identifierNamesGenerator: "hexadecimal",
    numbersToExpressions: true,
    renameGlobals: false,
    selfDefending: true,
    simplify: true,
    splitStrings: true,
    splitStringsChunkLength: 8,
    stringArray: true,
    stringArrayCallsTransform: true,
    stringArrayEncoding: ["base64"],
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: 2,
    stringArrayWrappersChainedCalls: true,
    stringArrayWrappersType: "function",
    stringArrayThreshold: 0.85,
    transformObjectKeys: true,
    unicodeEscapeSequence: false,
    disableConsoleOutput: true
  });

  fs.writeFileSync(path.join(dist, "app.bundle.js"), result.getObfuscatedCode(), "utf8");
}

prepareDist();
obfuscateBundle();
console.log("Build complete -> dist/");
