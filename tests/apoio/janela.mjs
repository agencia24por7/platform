const DIA_MS = 86_400_000;
const INICIO_BASE = Date.UTC(2026, 10, 1);

export const diaDaJanela = (deslocamento) => new Date(INICIO_BASE + deslocamento * DIA_MS).toISOString().slice(0, 10);

export const JANELA = { start: diaDaJanela(0), end: diaDaJanela(4) };

export const DIA_DENTRO_DA_JANELA = diaDaJanela(1);
