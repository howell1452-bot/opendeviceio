// Set the Auth options the E2E run needs in a Supabase CLI config.jsonc
// (newer CLIs write JSONC instead of TOML). Uses TypeScript's JSONC reader,
// already a dev dependency, so comments and trailing commas are fine.
//   node patch-supabase-config.cjs <path/to/config.jsonc>
const fs = require("node:fs");
const ts = require("typescript");

const file = process.argv[2];
const parsed = ts.parseConfigFileTextToJson(file, fs.readFileSync(file, "utf8"));
if (parsed.error) {
  console.error(ts.flattenDiagnosticMessageText(parsed.error.messageText, "\n"));
  process.exit(1);
}
const cfg = parsed.config ?? {};
cfg.auth = cfg.auth ?? {};
cfg.auth.site_url = "http://localhost:3000";
cfg.auth.additional_redirect_urls = ["http://localhost:3000/**"];
cfg.auth.rate_limit = { ...(cfg.auth.rate_limit ?? {}), email_sent: 1000 };
cfg.auth.email = { ...(cfg.auth.email ?? {}), enable_confirmations: false };

fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      site_url: cfg.auth.site_url,
      additional_redirect_urls: cfg.auth.additional_redirect_urls,
      email_sent: cfg.auth.rate_limit.email_sent
    },
    null,
    2
  )
);
