import { afterEach, describe, expect, it, vi, beforeAll } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider as JotaiProvider, createStore } from 'jotai';
import { MatrixClientContext } from '../matrix/MatrixClientContext';
import {
  globalFeedOpenAtom,
  selectedRoomIdAtom,
  selectedSpaceIdAtom,
  selectedSpaceViewAtom,
  socialSpaceIdAtom,
  socialViewAtom,
  type SocialView,
} from '../app/state/selection';
import { ChannelList } from '../features/channels/ChannelList';
import { FeedView } from '../features/feed/FeedView';
import { GlobalFeedView } from '../features/feed/GlobalFeedView';
import { ProfileView } from '../features/feed/ProfileView';
import { CalendarView } from '../features/calendar/CalendarView';
import { SpaceReportsSettings } from '../features/servers/SpaceReportsSettings';
import { MainPane } from '../features/messaging/MainPane';
import { MessageTimeline } from '../features/messaging/MessageTimeline';
import { ActivityWatcher } from '../features/notifications/ActivityWatcher';
import { AccountSettingsModal } from '../app/AccountSettingsModal';
import { createDemoClient } from './demoClient';
import { SPACE_NEWS_EVENT } from '../matrix/spaceNews';
import { DEMO_OUTSIDE_SPACE, DEMO_ROOM_IDS } from './demoWorld';

const DEMO_LUNA = DEMO_OUTSIDE_SPACE.author;

/**
 * The claim demo mode has to earn: the real components render against the fake client. Seeding
 * plausible-looking data isn't worth much on its own — what matters is that the app's actual
 * channel list and timeline mount and show it, with no homeserver anywhere.
 */

