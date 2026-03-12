#!/usr/bin/env python3
"""
elashry ai Meeting Mode — Attend meetings and respond with cloned voice
Listens to meeting audio, generates AI responses, speaks with user's voice
"""

import os
import sys
import json
import time
import threading
import signal
import requests
import numpy as np
import soundfile as sf
from datetime import datetime

# Add parent to path
sys.path.insert(0, os.path.dirname(__file__))

from whisper_listener import WhisperListener
from tts_speaker import TTSSpeaker
from rvc_cloner import RVCCloner
from audio_router import AudioRouter

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'data')
MODELS_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'models')

MEETING_SYSTEM_PROMPT = """أنت في وضع الاجتماع. أنت تمثّل المستخدم.
- ردودك مختصرة ومهنية (جمل قصيرة — مش مقالات)
- لو سؤال تقني: أجاوب بثقة ودقة
- لو سؤال عام: أجاوب بشكل طبيعي
- مفيش "أنا AI" أو أي إشارة لكونك AI
- الرد دايماً أقل من 3 جمل
- أسلوبك طبيعي ومهني
- لو مش متأكد، قول "هاتأكد وأرجعلك" بدل ما تألف"""


class MeetingMode:
    def __init__(self, ollama_url="http://localhost:11434", model="qwen2.5:14b",
                 data_dir=None, models_dir=None):
        self.ollama_url = ollama_url
        self.model = model
        self.data_dir = data_dir or DATA_DIR
        self.models_dir = models_dir or MODELS_DIR

        self.listener = None
        self.speaker = None
        self.cloner = None
        self.router = None

        self.is_running = False
        self.transcript = []
        self.meeting_start_time = None
        self.auto_respond = True

        # Conversation context for the meeting
        self.conversation_history = []

    def start(self):
        """Start meeting mode"""
        print("MEETING_INIT:Initializing meeting mode...", flush=True)

        # Initialize components
        try:
            print("MEETING_INIT:Loading Whisper listener...", flush=True)
            self.listener = WhisperListener(model_size="medium", device="cpu", compute_type="int8")

            print("MEETING_INIT:Loading TTS speaker...", flush=True)
            self.speaker = TTSSpeaker()
            self.speaker.load_model()
            self.speaker.set_speaker()

            print("MEETING_INIT:Loading voice cloner...", flush=True)
            self.cloner = RVCCloner(os.path.join(self.models_dir, 'rvc'))

            print("MEETING_INIT:Setting up audio routing...", flush=True)
            self.router = AudioRouter()

            # Check BlackHole
            if not self.router.blackhole_device:
                print("MEETING_WARNING:BlackHole not found! Audio won't be routed to meeting.", flush=True)
                print("MEETING_WARNING:Install with: brew install blackhole-2ch", flush=True)
            else:
                self.router.route_to_virtual_mic()
                print(f"MEETING_INIT:Audio routing to {self.router.blackhole_device['name']}", flush=True)

        except Exception as e:
            print(f"MEETING_ERROR:Failed to initialize: {e}", file=sys.stderr, flush=True)
            raise

        self.is_running = True
        self.meeting_start_time = datetime.now()
        self.transcript = []
        self.conversation_history = []

        # Set up speech callback
        self.listener.on_speech_detected(self._on_speech)

        # Start listening
        print("MEETING_STARTED", flush=True)
        self.listener.start_listening()

        # Start main processing loop
        self._process_loop()

    def _on_speech(self, speech_data):
        """Callback when speech is detected"""
        text = speech_data.get('text', '').strip()
        is_question = speech_data.get('is_question', False)
        language = speech_data.get('language', 'en')

        if not text:
            return

        # Add to transcript
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.transcript.append({
            'time': timestamp,
            'text': text,
            'is_question': is_question,
            'language': language,
            'type': 'heard'
        })

        print(f"MEETING_HEARD:{json.dumps({'time': timestamp, 'text': text, 'is_question': is_question}, ensure_ascii=False)}", flush=True)

        # Auto-respond to questions
        if is_question and self.auto_respond:
            threading.Thread(target=self._respond_to_question, args=(text, language), daemon=True).start()

    def _respond_to_question(self, question, language):
        """Generate and speak a response to a question"""
        try:
            print(f"MEETING_THINKING:Processing question...", flush=True)

            # Generate response using Ollama
            response_text = self._generate_response(question, language)

            if not response_text:
                print("MEETING_ERROR:Failed to generate response", flush=True)
                return

            print(f"MEETING_RESPONSE:{json.dumps({'text': response_text}, ensure_ascii=False)}", flush=True)

            # Add to transcript
            timestamp = datetime.now().strftime("%H:%M:%S")
            self.transcript.append({
                'time': timestamp,
                'text': response_text,
                'type': 'responded',
                'language': language
            })

            # Convert to speech
            audio, sr = self.speaker.text_to_speech(response_text, language)

            if isinstance(audio, np.ndarray) and len(audio) > 0:
                # Apply voice cloning if model exists
                voice_quality = self.cloner.get_voice_quality()
                if voice_quality.get('ready', False):
                    try:
                        # Save temp audio
                        temp_path = os.path.join(self.data_dir, 'temp_tts.wav')
                        sf.write(temp_path, audio, sr)

                        # Convert voice
                        converted_path = self.cloner.convert_voice(temp_path)
                        audio, sr = sf.read(converted_path)

                        # Cleanup
                        for f in [temp_path, converted_path]:
                            if os.path.exists(f):
                                os.remove(f)

                    except Exception as e:
                        print(f"MEETING_WARNING:Voice conversion failed, using TTS directly: {e}", flush=True)

                # Route audio to BlackHole (virtual mic)
                if self.router and self.router.blackhole_device:
                    self.router.play_to_blackhole(audio, sr)
                else:
                    # Fallback: play through speakers
                    import sounddevice as sd
                    sd.play(audio, sr)
                    sd.wait()

                print("MEETING_SPOKE:Response delivered", flush=True)

        except Exception as e:
            print(f"MEETING_ERROR:Response failed: {e}", file=sys.stderr, flush=True)

    def _generate_response(self, question, language):
        """Generate a response using Ollama"""
        # Build conversation messages
        messages = [
            {"role": "system", "content": MEETING_SYSTEM_PROMPT}
        ]

        # Add recent conversation context (last 10 exchanges)
        for entry in self.conversation_history[-10:]:
            messages.append(entry)

        messages.append({"role": "user", "content": question})

        try:
            response = requests.post(
                f"{self.ollama_url}/api/chat",
                json={
                    "model": self.model,
                    "messages": messages,
                    "stream": False,
                    "options": {
                        "temperature": 0.7,
                        "top_p": 0.9,
                        "num_predict": 150  # Keep responses short
                    }
                },
                timeout=30
            )

            if response.status_code == 200:
                data = response.json()
                response_text = data.get('message', {}).get('content', '')

                # Update conversation history
                self.conversation_history.append({"role": "user", "content": question})
                self.conversation_history.append({"role": "assistant", "content": response_text})

                return response_text.strip()
            else:
                print(f"MEETING_ERROR:Ollama returned status {response.status_code}", file=sys.stderr)
                return None

        except requests.exceptions.Timeout:
            print("MEETING_ERROR:Ollama request timed out", file=sys.stderr)
            return None
        except requests.exceptions.ConnectionError:
            print("MEETING_ERROR:Cannot connect to Ollama", file=sys.stderr)
            return None
        except Exception as e:
            print(f"MEETING_ERROR:Request failed: {e}", file=sys.stderr)
            return None

    def _process_loop(self):
        """Main processing loop — keeps meeting mode alive"""
        try:
            while self.is_running:
                # Check for STOP command from stdin
                if sys.stdin.readable():
                    import select
                    if select.select([sys.stdin], [], [], 0.5)[0]:
                        line = sys.stdin.readline().strip()
                        if line == 'STOP':
                            print("MEETING_STOPPING:Received stop command", flush=True)
                            self.stop()
                            return
                        elif line == 'TOGGLE_AUTO':
                            self.auto_respond = not self.auto_respond
                            state = "ON" if self.auto_respond else "OFF"
                            print(f"MEETING_AUTO_RESPOND:{state}", flush=True)
                    else:
                        time.sleep(0.5)
                else:
                    time.sleep(0.5)

        except KeyboardInterrupt:
            self.stop()

    def stop(self):
        """Stop meeting mode and generate summary"""
        print("MEETING_STOPPING:Ending meeting...", flush=True)
        self.is_running = False

        # Stop listening
        if self.listener:
            self.listener.stop_listening()

        # Stop audio routing
        if self.router:
            self.router.stop_routing()

        # Save transcript
        self._save_transcript()

        # Generate summary
        summary = self.generate_summary()

        print("MEETING_ENDED", flush=True)
        return summary

    def _save_transcript(self):
        """Save meeting transcript to file"""
        if not self.transcript:
            return

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        transcript_path = os.path.join(self.data_dir, f"meeting_transcript_{timestamp}.json")

        transcript_data = {
            'start_time': self.meeting_start_time.isoformat() if self.meeting_start_time else None,
            'end_time': datetime.now().isoformat(),
            'entries': self.transcript
        }

        with open(transcript_path, 'w', encoding='utf-8') as f:
            json.dump(transcript_data, f, ensure_ascii=False, indent=2)

        print(f"MEETING_SAVED:Transcript saved to {transcript_path}", flush=True)

    def generate_summary(self):
        """Generate meeting summary using AI"""
        if not self.transcript:
            return "No transcript available."

        # Build transcript text
        transcript_text = "\n".join([
            f"[{entry['time']}] {'Q: ' if entry.get('is_question') else ''}"
            f"{'(responded) ' if entry['type'] == 'responded' else ''}"
            f"{entry['text']}"
            for entry in self.transcript
        ])

        try:
            response = requests.post(
                f"{self.ollama_url}/api/chat",
                json={
                    "model": self.model,
                    "messages": [
                        {
                            "role": "system",
                            "content": "اكتب ملخص اجتماع مختصر بالعربي. اذكر: النقاط الرئيسية، القرارات، المهام المطلوبة."
                        },
                        {
                            "role": "user",
                            "content": f"ملخص الاجتماع:\n\n{transcript_text}"
                        }
                    ],
                    "stream": False,
                    "options": {
                        "temperature": 0.5,
                        "num_predict": 1000
                    }
                },
                timeout=60
            )

            if response.status_code == 200:
                summary = response.json().get('message', {}).get('content', 'Failed to generate summary')
            else:
                summary = f"Failed to generate summary (status {response.status_code})"

        except Exception as e:
            summary = f"Failed to generate summary: {e}"

        # Save summary
        summary_path = os.path.join(self.data_dir, 'last_meeting_summary.txt')
        with open(summary_path, 'w', encoding='utf-8') as f:
            f.write(f"Meeting Summary — {datetime.now().strftime('%Y-%m-%d %H:%M')}\n")
            f.write("=" * 50 + "\n\n")
            f.write(summary + "\n\n")
            f.write("=" * 50 + "\n")
            f.write(f"Full transcript: {len(self.transcript)} entries\n")

        print(f"MEETING_SUMMARY:{summary[:200]}", flush=True)
        return summary


