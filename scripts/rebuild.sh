#!/usr/bin/env bash
# Rebuild circuit, keys and verifier. Run from the zkID folder.
# Dev ceremony only. Not for production.
set -e
mkdir -p build
npx circom2 circuits/AgeCheck.circom --r1cs --wasm --sym -l node_modules -o build
cd build
S=../node_modules/.bin/snarkjs
$S powersoftau new bn128 8 pot8_0.ptau
$S powersoftau contribute pot8_0.ptau pot8_1.ptau --name="zkID dev" -e="$(date +%s%N)-entropy"
$S powersoftau prepare phase2 pot8_1.ptau pot8_final.ptau
$S groth16 setup AgeCheck.r1cs pot8_final.ptau AgeCheck_0.zkey
$S zkey contribute AgeCheck_0.zkey AgeCheck_final.zkey --name="zkID dev" -e="$(date +%s%N)-more"
$S zkey export verificationkey AgeCheck_final.zkey verification_key.json
$S zkey export solidityverifier AgeCheck_final.zkey ../contracts/Verifier.sol
cd ..
mkdir -p frontend/zk
cp build/AgeCheck_js/AgeCheck.wasm build/AgeCheck_final.zkey build/verification_key.json frontend/zk/
echo "Done. Redeploy Verifier.sol and zkKYC.sol."
