import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Plain edge deploy: no incremental cache — every staff page is force-dynamic
// and the menu is memoised in-process for 30s, so there is nothing to cache.
export default defineCloudflareConfig({});
