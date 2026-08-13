import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { verificationScripts } from "./verification-suite.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const scriptsDirectory = fileURLToPath(new URL("./", import.meta.url));
const discoveredScripts = readdirSync(scriptsDirectory)
  .filter((name) => /^verify-.*\.mjs$/.test(name))
  .sort();
const registeredScripts = [...verificationScripts].sort();

const duplicates = verificationScripts.filter(
  (name, index) => verificationScripts.indexOf(name) !== index,
);
const missing = verificationScripts.filter((name) => !discoveredScripts.includes(name));
const unregistered = discoveredScripts.filter((name) => !registeredScripts.includes(name));

if (duplicates.length > 0 || missing.length > 0 || unregistered.length > 0) {
  if (duplicates.length > 0) {
    console.error(`Duplicate verification entries: ${[...new Set(duplicates)].join(", ")}`);
  }
  if (missing.length > 0) {
    console.error(`Registered verification files are missing: ${missing.join(", ")}`);
  }
  if (unregistered.length > 0) {
    console.error(`Unregistered verification files: ${unregistered.join(", ")}`);
  }
  process.exit(1);
}

function runVerification(name) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [`${scriptsDirectory}${name}`], {
      cwd: root,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve({ code: code ?? 1, signal });
    });
  });
}

const failures = [];
for (const [index, name] of verificationScripts.entries()) {
  console.log(`\n[verify ${index + 1}/${verificationScripts.length}] ${name}`);
  const result = await runVerification(name);
  if (result.code !== 0) {
    failures.push({ name, ...result });
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} verification suite(s) failed:`);
  for (const failure of failures) {
    const detail = failure.signal ? `signal ${failure.signal}` : `exit ${failure.code}`;
    console.error(`- ${failure.name} (${detail})`);
  }
  process.exit(1);
}

console.log(`\nAll ${verificationScripts.length} verification suites passed.`);
