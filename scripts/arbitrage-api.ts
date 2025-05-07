import express from "express";
import fs from "fs";
import path from "path";

const app = express();
const PORT = process.env.PORT || 3000;
const LOG_FILE = path.join(process.cwd(), "arbitrage-opportunities.log");

app.get("/", (req, res) => {
  res.send(`<h1>Arbitrage Opportunities API</h1><p>GET /opportunities pour voir les résultats.</p>`);
});

app.get("/opportunities", (req, res) => {
  fs.readFile(LOG_FILE, "utf8", (err, data) => {
    if (err) {
      return res.status(500).json({ error: "Log file not found." });
    }
    // Retourne les 100 dernières lignes (ou moins)
    const lines = data.trim().split("\n");
    const last = lines.slice(-100);
    res.json({ count: last.length, opportunities: last });
  });
});

app.listen(PORT, () => {
  console.log(`Arbitrage API listening on port ${PORT}`);
});
