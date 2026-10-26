// Run from the zkID folder: node scripts/test-proofs.js
// Tests real Groth16 proofs locally with snarkjs.
const snarkjs = require("snarkjs");
const fs = require("fs");
const path = require("path");

const WASM = path.join(__dirname, "..", "build", "AgeCheck_js", "AgeCheck.wasm");
const ZKEY = path.join(__dirname, "..", "build", "AgeCheck_final.zkey");
const VKEY = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "build", "verification_key.json"), "utf8")
);
const YEAR = new Date().getUTCFullYear();

let failures = 0;
function check(name, pass, detail = "") {
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!pass) failures++;
}

async function prove(birthYear, currentYear = YEAR, ageLimit = 18) {
  return snarkjs.groth16.fullProve(
    { birthYear, currentYear, ageLimit },
    WASM,
    ZKEY
  );
}

(async () => {
  // 1. Valid proof: born 2000, age >= 18
  {
    const { proof, publicSignals } = await prove(2000);
    const ok = await snarkjs.groth16.verify(VKEY, publicSignals, proof);
    check("Valid proof verifies", ok && publicSignals[0] === "1",
      `signals=${JSON.stringify(publicSignals)}`);

    // 2. Tampered proof must fail
    const bad = JSON.parse(JSON.stringify(proof));
    bad.pi_a[0] = (BigInt(bad.pi_a[0]) + 1n).toString();
    let badOk = false;
    try { badOk = await snarkjs.groth16.verify(VKEY, publicSignals, bad); } catch { badOk = false; }
    check("Tampered proof is rejected", badOk === false);

    // 3. Tampered public signal must fail (claim a different year)
    const badSig = [...publicSignals];
    badSig[1] = (BigInt(badSig[1]) - 5n).toString();
    const sigOk = await snarkjs.groth16.verify(VKEY, badSig, proof);
    check("Altered public signal is rejected", sigOk === false);
  }

  // 4. Underage: born (YEAR - 10). Circuit outputs 0, so the contract rejects it.
  {
    const { proof, publicSignals } = await prove(YEAR - 10);
    const ok = await snarkjs.groth16.verify(VKEY, publicSignals, proof);
    check("Underage proof yields isAboveLimit = 0",
      ok && publicSignals[0] === "0", `signals=${JSON.stringify(publicSignals)}`);
  }

  // 5. Boundary: exactly 18 by year
  {
    const { publicSignals } = await prove(YEAR - 18);
    check("Boundary (age 18) passes", publicSignals[0] === "1");
  }

  // 6. Impossible birth year (before 1900) must fail witness generation
  {
    let threw = false;
    try { await prove(1850); } catch { threw = true; }
    check("Birth year 1850 cannot produce a proof", threw);
  }

  // 7. Future birth year must fail witness generation
  {
    let threw = false;
    try { await prove(YEAR + 5); } catch { threw = true; }
    check("Future birth year cannot produce a proof", threw);
  }

  console.log(failures === 0 ? "\nAll tests passed." : `\n${failures} test(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
})();
