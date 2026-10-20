# Stories

Posts that last a day, shown as a row of avatars at the top of **Home**: yours first, then each
person you follow who has a live story. Code: `apps/web/src/matrix/stories.ts`,
`matrix/hooks/useStories.ts`, `features/stories/`.

## Where a story lives

An `xyz.nekous.story` event in its author's **profile feed** (`docs/posts.md`, "Posting to Global"),
the same room their Global posts go to. So a story is exactly as public as a Global post: anyone
can read it, which is what lets followers read it without joining anything, and why its media is a
plain upload. Posting the first story creates the profile room if there isn't one.

Content is a post's shape, read by the same `readPostContent`: text, one picture or video under
`xyz.nekous.attachments`, or both. A second attachment is ignored, and a repost isn't a story.
Captions are plain text, 200 characters at most (checked by the composer).

A custom type rather than a flag on `xyz.nekous.post`, so a client that doesn't know stories (an
older Purrlor, a federated peer not yet updated, Element) never shows one as a permanent post.

**Only the owner posts.** Profile rooms made before stories gate only `xyz.nekous.post`, so the
first story also raises `xyz.nekous.story` to power level 100. Readers check that the sender is
the room's owner either way.

## A day

Matrix can't expire an event, so it's kept from both ends:

- **Readers** show a story only while `origin_server_ts` is under 24 hours old.
- **The author's client** redacts its own stories once they're older than that, every time it
  reads stories (Home open). So a story is gone from the room, not just hidden, the next time its
  author opens the app after it expires. Until then anyone reading the room's raw history could
  still see it.

As with deleted posts, the uploaded media stays on the media server until an admin purges it.

## Reading

`loadStoryReels` reads your own profile room and each followed person's (found the same way the
Following timeline finds them, `loadUserProfileSource`), one `/messages` request each filtered to
`xyz.nekous.story`, newest 50, six at a time. Profile rooms you aren't in don't sync, so Home reads
them on opening, every two minutes while open, and right after you post or delete one.

Only followed **people** have stories in the row; following a Space doesn't add anyone.

## Seen

Which stories you've watched is account data (`xyz.nekous.stories_seen`, event ID → the story's
time), so it carries across devices. Marks for expired stories are dropped on the next write. A
person's ring is bright while any of their live stories is unwatched, and opening them starts at
the first unwatched one. Nobody is told you watched: there are no view counts.

## Watching

Full screen, one reel after another in the row's order. Pictures and text stay up 5 seconds,
videos play through. Tap the left third to go back, anywhere else to go on; hold to pause; arrow
keys, Escape and Back work too. Your own stories have a delete button.

## Not in this pass

- Who viewed your story.
- Replies to a story (as a DM).
- Stories to a smaller audience (a Space, close friends): they'd need a room whose membership is
  that audience, like the "chosen people" tier in `docs/posts.md`.
- The demo shows no stories row.
