import { ethers } from "ethers";
// NOTE : Pour exécuter ce script avec ts-node, utilisez :
//   npx ts-node --experimental-specifier-resolution=node scripts/test-flash-arbitrage.ts
// ou activez allowImportingTsExtensions dans tsconfig.json si vous importez avec .ts
// NOTE : Pour exécuter ce script avec ts-node, utilisez :
//   npx ts-node --experimental-specifier-resolution=node scripts/test-flash-arbitrage.ts
// L'import suivant nécessite l'option --experimental-specifier-resolution=node
import { getFirstAvailableUniswapPool } from "./arbitrage-scanner-arbitrum.ts";
// ABI minimale pour ERC20 (balanceOf, decimals)
const MINIMAL_ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)"
];


async function main() {
  // Adresse du contrat déployé (à adapter si besoin)
  const arbitrageurAddress = "0xff1E83ab402D4cc684c17eE62d121A6949A86d09";

  // Paramètres pour un flash loan Uniswap V3 natif
  const WETH = "0x82af49447d8a07e3bd95bd0d56f35241523fbab1";
  const USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
  const amount0 = ethers.utils.parseEther("0.036"); // WETH à emprunter
  const amount1 = 0; // On emprunte du WETH uniquement

  // Routers V3
  const UNISWAP_ROUTER = "0xe592427a0aece92de3edee1f18e0157c05861564";
  const SUSHISWAP_ROUTER = "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506";

  // Fees (Uniswap/SushiSwap V3: 500 = 0.05%, 3000 = 0.3%)
  const FEE_SUSHI = 500;
  const minProfit = ethers.utils.parseUnits("0", 6); // 0 USDC minimum de profit
  const direction = 0; // 0: WETH->USDC->WETH

  // --- Création du provider et du wallet ---
  const rpcUrl = process.env.ARBITRUM_RPC_URL;
  if (!rpcUrl) {
    throw new Error("ARBITRUM_RPC_URL n'est pas défini dans .env");
  }
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  if (!process.env.PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY n'est pas défini dans .env");
  }
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  // --- Recherche automatique du pool Uniswap V3 optimal pour WETH/USDC ---
  const { pool: poolAddress, fee: FEE_UNI } = await getFirstAvailableUniswapPool(
    provider,
    "0x1F98431c8aD98523631AE4a59f267346ea31F984", // Uniswap V3 Factory
    WETH,
    USDC
  );
  if (!poolAddress) {
    console.error("Aucun pool Uniswap V3 trouvé pour la paire WETH/USDC");
    return;
  }


  // Charger l'ABI la plus récente directement depuis artifacts
  const fs = require("fs");
  const path = require("path");
  const artifactPath = path.join(__dirname, "../artifacts/contracts/FlashLoanArbitrageur.sol/FlashLoanArbitrageur.json");
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const arbitrageur = new ethers.Contract(arbitrageurAddress, artifact.abi, wallet);

  // Crée les instances ERC20 avec ethers.Contract et l'ABI minimale
  const weth = new ethers.Contract(WETH, MINIMAL_ERC20_ABI, provider);
  const usdc = new ethers.Contract(USDC, MINIMAL_ERC20_ABI, provider);

  // Soldes avant
  const balWETHBefore = await weth.balanceOf(arbitrageurAddress);
  const balUSDCBefore = await usdc.balanceOf(arbitrageurAddress);
  console.log("Solde AVANT arbitrage - WETH:", ethers.utils.formatEther(balWETHBefore));
  console.log("Solde AVANT arbitrage - USDC:", ethers.utils.formatUnits(balUSDCBefore, 6));

  try {
    // Lancer le flash loan natif Uniswap V3
    const tx = await arbitrageur.startUniswapV3Flash(
      poolAddress,
      amount0,
      amount1,
      USDC, // tokenMid
      FEE_UNI, // fee1
      FEE_SUSHI, // fee2
      minProfit,
      direction,
      UNISWAP_ROUTER,
      SUSHISWAP_ROUTER,
      { gasLimit: 3_000_000 }
    );
    console.log("Flash loan TX envoyée:", tx.hash);
    const receipt = await tx.wait();
    console.log("Flash loan TX minée:", receipt.transactionHash);
    // Afficher les logs d'événements ArbitrageExecuted
    const event = receipt.events?.find((e: any) => e.event === "ArbitrageExecuted");
    if (event) {
      console.log("ArbitrageExecuted event:", event.args);
    } else {
      console.log("Aucun événement ArbitrageExecuted détecté (peut-être revert ou pas de profit)");
    }
  } catch (err) {
    const e = err as any;
    console.error("Erreur lors du flash loan:", e.reason || e.error?.data || e);
  }

  // Soldes après
  const balWETHAfter = await weth.balanceOf(arbitrageurAddress);
  const balUSDCAfter = await usdc.balanceOf(arbitrageurAddress);
  console.log("Solde APRÈS arbitrage - WETH:", ethers.utils.formatEther(balWETHAfter));
  console.log("Solde APRÈS arbitrage - USDC:", ethers.utils.formatUnits(balUSDCAfter, 6));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

export { };
