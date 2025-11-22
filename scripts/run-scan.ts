import "./setup-env";
import { scanAllFiles } from "../lib/indexer";

async function runScan() {
  console.log("Running full scan of all documents...");
  const result = await scanAllFiles();
  console.log("Scan result:", result);
}

runScan();
