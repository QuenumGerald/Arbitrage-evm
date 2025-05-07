import { ethers } from "ethers";
import dotenv from "dotenv";
dotenv.config();

// Uniswap V3 Factory addresses
const FACTORY_ADDRESSES = {
  base: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",      // Uniswap V3 Factory on Base (official)
  arbitrum: "0x1F98431c8aD98523631AE4a59f267346ea31F984"  // Uniswap V3 Factory on Arbitrum
};

// USDC & WETH addresses for Base & Arbitrum
const TOKENS = {
  base: {
    USDC: "0xD9AA947737Fb2ADa9b0fEdb9B8cF7faB2821aBFe",   // USDC on Base (checksum correct)
    WETH: "0x4200000000000000000000000000000000000006"    // WETH on Base
  },
  arbitrum: {
    USDC: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8", // USDC on Arbitrum
    WETH: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1"    // WETH on Arbitrum
  }
};

// Uniswap V3 Factory ABI (getPool)
const FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)"
];

// Uniswap V3 Pool ABI (slot0, token0, token1)
const POOL_ABI = [
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function token0() view returns (address)",
  "function token1() view returns (address)"
];

// Fee tier: 500 = 0.05%, 3000 = 0.3%
const FEE = 500;

async function getPoolAddress(provider: ethers.providers.Provider, factory: string, tokenA: string, tokenB: string, fee: number) {
  const factoryContract = new ethers.Contract(factory, FACTORY_ABI, provider);
  // token order doesn't matter, Uniswap sorts internally
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
  // price = (sqrtPriceX96 ** 2) / 2**192
  // BigNumber math:
  const numerator = sqrtPriceX96.mul(sqrtPriceX96).mul(ethers.utils.parseUnits('1', 18));
  const denominator = ethers.BigNumber.from(2).pow(192);
  const priceBN = numerator.div(denominator);
  const price = Number(priceBN.toString()) / 1e18;
  return { token0, token1, price };
}

(async () => {
  const chain = "arbitrum";
  const rpc = process.env["ARBITRUM_RPC_URL"];
  if (!rpc) {
    console.log(`arbitrum: No RPC URL set`);
    return;
  }
  const provider = new ethers.providers.JsonRpcProvider(rpc);
  try {
    const { USDC, WETH } = TOKENS[chain];
    const pool = await getPoolAddress(provider, FACTORY_ADDRESSES[chain], USDC, WETH, FEE);
    const { token0, token1, price } = await getPoolPrice(provider, pool);
    console.log(`arbitrum: Pool ${pool}`);
    console.log(`arbitrum: Price token0/token1 = ${price} (${token0}/${token1})`);
  } catch (e) {
    console.error(`arbitrum error:`, e);
  }
})();
