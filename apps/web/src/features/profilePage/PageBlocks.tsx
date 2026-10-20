import { useContext, useEffect, useId, useState } from 'react';
import { useSetAtom } from 'jotai';
import { profileUserIdAtom, selectedRoomIdAtom, selectedSpaceIdAtom, railSectionAtom } from '../../app/state/selection';
import { Avatar } from '../../components/Avatar';
import { MatrixClientContext } from '../../matrix/MatrixClientContext';
import { useMediaUrl } from '../../matrix/hooks/useMediaUrl';
import type { PageBlock, PageLink, PageSpace } from '../../matrix/profilePage';
import { renderMessageText } from '../messaging/renderMessageText';
import { linkDomain } from './pageStyle';
import { FriendsBlock, GuestbookBlock } from './SocialBlocks';
import { GalleryBlock } from './GalleryBlock';
import { MusicBlock } from './MusicBlock';
import { CommissionsBlock } from './CommissionsBlock';
import { ModulePreview } from './ModulePreview';
import { PageOwnerContext } from './PageOwnerContext';
import { PageTargetContext } from './PageTargetContext';
import type { PageTarget } from '../../matrix/publicWeb';

type Block<T extends PageBlock['type']> = Extract<PageBlock, { type: T }>;

/** Links off the page: a new tab, no access back to Purrlor, and no endorsement for search engines. */
const EXTERNAL = { target: '_blank', rel: 'noopener noreferrer nofollow ugc' } as const;

function TextBlock({ block }: { block: Block<'text'> }) {
  // Signed-out visitors have no client (the public page, features/publicWeb/).
  const mx = useContext(MatrixClientContext);
  return (
    <div className="nu-profile-page__text">
      {renderMessageText(block.body, [], [], mx?.getUserId() ?? undefined, { formattedBody: block.formatted })}
    </div>
  );
}

function EmoteImage({ mxc, className }: { mxc: string; className: string }) {
  const src = useMediaUrl(mxc);
  return src ? <img className={className} src={src} alt="" /> : <span className={className} />;
}

function LinkButton({ link }: { link: PageLink }) {
  return (
    <a
      className="nu-profile-page__link"
      href={link.url}
      {...EXTERNAL}
      style={link.color ? { backgroundColor: link.color } : undefined}
      data-nu-role="profile-page-link"
    >
      {link.emote && <EmoteImage mxc={link.emote} className="nu-profile-page__link-emote" />}
      <span className="nu-profile-page__link-text">
        <span className="nu-profile-page__link-label">{link.label}</span>
        <span className="nu-profile-page__link-domain">{linkDomain(link.url)}</span>
      </span>
    </a>
  );
}

function LinksBlock({ block }: { block: Block<'links'> }) {
  return (
    <div className="nu-profile-page__links">
      {block.items.map((link, index) => (
        <LinkButton key={index} link={link} />
      ))}
    </div>
  );
}

function ImageBlock({ block }: { block: Block<'image'> }) {
  const src = useMediaUrl(block.url);
  const image = src ? <img className="nu-profile-page__image" src={src} alt={block.caption ?? ''} loading="lazy" /> : null;
  return (
    <figure className="nu-profile-page__figure">
      {block.link ? (
        <a href={block.link} {...EXTERNAL} className="nu-profile-page__image-link">
          {image}
          <span className="nu-profile-page__link-domain">{linkDomain(block.link)}</span>
        </a>
      ) : (
        image
      )}
      {block.caption && <figcaption className="nu-profile-page__caption">{block.caption}</figcaption>}
    </figure>
  );
}

