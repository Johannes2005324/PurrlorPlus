import { useState } from 'react';
import { Avatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { useOwnProfile } from '../../matrix/hooks/useOwnProfile';
import { firstUnseenIndex, hasUnseen, type StoryReel } from '../../matrix/stories';
import type { StoriesState } from '../../matrix/hooks/useStories';
import { StoryComposer } from './StoryComposer';
import { StoryViewer } from './StoryViewer';
import './Stories.css';

function Bubble({
  reel,
  unseen,
  label,
  onOpen,
}: {
  reel: Pick<StoryReel, 'name' | 'avatarUrl'>;
  unseen: boolean;
  label: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={unseen ? 'nu-stories__bubble nu-stories__bubble--unseen' : 'nu-stories__bubble'}
      data-nu-role="story-bubble"
      aria-label={label}
      onClick={onOpen}
    >
      <span className="nu-stories__ring">
        <Avatar name={reel.name} mxcUrl={reel.avatarUrl ?? null} size={56} />
      </span>
      <span className="nu-stories__name">{reel.name}</span>
    </button>
  );
}

/**
 * The row of stories at the top of Home: yours first (or a button to add one), then each person you
 * follow with a live story, a bright ring on anyone with stories you haven't watched.
 */
export function StoriesBar({ stories }: { stories: StoriesState }) {
  const mx = useMatrixClient();
  const me = mx.getUserId() ?? '';
  const profile = useOwnProfile();
  const ownName = profile.displayName || me;
  const [composing, setComposing] = useState(false);
  const [viewing, setViewing] = useState<{ reels: StoryReel[]; reel: number; story: number }>();

  const own = stories.own?.stories.length ? stories.own : undefined;
  const { others, seen } = stories;
  // Watching runs on from one person to the next, in the row's order.
  const watchable = [...(own ? [own] : []), ...others];

  const open = (reel: StoryReel) => {
    const index = watchable.indexOf(reel);
    setViewing({ reels: watchable, reel: index, story: firstUnseenIndex(reel, seen) });
  };

  return (
    <section className="nu-home__section nu-stories" data-nu-role="home-stories" aria-label="Stories">
      <div className="nu-stories__row">
        <div className="nu-stories__own">
          {own ? (
            <Bubble reel={{ name: 'Your story', avatarUrl: profile.avatarUrl ?? undefined }} unseen={false} label="Watch your story" onOpen={() => open(own)} />
          ) : (
            <Bubble reel={{ name: 'Your story', avatarUrl: profile.avatarUrl ?? undefined }} unseen={false} label="Add a story" onOpen={() => setComposing(true)} />
          )}
          <button type="button" className="nu-stories__add" data-nu-role="story-add" aria-label="Add a story" onClick={() => setComposing(true)}>
            <Icon name="plus" size={14} />
          </button>
        </div>
        {others.map((reel) => (
          <Bubble
            key={reel.userId}
            reel={reel}
            unseen={hasUnseen(reel, seen)}
            label={`${reel.name}'s story${hasUnseen(reel, seen) ? ', new' : ''}`}
            onOpen={() => open(reel)}
          />
        ))}
        {others.length === 0 && !stories.loading && (
          <p className="nu-stories__hint">Stories from people you follow show up here for 24 hours.</p>
        )}
      </div>
      {composing && (
        <StoryComposer
          displayName={ownName}
          onClose={() => setComposing(false)}
          onPosted={() => {
            setComposing(false);
            stories.refresh();
          }}
        />
      )}
      {viewing && (
        <StoryViewer
          reels={viewing.reels}
          startReel={viewing.reel}
          startStory={viewing.story}
          onClose={() => setViewing(undefined)}
          onDeleted={stories.refresh}
        />
      )}
    </section>
  );
}
