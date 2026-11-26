import type { Plano, TesteEstruturado } from '../plano.ts';
import { aprovar, reprovar, type ContextoDoGate, type ResultadoDaChecagem } from './resultado.ts';

export const CHAVE_NAO_FAREMOS = 'nao_faremos';

type Uso = { readonly onde: string; readonly canal?: string; readonly plataforma?: string; readonly formato?: string; readonly segmento?: string };

function usosDoPlano(plano: Plano): Uso[] {
  const campanhas = plano.campanhas.campanhas.map((c) => ({
    onde: `campanhas/${c.id}`,
    canal: c.canal,
    plataforma: c.plataforma,
    formato: c.formato,
    segmento: c.segmento_id,
  }));
  const canais = plano.canais_e_plataformas.canais.map((c) => ({
    onde: `canais_e_plataformas/${c.id}`,
    canal: c.canal,
    plataforma: c.plataforma,
  }));
  return [...campanhas, ...canais];
}

function violaTeste(teste: TesteEstruturado, uso: Uso): boolean {
  switch (teste.tipo) {
    case 'canal_proibido':
      return uso.canal === teste.valor;
    case 'plataforma_proibida':
      return uso.plataforma === teste.valor;
    case 'formato_proibido':
      return uso.formato === teste.valor;
    case 'publico_proibido':
      return uso.segmento === teste.valor;
  }
}

export function checarNaoFaremos(contexto: ContextoDoGate): ResultadoDaChecagem {
  const usos = usosDoPlano(contexto.plano);
  const violacoes: string[] = [];
  const soTexto: string[] = [];
  for (const item of contexto.plano.estrategia.nao_faremos) {
    const regra = `estrategia/${item.id}`;
    if (item.teste === undefined) {
      soTexto.push(`${regra} (avaliar por modelo)`);
      continue;
    }
    for (const uso of usos) {
      if (violaTeste(item.teste, uso)) violacoes.push(`${uso.onde} viola ${regra}`);
    }
  }
  if (violacoes.length > 0) {
    return reprovar(CHAVE_NAO_FAREMOS, `${violacoes.length} violação(ões) de "não faremos".`, [...violacoes, ...soTexto]);
  }
  return aprovar(CHAVE_NAO_FAREMOS, 'Nenhum "não faremos" com teste estruturado foi violado.', soTexto);
}
