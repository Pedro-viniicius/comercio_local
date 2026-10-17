// Lista local de senhas comuns (S22): recusadas no cadastro e na redefinição,
// para todas as contas (obrigatório para o admin). Sem consulta externa: a
// lista vai junto do pacote e a verificação roda igual no app, no painel e na
// API. Não é uma lista de vazamentos completa. Tem as senhas de 8 ou mais
// caracteres mais usadas no Brasil e no mundo, os padrões de teclado e de
// sequência e uma regra de forma (S74): a palavra óbvia ou o nome próprio
// comum com dígitos e símbolos antes ou depois (`Senha@2026`, `123mudar`,
// `gabriel123`) e a senha feita só de dígitos e símbolos (`10203040`).
// Escrita à mão: nada baixado de lista pública (licença e cadeia de
// suprimentos não aprovadas).

/** Senhas frequentes que a regra de forma não pega sozinha. */
// prettier-ignore
const SENHAS_LITERAIS = [
  '12345678', '123456789', '1234567890', '12345678910', '0123456789', '87654321',
  '987654321', '9876543210', '11223344', '112233445566', '12341234', '12344321',
  '123321123', '123123123', '11112222', '147258369', '147852369', '741852963',
  '963852741', '159357456', '1478963250', '1234567a', '123456abc', 'abc12345',
  'abcd1234', 'a1b2c3d4', 'a1b2c3d4e5', '1q2w3e4r', '1q2w3e4r5t', '1q2w3e4r5t6y',
  'q1w2e3r4', 'q1w2e3r4t5', '1qaz2wsx', 'zaq12wsx', '12qwaszx', 'qwer1234',
  'qwerty12', 'qwerty123', 'qwertyui', 'asdf1234', 'asdfghjk', 'zxcvbnm1',
  'passw0rd', 'p@ssw0rd', 'p@ssword', 'pa$$word', 's3nh4123', 'sunshine',
  'princess', 'football', 'baseball', 'superman', 'whatever', 'trustno1',
  'letmein1', 'welcome1', 'starwars', 'computer', 'internet', 'michelle',
  'jennifer', 'corvette', 'mercedes', 'master123', 'dragon123', 'monkey123',
  'charlie1', 'liverpool', 'chelsea1', 'qazwsxedc', 'minhasenha', 'suasenha',
  'senhaforte', 'senhasegura', 'mudarsenha', 'trocarsenha', 'novasenha',
  'administrador', 'abcdefgh', 'abcdefghi', 'abcdefghij',
  // Comuns no Brasil (S74).
  '123mudar', 'mudar123', '10203040', '1020304050', '102030405060', '01020304',
  'aa123456', 'aa112233', 'abc123456', 'a123456789', 'a12345678', '12345678a',
  '123456789a', '1234567890a', '123456aa', '1234abcd', '1a2b3c4d', '1a2s3d4f',
  'qwe123456', 'qwe12345', 'asd123456', 'asd12345', 'zxc123456', '123qwe123',
  '123qweasd', 'qweasd123', 'qweasdzxc', '123456qwe', '1qazxsw2', 'zaq1xsw2',
  'q1w2e3r4t5y6', '159753456', '159753258', '789456123', '456123789', '321654987',
  '963258741', '25802580', '13579246', '24682468', '1234qwer', 'qwer4321',
  'senha1020', 'brasil10', 'mengao123', 'timao123', 'verdao123',
];

