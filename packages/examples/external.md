**Conclusion**
The established solution is called **forced alignment**. It takes known text plus audio and finds the acoustic interval corresponding to every word or phoneme.

Our current implementation is not forced alignment. It detects silence and distributes words using punctuation, syllable length, and estimated speech activity. It can be pleasant and reasonably close, but it cannot know whether the speaker is currently saying “question” or “display” because it has no acoustic language model.

**Best Approach**

1. **TTS-native timestamps**, when the recording was synthesized.
2. **Montreal Forced Aligner**, for existing WAV and transcript pairs.
3. **CTC forced alignment**, when MFA lacks suitable language support.
4. **ElevenLabs or Rev AI forced-alignment APIs**, for an easier cloud option.
5. **Manual review**, for the final guarantee.

If these recordings came from a TTS system, the best solution is to regenerate or retrieve timing metadata from that exact synthesis request. Azure, Amazon Polly, and ElevenLabs can return word or character timings alongside generated audio. That avoids reconstructing information the synthesizer already knew.

For existing files, the strongest local recommendation is [Montreal Forced Aligner](https://montreal-forced-aligner.readthedocs.io/en/latest/user_guide/workflows/alignment.html). MFA uses pronunciation dictionaries, phonemes, acoustic models, and Viterbi alignment. Current controlled benchmarks put typical clean-English word-boundary errors around 20–25 ms, close to disagreement between human annotators.

**Why Not Whisper**
Normal Whisper word timestamps use attention weights, dynamic time warping, and silence heuristics. They are useful for captions, but they are not conventional phonetic forced alignment and can drift by 100–200 ms or occasionally fail across a whole region.

[WhisperX](https://github.com/m-bain/whisperX) is better because it adds a separate wav2vec2/CTC alignment stage. However, it requires language-specific alignment models and published results still generally favor MFA for precise known-transcript boundaries.

WhisperX remains a good secondary option, especially when transcription, diarization, and alignment need to be combined.

**Cloud Option**
[ElevenLabs Forced Alignment](https://elevenlabs.io/docs/api-reference/forced-alignment/create) accepts an audio file and exact transcript and returns character and word intervals. It would be straightforward to call from TypeScript using `fetch` and `FormData`.

[Rev AI Forced Alignment](https://docs.rev.ai/api/alignment) offers similar transcript-conditioned alignment asynchronously.

These are fundamentally better than standard speech-to-text APIs with word timestamps. Ordinary Google, Azure, AWS, Deepgram, and AssemblyAI transcription endpoints timestamp the words they recognized, not necessarily the canonical transcript provided by us.

**Recommended Architecture**
Forced alignment should be an authoring step, not part of TUI startup:

```text
WAV + TXT
    |
    | MFA, TTS metadata, CTC, or cloud alignment
    v
name.alignment.json
    |
    | dependency-free TypeScript validation
    v
OpenTUI playback and highlighting
```

This keeps Python, Kaldi, PyTorch, model downloads, API keys, and network access out of the example runtime. Generated sidecars are small and can be committed with the recordings.

A sidecar should store integer source-WAV frames:

```json
{
  "version": 1,
  "audio": {
    "sha256": "...",
    "sampleRate": 44100,
    "frameCount": 691200
  },
  "transcript": {
    "sha256": "...",
    "language": "en-US"
  },
  "provenance": {
    "timingKind": "forced-alignment",
    "engine": "mfa",
    "engineVersion": "3.4.1",
    "model": "english_mfa"
  },
  "words": [
    {
      "index": 0,
      "surface": "Tactile",
      "sourceUtf8Start": 0,
      "sourceUtf8End": 7,
      "startFrame": 5733,
      "endFrame": 18257,
      "status": "aligned"
    }
  ]
}
```

Audio and transcript hashes prevent stale timings from being loaded after either source changes.

**Runtime Modes**
I recommend three explicit modes:

- `require`: fail unless a valid, hash-matched alignment exists.
- `prefer`: use alignment when available, otherwise use the current heuristic.
- `heuristic`: deliberately ignore sidecars.

Partial alignments should mark words as `unmatched` or `estimated`. They should never silently invent timings while claiming forced alignment.

**Remaining Presentation Work**
Even perfect acoustic timings do not guarantee exact visible synchronization:

- Rendering at 30 FPS introduces up to roughly 33 ms of quantization.
- The application currently applies a fixed 25 ms transcript lead.
- Terminal output and audio-device buffering have separate latency.
- Current lookup holds the previous word through silence because it checks only word starts.

With a sidecar, highlighting should use both `startFrame` and `endFrame`, returning no active word during silence. Acoustic alignment and terminal presentation compensation should remain separate, with the visual lead configurable or calibrated per system.

**What “Perfect” Means**
Fully automatic, objectively perfect word boundaries are not generally possible. Connected speech coarticulates, and adjacent words often have no unique acoustic boundary. Human annotators themselves disagree by around 20–30 ms.

The credible definition of perfect is:

1. Generate a high-quality forced alignment.
2. Review and correct it manually under a documented boundary convention.
3. Store corrected boundaries as exact source-WAV frames.
4. Calibrate the UI presentation offset independently.

For this project, the most practical next implementation would be an external MFA-based alignment command, the sidecar loader, and committed reviewed sidecars for the supplied examples.
