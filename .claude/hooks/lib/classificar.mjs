#!/usr/bin/env node
import { classificarTarefa } from './politicas.mjs'

const { nivel, esforco } = classificarTarefa(process.argv.slice(2).join(' '))
process.stdout.write(`${nivel} ${esforco}\n`)
