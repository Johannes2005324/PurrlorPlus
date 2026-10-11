import { useEffect, useMemo, useRef, useState } from 'react';
import { useSetAtom } from 'jotai';
import { profileRevisionAtom } from '../../app/state/feed';
import { useConfirm } from '../../components/ConfirmDialog';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { useWithLibraryEmotes } from '../../matrix/hooks/useEmoteLibrary';
import { emptyProfilePage, LIMITS, parseProfilePage, type PageBlockType, type PageSide, type ProfilePage } from '../../matrix/profilePage';
import {
  discardProfilePageDraft,
  publishProfilePage,
  readProfilePageDraft,
  saveProfilePageDraft,
  unpublishProfilePage,
} from '../../matrix/profilePageStore';
import { BlockEditor } from './BlockEditor';
import {
  addBlock,
  BLOCK_LABELS,
  canAddBlock,
  canAddType,
  columnBlocks,
  imageCount,
  moveBlock,
  galleryPieceCount,
  musicAlbumCount,
  removeBlock,
  setBlockSide,
  trackCount,
  updateBlock,
  withFormattedText,
} from './editorModel';
import { ProfilePageLayout } from './ProfilePageLayout';
import { PageOwnerContext } from './PageOwnerContext';
import { getOwnProfileRoomId } from '../../matrix/profileFeed';
import { PublicPageSwitch } from '../../app/PublicPageSwitch';
import { ProfilePageFrame } from './ProfilePageFrame';
import { StyleControls } from './StyleControls';
import './ProfilePageEditor.css';

const DRAFT_SAVE_DELAY_MS = 1500;
const NO_EMOTES: never[] = [];

/**
 * The page builder: controls on one side, the page as visitors will see it on the other (one
 * at a time on a phone). Changes save as a draft in your account data as you go, so closing it
 * loses nothing; visitors see nothing until Publish.
 */
