// Optional premium TTS. Keys come from <library>/.env and never leave this machine
// except in the request to the provider the user chose.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function loadEnv(library: string): Record<string, string> {
  const file = join(library, '.env');
  const env: Record<string, string> = {};
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  for (const k of ['OPENAI_API_KEY', 'ELEVENLABS_API_KEY']) if (!env[k] && process.env[k]) env[k] = process.env[k]!;
  return env;
}

export function providerStatus(library: string) {
  const env = loadEnv(library);
  return { browser: true, openai: !!env.OPENAI_API_KEY, elevenlabs: !!env.ELEVENLABS_API_KEY };
}

export async function synthesize(library: string, provider: string, text: string, voice?: string, _language?: string): Promise<Buffer> {
  const env = loadEnv(library);
  if (provider === 'openai') {
    if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing in .env');
    const r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts', voice: voice ?? 'alloy', input: text, response_format: 'mp3' }),
    });
    if (!r.ok) throw new Error(`OpenAI TTS ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return Buffer.from(await r.arrayBuffer());
  }
  if (provider === 'elevenlabs') {
    if (!env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY missing in .env');
    const v = voice ?? env.ELEVENLABS_VOICE_ID ?? '21m00Tcm4TlvDq8ikWAM';
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(v)}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ text, model_id: env.ELEVENLABS_MODEL ?? 'eleven_multilingual_v2' }),
    });
    if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return Buffer.from(await r.arrayBuffer());
  }
  throw new Error(`TTS provider "${provider}" is not handled by the server`);
}