beforeAll(() => {
  // jsdom has neither, and both are reached during an ordinary render of these components.
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
    root = null;
    rootMargin = '';
    thresholds = [];
  } as unknown as typeof IntersectionObserver;
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  // The composer asks whether it's on a phone-sized layout before taking focus.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

// vitest runs without `globals`, so Testing Library never gets to register its own automatic
// cleanup — without this every render in this file stacks up in the same document and queries
// start matching elements left behind by earlier tests.
afterEach(cleanup);

function renderWithDemo(
  ui: React.ReactElement,
  selected: { spaceId?: string | null; roomId?: string | null; globalFeed?: boolean; socialView?: SocialView } = {}
) {
  const mx = createDemoClient();
  const store = createStore();
  if (selected.spaceId !== undefined) store.set(selectedSpaceIdAtom, selected.spaceId);
  if (selected.roomId !== undefined) store.set(selectedRoomIdAtom, selected.roomId);
  if (selected.globalFeed) store.set(globalFeedOpenAtom, true);
  if (selected.socialView) store.set(socialViewAtom, selected.socialView);

  return {
    mx,
    store,
    ...render(
      <JotaiProvider store={store}>
        <MatrixClientContext.Provider value={mx}>{ui}</MatrixClientContext.Provider>
      </JotaiProvider>
    ),
  };
}

describe('ChannelList against the demo world', () => {
  it('renders the configured Space with its categories and channels', () => {
    renderWithDemo(<ChannelList />, { spaceId: DEMO_ROOM_IDS.cafe });

    expect(screen.getByText('Cat Café')).toBeInTheDocument();
    expect(screen.getByText('Text channels')).toBeInTheDocument();
    expect(screen.getByText('Voice channels')).toBeInTheDocument();
    expect(screen.getByText('general')).toBeInTheDocument();
    expect(screen.getByText('Lounge')).toBeInTheDocument();
    expect(screen.getByText('AFK')).toBeInTheDocument();
  });

  it('renders the Home view with the seeded DMs', () => {
    renderWithDemo(<ChannelList />, { spaceId: null });

    expect(screen.getByText('Direct messages')).toBeInTheDocument();
    expect(screen.getByText('Nibbles')).toBeInTheDocument();
    expect(screen.getByText('Weekend Plans')).toBeInTheDocument();
  });

  it('distinguishes voice channels from text ones by icon', () => {
    renderWithDemo(<ChannelList />, { spaceId: DEMO_ROOM_IDS.cafe });

    const rows = screen.getAllByRole('button', { name: /Lounge|general/ });
    const lounge = rows.find((r) => r.textContent?.includes('Lounge'));
    const general = rows.find((r) => r.textContent?.includes('general'));
    expect(lounge?.querySelector('[data-nu-icon="volume"]')).not.toBeNull();
    expect(general?.querySelector('[data-nu-icon="hash"]')).not.toBeNull();
  });
});

describe('MessageTimeline against the demo world', () => {
  it('renders the seeded conversation, markdown and reactions included', () => {
    renderWithDemo(<MessageTimeline roomId={DEMO_ROOM_IDS.general} onReply={() => {}} />);

    expect(screen.getByText(/welcome to the café/)).toBeInTheDocument();
    // Markdown in the body is parsed into real elements, not shown as literal asterisks.
    expect(screen.getByText('H.264').tagName).toBe('STRONG');
    expect(screen.getByText('60fps').tagName).toBe('EM');
    // The two seeded 🔥 annotations aggregate into one pill with a count.
    expect(screen.getByText('🔥')).toBeInTheDocument();
    expect(screen.queryByText(/\*\*H\.264\*\*/)).not.toBeInTheDocument();
  });

  it('shows sender display names rather than raw Matrix IDs', () => {
    renderWithDemo(<MessageTimeline roomId={DEMO_ROOM_IDS.general} onReply={() => {}} />);
    expect(screen.getAllByText('Nibbles').length).toBeGreaterThan(0);
    expect(screen.queryByText(/@nibbles:demo\.purrlor/)).not.toBeInTheDocument();
  });
});

describe('FeedView against the demo world', () => {
  it('merges every member’s posts into one hub timeline, newest first', async () => {
    renderWithDemo(<FeedView space={createDemoClient().getRoom(DEMO_ROOM_IDS.cafe)!} />, {
      spaceId: DEMO_ROOM_IDS.cafe,
    });

    expect(await screen.findByText(/movie night friday/)).toBeInTheDocument();
    expect(screen.getByText(/anyone else up at 3am/)).toBeInTheDocument();
    // Posts live in one room per author; the hub view is the merge of them.
    expect(screen.getByText(/finally got the/)).toBeInTheDocument();

    const posts = screen.getAllByRole('article');
    expect(posts[0].textContent).toContain('movie night friday');
    expect(posts[posts.length - 1].textContent).toContain('anyone else up at 3am');
  });

  it('renders post bodies through the same markdown path as messages', async () => {
    renderWithDemo(<FeedView space={createDemoClient().getRoom(DEMO_ROOM_IDS.cafe)!} />, {
      spaceId: DEMO_ROOM_IDS.cafe,
    });
    expect((await screen.findByText('voice channels')).tagName).toBe('STRONG');
  });

  it('offers unpublish/delete only on your own posts', async () => {
    renderWithDemo(<FeedView space={createDemoClient().getRoom(DEMO_ROOM_IDS.cafe)!} />, {
      spaceId: DEMO_ROOM_IDS.cafe,
    });

    await screen.findByText(/movie night friday/);
    // Four posts (one is Nibbles' repost), but only the one you wrote is yours to take back.
    expect(screen.getAllByRole('article')).toHaveLength(4);
    // It lives in each post's ⋯ menu: open them all, and it's there once.
    document.querySelectorAll('[data-nu-role="post-more"]').forEach((button) => fireEvent.click(button));
    expect(screen.getAllByText('Make private')).toHaveLength(1);
  });
});

describe('feed rooms stay out of the channel and DM lists', () => {
  it('lists the Space’s channels without anyone’s feed room', () => {
    renderWithDemo(<ChannelList />, { spaceId: DEMO_ROOM_IDS.cafe });
    expect(screen.getByText('Posts')).toBeInTheDocument(); // the view, not a room
    expect(screen.queryByText("Nibbles's posts")).not.toBeInTheDocument();
  });

  it('does not show joined feed rooms as group chats in Direct Messages', () => {
    // They're joined and have no parent Space, which is exactly what useSpacelessRooms would
    // otherwise treat as a group chat — one row per member of the hub.
    renderWithDemo(<ChannelList />, { spaceId: null });
    expect(screen.getByText('Nibbles')).toBeInTheDocument();
    expect(screen.queryByText("Nibbles's posts")).not.toBeInTheDocument();
    expect(screen.queryByText("You's posts")).not.toBeInTheDocument();
  });
});

describe('GlobalFeedView against the demo world', () => {
  const settled = () => waitFor(() => expect(screen.queryByText('Gathering posts…')).not.toBeInTheDocument());

  it('Everyone shows public posts, joined or not, and nothing from an unlisted Space', async () => {
    renderWithDemo(<GlobalFeedView />, { globalFeed: true });

    // Cat Café — public, and you're in it.
    expect(await screen.findByText(/movie night friday/)).toBeInTheDocument();
    // Night Owls — public, and you've never joined it.
    expect(await screen.findByText(/Finished the owl series/)).toBeInTheDocument();
    // Luna's Global post, from her profile feed.
    expect((await screen.findAllByText(/two owls and a moon/)).length).toBeGreaterThan(0);
    await settled();
    // Pixel Arcade isn't listed in the directory, so its member's post must stay inside it.
    expect(screen.queryByText(/bracket for saturday/)).not.toBeInTheDocument();
  });

  it('lists newest posts first across places', async () => {
    renderWithDemo(<GlobalFeedView />, { globalFeed: true });
    await screen.findByText(/Finished the owl series/);
    await settled();

    const texts = screen.getAllByRole('article').map((article) => article.textContent ?? '');
    const newer = texts.findIndex((text) => text.includes('movie night friday')); // 12 minutes ago
    const older = texts.findIndex((text) => text.includes('Finished the owl series')); // 25 minutes ago
    expect(newer).toBeGreaterThanOrEqual(0);
    expect(newer).toBeLessThan(older);
  });

  it('renders a repost with the original embedded, media included', async () => {
    renderWithDemo(<GlobalFeedView />, { globalFeed: true });
    await screen.findByText('look at these two');
    await settled();
    const repost = screen.getByText('look at these two').closest('article')!;
    expect(repost.querySelector('[data-nu-role="post-repost"]')?.textContent).toContain('two owls and a moon');
    expect(repost.querySelector('[data-nu-role="post-repost"] [data-nu-role="post-media"]')).not.toBeNull();
  });

  it('offers Repost only on posts from public places', async () => {
    renderWithDemo(<GlobalFeedView />, { globalFeed: true });
    await screen.findAllByText(/two owls and a moon/);
    await settled();
    // Every post on Everyone is from a public place, so every one can be reposted.
    const articles = screen.getAllByRole('article');
    articles.forEach((article) => expect(article.querySelector('[data-nu-role="post-repost-action"]')).not.toBeNull());
  });

  it('Following starts empty and fills from a followed Space', async () => {
    const { mx } = renderWithDemo(<GlobalFeedView />, { globalFeed: true });
    await screen.findAllByText(/two owls and a moon/);
    await settled();

    screen.getByRole('tab', { name: 'Following' }).click();
    expect(await screen.findByText('You’re not following anyone yet.')).toBeInTheDocument();

    await mx.setAccountData('xyz.nekous.follows' as never, { users: [], spaces: [DEMO_ROOM_IDS.cafe] } as never);
    expect(await screen.findByText(/movie night friday/)).toBeInTheDocument();
    // Night Owls isn't followed, so its posts stay on Everyone.
    expect(screen.queryByText(/Finished the owl series/)).not.toBeInTheDocument();
  });
});

describe('ProfileView against the demo world', () => {
  it('shows everything a person posted that the viewer can read, across places', async () => {
    renderWithDemo(<ProfileView userId={DEMO_LUNA} />);
    expect((await screen.findAllByText(/two owls and a moon/)).length).toBeGreaterThan(0); // Global
    expect(await screen.findByText(/Finished the owl series/)).toBeInTheDocument(); // Night Owls
    // Nobody else's posts.
    await waitFor(() => expect(screen.queryByText('Loading posts…')).not.toBeInTheDocument());
    expect(screen.queryByText(/movie night friday/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Follow' })).toBeInTheDocument();
  });
});

describe('The social side against the demo world', () => {
  it('lists its own places in the channel column instead of your DMs', () => {
    renderWithDemo(<ChannelList />, { spaceId: null, globalFeed: true });

    for (const name of ['Everyone', 'Following', 'Notifications', 'Your profile', 'Cat Café', 'Pixel Arcade']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    expect(screen.queryByText('Direct messages')).not.toBeInTheDocument();
  });

  it('shows likes, comments and chat mentions in one Notifications list, with a Mentions filter', async () => {
    const { store } = renderWithDemo(
      <>
        <ActivityWatcher />
        <GlobalFeedView />
      </>,
      { globalFeed: true, socialView: 'notifications' }
    );

    const rows = () => screen.getAllByRole('button').filter((el) => el.dataset.nuRole === 'activity-row');
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(rows().map((row) => row.dataset.nuKind)).toEqual(['comment', 'like', 'mention']);
    expect(rows()[2].textContent).toContain('mentioned you in #general');

    fireEvent.click(screen.getByRole('tab', { name: 'Mentions' }));
    expect(rows().map((row) => row.dataset.nuKind)).toEqual(['mention']);

    // A chat mention opens at its message in its channel.
    fireEvent.click(rows()[0]);
    expect(store.get(globalFeedOpenAtom)).toBe(false);
    expect(store.get(selectedRoomIdAtom)).toBe(DEMO_ROOM_IDS.general);
  });

  it('opens a Space’s Posts in the main pane and keeps the sidebar, and Back returns to the feed', async () => {
    const { store } = renderWithDemo(
      <>
        <ChannelList />
        <MainPane />
      </>,
      { spaceId: null, globalFeed: true }
    );

    fireEvent.click(screen.getByRole('button', { name: /Cat Café/ }));
    expect(await screen.findByPlaceholderText(/Post something to Cat Café/)).toBeInTheDocument();
    // Still the social sidebar, not the Space's channel list. (The global feed stays mounted, hidden,
    // behind the Space's Posts, with its own Notifications tab: the sidebar is the one meant.)
    expect(within(document.querySelector<HTMLElement>('[data-nu-role="social-nav"]')!).getByText('Notifications')).toBeInTheDocument();
    expect(screen.queryByText('Text channels')).not.toBeInTheDocument();
    expect(store.get(globalFeedOpenAtom)).toBe(true);
    expect(store.get(socialSpaceIdAtom)).toBe(DEMO_ROOM_IDS.cafe);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(store.get(socialSpaceIdAtom)).toBeNull();
    expect(store.get(globalFeedOpenAtom)).toBe(true);
  });
});

describe('The sample Space’s moderation, calendar and webhook', () => {
  it('has reports waiting in the queue, one of them about a post', async () => {
    const mx = createDemoClient();
    render(
      <JotaiProvider>
        <MatrixClientContext.Provider value={mx}>
          <SpaceReportsSettings space={mx.getRoom(DEMO_ROOM_IDS.cafe)!} />
        </MatrixClientContext.Provider>
      </JotaiProvider>
    );
    const reports = await screen.findAllByText(/Pixel|Nibbles/, { selector: 'strong' });
    expect(reports).toHaveLength(2);
    expect(screen.getByText(/Posting spoilers/)).toBeInTheDocument();
    expect(screen.getByText(/wrote a post/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to post' })).toBeInTheDocument();
  });

  it('has two events on the calendar', async () => {
    const mx = createDemoClient();
    render(
      <JotaiProvider>
        <MatrixClientContext.Provider value={mx}>
          <CalendarView space={mx.getRoom(DEMO_ROOM_IDS.cafe)!} />
        </MatrixClientContext.Provider>
      </JotaiProvider>
    );
    expect(await screen.findByRole('heading', { name: 'Movie night' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Game night' })).toBeInTheDocument();
  });

  it('has a webhook on #general, and a message it posted under its own name', () => {
    const general = createDemoClient().getRoom(DEMO_ROOM_IDS.general)!;
    expect(general.currentState.getStateEvents('xyz.nekous.webhook')).toHaveLength(1);
    expect(general.getLiveTimeline().getEvents().some((e) => e.getContent().body === 'Build 42 passed ✅')).toBe(true);
  });
});

describe('opening a Space in the demo world', () => {
  it('shows its news first, then goes to its first text channel, until there’s new news', async () => {
    const { mx, store } = renderWithDemo(
      <>
        <ChannelList />
        <MainPane />
      </>,
      { spaceId: DEMO_ROOM_IDS.cafe, roomId: null }
    );

    // Unseen news: the Space opens on it.
    expect(await screen.findByText(/Movie night is this week/)).toBeInTheDocument();
    expect(store.get(selectedSpaceViewAtom)).toBe('news');
    fireEvent.click(screen.getByRole('button', { name: 'Continue to #general' }));
    expect(store.get(selectedRoomIdAtom)).toBe(DEMO_ROOM_IDS.general);

    // Opened again with nothing chosen (as the rail does): the news is seen, so #general.
    act(() => {
      store.set(selectedRoomIdAtom, null);
      store.set(selectedSpaceViewAtom, null);
    });
    await waitFor(() => expect(store.get(selectedRoomIdAtom)).toBe(DEMO_ROOM_IDS.general));
    expect(store.get(selectedSpaceViewAtom)).toBeNull();

    // Another editor announces an update (a new revision): the next visit shows the news again.
    await act(async () => {
      await mx.sendStateEvent(
        DEMO_ROOM_IDS.cafe,
        SPACE_NEWS_EVENT as never,
        { body: 'Movie night moved to Saturday', revision: 'demo-update', updated_ts: Date.now() } as never,
        ''
      );
    });
    act(() => {
      store.set(selectedRoomIdAtom, null);
      store.set(selectedSpaceViewAtom, null);
    });
    expect(await screen.findByText('Movie night moved to Saturday')).toBeInTheDocument();
  });

  it('opens the next Space on its own first channel, not the one the last Space landed on', async () => {
    const { store } = renderWithDemo(
      <>
        <ChannelList />
        <MainPane />
      </>,
      { spaceId: DEMO_ROOM_IDS.cafe, roomId: null }
    );
    // Cat Café: its news, then on to its #general.
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to #general' }));
    expect(store.get(selectedRoomIdAtom)).toBe(DEMO_ROOM_IDS.general);

    // Then the Arcade, picked on the rail.
    act(() => {
      store.set(selectedSpaceIdAtom, DEMO_ROOM_IDS.arcade);
      store.set(selectedRoomIdAtom, null);
      store.set(selectedSpaceViewAtom, null);
    });
    await waitFor(() => expect(store.get(selectedRoomIdAtom)).toBe(DEMO_ROOM_IDS.gaming));
  });
});

describe('Account Settings against the demo world', () => {
  it('opens, and keeps a keyword the demo can add and remove', async () => {
    renderWithDemo(<AccountSettingsModal onClose={() => undefined} />);
    fireEvent.change(await screen.findByPlaceholderText('A word or phrase'), { target: { value: 'movie night' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('movie night')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove movie night' }));
    await waitFor(() => expect(screen.queryByText('movie night')).not.toBeInTheDocument());
  });

  it('saves only what was changed: the name and status the server has are left alone', async () => {
    const onClose = vi.fn();
    const { mx } = renderWithDemo(<AccountSettingsModal onClose={onClose} />);
    const name = (await screen.findByRole('textbox', { name: 'Display name' })) as HTMLInputElement;
    // The form opens on the fallback handle and fills in the real name once the profile arrives.
    const { displayname } = await mx.getProfileInfo(mx.getUserId()!);
    await waitFor(() => expect(name.value).toBe(displayname));
    const setDisplayName = vi.spyOn(mx, 'setDisplayName');
    const setPresence = vi.spyOn(mx, 'setPresence');
    vi.spyOn(mx, 'getPresence').mockResolvedValue({ presence: 'online', status_msg: 'napping' } as Awaited<ReturnType<typeof mx.getPresence>>);

    fireEvent.change(document.querySelector('[data-nu-role="account-settings-presence"]')!, { target: { value: 'unavailable' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(setDisplayName).not.toHaveBeenCalled();
    expect(setPresence).toHaveBeenCalledWith({ presence: 'unavailable', status_msg: 'napping' });
  });
});
