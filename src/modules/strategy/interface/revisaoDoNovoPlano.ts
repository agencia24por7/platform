import { dataBr } from './formatosDoPlano.ts';
import type { FormularioDeNovoPlano } from './formularioDeNovoPlano.ts';
import { listaSeparadaPorVirgula, type CamposBrutos } from './formulariosDaEstrategia.ts';
import { PASSOS_DO_NOVO_PLANO, type ChaveDoPasso } from './passosDoNovoPlano.ts';
import { resumoDaVerba } from './verbaDoPlano.ts';

export type ItemDaRevisao = { readonly rotulo: string; readonly valor: string; readonly vazio: boolean; readonly nota: string | null };

export type GrupoDaRevisao = {
  readonly chave: ChaveDoPasso;
  readonly titulo: string;
  readonly passo: number;
  readonly itens: readonly ItemDaRevisao[];
};

export type RevisaoDoNovoPlano = {
  readonly grupos: readonly GrupoDaRevisao[];
  readonly pendencias: number;
  readonly bloqueio: { readonly texto: string; readonly passo: number } | null;
};

const NAO_INFORMADO = 'Não informado';
const NOTA_DA_VERBA_MENSAL = 'Convertido do valor mensal: valor por mês × dias do horizonte ÷ 30.';
const BLOQUEIO_DO_CLIENTE = 'O cadastro do cliente está incompleto (WhatsApp ou landing page). Complete no Contexto para poder pedir o plano.';

function item(rotulo: string, valor: string, nota: string | null = null): ItemDaRevisao {
  const texto = valor.trim();
  return { rotulo, valor: texto === '' ? NAO_INFORMADO : texto, vazio: texto === '', nota };
}

function rotulosEscolhidos(opcoes: readonly { readonly valor: string; readonly rotulo: string }[], valores: readonly string[]): string {
  return opcoes.filter((opcao) => valores.includes(opcao.valor)).map((opcao) => opcao.rotulo).join(', ');
}

function itensDaVerba(campos: CamposBrutos): readonly ItemDaRevisao[] {
  const resumo = resumoDaVerba(campos);
  if (!resumo.ok) return [{ rotulo: 'Verba', valor: resumo.error, vazio: true, nota: null }];
  const { total, porMes, dias, convertida } = resumo.value;
  return [item('Total do horizonte', `${total} em ${dias} ${dias === 1 ? 'dia' : 'dias'}`, convertida ? NOTA_DA_VERBA_MENSAL : null), item('Equivalente por mês', porMes)];
}

function periodoDe(campos: CamposBrutos): string {
  const inicio = (campos['inicio'] ?? '').trim();
  const fim = (campos['fim'] ?? '').trim();
  return inicio !== '' && fim !== '' ? `${dataBr(inicio)} a ${dataBr(fim)}` : '';
}

export function revisaoDoNovoPlano(modelo: FormularioDeNovoPlano, campos: CamposBrutos): RevisaoDoNovoPlano {
  const marca = (campos['focoMarca'] ?? '') === '1';
  const produtos = marca ? [] : listaSeparadaPorVirgula(campos['produtos']);
  const foco = marca ? modelo.foco.marca.rotulo : rotulosEscolhidos(modelo.foco.produtos, produtos);
  const conteudos: Readonly<Record<ChaveDoPasso, readonly ItemDaRevisao[]>> = {
    tipo: [item('Tipo de plano', rotulosEscolhidos(modelo.tipos, [campos['tipoDePlano'] ?? ''])), item('Plataformas', rotulosEscolhidos(modelo.plataformas, listaSeparadaPorVirgula(campos['plataformas'])))],
    destino: [
      item('Foco do plano', foco),
      item('Landing page', rotulosEscolhidos(modelo.landingPages, [campos['landingPageId'] ?? ''])),
      modelo.whatsapp.ausente ? item('WhatsApp do cliente', '') : item('WhatsApp do cliente', modelo.whatsapp.texto),
    ],
    horizonte: [item('Objetivo', campos['objetivo'] ?? ''), item('Horizonte', periodoDe(campos)), item('Ousadia', rotulosEscolhidos(modelo.ousadias, [campos['ousadia'] ?? '']))],
    verba: [...itensDaVerba(campos), item('Retorno esperado', campos['retorno'] ?? '')],
    revisao: [],
  };
  const grupos = PASSOS_DO_NOVO_PLANO.flatMap((passo, indice) => (passo.chave === 'revisao' ? [] : [{ chave: passo.chave, titulo: passo.titulo, passo: indice, itens: conteudos[passo.chave] }]));
  const passoDoDestino = PASSOS_DO_NOVO_PLANO.findIndex((passo) => passo.chave === 'destino');
  return {
    grupos,
    pendencias: grupos.reduce((total, grupo) => total + grupo.itens.filter((entrada) => entrada.vazio).length, 0),
    bloqueio: modelo.podeCriar ? null : { texto: BLOQUEIO_DO_CLIENTE, passo: passoDoDestino },
  };
}
