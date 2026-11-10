import { NotLoggedInError, fetchSaved } from '@/utils/reddit';
import { loadAccount } from '../account';
import { createList } from '../posts/list';
import { PostListView } from '../posts/PostListView';

/** The posts and comments the user saved, latest saved first */
export const saved = createList(async (after) => {
  const account = await loadAccount();
  if (!account) throw new NotLoggedInError();
  return fetchSaved(account.name, after);
});

export function SavedPage() {
  return (
    <PostListView
      title="Saved"
      list={saved}
      loadingText="Loading saved posts…"
      empty={{ title: 'Nothing saved', description: 'Save posts and comments with the bookmark button.' }}
    />
  );
}
