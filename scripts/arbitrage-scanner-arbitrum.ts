import { ethers, providers } from "ethers";
import dotenv from "dotenv";
dotenv.config();

// --- Addresses ---
const FACTORY_ADDRESSES = {
  uniswap: "0x1F98431c8aD98523631AE4a59f267346ea31F984", // Uniswap V3 Factory
  sushiswap: "0x1af415a1EbA07a4986a52B6f2e7dE7003D82231e" // SushiSwap V3 Factory (Arbitrum, checksum)
};

const TOKENS: { [symbol: string]: string } = {
  USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  USDCe: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8", // bridged USDC (checksum)
  USDT: "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9",
  DAI: "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1",
  WETH: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
  WBTC: "0x2f2a2543b76a4166549f7aaab2e75b4cfc3cfbdb",
  ARB: "0x912CE59144191C1204E64559FE8253a0e49E6548",
  LINK: "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4",
  MAGIC: "0x539bdE0d7Dbd336b79148AA742883198BBF60342",
  GMX: "0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a",
  UNI: "0xfa7f8980a0f1e64a2062791cc3b0871572f1f7f0", // UNI (Arbitrum, corrigée)
  SUSHI: "0xd4d42F0b6DEF4CE0383636770eF773390d85c61A"
};

type Pair = { base: string; quote: string };
const PAIRS: Pair[] = [

  { base: "WBTC", quote: "WETH" },


  { base: "MAGIC", quote: "WETH" },

  { base: "UNI", quote: "WETH" },

  // Cross-stable and volume pairs
  { base: "USDC", quote: "USDCe" },
  { base: "USDC", quote: "USDT" },
  { base: "USDC", quote: "DAI" },
  { base: "USDCe", quote: "USDT" },
  { base: "USDCe", quote: "DAI" },
  // Optionally: USDC/token, USDCe/token for ARB, LINK, WBTC, UNI, SUSHI etc.
  { base: "USDC", quote: "ARB" },

  { base: "USDC", quote: "WBTC" },
  { base: "USDC", quote: "UNI" },
  { base: "USDC", quote: "SUSHI" },
  { base: "USDCe", quote: "ARB" },

  { base: "USDCe", quote: "WBTC" },
  { base: "USDCe", quote: "UNI" },
  { base: "USDCe", quote: "SUSHI" }
];

const FEE = 3000; // 0.3% pool
const MIN_NET_PROFIT = 0.001; // 0.1% net
const FLASHLOAN_FEE = 0.0009; // 0.09% (Aave v3 typical)
const GAS_COST_USD = 0.5; // Approximate, can be refined

const FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)"
];
const POOL_ABI = [
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function token0() view returns (address)",
  "function token1() view returns (address)"
];

async function getPoolAddress(provider: ethers.providers.Provider, factory: string, tokenA: string, tokenB: string, fee: number) {
  const factoryContract = new ethers.Contract(factory, FACTORY_ABI, provider);
  const pool = await factoryContract.getPool(tokenA, tokenB, fee);
  if (pool === ethers.constants.AddressZero) throw new Error("No pool found");
  return pool;
}

async function getPoolPrice(provider: ethers.providers.Provider, pool: string) {
  const contract = new ethers.Contract(pool, POOL_ABI, provider);
  const [slot0, token0, token1] = await Promise.all([
    contract.slot0(),
    contract.token0(),
    contract.token1()
  ]);
  const sqrtPriceX96 = slot0[0];
  // Always compute price as token1 per token0 (Uniswap V3 convention)
  // price = (sqrtPriceX96 ** 2) / 2**192
  const priceRaw = sqrtPriceX96.mul(sqrtPriceX96).mul(ethers.utils.parseUnits('1', 18)).div(ethers.BigNumber.from(2).pow(192));
  // Get decimals for both tokens
  let decimals0 = 18, decimals1 = 18;
  try {
    decimals0 = await contract.provider.call({ to: token0, data: '0x313ce567' }).then(x => parseInt(x.slice(-64), 16));
    decimals1 = await contract.provider.call({ to: token1, data: '0x313ce567' }).then(x => parseInt(x.slice(-64), 16));
  } catch { }
  // Debug: log token0/token1 and decimals
  console.log(`[DEBUG][getPoolPrice] token0: ${token0}, token1: ${token1}, decimals0: ${decimals0}, decimals1: ${decimals1}`);
  let price: number;
  if (decimals0 && decimals1) {
    price = Number(priceRaw.toString()) / 10 ** decimals1;
  } else {
    price = Number(priceRaw.toString()) / 1e18;
  }
  // Always return price as QUOTE per BASE
  // If token0 matches the BASE (see scanArbitrage), invert price so that price = quote per base
  // We'll pass base/quote to this function for clarity
  return { token0, token1, price, decimals0, decimals1 };
}

