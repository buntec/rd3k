import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'wxt';

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  hooks: {
    // The dev build takes its icons and favicon from public-dev (orange, not
    // teal), so it's easy to tell apart from a release installed next to it.
    // `just dev-icons` redraws them after the logo changes.
    'build:publicAssets': (wxt, files) => {
      if (wxt.config.command !== 'serve') return;
      for (const file of files) {
        if (!('absoluteSrc' in file)) continue;
        const devSrc = resolve(wxt.config.root, 'public-dev', file.relativeDest);
        if (existsSync(devSrc)) file.absoluteSrc = devSrc;
      }
    },
  },
  // The browsers the release builds for; WXT rejects any other `-b` value.
  targetBrowsers: ['chrome', 'edge', 'firefox'],
  // Firefox too: WXT defaults it to MV2, which has no browser.action.
  manifestVersion: 3,
  manifest: ({ browser, command }) => ({
    name: 'rd3k',
    description: 'A decluttered UI for Reddit',
    permissions: ['storage'],
    // www.reddit.com: the extension page reads Reddit's pages and JSON with
    // the browser's Reddit login, and votes and saves as that account.
    // v.redd.it: the playlists of Reddit-hosted videos, which the player
    // fetches itself (hls.js), since only Safari plays HLS natively.
    host_permissions: ['*://www.reddit.com/*', '*://v.redd.it/*'],
    action: { default_title: 'Open rd3k' },
    // An unpacked extension's ID, which its stored groups and subscriptions
    // belong to, otherwise depends on the folder it's loaded from. This public
    // key fixes the ID (jhaoakgedhcjafkaflokpjkjmenhjeie), so a release unzipped
    // to a new folder keeps them. The dev build keeps a separate ID.
    ...(browser !== 'firefox' &&
      command === 'build' && {
        key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqTdJifDPwvEHulpkt9S4S5EZ3y4uoR4rZH+8kPO0CTG+uwiYn02FVxdLJJ4gtA4u8yo7iNqgvCMPyZqLZuTtigE8DEsg5oqcJWtjJkxFB8+W1fF0gh0+y569h8V0WD9gSjEHQTtEsRuTvU+xHIY6nsTGmNNo4DEzi1t37IuooFgo1/K42OI64kMECztZVA4NNol/3HoNrUa5+C3Zc+lpGwrvsw7DLDxhSn7R2oWe1VAIrTTB2e2eaxIoBzb4lsONJfR1kcVtL+R1v4i/6ggyHTr2cigX5kEwZi1TWeBQQg7/nnJZE2HUQ/2YKvhKsUcaaZhv4rmN/iMcg4YxLPuTswIDAQAB',
      }),
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          // Firefox needs a fixed ID for MV3 add-ons and to sign them. The dev
          // build gets its own, so loading it doesn't hide an installed release.
          id: command === 'serve' ? 'rd3k-dev@buntec.github.io' : 'rd3k@buntec.github.io',
          strict_min_version: '142.0',
          // Where a signed .xpi looks for updates; the release workflow
          // publishes this file next to it.
          update_url: 'https://github.com/buntec/rd3k/releases/latest/download/updates.json',
          // rd3k sends nothing anywhere but Reddit.
          data_collection_permissions: { required: ['none'] },
        },
      },
    }),
  }),
});