export function ProfilePageEditor({
  published,
  displayName,
  onClose,
}: {
  published?: ProfilePage;
  displayName: string;
  onClose: () => void;
}) {
  const mx = useMatrixClient();
  const emotes = useWithLibraryEmotes(NO_EMOTES);
  const bumpProfile = useSetAtom(profileRevisionAtom);
  const { confirm, dialog } = useConfirm();
  const [page, setPage] = useState<ProfilePage>(
    () => readProfilePageDraft(mx) ?? (published ? structuredClone(published) : emptyProfilePage())
  );
  const [openBlock, setOpenBlock] = useState<string>();
  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const [busy, setBusy] = useState<'publishing' | 'unpublishing'>();
  const [error, setError] = useState<string>();
  const [draftState, setDraftState] = useState<'saved' | 'saving' | 'unchanged'>('unchanged');

  // Draft autosave, a moment after the last change. The first render is what was loaded: nothing to save.
  const changed = useRef(false);
  useEffect(() => {
    if (!changed.current) return undefined;
    setDraftState('saving');
    const timer = window.setTimeout(() => {
      saveProfilePageDraft(mx, page)
        .then(() => setDraftState('saved'))
        .catch(() => setDraftState('unchanged'));
    }, DRAFT_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [mx, page]);

  const edit = (next: ProfilePage) => {
    changed.current = true;
    setPage(next);
  };

  // The preview is exactly what visitors get: the page through the same checks publishing uses.
  const preview = useMemo(() => parseProfilePage(withFormattedText(page, emotes)), [page, emotes]);
  const imagesLeft = LIMITS.images - imageCount(page);
  const tracksLeft = LIMITS.tracks - trackCount(page);
  const musicAlbumsLeft = LIMITS.musicAlbums - musicAlbumCount(page);
  const galleryPiecesLeft = LIMITS.galleryPieces - galleryPieceCount(page);

  const handlePublish = async () => {
    setBusy('publishing');
    setError(undefined);
    try {
      await publishProfilePage(mx, withFormattedText(page, emotes), displayName);
      await discardProfilePageDraft(mx).catch(() => undefined);
      bumpProfile((n) => n + 1);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your page couldn’t be published.');
      setBusy(undefined);
    }
  };

  const handleDiscard = async () => {
    const ok = await confirm({
      title: 'Discard changes?',
      message: published ? 'Your page goes back to what visitors see now.' : 'Your unpublished page is cleared.',
      confirmLabel: 'Discard',
    });
    if (!ok) return;
    changed.current = false;
    setPage(published ? structuredClone(published) : emptyProfilePage());
    setDraftState('unchanged');
    await discardProfilePageDraft(mx).catch(() => undefined);
  };

  const handleUnpublish = async () => {
    const ok = await confirm({
      title: 'Take your page down?',
      message: 'Your profile goes back to the plain look. What you built stays here as a draft to publish again later.',
      confirmLabel: 'Take it down',
    });
    if (!ok) return;
    setBusy('unpublishing');
    setError(undefined);
    try {
      await saveProfilePageDraft(mx, page);
      await unpublishProfilePage(mx);
      bumpProfile((n) => n + 1);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your page couldn’t be taken down.');
      setBusy(undefined);
    }
  };

  const song = page.blocks.find((block) => block.type === 'song');

  const addType = (type: PageBlockType, side: PageSide) => {
    const next = addBlock(page, type, side);
    edit(next);
    setOpenBlock(next.blocks[next.blocks.length - 1].id);
  };

  return (
    <div className="nu-page-editor" data-nu-role="page-editor" data-nu-view={view}>
      <div className="nu-page-editor__toolbar">
        <div className="nu-page-editor__view-switch" role="tablist">
          <button type="button" role="tab" aria-selected={view === 'edit'} onClick={() => setView('edit')}>
            Edit
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'preview'}
            onClick={() => setView('preview')}
            data-nu-role="page-editor-preview-tab"
          >
            Preview
          </button>
        </div>
        <span className="nu-page-editor__status" aria-live="polite">
          {draftState === 'saving' ? 'Saving draft…' : draftState === 'saved' ? 'Draft saved' : ''}
        </span>
        <button type="button" className="nu-button nu-button--secondary" onClick={onClose} disabled={!!busy}>
          Close
        </button>
        <button
          type="button"
          className="nu-button nu-button--primary"
          onClick={() => void handlePublish()}
          disabled={!!busy}
          data-nu-role="page-editor-publish"
        >
          {busy === 'publishing' ? 'Publishing…' : 'Publish'}
        </button>
      </div>
      {error && <p className="nu-field__error nu-page-editor__error">{error}</p>}

      <div className="nu-page-editor__body">
        <div className="nu-page-editor__controls">
          <StyleControls style={page.style} onChange={(style) => edit({ ...page, style })} />

          <div className="nu-page-editor__section" data-nu-role="page-editor-blocks">
            <h3 className="nu-page-editor__heading">
              Your blocks{' '}
              <span className="nu-field__hint">
                {page.blocks.length} of {LIMITS.blocks} · {Math.max(0, imagesLeft)} images left
              </span>
            </h3>
            <p className="nu-field__hint">
              Your name, avatar, banner and bio go across the top, and your posts down the middle. Your blocks sit in a
              column either side, each closed to its title until a visitor opens it. On a phone, both columns go above
              your posts.
            </p>
            {(['left', 'right'] as const).map((side) => {
              const column = columnBlocks(page, side);
              return (
                <div key={side} className="nu-page-editor__column" data-nu-role={`page-editor-column-${side}`}>
                  <h4 className="nu-page-editor__subheading">{side === 'left' ? 'Left column' : 'Right column'}</h4>
                  {column.length === 0 && <p className="nu-field__hint">Nothing here yet.</p>}
                  {column.map((block, index) => (
                    <BlockEditor
                      key={block.id}
                      block={block}
                      open={openBlock === block.id}
                      first={index === 0}
                      last={index === column.length - 1}
                      side={side}
                      emotes={emotes}
                      imagesLeft={imagesLeft}
                      tracksLeft={tracksLeft}
                      musicAlbumsLeft={musicAlbumsLeft}
                      galleryPiecesLeft={galleryPiecesLeft}
                      onToggle={() => setOpenBlock(openBlock === block.id ? undefined : block.id)}
                      onChange={(next) => edit(updateBlock(page, next))}
                      onMove={(delta) => edit(moveBlock(page, block.id, delta))}
                      onSide={(next) => edit(setBlockSide(page, block.id, next))}
                      onRemove={() => edit(removeBlock(page, block.id))}
                    />
                  ))}
                  {canAddBlock(page) && <AddBlock page={page} side={side} onAdd={addType} />}
                </div>
              );
            })}
            <div className="nu-page-editor__column" data-nu-role="page-editor-song">
              <h4 className="nu-page-editor__subheading">Profile song</h4>
              <p className="nu-field__hint">Plays in a small window in the corner of your profile, once a visitor presses play.</p>
              {song ? (
                <BlockEditor
                  block={song}
                  open={openBlock === song.id}
                  first
                  last
                  emotes={emotes}
                  imagesLeft={imagesLeft}
                  tracksLeft={tracksLeft}
                  musicAlbumsLeft={musicAlbumsLeft}
                  galleryPiecesLeft={galleryPiecesLeft}
                  onToggle={() => setOpenBlock(openBlock === song.id ? undefined : song.id)}
                  onChange={(next) => edit(updateBlock(page, next))}
                  onMove={() => undefined}
                  onRemove={() => edit(removeBlock(page, song.id))}
                />
              ) : (
                canAddBlock(page) && (
                  <button type="button" className="nu-button nu-button--secondary" onClick={() => addType('song', 'left')} data-nu-role="page-editor-add-song">
                    Add a profile song
                  </button>
                )
              )}
            </div>
          </div>

          <div className="nu-page-editor__section" data-nu-role="page-editor-public">
            <h3 className="nu-page-editor__heading">Who can see it</h3>
            <PublicPageSwitch />
          </div>

          <div className="nu-page-editor__section nu-page-editor__danger">
            <button type="button" className="nu-button nu-button--secondary" onClick={() => void handleDiscard()} disabled={!!busy}>
              Discard changes
            </button>
            {published && (
              <button
                type="button"
                className="nu-button nu-button--danger"
                onClick={() => void handleUnpublish()}
                disabled={!!busy}
                data-nu-role="page-editor-unpublish"
              >
                {busy === 'unpublishing' ? 'Taking it down…' : 'Take page down'}
              </button>
            )}
          </div>
        </div>

        <div className="nu-page-editor__preview" data-nu-role="page-editor-preview" aria-label="Preview">
          <ProfilePageFrame page={preview}>
            <PageOwnerContext.Provider value={{ userId: mx.getUserId() ?? '', roomId: getOwnProfileRoomId(mx), isMe: true }}>
              <ProfilePageLayout
                page={preview}
                openIds={openBlock ? [openBlock] : undefined}
                header={
                  <section className="nu-profile-view__card nu-page-editor__preview-card">
                    <h2 className="nu-profile-view__name">{displayName}</h2>
                    <p className="nu-profile-view__handle">{mx.getUserId()}</p>
                  </section>
                }
                posts={
                  <div className="nu-profile-page__posts nu-page-editor__preview-posts">
                    {preview && preview.blocks.length > 0 ? 'Your posts go here.' : 'Add a block to see it here.'}
                  </div>
                }
              />
            </PageOwnerContext.Provider>
          </ProfilePageFrame>
        </div>
      </div>
      {dialog}
    </div>
  );
}

/** "Add a block" under a column: the kinds there's room for, the profile song apart. */
function AddBlock({ page, side, onAdd }: { page: ProfilePage; side: PageSide; onAdd: (type: PageBlockType, side: PageSide) => void }) {
  const types = (Object.keys(BLOCK_LABELS) as PageBlockType[]).filter((type) => type !== 'song' && canAddType(page, type));
  return (
    <label className="nu-field">
      <select
        className="nu-field__input"
        aria-label={`Add a block to the ${side} column`}
        value=""
        onChange={(evt) => evt.target.value && onAdd(evt.target.value as PageBlockType, side)}
        data-nu-role={side === 'left' ? 'page-editor-add-block' : 'page-editor-add-block-right'}
      >
        <option value="">Add a block…</option>
        {types.map((type) => (
          <option key={type} value={type}>
            {BLOCK_LABELS[type]}
          </option>
        ))}
      </select>
    </label>
  );
}
