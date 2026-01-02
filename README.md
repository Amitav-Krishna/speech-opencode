# speech-opencode

Voice input plugin for [OpenCode](https://opencode.ai) using OpenAI Whisper.

Record audio from your microphone and transcribe it to text using OpenAI's Whisper API. **Recording automatically stops when you stop talking** - no need to specify a duration!

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

**sox** is required for audio recording with silence detection:

```bash
# macOS
brew install sox

# Ubuntu/Debian
sudo apt install sox

# Fedora
sudo dnf install sox

# Arch
sudo pacman -S sox
```

## Usage

Once installed, OpenCode will have access to a `voice` tool. Just ask OpenCode:

- "Listen to my voice"
- "Record what I say"
- "Use voice input"
- "voice"

**Recording automatically stops after 7 seconds of silence**, so just speak naturally and pause when you're done.

## Configuration

For advanced configuration, create a local plugin file:

**.opencode/plugin/voice.ts:**
```typescript
import { VoicePlugin } from "speech-opencode"

export default VoicePlugin({
  // Optional: specify language (auto-detects if not set)
  language: "en",
  
  // Optional: seconds of silence before stopping (default 7)
  silenceDuration: 7,
  
  // Optional: maximum recording time as safety timeout (default 300 = 5 min)
  maxDuration: 300,
  
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

1. Starts recording from your microphone when you begin speaking
2. Automatically stops after detecting 7 seconds of silence
3. Sends the audio to OpenAI's Whisper API for transcription
4. Returns the transcribed text to OpenCode

## Troubleshooting

### No audio detected
- Check that your microphone is not muted
- Verify the correct input device is selected in your system settings
- On Linux, use `pavucontrol` to check input sources

### Recording doesn't stop
- Make sure you pause speaking for at least 7 seconds
- Check that background noise isn't being detected as speech

### Recording fails
- Ensure sox is installed: `which rec`
- Check that your microphone permissions are granted

## License

MIT
