/**
 * Data consent capture — Flow A (cooperative) and Flow B (farmer).
 *
 * "CoopScore Data Consent Specification" v1.0. The flow is a mandatory gate:
 * a cooperative cannot be registered and a farmer cannot be submitted until it
 * completes, and the server enforces that independently of this screen.
 *
 * Steps: notice -> one question per screen -> signer details -> voice
 * statement (cooperative) -> signature -> submit.
 *
 * Usability rules from section 10 are deliberate, not styling preferences:
 * one question per screen, large Yes/No buttons, no typing asked of the
 * signer, and a signature box big enough for a finger on a small phone.
 */
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { AppButton } from '../../../components/AppButton';
import { AppTextField } from '../../../components/AppTextField';
import { BaseAppBar } from '../../../components/BaseAppBar';
import { useLocation } from '../../../core/hooks/useLocation';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights } from '../../../core/theme/typography';
import { showApiError } from '../../../core/utils/toast';
import * as consentApi from '../api/consentApi';
import { SignaturePad } from '../components/SignaturePad';
import { useVoiceStatement } from '../hooks/useVoiceStatement';
import {
  AGREEMENT_VERSION,
  CONSENT_NOTICE,
  MIN_VOICE_SECONDS,
  declinedRequiredItems,
  questionsFor,
  requiredItemsAgreed,
  type ConsentAnswers,
  type ConsentEntityType,
  type ConsentRecord,
} from '../model/consent';

type Step = 'notice' | 'questions' | 'signer' | 'voice' | 'signature' | 'submitting';

export interface ConsentFlowProps {
  entityType: ConsentEntityType;
  /** Required for a farmer: constrains F3 to the cooperative's decision. */
  cooperativeId?: string;
  /** Pre-fills the signer, e.g. the cooperative leader already entered. */
  defaultSignerName?: string;
  defaultSignerPhone?: string;
  /** Called with the consent id once it is recorded. */
  onComplete: (consent: ConsentRecord) => void;
  onCancel?: () => void;
}

