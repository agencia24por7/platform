#!/usr/bin/env node
import { existsSync, statSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classificarTarefa, orientacaoDeModelo, nivelDeContexto, mensagemDeContexto } from './lib/politicas.mjs'

const ORDEM = { ok: 0, aviso: 1, critico: 2 }

function lerEntrada() {
  let bruto = ''
  process.stdin.setEncoding('utf8')
  return new Promise((resolver) => {
    process.stdin.on('data', (pedaco) => (bruto += pedaco))
    process.stdin.on('end', () => {
      try {
        resolver(JSON.parse(bruto))
      } catch {
        resolver({})
      }
    })
  })
}

function marcadorDaSessao(sessao) {
  const pasta = join(tmpdir(), 'platform-claude-contexto')
  mkdirSync(pasta, { recursive: true })
  return join(pasta, String(sessao ?? 'sem-sessao').replace(/[^\w-]/g, '_'))
}

function nivelJaAvisado(arquivo) {
  try {
    return readFileSync(arquivo, 'utf8').trim() || 'ok'
  } catch {
    return 'ok'
  }
}

function avisoDeContexto(evento) {
  const transcricao = evento.transcript_path
  if (!transcricao || !existsSync(transcricao)) return null
  const bytes = statSync(transcricao).size
  const nivel = nivelDeContexto(bytes, limitesDoAmbiente())
  const marcador = marcadorDaSessao(evento.session_id)
  if (ORDEM[nivel] <= ORDEM[nivelJaAvisado(marcador)]) return null
  writeFileSync(marcador, nivel)
  return mensagemDeContexto(nivel, bytes)
}

function limitesDoAmbiente() {
  return {
    aviso: Number(process.env.PLATFORM_CONTEXTO_AVISO_BYTES) || 700_000,
    critico: Number(process.env.PLATFORM_CONTEXTO_CRITICO_BYTES) || 1_200_000,
  }
}

const evento = await lerEntrada()
const partes = [orientacaoDeModelo(classificarTarefa(evento.prompt)), avisoDeContexto(evento)].filter(Boolean)
if (partes.length > 0) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: partes.join('\n') },
  }))
}
