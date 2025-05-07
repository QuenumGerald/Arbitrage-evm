"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logToFile = logToFile;
const fs_1 = require("fs");
function logToFile(message) {
    const timestamp = new Date().toISOString();
    (0, fs_1.appendFileSync)("arbitrage-opportunities.log", `[${timestamp}] ${message}\n`);
}
