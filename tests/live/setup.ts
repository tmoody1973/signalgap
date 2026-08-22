// Live tests talk to the real deployment and the real SerpApi, so they need the
// same secrets the Convex CLI uses. Loading .env.local here means `npm run
// test:live` works on its own — no `set -a; . ./.env.local` ritual to forget.
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
