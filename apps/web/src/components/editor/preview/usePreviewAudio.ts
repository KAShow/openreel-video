import { useCallback, useEffect, useRef } from "react";
import {
  getPreviewAudioEffects,
  getRealtimeAudioGraph,
  getSpeedEngine,
  getTrackTransitionAudioFades,
  initializeAudioEffectsEngine,
  resolveClipAudioEffects as resolveTimelineClipAudioEffects,
  resolveClipVolumeAutomation,
  splitProfileAwareNoiseReductionEffects,
  trackHasAudioItems,
  type AudioClipSchedule,
  type AudioEffectParams,
  type Effect,
  type Project,
  type Track,
} from "@openreel/core";

type PreviewClip = Track["clips"][number];

interface UsePreviewAudioOptions {
  project: Project;
  timelineTracks: Track[];
  timelineTracksRef: { current: Track[] };
  isPlaying: boolean;
  isMuted: boolean;
  isInteractingRef: { current: boolean };
  getOriginalMediaItem: (id: string) => { blob?: Blob | null } | undefined;
  mediaClipHasAudio: (clip: PreviewClip) => boolean;
}

const getAudioBufferCacheKey = (
  mediaId: string,
  audioTrackIndex?: number,
): string => `${mediaId}:${audioTrackIndex ?? 0}`;

const loadAudioBuffer = async (
  audioContext: AudioContext | BaseAudioContext,
  blob: Blob,
  audioTrackIndex: number = 0,
): Promise<AudioBuffer | null> => {
  try {
    const { extractAudioWav } = await import("@openreel/core/media");
    const wavBlob = await extractAudioWav(blob, audioTrackIndex);
    const arrayBuffer = await wavBlob.arrayBuffer();
    return await audioContext.decodeAudioData(arrayBuffer);
  } catch (error) {
    if (error instanceof Error && error.name === "NoAudioStreamError") {
      return null;
    }
  }

  if (audioTrackIndex === 0) {
    try {
      const arrayBuffer = await blob.arrayBuffer();
      return await audioContext.decodeAudioData(arrayBuffer);
    } catch {
      return null;
    }
  }
  return null;
};

