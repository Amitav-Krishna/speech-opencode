# speech-opencode

Voice input plugin for [OpenCode](https://opencode.ai) using OpenAI Whisper.

Record audio from your microphone and transcribe it to text using OpenAI's Whisper API.

## Installation

Add the plugin to your `opencode.json`:

```json
{
  "plugin": ["speech-opencode"]
}
```

## Requirements

### API Key

Set your OpenAI API key as an environment variable:

```bash
export OPENAI_API_KEY=your-api-key
```

### Audio Recording Tools

**Linux (PulseAudio/PipeWire):**
```bash
# Ubuntu/Debian
sudo apt install pulseaudio-utils

# Fedora
sudo dnf install pulseaudio-utils

# Arch
sudo pacman -S pulseaudio-utils
```

**macOS:**
```bash
brew install sox
```

## Usage

Once installed, OpenCode will have access to a `voice` tool. You can ask OpenCode to use it:

- "Listen to my voice"
- "Record what I say"
- "Use voice input"
- "Transcribe my speech for 10 seconds"

The tool accepts an optional `duration` parameter (default: 5 seconds, max: 60 seconds).

## Configuration

For advanced configuration, create a local plugin file:

**.opencode/plugin/voice.ts:**
```typescript
import { VoicePlugin } from "speech-opencode"

export default VoicePlugin({
  // Optional: specify language (auto-detects if not set)
  language: "en",
  
  // Optional: default recording duration in seconds
  defaultDuration: 5,
  
  // Optional: maximum recording duration in seconds
  maxDuration: 60,
  
  // Optional: override API key (defaults to OPENAI_API_KEY env var)
  apiKey: process.env.MY_OPENAI_KEY,
})
```

## Supported Languages

Whisper supports many languages including:
- English (`en`)
- Spanish (`es`)
- French (`fr`)
- German (`de`)
- Japanese (`ja`)
- Chinese (`zh`)
- And many more...

Leave `language` unset for automatic detection.

## How It Works

1. Records audio from your default microphone using system tools
2. Sends the audio to OpenAI's Whisper API for transcription
3. Returns the transcribed text to OpenCode

## Troubleshooting

### No audio detected
- Check that your microphone is not muted
- Verify the correct input device is selected in your system settings
- On Linux, use `pavucontrol` to check input sources

### Recording fails
- Ensure you have the required audio tools installed
- Check that your microphone permissions are granted

## License

MIT
