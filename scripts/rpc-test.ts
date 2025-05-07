import { JsonRpcProvider, WebSocketProvider } from "ethers";
import dotenv from "dotenv";
dotenv.config();

const RPCS = [
  { name: "Base HTTP", url: process.env.BASE_RPC_URL },
  { name: "Base WS", url: process.env.BASE_RPC_WS_URL },
  { name: "Arbitrum HTTP", url: process.env.ARBITRUM_RPC_URL },
  { name: "Arbitrum WS", url: process.env.ARBITRUM_RPC_WS_URL },
];

async function testRPCs() {
  for (const { name, url } of RPCS) {
    if (!url) {
      console.log(`${name}: No URL set in .env`);
      continue;
    }
    try {
      const provider = url.startsWith('ws') ? new WebSocketProvider(url) : new JsonRpcProvider(url);
      const block = await provider.getBlockNumber();
      console.log(`${name}: Block ${block}`);
      if (provider instanceof WebSocketProvider) provider.destroy();
    } catch (e) {
      console.error(`${name} failed:`, e);
    }
  }
}

testRPCs();
