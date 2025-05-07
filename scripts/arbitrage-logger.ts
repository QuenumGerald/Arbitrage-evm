import { appendFileSync } from "fs";

export function logToFile(message: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}`;
  appendFileSync("arbitrage-opportunities.log", line + "\n");
  console.log(line); // <-- Ajoute ce log pour Render
}
// For ESM/ts-node interop
export {};
