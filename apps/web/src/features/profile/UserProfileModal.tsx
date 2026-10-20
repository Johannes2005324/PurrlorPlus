import { useState } from 'react';
import { useSetAtom } from 'jotai';
import type { VerificationRequest } from 'matrix-js-sdk/lib/crypto-api';
import { profileUserIdAtom, selectedRoomIdAtom, selectedSpaceIdAtom, railSectionAtom } from '../../app/state/selection';
import { Avatar } from '../../components/Avatar';
import { Modal } from '../../components/Modal';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { openDirectMessage } from '../../matrix/directMessages';
import { useExtendedProfile } from '../../matrix/hooks/useExtendedProfile';
import { useIsUserIgnored } from '../../matrix/hooks/useIsUserIgnored';
import { useMediaUrl } from '../../matrix/hooks/useMediaUrl';
import { usePresenceInfo } from '../../matrix/hooks/usePresenceInfo';
import { useUserVerificationStatus } from '../../matrix/hooks/useUserVerificationStatus';
import { ignoreUser, unignoreUser } from '../../matrix/ignoredUsers';
import { requestCrossUserVerification } from '../../matrix/verification';
import { VerificationSasContent } from '../security/VerificationSasModal';
import './UserProfileModal.css';

export function UserProfileModal({
  userId,
  displayName,
  avatarMxcUrl,
  onClose,
}: {
  userId: string;
  displayName: string;
  avatarMxcUrl?: string | null;
  onClose: () => void;
}) {
  const mx = useMatrixClient();
  const setSelectedRoomId = useSetAtom(selectedRoomIdAtom);
  const setRailSection = useSetAtom(railSectionAtom);
  const setSelectedSpaceId = useSetAtom(selectedSpaceIdAtom);
  const setProfileUserId = useSetAtom(profileUserIdAtom);
  const isIgnored = useIsUserIgnored(userId);
  const isVerified = useUserVerificationStatus(userId);
  const { profile: extendedProfile } = useExtendedProfile(userId);
  const { statusMsg } = usePresenceInfo(userId);
  const bannerUrl = useMediaUrl(extendedProfile.bannerUrl, { width: 600, height: 180, method: 'crop' });
  const [starting, setStarting] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string>();
  const [verificationRequest, setVerificationRequest] = useState<VerificationRequest>();
  const isSelf = userId === mx.getUserId();

  const handleMessage = async () => {
    if (starting) return;
    setStarting(true);
    setError(undefined);
    try {
      const roomId = await openDirectMessage(mx, userId);
      setSelectedSpaceId(null);
      setSelectedRoomId(roomId);
      setRailSection('messages');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start conversation');
      setStarting(false);
    }
  };

  const handleToggleBlock = async () => {
    if (blocking) return;
    setBlocking(true);
    setError(undefined);
    try {
      await (isIgnored ? unignoreUser(mx, userId) : ignoreUser(mx, userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update block status');
    } finally {
      setBlocking(false);
    }
  };

  const handleVerify = async () => {
    if (verifying) return;
    setVerifying(true);
    setError(undefined);
    try {
      const roomId = await openDirectMessage(mx, userId);
      setVerificationRequest(await requestCrossUserVerification(mx, userId, roomId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start verification');
    } finally {
      setVerifying(false);
    }
  };

  if (verificationRequest) {
    return (
      <Modal title="Verify" onClose={onClose}>
        <VerificationSasContent request={verificationRequest} onClose={() => setVerificationRequest(undefined)} />
      </Modal>
    );
  }

  return (
    <Modal title="Profile" onClose={onClose}>
      <div className="nu-user-profile" data-nu-role="user-profile">
        {bannerUrl && (
          <div
            className="nu-user-profile__banner"
            style={{ backgroundImage: `url(${bannerUrl})` }}
            data-nu-role="user-profile-banner"
          />
        )}
        <Avatar
          name={displayName}
          mxcUrl={avatarMxcUrl}
          size={68}
          animated={extendedProfile.avatarAnimated}
        />
        <div className="nu-user-profile__name">{displayName}</div>
        <div className="nu-user-profile__id">{userId}</div>
        {statusMsg && (
          <div className="nu-user-profile__status" data-nu-role="user-profile-status">
            {statusMsg}
          </div>
        )}
        {isVerified && (
          <div className="nu-user-profile__verified" data-nu-role="user-profile-verified">
            ✅ Verified
          </div>
        )}
        {extendedProfile.bio && (
          <p className="nu-user-profile__bio" data-nu-role="user-profile-bio">
            {extendedProfile.bio}
          </p>
        )}
        {error && (
          <p className="nu-field__error" data-nu-role="user-profile-error">
            {error}
          </p>
        )}
        <button
          type="button"
          className="nu-button nu-button--secondary"
          data-nu-role="user-profile-view-posts"
          onClick={() => {
            setProfileUserId(userId);
            onClose();
          }}
        >
          View posts
        </button>
        {!isSelf && (
          <div className="nu-user-profile__actions">
            <button
              type="button"
              className="nu-button nu-button--primary"
              data-nu-role="user-profile-message"
              onClick={handleMessage}
              disabled={starting}
            >
              {starting ? 'Opening…' : 'Message'}
            </button>
            {isVerified === false && (
              <button
                type="button"
                className="nu-button nu-button--secondary"
                data-nu-role="user-profile-verify"
                onClick={handleVerify}
                disabled={verifying}
              >
                {verifying ? 'Starting…' : 'Verify'}
              </button>
            )}
            <button
              type="button"
              className="nu-button nu-button--secondary"
              data-nu-role="user-profile-block"
              onClick={handleToggleBlock}
              disabled={blocking}
            >
              {isIgnored ? 'Unblock' : 'Block'}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
