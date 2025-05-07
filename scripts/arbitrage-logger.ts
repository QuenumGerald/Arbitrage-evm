import { appendFileSync } from "fs";

export function logToFile(message: string) {
  const timestamp = new Date().toISOString();
  appendFileSync("arbitrage-opportunities.log", `[${timestamp}] ${message}\n`);
}
// For ESM/ts-node interop
export {};
