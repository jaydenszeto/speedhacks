/** Vercel entry: the lab API as a Node (req, res) handler. Bundled by scripts/build-vercel.ts; see app.ts for routes. */
import { getRequestListener } from "@hono/node-server";
import { app } from "./app.js";

export default getRequestListener(app.fetch);