import { logToFile } from "./arbitrage-logger.js"; // <- Utilise le JS compilé (CommonJS)

async function scanArbitrage(provider: ethers.providers.Provider, pairs: Pair[]) {
  for (const { base, quote } of pairs) {
    let uniPrice = 0, sushiPrice = 0;
    let uniInfo = null, sushiInfo = null;
    try {
      const poolUni = await getPoolAddress(provider, FACTORY_ADDRESSES.uniswap, TOKENS[base], TOKENS[quote], FEE);
      uniInfo = await getPoolPrice(provider, poolUni);
      uniPrice = uniInfo.price;
    } catch (e) {
      console.error(`Uniswap error (${base}/${quote}):`, e);
    }
    try {
      const poolSushi = await getPoolAddress(provider, FACTORY_ADDRESSES.sushiswap, TOKENS[base], TOKENS[quote], FEE);
      sushiInfo = await getPoolPrice(provider, poolSushi);
      sushiPrice = sushiInfo.price;
    } catch (e) {
      console.error(`SushiSwap error (${base}/${quote}):`, e);
    }
    // Sanity checks for price values
    if (!uniPrice && !sushiPrice) {
      console.log(`[${base}/${quote}] No price data available`);
      continue;
    }
    if (uniPrice <= 0 || sushiPrice <= 0 || isNaN(uniPrice) || isNaN(sushiPrice)) {
      console.warn(`[${base}/${quote}] Invalid price(s) detected: uniPrice=${uniPrice}, sushiPrice=${sushiPrice}`);
      continue;
    }
    if (uniPrice > 1e12 || sushiPrice > 1e12) {
      console.warn(`[${base}/${quote}] Suspiciously large price(s): uniPrice=${uniPrice}, sushiPrice=${sushiPrice}`);
      continue;
    }
    if (uniPrice) {
      console.log(`[${base}/${quote}] Uniswap price: ${uniPrice}`);
    }
    if (sushiPrice) {
      console.log(`[${base}/${quote}] SushiSwap price: ${sushiPrice}`);
    }
    if (!uniPrice || !sushiPrice) {
      console.log(`[${base}/${quote}] Impossible de comparer les deux DEXs (un seul prix dispo).`);
      continue;
    }
    // Debug: log all prices and tokens
    if (uniInfo && sushiInfo) {
      console.log(`[DEBUG] ${base}/${quote} | Uniswap token0: ${uniInfo.token0}, token1: ${uniInfo.token1}, Sushi token0: ${sushiInfo.token0}, token1: ${sushiInfo.token1}`);
    }
    console.log(`[DEBUG] ${base}/${quote} | uniPrice: ${uniPrice}, sushiPrice: ${sushiPrice}`);

    // Always interpret prices as QUOTE per BASE
    // Simulate arbitrage: start with 1 BASE, swap to QUOTE on DEX1, swap back to BASE on DEX2
    // Direction 1: Uniswap -> SushiSwap
    const baseStart = 1;
    const quoteFromUni = baseStart * uniPrice;
    const baseBackFromSushi = quoteFromUni / sushiPrice;
    const grossProfit1 = baseBackFromSushi - baseStart;
    // Fees: flashloan (as fraction of baseStart), gas (in base units, approximated)
    let netProfit1 = null;
    if (uniPrice > 0) {
      netProfit1 = grossProfit1 - (baseStart * FLASHLOAN_FEE) - (GAS_COST_USD / (uniPrice * baseStart));
    } else {
      netProfit1 = NaN;
    }
    console.log(`[DEBUG] ${base}/${quote} | [Uni->Sushi] baseStart: ${baseStart}, quoteFromUni: ${quoteFromUni}, baseBackFromSushi: ${baseBackFromSushi}, grossProfit: ${grossProfit1}, netProfit: ${netProfit1}`);

    // Direction 2: SushiSwap -> Uniswap
    const quoteFromSushi = baseStart * sushiPrice;
    const baseBackFromUni = quoteFromSushi / uniPrice;
    const grossProfit2 = baseBackFromUni - baseStart;
    let netProfit2 = null;
    if (sushiPrice > 0) {
      netProfit2 = grossProfit2 - (baseStart * FLASHLOAN_FEE) - (GAS_COST_USD / (sushiPrice * baseStart));
    } else {
      netProfit2 = NaN;
    }
    console.log(`[DEBUG] ${base}/${quote} | [Sushi->Uni] baseStart: ${baseStart}, quoteFromSushi: ${quoteFromSushi}, baseBackFromUni: ${baseBackFromUni}, grossProfit: ${grossProfit2}, netProfit: ${netProfit2}`);

    // Spread calculation (for info)
    const spread = Math.abs(uniPrice - sushiPrice) / ((uniPrice + sushiPrice) / 2);

    if (!isNaN(netProfit1) && netProfit1 > MIN_NET_PROFIT) {
      const msg = `[OPPORTUNITY] ${base}/${quote} Uniswap -> SushiSwap | Net Profit: ${(netProfit1 * 100).toFixed(3)}% | Spread: ${(spread * 100).toFixed(3)}%`;
      console.log(msg);
      logToFile(msg);
    }
    if (!isNaN(netProfit2) && netProfit2 > MIN_NET_PROFIT) {
      const msg = `[OPPORTUNITY] ${base}/${quote} SushiSwap -> Uniswap | Net Profit: ${(netProfit2 * 100).toFixed(3)}% | Spread: ${(spread * 100).toFixed(3)}%`;
      console.log(msg);
      logToFile(msg);
    }
    if ((isNaN(netProfit1) || netProfit1 <= MIN_NET_PROFIT) && (isNaN(netProfit2) || netProfit2 <= MIN_NET_PROFIT)) {
      console.log(`[${base}/${quote}] No arbitrage opportunity > ${MIN_NET_PROFIT * 100}% net detected.`);
    }
  }
}