function SpaceRow({ space }: { space: PageSpace }) {
  const mx = useContext(MatrixClientContext);
  const setSelectedSpaceId = useSetAtom(selectedSpaceIdAtom);
  const setSelectedRoomId = useSetAtom(selectedRoomIdAtom);
  const setRailSection = useSetAtom(railSectionAtom);
  const setProfileUserId = useSetAtom(profileUserIdAtom);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string>();
  const joined = mx?.getRoom(space.roomId)?.getMyMembership() === 'join';

  const open = (roomId: string) => {
    setProfileUserId(null);
    setSelectedRoomId(null);
    setRailSection('messages');
    setSelectedSpaceId(roomId);
  };

  const join = async () => {
    if (!mx) return;
    setJoining(true);
    setError(undefined);
    try {
      const room = await mx.joinRoom(space.roomId, { viaServers: space.via });
      open(room.roomId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t join that Space');
      setJoining(false);
    }
  };

  return (
    <div className="nu-profile-page__space" data-nu-role="profile-page-space">
      <Avatar name={space.name} mxcUrl={space.avatarUrl ?? null} size={36} />
      <span className="nu-profile-page__space-name">{space.name}</span>
      {mx ? (
        <button
          type="button"
          className="nu-profile-page__space-join"
          disabled={joining}
          onClick={() => (joined ? open(space.roomId) : void join())}
        >
          {joined ? 'Open' : joining ? 'Joining…' : 'Join'}
        </button>
      ) : (
        <span className="nu-profile-page__link-domain">Sign in to join</span>
      )}
      {error && <span className="nu-field__error">{error}</span>}
    </div>
  );
}

function SpacesBlock({ block }: { block: Block<'spaces'> }) {
  return (
    <div className="nu-profile-page__spaces">
      {block.spaces.map((space) => (
        <SpaceRow key={space.roomId} space={space} />
      ))}
    </div>
  );
}

function DividerBlock({ block }: { block: Block<'divider'> }) {
  if (block.style === 'emote' && block.emote) {
    return (
      <div className="nu-profile-page__divider nu-profile-page__divider--emote" role="separator">
        {Array.from({ length: 5 }, (_, i) => (
          <EmoteImage key={i} mxc={block.emote as string} className="nu-profile-page__divider-emote" />
        ))}
      </div>
    );
  }
  return <hr className={`nu-profile-page__divider nu-profile-page__divider--${block.style}`} />;
}

function BlockBody({ block }: { block: PageBlock }) {
  switch (block.type) {
    case 'text':
      return <TextBlock block={block} />;
    case 'links':
      return <LinksBlock block={block} />;
    case 'image':
      return <ImageBlock block={block} />;
    case 'gallery':
      return <GalleryBlock block={block} />;
    case 'spaces':
      return <SpacesBlock block={block} />;
    case 'divider':
      return <DividerBlock block={block} />;
    case 'friends':
      return <FriendsBlock block={block} />;
    case 'guestbook':
      return <GuestbookBlock block={block} />;
    case 'music':
      return <MusicBlock block={block} />;
    case 'commissions':
      return <CommissionsBlock />;
    default:
      return null;
  }
}

/** What a module's header says when its owner didn't give it a title. */
export function moduleTitle(block: PageBlock): string {
  if ('title' in block && block.title) return block.title;
  switch (block.type) {
    case 'text':
      return 'About';
    case 'links':
      return 'Links';
    case 'image':
      return block.caption ?? 'Picture';
    case 'gallery':
      return 'Gallery';
    case 'spaces':
      return 'Spaces';
    case 'friends':
      return 'Top 8';
    case 'guestbook':
      return 'Guestbook';
    case 'commissions':
      return 'Commissions';
    case 'music':
      return 'Music';
    default:
      return '';
  }
}

/** The module a link to something on the page (an album, a piece, a commission) points into. */
function targetBlockId(blocks: PageBlock[], target: PageTarget | undefined): string | undefined {
  if (!target) return undefined;
  const found = blocks.find((block) => {
    if (target.kind === 'art') return block.type === 'gallery' && block.albums.some((album) => album.id === target.album);
    if (target.kind === 'music') return block.type === 'music' && block.albums.some((album) => album.id === target.album);
    return block.type === 'commissions';
  });
  return found?.id;
}

// Modules opened during this visit to the app, by page owner and block, so coming back to a
// profile finds them as you left them. Every module starts closed otherwise.
const openedModules = new Set<string>();

/**
 * One block as a module: a header with its title that opens and closes it. Closed, it's the header
 * and, for a gallery or music, a preview of the newest thing in it (ModulePreview); nothing else
 * inside loads (a gallery's other pictures, a guestbook's entries).
 */
function Module({ block, ownerId, forceOpen }: { block: PageBlock; ownerId?: string; forceOpen: boolean }) {
  const key = `${ownerId ?? ''}/${block.id}`;
  const [open, setOpen] = useState(() => forceOpen || openedModules.has(key));
  const bodyId = useId();
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) openedModules.add(key);
    else openedModules.delete(key);
  };

  return (
    <section
      className={`nu-profile-page__block nu-profile-page__module nu-profile-page__block--${block.type}`}
      data-nu-role={`profile-page-block-${block.type}`}
      data-open={open}
    >
      <h3 className="nu-profile-page__module-head">
        <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={toggle} data-nu-role="profile-page-module-toggle">
          <span className="nu-profile-page__module-title">{moduleTitle(block)}</span>
          <span className="nu-profile-page__module-chevron" aria-hidden="true" />
        </button>
      </h3>
      {open ? (
        <div className="nu-profile-page__module-body" id={bodyId}>
          <BlockBody block={block} />
        </div>
      ) : (
        <ModulePreview block={block} onOpen={toggle} />
      )}
    </section>
  );
}

/**
 * A column of a page's blocks, in its own order, each a module that starts closed (one a link
 * points into starts open). Dividers sit on the page between them. The profile song isn't drawn
 * here: it's the floating player (FloatingSong). `openIds`: modules to show open, as the builder's
 * preview does for the block being edited.
 */
export function PageBlocks({ blocks, openIds }: { blocks: PageBlock[]; openIds?: string[] }) {
  const owner = useContext(PageOwnerContext);
  const linked = targetBlockId(blocks, useContext(PageTargetContext));
  return (
    <div className="nu-profile-page__blocks" data-nu-role="profile-page-blocks">
      {blocks.map((block) =>
        block.type === 'song' ? null : block.type === 'divider' ? (
          <section key={block.id} className="nu-profile-page__plain" data-nu-role="profile-page-block-divider">
            <DividerBlock block={block} />
          </section>
        ) : (
          <Module key={block.id} block={block} ownerId={owner?.userId} forceOpen={block.id === linked || !!openIds?.includes(block.id)} />
        )
      )}
    </div>
  );
}
