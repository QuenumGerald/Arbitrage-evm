import { ethers } from "ethers";
import hre from "hardhat";

// Types utilitaires
type BigNumber = ethers.BigNumber;
type BigNumberish = ethers.BigNumberish;
type ContractTransaction = ethers.ContractTransaction;
type Contract = ethers.Contract;
import dotenv from "dotenv";

// Types pour les contrats
interface IUniswapV3Pool {
  token0(): Promise<string>;
  token1(): Promise<string>;
  liquidity(): Promise<ethers.BigNumber>;
}

interface IFlashLoanArbitrageur extends Contract {
  on(event: string, listener: (...args: any[]) => void): this;
  startUniswapV3Flash: (
    pool: string,
    amount0: BigNumberish,
    amount1: BigNumberish,
    tokenMid: string,
    fee1: number,
    fee2: number,
    minProfit: number,
    direction: number,
    router1: string,
    router2: string,
    options?: { gasLimit?: BigNumberish; gasPrice?: BigNumberish }
  ) => Promise<ContractTransaction>;
  
  // Ajout de la méthode estimateGas manquante
  estimateGas: {
    startUniswapV3Flash(
      pool: string,
      amount0: BigNumberish,
      amount1: BigNumberish,
      tokenMid: string,
      fee1: number,
      fee2: number,
      minProfit: number,
      direction: number,
      router1: string,
      router2: string,
      options?: { gasLimit?: BigNumberish; gasPrice?: BigNumberish }
    ): Promise<BigNumber>;
  };
}

dotenv.config();

// Paramètres pour un flash loan Uniswap V3 natif (exemple WETH/USDC sur Arbitrum)
const WETH = ethers.utils.getAddress("0x82aF49447D8a07e3bd95BD0d56f35241523fBab1");
const USDC = ethers.utils.getAddress("0xaf88d065e77c8cC2239327C5EDb3A432268e5831");

// Montant très faible pour le test initial (0.00005 WETH ~ 0.15$)
const amount0 = ethers.utils.parseEther("0.00005");
const amount1 = 0; // On ne prend pas de USDC en flash loan

// Router Uniswap V3 (arbitrage désactivé, on swap juste sur Uniswap)
const UNISWAP_ROUTER = ethers.utils.getAddress("0xE592427A0AEce92De3Edee1F18E0157C05861564");
const SUSHISWAP_ROUTER = ethers.utils.getAddress("0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506");

// Fee tiers (Uniswap V3: 500 = 0.05%, 3000 = 0.3%)
const FEE_UNI = 3000; // 0.3% de frais pour plus de liquidité
const FEE_SUSHI = 3000; // 0.3% de frais pour plus de liquidité
const minProfit = 0; // 0 profit minimum pour le test
const direction = 0; // 0: WETH->USDC->WETH

// Interface pour le router Uniswap V3
const UNISWAP_ROUTER_ABI = [
  'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) calldata) external returns (uint256 amountOut)'
];

