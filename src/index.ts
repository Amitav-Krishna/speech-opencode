import { type Plugin, tool } from "@opencode-ai/plugin"
import OpenAI from "openai"
import { spawn } from "child_process"
import { unlinkSync, readFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

/**
 * Gets the first available non-monitor, non-bluetooth audio input source
 * Works with PulseAudio and PipeWire on Linux
 */
async function getDefaultInputDevice(): Promise<string | null> {
  return new Promise((resolve) => {
    const pactl = spawn("pactl", ["list", "sources", "short"])
    let output = ""

    pactl.stdout.on("data", (data) => {
      output += data.toString()
    })

    pactl.on("close", () => {
      const lines = output.trim().split("\n")
      for (const line of lines) {
        const parts = line.split("\t")
        if (parts.length >= 2) {
          const name = parts[1]
          // Skip monitor sources and bluetooth (prefer hardware input)
          if (!name.includes(".monitor") && !name.includes("bluez")) {
            resolve(name)
            return
          }
        }
      }
      resolve(null)
    })

    pactl.on("error", () => resolve(null))
  })
}

/**
 * Records audio from the microphone
 * - Linux: Uses parecord (PulseAudio/PipeWire) or arecord (ALSA)
 * - macOS: Uses sox (rec command)
 */
async function recordAudio(durationSeconds: number = 5): Promise<string> {
  const tempFile = join(tmpdir(), `opencode-voice-${Date.now()}.wav`)
  const platform = process.platform

  if (platform === "darwin") {
    // macOS: use sox
    return recordWithSox(tempFile, durationSeconds)
  } else {
    // Linux: use parecord or arecord
    return recordWithPulseAudio(tempFile, durationSeconds)
  }
}

async function recordWithSox(
  tempFile: string,
  durationSeconds: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const recorder = spawn("rec", [
      "-q",
      "-r",
      "16000",
      "-c",
      "1",
      "-b",
      "16",
      tempFile,
      "trim",
      "0",
      durationSeconds.toString(),
    ])

    let errorOutput = ""
    recorder.stderr.on("data", (data) => {
      errorOutput += data.toString()
    })

    recorder.on("error", () => {
      reject(
        new Error(
          "sox not found. Please install it:\n" + "  - macOS: brew install sox"
        )
      )
    })

    recorder.on("close", (code) => {
      if (code === 0) {
        resolve(tempFile)
      } else {
        reject(new Error(`Recording failed: ${errorOutput}`))
      }
    })
  })
}

async function recordWithPulseAudio(
  tempFile: string,
  durationSeconds: number
): Promise<string> {
  const inputDevice = await getDefaultInputDevice()

  return new Promise((resolve, reject) => {
    const args = [(durationSeconds + 1).toString(), "parecord"]

    if (inputDevice) {
      args.push(`--device=${inputDevice}`)
    }

    args.push("--file-format=wav", tempFile)

    const recorder = spawn("timeout", args)
    let errorOutput = ""

    recorder.stderr.on("data", (data) => {
      errorOutput += data.toString()
    })

    recorder.on("error", () => {
      // Fallback to arecord
      const arecord = spawn("arecord", [
        "-q",
        "-f",
        "S16_LE",
        "-r",
        "16000",
        "-c",
        "1",
        "-d",
        durationSeconds.toString(),
        tempFile,
      ])

      arecord.on("error", () => {
        reject(
          new Error(
            "No audio recorder found. Please install:\n" +
              "  - Ubuntu/Debian: sudo apt install pulseaudio-utils\n" +
              "  - Fedora: sudo dnf install pulseaudio-utils\n" +
              "  - Arch: sudo pacman -S pulseaudio-utils"
          )
        )
      })

      arecord.on("close", (code) => {
        if (code === 0) {
          resolve(tempFile)
        } else {
          reject(new Error(`arecord failed with code ${code}`))
        }
      })
    })

    recorder.on("close", (code) => {
      // timeout returns 124 when it kills the process, which is expected
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
  /** Default recording duration in seconds */
  defaultDuration?: number
  /** Maximum allowed recording duration in seconds */
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
      defaultDuration = 5,
      maxDuration = 60,
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
            `The tool will record for the specified duration (default ${defaultDuration} seconds) and return the transcribed text.`,
          args: {
            duration: tool.schema
              .number()
              .optional()
              .describe(
                `Recording duration in seconds. Default is ${defaultDuration} seconds. Max is ${maxDuration} seconds.`
              ),
          },
          async execute(args) {
            if (!apiKey) {
              return "Error: OPENAI_API_KEY environment variable is not set. Please set it to use voice transcription."
            }

            const duration = Math.min(args.duration || defaultDuration, maxDuration)
            let audioFile: string | null = null

            try {
              audioFile = await recordAudio(duration)
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
