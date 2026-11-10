import { Activity, useEffect, useState } from 'react';
import { AppShell } from '@astryxdesign/core/AppShell';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { HStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { Theme } from '@astryxdesign/core/theme';
import { TopNav, TopNavHeading, TopNavItem } from '@astryxdesign/core/TopNav';
import { defaultThemeSlug, themes } from '@/astryx-themes';
import { AccountStatus } from './account';
import { FeedPage, PopularPage } from './feed/FeedPage';
import { PAGES, type PageRoute, type Route, routeHref, useRoute } from './router';
import { SavedPage } from './saved/SavedPage';
import { SubredditPage } from './subreddit/SubredditPage';
import { SubscriptionsPage } from './subscriptions/SubscriptionsPage';
import { ThreadPage } from './thread/ThreadPage';
import { type ThemeMode, setThemeMode, useThemeMode } from './theme';
import { SharedTooltip } from './tooltip';

// From package.json, which the release sets from its tag: 0.0.0 in dev builds.
const VERSION = browser.runtime.getManifest().version;

export function App() {
  const route = useRoute();
  const mode = useThemeMode();
  // Subs stays mounted, hidden, once shown: rendering its hundreds of posts
  // again takes long enough to notice on every return from a thread.
  const [keepSubs, setKeepSubs] = useState(route.page === 'subs');
  if (route.page === 'subs' && !keepSubs) setKeepSubs(true);

  useEffect(() => {
    // A thread sets its own title once loaded.
    if (route.page === 'thread') return;
    document.title = `${titleOf(route)} · rd3k`;
  }, [route]);

  return (
    <Theme theme={themes[defaultThemeSlug]} mode={mode}>
      <AppShell
        mobileNav={{ breakpoint: 'md' }}
        topNav={
          <TopNav
            label="Pages"
            heading={
              <TopNavHeading
                logo={<img className="logo" src="/favicon.svg" alt="" />}
                logoLabel="rd3k"
                headingHref={routeHref({ page: 'subs' })}
              />
            }
            startContent={(Object.keys(PAGES) as PageRoute[]).map((page) => (
              <TopNavItem
                key={page}
                label={PAGES[page]}
                href={routeHref({ page })}
                isSelected={page === route.page}
              />
            ))}
            endContent={
              <HStack gap={4} vAlign="center">
                <Text type="supporting">v{VERSION}</Text>
                <SegmentedControl
                  label="Theme"
                  size="sm"
                  value={mode}
                  onChange={(value) => setThemeMode(value as ThemeMode)}
                >
                  <SegmentedControlItem value="system" label="System" />
                  <SegmentedControlItem value="light" label="Light" />
                  <SegmentedControlItem value="dark" label="Dark" />
                </SegmentedControl>
                <AccountStatus />
              </HStack>
            }
          />
        }
      >
        {keepSubs && (
          <Activity mode={route.page === 'subs' ? 'visible' : 'hidden'}>
            <SubscriptionsPage />
          </Activity>
        )}
        {route.page !== 'subs' && <Page route={route} />}
      </AppShell>
      <SharedTooltip />
    </Theme>
  );
}

function Page({ route }: { route: Route }) {
  switch (route.page) {
    case 'feed':
      return <FeedPage />;
    case 'popular':
      return <PopularPage />;
    case 'saved':
      return <SavedPage />;
    case 'subreddit':
      return <SubredditPage name={route.name} />;
    case 'thread':
      return <ThreadPage key={`${route.postId}/${route.commentId}`} postId={route.postId} commentId={route.commentId} />;
    default:
      return null;
  }
}

function titleOf(route: Route): string {
  if (route.page === 'subreddit') return `r/${route.name}`;
  if (route.page === 'thread') return 'Thread';
  return PAGES[route.page];
}
