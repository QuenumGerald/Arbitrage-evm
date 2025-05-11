import { ethers, providers } from "ethers";
import dotenv from "dotenv";
dotenv.config();

// Import l'ABI du contrat FlashLoanArbitrageur (nécessite "resolveJsonModule" dans tsconfig.json)
// Chargement de l'ABI compatible ESM/ts-node
const artifact = JSON.parse(
  fs.readFileSync(
    new URL("../artifacts/contracts/FlashLoanArbitrageur.sol/FlashLoanArbitrageur.json", import.meta.url),
    "utf-8"
  )
);

// --- Addresses ---
const FACTORY_ADDRESSES = {
  uniswap: "0x1F98431c8aD98523631AE4a59f267346ea31F984", // Uniswap V3 Factory
  pancakeswap: "0x1af415a1EbA07a4986a52B6f2e7dE7003D82231e" // PancakeSwap V3 Factory (Arbitrum, correct address)
};

const TOKENS: { [symbol: string]: string } = {
  USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  USDCe: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8", // bridged USDC (checksum)
  USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
  DAI: "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1",
  WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  WBTC: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
  ARB: "0x912CE59144191C1204E64559FE8253a0e49E6548",
  cbBTC: "0xcBb7C0000aB88b473b1F5AFd9Ef808440eEd33bF", // Coinbase Wrapped BTC
  axlUSDC: "0xeb466342c4d449bc9f53a865d5cb90586f405215", // Axelar USDC
  SOL: "0x2bcC6D6CdBbDC0a4071e48bb3B969b06B3330c07", // Wormhole SOL (à vérifier)
  AAVE: "0xba5DdD1f9d7F570dc94a51479a000E3BCE967196", // AAVE
  KIMA: "0x94fcd9c18f99538c0f7c61c5500ca79f0d5c4dab", // KIMA (à vérifier)
  USDe: "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34", // Ethena USDe
  SQD: "0x1337420ded5adb9980cfc35f8f2b054ea86f8ab1", // SQD (à vérifier)
  LINK: "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4",
  MAGIC: "0x539bdE0d7Dbd336b79148AA742883198BBF60342",
  GMX: "0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a",
  UNI: "0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0", // UNI (Arbitrum, corrigée)
  SUSHI: "0xd4d42F0b6DEF4CE0383636770eF773390d85c61A"
};

type Pair = { base: string; quote: string };
const PAIRS: Pair[] = [
  // Paires blue chips communes PancakeSwap/Uniswap à surveiller
  { base: "WETH", quote: "USDC" }, // ETH/USDC
  { base: "WBTC", quote: "WETH" }, // WBTC/ETH
  { base: "WETH", quote: "USDT" }, // ETH/USDT
  { base: "USDC", quote: "USDT" }, // USDC/USDT
  { base: "WBTC", quote: "USDC" }, // WBTC/USDC
  { base: "WETH", quote: "ARB" }, // ETH/ARB
  { base: "WBTC", quote: "USDT" }, // WBTC/USDT
  { base: "WETH", quote: "AAVE" }, // ETH/AAVE
  { base: "USDC", quote: "DAI" }, // USDC/DAI
  // --- Nouvelles paires ARB ---
  { base: "ARB", quote: "USDC" },
  { base: "ARB", quote: "USDT" },
  { base: "ARB", quote: "DAI" },
  { base: "ARB", quote: "WBTC" },
  { base: "USDC", quote: "ARB" },
  { base: "USDT", quote: "ARB" },
  { base: "DAI", quote: "ARB" },
  { base: "WBTC", quote: "ARB" },
];

// Mapping pour prioriser le fee tier optimal par paire sur PancakeSwap
const PANCAKE_PAIR_FEE_TIERS: { [key: string]: number[] } = {
  "WETH/USDC": [100, 500],
  "WBTC/WETH": [100],
  "WETH/USDT": [100, 500],
  "USDC/USDT": [100],
  "WBTC/USDC": [500, 100],
  "WETH/ARB": [100],
  "WBTC/USDT": [100],
  "WETH/AAVE": [500],
  "USDC/DAI": [100],
};

