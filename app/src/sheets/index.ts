import { registerSheet, SheetDefinition } from 'react-native-actions-sheet';
import { AttachSheet } from './AttachSheet';
import { ProfileSheet } from './ProfileSheet';
import { FabSheet } from './FabSheet';
import { EditProfileSheet } from './EditProfileSheet';
import { EditAvailableForSheet } from './EditAvailableForSheet';
import { BackupSeedSheet } from './BackupSeedSheet';
import { ExportDataSheet } from './ExportDataSheet';
import { DeleteAccountSheet } from './DeleteAccountSheet';
import { MemberActionsSheet } from './MemberActionsSheet';
import { MemberModerationSheet } from './MemberModerationSheet';
import { EditOrgSheet } from './EditOrgSheet';
import { MessageActionsSheet } from './MessageActionsSheet';
import { ConversationActionsSheet } from './ConversationActionsSheet';
import { ChannelActionsSheet } from './ChannelActionsSheet';
import { EmojiPickerSheet } from './EmojiPickerSheet';
import { LocationPickerSheet } from './LocationPickerSheet';
import { InterestsSheet } from './InterestsSheet';
import { JoinOrgSheet } from './JoinOrgSheet';

registerSheet('attach-sheet', AttachSheet);
registerSheet('profile-sheet', ProfileSheet);
registerSheet('fab-sheet', FabSheet);
registerSheet('edit-profile-sheet', EditProfileSheet);
registerSheet('edit-available-for-sheet', EditAvailableForSheet);
registerSheet('backup-seed-sheet', BackupSeedSheet);
registerSheet('export-data-sheet', ExportDataSheet);
registerSheet('delete-account-sheet', DeleteAccountSheet);
registerSheet('member-actions-sheet', MemberActionsSheet);
registerSheet('member-moderation-sheet', MemberModerationSheet);
registerSheet('edit-org-sheet', EditOrgSheet);
registerSheet('message-actions-sheet', MessageActionsSheet);
registerSheet('conversation-actions-sheet', ConversationActionsSheet);
registerSheet('channel-actions-sheet', ChannelActionsSheet);
registerSheet('emoji-picker-sheet', EmojiPickerSheet);
registerSheet('location-picker-sheet', LocationPickerSheet);
registerSheet('interests-sheet', InterestsSheet);
registerSheet('join-org-sheet', JoinOrgSheet);

declare module 'react-native-actions-sheet' {
  interface Sheets {
    'attach-sheet': SheetDefinition<{ returnValue: 'media' | 'gif' }>;
    'profile-sheet': SheetDefinition;
    'fab-sheet': SheetDefinition;
    'edit-profile-sheet': SheetDefinition;
    'edit-available-for-sheet': SheetDefinition;
    'backup-seed-sheet': SheetDefinition;
    'export-data-sheet': SheetDefinition;
    'delete-account-sheet': SheetDefinition;
    'member-actions-sheet': SheetDefinition;
    'member-moderation-sheet': SheetDefinition;
    'edit-org-sheet': SheetDefinition;
    'message-actions-sheet': SheetDefinition;
    'conversation-actions-sheet': SheetDefinition<{ payload: { title?: string; onDelete?: () => void; actionLabel?: string } }>;
    'channel-actions-sheet': SheetDefinition<{ payload: { channelName?: string; channelId?: string; orgId?: string; onOpenSettings?: () => void; onDelete?: () => void } }>;
    'emoji-picker-sheet': SheetDefinition;
    'location-picker-sheet': SheetDefinition;
    'interests-sheet': SheetDefinition;
    'join-org-sheet': SheetDefinition;
  }
}

export {};
