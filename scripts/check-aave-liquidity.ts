const hre = require("hardhat");
const ethers = hre.ethers;

async function main() {
  // Pool et token WETH sur Arbitrum
  const POOL = "0x794a61358D6845594F94dc1DB02A252b5b4814aD"; // Pool Aave Arbitrum
  const WETH = "0x82af49447d8a07e3bd95bd0d56f35241523fbab1";

  // Utilise l'interface IERC20 d'OpenZeppelin (présente dans node_modules)
  const erc20 = await ethers.getContractAt("IERC20", WETH);
  const balance = await erc20.balanceOf(POOL);
  console.log("WETH balance in Aave Pool:", ethers.utils.formatEther(balance));
}

main().catch(console.error);

export {};

