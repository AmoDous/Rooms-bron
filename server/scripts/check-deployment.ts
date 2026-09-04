import "dotenv/config";
import { deploymentReport } from "../src/deployment.js";

const report = deploymentReport(process.env);
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("Rooms deployment preflight (configuration only; no network requests)\n");
  for (const item of report.checks) console.log(`[${item.status.toUpperCase()}] ${item.id}: ${item.message}`);
  console.log(`\n${report.ok ? "Configuration checks passed; complete external verification before launch." : "Live launch is blocked. Resolve the FAIL items before accepting real bookings/payments."}`);
}
process.exitCode = report.ok ? 0 : 1;
