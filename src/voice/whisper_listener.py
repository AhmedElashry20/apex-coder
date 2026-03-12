#!/usr/bin/env python3
"""
elashry ai Whisper Listener — Real-time speech-to-text
Supports Arabic and English with automatic language detection
"""

import sys
import json
import queue
import threading
import numpy as np
import sounddevice as sd
from faster_whisper import WhisperModel

SAMPLE_RATE = 16000
CHUNK_DURATION = 5  # seconds per chunk
SILENCE_THRESHOLD = 0.01
MIN_SPEECH_DURATION = 0.5  # minimum seconds of speech to process

class WhisperListener:
    def __init__(self, model_size="medium", device="cpu", compute_type="int8"):
        self.model = WhisperModel(model_size, device=device, compute_type=compute_type)
        self.audio_queue = queue.Queue()
        self.is_listening = False
        self.stream = None
        self.callback = None
        self.speech_buffer = []
        self.silence_counter = 0
        self.max_silence_chunks = 3  # number of silent chunks before processing

    def start_listening(self, device_index=None):
        """Start capturing audio from microphone"""
        self.is_listening = True
        self.speech_buffer = []
        self.silence_counter = 0

        def audio_callback(indata, frames, time_info, status):
            if status:
                print(f"Audio status: {status}", file=sys.stderr)
            if self.is_listening:
                self.audio_queue.put(indata.copy())

        try:
            self.stream = sd.InputStream(
                samplerate=SAMPLE_RATE,
                channels=1,
                dtype='float32',
                blocksize=int(SAMPLE_RATE * CHUNK_DURATION),
                callback=audio_callback,
                device=device_index
            )
            self.stream.start()

            # Start processing thread
            self.process_thread = threading.Thread(target=self._process_audio_loop, daemon=True)
            self.process_thread.start()

            print("LISTENING_STARTED", flush=True)
        except Exception as e:
            print(f"ERROR: Failed to start listening: {e}", file=sys.stderr)
            self.is_listening = False
            raise

    def stop_listening(self):
        """Stop audio capture"""
        self.is_listening = False
        if self.stream:
            self.stream.stop()
            self.stream.close()
            self.stream = None

        # Process any remaining audio
        if self.speech_buffer:
            self._process_speech_buffer()

        print("LISTENING_STOPPED", flush=True)

    def _process_audio_loop(self):
        """Main audio processing loop"""
        while self.is_listening:
            try:
                audio_chunk = self.audio_queue.get(timeout=1.0)
                audio_flat = audio_chunk.flatten()
                rms = np.sqrt(np.mean(audio_flat ** 2))

                if rms > SILENCE_THRESHOLD:
                    self.speech_buffer.append(audio_flat)
                    self.silence_counter = 0
                else:
                    self.silence_counter += 1
                    if self.speech_buffer:
                        self.speech_buffer.append(audio_flat)

                    if self.silence_counter >= self.max_silence_chunks and self.speech_buffer:
                        self._process_speech_buffer()
                        self.speech_buffer = []
                        self.silence_counter = 0

            except queue.Empty:
                continue
            except Exception as e:
                print(f"ERROR: Processing error: {e}", file=sys.stderr)

    def _process_speech_buffer(self):
        """Process accumulated speech buffer"""
        if not self.speech_buffer:
            return

        audio = np.concatenate(self.speech_buffer)
        duration = len(audio) / SAMPLE_RATE

        if duration < MIN_SPEECH_DURATION:
            return

        text = self.transcribe_audio(audio)
        if text and text.strip():
            is_question = self.detect_question(text)
            result = {
                "type": "speech",
                "text": text.strip(),
                "is_question": is_question,
                "duration": round(duration, 2),
                "language": self._last_language
            }
            print(f"SPEECH:{json.dumps(result, ensure_ascii=False)}", flush=True)

            if self.callback:
                self.callback(result)

    def transcribe_audio(self, audio_data):
        """Transcribe audio data to text using Whisper"""
        try:
            # Ensure audio is float32 and normalized
            if audio_data.dtype != np.float32:
                audio_data = audio_data.astype(np.float32)

            if np.max(np.abs(audio_data)) > 1.0:
                audio_data = audio_data / np.max(np.abs(audio_data))

            segments, info = self.model.transcribe(
                audio_data,
                beam_size=5,
                language=None,  # auto-detect
                vad_filter=True,
                vad_parameters=dict(
                    min_silence_duration_ms=500,
                    speech_pad_ms=200
                )
            )

            self._last_language = info.language
            text = " ".join([segment.text for segment in segments])
            return text.strip()

        except Exception as e:
            print(f"ERROR: Transcription failed: {e}", file=sys.stderr)
            return ""

    def detect_question(self, text):
        """Detect if text is a question"""
        text_lower = text.lower().strip()

        # English question patterns
        en_question_words = ['what', 'where', 'when', 'why', 'how', 'who', 'which',
                            'is', 'are', 'was', 'were', 'do', 'does', 'did',
                            'can', 'could', 'would', 'should', 'will', 'shall',
                            'have', 'has', 'had']

        # Arabic question patterns
        ar_question_words = ['ما', 'ماذا', 'من', 'أين', 'متى', 'كيف', 'لماذا',
                            'هل', 'أي', 'كم', 'ايه', 'إيه', 'مين', 'فين',
                            'ازاي', 'إزاي', 'ليه', 'ليش', 'شو', 'وين']

        if text.endswith('?') or text.endswith('؟'):
            return True

        words = text_lower.split()
        if words and words[0] in en_question_words:
            return True

        for qw in ar_question_words:
            if qw in text:
                return True

        return False

    def on_speech_detected(self, callback):
        """Set callback for when speech is detected"""
        self.callback = callback

    def get_devices(self):
        """List available audio input devices"""
        devices = sd.query_devices()
        input_devices = []
        for i, dev in enumerate(devices):
            if dev['max_input_channels'] > 0:
                input_devices.append({
                    'index': i,
                    'name': dev['name'],
                    'channels': dev['max_input_channels'],
                    'sample_rate': dev['default_samplerate']
                })
        return input_devices


def main():
    """CLI entry point"""
    listener = WhisperListener()

    if len(sys.argv) > 1 and sys.argv[1] == 'devices':
        devices = listener.get_devices()
        print(json.dumps(devices, indent=2))
        return

    if len(sys.argv) > 1 and sys.argv[1] == 'transcribe':
        import soundfile as sf
        audio_file = sys.argv[2] if len(sys.argv) > 2 else None
        if audio_file:
            audio, sr = sf.read(audio_file)
            if sr != SAMPLE_RATE:
                import librosa
                audio = librosa.resample(audio, orig_sr=sr, target_sr=SAMPLE_RATE)
            if len(audio.shape) > 1:
                audio = audio.mean(axis=1)
            text = listener.transcribe_audio(audio.astype(np.float32))
            print(json.dumps({"text": text, "language": listener._last_language}, ensure_ascii=False))
        return

    # Default: start listening
    print("Starting elashry ai Whisper Listener...", flush=True)
    listener.start_listening()

    try:
        while True:
            import time
            time.sleep(0.1)
    except KeyboardInterrupt:
        listener.stop_listening()


if __name__ == "__main__":
    main()
