const NIUMA = {
  chainId: "0xc4",
  chainName: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: ["https://rpc.xlayer.tech"],
  blockExplorerUrls: ["https://www.oklink.com/xlayer"],
  terms: {
    3: 7,
    7: 18,
    31: 45,
    180: 120,
    360: 210
  }
};

const els = {
  walletButton: document.querySelector("#walletButton"),
  walletModal: document.querySelector("#walletModal"),
  walletList: document.querySelector("#walletList"),
  closeModal: document.querySelector("#closeModal"),
  stakeForm: document.querySelector("#stakeForm"),
  stakeAmount: document.querySelector("#stakeAmount"),
  maxButton: document.querySelector("#maxButton"),
  balanceText: document.querySelector("#balanceText"),
  networkStaked: document.querySelector("#networkStaked"),
  rewardText: document.querySelector("#rewardText"),
  pointsText: document.querySelector("#pointsText"),
  totalText: document.querySelector("#totalText"),
  rateText: document.querySelector("#rateText"),
  statusLine: document.querySelector("#statusLine"),
  stakeButton: document.querySelector("#stakeButton")
};

let selectedProvider;
let selectedAccount = "";
let tokenDecimals = 18;
let tokenBalance = 0n;
let providerInfos = [];
let stakeConfig;

function formatAddress(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function stripHexPrefix(value) {
  return value.replace(/^0x/i, "");
}

function pad64(value) {
  return value.padStart(64, "0");
}

function encodeCall(selector, parts = []) {
  return selector + parts.map(pad64).join("");
}

function encodeAddress(address) {
  return stripHexPrefix(address).toLowerCase();
}

function toHexQuantity(value) {
  return `0x${value.toString(16)}`;
}

function parseTokenAmount(value, decimals) {
  const clean = String(value || "").trim();
  if (!/^\d+(\.\d+)?$/.test(clean) || Number(clean) <= 0) return 0n;
  const [whole, fraction = ""] = clean.split(".");
  const fractionPadded = fraction.slice(0, decimals).padEnd(decimals, "0");
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fractionPadded || "0");
}

function formatTokenAmount(value, decimals = tokenDecimals, maxFraction = 4) {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = value % base;
  const fractionText = fraction.toString().padStart(decimals, "0").slice(0, maxFraction).replace(/0+$/, "");
  return fractionText ? `${whole}.${fractionText}` : whole.toString();
}

function formatNumber(value, digits = 0) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0
  }).format(value);
}

function setStatus(message, type = "") {
  els.statusLine.textContent = message;
  els.statusLine.classList.toggle("is-error", type === "error");
  els.statusLine.classList.toggle("is-success", type === "success");
}

function selectedTerm() {
  return document.querySelector('input[name="term"]:checked')?.value || "3";
}

function selectedRate() {
  return NIUMA.terms[selectedTerm()];
}

function updateProjection() {
  const amount = Number(els.stakeAmount.value || 0);
  const rate = selectedRate();
  const reward = amount * rate / 100;
  const points = amount / 10;
  els.rewardText.textContent = `${formatNumber(reward, 6)} NIUMA`;
  els.pointsText.textContent = formatNumber(points, 2);
  els.totalText.textContent = `${formatNumber(amount + reward, 6)} NIUMA`;
  els.rateText.textContent = `${rate}%`;
}

function updateNetworkStaked() {
  fetch("/api/stats", { cache: "no-store" })
    .then((response) => response.json())
    .then((data) => {
      els.networkStaked.textContent = formatNumber(Number(data.networkStaked || 0));
    })
    .catch(() => {
      els.networkStaked.textContent = "428,244,751";
    });
}

async function getStakeConfig() {
  if (stakeConfig) return stakeConfig;
  const response = await fetch("/api/stake-config", { cache: "no-store" });
  if (!response.ok) throw new Error("质押配置加载失败，请刷新页面重试。");
  stakeConfig = await response.json();
  return stakeConfig;
}

function providerLabel(provider) {
  if (provider.isOkxWallet || provider.isOKExWallet) return "OKX Wallet";
  if (provider.isMetaMask) return "MetaMask";
  if (provider.isCoinbaseWallet) return "Coinbase Wallet";
  if (provider.isTrust) return "Trust Wallet";
  if (provider.isRabby) return "Rabby";
  return "Injected Wallet";
}

function collectLegacyProviders() {
  const eth = window.ethereum;
  if (!eth) return [];
  if (Array.isArray(eth.providers)) {
    return eth.providers.map((provider) => ({
      info: { name: providerLabel(provider), icon: "" },
      provider
    }));
  }
  return [{ info: { name: providerLabel(eth), icon: "" }, provider: eth }];
}