/** Palavras que, sozinhas ou cercadas de dígitos e símbolos, viram senha fraca. */
// prettier-ignore
const PALAVRAS = [
  // Genéricas e de sistema.
  'senha', 'password', 'admin', 'administrador', 'teste', 'mudar', 'trocar', 'acesso',
  'usuario', 'cadastro', 'qwerty', 'abc', 'iloveyou', 'bemvindo', 'entrar', 'login',
  'master', 'segredo', 'minhasenha', 'senhanova', 'novasenha', 'senhaforte',
  // O próprio produto e a cidade piloto (São Sebastião do Paraíso, MG).
  'bairrin', 'comercio', 'lojista', 'consumidor', 'paraiso', 'saosebastiao',
  'saosebastiaodoparaiso', 'minasgerais', 'mineiro', 'mineira',
  // Times de futebol e apelidos.
  'brasil', 'flamengo', 'corinthians', 'palmeiras', 'santos', 'saopaulo', 'vasco',
  'gremio', 'cruzeiro', 'atletico', 'galo', 'botafogo', 'fluminense', 'internacional',
  'bahia', 'vitoria', 'mengao', 'mengo', 'timao', 'verdao', 'peixe', 'tricolor',
  'futebol',
  // Fé, afeto e família.
  'jesus', 'jesuscristo', 'deus', 'deuseamor', 'deusefiel', 'amor', 'meuamor', 'teamo',
  'familia', 'felicidade', 'saudade', 'princesa', 'gatinha', 'gatinho', 'linda', 'lindo',
  'mae', 'pai', 'amorzinho', 'docinho', 'bebe', 'chocolate', 'morango', 'estrela',
  'cachorro', 'flor',
];

/**
 * Nomes próprios comuns no Brasil (registro civil das últimas décadas),
 * escritos sem acento: `Gabriel123` e `Ana@2026` são recusadas.
 */
// prettier-ignore
const NOMES = [
  'ana', 'maria', 'mariana', 'julia', 'juliana', 'beatriz', 'larissa', 'leticia',
  'amanda', 'bruna', 'camila', 'fernanda', 'gabriela', 'isabela', 'isabella', 'sophia',
  'sofia', 'alice', 'laura', 'valentina', 'helena', 'manuela', 'luiza', 'luisa',
  'giovanna', 'rafaela', 'patricia', 'aline', 'vanessa', 'jessica', 'natalia',
  'carolina', 'adriana', 'sandra', 'cristina', 'claudia', 'simone', 'renata',
  'priscila', 'tatiane', 'debora', 'raquel', 'daniela', 'luana', 'vitoria', 'heloisa',
  'jose', 'joao', 'pedro', 'lucas', 'mateus', 'matheus', 'gabriel', 'rafael',
  'gustavo', 'felipe', 'bruno', 'carlos', 'paulo', 'marcos', 'daniel', 'eduardo',
  'fernando', 'rodrigo', 'marcelo', 'leonardo', 'thiago', 'tiago', 'vinicius',
  'guilherme', 'diego', 'andre', 'ricardo', 'luiz', 'luis', 'antonio', 'francisco',
  'joaquim', 'miguel', 'arthur', 'heitor', 'davi', 'bernardo', 'samuel', 'enzo',
  'lorenzo', 'theo', 'vitor', 'victor', 'caio', 'henrique', 'sebastiao', 'benedito',
  'raimundo', 'manoel', 'manuel', 'alexandre', 'fabio', 'sergio', 'roberto',
];

/** Sequências e linhas do teclado: qualquer trecho delas é recusado. */
const SEQUENCIAS = [
  '01234567890',
  '09876543210',
  'abcdefghijklmnopqrstuvwxyz',
  'zyxwvutsrqponmlkjihgfedcba',
  'qwertyuiop',
  'poiuytrewq',
  'asdfghjkl',
  'lkjhgfdsa',
  'zxcvbnm',
  'mnbvcxz',
];

const SENHAS_COMUNS: ReadonlySet<string> = new Set(SENHAS_LITERAIS);
const NUCLEOS_COMUNS: ReadonlySet<string> = new Set([...PALAVRAS, ...NOMES, ...SENHAS_LITERAIS]);

/** Um mesmo trecho de 1 a 4 caracteres repetido: `aaaaaaaa`, `12121212`, `abcabcabc`. */
const REPETICAO = /^(.{1,4})\1+$/u;