export const usePreviewAudio = ({
  project,
  timelineTracks,
  timelineTracksRef,
  isPlaying,
  isMuted,
  isInteractingRef,
  getOriginalMediaItem,
  mediaClipHasAudio,
}: UsePreviewAudioOptions) => {
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const audioGraphRef = useRef<ReturnType<typeof getRealtimeAudioGraph> | null>(
    null,
  );
  const audioBufferCacheRef = useRef<Map<string, AudioBuffer>>(new Map());
  const processedAudioBufferCacheRef = useRef<Map<string, AudioBuffer>>(new Map());
  const noAudioBufferRef = useRef<Set<string>>(new Set());

  const getAudioEffectSignature = useCallback(
    (effects: Effect[]): string =>
      JSON.stringify(
        effects.map((effect) => ({
          id: effect.id,
          type: effect.type,
          enabled: effect.enabled,
          params: effect.params,
          metadata: effect.metadata,
        })),
      ),
    [],
  );

  const getPreviewAudioBufferForEffects = useCallback(
    async (
      audioBuffer: AudioBuffer,
      baseCacheKey: string,
      effects: Effect[],
    ): Promise<{ audioBuffer: AudioBuffer; effects: Effect[] }> => {
      const previewEffects = getPreviewAudioEffects(
        effects.filter((effect) => effect.enabled),
      );
      const { profileAwareNoiseEffects, realtimeEffects } =
        splitProfileAwareNoiseReductionEffects(previewEffects);

      if (profileAwareNoiseEffects.length === 0) {
        return { audioBuffer, effects: realtimeEffects };
      }

      const processedCacheKey = `${baseCacheKey}:profile-denoise:${getAudioEffectSignature(profileAwareNoiseEffects)}`;
      const cached = processedAudioBufferCacheRef.current.get(processedCacheKey);
      if (cached) {
        return { audioBuffer: cached, effects: realtimeEffects };
      }

      const effectsEngine = await initializeAudioEffectsEngine();
      let processedBuffer = audioBuffer;

      for (const effect of profileAwareNoiseEffects) {
        const params = effect.params as AudioEffectParams["noiseReduction"];
        if (!params.profile) {
          continue;
        }

        processedBuffer = await effectsEngine.applyNoiseReductionWithProfileData(
          processedBuffer,
          params.profile,
          params.reduction ?? 0.5,
          params.focus ?? "balanced",
          params.threshold ?? -40,
        );
      }

      processedAudioBufferCacheRef.current.set(processedCacheKey, processedBuffer);
      return { audioBuffer: processedBuffer, effects: realtimeEffects };
    },
    [getAudioEffectSignature],
  );

  const getResolvedClipAudioEffects = useCallback(
    (clip: PreviewClip): Effect[] =>
      resolveTimelineClipAudioEffects(clip, {
        tracks: timelineTracksRef.current,
      }),
    [timelineTracksRef],
  );

  const getResolvedClipVolumeAutomation = useCallback(
    (clip: PreviewClip) =>
      resolveClipVolumeAutomation(clip, {
        tracks: timelineTracksRef.current,
      }),
    [timelineTracksRef],
  );

  const cleanupAudioResources = useCallback(() => {
    if (audioSourceRef.current) {
      try {
        audioSourceRef.current.stop();
      } catch {
        // Ignore errors if already stopped
      }
      audioSourceRef.current.disconnect();
      audioSourceRef.current = null;
    }
    if (audioGraphRef.current) {
      audioGraphRef.current.stopScheduler();
      audioGraphRef.current.stopAllClips();
    }
  }, []);

  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = isMuted ? 0 : 1;
    }
    if (audioGraphRef.current) {
      audioGraphRef.current.setPreviewMuted(isMuted);
    }
  }, [isMuted]);

  /**
   * Set up audio playback from the AUDIO TRACK at a given timeline position.
   * Uses RealtimeAudioGraph for real-time audio effects (reverb, delay, EQ, compressor).
   * Audio effects can be on either the audio clip or a linked video clip.
   */
  const setupAudioFromAudioTrack = useCallback(
    async (timelinePosition: number): Promise<void> => {
      const tracks = timelineTracksRef.current;
      const audioTracks = tracks.filter(
        (track) => !track.hidden && trackHasAudioItems(project, track.id),
      );

      if (!audioGraphRef.current) {
        audioGraphRef.current = getRealtimeAudioGraph();
      }
      const audioGraph = audioGraphRef.current;
      audioGraph.setPreviewMuted(isMuted);

      const speedEngine = getSpeedEngine();
      const scheduledClips: AudioClipSchedule[] = [];

      for (const audioTrack of audioTracks) {
        audioGraph.createTrack({
          trackId: audioTrack.id,
          volume: 1,
          pan: 0,
          muted: audioTrack.muted || false,
          solo: audioTrack.solo || false,
          effects: [],
        });

        if (audioTrack.muted) {
          continue;
        }

        for (const audioClip of audioTrack.clips) {
          if (!mediaClipHasAudio(audioClip)) {
            continue;
          }
          const clipEnd = audioClip.startTime + audioClip.duration;

          if (
            timelinePosition >= audioClip.startTime &&
            timelinePosition < clipEnd
          ) {
            const mediaItem = getOriginalMediaItem(audioClip.mediaId);
            if (!mediaItem?.blob) {
              continue;
            }

            const audioCacheKey = getAudioBufferCacheKey(
              audioClip.mediaId,
              audioClip.audioTrackIndex,
            );
            let audioBuffer = audioBufferCacheRef.current.get(audioCacheKey);
            if (!audioBuffer) {
              if (noAudioBufferRef.current.has(audioCacheKey)) {
                continue;
              }
              try {
                const audioContext = audioGraph.getAudioContext();
                const loaded = await loadAudioBuffer(
                  audioContext,
                  mediaItem.blob,
                  audioClip.audioTrackIndex ?? 0,
                );
                if (!loaded) {
                  noAudioBufferRef.current.add(audioCacheKey);
                  continue;
                }
                audioBuffer = loaded;
                audioBufferCacheRef.current.set(audioCacheKey, audioBuffer);
              } catch (error) {
                console.warn(
                  `[Preview] Failed to decode audio for clip ${audioClip.id}:`,
                  error,
                );
                continue;
              }
            }

            const audioEffects = getResolvedClipAudioEffects(audioClip);
            const enabledEffects = audioEffects.filter(
              (effect: Effect) => effect.enabled,
            );
            const previewAudio = await getPreviewAudioBufferForEffects(
              audioBuffer,
              audioCacheKey,
              enabledEffects,
            );

            audioGraph.updateTrackEffects(audioTrack.id, previewAudio.effects);

            const clipLocalTime = timelinePosition - audioClip.startTime;
            const isReverse = speedEngine.isReverse(audioClip.id);
            const transitionFades = getTrackTransitionAudioFades(
              audioTrack,
              audioClip.id,
            );

            let mediaOffset = (audioClip.inPoint || 0) + clipLocalTime;
            if (isReverse) {
              mediaOffset = audioBuffer.duration - mediaOffset;
              mediaOffset = Math.max(0, mediaOffset);
            }

            scheduledClips.push({
              clipId: audioClip.id,
              trackId: audioTrack.id,
              audioBuffer: previewAudio.audioBuffer,
              startTime: audioClip.startTime,
              endTime: clipEnd,
              mediaOffset,
              volume: audioClip.volume ?? 1,
              volumeAutomation: getResolvedClipVolumeAutomation(audioClip),
              pan: 0,
              effects: previewAudio.effects,
              speed: audioClip.speed ?? 1,
              fadeIn: Math.max(
                audioClip.fade?.fadeIn ?? 0,
                transitionFades.fadeIn,
              ),
              fadeOut: Math.max(
                audioClip.fade?.fadeOut ?? 0,
                transitionFades.fadeOut,
              ),
            });
          }
        }
      }

      if (scheduledClips.length > 0) {
        await audioGraph.resume();
        audioGraph.scheduleClips(scheduledClips);
      }
    },
    [
      getOriginalMediaItem,
      getPreviewAudioBufferForEffects,
      getResolvedClipAudioEffects,
      getResolvedClipVolumeAutomation,
      isMuted,
      mediaClipHasAudio,
      project,
      timelineTracksRef,
    ],
  );

  const preDecodeAllAudioBuffers = useCallback(async (): Promise<void> => {
    const tracks = timelineTracksRef.current;
    const audioTracks = tracks.filter((track) => !track.hidden);

    if (!audioGraphRef.current) {
      audioGraphRef.current = getRealtimeAudioGraph();
    }
    const audioGraph = audioGraphRef.current;
    const audioContext = audioGraph.getAudioContext();

    for (const track of audioTracks) {
      for (const clip of track.clips) {
        if (!mediaClipHasAudio(clip)) {
          continue;
        }
        const cacheKey = getAudioBufferCacheKey(clip.mediaId, clip.audioTrackIndex);
        let audioBuffer: AudioBuffer | null | undefined =
          audioBufferCacheRef.current.get(cacheKey);

        if (!audioBuffer) {
          if (noAudioBufferRef.current.has(cacheKey)) {
            continue;
          }
          const mediaItem = getOriginalMediaItem(clip.mediaId);
          if (!mediaItem?.blob) {
            continue;
          }

          try {
            audioBuffer = await loadAudioBuffer(
              audioContext,
              mediaItem.blob,
              clip.audioTrackIndex ?? 0,
            );
            if (audioBuffer) {
              audioBufferCacheRef.current.set(cacheKey, audioBuffer);
            } else {
              noAudioBufferRef.current.add(cacheKey);
            }
          } catch {
            audioBuffer = null;
            noAudioBufferRef.current.add(cacheKey);
          }
        }

        if (audioBuffer) {
          const audioEffects = getResolvedClipAudioEffects(clip).filter(
            (effect: Effect) => effect.enabled,
          );
          if (audioEffects.length > 0) {
            try {
              await getPreviewAudioBufferForEffects(audioBuffer, cacheKey, audioEffects);
            } catch (error) {
              console.warn(
                `[Preview] Failed to pre-process audio effects for clip ${clip.id}:`,
                error,
              );
            }
          }
        }
      }
    }
  }, [
    getOriginalMediaItem,
    getPreviewAudioBufferForEffects,
    getResolvedClipAudioEffects,
    mediaClipHasAudio,
    timelineTracksRef,
  ]);

  // Pre-warm audio decode caches when the timeline settles after an edit so the
  // realtime scheduler finds decoded buffers ready on the first play tick.
  const audioWarmupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioWarmupIdleRef = useRef<number | null>(null);
  useEffect(() => {
    if (isPlaying) {
      return;
    }

    if (audioWarmupTimerRef.current) {
      clearTimeout(audioWarmupTimerRef.current);
    }

    audioWarmupTimerRef.current = setTimeout(() => {
      audioWarmupTimerRef.current = null;
      if (isInteractingRef.current) {
        return;
      }

      const warm = () => {
        void preDecodeAllAudioBuffers().catch(() => {});
      };

      const idle = (
        window as Window & {
          requestIdleCallback?: (
            cb: () => void,
            opts?: { timeout: number },
          ) => number;
        }
      ).requestIdleCallback;

      if (typeof idle === "function") {
        audioWarmupIdleRef.current = idle(warm, { timeout: 1000 });
      } else {
        warm();
      }
    }, 250);

    return () => {
      if (audioWarmupTimerRef.current) {
        clearTimeout(audioWarmupTimerRef.current);
        audioWarmupTimerRef.current = null;
      }
    };
  }, [
    timelineTracks,
    isPlaying,
    preDecodeAllAudioBuffers,
    isInteractingRef,
  ]);

  const getAudioClipsForScheduler = useCallback(
    (time: number): AudioClipSchedule[] => {
      const tracks = timelineTracksRef.current;
      const tracksWithAudio = tracks.filter(
        (track) => !track.hidden && !track.muted,
      );
      const schedules: AudioClipSchedule[] = [];

      for (const track of tracksWithAudio) {
        for (const clip of track.clips) {
          if (!mediaClipHasAudio(clip)) {
            continue;
          }
          const clipEnd = clip.startTime + clip.duration;
          if (clipEnd <= time || clip.startTime > time + 1) {
            continue;
          }

          const audioBuffer = audioBufferCacheRef.current.get(
            getAudioBufferCacheKey(clip.mediaId, clip.audioTrackIndex),
          );
          if (!audioBuffer) {
            continue;
          }

          const audioEffects = getResolvedClipAudioEffects(clip).filter(
            (effect: Effect) => effect.enabled,
          );
          const previewEffects = getPreviewAudioEffects(audioEffects);
          const { profileAwareNoiseEffects, realtimeEffects } =
            splitProfileAwareNoiseReductionEffects(previewEffects);
          let scheduleAudioBuffer = audioBuffer;
          let scheduleEffects = previewEffects;

          if (profileAwareNoiseEffects.length > 0) {
            const processedCacheKey = `${getAudioBufferCacheKey(
              clip.mediaId,
              clip.audioTrackIndex,
            )}:profile-denoise:${getAudioEffectSignature(profileAwareNoiseEffects)}`;
            const processedAudioBuffer =
              processedAudioBufferCacheRef.current.get(processedCacheKey);

            if (processedAudioBuffer) {
              scheduleAudioBuffer = processedAudioBuffer;
              scheduleEffects = realtimeEffects;
            }
          }
          const transitionFades = getTrackTransitionAudioFades(track, clip.id);

          schedules.push({
            clipId: clip.id,
            trackId: track.id,
            audioBuffer: scheduleAudioBuffer,
            startTime: clip.startTime,
            endTime: clipEnd,
            mediaOffset: clip.inPoint || 0,
            volume: clip.volume ?? 1,
            volumeAutomation: getResolvedClipVolumeAutomation(clip),
            pan: 0,
            effects: scheduleEffects,
            speed: clip.speed ?? 1,
            fadeIn: Math.max(
              clip.fade?.fadeIn ?? 0,
              transitionFades.fadeIn,
            ),
            fadeOut: Math.max(
              clip.fade?.fadeOut ?? 0,
              transitionFades.fadeOut,
            ),
          });
        }
      }

      return schedules;
    },
    [
      getAudioEffectSignature,
      getResolvedClipAudioEffects,
      getResolvedClipVolumeAutomation,
      mediaClipHasAudio,
      timelineTracksRef,
    ],
  );

  return {
    audioGraphRef,
    processedAudioBufferCacheRef,
    cleanupAudioResources,
    getResolvedClipAudioEffects,
    setupAudioFromAudioTrack,
    preDecodeAllAudioBuffers,
    getAudioClipsForScheduler,
  };
};
