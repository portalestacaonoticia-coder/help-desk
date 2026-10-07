/**
 * Detecção de pedidos de cancelamento e ameaças no texto do cliente.
 *
 * Não cancela nada: só diz se a mensagem contém um dos termos de triagem
 * (cancelar, Procon, advogado, mentira…) para a tela de
 * cancelamentos reunir os contatos. Quem decide é o agente.
 *
 * TOLERÂNCIA A ERRO DE DIGITAÇÃO: cada termo é um radical ("cancel" cobre
 * cancelar, cancelamento, cancele, cancelei…). Uma palavra casa se a primeira
 * letra for igual e o começo dela estiver a no máximo 1 edição do radical
 * (letra trocada, faltando, sobrando ou invertida): "cansela", "canclar",
 * "procom", "adivogado", "mintira" entram. A primeira letra é exigida igual
 * de propósito: sem isso "sentir" casaria com "mentir".
 */

export type CancelTerm = {
  /** Radical normalizado (sem acento, minúsculo). */
  stem: string;
  /** Como aparece na tela. */
  label: string;
};

export const CANCEL_TERMS: readonly CancelTerm[] = [
  { stem: "cancel", label: "cancelar" },
  { stem: "procon", label: "Procon" },
  { stem: "advog", label: "advogado" },
  { stem: "mentir", label: "mentira" },
];

/**
 * Palavras inteiras que estão a 1 letra de um radical mas não têm nada a ver.
 * Só o que já apareceu em teste; a triagem é humana, então a lista é curta.
 */
const IGNORED_WORDS = new Set(["cancer", "mentor", "mentora", "mentores"]);

export type TermHit = {
  term: CancelTerm;
  /** A palavra exatamente como o cliente escreveu (normalizada). */
  word: string;
  /** Posição da palavra no texto normalizado, para montar o trecho. */
  index: number;
};

/** Minúsculo e sem acentos — "Cancelação" vira "cancelacao". */
export function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Remove o que o cliente NÃO escreveu: a citação do e-mail anterior.
 *
 * Nossas próprias respostas falam em "cancelamento" o tempo todo (como
 * cancelar, prazo de cancelamento…). Sem este corte, qualquer reply do
 * cliente — até um "obrigado" — carregaria a nossa resposta citada embaixo e
 * entraria na triagem.
 */
export function stripQuoted(text: string): string {
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];

  // Cabeçalhos de citação dos clientes de e-mail mais comuns. O do Gmail
  // ("Em sex., 3 de out. de 2026 às 10:00, Fulano <x@y> escreveu:") pode
  // quebrar em duas linhas, por isso o teste junta a linha com a seguinte.
  const header =
    /^(em .{0,200}escreveu:|on .{0,200}wrote:|el .{0,200}escribi[oó]:|-{2,}\s*(original message|mensagem original|mensaje original)\s*-{2,}|(de|from|from:|de:)\s*:?\s.*(@|<).*|enviad[oa] (em|de|por)\s*:|sent:|date:)/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const pair = `${line} ${lines[i + 1] ?? ""}`.trim();
    if (header.test(line.trim()) || header.test(pair)) break;
    if (line.trimStart().startsWith(">")) continue;
    kept.push(line);
  }
  return kept.join("\n");
}

/** Distância de Damerau-Levenshtein (edições, com transposição). */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

/** A palavra começa com o radical, admitindo 1 erro de digitação. */
export function wordMatchesStem(word: string, stem: string): boolean {
  if (word[0] !== stem[0]) return false;
  if (word.length < stem.length - 1) return false;
  if (word.startsWith(stem)) return true;
  // O erro pode ter mudado o tamanho do começo da palavra (letra a mais ou
  // a menos), então compara o radical com três tamanhos de prefixo.
  for (const len of [stem.length - 1, stem.length, stem.length + 1]) {
    if (len > word.length) continue;
    if (editDistance(word.slice(0, len), stem) <= 1) return true;
  }
  return false;
}

/**
 * Termos encontrados no texto do cliente (já sem a citação). Um acerto por
 * termo — o primeiro — basta para a triagem.
 */
export function findCancelTerms(text: string): TermHit[] {
  const clean = normalizeText(stripQuoted(text));
  const hits = new Map<string, TermHit>();
  const re = /[a-z]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    const word = m[0];
    if (word.length < 4 || IGNORED_WORDS.has(word)) continue;
    for (const term of CANCEL_TERMS) {
      if (hits.has(term.stem)) continue;
      if (wordMatchesStem(word, term.stem)) {
        hits.set(term.stem, { term, word, index: m.index });
      }
    }
    if (hits.size === CANCEL_TERMS.length) break;
  }
  return [...hits.values()];
}

/** Trecho do texto em volta do primeiro acerto, para a tela. */
export function excerptAround(text: string, hit: TermHit, radius = 90): string {
  // O índice vem do texto normalizado; sem acentos o tamanho não muda, então
  // vale também para o original limpo.
  const clean = stripQuoted(text).replace(/\s+/g, " ");
  const normalized = normalizeText(stripQuoted(text)).replace(/\s+/g, " ");
  const at = normalized.indexOf(hit.word, Math.max(0, hit.index - 40));
  const center = at >= 0 ? at : 0;
  const start = Math.max(0, center - radius);
  const end = Math.min(clean.length, center + hit.word.length + radius);
  return `${start > 0 ? "…" : ""}${clean.slice(start, end).trim()}${end < clean.length ? "…" : ""}`;
}