/** Espaço, controle e caractere invisível (ZWSP, hífen mole, ZWJ, BOM...). */
const INVISIVEL = /[\s\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;

/**
 * Dígito ou símbolo: número, pontuação e símbolo matemático, de moeda ou
 * modificador. Fica de fora o "outro símbolo" (`\p{So}`), onde estão os
 * emojis: uma senha só de emojis distintos não é "só dígitos e símbolos".
 */
const DIGITO_OU_SIMBOLO = /^[\p{N}\p{P}\p{Sm}\p{Sc}\p{Sk}]+$/u;
/** Quantos dígitos e símbolos saem, no máximo, de cada ponta (S74). */
const MAXIMO_NAS_PONTAS = 8;

/** Troca de letra por dígito ou símbolo parecido: `passw0rd`, `s3nh4`, `p@ssword`. */
const LETRA_DISFARCADA: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
};

/**
 * Forma usada na comparação: compatibilidade (NFKC: largura total vira ASCII),
 * sem acentos, sem espaços nem caracteres invisíveis e em minúsculas (`São
 * Paulo 123`, `saopaulo123` e `sao\u200bpaulo123` são a mesma senha comum). Só
 * para comparar: a senha não é cortada nem normalizada aqui, e o `Hasher`
 * (etapa 6) aplica NFKC no hash e na verificação.
 */
export function formaComparavelDaSenha(senha: string): string {
  return senha
    .normalize('NFKC')
    .normalize('NFD')
    .replaceAll(/\p{M}/gu, '')
    .replaceAll(INVISIVEL, '')
    .toLowerCase();
}

/** Quantos dos primeiros `maximo` caracteres seguidos são dígitos ou símbolos. */
function digitosESimbolosNoComeco(caracteres: readonly string[], maximo: number): number {
  let quantidade = 0;
  while (quantidade < maximo && DIGITO_OU_SIMBOLO.test(caracteres[quantidade] ?? '')) {
    quantidade += 1;
  }
  return quantidade;
}

/**
 * Os núcleos da forma: ela sem 0 a 8 dígitos e símbolos de cada ponta. O
 * primeiro é o que sobra tirando tudo (`senha@2026` vira `senha`); os outros
 * tiram menos, para achar a letra disfarçada na ponta (`s3nh4@2026` vira
 * `s3nh4`). No máximo 81 núcleos.
 */
function nucleosDaForma(forma: string): string[] {
  const caracteres = [...forma];
  const comeco = digitosESimbolosNoComeco(caracteres, MAXIMO_NAS_PONTAS);
  const fim = digitosESimbolosNoComeco([...caracteres].reverse(), MAXIMO_NAS_PONTAS);
  const nucleos: string[] = [];
  for (let inicio = comeco; inicio >= 0; inicio -= 1) {
    for (let corte = fim; corte >= 0; corte -= 1) {
      if (inicio + corte < caracteres.length) {
        nucleos.push(caracteres.slice(inicio, caracteres.length - corte).join(''));
      }
    }
  }
  return nucleos;
}

function semDisfarce(texto: string): string {
  return [...texto].map((caractere) => LETRA_DISFARCADA[caractere] ?? caractere).join('');
}

function ehRepeticaoOuSequencia(texto: string): boolean {
  return REPETICAO.test(texto) || SEQUENCIAS.some((sequencia) => sequencia.includes(texto));
}

/**
 * A senha está na lista local, é só dígitos e símbolos, é repetição ou trecho
 * de sequência, ou é palavra óbvia, nome próprio comum ou senha da lista
 * cercada de dígitos e símbolos (S74).
 */
export function ehSenhaComum(senha: string): boolean {
  const forma = formaComparavelDaSenha(senha);
  if (forma.length === 0 || DIGITO_OU_SIMBOLO.test(forma)) return true;
  if (SENHAS_COMUNS.has(forma) || ehRepeticaoOuSequencia(forma)) return true;
  const nucleos = nucleosDaForma(forma);
  if (nucleos[0] !== undefined && ehRepeticaoOuSequencia(nucleos[0])) return true;
  return nucleos.some(
    (nucleo) => NUCLEOS_COMUNS.has(nucleo) || NUCLEOS_COMUNS.has(semDisfarce(nucleo)),
  );
}
