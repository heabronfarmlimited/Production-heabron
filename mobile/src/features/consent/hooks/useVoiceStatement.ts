/**
 * Records the signer's spoken statement (spec 3.6).
 *
 * The leader says: "I am [name], leader of [cooperative]. I agree to the data
 * consent." Minimum three seconds, with playback so the agent can check it
 * before moving on.
 *
 * Built on expo-audio. Recording is REQUIRED for a cooperative leader and
 * optional for a farmer (spec 4.5 makes the farmer's voice yes configurable,
 * default off for the pilot to protect the onboarding time target).
 *
 * Microphone permission can be refused, and the app still has to work: the
 * caller is told `permissionDenied` so it can fall back to the signature alone
 * rather than trapping the agent on a screen they cannot complete.
 */
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';

import { MIN_VOICE_SECONDS } from '../model/consent';

export interface VoiceStatement {
  uri: string;
  durationSeconds: number;
}

export interface UseVoiceStatement {
  isRecording: boolean;
  /** Seconds elapsed in the current recording. */
  elapsed: number;
  /** The finished recording, or null before one exists. */
  statement: VoiceStatement | null;
  /** True once the recording is at least MIN_VOICE_SECONDS long. */
  isLongEnough: boolean;
  permissionDenied: boolean;
  start: () => Promise<void>;
  stop: () => Promise<VoiceStatement | null>;
  play: () => void;
  reset: () => void;
}

export function useVoiceStatement(): UseVoiceStatement {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  const [statement, setStatement] = useState<VoiceStatement | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const startedAt = useRef<number | null>(null);

  const player = useAudioPlayer(statement ? { uri: statement.uri } : null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const granted = await AudioModule.requestRecordingPermissionsAsync();
      if (cancelled) return;
      if (!granted.granted) {
        setPermissionDenied(true);
        return;
      }
      // Required on iOS, where recording is otherwise silent.
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    })().catch(() => {
      if (!cancelled) setPermissionDenied(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const start = useCallback(async () => {
    if (permissionDenied) return;
    setStatement(null);
    await recorder.prepareToRecordAsync();
    recorder.record();
    startedAt.current = Date.now();
  }, [recorder, permissionDenied]);

  const stop = useCallback(async (): Promise<VoiceStatement | null> => {
    if (!recorderState.isRecording) return null;
    await recorder.stop();

    const uri = recorder.uri;
    // Prefer the recorder's own duration; fall back to wall clock, which is
    // close enough to enforce a three-second floor.
    const reported = recorderState.durationMillis;
    const elapsedMs =
      typeof reported === 'number' && reported > 0
        ? reported
        : startedAt.current
          ? Date.now() - startedAt.current
          : 0;
    startedAt.current = null;

    if (!uri) return null;
    const next = { uri, durationSeconds: Math.round((elapsedMs / 1000) * 10) / 10 };
    setStatement(next);
    return next;
  }, [recorder, recorderState.isRecording, recorderState.durationMillis]);

  const play = useCallback(() => {
    if (!statement) return;
    player.seekTo(0);
    player.play();
  }, [player, statement]);

  const reset = useCallback(() => {
    setStatement(null);
    startedAt.current = null;
  }, []);

  const elapsed = recorderState.isRecording
    ? Math.floor((recorderState.durationMillis ?? 0) / 1000)
    : 0;

  return {
    isRecording: recorderState.isRecording,
    elapsed,
    statement,
    isLongEnough: (statement?.durationSeconds ?? 0) >= MIN_VOICE_SECONDS,
    permissionDenied,
    start,
    stop,
    play,
    reset,
  };
}
