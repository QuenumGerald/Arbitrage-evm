const hre = require("hardhat");
const ethers = hre.ethers;

async function main() {
  // Pool et token WETH sur Ethereum Mainnet
  const POOL = "0x794a61358D6845594F94dc1DB02A252b5b4814aD"; // Pool Aave V2 Ethereum Mainnet
  const WETH = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"; // WETH Mainnet

  // Utilise l'interface IERC20 d'OpenZeppelin (présente dans node_modules)
  const erc20 = await ethers.getContractAt("IERC20", WETH);
  const balance = await erc20.balanceOf(POOL);
  console.log("WETH balance in Aave V2 Mainnet Pool:", ethers.utils.formatEther(balance));
}

main().catch(console.error);

export {};

