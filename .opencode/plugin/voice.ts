import { type Plugin, tool } from "@opencode-ai/plugin"
import OpenAI from "openai"
import { spawn } from "child_process"
import { createWriteStream, unlinkSync, readFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

/**
 * Gets the first available non-monitor, non-bluetooth audio input source
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
          // Skip monitor sources and bluetooth
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
 * Records audio from the microphone using parecord (PulseAudio/PipeWire)
 * Falls back to arecord or sox if parecord is not available
 * Returns the path to the recorded audio file
 */
async function recordAudio(durationSeconds: number = 5): Promise<string> {
  const tempFile = join(tmpdir(), `opencode-voice-${Date.now()}.wav`)
  
  // Try to find a hardware input device (not bluetooth, not monitor)
  const inputDevice = await getDefaultInputDevice()
  
  return new Promise((resolve, reject) => {
    // Use parecord with timeout (works best with PulseAudio/PipeWire)
    const args = [
      (durationSeconds + 1).toString(),
      "parecord",
    ]
    
    // If we found a specific device, use it
    if (inputDevice) {
      args.push(`--device=${inputDevice}`)
    }
    
    args.push("--file-format=wav", tempFile)
    
    const recorder = spawn("timeout", args)

    let errorOutput = ""

    recorder.stderr.on("data", (data) => {
      errorOutput += data.toString()
    })

    recorder.on("error", (err) => {
      // If parecord is not available, try arecord (ALSA)
      const arecord = spawn("arecord", [
        "-q",
        "-f", "S16_LE",
        "-r", "16000",
        "-c", "1",
        "-d", durationSeconds.toString(),
        tempFile,
      ])

      arecord.on("error", () => {
        reject(new Error(
          "No audio recorder found. Please install pulseaudio-utils or alsa-utils:\n" +
          "  - Ubuntu/Debian: sudo apt install pulseaudio-utils\n" +
          "  - Fedora: sudo dnf install pulseaudio-utils\n" +
          "  - Arch: sudo pacman -S pulseaudio-utils"
        ))
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
async function transcribeAudio(audioFilePath: string): Promise<string> {
  const audioFile = readFileSync(audioFilePath)
  const file = new File([audioFile], "audio.wav", { type: "audio/wav" })

  const transcription = await openai.audio.transcriptions.create({
    file: file,
    model: "whisper-1",
    language: "en", // Optional: remove for auto-detection
  })

  return transcription.text
}

export const VoicePlugin: Plugin = async (ctx) => {
  console.log("[Voice Plugin] Initialized - Use the 'voice' tool to record and transcribe speech")

  return {
    tool: {
      voice: tool({
        description: 
          "Records audio from the user's microphone and transcribes it using OpenAI Whisper. " +
          "Use this tool when the user wants to provide input via voice or speech. " +
          "The tool will record for the specified duration (default 5 seconds) and return the transcribed text.",
        args: {
          duration: tool.schema.number().optional().describe(
            "Recording duration in seconds. Default is 5 seconds. Max recommended is 30 seconds."
          ),
        },
        async execute(args, toolCtx) {
          const duration = Math.min(args.duration || 5, 60) // Cap at 60 seconds
          
          let audioFile: string | null = null
          
          try {
            // Record audio
            console.log(`[Voice] Recording for ${duration} seconds... Speak now!`)
            audioFile = await recordAudio(duration)
            console.log("[Voice] Recording complete. Transcribing...")
            
            // Transcribe using Whisper
            const transcription = await transcribeAudio(audioFile)
            
            if (!transcription || transcription.trim() === "") {
              return "No speech detected. Please try again and speak clearly into your microphone."
            }
            
            return `Transcribed speech: "${transcription}"`
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            return `Voice recording/transcription failed: ${errorMessage}`
          } finally {
            // Clean up temp file
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