const FEE = 3000; // 0.3% pool
const PANCAKE_FEE_TIERS = [100, 500, 2500, 3000, 10000]; // 0.01%, 0.05%, 0.25%, 0.3%, 1%
const UNISWAP_FEE_TIERS = [500, 3000, 10000]; // 0.05%, 0.3%, 1%
const MIN_NET_PROFIT = 0.0003; // 0.03% net
const FLASHLOAN_FEE = 0.0009; // 0.09% (Aave v3 typical)
const GAS_COST_USD = 0.5; // Approximate, can be refined

// Mapping pour prioriser le fee tier optimal par paire sur Uniswap (optionnel, sinon fallback sur UNISWAP_FEE_TIERS)
const UNISWAP_PAIR_FEE_TIERS: { [key: string]: number[] } = {
  "WETH/USDC": [500, 3000],
  "WBTC/WETH": [500, 3000],
  "WETH/USDT": [500, 3000],
  "USDC/USDT": [500, 3000],
  "WBTC/USDC": [500, 3000],
  "WETH/ARB": [500, 3000],
  "WBTC/USDT": [500, 3000],
  "WETH/AAVE": [3000],
  "USDC/DAI": [500, 3000],
};

// Recherche le fee tier optimal défini pour la paire sur Uniswap, sinon fallback sur tous les tiers
export async function getFirstAvailableUniswapPool(provider: ethers.providers.Provider, factory: string, tokenA: string, tokenB: string) {
  const key1 = `${tokenA}/${tokenB}`;
  const key2 = `${tokenB}/${tokenA}`;
  let prioritizedFees: number[] = [];
  if (UNISWAP_PAIR_FEE_TIERS[key1]) prioritizedFees = UNISWAP_PAIR_FEE_TIERS[key1];
  else if (UNISWAP_PAIR_FEE_TIERS[key2]) prioritizedFees = UNISWAP_PAIR_FEE_TIERS[key2];
  const feeTiers = prioritizedFees.length > 0 ? prioritizedFees : UNISWAP_FEE_TIERS;
  for (const fee of feeTiers) {
    try {
      const pool = await getPoolAddress(provider, factory, tokenA, tokenB, fee);
      if (pool) return { pool, fee };
    } catch { }
  }
  return { pool: null, fee: null };
}

// Try all PancakeSwap fee tiers and return the first available pool
// Recherche le fee tier optimal défini pour la paire, sinon fallback sur tous les tiers
async function getFirstAvailablePool(provider: ethers.providers.Provider, factory: string, tokenA: string, tokenB: string) {
  const key1 = `${tokenA}/${tokenB}`;
  const key2 = `${tokenB}/${tokenA}`;
  let prioritizedFees: number[] = [];
  if (PANCAKE_PAIR_FEE_TIERS[key1]) prioritizedFees = PANCAKE_PAIR_FEE_TIERS[key1];
  else if (PANCAKE_PAIR_FEE_TIERS[key2]) prioritizedFees = PANCAKE_PAIR_FEE_TIERS[key2];
  const feeTiers = prioritizedFees.length > 0 ? prioritizedFees : PANCAKE_FEE_TIERS;
  for (const fee of feeTiers) {
    try {
      const pool = await getPoolAddress(provider, factory, tokenA, tokenB, fee);
      if (pool) return { pool, fee };
    } catch { }
  }
  return { pool: null, fee: null };
}

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

import { logToFile } from "./arbitrage-logger.ts";

const MIN_LIQUIDITY_USD = 100000; // Minimum de liquidité en USD (modifiable)

