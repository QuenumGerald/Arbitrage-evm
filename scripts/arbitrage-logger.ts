import { appendFileSync } from "fs";

export function logToFile(message: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}`;
  appendFileSync("arbitrage-opportunities.log", line + "\n");
  console.log(line); // <-- Ajoute ce log pour Render
}
// Log successful arbitrage trades to a separate file
export function logTradeToFile({ direction, base, quote, txHash, profitEstimate }: { direction: number, base: string, quote: string, txHash: string, profitEstimate: number }) {
  const timestamp = new Date().toISOString();
  const dirStr = direction === 0 ? 'Uniswap->PancakeSwap' : 'PancakeSwap->Uniswap';
  const line = `[${timestamp}] TRADE | ${dirStr} | ${base}/${quote} | txHash: ${txHash} | profitEstimate: ${profitEstimate}`;
  try {
    appendFileSync("arbitrage-trades.log", line + "\n");
  } catch (err) {
    console.error('[ERROR][logTradeToFile] Could not write to arbitrage-trades.log:', err);
  }
  console.log(line);
}

// For ESM/ts-node interop
export {};

