#!/usr/bin/env python3
"""
APEX Audio Router — Route audio to BlackHole virtual microphone
Enables AI voice to appear as real microphone in Zoom/Teams/Meet
"""

import os
import sys
import json
import subprocess
import numpy as np
import sounddevice as sd
import soundfile as sf

SAMPLE_RATE = 48000  # Standard audio rate


class AudioRouter:
    def __init__(self):
        self.blackhole_device = None
        self.default_output = None
        self.is_routing = False
        self._find_devices()

    def _find_devices(self):
        """Find BlackHole and default audio devices"""
        devices = sd.query_devices()

        for i, dev in enumerate(devices):
            name = dev['name'].lower()

            # Find BlackHole output device
            if 'blackhole' in name and dev['max_output_channels'] > 0:
                self.blackhole_device = {
                    'index': i,
                    'name': dev['name'],
                    'channels': dev['max_output_channels'],
                    'sample_rate': dev['default_samplerate']
                }

            # Find default output
            if dev['max_output_channels'] > 0 and 'blackhole' not in name:
                if self.default_output is None or 'built-in' in name or 'macbook' in name:
                    self.default_output = {
                        'index': i,
                        'name': dev['name'],
                        'channels': dev['max_output_channels'],
                        'sample_rate': dev['default_samplerate']
                    }

    def get_audio_devices(self):
        """List all audio devices"""
        devices = sd.query_devices()
        result = {
            'input': [],
            'output': [],
            'blackhole': self.blackhole_device
        }

        for i, dev in enumerate(devices):
            device_info = {
                'index': i,
                'name': dev['name'],
                'channels_in': dev['max_input_channels'],
                'channels_out': dev['max_output_channels'],
                'sample_rate': dev['default_samplerate']
            }

            if dev['max_input_channels'] > 0:
                result['input'].append(device_info)
            if dev['max_output_channels'] > 0:
                result['output'].append(device_info)

        return result

    def route_to_virtual_mic(self):
        """Set up routing to BlackHole virtual microphone"""
        if not self.blackhole_device:
            raise RuntimeError(
                "BlackHole not found. Install it with: brew install blackhole-2ch"
            )

        self.is_routing = True
        print(f"ROUTING:Audio routing to {self.blackhole_device['name']} (index {self.blackhole_device['index']})", flush=True)
        return self.blackhole_device

    def play_to_blackhole(self, audio_data, sample_rate=None):
        """Play audio directly to BlackHole device"""
        if not self.blackhole_device:
            raise RuntimeError("BlackHole not found")

        sr = sample_rate or int(self.blackhole_device['sample_rate'])

        # Ensure audio is the right format
        if isinstance(audio_data, list):
            audio_data = np.array(audio_data, dtype=np.float32)
        elif isinstance(audio_data, np.ndarray):
            audio_data = audio_data.astype(np.float32)

        # Normalize
        max_val = np.max(np.abs(audio_data))
        if max_val > 0:
            audio_data = audio_data / max_val * 0.9

        # Ensure mono or match channels
        if len(audio_data.shape) == 1:
            channels = self.blackhole_device['channels']
            if channels > 1:
                audio_data = np.column_stack([audio_data] * channels)

        sd.play(audio_data, sr, device=self.blackhole_device['index'])
        sd.wait()

    def play_to_both(self, audio_data, sample_rate=None):
        """Play audio to both BlackHole and default speakers (for monitoring)"""
        if not self.blackhole_device:
            raise RuntimeError("BlackHole not found")

        sr = sample_rate or int(self.blackhole_device['sample_rate'])

        if isinstance(audio_data, np.ndarray):
            audio_data = audio_data.astype(np.float32)

        max_val = np.max(np.abs(audio_data))
        if max_val > 0:
            audio_data = audio_data / max_val * 0.9

        # Play to BlackHole
        sd.play(audio_data, sr, device=self.blackhole_device['index'])

        # Also play to speakers if available
        if self.default_output:
            try:
                sd.play(audio_data, sr, device=self.default_output['index'])
            except Exception:
                pass  # Don't fail if speaker playback fails

        sd.wait()

    def set_output_volume(self, level):
        """Set macOS system output volume (0-100)"""
        level = max(0, min(100, int(level)))
        try:
            subprocess.run(
                ['osascript', '-e', f'set volume output volume {level}'],
                check=True,
                capture_output=True
            )
            return True
        except subprocess.CalledProcessError:
            return False

    def get_output_volume(self):
        """Get current macOS output volume"""
        try:
            result = subprocess.run(
                ['osascript', '-e', 'output volume of (get volume settings)'],
                capture_output=True, text=True, check=True
            )
            return int(result.stdout.strip())
        except (subprocess.CalledProcessError, ValueError):
            return -1

    def test_routing(self):
        """Test audio routing with a sine wave tone"""
        if not self.blackhole_device:
            return {
                "success": False,
                "error": "BlackHole not found. Install with: brew install blackhole-2ch"
            }

        try:
            # Generate 1-second 440Hz sine wave
            duration = 1.0
            sr = int(self.blackhole_device['sample_rate'])
            t = np.linspace(0, duration, int(sr * duration), dtype=np.float32)
            tone = 0.3 * np.sin(2 * np.pi * 440 * t)

            # Play to BlackHole
            sd.play(tone, sr, device=self.blackhole_device['index'])
            sd.wait()

            return {
                "success": True,
                "device": self.blackhole_device['name'],
                "sample_rate": sr,
                "message": "Test tone sent to BlackHole successfully"
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }

    def create_multi_output_device(self):
        """
        Instructions to create a Multi-Output Device in macOS Audio MIDI Setup.
        This allows hearing the AI voice while it's being sent to BlackHole.
        """
        instructions = """
        To hear the AI voice while it's being sent to meetings:

        1. Open 'Audio MIDI Setup' (search in Spotlight)
        2. Click '+' at bottom-left → 'Create Multi-Output Device'
        3. Check both:
           - Built-in Output (your speakers/headphones)
           - BlackHole 2ch
        4. Set 'Built-in Output' as Master Device
        5. In System Preferences → Sound → Output:
           Select 'Multi-Output Device'

        Now audio will go to both your speakers AND the virtual mic.
        """
        return instructions.strip()

    def stop_routing(self):
        """Stop audio routing"""
        self.is_routing = False
        sd.stop()
        print("ROUTING:Audio routing stopped", flush=True)


def main():
    router = AudioRouter()

    if len(sys.argv) < 2:
        print("Usage: audio_router.py [devices|route|test|volume] [args...]")
        sys.exit(1)

    command = sys.argv[1]

    if command == 'devices':
        devices = router.get_audio_devices()
        print(json.dumps(devices, indent=2))

    elif command == 'route':
        device = router.route_to_virtual_mic()
        print(json.dumps(device, indent=2))

    elif command == 'test':
        result = router.test_routing()
        print(json.dumps(result, indent=2))

    elif command == 'volume':
        if len(sys.argv) > 2:
            level = int(sys.argv[2])
            router.set_output_volume(level)
            print(f"Volume set to {level}")
        else:
            vol = router.get_output_volume()
            print(f"Current volume: {vol}")

    elif command == 'setup':
        instructions = router.create_multi_output_device()
        print(instructions)

    else:
        print(f"Unknown command: {command}")
        sys.exit(1)


if __name__ == "__main__":
    main()
