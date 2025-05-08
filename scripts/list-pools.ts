import { ethers, providers } from "ethers";
import dotenv from "dotenv";
dotenv.config();

const FACTORY_ADDRESSES = {
  uniswap: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
  sushiswap: "0x1af415a1EbA07a4986a52B6f2e7dE7003D82231e"
};

const TOKENS: { [symbol: string]: string } = {
  USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  USDCe: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
  USDT: "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9",
  DAI: "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1",
  WETH: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
  WBTC: "0x2f2a2543b76a4166549f7aaab2e75b4cfc3cfbdb",
  ARB: "0x912CE59144191C1204E64559FE8253a0e49E6548",
  LINK: "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4",
  MAGIC: "0x539bdE0d7Dbd336b79148AA742883198BBF60342",
  GMX: "0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a",
  UNI: "0xfa7f8980a0f1e64a2062791cc3b0871572f1f7f0",
  SUSHI: "0xd4d42F0b6DEF4CE0383636770eF773390d85c61A"
};

const PAIRS = [
  { base: "USDC", quote: "WETH" },
  { base: "USDCe", quote: "WETH" },
  { base: "USDT", quote: "WETH" },
  { base: "DAI", quote: "WETH" },
  { base: "WBTC", quote: "WETH" },
  { base: "ARB", quote: "WETH" },
  { base: "LINK", quote: "WETH" },
  { base: "MAGIC", quote: "WETH" },
  { base: "GMX", quote: "WETH" },
  { base: "UNI", quote: "WETH" },
  { base: "SUSHI", quote: "WETH" },
  { base: "USDC", quote: "USDCe" },
  { base: "USDC", quote: "USDT" },
  { base: "USDC", quote: "DAI" },
  { base: "USDCe", quote: "USDT" },
  { base: "USDCe", quote: "DAI" },
  { base: "USDC", quote: "ARB" },
  { base: "USDC", quote: "LINK" },
  { base: "USDC", quote: "WBTC" },
  { base: "USDC", quote: "UNI" },
  { base: "USDC", quote: "SUSHI" },
  { base: "USDCe", quote: "ARB" },
  { base: "USDCe", quote: "LINK" },
  { base: "USDCe", quote: "WBTC" },
  { base: "USDCe", quote: "UNI" },
  { base: "USDCe", quote: "SUSHI" }
];

const FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)"
];

const FEE = 3000;

async function getPoolAddress(
  provider: ethers.providers.Provider,
  factory: string,
  tokenA: string,
  tokenB: string,
  fee: number
) {
  const factoryContract = new ethers.Contract(factory, FACTORY_ABI, provider);
  const pool = await factoryContract.getPool(tokenA, tokenB, fee);
  return pool;
}

async function printAllPools() {
  const wsUrl = process.env["ARBITRUM_RPC_WS_URL"];
  if (!wsUrl) {
    console.error("No Arbitrum WebSocket URL set (ARBITRUM_RPC_WS_URL in .env)");
    return;
  }
  const provider = new providers.WebSocketProvider(wsUrl);

  for (const pair of PAIRS) {
    const baseAddr = TOKENS[pair.base];
    const quoteAddr = TOKENS[pair.quote];
    for (const [dex, factory] of Object.entries(FACTORY_ADDRESSES)) {
      try {
        const pool = await getPoolAddress(provider, factory, baseAddr, quoteAddr, FEE);
        if (pool && pool !== ethers.constants.AddressZero) {
          console.log(`[${dex}] Pool for ${pair.base}/${pair.quote}: ${pool}`);
        } else {
          console.log(`[${dex}] Pool for ${pair.base}/${pair.quote}: Not found`);
        }
      } catch (e) {
        console.log(`[${dex}] Pool for ${pair.base}/${pair.quote}: Not found`);
      }
    }
  }
  provider.destroy();
}

printAllPools();
