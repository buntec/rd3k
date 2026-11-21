# rd3k

A decluttered Reddit client as a browser extension for Firefox and Chromium browsers
(Chrome, Edge, etc.). Instead of modifying reddit.com, clicking the toolbar button
opens a standalone page using your existing browser login.

- **Subs**: Your subscriptions sorted by most recent activity, each showing its newest
  posts. Organize and filter subreddits with color-coded groups (exportable and
  importable).
- **Feed**: Your ad-free home feed (Best), with post hiding.
- **Popular**: `r/popular`.
- **Saved**: Your saved posts and comments.
- **Threads**: Posts with inline media (images, galleries, Reddit videos with sound)
  and collapsible comments (up to ~500, with **Continue this thread**).

Vote and save anywhere, subscribe from subreddit pages, and press `/` to search loaded
content.

Logged in to more than one Reddit account? rd3k uses the one reddit.com has active:
switch accounts there and rd3k follows, with each account's subscriptions and groups
kept apart.

## Install

Download a build from the [releases](https://github.com/buntec/rd3k/releases):

- **Chrome** and other Chromium browsers: unzip `rd3k-x.y.z-chrome.zip`, enable
  **Developer mode** in `chrome://extensions`, click **Load unpacked** and pick the
  folder. Update the same way; your data is kept.
- **Edge**: the same with `rd3k-x.y.z-edge.zip` in `edge://extensions`.
- **Firefox**: open `rd3k-x.y.z-firefox.xpi` in Firefox and confirm. It updates
  itself.

## Disclaimer

rd3k is unofficial and not affiliated with Reddit. Reddit has closed its public API
and blocks much of what its web pages and JSON used to offer, even to logged-in
users, so rd3k uses what still works: some of reddit.com's JSON, and the web page of
each subreddit's newest posts. Parts may break, or go away, whenever Reddit changes
those. It stays within Reddit's rate limits and waits when it reaches them. Votes,
saves and subscriptions apply to your real account. rd3k collects nothing: it talks
only to Reddit. Use it at your own risk.

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md). Built with [WXT](https://wxt.dev), React and
[Astryx](https://astryx.atmeta.com). Licensed under [MIT](LICENSE).