def main():
    import argparse
    parser = argparse.ArgumentParser(description='elashry ai Meeting Mode')
    parser.add_argument('action', choices=['start', 'test'], default='start', nargs='?')
    parser.add_argument('--ollama-url', default='http://localhost:11434')
    parser.add_argument('--model', default='qwen2.5:14b')
    parser.add_argument('--data-dir', default=DATA_DIR)
    parser.add_argument('--models-dir', default=MODELS_DIR)

    args = parser.parse_args()

    meeting = MeetingMode(
        ollama_url=args.ollama_url,
        model=args.model,
        data_dir=args.data_dir,
        models_dir=args.models_dir
    )

    if args.action == 'start':
        # Handle SIGTERM/SIGINT gracefully
        def signal_handler(sig, frame):
            meeting.stop()
            sys.exit(0)

        signal.signal(signal.SIGTERM, signal_handler)
        signal.signal(signal.SIGINT, signal_handler)

        meeting.start()

    elif args.action == 'test':
        print("Testing meeting components...", flush=True)

        # Test Ollama connection
        try:
            r = requests.get(f"{args.ollama_url}/api/tags", timeout=5)
            print(f"  Ollama: OK ({r.status_code})", flush=True)
        except Exception as e:
            print(f"  Ollama: FAILED ({e})", flush=True)

        # Test audio devices
        router = AudioRouter()
        devices = router.get_audio_devices()
        print(f"  BlackHole: {'Found' if devices['blackhole'] else 'NOT FOUND'}", flush=True)
        print(f"  Input devices: {len(devices['input'])}", flush=True)
        print(f"  Output devices: {len(devices['output'])}", flush=True)

        # Test voice model
        cloner = RVCCloner(os.path.join(args.models_dir, 'rvc'))
        quality = cloner.get_voice_quality()
        print(f"  Voice model: {'Ready' if quality['ready'] else 'Not trained'}", flush=True)
        if quality['ready']:
            print(f"  Voice quality: {quality['quality']}%", flush=True)

        print("\nAll tests complete.", flush=True)


if __name__ == "__main__":
    main()