async function filterExistingPairs(provider: ethers.providers.Provider, pairs: Pair[]): Promise<Pair[]> {
  const checked: Pair[] = [];
  for (const pair of pairs) {
    let poolUni = null, poolSushi = null;
    try {
      poolUni = await getPoolAddress(provider, FACTORY_ADDRESSES.uniswap, TOKENS[pair.base], TOKENS[pair.quote], FEE);
    } catch { }
    try {
      poolSushi = await getPoolAddress(provider, FACTORY_ADDRESSES.sushiswap, TOKENS[pair.base], TOKENS[pair.quote], FEE);
    } catch { }
    if (poolUni || poolSushi) checked.push(pair);
  }
  return checked;
}

async function main() {
  const wsUrl = process.env["ARBITRUM_RPC_WS_URL"];
  if (!wsUrl) {
    console.error("No Arbitrum WebSocket URL set (ARBITRUM_RPC_WS_URL in .env)");
    process.exit(1);
  }
  const wsProvider = new providers.WebSocketProvider(wsUrl);
  // Découverte des paires existantes avant de démarrer le scan
  console.log("Découverte des pools existants...");
  const existingPairs = await filterExistingPairs(wsProvider, PAIRS);
  console.log(`Paires existantes détectées (${existingPairs.length}) :`, existingPairs);
  wsProvider.on("block", async (blockNumber) => {
    console.log(`[TICK] Nouveau bloc détecté: ${blockNumber}`);
    try {
      await scanArbitrage(wsProvider, existingPairs);
    } catch (err) {
      console.error(`[ERROR] Exception during scanArbitrage:`, err);
    }
  });

  // Gestion d'erreur globale
  process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught Exception:', err);
  });
  process.on('unhandledRejection', (reason, promise) => {
    console.error('[FATAL] Unhandled Rejection:', reason);
  });
}

main();

// --- API Express pour consulter les opportunités ---
import express from "express";
import fs from "fs";
import path from "path";

const app = express();
const PORT = process.env.PORT || 3000;
const LOG_FILE = path.join(process.cwd(), "arbitrage-opportunities.log");

app.get("/", (req, res) => {
  res.send(`<h1>Arbitrage Opportunities API</h1><p>GET /opportunities pour voir les résultats.</p>`);
});

app.get("/opportunities", (req, res) => {
  fs.readFile(LOG_FILE, "utf8", (err, data) => {
    if (err) {
      return res.status(500).json({ error: "Log file not found." });
    }
    // Retourne les 100 dernières lignes (ou moins)
    const lines = data.trim().split("\n");
    const last = lines.slice(-100);
    res.json({ count: last.length, opportunities: last });
  });
});

app.listen(PORT, () => {
  console.log(`Arbitrage API listening on port ${PORT}`);
});