async function main() {
  try {
    const rpcUrl = process.env.ARBITRUM_RPC_URL;
    if (!rpcUrl) throw new Error("ARBITRUM_RPC_URL n'est pas défini dans .env");

    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) throw new Error("PRIVATE_KEY n'est pas défini dans .env");

    // Configuration du provider avec timeout
    const provider = new ethers.providers.StaticJsonRpcProvider(rpcUrl, {
      name: 'arbitrum',
      chainId: 42161
    });
    
    // Configuration du timeout pour les requêtes
    provider.pollingInterval = 1000;
    
    const wallet = new ethers.Wallet(privateKey, provider);
    console.log("Portefeuille connecté:", wallet.address);

    // Adresse du contrat déployé
    const arbitrageurAddress = "0xff1E83ab402D4cc684c17eE62d121A6949A86d09";
    console.log("Contrat FlashLoanArbitrageur:", arbitrageurAddress);
    
    // S'assurer que l'adresse du contrat a un checksum valide
    const checkedArbitrageurAddress = ethers.utils.getAddress(arbitrageurAddress);
    
    // Charger le contrat avec l'ABI de base (les événements seront typés dynamiquement)
    const arbitrageur = new ethers.Contract(
      checkedArbitrageurAddress,
      [
        'event ArbitrageExecuted(address indexed initiator, address indexed asset, uint256 profit)',
        'event Debug(string message)',
        'function startUniswapV3Flash(address,uint256,uint256,address,uint24,uint24,uint256,uint8,address,address) external'
      ],
      wallet
    ) as unknown as IFlashLoanArbitrageur;
    
    // Configuration des écouteurs d'événements
    arbitrageur.on("ArbitrageExecuted", (initiator: string, asset: string, profit: BigNumber) => {
      console.log("\n=== ÉVÉNEMENT: Arbitrage exécuté avec succès ===");
      console.log("Initiateur:", initiator);
      console.log("Actif:", asset);
      console.log("Profit réalisé:", ethers.utils.formatUnits(profit, 18), "tokens");
      console.log("========================================\n");
    });

    arbitrageur.on("Debug", (message: string) => {
      console.log(`[DEBUG] ${message}`);
    });

    // Adresse de la pool WETH/USDC sur Uniswap V3 (avec checksum)
    const poolAddress = ethers.utils.getAddress("0xC6962004f452bE9203591991D15f6b388e09e8D0");
    console.log("Pool Uniswap V3 WETH/USDC:", poolAddress);
    console.log(`Montant du flash loan: ${ethers.utils.formatEther(amount0)} WETH`);

    console.log("\n=== DÉBUT DE LA SIMULATION ===");
    
    // Vérification des balances avant la transaction
    const ethBalance = await provider.getBalance(wallet.address);
    console.log(`Balance ETH: ${ethers.utils.formatEther(ethBalance)} ETH`);
    
    // Estimation du gas
    console.log("\nEstimation du gas...");
    
    try {
      const gasEstimate = await arbitrageur.estimateGas.startUniswapV3Flash(
        poolAddress,
        amount0,
        amount1,
        USDC,
        FEE_UNI,
        FEE_SUSHI,
        minProfit,
        direction,
        UNISWAP_ROUTER,
        SUSHISWAP_ROUTER
      );
      console.log("✅ Estimation de gas réussie:", gasEstimate.toString());
      
      // Ajout d'une marge de sécurité (x1.5)
      const gasLimit = Math.floor(gasEstimate.toNumber() * 1.5);
      console.log(`Limite de gas avec marge de sécurité: ${gasLimit}`);
      
      // Récupération du prix du gas
      const gasPrice = await provider.getGasPrice();
      console.log(`Prix du gas: ${ethers.utils.formatUnits(gasPrice, 'gwei')} gwei`);
      
      // Calcul du coût estimé
      const estimatedCost = gasPrice.mul(gasLimit);
      console.log(`Coût estimé: ${ethers.utils.formatEther(estimatedCost)} ETH`);
      
    } catch (error: any) {
      console.error("❌ Erreur lors de la simulation:", error.reason || error.message);
      if (error.data) {
        console.error("Raison du revert:", error.data.message || error.data);
      }
      throw error;
    }

    // Vérifier la liquidité de la pool avant de tenter le flash loan
    console.log("Vérification de la liquidité de la pool...");
    const poolContract = new ethers.Contract(
      poolAddress,
      ['function token0() view returns (address)', 'function token1() view returns (address)', 'function liquidity() view returns (uint128)'],
      provider
    ) as unknown as IUniswapV3Pool;
    
    const [token0, token1, liquidity] = await Promise.all([
      poolContract.token0(),
      poolContract.token1(),
      poolContract.liquidity()
    ]);
    
    console.log("Détails de la pool:");
    console.log("- Token 0:", token0);
    console.log("- Token 1:", token1);
    console.log("- Liquidité totale:", liquidity.toString());
    
    // Vérifier les balances du contrat
    const token0Contract = new ethers.Contract(token0, ['function balanceOf(address) view returns (uint256)'], provider);
    const token1Contract = new ethers.Contract(token1, ['function balanceOf(address) view returns (uint256)'], provider);
    
    const [balance0, balance1] = await Promise.all([
      token0Contract.balanceOf(arbitrageurAddress),
      token1Contract.balanceOf(arbitrageurAddress)
    ]);
    
    console.log("Balances du contrat avant le flash loan:");
    console.log("- Balance token0:", balance0.toString());
    console.log("- Balance token1:", balance1.toString());
    
    // Si la simulation passe, on envoie la vraie transaction
    console.log("\n=== LANCEMENT DE LA TRANSACTION ===");
    
    try {
      // Afficher les paramètres pour le débogage
      console.log("\nParamètres du flash loan:");
      console.log("- Pool:", poolAddress);
      console.log("- Montant WETH:", ethers.utils.formatEther(amount0));
      console.log("- Montant USDC:", amount1);
      console.log("- Frais Uniswap (0.3%):", FEE_UNI);
      console.log("- Frais SushiSwap (0.3%):", FEE_SUSHI);
      console.log("- Direction:", direction === 0 ? "WETH->USDC->WETH" : "USDC->WETH->USDC");
      console.log("- Router Uniswap:", UNISWAP_ROUTER);
      console.log("- Router SushiSwap:", SUSHISWAP_ROUTER);
      
      // Envoi de la transaction avec des paramètres de gaz optimisés
      console.log("\nEnvoi de la transaction...");
      
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
        { 
          gasLimit: 5_000_000, // Limite de gaz généreuse
          gasPrice: (await provider.getGasPrice()).mul(12).div(10) // Prix du gaz +20%
        }
      );
      
      console.log("\n✅ Transaction envoyée avec succès!");
      console.log("Hash de la transaction:", tx.hash);
      
      console.log("\nEn attente de la confirmation...");
      const receipt = await tx.wait();
      
      console.log("\n=== TRANSACTION CONFIRMÉE ===");
      console.log("Bloc:", receipt.blockNumber);
      console.log("Hash:", receipt.transactionHash);
      console.log("Statut:", receipt.status === 1 ? "Succès" : "Échec");
      console.log("Gas utilisé:", receipt.gasUsed.toString());
      
      // Vérifier les événements émis
      if (receipt.events && receipt.events.length > 0) {
        console.log("\nÉvénements émis:");
        for (const event of receipt.events) {
          if (event.event === "Debug") {
            console.log(`[DEBUG] ${event.args?.message}`);
          } else if (event.event === "ArbitrageExecuted") {
            console.log(`[ARBITRAGE] Profit: ${ethers.utils.formatUnits(event.args?.profit, 18)}`);
          }
        }
      }
    } catch (error: any) {
      console.error("\n❌ Erreur lors de l'exécution du flash loan:");
      console.error("Message:", error.message);
      
      if (error.reason) {
        console.error("Raison du revert:", error.reason);
      }
      
      if (error.transaction) {
        console.error("Transaction qui a échoué:", error.transaction.hash);
      }
      
      // Essayer d'extraire plus d'informations de l'erreur
      if (error.error?.data) {
        console.error("Données d'erreur:", error.error.data);
      }
      
      process.exit(1);
    }
  } catch (error: any) {
    console.error("❌ Erreur inattendue:", error.message);
    if (error.reason) {
      console.error("Raison:", error.reason);
    }
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Erreur dans le flux principal:", error);
    process.exit(1);
  });
