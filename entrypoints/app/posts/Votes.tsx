import { useState } from 'react';
import { ArrowBigDown, ArrowBigUp, Bookmark, BookmarkCheck } from 'lucide-react';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { useToast } from '@astryxdesign/core/Toast';
import { save, vote } from '@/utils/reddit';
import { compactNumber } from './format';

const value = (likes: boolean | null) => (likes === true ? 1 : likes === false ? -1 : 0);

/**
 * Up- and downvote buttons around the score. A vote shows right away and is
 * taken back if Reddit refuses it. Archived and locked items can't be voted on.
 */
export function Votes({
  fullname,
  score,
  likes,
  isScoreHidden = false,
  isDisabled = false,
}: {
  fullname: string;
  score: number;
  likes: boolean | null;
  isScoreHidden?: boolean;
  isDisabled?: boolean;
}) {
  const showToast = useToast();
  // The vote as the user last made it here; Reddit's score already counts the
  // vote it sent, so only the difference is added.
  const [current, setCurrent] = useState(likes);
  const shownScore = score - value(likes) + value(current);

  const cast = async (next: boolean | null) => {
    const before = current;
    setCurrent(next);
    try {
      await vote(fullname, value(next) as 1 | 0 | -1);
    } catch (err) {
      console.warn(err);
      setCurrent(before);
      showToast({ type: 'error', body: err instanceof Error ? err.message : "The vote didn't go through" });
    }
  };

  return (
    <HStack gap={0.5} vAlign="center">
      <IconButton
        label={current === true ? 'Remove upvote' : 'Upvote'}
        icon={<Icon icon={ArrowBigUp} />}
        variant={current === true ? 'primary' : 'ghost'}
        size="sm"
        isDisabled={isDisabled}
        onClick={() => void cast(current === true ? null : true)}
      />
      <span className="score">
        <Text size="sm" weight="medium">
          {isScoreHidden ? '•' : compactNumber(shownScore)}
        </Text>
      </span>
      <IconButton
        label={current === false ? 'Remove downvote' : 'Downvote'}
        icon={<Icon icon={ArrowBigDown} />}
        variant={current === false ? 'primary' : 'ghost'}
        size="sm"
        isDisabled={isDisabled}
        onClick={() => void cast(current === false ? null : false)}
      />
    </HStack>
  );
}

/** Saves the post or comment to the user's Saved list, or takes it out. */
export function SaveButton({
  fullname,
  saved,
  onChange,
}: {
  fullname: string;
  saved: boolean;
  onChange?: (saved: boolean) => void;
}) {
  const showToast = useToast();
  const [isSaved, setIsSaved] = useState(saved);
  return (
    <IconButton
      label={isSaved ? 'Unsave' : 'Save'}
      icon={<Icon icon={isSaved ? BookmarkCheck : Bookmark} />}
      variant={isSaved ? 'primary' : 'ghost'}
      size="sm"
      onClick={async () => {
        const next = !isSaved;
        setIsSaved(next);
        try {
          await save(fullname, next);
          onChange?.(next);
        } catch (err) {
          console.warn(err);
          setIsSaved(!next);
          showToast({ type: 'error', body: err instanceof Error ? err.message : "That didn't work" });
        }
      }}
    />
  );
}