export function ConsentFlowScreen({
  entityType,
  cooperativeId,
  defaultSignerName = '',
  defaultSignerPhone = '',
  onComplete,
  onCancel,
}: ConsentFlowProps) {
  const router = useRouter();
  const questions = useMemo(() => questionsFor(entityType), [entityType]);

  const [step, setStep] = useState<Step>('notice');
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<ConsentAnswers>({});

  const [signerName, setSignerName] = useState(defaultSignerName);
  const [signerRole, setSignerRole] = useState(entityType === 'cooperative' ? 'Leader' : '');
  const [signerPhone, setSignerPhone] = useState(defaultSignerPhone);
  const [signerEmail, setSignerEmail] = useState('');
  const [signatureSvg, setSignatureSvg] = useState<string | null>(null);
  const [unableToSign, setUnableToSign] = useState(false);

  const voice = useVoiceStatement();
  const { fetchLocation } = useLocation();

  // Where the consent was collected (spec 7: gps_location). Captured at
  // submit, not on mount, so a refused permission never blocks the flow.
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  const isCooperative = entityType === 'cooperative';
  const current = questions[questionIndex];

  // A declined required item ends the flow. The spec is explicit that the
  // person is not registered and the attempt is logged without personal
  // details — so nothing captured here is sent.
  const declined = declinedRequiredItems(entityType, answers);
  const blocked = declined.length > 0;

  const answer = useCallback(
    (value: boolean) => {
      const q = questions[questionIndex];
      if (!q) return;
      setAnswers((prev) => ({ ...prev, [q.id]: value }));

      if (q.required && value === false) return; // falls through to the blocked view
      if (questionIndex + 1 < questions.length) setQuestionIndex((i) => i + 1);
      else setStep('signer');
    },
    [questionIndex, questions],
  );

  const submit = useCallback(async () => {
    setStep('submitting');
    try {
      const where = coords ?? (await fetchLocation().catch(() => null));
      if (where && !coords) setCoords(where);
      let signatureFile: string | undefined;
      let voiceFile: string | undefined;

      if (signatureSvg) {
        // Written to a data URI rather than a temp file: the upload helper
        // takes a uri, and this avoids a filesystem round trip for a few KB.
        const uri = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(signatureSvg)))}`;
        signatureFile = await consentApi.uploadSignature(uri);
      }
      if (voice.statement) {
        voiceFile = await consentApi.uploadVoice(voice.statement.uri);
      }

      const record = await consentApi.recordConsent({
        entityType,
        cooperativeId,
        agreementVersion: AGREEMENT_VERSION,
        language: 'en',
        itemResponses: answers,
        signerName: signerName.trim(),
        signerRole: signerRole.trim() || undefined,
        signerPhone: signerPhone.trim() || undefined,
        signerEmail: signerEmail.trim() || undefined,
        signatureFile,
        voiceFile,
        voiceDurationSeconds: voice.statement?.durationSeconds,
        unableToSign,
        timestampDevice: new Date().toISOString(),
        gpsLatitude: where?.latitude,
        gpsLongitude: where?.longitude,
      });

      onComplete(record);
    } catch (err) {
      showApiError(err, 'Could not record consent');
      setStep('signature');
    }
  }, [
    answers,
    coords,
    fetchLocation,
    cooperativeId,
    entityType,
    onComplete,
    signatureSvg,
    signerEmail,
    signerName,
    signerPhone,
    signerRole,
    unableToSign,
    voice.statement,
  ]);

  // ─────────────────────────────────────────────────────────── blocked

  if (blocked) {
    return (
      <View style={styles.root}>
        <BaseAppBar title="Consent" />
        <View style={styles.centered}>
          <Text style={styles.blockedTitle}>
            {isCooperative ? 'Cooperative cannot be registered' : 'Farmer cannot be registered'}
          </Text>
          <Text style={styles.blockedBody}>
            {isCooperative
              ? 'All of the required agreements are needed before a cooperative can be registered. Nothing has been saved.'
              : 'Both required agreements are needed before a farmer can be registered. Nothing has been saved.'}
          </Text>
          <AppButton
            text="Back"
            onPress={() => (onCancel ? onCancel() : router.back())}
            fullWidth
          />
        </View>
      </View>
    );
  }

  // ─────────────────────────────────────────────────────────── steps

  return (
    <View style={styles.root}>
      <BaseAppBar title={isCooperative ? 'Cooperative consent' : 'Farmer consent'} />

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {step === 'notice' && (
          <>
            <Text style={styles.heading}>Read this aloud</Text>
            <Text style={styles.noticeHelp}>
              Read the notice below to the{' '}
              {isCooperative ? 'cooperative leader' : 'farmer'} in a language they understand,
              then continue.
            </Text>
            <View style={styles.noticeBox}>
              <Text style={styles.noticeText}>{CONSENT_NOTICE[entityType]}</Text>
            </View>
            <AppButton text="I have read this aloud" onPress={() => setStep('questions')} />
          </>
        )}

        {step === 'questions' && current && (
          <>
            <Text style={styles.progress}>
              Question {questionIndex + 1} of {questions.length}
            </Text>
            <Text style={styles.question}>{current.prompt}</Text>
            {!current.required && (
              <Text style={styles.optionalNote}>
                They can say no to this one and still be registered.
              </Text>
            )}

            <View style={styles.yesNo}>
              <TouchableOpacity
                style={[styles.choice, styles.choiceNo]}
                onPress={() => answer(false)}
                accessibilityRole="button"
                accessibilityLabel="No"
              >
                <Text style={styles.choiceIcon}>✕</Text>
                <Text style={styles.choiceText}>No</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.choice, styles.choiceYes]}
                onPress={() => answer(true)}
                accessibilityRole="button"
                accessibilityLabel="Yes"
              >
                <Text style={[styles.choiceIcon, styles.choiceIconYes]}>✓</Text>
                <Text style={[styles.choiceText, styles.choiceTextYes]}>Yes</Text>
              </TouchableOpacity>
            </View>

            {questionIndex > 0 && (
              <TouchableOpacity
                onPress={() => setQuestionIndex((i) => i - 1)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.back}>Back to the previous question</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {step === 'signer' && (
          <>
            <Text style={styles.heading}>Who is agreeing?</Text>
            <AppTextField
              title={isCooperative ? "Leader's name" : "Farmer's name"}
              value={signerName}
              onChangeText={setSignerName}
            />
            {isCooperative && (
              <AppTextField title="Role" value={signerRole} onChangeText={setSignerRole} />
            )}
            <AppTextField
              title="Phone number"
              value={signerPhone}
              onChangeText={setSignerPhone}
              keyboardType="phone-pad"
            />
            <AppTextField
              title="Email address (optional)"
              value={signerEmail}
              onChangeText={setSignerEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <Text style={styles.help}>
              If an email address is given, a 6-digit code is sent there to confirm the
              agreement. Without one, the consent is saved and an administrator confirms it.
            </Text>

            <AppButton
              text="Continue"
              onPress={() => setStep(isCooperative ? 'voice' : 'signature')}
              disabled={signerName.trim().length < 2}
            />
          </>
        )}

        {step === 'voice' && (
          <>
            <Text style={styles.heading}>Record the statement</Text>
            <Text style={styles.help}>
              Ask the leader to say: &ldquo;I am {signerName || '[name]'}, leader of this
              cooperative. I agree to the data consent.&rdquo;
            </Text>

            {voice.permissionDenied ? (
              <View style={styles.warnBox}>
                <Text style={styles.warnText}>
                  Microphone access is off, so the statement cannot be recorded. You can
                  continue with the signature alone and record it later.
                </Text>
              </View>
            ) : (
              <View style={styles.recorder}>
                {voice.isRecording ? (
                  <>
                    <Text style={styles.recordingDot}>● Recording… {voice.elapsed}s</Text>
                    <AppButton text="Stop" onPress={() => void voice.stop()} isOutlined />
                  </>
                ) : voice.statement ? (
                  <>
                    <Text style={styles.recorded}>
                      Recorded {voice.statement.durationSeconds}s
                      {voice.isLongEnough ? '' : ` — needs at least ${MIN_VOICE_SECONDS}s`}
                    </Text>
                    <View style={styles.row}>
                      <AppButton text="Play" onPress={voice.play} isOutlined fullWidth={false} width={120} />
                      <AppButton
                        text="Record again"
                        onPress={() => void voice.start()}
                        isOutlined
                        fullWidth={false}
                        width={150}
                      />
                    </View>
                  </>
                ) : (
                  <AppButton text="Start recording" onPress={() => void voice.start()} />
                )}
              </View>
            )}

            <AppButton
              text="Continue"
              onPress={() => setStep('signature')}
              disabled={
                !voice.permissionDenied && Boolean(voice.statement) && !voice.isLongEnough
              }
            />
          </>
        )}

        {step === 'signature' && (
          <>
            <Text style={styles.heading}>Signature</Text>
            {unableToSign ? (
              <View style={styles.warnBox}>
                <Text style={styles.warnText}>
                  Marked as unable to sign. The consent will be saved with the recorded
                  statement and the details entered.
                </Text>
              </View>
            ) : (
              <SignaturePad
                label={`Ask the ${isCooperative ? 'leader' : 'farmer'} to sign below`}
                onChange={(hasSignature) => {
                  if (!hasSignature) setSignatureSvg(null);
                }}
                onCapture={setSignatureSvg}
              />
            )}

            <TouchableOpacity
              onPress={() => {
                setUnableToSign((v) => !v);
                setSignatureSvg(null);
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.back}>
                {unableToSign ? 'They can sign after all' : 'They are unable to sign'}
              </Text>
            </TouchableOpacity>

            <AppButton
              text="Save consent"
              onPress={() => void submit()}
              disabled={!requiredItemsAgreed(entityType, answers) || (!signatureSvg && !unableToSign)}
            />
          </>
        )}

        {step === 'submitting' && (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.help}>Saving consent…</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  body: { padding: r(20), gap: h(16), paddingBottom: h(48) },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: r(24), gap: h(16) },

  heading: { fontSize: spMin(20), fontFamily: fontWeights.bold, color: colors.black },
  progress: { fontSize: spMin(13), fontFamily: fontWeights.medium, color: colors.secondaryTextColor },
  question: { fontSize: spMin(19), fontFamily: fontWeights.semiBold, color: colors.black, lineHeight: spMin(28) },
  optionalNote: { fontSize: spMin(13), fontFamily: fontWeights.regular, color: colors.secondaryTextColor },
  help: { fontSize: spMin(13), fontFamily: fontWeights.regular, color: colors.secondaryTextColor, lineHeight: spMin(20) },
  back: { fontSize: spMin(14), fontFamily: fontWeights.medium, color: colors.primary, textAlign: 'center', paddingVertical: h(8) },

  noticeHelp: { fontSize: spMin(14), fontFamily: fontWeights.regular, color: colors.secondaryTextColor, lineHeight: spMin(21) },
  noticeBox: { backgroundColor: colors.white, borderRadius: r(12), borderWidth: 1, borderColor: colors.border, padding: r(16) },
  noticeText: { fontSize: spMin(15), fontFamily: fontWeights.regular, color: colors.black, lineHeight: spMin(24) },

  yesNo: { flexDirection: 'row', gap: r(14), marginTop: h(8) },
  choice: {
    flex: 1,
    paddingVertical: h(28),
    borderRadius: r(14),
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    gap: h(6),
  },
  choiceNo: { borderColor: colors.border, backgroundColor: colors.white },
  choiceYes: { borderColor: colors.primary, backgroundColor: colors.primary },
  choiceIcon: { fontSize: spMin(26), color: colors.black },
  choiceIconYes: { color: colors.white },
  choiceText: { fontSize: spMin(17), fontFamily: fontWeights.bold, color: colors.black },
  choiceTextYes: { color: colors.white },

  recorder: { gap: h(12), alignItems: 'stretch' },
  recordingDot: { fontSize: spMin(16), fontFamily: fontWeights.semiBold, color: colors.failure, textAlign: 'center' },
  recorded: { fontSize: spMin(15), fontFamily: fontWeights.medium, color: colors.black, textAlign: 'center' },
  row: { flexDirection: 'row', gap: r(12), justifyContent: 'center' },

  warnBox: { backgroundColor: colors.secondary, borderRadius: r(12), padding: r(14) },
  warnText: { fontSize: spMin(14), fontFamily: fontWeights.regular, color: colors.secondaryDeep, lineHeight: spMin(21) },

  blockedTitle: { fontSize: spMin(20), fontFamily: fontWeights.bold, color: colors.black, textAlign: 'center' },
  blockedBody: { fontSize: spMin(15), fontFamily: fontWeights.regular, color: colors.secondaryTextColor, textAlign: 'center', lineHeight: spMin(23) },
});