async function getPoolLiquidity(provider: ethers.providers.Provider, pool: string, token: string): Promise<number> {
  // Lit le solde du token dans le pool
  const erc20 = new ethers.Contract(token, ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"], provider);
  const [raw, decimals] = await Promise.all([
    erc20.balanceOf(pool),
    erc20.decimals()
  ]);
  return Number(ethers.utils.formatUnits(raw, decimals));
}

// --- Ajout : fonction pour lancer un arbitrage ---
async function launchArbitrage({ direction, base, quote, poolUni, poolPancake, uniFee, pancakeFee, uniPrice, pancakePrice }: any): Promise<boolean> {
  try {
    // ABI déjà importée en haut du fichier via import artifact ...
    const arbitrageurAddress = process.env.ARBITRAGEUR_ADDRESS;
    if (!arbitrageurAddress) {
      console.error("[ERROR] ARBITRAGEUR_ADDRESS non défini dans .env");
      return false;
    }
    const rpcUrl = process.env.ARBITRUM_RPC_URL;
    if (!rpcUrl) {
      console.error("[ERROR] ARBITRUM_RPC_URL non défini dans .env");
      return false;
    }
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    if (!process.env.PRIVATE_KEY) {
      console.error("[ERROR] PRIVATE_KEY non défini dans .env");
      return false;
    }
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const arbitrageur = new ethers.Contract(arbitrageurAddress, artifact.abi, wallet);

    // --- LOG all input parameters ---
    console.log('[ARBITRAGE][PARAMS]', {
      direction, base, quote, poolUni, poolPancake, uniFee, pancakeFee, uniPrice, pancakePrice
    });

    // --- Dynamically set amount0 and amount1 based on the tokens and decimals ---
    // We'll fetch decimals for base and quote
    const ERC20_ABI = ["function decimals() view returns (uint8)"];
    const baseAddress = TOKENS[base];
    const quoteAddress = TOKENS[quote];
    let amount0, amount1;
    let baseDecimals = 18, quoteDecimals = 18;
    // Vérifie la présence de bytecode avant d'appeler decimals()
    try {
      const code = await provider.getCode(baseAddress);
      if (!code || code === '0x') {
        console.error(`[DECIMALS][ERROR] base token ${base} address: ${baseAddress} (no contract)`);
        baseDecimals = 18;
      } else {
        baseDecimals = await (new ethers.Contract(baseAddress, ERC20_ABI, provider)).decimals();
      }
    } catch (e) {
      console.error(`[DECIMALS][ERROR] base token ${base} address: ${baseAddress}`, e);
      baseDecimals = 18;
    }
    try {
      const code = await provider.getCode(quoteAddress);
      if (!code || code === '0x') {
        console.error(`[DECIMALS][ERROR] quote token ${quote} address: ${quoteAddress} (no contract)`);
        quoteDecimals = 18;
      } else {
        quoteDecimals = await (new ethers.Contract(quoteAddress, ERC20_ABI, provider)).decimals();
      }
    } catch (e) {
      console.error(`[DECIMALS][ERROR] quote token ${quote} address: ${quoteAddress}`, e);
      quoteDecimals = 18;
    }
    // Default: try to borrow 36 units of base (or 36 USDC if USDC is base)
    let baseAmount = "0.036";
    if (base === "USDC" || base === "USDT" || base === "DAI" || base === "USDCe" || base === "axlUSDC") baseAmount = "36";
    // Parse amount with correct decimals
    amount0 = ethers.utils.parseUnits(baseAmount, baseDecimals);
    amount1 = 0;
    // If direction is Pancake->Uni and quote is the base, swap
    if (direction === 1 && quote !== base) {
      // Try to borrow quote instead
      let quoteAmount = "36";
      if (quote === "WETH" || quote === "WBTC" || quote === "ARB" || quote === "AAVE" || quote === "GMX" || quote === "UNI" || quote === "MAGIC" || quote === "LINK" || quote === "KIMA" || quote === "SQD" || quote === "SOL" || quote === "cbBTC") quoteAmount = "0.036";
      amount0 = 0;
      amount1 = ethers.utils.parseUnits(quoteAmount, quoteDecimals);
    }

    // Routers (à adapter si besoin)
    const UNISWAP_ROUTER = "0xe592427a0aece92de3edee1f18e0157c05861564";
    const PANCAKE_ROUTER = "0x2bF9b864cdc97b08B6D79ad4663e71B8aB65c45c"; // PancakeSwap V3 router (Arbitrum)
    const minProfit = ethers.utils.parseUnits("0", 6); // 0 USDC
    // Choix du pool et des params selon la direction
    let pool, fee1, fee2, tokenMid, router1, router2;
    if (direction === 0) { // Uniswap -> PancakeSwap
      pool = poolUni;
      fee1 = uniFee;
      fee2 = pancakeFee;
      tokenMid = TOKENS["USDC"];
      router1 = UNISWAP_ROUTER;
      router2 = PANCAKE_ROUTER;
    } else { // PancakeSwap -> Uniswap
      pool = poolPancake;
      fee1 = pancakeFee;
      fee2 = uniFee;
      tokenMid = TOKENS["USDC"];
      router1 = PANCAKE_ROUTER;
      router2 = UNISWAP_ROUTER;
    }
    if (!pool) {
      console.error("[ERROR] Pool non trouvé pour la direction d'arbitrage");
      return false;
    }
    console.log(`[ARBITRAGE] Envoi de la tx direction=${direction} pool=${pool} amount0=${amount0.toString()} amount1=${amount1.toString()}`);
    // --- LOG all tx params ---
    console.log('[ARBITRAGE][TX PARAMS]', {
      pool, amount0: amount0.toString(), amount1: amount1.toString(), tokenMid, fee1, fee2, minProfit: minProfit.toString(), direction, router1, router2
    });
    const tx = await arbitrageur.startUniswapV3Flash(
      pool,
      amount0,
      amount1,
      tokenMid,
      fee1,
      fee2,
      minProfit,
      direction,
      router1,
      router2,
      { gasLimit: 3_000_000 }
    );
    console.log(`[ARBITRAGE] TX envoyée: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`[ARBITRAGE] TX minée: ${receipt.transactionHash}`);
    return true;
  } catch (err) {
    // Improved error logging: log all possible fields
    console.error('[ARBITRAGE][ERROR]', err);
    if (err && typeof err === 'object') {
      if ('message' in err) console.error('[ARBITRAGE][ERROR][message]', err.message);
      if ('stack' in err) console.error('[ARBITRAGE][ERROR][stack]', err.stack);
      if ('reason' in err) console.error('[ARBITRAGE][ERROR][reason]', err.reason);
      if ('error' in err) console.error('[ARBITRAGE][ERROR][inner error]', err.error);
      if ('data' in err) console.error('[ARBITRAGE][ERROR][data]', err.data);
      if ('body' in err) console.error('[ARBITRAGE][ERROR][body]', err.body);
      if ('code' in err) console.error('[ARBITRAGE][ERROR][code]', err.code);
    }
    return false;
  }
}


async function scanArbitrage(provider: ethers.providers.Provider, pairs: Pair[]) {
  for (const { base, quote } of pairs) {
    let uniPrice = 0, pancakePrice = 0;
    let uniInfo = null, pancakeInfo = null;
    let uniLiquidity = 0, pancakeLiquidity = 0;
    let poolUni: string | null = null, poolPancake: string | null = null;
    let uniFee: number | null = null, pancakeFee: number | null = null;
    try {
      const uniResult = await getFirstAvailableUniswapPool(provider, FACTORY_ADDRESSES.uniswap, TOKENS[base], TOKENS[quote]);
      poolUni = uniResult.pool;
      uniFee = uniResult.fee;
      if (!poolUni) throw new Error('No Uniswap V3 pool found');
      uniInfo = await getPoolPrice(provider, poolUni);
      uniPrice = uniInfo.price;
      // Vérifie la liquidité sur le quote token
      uniLiquidity = await getPoolLiquidity(provider, poolUni, TOKENS[quote]);
    } catch (e) {
      console.error(`Uniswap error (${base}/${quote}):`, e);
    }
    try {
      const pancakeResult = await getFirstAvailablePool(provider, FACTORY_ADDRESSES.pancakeswap, TOKENS[base], TOKENS[quote]);
      poolPancake = pancakeResult.pool;
      pancakeFee = pancakeResult.fee;
      if (!poolPancake) throw new Error("No pool found");
      pancakeInfo = await getPoolPrice(provider, poolPancake);
      pancakePrice = pancakeInfo.price;
      pancakeLiquidity = await getPoolLiquidity(provider, poolPancake, TOKENS[quote]);
    } catch (e) {
      console.error(`PancakeSwap error (${base}/${quote}):`, e);
    }
    // Sanity checks for price values
    if (!uniPrice && !pancakePrice) {
      console.log(`[${base}/${quote}] No price data available`);
      continue;
    }
    if (uniPrice <= 0 || pancakePrice <= 0 || isNaN(uniPrice) || isNaN(pancakePrice)) {
      console.warn(`[${base}/${quote}] Invalid price(s) detected: uniPrice=${uniPrice}, pancakePrice=${pancakePrice}`);
      continue;
    }
    if (uniPrice > 1e12 || pancakePrice > 1e12) {
      console.warn(`[${base}/${quote}] Suspiciously large price(s): uniPrice=${uniPrice}, pancakePrice=${pancakePrice}`);
      continue;
    }
    // Vérification de liquidité
    if (uniLiquidity < MIN_LIQUIDITY_USD && pancakeLiquidity < MIN_LIQUIDITY_USD) {
      console.log(`[${base}/${quote}] Pool ignoré: liquidité trop faible (Uniswap: ${uniLiquidity}, Pancake: ${pancakeLiquidity})`);
      continue;
    }
    if (uniPrice) {
      console.log(`[${base}/${quote}] Uniswap price: ${uniPrice}`);
    }
    if (pancakePrice) {
      console.log(`[${base}/${quote}] SushiSwap price: ${pancakePrice}`);
    }
    if (!uniPrice || !pancakePrice) {
      console.log(`[${base}/${quote}] Impossible de comparer les deux DEXs (un seul prix dispo).`);
      continue;
    }
    // Debug: log all prices and tokens
    if (uniInfo && pancakeInfo) {
      console.log(`[DEBUG] ${base}/${quote} | Uniswap token0: ${uniInfo.token0}, token1: ${uniInfo.token1}, Pancake token0: ${pancakeInfo.token0}, token1: ${pancakeInfo.token1}`);
    }
    console.log(`[DEBUG] ${base}/${quote} | uniPrice: ${uniPrice}, pancakePrice: ${pancakePrice}`);

    // Always interpret prices as QUOTE per BASE
    // Simulate arbitrage: start with 1 BASE, swap to QUOTE on DEX1, swap back to BASE on DEX2
    // Direction 1: Uniswap -> PancakeSwap
    const baseStart = 1;
    const quoteFromUni = baseStart * uniPrice;
    const baseBackFromSushi = quoteFromUni / pancakePrice;
    const grossProfit1 = baseBackFromSushi - baseStart;
    // Fees: flashloan (as fraction of baseStart), gas (in base units, approximated)
    let netProfit1 = null;
    if (uniPrice > 0) {
      netProfit1 = grossProfit1 - (baseStart * FLASHLOAN_FEE) - (GAS_COST_USD / (uniPrice * baseStart));
    } else {
      netProfit1 = NaN;
    }
    console.log(`[DEBUG] ${base}/${quote} | [Uni->Pancake] baseStart: ${baseStart}, quoteFromUni: ${quoteFromUni}, grossProfit: ${grossProfit1}, netProfit: ${netProfit1}`);

    // Direction 2: PancakeSwap -> Uniswap
    const quoteFromPancake = baseStart * pancakePrice;
    const baseBackFromUni = quoteFromPancake / uniPrice;
    const grossProfit2 = baseBackFromUni - baseStart;
    let netProfit2 = null;
    if (pancakePrice > 0) {
      netProfit2 = grossProfit2 - (baseStart * FLASHLOAN_FEE) - (GAS_COST_USD / (pancakePrice * baseStart));
    } else {
      netProfit2 = NaN;
    }
    console.log(`[DEBUG] ${base}/${quote} | [Pancake->Uni] baseStart: ${baseStart}, quoteFromPancake: ${quoteFromPancake}, baseBackFromUni: ${baseBackFromUni}, grossProfit: ${grossProfit2}, netProfit: ${netProfit2}`);

    // Spread calculation (for info)
    const spread = Math.abs(uniPrice - pancakePrice) / ((uniPrice + pancakePrice) / 2);

    let arbitrageLaunched = false;
    // --- Opportunité Uniswap -> PancakeSwap ---
    if (!isNaN(netProfit1) && netProfit1 > MIN_NET_PROFIT && Math.abs(netProfit1) < 1 && Math.abs(spread) < 1) {
      const msg = `[OPPORTUNITY] ${base}/${quote} Uniswap -> PancakeSwap | Net Profit: ${(netProfit1 * 100).toFixed(3)}% | Spread: ${(spread * 100).toFixed(3)}% | Prix Uniswap: ${uniPrice} | Prix PancakeSwap: ${pancakePrice}`;
      console.log(msg);
      logToFile(msg);
      if (!arbitrageLaunched) {
        arbitrageLaunched = await launchArbitrage({
          direction: 0, // Uniswap -> PancakeSwap
          base,
          quote,
          poolUni,
          poolPancake,
          uniFee,
          pancakeFee,
          uniPrice,
          pancakePrice
        });
        if (arbitrageLaunched) {
          console.log(`[PAUSE] Pause de 60s après arbitrage...`);
          await new Promise(r => setTimeout(r, 60000));
        }
      }
    }
    // --- Opportunité PancakeSwap -> Uniswap ---
    if (!isNaN(netProfit2) && netProfit2 > MIN_NET_PROFIT && Math.abs(netProfit2) < 1 && Math.abs(spread) < 1) {
      const msg = `[OPPORTUNITY] ${base}/${quote} PancakeSwap -> Uniswap | Net Profit: ${(netProfit2 * 100).toFixed(3)}% | Spread: ${(spread * 100).toFixed(3)}% | Prix Uniswap: ${uniPrice} | Prix PancakeSwap: ${pancakePrice}`;
      console.log(msg);
      logToFile(msg);
      if (!arbitrageLaunched) {
        arbitrageLaunched = await launchArbitrage({
          direction: 1, // PancakeSwap -> Uniswap
          base,
          quote,
          poolUni,
          poolPancake,
          uniFee,
          pancakeFee,
          uniPrice,
          pancakePrice
        });
        if (arbitrageLaunched) {
          console.log(`[PAUSE] Pause de 60s après arbitrage...`);
          await new Promise(r => setTimeout(r, 60000));
        }
      }
    }
    if ((isNaN(netProfit1) || netProfit1 <= MIN_NET_PROFIT) && (isNaN(netProfit2) || netProfit2 <= MIN_NET_PROFIT)) {
      console.log(`[${base}/${quote}] No arbitrage opportunity > ${MIN_NET_PROFIT * 100}% net detected.`);
    }
  }
}


async function filterExistingPairs(provider: ethers.providers.Provider, pairs: Pair[]): Promise<Pair[]> {
  const checked: Pair[] = [];
  for (const pair of pairs) {
    let poolUni = null, poolPancake = null;
    try {
      const uniResult = await getFirstAvailableUniswapPool(provider, FACTORY_ADDRESSES.uniswap, TOKENS[pair.base], TOKENS[pair.quote]);
      poolUni = uniResult.pool;
    } catch { }
    try {
      const pancakeResult = await getFirstAvailablePool(provider, FACTORY_ADDRESSES.pancakeswap, TOKENS[pair.base], TOKENS[pair.quote]);
      poolPancake = pancakeResult.pool;
    } catch { }
    if (poolUni || poolPancake) {
      checked.push(pair);
    } else {
      console.log(`[INFO] Pair supprimée (aucun pool trouvé sur Uniswap ni PancakeSwap): ${pair.base}/${pair.quote}`);
    }
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

