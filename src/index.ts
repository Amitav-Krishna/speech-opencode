import { type Plugin, tool } from "@opencode-ai/plugin"
import OpenAI from "openai"
import { spawn } from "child_process"
import { unlinkSync, readFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

/**
 * Records audio from the microphone with automatic silence detection.
 * Recording stops after the specified silence duration.
 * Uses sox on both Linux and macOS for silence detection.
 * 
 * @param maxDurationSeconds - Maximum recording time (safety timeout)
 * @param silenceDuration - Seconds of silence before stopping (default 7)
 */
async function recordAudio(
  maxDurationSeconds: number = 300,
  silenceDuration: number = 7
): Promise<string> {
  const tempFile = join(tmpdir(), `opencode-voice-${Date.now()}.wav`)
  
  // Use sox with silence detection on all platforms
  return recordWithSilenceDetection(tempFile, maxDurationSeconds, silenceDuration)
}

/**
 * Records audio using sox with silence detection.
 * Recording automatically stops after detecting silence.
 * 
 * Sox silence syntax: silence [above_periods] [duration] [threshold] [below_periods] [duration] [threshold]
 * - above_periods 1: need 1 period of audio above threshold to start
 * - 0.1 3%: audio must be above 3% for 0.1s to count as speech start
 * - below_periods 1: need 1 period below threshold to stop
 * - silenceDuration 3%: stop after silenceDuration seconds below 3%
 */
async function recordWithSilenceDetection(
  tempFile: string,
  maxDurationSeconds: number,
  silenceDuration: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Use timeout to enforce max duration, sox for silence detection
    const recorder = spawn("timeout", [
      maxDurationSeconds.toString(),
      "rec",
      "-q",
      "-r", "16000",
      "-c", "1",
      "-b", "16",
      tempFile,
      "silence",
      "1", "0.1", "3%",  // Start recording when speech detected (above 3% for 0.1s)
      "1", `${silenceDuration}.0`, "3%",  // Stop after silenceDuration seconds of silence (below 3%)
    ])

    let errorOutput = ""
    recorder.stderr.on("data", (data) => {
      errorOutput += data.toString()
    })

    recorder.on("error", () => {
      reject(
        new Error(
          "sox not found. Please install it:\n" +
          "  - macOS: brew install sox\n" +
          "  - Ubuntu/Debian: sudo apt install sox\n" +
          "  - Fedora: sudo dnf install sox\n" +
          "  - Arch: sudo pacman -S sox"
        )
      )
    })

    recorder.on("close", (code) => {
      // code 0 = normal exit, 124 = timeout killed it (max duration reached)
      if (code === 0 || code === 124) {
        resolve(tempFile)
      } else {
        reject(new Error(`Recording failed (code ${code}): ${errorOutput}`))
      }
    })
  })
}

/**
 * Transcribes audio using OpenAI's Whisper API
 */
async function transcribeAudio(
  audioFilePath: string,
  apiKey: string,
  language?: string
): Promise<string> {
  const openai = new OpenAI({ apiKey })
  const audioFile = readFileSync(audioFilePath)
  const file = new File([audioFile], "audio.wav", { type: "audio/wav" })

  const transcription = await openai.audio.transcriptions.create({
    file: file,
    model: "whisper-1",
    ...(language && { language }),
  })

  return transcription.text
}

export interface VoicePluginOptions {
  /** OpenAI API key. Defaults to OPENAI_API_KEY env var */
  apiKey?: string
  /** Language code for transcription (e.g., "en", "es", "fr"). Auto-detects if not specified */
  language?: string
  /** Seconds of silence before stopping recording (default 7) */
  silenceDuration?: number
  /** Maximum recording duration in seconds as a safety timeout (default 300 = 5 minutes) */
  maxDuration?: number
}

/**
 * OpenCode Voice Plugin
 *
 * Adds a 'voice' tool that records audio from the microphone and transcribes it
 * using OpenAI's Whisper API.
 *
 * @example
 * ```ts
 * // In opencode.json
 * {
 *   "plugin": ["opencode-voice"]
 * }
 * ```
 *
 * @example
 * ```ts
 * // With options in .opencode/plugin/voice.ts
 * import { VoicePlugin } from "opencode-voice"
 * export default VoicePlugin({ language: "en", defaultDuration: 10 })
 * ```
 */
export const VoicePlugin =
  (options: VoicePluginOptions = {}): Plugin =>
  async (ctx) => {
    const {
      apiKey = process.env.OPENAI_API_KEY,
      language,
      silenceDuration = 7,
      maxDuration = 300,
    } = options

    if (!apiKey) {
      console.warn(
        "[Voice Plugin] Warning: OPENAI_API_KEY not set. Voice transcription will fail."
      )
    }

    return {
      tool: {
        voice: tool({
          description:
            "Records audio from the user's microphone and transcribes it using OpenAI Whisper. " +
            "Use this tool when the user wants to provide input via voice or speech. " +
            "Recording automatically stops after detecting silence, so the user can speak naturally without specifying a duration.",
          args: {},
          async execute() {
            if (!apiKey) {
              return "Error: OPENAI_API_KEY environment variable is not set. Please set it to use voice transcription."
            }

            let audioFile: string | null = null

            try {
              audioFile = await recordAudio(maxDuration, silenceDuration)
              const transcription = await transcribeAudio(
                audioFile,
                apiKey,
                language
              )

              if (!transcription || transcription.trim() === "") {
                return "No speech detected. Please try again and speak clearly into your microphone."
              }

              return `Transcribed speech: "${transcription}"`
            } catch (error) {
              const errorMessage =
                error instanceof Error ? error.message : String(error)
              return `Voice recording/transcription failed: ${errorMessage}`
            } finally {
              if (audioFile) {
                try {
                  unlinkSync(audioFile)
                } catch {
                  // Ignore cleanup errors
                }
              }
            }
          },
        }),
      },
    }
  }

// Default export for simple usage
export default VoicePlugin()
