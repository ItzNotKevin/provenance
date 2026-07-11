import { createServer } from "node:http";
import { PORT } from "./config.ts";
import { createRequestHandler } from "./http.ts";

const server = createServer(createRequestHandler());

server.listen(PORT, () => {
  console.log(`provenance backend listening on :${PORT}`);
});