function discoverWallets() {
  const discovered = new Map();
  window.addEventListener("eip6963:announceProvider", (event) => {
    const detail = event.detail;
    if (!detail?.provider) return;
    const key = detail.info?.uuid || detail.info?.rdns || detail.info?.name || Math.random().toString(36);
    discovered.set(key, detail);
    providerInfos = [...discovered.values()];
    renderWallets();
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  setTimeout(() => {
    if (discovered.size === 0) {
      providerInfos = collectLegacyProviders();
      renderWallets();
    }
  }, 300);
}

function renderWallets() {
  els.walletList.innerHTML = "";
  if (providerInfos.length === 0) {
    const empty = document.createElement("div");
    empty.className = "wallet-option";
    empty.textContent = "未检测到钱包，请安装 OKX Wallet、MetaMask、Coinbase Wallet 或其他 EVM 钱包。";
    els.walletList.append(empty);
    return;
  }
  for (const item of providerInfos) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "wallet-option";
    const name = item.info?.name || providerLabel(item.provider);
    const icon = item.info?.icon ? `<img src="${item.info.icon}" alt="">` : "";
    button.innerHTML = `<span>${name}</span>${icon}`;
    button.addEventListener("click", () => connectWallet(item.provider));
    els.walletList.append(button);
  }
}

async function request(provider, method, params = []) {
  return provider.request({ method, params });
}

async function ensureXLayer() {
  const current = await request(selectedProvider, "eth_chainId");
  if (current?.toLowerCase() === NIUMA.chainId) return;
  try {
    await request(selectedProvider, "wallet_switchEthereumChain", [{ chainId: NIUMA.chainId }]);
  } catch (error) {
    if (error?.code === 4902 || String(error?.message || "").includes("Unrecognized")) {
      await request(selectedProvider, "wallet_addEthereumChain", [{
        chainId: NIUMA.chainId,
        chainName: NIUMA.chainName,
        nativeCurrency: NIUMA.nativeCurrency,
        rpcUrls: NIUMA.rpcUrls,
        blockExplorerUrls: NIUMA.blockExplorerUrls
      }]);
      return;
    }
    throw error;
  }
}

async function ethCall(data) {
  const config = await getStakeConfig();
  return request(selectedProvider, "eth_call", [{ to: config.token, data }, "latest"]);
}

async function loadTokenMeta() {
  try {
    const raw = await ethCall("0x313ce567");
    tokenDecimals = Number(BigInt(raw || "0x12"));
  } catch {
    tokenDecimals = 18;
  }
}

async function loadBalance() {
  if (!selectedAccount) return;
  const data = encodeCall("0x70a08231", [encodeAddress(selectedAccount)]);
  const raw = await ethCall(data);
  tokenBalance = BigInt(raw || "0x0");
  els.balanceText.textContent = `${formatTokenAmount(tokenBalance)} NIUMA`;
  els.walletButton.textContent = `${formatAddress(selectedAccount)} · ${formatTokenAmount(tokenBalance, tokenDecimals, 2)} NIUMA`;
}

async function connectWallet(provider) {
  try {
    selectedProvider = provider;
    const accounts = await request(provider, "eth_requestAccounts");
    selectedAccount = accounts[0] || "";
    await ensureXLayer();
    await loadTokenMeta();
    await loadBalance();
    els.walletModal.hidden = true;
    setStatus("钱包已连接，可输入数量进行质押。", "success");

    provider.on?.("accountsChanged", async (accounts) => {
      selectedAccount = accounts[0] || "";
      if (!selectedAccount) {
        els.walletButton.textContent = "连接钱包";
        els.balanceText.textContent = "-- NIUMA";
        setStatus("钱包已断开，请重新连接。", "error");
        return;
      }
      await loadBalance();
    });

    provider.on?.("chainChanged", async () => {
      try {
        await ensureXLayer();
        await loadBalance();
      } catch {
        setStatus("请切换到 X Layer 后继续。", "error");
      }
    });
  } catch (error) {
    setStatus(error?.message || "钱包连接失败，请重试。", "error");
  }
}

async function stakeNiuma(event) {
  event.preventDefault();
  try {
    if (!selectedProvider || !selectedAccount) {
      els.walletModal.hidden = false;
      return;
    }
    await ensureXLayer();
    const amount = parseTokenAmount(els.stakeAmount.value, tokenDecimals);
    if (amount <= 0n) {
      setStatus("请输入有效质押数量。", "error");
      return;
    }
    if (tokenBalance > 0n && amount > tokenBalance) {
      setStatus("余额不足，请调整质押数量。", "error");
      return;
    }
    els.stakeButton.disabled = true;
    setStatus("请在钱包中确认交易。");
    const config = await getStakeConfig();
    const data = encodeCall("0xa9059cbb", [encodeAddress(config.vault), amount.toString(16)]);
    const txHash = await request(selectedProvider, "eth_sendTransaction", [{
      from: selectedAccount,
      to: config.token,
      data,
      value: "0x0"
    }]);
    setStatus(`质押交易已提交：${txHash.slice(0, 10)}...${txHash.slice(-8)}`, "success");
    await loadBalance();
  } catch (error) {
    const message = error?.code === 4001 ? "交易已取消。" : (error?.message || "质押失败，请检查钱包状态。");
    setStatus(message, "error");
  } finally {
    els.stakeButton.disabled = false;
  }
}

els.walletButton.addEventListener("click", () => {
  discoverWallets();
  els.walletModal.hidden = false;
});

els.closeModal.addEventListener("click", () => {
  els.walletModal.hidden = true;
});

els.walletModal.addEventListener("click", (event) => {
  if (event.target === els.walletModal) els.walletModal.hidden = true;
});

els.stakeAmount.addEventListener("input", updateProjection);

document.querySelectorAll('input[name="term"]').forEach((radio) => {
  radio.addEventListener("change", updateProjection);
});

els.maxButton.addEventListener("click", () => {
  if (tokenBalance <= 0n) return;
  els.stakeAmount.value = formatTokenAmount(tokenBalance, tokenDecimals, 6);
  updateProjection();
});

els.stakeForm.addEventListener("submit", stakeNiuma);

updateProjection();
updateNetworkStaked();
discoverWallets();
setInterval(updateNetworkStaked, 60 * 1000);
