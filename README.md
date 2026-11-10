# rd3k

A decluttered Reddit UI as a browser extension for Firefox, Chrome, Edge and other
Chromium browsers. Rather than altering reddit.com, its toolbar button opens a page
of its own, logged in with the Reddit account you use in that browser.

- **Subs**: your subscriptions, the one posted in most recently first, each with its
  newest posts. Sort subreddits into colored groups and filter by them; groups can be
  exported and imported.
- **Feed**: your home feed (Best), without ads, with **Hide**.
- **Popular**: r/popular.
- **Saved**: the posts and comments you saved.
- **Threads**: a post with its media (images, galleries, Reddit videos with sound)
  and up to about 500 comments, collapsible, with **Continue this thread**.

Vote and save anywhere, subscribe from a subreddit's page, and search what's loaded
with `/`.

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
