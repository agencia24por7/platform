import type { OrganizationType } from '../../../organizations/domain/organization.ts';

const TEXTOS_DO_ANUNCIANTE: Readonly<Record<string, string>> = {
  'Notas internas da equipe': 'Notas internas',
  'Só a equipe vê. Nunca aparece no formulário enviado ao cliente.': 'Só você e quem trabalha com você veem. Nunca aparece no formulário enviado a quem você convidar.',
  'Quem é o cliente, o que faz e por que alguém compra dele.': 'Quem é o negócio, o que faz e por que alguém compra dele.',
  'Com quem o cliente disputa atenção e quem ele usa como referência.': 'Com quem o negócio disputa atenção e quem ele usa como referência.',
  'Aonde o cliente quer chegar, com quanto e quando.': 'Aonde o negócio quer chegar, com quanto e quando.',
  'Acessos já concedidos à agência': 'Acessos já concedidos a terceiros',
};

const CHAVES_DE_TEXTO = new Set(['rotulo', 'titulo', 'descricao', 'ajuda', 'exemplo', 'placeholder', 'rotuloDoItem']);

function traduzir(valor: unknown, tipo: OrganizationType): unknown {
  if (Array.isArray(valor)) return valor.map((item) => traduzir(item, tipo));
  if (valor === null || typeof valor !== 'object') return valor;
  return Object.fromEntries(
    Object.entries(valor).map(([chave, conteudo]) => [
      chave,
      typeof conteudo === 'string' && CHAVES_DE_TEXTO.has(chave) ? (TEXTOS_DO_ANUNCIANTE[conteudo] ?? conteudo) : traduzir(conteudo, tipo),
    ]),
  );
}

export function traduzirCatalogo<T>(catalogo: T, tipo: OrganizationType): T {
  return tipo === 'advertiser' ? (traduzir(catalogo, tipo) as T) : catalogo;
}
