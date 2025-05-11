import 'dotenv/config';
import { HardhatUserConfig } from "hardhat/config";
import "@nomiclabs/hardhat-ethers";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 200
      },
    },
  },
  networks: {
    hardhat: {
      forking: {
        url: process.env.ARBITRUM_FORK_RPC_URL || "",
        blockNumber: 335401651, // Optionally fix a block for deterministic tests
      },
    },
    arbitrum: {
      url: process.env.ARBITRUM_RPC_URL || "",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    base: {
      url: process.env.BASE_RPC_URL || "",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
};

export default config;
