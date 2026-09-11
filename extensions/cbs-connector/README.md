# Iron Tuna CBS Connector — test version

This extension attempts to obtain the API token declared by the signed-in CBS league page and passes it to Iron Tuna's existing encrypted CBS connector. No CBS password, cookie collection, or extension storage is used. This is not yet a verified live CBS connection: current CBS pages may no longer expose the historical token declaration. It fails visibly in that case.

## Install in Edge or Chrome

1. Extract the supplied ZIP to a folder you will keep.
2. In Edge, open `edge://extensions`. In Chrome, open `chrome://extensions`.
3. Turn on **Developer mode**, click **Load unpacked**, and select the extracted folder containing `manifest.json`.
4. In the browser's Extensions menu, pin **Iron Tuna CBS Connector**.
5. Open https://irontuna.com/my-league and sign in with your email link. Leave that tab open.
6. In that same browser, open your CBS football league and sign in on CBS.
7. While viewing the CBS league, click the extension and then **Connect to Iron Tuna**. Keep the popup open while it imports.
8. If the import succeeds, choose your team and click **Save my team**. Refresh My Leagues.

If it says CBS did not expose a usable API token, stop there and report that message. Do not paste a password or token into chat. A successful import is required before calling the integration complete.

## Access and privacy

The extension requests temporary access to the tab where you click it, plus access to `https://irontuna.com/*` to use your existing Iron Tuna session. It only accepts HTTPS CBS football league hosts as sources. It reads a specific inline API-token declaration, not arbitrary browser storage, cookies, or login fields. Clicking Connect explicitly sends the token to Iron Tuna over HTTPS; the existing server validates all league resources before encrypting and retaining it for scheduled sync. Tokens remain in extension memory only during that attempt. Removing the extension does not disconnect a saved league: use Disconnect in My Leagues to delete its token and imported data.

## Validation

Run `node tools/test-cbs-extension.mjs` from the repository root. Tests cover host restrictions, token absence/ambiguity, serialization of injected functions, request allowlisting and redacted responses. A real browser installation, real token extraction, and a complete import remain required release checks. Do not publish to an extension store as production-ready before those pass.
