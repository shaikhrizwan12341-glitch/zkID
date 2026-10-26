(() => {
  "use strict";
  const CFG = window.ZKID_CONFIG;

  const ABI = [
    "function verifyAge(uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[3] pubSignals)",
    "function isVerified(address user) view returns (bool)",
    "function getRecord(address user) view returns (bool verified, uint64 verifiedAt, uint32 proofYear, uint32 count)",
    "event AgeVerified(address indexed user, uint256 year, uint256 timestamp)"
  ];

  const $ = (id) => document.getElementById(id);
  const el = {
    connectBtn: $("connectBtn"), networkBadge: $("networkBadge"), walletAddr: $("walletAddr"),
    networkName: $("networkName"), networkWarn: $("networkWarn"), switchBtn: $("switchBtn"),
    kycAddr: $("kycAddr"), kycAddrMsg: $("kycAddrMsg"), birthYear: $("birthYear"), curYear: $("curYear"),
    proveBtn: $("proveBtn"), proveStatus: $("proveStatus"), verifyBtn: $("verifyBtn"),
    txStatus: $("txStatus"), verifyStatus: $("verifyStatus"), txHash: $("txHash"),
    txLink: $("txLink"), txLinkNone: $("txLinkNone"), signals: $("signals")
  };

  let provider = null, signer = null, account = null, chainOk = false;
  let lastProof = null; // { calldata, publicSignals }

  const currentYear = () => new Date().getUTCFullYear();
  el.curYear.textContent = String(currentYear());

  function setStatus(node, kind, msg) {
    node.className = "status " + kind;
    node.textContent = msg;
  }

  function setVerifyPill(kind, text) {
    el.verifyStatus.className = "pill pill-" + kind;
    el.verifyStatus.textContent = text;
  }

  function shortErr(e) {
    if (!e) return "Unknown error";
    if (e.code === "ACTION_REJECTED" || e.code === 4001) return "You rejected the request in MetaMask.";
    const reason = e.reason || (e.info && e.info.error && e.info.error.message) || e.shortMessage || e.message;
    return String(reason || e).slice(0, 300);
  }

  function addressValid() {
    const v = el.kycAddr.value.trim();
    if (!v) { el.kycAddrMsg.className = "hint"; el.kycAddrMsg.textContent = ""; return false; }
    if (!ethers.isAddress(v)) {
      el.kycAddrMsg.className = "hint bad";
      el.kycAddrMsg.textContent = "Not a valid Ethereum address.";
      return false;
    }
    el.kycAddrMsg.className = "hint good";
    el.kycAddrMsg.textContent = "Address format is valid.";
    return true;
  }

  function birthYearValid() {
    const raw = el.birthYear.value.trim();
    if (!/^\d{4}$/.test(raw)) return false;
    const y = Number(raw);
    return y >= 1900 && y <= currentYear();
  }

  function refreshButtons() {
    const ready = !!account && chainOk;
    el.proveBtn.disabled = !(ready && birthYearValid());
    el.verifyBtn.disabled = !(ready && lastProof && addressValid());
  }

  async function checkChain() {
    const net = await provider.getNetwork();
    chainOk = Number(net.chainId) === CFG.chainId;
    el.networkName.textContent = chainOk ? CFG.chainName : `Chain ${net.chainId} (wrong)`;
    el.networkBadge.className = "badge " + (chainOk ? "badge-ok" : "badge-bad");
    el.networkBadge.textContent = chainOk ? "Sepolia" : "Wrong network";
    el.networkWarn.classList.toggle("hidden", chainOk);
    refreshButtons();
  }

  async function connect() {
    if (!window.ethereum) {
      setStatus(el.proveStatus, "err", "MetaMask not found. Install the MetaMask extension and reload.");
      return;
    }
    try {
      provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      signer = await provider.getSigner();
      account = await signer.getAddress();
      el.walletAddr.textContent = account;
      el.connectBtn.textContent = "Connected";
      await checkChain();
      await refreshOnChainStatus();
    } catch (e) {
      setStatus(el.proveStatus, "err", shortErr(e));
    }
  }

  async function switchNetwork() {
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CFG.chainIdHex }] });
    } catch (e) {
      if (e.code === 4902) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: CFG.chainIdHex, chainName: "Sepolia",
              nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
              rpcUrls: [CFG.rpcUrl], blockExplorerUrls: [CFG.explorer]
            }]
          });
        } catch (e2) { setStatus(el.proveStatus, "err", shortErr(e2)); }
      } else {
        setStatus(el.proveStatus, "err", shortErr(e));
      }
    }
  }

  async function getContract(runner) {
    if (!addressValid()) throw new Error("Enter a valid zkKYC contract address first.");
    const addr = el.kycAddr.value.trim();
    const code = await provider.getCode(addr);
    if (code === "0x") throw new Error("No contract found at this address on Sepolia.");
    return new ethers.Contract(addr, ABI, runner);
  }

  async function refreshOnChainStatus() {
    if (!account || !chainOk || !addressValid()) return;
    try {
      const c = await getContract(provider);
      const rec = await c.getRecord(account);
      if (rec.verified) setVerifyPill("ok", `Verified on-chain (${rec.count} time${rec.count === 1n ? "" : "s"})`);
      else setVerifyPill("neutral", "Not verified");
    } catch (e) {
      setVerifyPill("neutral", "Unknown");
      el.kycAddrMsg.className = "hint bad";
      el.kycAddrMsg.textContent = shortErr(e);
    }
  }

  async function generateProof() {
    lastProof = null;
    el.verifyBtn.disabled = true;
    if (!birthYearValid()) { setStatus(el.proveStatus, "err", "Enter a 4 digit birth year between 1900 and now."); return; }
    el.proveBtn.disabled = true;
    setStatus(el.proveStatus, "busy", "Generating Groth16 proof in your browser. This can take a few seconds.");
    try {
      const input = {
        birthYear: String(el.birthYear.value.trim()),
        currentYear: String(currentYear()),
        ageLimit: String(CFG.ageLimit)
      };
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, CFG.wasmUrl, CFG.zkeyUrl);

      // Verify locally with the verification key before anything goes on chain.
      const vkey = await (await fetch(CFG.vkeyUrl)).json();
      const ok = await snarkjs.groth16.verify(vkey, publicSignals, proof);
      if (!ok) throw new Error("Local verification failed. Proof not usable.");

      if (publicSignals[0] !== "1") {
        setStatus(el.proveStatus, "err", "Proof is valid but shows you are under 18. The contract will reject it.");
        el.signals.textContent = JSON.stringify(publicSignals);
        setVerifyPill("bad", "Under 18");
        lastProof = null;
        refreshButtons();
        return;
      }

      const raw = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
      const [pA, pB, pC, pub] = JSON.parse("[" + raw + "]");
      lastProof = { calldata: { pA, pB, pC, pub }, publicSignals };
      el.signals.textContent = JSON.stringify(publicSignals);
      setStatus(el.proveStatus, "ok", "Proof generated and verified locally. Ready to submit.");
    } catch (e) {
      const msg = String(e && e.message || e);
      setStatus(el.proveStatus, "err",
        /Assert Failed|Error in template/i.test(msg)
          ? "The circuit rejected this birth year (must be 1900 or later and not in the future)."
          : "Proof failed: " + msg.slice(0, 250));
    } finally {
      refreshButtons();
    }
  }

  async function submitProof() {
    if (!lastProof) return;
    el.verifyBtn.disabled = true;
    el.txHash.textContent = "-";
    el.txLink.classList.add("hidden");
    el.txLinkNone.classList.remove("hidden");
    try {
      await checkChain();
      if (!chainOk) throw new Error("Switch to Sepolia first.");
      const c = await getContract(signer);
      const { pA, pB, pC, pub } = lastProof.calldata;

      setStatus(el.txStatus, "busy", "Simulating transaction to check the proof on-chain rules.");
      await c.verifyAge.staticCall(pA, pB, pC, pub);

      setStatus(el.txStatus, "busy", "Confirm the transaction in MetaMask.");
      const tx = await c.verifyAge(pA, pB, pC, pub);
      el.txHash.textContent = tx.hash;
      el.txLink.href = `${CFG.explorer}/tx/${tx.hash}`;
      el.txLink.classList.remove("hidden");
      el.txLinkNone.classList.add("hidden");

      setStatus(el.txStatus, "busy", "Waiting for confirmation on Sepolia.");
      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) throw new Error("Transaction failed on-chain.");

      // Success is reported only after reading the status back from the contract.
      const verified = await c.isVerified(account);
      if (!verified) throw new Error("Transaction mined but contract shows not verified.");
      setVerifyPill("ok", "Verified on-chain");
      setStatus(el.txStatus, "ok", `Verified in block ${receipt.blockNumber}.`);
      lastProof = null;
      await refreshOnChainStatus();
    } catch (e) {
      setVerifyPill("bad", "Not verified");
      setStatus(el.txStatus, "err", shortErr(e));
    } finally {
      refreshButtons();
    }
  }

  el.connectBtn.addEventListener("click", connect);
  el.switchBtn.addEventListener("click", switchNetwork);
  el.proveBtn.addEventListener("click", generateProof);
  el.verifyBtn.addEventListener("click", submitProof);
  el.birthYear.addEventListener("input", () => { lastProof = null; refreshButtons(); });
  el.kycAddr.addEventListener("input", () => { addressValid(); refreshButtons(); refreshOnChainStatus(); });

  if (CFG.zkKycAddress) { el.kycAddr.value = CFG.zkKycAddress; addressValid(); }

  if (window.ethereum) {
    window.ethereum.on("chainChanged", () => window.location.reload());
    window.ethereum.on("accountsChanged", () => window.location.reload());
  } else {
    el.networkBadge.textContent = "No wallet";
    setStatus(el.proveStatus, "err", "MetaMask not found. Install it to continue.");
  }
})();
