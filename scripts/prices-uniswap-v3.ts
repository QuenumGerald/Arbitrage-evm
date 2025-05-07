import { ethers } from "ethers";
import dotenv from "dotenv";
dotenv.config();

// USDC/WETH pool addresses for Base and Arbitrum (Uniswap v3)
const POOLS = [
  {
    name: "Base",
    rpc: process.env.BASE_RPC_URL!,
    pool: "0x6c6Bc977E13Df9b0de53b251522280BB72383700" // Example: USDC/WETH pool address on Base
  },
  {
    name: "Arbitrum",
    rpc: process.env.ARBITRUM_RPC_URL!,
    pool: "0xC6D6e7E04c6cD2b6aA2aB7aC0b8C8B1c7e1eD1a7" // Example: USDC/WETH pool address on Arbitrum
  }
];

// Minimal ABI for Uniswap v3 pool: slot0() and token0/token1
const UNISWAP_V3_POOL_ABI = [
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function token0() view returns (address)",
  "function token1() view returns (address)"
];

async function getPoolPrice(rpc: string, pool: string) {
  const provider = new ethers.providers.JsonRpcProvider(rpc);
  const contract = new ethers.Contract(pool, UNISWAP_V3_POOL_ABI, provider);
  const [slot0, token0, token1] = await Promise.all([
    contract.slot0(),
    contract.token0(),
    contract.token1()
  ]);
  // slot0.sqrtPriceX96 is a Q64.96 value
  const sqrtPriceX96 = slot0[0];
  // Calculate price: (sqrtPriceX96 ** 2) / 2**192
  const price = (sqrtPriceX96 ** 2) / (2 ** 192);
  return { token0, token1, price };
}

(async () => {
  for (const { name, rpc, pool } of POOLS) {
    try {
      const { token0, token1, price } = await getPoolPrice(rpc, pool);
      console.log(`${name}: Price token0/token1 = ${price} (${token0}/${token1})`);
    } catch (e) {
      console.error(`${name} error:`, e);
    }
  }
})();
