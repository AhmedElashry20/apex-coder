#!/usr/bin/env python3
"""
APEX TTS Speaker — Text-to-speech using XTTS v2 with cloned voice
Supports Arabic and English with automatic language detection
"""

import os
import sys
import json
import re
import numpy as np
import sounddevice as sd
import soundfile as sf
import torch
from pathlib import Path

SAMPLE_RATE = 24000  # XTTS output sample rate
MODELS_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'models')
DATA_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'data')


class TTSSpeaker:
    def __init__(self):
        self.model = None
        self.speaker_wav = None
        self.device = "cpu"
        self.models_dir = MODELS_DIR

    def load_model(self):
        """Load XTTS v2 model"""
        if self.model is not None:
            return

        print("PROGRESS:Loading XTTS v2 model...", flush=True)

        try:
            from TTS.api import TTS

            # Use XTTS v2 — supports multilingual including Arabic
            self.model = TTS("tts_models/multilingual/multi-dataset/xtts_v2")

            if torch.cuda.is_available():
                self.device = "cuda"
                self.model.to(self.device)
            elif hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
                self.device = "mps"
                # XTTS may not fully support MPS yet, fallback to CPU
                self.device = "cpu"

            print("PROGRESS:XTTS v2 loaded successfully", flush=True)

        except Exception as e:
            print(f"ERROR:Failed to load XTTS: {e}", file=sys.stderr)
            raise

    def set_speaker(self, speaker_wav_path=None):
        """Set the reference speaker audio for voice cloning"""
        if speaker_wav_path and os.path.exists(speaker_wav_path):
            self.speaker_wav = speaker_wav_path
        else:
            # Look for a reference sample in voice_samples
            samples_dir = os.path.join(DATA_DIR, 'voice_samples')
            if os.path.exists(samples_dir):
                audio_files = [
                    f for f in os.listdir(samples_dir)
                    if f.endswith(('.wav', '.mp3', '.flac'))
                ]
                if audio_files:
                    self.speaker_wav = os.path.join(samples_dir, audio_files[0])

        if self.speaker_wav:
            print(f"PROGRESS:Speaker reference set: {os.path.basename(self.speaker_wav)}", flush=True)
        else:
            print("WARNING:No speaker reference found. Using default voice.", file=sys.stderr)

    def detect_language(self, text):
        """Detect if text is Arabic or English"""
        # Arabic Unicode range
        arabic_pattern = re.compile(r'[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]')
        arabic_chars = len(arabic_pattern.findall(text))
        total_alpha = sum(1 for c in text if c.isalpha())

        if total_alpha == 0:
            return 'en'

        arabic_ratio = arabic_chars / total_alpha

        if arabic_ratio > 0.3:
            return 'ar'
        else:
            return 'en'

    def text_to_speech(self, text, language=None, output_path=None):
        """Convert text to speech using XTTS with cloned voice"""
        if self.model is None:
            self.load_model()

        if language is None:
            language = self.detect_language(text)

        print(f"PROGRESS:Generating speech ({language})...", flush=True)

        try:
            kwargs = {
                "text": text,
                "language": language,
            }

            if self.speaker_wav and os.path.exists(self.speaker_wav):
                kwargs["speaker_wav"] = self.speaker_wav

            if output_path:
                kwargs["file_path"] = output_path
                self.model.tts_to_file(**kwargs)
                print(f"PROGRESS:Audio saved to {output_path}", flush=True)

                # Load and return audio array
                audio, sr = sf.read(output_path)
                return audio, sr
            else:
                # Generate to memory
                wav = self.model.tts(**kwargs)

                if isinstance(wav, list):
                    wav = np.array(wav)
                elif isinstance(wav, torch.Tensor):
                    wav = wav.cpu().numpy()

                return wav, SAMPLE_RATE

        except Exception as e:
            print(f"ERROR:TTS generation failed: {e}", file=sys.stderr)
            raise

    def speak(self, text, language=None, device_index=None):
        """Speak text directly through speakers"""
        audio, sr = self.text_to_speech(text, language)

        if isinstance(audio, np.ndarray):
            # Normalize
            max_val = np.max(np.abs(audio))
            if max_val > 0:
                audio = audio / max_val * 0.9

            print("PROGRESS:Playing audio...", flush=True)
            sd.play(audio, sr, device=device_index)
            sd.wait()
            print("PROGRESS:Audio playback complete", flush=True)
        else:
            print("ERROR:Invalid audio data", file=sys.stderr)

    def speak_to_virtual_mic(self, text, language=None, virtual_device_index=None):
        """Route speech output to virtual microphone (BlackHole)"""
        audio, sr = self.text_to_speech(text, language)

        if isinstance(audio, np.ndarray):
            max_val = np.max(np.abs(audio))
            if max_val > 0:
                audio = audio / max_val * 0.9

            if virtual_device_index is not None:
                sd.play(audio, sr, device=virtual_device_index)
                sd.wait()
            else:
                # Try to find BlackHole device
                devices = sd.query_devices()
                for i, dev in enumerate(devices):
                    if 'blackhole' in dev['name'].lower() and dev['max_output_channels'] > 0:
                        sd.play(audio, sr, device=i)
                        sd.wait()
                        return audio, sr

                # Fallback to default output
                sd.play(audio, sr)
                sd.wait()

        return audio, sr

    def stream_speak(self, text, language=None, chunk_size=100):
        """Stream speech generation for lower latency"""
        if self.model is None:
            self.load_model()

        if language is None:
            language = self.detect_language(text)

        # Split text into smaller chunks for streaming
        sentences = self._split_sentences(text)

        for sentence in sentences:
            if sentence.strip():
                try:
                    audio, sr = self.text_to_speech(sentence.strip(), language)
                    if isinstance(audio, np.ndarray) and len(audio) > 0:
                        yield audio, sr
                except Exception as e:
                    print(f"ERROR:Stream chunk failed: {e}", file=sys.stderr)
                    continue

    def _split_sentences(self, text):
        """Split text into sentences for streaming"""
        # Split on sentence-ending punctuation
        delimiters = r'[.!?،؟\n]+'
        sentences = re.split(delimiters, text)
        return [s.strip() for s in sentences if s.strip()]


def main():
    speaker = TTSSpeaker()

    if len(sys.argv) < 2:
        print("Usage: tts_speaker.py [speak|generate|stream] <text> [language]")
        sys.exit(1)

    command = sys.argv[1]
    text = sys.argv[2] if len(sys.argv) > 2 else "مرحباً، أنا APEX"
    language = sys.argv[3] if len(sys.argv) > 3 else None

    speaker.load_model()
    speaker.set_speaker()

    if command == 'speak':
        speaker.speak(text, language)

    elif command == 'generate':
        output_path = os.path.join(DATA_DIR, 'tts_output.wav')
        audio, sr = speaker.text_to_speech(text, language, output_path)
        print(json.dumps({"output": output_path, "sample_rate": sr, "duration": len(audio) / sr}))

    elif command == 'virtual':
        speaker.speak_to_virtual_mic(text, language)

    elif command == 'stream':
        for audio_chunk, sr in speaker.stream_speak(text, language):
            sd.play(audio_chunk, sr)
            sd.wait()

    elif command == 'detect':
        lang = speaker.detect_language(text)
        print(json.dumps({"text": text, "language": lang}))

    else:
        print(f"Unknown command: {command}")
        sys.exit(1)


if __name__ == "__main__":
    main()
