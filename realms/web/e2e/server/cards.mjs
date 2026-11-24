// The card layer as a CDN serves it, for the e2e suite against the real realm server: the web client's built page as
// static files on a port of its own (scripts/cardLayer.mjs), another origin than the overworld's and the server's.
// `node cards.mjs <port>`.
import { cardLayerBuilt, cardLayerRoot, serveCardLayer } from "../../scripts/cardLayer.mjs";

if (!cardLayerBuilt()) {
  console.error(`The web client is not built at ${cardLayerRoot}: dotnet build dotnet\src\Cantrip.Client.Web first.`);
  process.exit(1);
}
await serveCardLayer(Number(process.argv[2] ?? 5197));
