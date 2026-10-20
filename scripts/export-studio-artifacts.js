const fs = require("fs");
const path = require("path");

const names = ["ArticStudioFactory", "ArticArtMarket", "ArticAuctionHouse"];
const exported = Object.fromEntries(names.map((name) => {
  const artifact = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "artifacts", "contracts", `${name}.sol`, `${name}.json`), "utf8"));
  return [name, { abi: artifact.abi, bytecode: artifact.bytecode }];
}));
fs.mkdirSync(path.join(__dirname, "..", "lib", "contracts"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "..", "lib", "contracts", "studio-deployments.json"), JSON.stringify(exported));
console.log("Exported public studio deployment artifacts.");
