#!/usr/bin/env python3
"""
APEX Voice Engine — Main orchestrator for voice cloning system
Handles setup, training, testing, and coordination of all voice components
"""

import os
import sys
import json
import subprocess
import shutil
import numpy as np
import soundfile as sf
import librosa

sys.path.insert(0, os.path.dirname(__file__))

from rvc_cloner import RVCCloner
from tts_speaker import TTSSpeaker
from audio_router import AudioRouter

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'data')
MODELS_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'models')


class VoiceEngine:
    def __init__(self):
        self.cloner = RVCCloner(os.path.join(MODELS_DIR, 'rvc'))
        self.speaker = None  # Lazy load — XTTS is heavy
        self.router = AudioRouter()
        self.voice_ready = False
        self.samples_dir = os.path.join(DATA_DIR, 'voice_samples')

    def setup_voice(self, samples_path=None):
        """Complete voice setup pipeline"""
        samples_path = samples_path or self.samples_dir

        print("SETUP:Starting APEX voice setup...", flush=True)

        # Step 1: Check BlackHole
        print("SETUP:Step 1/5 — Checking BlackHole...", flush=True)
        if self.router.blackhole_device:
            print(f"SETUP:BlackHole found: {self.router.blackhole_device['name']}", flush=True)
        else:
            print("SETUP:WARNING — BlackHole not found!", flush=True)
            print("SETUP:Install with: brew install blackhole-2ch", flush=True)
            print("SETUP:Continuing without virtual mic support...", flush=True)

        # Step 2: Validate and preprocess samples
        print("SETUP:Step 2/5 — Validating voice samples...", flush=True)
        samples_info = self._validate_samples(samples_path)
        if not samples_info['valid']:
            print(f"SETUP:ERROR — {samples_info['message']}", flush=True)
            return {"success": False, "error": samples_info['message']}

        print(f"SETUP:Found {samples_info['count']} audio files, "
              f"total duration: {samples_info['duration']:.1f} seconds", flush=True)

        # Step 3: Train RVC voice model
        print("SETUP:Step 3/5 — Training voice model (this takes 15-30 minutes)...", flush=True)
        try:
            train_result = self.cloner.train_voice(samples_path)
            print(f"SETUP:Voice model trained with {train_result['segments']} segments", flush=True)
        except Exception as e:
            print(f"SETUP:ERROR — Training failed: {e}", flush=True)
            return {"success": False, "error": str(e)}

        # Step 4: Load XTTS
        print("SETUP:Step 4/5 — Loading XTTS v2...", flush=True)
        try:
            self.speaker = TTSSpeaker()
            self.speaker.load_model()
            self.speaker.set_speaker()
            print("SETUP:XTTS v2 loaded", flush=True)
        except Exception as e:
            print(f"SETUP:ERROR — XTTS loading failed: {e}", flush=True)
            return {"success": False, "error": str(e)}

        # Step 5: Test voice quality
        print("SETUP:Step 5/5 — Testing voice quality...", flush=True)
        quality = self.cloner.get_voice_quality()
        print(f"SETUP:Voice quality: {quality['quality']}% — {quality['message']}", flush=True)

        self.voice_ready = True

        result = {
            "success": True,
            "quality": quality,
            "blackhole": self.router.blackhole_device is not None,
            "samples": samples_info
        }

        print(f"SETUP_COMPLETE:{json.dumps(result, ensure_ascii=False)}", flush=True)
        return result

    def clone_voice_from_samples(self, folder):
        """Run the full voice cloning pipeline"""
        return self.setup_voice(folder)

    def is_voice_ready(self):
        """Check if voice system is ready"""
        model_exists = os.path.exists(os.path.join(MODELS_DIR, 'rvc', 'model.pth'))
        return {
            "ready": model_exists,
            "model_exists": model_exists,
            "blackhole": self.router.blackhole_device is not None,
            "quality": self.cloner.get_voice_quality() if model_exists else None
        }

    def test_voice(self, text="مرحباً، أنا APEX", language=None):
        """Test voice by generating and playing a sample"""
        if self.speaker is None:
            self.speaker = TTSSpeaker()
            self.speaker.load_model()
            self.speaker.set_speaker()

        if language is None:
            language = self.speaker.detect_language(text)

        print(f"TEST:Generating speech for: '{text}' ({language})", flush=True)

        # Generate TTS
        audio, sr = self.speaker.text_to_speech(text, language)

        if not isinstance(audio, np.ndarray) or len(audio) == 0:
            print("TEST:ERROR — TTS generated no audio", flush=True)
            return {"success": False, "error": "No audio generated"}

        # Apply voice cloning if model exists
        quality = self.cloner.get_voice_quality()
        if quality.get('ready', False):
            try:
                temp_path = os.path.join(DATA_DIR, 'test_tts.wav')
                sf.write(temp_path, audio, sr)

                converted_path = self.cloner.convert_voice(temp_path)
                audio, sr = sf.read(converted_path)

                print("TEST:Voice cloning applied", flush=True)

                # Cleanup
                for f in [temp_path, converted_path]:
                    if os.path.exists(f):
                        os.remove(f)
            except Exception as e:
                print(f"TEST:WARNING — Voice conversion failed, using TTS directly: {e}", flush=True)

        # Play audio
        import sounddevice as sd
        max_val = np.max(np.abs(audio))
        if max_val > 0:
            audio = audio / max_val * 0.9

        sd.play(audio, sr)
        sd.wait()

        # Also save a copy
        test_output = os.path.join(DATA_DIR, 'last_test_voice.wav')
        sf.write(test_output, audio, sr)

        print(f"TEST:Complete — saved to {test_output}", flush=True)
        return {
            "success": True,
            "duration": len(audio) / sr,
            "sample_rate": sr,
            "output": test_output,
            "voice_cloned": quality.get('ready', False)
        }

    def _validate_samples(self, samples_path):
        """Validate voice sample files"""
        if not os.path.exists(samples_path):
            return {"valid": False, "message": f"Folder not found: {samples_path}", "count": 0, "duration": 0}

        audio_extensions = {'.wav', '.mp3', '.flac', '.m4a', '.ogg'}
        audio_files = [
            os.path.join(samples_path, f)
            for f in os.listdir(samples_path)
            if os.path.splitext(f)[1].lower() in audio_extensions
        ]

        if not audio_files:
            return {"valid": False, "message": "No audio files found in folder", "count": 0, "duration": 0}

        total_duration = 0
        valid_files = 0

        for audio_file in audio_files:
            try:
                info = sf.info(audio_file)
                total_duration += info.duration
                valid_files += 1
            except Exception:
                try:
                    audio, sr = librosa.load(audio_file, sr=None, duration=None)
                    total_duration += len(audio) / sr
                    valid_files += 1
                except Exception:
                    continue

        if valid_files == 0:
            return {"valid": False, "message": "No valid audio files found", "count": 0, "duration": 0}

        if total_duration < 60:  # Less than 1 minute
            return {
                "valid": True,
                "message": f"WARNING: Only {total_duration:.0f}s of audio. Recommended: at least 10 minutes for good quality.",
                "count": valid_files,
                "duration": total_duration
            }

        return {
            "valid": True,
            "message": "Samples validated successfully",
            "count": valid_files,
            "duration": total_duration
        }


def main():
    if len(sys.argv) < 2:
        print("Usage: voice_engine.py [setup|test|status|clone] [args...]")
        sys.exit(1)

    engine = VoiceEngine()
    command = sys.argv[1]

    if command == 'setup':
        samples_path = sys.argv[2] if len(sys.argv) > 2 else None
        result = engine.setup_voice(samples_path)
        print(json.dumps(result, ensure_ascii=False, indent=2))

    elif command == 'test':
        text = sys.argv[2] if len(sys.argv) > 2 else "مرحباً، أنا APEX"
        language = sys.argv[3] if len(sys.argv) > 3 else None
        result = engine.test_voice(text, language)
        print(json.dumps(result, indent=2))

    elif command == 'status':
        result = engine.is_voice_ready()
        print(json.dumps(result, indent=2))

    elif command == 'clone':
        folder = sys.argv[2] if len(sys.argv) > 2 else None
        result = engine.clone_voice_from_samples(folder)
        print(json.dumps(result, ensure_ascii=False, indent=2))

    else:
        print(f"Unknown command: {command}")
        sys.exit(1)


if __name__ == "__main__":
    main()
