#!/usr/bin/env bun

import { Command } from '@commander-js/extra-typings';
import axios from 'axios';
import chalk from 'chalk';
import { readFileSync } from 'fs';

type GenerateResponseChunk = {
  response?: string;
  done?: boolean;
  model?: string;
  created_at?: string;
  total_duration?: number;
  eval_count?: number;
  eval_duration?: number;
  prompt_eval_duration?: number;
};

const program = new Command()
  .name('ollama-cli')
  .description('CLI mínima para enviar prompts a un servidor Ollama (localhost:11434 por defecto).')
  .argument('[prompt...]', 'Texto del prompt (si falta se lee de stdin).')
  .option('-m, --model <nombre>', 'Nombre del modelo Ollama', 'qwen2.5-coder:3b')
  .option('-s, --system <texto>', 'System prompt que acompaña al usuario')
  .option('-t, --temperature <n>', 'Temperatura (0-1)', parseFloat, 0.7)
  .option('--host <url>', 'URL base de Ollama', 'http://localhost:11434')
  .option('--no-stream', 'Desactiva streaming y espera la respuesta completa')
  .option('-f, --file <ruta>', 'Lee el prompt desde un archivo')
  .option('--json', 'Devuelve la respuesta en JSON en lugar de texto plano', false)
  .showHelpAfterError();

async function readPrompt(args: string[], filePath?: string): Promise<string> {
  if (filePath) {
    return readFileSync(filePath, 'utf8');
  }

  if (args.length > 0) {
    return args.join(' ');
  }

  // Si no hay argumentos, leer stdin completo (útil con pipes)
  const chunks: Buffer[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function callOllama() {
  const opts = program.parse(process.argv).opts();
  const prompt = await readPrompt(program.args, opts.file);

  if (!prompt) {
    console.error(chalk.red('No se proporcionó prompt (argumento, stdin o --file).'));
    process.exit(1);
  }

  const url = `${opts.host.replace(/\/$/, '')}/api/generate`;
  const payload = {
    model: opts.model,
    prompt,
    system: opts.system,
    stream: opts.stream,
    options: {
      temperature: Number.isFinite(opts.temperature) ? opts.temperature : 0.7,
    },
  };

  if (opts.stream) {
    const res = await axios.post(url, payload, { responseType: 'stream' });
    let buffer = '';
    res.data.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data: GenerateResponseChunk = JSON.parse(line);
          if (opts.json) {
            process.stdout.write(`${line}\n`);
          } else if (data.response) {
            process.stdout.write(data.response);
          }
        } catch {
          // Ignorar líneas malformadas; Ollama envía JSON por línea.
        }
      }
    });

    res.data.on('end', () => {
      if (buffer.trim()) {
        try {
          const data: GenerateResponseChunk = JSON.parse(buffer);
          if (opts.json) {
            process.stdout.write(`${buffer}\n`);
          } else if (data.response) {
            process.stdout.write(data.response);
          }
        } catch {
          /* noop */
        }
      }
      if (!opts.json) process.stdout.write('\n');
    });
  } else {
    const { data } = await axios.post(url, { ...payload, stream: false });
    if (opts.json) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(data.response ?? '');
    }
  }
}

callOllama().catch((err) => {
  const reason = err?.response?.data ?? err?.message ?? String(err);
  console.error(chalk.red(`Error al llamar a Ollama: ${reason}`));
  process.exit(1);
});
