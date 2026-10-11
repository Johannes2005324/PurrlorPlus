import { useEffect, useId, useState } from 'react';
import type { Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { useSpaces } from '../../matrix/hooks/useSpaces';
import { useFollows } from '../../matrix/hooks/useFollows';
import { useProfileBrief } from '../../matrix/hooks/useProfileBrief';
import { followsBack } from '../../matrix/topFriends';
import type { Emote } from '../../matrix/emotes';
import {
  DIVIDER_STYLES,
  ART_RATINGS,
  GUESTBOOK_WHO,
  LIMITS,
  readHttpsUrl,
  type ArtAlbum,
  type ArtPiece,
  type ArtRating,
  type DividerStyle,
  type GuestbookWho,
  type MusicAlbum,
  type MusicTrack,
  type PageBlock,
  type PageLink,
  type PageSide,
  type PageSpace,
} from '../../matrix/profilePage';
import { formatBytes } from '../../matrix/postMedia';
import { parseWatchUrl } from '../voice/watchTogether';
import { BLOCK_LABELS, findEmote } from './editorModel';
import { AudioPicker } from './AudioPicker';
import { ImagePicker, ImageThumb } from './ImagePicker';
import { formatTime } from '../../matrix/musicTracks';

type Block<T extends PageBlock['type']> = Extract<PageBlock, { type: T }>;
type EditorProps<T extends PageBlock['type']> = {
  block: Block<T>;
  onChange: (block: Block<T>) => void;
  emotes: Emote[];
  imagesLeft: number;
  /** Tracks the page can still take, across all its music blocks. */
  tracksLeft: number;
  /** Albums the page can still take, across all its music blocks. */
  musicAlbumsLeft: number;
  /** Pieces the page can still take, across all its gallery blocks. */
  galleryPiecesLeft: number;
};

function TitleField({ value, onChange }: { value?: string; onChange: (title: string | undefined) => void }) {
  return (
    <label className="nu-field">
      Heading (optional)
      <input
        className="nu-field__input"
        value={value ?? ''}
        maxLength={LIMITS.title}
        onChange={(evt) => onChange(evt.target.value || undefined)}
      />
    </label>
  );
}

/** A link field that says when what's typed won't be kept (it must be https://). */
function UrlField({
  label,
  value,
  onChange,
  role,
  hint,
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  role?: string;
  hint?: string;
}) {
  const invalid = value.trim() !== '' && !readHttpsUrl(value);
  return (
    <label className="nu-field">
      {label}
      <input
        className="nu-field__input"
        type="url"
        inputMode="url"
        placeholder="https://"
        value={value}
        maxLength={LIMITS.url}
        onChange={(evt) => onChange(evt.target.value)}
        data-nu-role={role}
      />
      {invalid ? (
        <span className="nu-field__error">Use a full link starting with https://</span>
      ) : (
        hint && <span className="nu-field__hint">{hint}</span>
      )}
    </label>
  );
}

/** Emote by shortcode, from the emotes you can use in messages. */
function EmoteField({
  label,
  value,
  emotes,
  onChange,
}: {
  label: string;
  value?: string;
  emotes: Emote[];
  onChange: (mxc: string | undefined) => void;
}) {
  const listId = useId();
  const current = emotes.find((emote) => emote.mxcUrl === value);
  return (
    <label className="nu-field">
      {label}
      <span className="nu-page-editor__row">
        {value && <ImageThumb mxc={value} />}
        <input
          className="nu-field__input"
          list={listId}
          placeholder=":shortcode:"
          defaultValue={current ? `:${current.shortcode}:` : ''}
          onChange={(evt) => onChange(findEmote(emotes, evt.target.value)?.mxcUrl)}
        />
      </span>
      <datalist id={listId}>
        {emotes.slice(0, 300).map((emote) => (
          <option key={emote.shortcode} value={`:${emote.shortcode}:`} />
        ))}
      </datalist>
    </label>
  );
}

function TextEditor({ block, onChange }: EditorProps<'text'>) {
  return (
    <>
      <TitleField value={block.title} onChange={(title) => onChange({ ...block, title })} />
      <label className="nu-field">
        Text
        <textarea
          className="nu-field__input nu-field__textarea"
          rows={5}
          maxLength={LIMITS.body}
          value={block.body}
          onChange={(evt) => onChange({ ...block, body: evt.target.value })}
          data-nu-role="page-editor-text-body"
        />
        <span className="nu-field__hint">**bold**, *italic*, ||spoilers|| and :emotes: work the same as in messages.</span>
      </label>
    </>
  );
}

function LinksEditor({ block, onChange, emotes }: EditorProps<'links'>) {
  const setItem = (index: number, patch: Partial<PageLink>) =>
    onChange({ ...block, items: block.items.map((item, i) => (i === index ? { ...item, ...patch } : item)) });
  return (
    <>
      <TitleField value={block.title} onChange={(title) => onChange({ ...block, title })} />
      {block.items.map((item, index) => (
        <fieldset key={index} className="nu-page-editor__subitem">
          <label className="nu-field">
            Label
            <input
              className="nu-field__input"
              value={item.label}
              maxLength={LIMITS.label}
              onChange={(evt) => setItem(index, { label: evt.target.value })}
              data-nu-role="page-editor-link-label"
            />
          </label>
          <UrlField label="Goes to" value={item.url} onChange={(url) => setItem(index, { url })} role="page-editor-link-url" />
          <div className="nu-page-editor__row">
            <EmoteField label="Emote (optional)" value={item.emote} emotes={emotes} onChange={(emote) => setItem(index, { emote })} />
            <label className="nu-page-editor__color">
              <input
                type="checkbox"
                checked={!!item.color}
                onChange={(evt) => setItem(index, { color: evt.target.checked ? '#ff7ab6' : undefined })}
              />
              Own colour
            </label>
            {item.color && (
              <input
                type="color"
                value={item.color}
                onChange={(evt) => setItem(index, { color: evt.target.value.toLowerCase() })}
                aria-label="Button colour"
              />
            )}
          </div>
          <button
            type="button"
            className="nu-page-editor__inline-button"
            onClick={() => onChange({ ...block, items: block.items.filter((_, i) => i !== index) })}
          >
            Remove this link
          </button>
        </fieldset>
      ))}
      {block.items.length < LIMITS.links && (
        <button
          type="button"
          className="nu-button nu-button--secondary"
          onClick={() => onChange({ ...block, items: [...block.items, { label: '', url: '' }] })}
          data-nu-role="page-editor-add-link"
        >
          Add a link
        </button>
      )}
    </>
  );
}

function ImageEditor({ block, onChange, imagesLeft }: EditorProps<'image'>) {
  return (
    <>
      <div className="nu-page-editor__row">
        {block.url && <ImageThumb mxc={block.url} />}
        <ImagePicker
          label={block.url ? 'Change image…' : 'Upload an image or GIF…'}
          disabled={!block.url && imagesLeft < 1}
          onUploaded={([url]) => onChange({ ...block, url })}
        />
        {!block.url && imagesLeft < 1 && (
          <span className="nu-field__hint">Your page has all {LIMITS.images} images it can hold, the background included. Remove one to add another.</span>
        )}
      </div>
      <label className="nu-field">
        Caption (optional)
        <input
          className="nu-field__input"
          value={block.caption ?? ''}
          maxLength={LIMITS.caption}
          onChange={(evt) => onChange({ ...block, caption: evt.target.value || undefined })}
        />
      </label>
      <UrlField label="Link (optional)" value={block.link ?? ''} onChange={(link) => onChange({ ...block, link: link || undefined })} />
    </>
  );
}

function SongEditor({ block, onChange }: EditorProps<'song'>) {
  const unplayable = !!readHttpsUrl(block.url) && !parseWatchUrl(block.url);
  return (
    <>
      <TitleField value={block.title} onChange={(title) => onChange({ ...block, title })} />
      <UrlField
        label="Song link"
        value={block.url}
        onChange={(url) => onChange({ ...block, url })}
        role="page-editor-song-url"
        hint="A YouTube or YouTube Music link, or a link to an audio file. Visitors press play; it never starts by itself."
      />
      {unplayable && <span className="nu-field__error">That link can’t be played.</span>}
    </>
  );
}

function serverOf(userId: string): string {
  return userId.slice(userId.indexOf(':') + 1);
}

function toPageSpace(space: Room, via: string): PageSpace {
  const avatarUrl = space.getMxcAvatarUrl() ?? undefined;
  return { roomId: space.roomId, name: space.name || 'A Space', ...(avatarUrl && { avatarUrl }), via: [via] };
}

/** Your public Spaces, ticked to show them. A private Space can't go on a public page. */
function SpacesEditor({ block, onChange }: EditorProps<'spaces'>) {
  const mx = useMatrixClient();
  const publicSpaces = useSpaces().filter((space) => space.getJoinRule() === 'public');
  const via = serverOf(mx.getUserId() ?? '');
  const shown = new Set(block.spaces.map((space) => space.roomId));
  return (
    <>
      <TitleField value={block.title} onChange={(title) => onChange({ ...block, title })} />
      {publicSpaces.length === 0 && <p className="nu-field__hint">You aren’t in any public Spaces yet.</p>}
      {publicSpaces.map((space) => (
        <label key={space.roomId} className="nu-field__checkbox-row">
          <input
            type="checkbox"
            checked={shown.has(space.roomId)}
            disabled={!shown.has(space.roomId) && block.spaces.length >= LIMITS.spaces}
            onChange={(evt) =>
              onChange({
                ...block,
                spaces: evt.target.checked
                  ? [...block.spaces, toPageSpace(space, via)]
                  : block.spaces.filter((s) => s.roomId !== space.roomId),
              })
            }
          />
          {space.name}
        </label>
      ))}
    </>
  );
}

const DIVIDER_LABELS: Record<DividerStyle, string> = { line: 'Line', dots: 'Dots', emote: 'A row of an emote' };

function DividerEditor({ block, onChange, emotes }: EditorProps<'divider'>) {
  return (
    <>
      <label className="nu-field">
        Style
        <select
          className="nu-field__input"
          value={block.style}
          onChange={(evt) => onChange({ ...block, style: evt.target.value as DividerStyle })}
        >
          {DIVIDER_STYLES.map((style) => (
            <option key={style} value={style}>
              {DIVIDER_LABELS[style]}
            </option>
          ))}
        </select>
      </label>
      {block.style === 'emote' && (
        <EmoteField label="Emote" value={block.emote} emotes={emotes} onChange={(emote) => onChange({ ...block, emote })} />
      )}
    </>
  );
}

function FriendRow({ userId, checked, disabled, onToggle }: { userId: string; checked: boolean; disabled: boolean; onToggle: (on: boolean) => void }) {
  const mx = useMatrixClient();
  const brief = useProfileBrief(userId);
  const [back, setBack] = useState<boolean>();
  useEffect(() => {
    let cancelled = false;
    void followsBack(mx, userId, mx.getUserId() ?? '').then((result) => {
      if (!cancelled) setBack(result);
    });
    return () => {
      cancelled = true;
    };
  }, [mx, userId]);
  return (
    <label className="nu-field__checkbox-row">
      <input type="checkbox" checked={checked} disabled={(disabled && !checked) || (back === false && !checked)} onChange={(evt) => onToggle(evt.target.checked)} />
      {brief.name}
      {back === false && <span className="nu-field__hint"> doesn’t follow you back</span>}
    </label>
  );
}

/** Your Top 8, picked from people you follow who follow you back. Anyone else wouldn't be shown anyway. */
function FriendsEditor({ block, onChange }: EditorProps<'friends'>) {
  const follows = useFollows().users;
  const chosen = new Set(block.users);
  // Someone you've since unfollowed stays listed so you can take them off.
  const people = [...new Set([...block.users, ...follows])];
  return (
    <>
      <TitleField value={block.title} onChange={(title) => onChange({ ...block, title })} />
      <p className="nu-field__hint">
        Only people who follow you back are shown ({block.users.length} of {LIMITS.friends}).
      </p>
      {people.length === 0 && <p className="nu-field__hint">Follow some people first.</p>}
      {people.map((userId) => (
        <FriendRow
          key={userId}
          userId={userId}
          checked={chosen.has(userId)}
          disabled={block.users.length >= LIMITS.friends}
          onToggle={(on) => onChange({ ...block, users: on ? [...block.users, userId] : block.users.filter((u) => u !== userId) })}
        />
      ))}
    </>
  );
}

const GUESTBOOK_WHO_LABELS: Record<GuestbookWho, string> = { everyone: 'Anyone signed in', following: 'Only people I follow' };

function GuestbookEditor({ block, onChange }: EditorProps<'guestbook'>) {
  return (
    <>
      <TitleField value={block.title} onChange={(title) => onChange({ ...block, title })} />
      <label className="nu-field">
        Who can sign
        <select
          className="nu-field__input"
          value={block.who}
          onChange={(evt) => onChange({ ...block, who: evt.target.value as GuestbookWho })}
          data-nu-role="page-editor-guestbook-who"
        >
          {GUESTBOOK_WHO.map((who) => (
            <option key={who} value={who}>
              {GUESTBOOK_WHO_LABELS[who]}
            </option>
          ))}
        </select>
      </label>
      <label className="nu-field">
        Slowmode (seconds between one person’s entries, 0 for none)
        <input
          className="nu-field__input"
          type="number"
          min={0}
          max={LIMITS.guestbookSlowmode}
          value={block.slowmode}
          onChange={(evt) => onChange({ ...block, slowmode: Math.max(0, Math.min(LIMITS.guestbookSlowmode, Math.round(Number(evt.target.value) || 0))) })}
        />
      </label>
      <label className="nu-field">
        Blocked words (one per line)
        <textarea
          className="nu-field__input nu-field__textarea"
          rows={3}
          value={block.blockedWords.join('\n')}
          onChange={(evt) =>
            onChange({ ...block, blockedWords: evt.target.value.split('\n').map((word) => word.slice(0, LIMITS.guestbookWord)).slice(0, LIMITS.guestbookWords) })
          }
        />
        <span className="nu-field__hint">
          Entries with these words are left out and deleted from your guestbook. Like everything on your page, the list is public. To switch the
          guestbook off, remove the block.
        </span>
      </label>
    </>
  );
}

const RATING_LABELS: Record<ArtRating, string> = { general: 'General', mature: 'Mature (18+)' };

function PieceEditor({
  piece,
  ratings,
  onChange,
  onRemove,
}: {
  piece: ArtPiece;
  ratings: boolean;
  onChange: (piece: ArtPiece) => void;
  onRemove: () => void;
}) {
  // Folded down to a thumbnail and its title, so an album of pieces doesn't push "Add pieces…" and the next album a long scroll away.
  return (
    <details className="nu-page-editor__subitem nu-page-editor__piece" data-nu-role="page-editor-gallery-piece">
      <summary className="nu-page-editor__piece-summary">
        <ImageThumb mxc={piece.url} />
        <span className="nu-page-editor__piece-name">{piece.title || 'Untitled piece'}</span>
        {piece.rating === 'mature' && <span className="nu-field__hint">Mature</span>}
      </summary>
      <div className="nu-page-editor__row">
        <label className="nu-field">
          Title (optional)
          <input className="nu-field__input" value={piece.title ?? ''} maxLength={LIMITS.title} onChange={(evt) => onChange({ ...piece, title: evt.target.value || undefined })} />
        </label>
      </div>
      <label className="nu-field">
        Caption (optional)
        <input className="nu-field__input" value={piece.description ?? ''} maxLength={LIMITS.caption} onChange={(evt) => onChange({ ...piece, description: evt.target.value || undefined })} />
      </label>
      <div className="nu-page-editor__row">
        <label className="nu-field">
          Tags (comma separated)
          <input
            className="nu-field__input"
            defaultValue={piece.tags.join(', ')}
            onChange={(evt) =>
              onChange({ ...piece, tags: evt.target.value.split(',').map((tag) => tag.trim().replace(/^#+/, '').toLowerCase()).filter(Boolean).slice(0, LIMITS.tags) })
            }
          />
        </label>
        {ratings && (
        <label className="nu-field">
          Rating
          <select className="nu-field__input" value={piece.rating} onChange={(evt) => onChange({ ...piece, rating: evt.target.value as ArtRating })} data-nu-role="page-editor-art-rating">
            {ART_RATINGS.map((rating) => (
              <option key={rating} value={rating}>
                {RATING_LABELS[rating]}
              </option>
            ))}
          </select>
        </label>
        )}
      </div>
      <button type="button" className="nu-page-editor__inline-button" onClick={onRemove}>
        Remove this piece
      </button>
    </details>
  );
}

function GalleryEditor({ block, onChange, galleryPiecesLeft }: EditorProps<'gallery'>) {
  // The cap is across the whole page, so another gallery block's pieces use up room here too.
  const room = Math.max(0, galleryPiecesLeft);
  const setAlbum = (index: number, album: ArtAlbum) => onChange({ ...block, albums: block.albums.map((a, i) => (i === index ? album : a)) });
  return (
    <>
      <TitleField value={block.title} onChange={(title) => onChange({ ...block, title })} />
      <label className="nu-field__checkbox-row">
        <input
          type="checkbox"
          checked={block.ratings}
          data-nu-role="page-editor-gallery-ratings"
          onChange={(evt) =>
            onChange({
              ...block,
              ratings: evt.target.checked,
              // Turning ratings off rates everything General again, so nothing stays hidden by a setting that's gone.
              ...(!evt.target.checked && {
                albums: block.albums.map((album) => ({ ...album, pieces: album.pieces.map((piece): ArtPiece => ({ ...piece, rating: 'general' })) })),
              }),
            })
          }
        />
        Let me rate pieces as Mature
      </label>
      <p className="nu-field__hint">
        {block.ratings
          ? 'Pieces rated Mature are blurred until clicked for signed-in visitors, and never shown to anyone signed out. Everyone here is 18 or over, but 18+ content needs a content warning. '
          : ''}
        {LIMITS.galleryPieces - room} of {LIMITS.galleryPieces} gallery pieces used on your page; each album holds up to {LIMITS.albumPieces}.
      </p>
      {block.albums.map((album, index) => (
        <fieldset key={album.id} className="nu-page-editor__subitem" data-nu-role="page-editor-gallery-album">
          <label className="nu-field">
            Album title
            <input className="nu-field__input" value={album.title} maxLength={LIMITS.title} onChange={(evt) => setAlbum(index, { ...album, title: evt.target.value })} />
          </label>
          <label className="nu-field">
            About this album (optional)
            <input className="nu-field__input" value={album.description ?? ''} maxLength={LIMITS.caption} onChange={(evt) => setAlbum(index, { ...album, description: evt.target.value || undefined })} />
          </label>
          <div className="nu-page-editor__row">
            <ImagePicker
              label="Add pieces…"
              multiple
              max={Math.min(LIMITS.albumPieces - album.pieces.length, room)}
              disabled={album.pieces.length >= LIMITS.albumPieces || room < 1}
              onUploaded={(urls) => setAlbum(index, { ...album, pieces: [...album.pieces, ...urls.map((url): ArtPiece => ({ url, tags: [], rating: 'general' }))] })}
            />
            <span className="nu-field__hint" data-nu-role="page-editor-gallery-room">
              {album.pieces.length >= LIMITS.albumPieces
                ? `This album is full (${LIMITS.albumPieces} pieces). Add another album, or remove a piece here.`
                : room < 1
                  ? `Your page has all ${LIMITS.galleryPieces} gallery pieces it can hold, counting every gallery on it. Remove a piece to add another.`
                  : `${album.pieces.length} of ${LIMITS.albumPieces} in this album. Open a piece to give it a title, caption or tags.`}
            </span>
          </div>
          {album.pieces.map((piece, pieceIndex) => (
            <PieceEditor
              key={`${piece.url}-${pieceIndex}`}
              piece={piece}
              ratings={block.ratings}
              onChange={(next) => setAlbum(index, { ...album, pieces: album.pieces.map((p, i) => (i === pieceIndex ? next : p)) })}
              onRemove={() => setAlbum(index, { ...album, pieces: album.pieces.filter((_, i) => i !== pieceIndex) })}
            />
          ))}
          <button type="button" className="nu-page-editor__inline-button" onClick={() => onChange({ ...block, albums: block.albums.filter((_, i) => i !== index) })}>
            Remove this album
          </button>
        </fieldset>
      ))}
      {block.albums.length < LIMITS.albums && (
        <button
          type="button"
          className="nu-button nu-button--secondary"
          data-nu-role="page-editor-add-album"
          onClick={() => onChange({ ...block, albums: [...block.albums, { id: `a${Math.random().toString(36).slice(2, 8)}`, title: '', pieces: [] }] })}
        >
          Add an album
        </button>
      )}
    </>
  );
}

function newMusicAlbum(): MusicAlbum {
  return { id: `a${Math.random().toString(36).slice(2, 8)}`, tracks: [] };
}

function swap<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** One track in the builder: its title and artist, moving it within its album or to another, removing it. */
function TrackEditor({
  track,
  first,
  last,
  albums,
  albumIndex,
  onChange,
  onMove,
  onMoveToAlbum,
  onRemove,
}: {
  track: MusicTrack;
  first: boolean;
  last: boolean;
  albums: MusicAlbum[];
  albumIndex: number;
  onChange: (track: MusicTrack) => void;
  onMove: (delta: -1 | 1) => void;
  onMoveToAlbum: (album: number) => void;
  onRemove: () => void;
}) {
  return (
    <fieldset className="nu-page-editor__subitem" data-nu-role="page-editor-track">
      <label className="nu-field">
        Title
        <input className="nu-field__input" value={track.title} maxLength={LIMITS.trackTitle} onChange={(evt) => onChange({ ...track, title: evt.target.value })} />
      </label>
      <label className="nu-field">
        Artist (optional)
        <input
          className="nu-field__input"
          value={track.artist ?? ''}
          maxLength={LIMITS.trackTitle}
          onChange={(evt) => onChange({ ...track, artist: evt.target.value || undefined })}
        />
      </label>
      {albums.length > 1 && (
        <label className="nu-field">
          Album
          <select
            className="nu-field__input"
            value={albumIndex}
            data-nu-role="page-editor-track-album"
            onChange={(evt) => onMoveToAlbum(Number(evt.target.value))}
          >
            {albums.map((album, index) => (
              <option key={album.id} value={index} disabled={index !== albumIndex && album.tracks.length >= LIMITS.albumTracks}>
                {album.title || `Untitled album ${index + 1}`}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="nu-page-editor__row">
        <span className="nu-field__hint">
          {[track.duration ? formatTime(track.duration) : undefined, track.size ? formatBytes(track.size) : undefined].filter(Boolean).join(' · ')}
        </span>
        <button type="button" className="nu-page-editor__icon-button" aria-label="Move track up" disabled={first} onClick={() => onMove(-1)}>
          ↑
        </button>
        <button type="button" className="nu-page-editor__icon-button" aria-label="Move track down" disabled={last} onClick={() => onMove(1)}>
          ↓
        </button>
        <button type="button" className="nu-page-editor__inline-button" onClick={onRemove}>
          Remove this track
        </button>
      </div>
    </fieldset>
  );
}

/**
 * Managing a music block: its albums (title, year, a note, a cover), their order, and each one's
 * tracks: upload straight into an album, reorder, move a track to another album, remove. An album
 * with no tracks isn't kept when the page is saved.
 */
function MusicEditor({ block, onChange, tracksLeft, musicAlbumsLeft }: EditorProps<'music'>) {
  const albums = block.albums;
  const setAlbums = (next: MusicAlbum[]) => onChange({ ...block, albums: next });
  const setAlbum = (index: number, album: MusicAlbum) => setAlbums(albums.map((a, i) => (i === index ? album : a)));
  const moveToAlbum = (from: number, trackIndex: number, to: number) => {
    if (to === from || albums[to].tracks.length >= LIMITS.albumTracks) return;
    const track = albums[from].tracks[trackIndex];
    setAlbums(
      albums.map((album, i) => {
        if (i === from) return { ...album, tracks: album.tracks.filter((_, t) => t !== trackIndex) };
        if (i === to) return { ...album, tracks: [...album.tracks, track] };
        return album;
      })
    );
  };
  const room = Math.max(0, tracksLeft);
  const total = albums.reduce((count, album) => count + album.tracks.length, 0);
  return (
    <>
      <TitleField value={block.title} onChange={(title) => onChange({ ...block, title })} />
      <p className="nu-field__hint">
        Only upload music you have the right to share. Anyone who can see your page can play it, and a track or an album can be taken down on a
        copyright complaint (see the terms). Nothing plays until a visitor presses play. {total} {total === 1 ? 'track' : 'tracks'} in{' '}
        {albums.length} {albums.length === 1 ? 'album' : 'albums'} here; {room} more {room === 1 ? 'track fits' : 'tracks fit'} on the page.
      </p>
      {albums.map((album, albumIndex) => (
        <fieldset key={album.id} className="nu-page-editor__subitem" data-nu-role="page-editor-music-album">
          <label className="nu-field">
            Album title{albums.length === 1 ? ' (optional)' : ''}
            <input
              className="nu-field__input"
              value={album.title ?? ''}
              maxLength={LIMITS.title}
              data-nu-role="page-editor-music-album-title"
              onChange={(evt) => setAlbum(albumIndex, { ...album, title: evt.target.value || undefined })}
            />
          </label>
          <label className="nu-field">
            Year (optional)
            <input
              className="nu-field__input"
              type="number"
              inputMode="numeric"
              min={LIMITS.minYear}
              max={LIMITS.maxYear}
              value={album.year ?? ''}
              onChange={(evt) => {
                const year = Number.parseInt(evt.target.value, 10);
                setAlbum(albumIndex, { ...album, year: Number.isFinite(year) ? year : undefined });
              }}
            />
          </label>
          <label className="nu-field">
            About this album (optional)
            <input
              className="nu-field__input"
              value={album.description ?? ''}
              maxLength={LIMITS.caption}
              onChange={(evt) => setAlbum(albumIndex, { ...album, description: evt.target.value || undefined })}
            />
          </label>
          <div className="nu-field">
            Cover (optional, square works best)
            <span className="nu-page-editor__row">
              {album.cover && <ImageThumb mxc={album.cover} onRemove={() => setAlbum(albumIndex, { ...album, cover: undefined })} />}
              <ImagePicker label={album.cover ? 'Change cover…' : 'Upload a cover…'} onUploaded={([cover]) => setAlbum(albumIndex, { ...album, cover })} />
            </span>
          </div>
          {album.tracks.map((track, trackIndex) => (
            <TrackEditor
              key={`${track.url}-${trackIndex}`}
              track={track}
              first={trackIndex === 0}
              last={trackIndex === album.tracks.length - 1}
              albums={albums}
              albumIndex={albumIndex}
              onChange={(next) => setAlbum(albumIndex, { ...album, tracks: album.tracks.map((t, i) => (i === trackIndex ? next : t)) })}
              onMove={(delta) => setAlbum(albumIndex, { ...album, tracks: swap(album.tracks, trackIndex, trackIndex + delta) })}
              onMoveToAlbum={(to) => moveToAlbum(albumIndex, trackIndex, to)}
              onRemove={() => setAlbum(albumIndex, { ...album, tracks: album.tracks.filter((_, i) => i !== trackIndex) })}
            />
          ))}
          {album.tracks.length === 0 && <p className="nu-field__hint">Add tracks to this album; an empty album isn’t kept.</p>}
          <div className="nu-page-editor__row">
            <AudioPicker
              max={Math.min(LIMITS.albumTracks - album.tracks.length, room)}
              disabled={album.tracks.length >= LIMITS.albumTracks || room < 1}
              onUploaded={(tracks) =>
                onChange({ ...block, albums: albums.map((a, i) => (i === albumIndex ? { ...a, tracks: [...a.tracks, ...tracks] } : a)) })
              }
            />
            <button
              type="button"
              className="nu-page-editor__icon-button"
              aria-label="Move album up"
              disabled={albumIndex === 0}
              onClick={() => setAlbums(swap(albums, albumIndex, albumIndex - 1))}
            >
              ↑
            </button>
            <button
              type="button"
              className="nu-page-editor__icon-button"
              aria-label="Move album down"
              disabled={albumIndex === albums.length - 1}
              onClick={() => setAlbums(swap(albums, albumIndex, albumIndex + 1))}
            >
              ↓
            </button>
            <button type="button" className="nu-page-editor__inline-button" onClick={() => setAlbums(albums.filter((_, i) => i !== albumIndex))}>
              Remove this album
            </button>
          </div>
        </fieldset>
      ))}
      {musicAlbumsLeft > 0 && (
        <button
          type="button"
          className="nu-button nu-button--secondary"
          data-nu-role="page-editor-add-music-album"
          onClick={() => setAlbums([...albums, newMusicAlbum()])}
        >
          Add an album
        </button>
      )}
    </>
  );
}

function CommissionsEditor({ block, onChange }: EditorProps<'commissions'>) {
  return (
    <>
      <TitleField value={block.title} onChange={(title) => onChange({ ...block, title })} />
      <p className="nu-field__hint">
        Your status, price sheet and queue are edited on your page once it’s published (they save the moment you change them, separately from the page).
      </p>
    </>
  );
}

function Fields({
  block,
  onChange,
  emotes,
  imagesLeft,
  tracksLeft,
  musicAlbumsLeft,
  galleryPiecesLeft,
}: {
  block: PageBlock;
  onChange: (block: PageBlock) => void;
  emotes: Emote[];
  imagesLeft: number;
  tracksLeft: number;
  musicAlbumsLeft: number;
  galleryPiecesLeft: number;
}) {
  const shared = { emotes, imagesLeft, tracksLeft, musicAlbumsLeft, galleryPiecesLeft };
  switch (block.type) {
    case 'text':
      return <TextEditor block={block} onChange={onChange} {...shared} />;
    case 'links':
      return <LinksEditor block={block} onChange={onChange} {...shared} />;
    case 'image':
      return <ImageEditor block={block} onChange={onChange} {...shared} />;
    case 'gallery':
      return <GalleryEditor block={block} onChange={onChange} {...shared} />;
    case 'song':
      return <SongEditor block={block} onChange={onChange} {...shared} />;
    case 'spaces':
      return <SpacesEditor block={block} onChange={onChange} {...shared} />;
    case 'divider':
      return <DividerEditor block={block} onChange={onChange} {...shared} />;
    case 'friends':
      return <FriendsEditor block={block} onChange={onChange} {...shared} />;
    case 'guestbook':
      return <GuestbookEditor block={block} onChange={onChange} {...shared} />;
    case 'music':
      return <MusicEditor block={block} onChange={onChange} {...shared} />;
    case 'commissions':
      return <CommissionsEditor block={block} onChange={onChange} {...shared} />;
    default:
      return null;
  }
}

/** One block in the builder's list: its kind, move and remove buttons, and its fields when open. */
export function BlockEditor({
  block,
  open,
  first,
  last,
  side,
  emotes,
  imagesLeft,
  tracksLeft,
  musicAlbumsLeft,
  galleryPiecesLeft,
  onToggle,
  onChange,
  onMove,
  onSide,
  onRemove,
}: {
  block: PageBlock;
  open: boolean;
  first: boolean;
  last: boolean;
  /** The column it's in; the profile song has none, and no buttons to move it. */
  side?: PageSide;
  emotes: Emote[];
  imagesLeft: number;
  tracksLeft: number;
  musicAlbumsLeft: number;
  galleryPiecesLeft: number;
  onToggle: () => void;
  onChange: (block: PageBlock) => void;
  onMove: (delta: -1 | 1) => void;
  onSide?: (side: PageSide) => void;
  onRemove: () => void;
}) {
  const summary = 'title' in block && block.title ? `${BLOCK_LABELS[block.type]}: ${block.title}` : BLOCK_LABELS[block.type];
  return (
    <div
      className={open ? 'nu-page-editor__block nu-page-editor__block--open' : 'nu-page-editor__block'}
      data-nu-role={`page-editor-block-${block.type}`}
    >
      <div className="nu-page-editor__block-head">
        <button type="button" className="nu-page-editor__block-name" aria-expanded={open} onClick={onToggle}>
          {open ? '▾' : '▸'} {summary}
        </button>
        {side && (
          <>
            <button type="button" className="nu-page-editor__icon-button" aria-label="Move up" disabled={first} onClick={() => onMove(-1)}>
              ↑
            </button>
            <button type="button" className="nu-page-editor__icon-button" aria-label="Move down" disabled={last} onClick={() => onMove(1)}>
              ↓
            </button>
            <button
              type="button"
              className="nu-page-editor__icon-button"
              aria-label={side === 'left' ? 'Move to the right column' : 'Move to the left column'}
              title={side === 'left' ? 'Move to the right column' : 'Move to the left column'}
              onClick={() => onSide?.(side === 'left' ? 'right' : 'left')}
              data-nu-role="page-editor-block-side"
            >
              {side === 'left' ? '→' : '←'}
            </button>
          </>
        )}
        <button
          type="button"
          className="nu-page-editor__icon-button"
          aria-label="Remove block"
          onClick={onRemove}
          data-nu-role="page-editor-remove-block"
        >
          ✕
        </button>
      </div>
      {open && (
        <div className="nu-page-editor__block-fields">
          <Fields block={block} onChange={onChange} emotes={emotes} imagesLeft={imagesLeft} tracksLeft={tracksLeft} musicAlbumsLeft={musicAlbumsLeft} galleryPiecesLeft={galleryPiecesLeft} />
        </div>
      )}
    </div>
  );
}
