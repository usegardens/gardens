import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  type ProductSubscription,
  useIAP,
} from 'react-native-iap';

const DONATION_BANNER_TEXT = "Gardens Network and it's associated entitites stands firmly against the War in Iran and the neverending colonial machine that has spanned multiple empires and is currently overseeing a genocide of historical proportions. Standing with us is standing with justice.";

const DONATION_PLANS = [
  { id: 'network.gardens.donation.monthly.5', label: '$5' },
  { id: 'network.gardens.donation.monthly.25', label: '$25' },
  { id: 'network.gardens.donation.monthly.50', label: '$50' },
  { id: 'network.gardens.donation.monthly.custom', label: 'Custom', isCustom: true },
] as const;

const DONATION_SUBSCRIPTION_SKUS = DONATION_PLANS.map(plan => plan.id);

interface DonationPromptModalProps {
  visible: boolean;
  onDismiss: () => void;
}

function getAndroidSubscriptionOffers(sub: ProductSubscription | undefined, sku: string) {
  const details = sub?.subscriptionOfferDetailsAndroid ?? [];
  return details
    .filter(detail => typeof detail.offerToken === 'string' && detail.offerToken.length > 0)
    .map(detail => ({ sku, offerToken: detail.offerToken }));
}

export function DonationPromptModal({ visible, onDismiss }: DonationPromptModalProps) {
  const [selectedPlanId, setSelectedPlanId] = useState<string>(DONATION_PLANS[0].id);
  const [loading, setLoading] = useState(false);

  const {
    connected,
    subscriptions,
    fetchProducts,
    requestPurchase,
    finishTransaction,
  } = useIAP({
    onPurchaseSuccess: async purchase => {
      try {
        await finishTransaction({ purchase, isConsumable: false });
      } catch (err) {
        console.warn('[donations] finishTransaction failed:', err);
      } finally {
        setLoading(false);
      }
      Alert.alert('Thank you', 'Your monthly donation is active.');
      onDismiss();
    },
    onPurchaseError: error => {
      setLoading(false);
      if (error.message?.trim()) {
        Alert.alert('Donation failed', error.message);
      }
    },
  });

  useEffect(() => {
    if (!visible) return;
    setSelectedPlanId(DONATION_PLANS[0].id);
  }, [visible]);

  useEffect(() => {
    if (!visible || !connected) return;
    fetchProducts({ skus: DONATION_SUBSCRIPTION_SKUS, type: 'subs' })
      .catch(err => {
        console.warn('[donations] fetchProducts failed:', err);
      });
  }, [visible, connected, fetchProducts]);

  const subscriptionById = useMemo(() => {
    const map = new Map<string, ProductSubscription>();
    subscriptions.forEach(sub => map.set(sub.id, sub));
    return map;
  }, [subscriptions]);

  const selectedPlan = DONATION_PLANS.find(plan => plan.id === selectedPlanId) ?? DONATION_PLANS[0];
  const selectedSubscription = subscriptionById.get(selectedPlan.id);

  async function handleDonate() {
    if (!connected) {
      Alert.alert('Donations unavailable', 'Store connection is not ready yet. Please try again.');
      return;
    }
    if (!selectedSubscription) {
      Alert.alert('Plan unavailable', 'This donation plan is not configured in the app stores yet.');
      return;
    }

    setLoading(true);
    try {
      const androidOffers = getAndroidSubscriptionOffers(selectedSubscription, selectedPlan.id);
      await requestPurchase({
        request: {
          apple: {
            sku: selectedPlan.id,
          },
          google: {
            skus: [selectedPlan.id],
            ...(androidOffers.length > 0 ? { subscriptionOffers: androidOffers } : {}),
          },
        },
        type: 'subs',
      });
    } catch (err: unknown) {
      setLoading(false);
      const message = err instanceof Error ? err.message : 'Unable to start purchase.';
      Alert.alert('Donation failed', message);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.scrim}>
        <View style={styles.card}>
          <Text style={styles.title}>Support Gardens</Text>
          <Text style={styles.subtitle}>
            Monthly donations help keep relay and infrastructure costs covered.
          </Text>

          <View style={styles.banner}>
            <Text style={styles.bannerText}>{DONATION_BANNER_TEXT}</Text>
          </View>

          <View style={styles.amountRow}>
            {DONATION_PLANS.map(plan => {
              const selected = selectedPlanId === plan.id;
              const storePlan = subscriptionById.get(plan.id);
              const label = storePlan?.displayPrice ?? plan.label;
              const unavailable = !storePlan;
              return (
                <Pressable
                  key={plan.id}
                  style={[
                    styles.amountBtn,
                    selected && styles.amountBtnSelected,
                    unavailable && styles.amountBtnDisabled,
                  ]}
                  onPress={() => setSelectedPlanId(plan.id)}
                >
                  <Text style={[styles.amountBtnText, selected && styles.amountBtnTextSelected]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.privacy}>
            Payments are processed by Apple/Google in-app purchases and are not linked to your
            Gardens device keypair, seed phrase, or public key.
          </Text>

          {selectedPlan.isCustom ? (
            <Text style={styles.hint}>
              Custom uses your store-configured monthly custom SKU.
            </Text>
          ) : null}

          <View style={styles.actions}>
            <Pressable style={styles.laterBtn} onPress={onDismiss} disabled={loading}>
              <Text style={styles.laterText}>Later</Text>
            </Pressable>
            <Pressable
              style={[styles.donateBtn, loading && styles.btnDisabled]}
              onPress={handleDonate}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#0a0a0a" />
              ) : (
                <Text style={styles.donateText}>
                  {Platform.OS === 'ios' ? 'Donate Monthly' : 'Subscribe Monthly'}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 18,
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    padding: 18,
    gap: 12,
  },
  title: { color: '#fff', fontSize: 22, fontWeight: '700' },
  subtitle: { color: '#b6b6b6', fontSize: 14, lineHeight: 20 },
  banner: {
    borderWidth: 1,
    borderColor: '#2e2e2e',
    backgroundColor: '#181818',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  bannerText: {
    color: '#d5d5d5',
    fontSize: 11,
    lineHeight: 16,
  },
  amountRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  amountBtn: {
    borderWidth: 1,
    borderColor: '#3a3a3a',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: '#191919',
  },
  amountBtnSelected: {
    borderColor: '#F2E58F',
    backgroundColor: '#2a280f',
  },
  amountBtnDisabled: {
    opacity: 0.55,
  },
  amountBtnText: { color: '#d7d7d7', fontWeight: '600' },
  amountBtnTextSelected: { color: '#F2E58F' },
  privacy: { color: '#9b9b9b', fontSize: 12, lineHeight: 18 },
  hint: { color: '#8b8b8b', fontSize: 11 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  laterBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3a3a3a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  laterText: { color: '#d8d8d8', fontWeight: '600' },
  donateBtn: {
    flex: 2,
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: '#F2E58F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  donateText: { color: '#0a0a0a', fontWeight: '800' },
  btnDisabled: { opacity: 0.7 },
});
