/**
 * Utilidades de agrupamento de mensagens em threads.
 *
 * Estratégia de agrupamento (na ordem):
 *  1. In-Reply-To / References apontando para um Message-ID já conhecido.
 *  2. Assunto normalizado igual, na mesma caixa, com o mesmo cliente,
 *     dentro de uma janela de tempo recente.
 *  3. Caso contrário, nova thread.
 */

/** Remove prefixos Re:/Fwd:/Enc:/Res: repetidos e normaliza para comparação. */
export function normalizeSubject(subject: string | null | undefined): string {
  if (!subject) return "";
  let s = subject.trim();
  // Remove prefixos comuns (pt/en/es) repetidamente: "Re: Fwd: ..."
  const prefix = /^\s*(re|res|fwd|fw|enc|encaminhando|aw)\s*(\[\d+\])?\s*:\s*/i;
  while (prefix.test(s)) {
    s = s.replace(prefix, "");
  }
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Extrai o primeiro endereço de e-mail de uma string "Nome <a@b.com>". */
export function extractEmail(addr: string | null | undefined): string | null {
  if (!addr) return null;
  const match = addr.match(/<([^>]+)>/);
  const raw = (match ? match[1] : addr).trim().toLowerCase();
  return raw.includes("@") ? raw : null;
}

/**
 * Extrai os Message-IDs referenciados nos cabeçalhos In-Reply-To / References.
 * Retorna a lista de ids (com os <> preservados), do mais recente ao mais antigo.
 */
export function parseReferencedIds(
  inReplyTo: string | null | undefined,
  references: string | null | undefined,
): string[] {
  const ids = new Set<string>();
  const collect = (val: string | null | undefined) => {
    if (!val) return;
    const found = val.match(/<[^>]+>/g);
    if (found) found.forEach((id) => ids.add(id.trim()));
  };
  // In-Reply-To costuma ser o "pai" direto; priorizamos ele.
  collect(inReplyTo);
  collect(references);
  return [...ids];
}
