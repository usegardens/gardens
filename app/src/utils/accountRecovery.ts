import { useConversationsStore } from '../stores/useConversationsStore';
import { useJoinRequestsStore } from '../stores/useJoinRequestsStore';
import { useMessagesStore } from '../stores/useMessagesStore';
import { useOrgsStore } from '../stores/useOrgsStore';
import { useProfileStore } from '../stores/useProfileStore';
import { deriveInboxTopicHex, deriveOrgAdminTopicHex, useSyncStore } from '../stores/useSyncStore';

const INBOX_HYDRATE_TIMEOUT_MS = 10_000;
const TOPIC_HYDRATE_TIMEOUT_MS = 6_000;
const TOPIC_SETTLE_MS = 800;
const MAX_DISCOVERY_PASSES = 2;

async function hydrateTopicSafe(topicHex: string, timeoutMs: number): Promise<void> {
  try {
    await useSyncStore.getState().hydrateTopic(topicHex, {
      timeoutMs,
      settleMs: TOPIC_SETTLE_MS,
    });
  } catch (err) {
    console.warn(`[recovery] hydrate failed for topic ${topicHex.slice(0, 16)}…`, err);
  }
}

async function refreshRecoveredState(): Promise<void> {
  await Promise.all([
    useConversationsStore.getState().fetchConversations().catch(() => {}),
    useJoinRequestsStore.getState().fetchThreads().catch(() => {}),
    useOrgsStore.getState().fetchMyOrgs().catch(() => {}),
    useProfileStore.getState().fetchMyProfile().catch(() => {}),
  ]);
}

function collectDiscoveryTopics(): string[] {
  const conversationState = useConversationsStore.getState();
  const joinRequestState = useJoinRequestsStore.getState();
  const orgState = useOrgsStore.getState();

  const threadTopics = [
    ...conversationState.conversations.map(t => t.threadId),
    ...conversationState.requests.map(t => t.threadId),
    ...joinRequestState.threads.map(t => t.threadId),
  ];

  const orgTopics = orgState.orgs.flatMap(org => [org.orgId, deriveOrgAdminTopicHex(org.orgId)]);
  return [...threadTopics, ...orgTopics];
}

/**
 * After seed import on a fresh install, rehydrate account state from sync topics.
 * This restores DMs, org memberships, and recent metadata into the local DB.
 */
export async function bootstrapRecoveredAccount(publicKeyHex: string): Promise<void> {
  if (!publicKeyHex) return;

  // First hydrate personal inbox topic so thread/org discovery ops are replayed.
  await hydrateTopicSafe(deriveInboxTopicHex(publicKeyHex), INBOX_HYDRATE_TIMEOUT_MS);
  await refreshRecoveredState();

  const hydrated = new Set<string>();
  for (let pass = 0; pass < MAX_DISCOVERY_PASSES; pass += 1) {
    const nextTopics = collectDiscoveryTopics().filter(topic => !hydrated.has(topic));
    if (nextTopics.length === 0) break;

    await Promise.all(
      nextTopics.map(async topic => {
        hydrated.add(topic);
        await hydrateTopicSafe(topic, TOPIC_HYDRATE_TIMEOUT_MS);
      }),
    );
    await refreshRecoveredState();
  }

  // Load rooms for restored orgs and pull recent DM messages to recover profile cards.
  const { orgs, fetchRooms } = useOrgsStore.getState();
  await Promise.all(orgs.map(org => fetchRooms(org.orgId).catch(() => {})));

  const { conversations, requests } = useConversationsStore.getState();
  const { threads } = useJoinRequestsStore.getState();
  const { fetchMessages } = useMessagesStore.getState();
  const threadIds = [
    ...conversations.map(t => t.threadId),
    ...requests.map(t => t.threadId),
    ...threads.map(t => t.threadId),
  ];
  await Promise.all(threadIds.map(threadId => fetchMessages(null, threadId, 30).catch(() => {})));
}
