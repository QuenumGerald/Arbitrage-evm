import hre from "hardhat";
const { ethers } = hre;
import dotenv from "dotenv";
dotenv.config();

async function main() {
  // Utiliser explicitement le wallet #8 comme déployeur
  const wallet8 = new ethers.Wallet(
    process.env.PRIVATE_KEY,
    ethers.provider
  );
  console.log("Deploying with:", wallet8.address);

  const FlashLoanArbitrageur = await ethers.getContractFactory("FlashLoanArbitrageur", wallet8);
  const arbitrageur = await FlashLoanArbitrageur.deploy(); // plus d'arguments
  await arbitrageur.deployed();

  console.log("FlashLoanArbitrageur deployed at:", arbitrageur.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

export {};
