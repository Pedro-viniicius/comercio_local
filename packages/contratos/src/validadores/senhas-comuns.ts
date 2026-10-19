// Lista local de senhas comuns (S22): recusadas no cadastro e na redefinição,
// para todas as contas (obrigatório para o admin). Sem consulta externa. A
// regra de forma e as listas à mão rodam igual no app, no painel e na API; a
// lista pública, só na API, que pode recusar uma senha que o cliente aceitou.
// Não é uma lista de vazamentos completa. Tem duas partes:
// - as listas escritas à mão abaixo, que vão em todo cliente: senhas
//   frequentes, palavras óbvias, nomes e sobrenomes comuns no Brasil, times e
//   torcidas, frases de fé e a cidade piloto;
// - a lista pública (`ListaDeSenhasComuns`: SecLists, nomes do IBGE e palavras
//   do OpenSubtitles), que é dado de terceiros e fica só na API, a autoridade
//   (`apps/api/src/modulos/identidade/http/senha-fora-da-lista-publica.ts`,
//   etapa 5b). Quem a tem passa em `ehSenhaComum(senha, lista)`.
// Sobre elas vale a regra de forma (S74): a palavra conhecida, o nome composto
// (`joaopedro123`) ou a palavra repetida (`senha@senha`) com dígitos e
// símbolos antes ou depois, os padrões de teclado e de sequência e a senha
// feita só de dígitos e símbolos (`10203040`).

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
  // Torcidas e ídolos do futebol (fora da lista pública).
  'flamenguista', 'corintiano', 'corinthiano', 'palmeirense', 'santista', 'saopaulino',
  'vascaino', 'gremista', 'colorado', 'cruzeirense', 'atleticano', 'botafoguense',
  'neymar', 'neymarjr', 'ronaldinho', 'ronaldo', 'pele', 'romario', 'kaka',
  // Fé, afeto e família.
  'jesus', 'jesuscristo', 'deus', 'deuseamor', 'deusefiel', 'amor', 'meuamor', 'teamo',
  'meama', 'teadoro', 'euteamo',
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
  'clara', 'eduarda', 'cecilia', 'lara', 'livia', 'yasmin', 'emanuel', 'murilo',
  'nicolas', 'otavio',
];

/**
 * Os 100 sobrenomes mais frequentes do Censo 2022 (Fonte: IBGE, "Nomes no
 * Brasil", ranking nacional de sobrenomes, consultado em 2026-10-17), sem
 * acento: `silva123` e `gabrielsilva` são recusadas.
 */
// prettier-ignore
const SOBRENOMES = [
  'silva', 'santos', 'oliveira', 'souza', 'pereira', 'ferreira', 'lima', 'alves',
  'rodrigues', 'costa', 'sousa', 'gomes', 'nascimento', 'araujo', 'ribeiro', 'almeida',
  'jesus', 'barbosa', 'soares', 'carvalho', 'martins', 'lopes', 'vieira', 'rocha',
  'dias', 'goncalves', 'fernandes', 'santana', 'andrade', 'batista', 'nunes', 'freitas',
  'conceicao', 'melo', 'moreira', 'cardoso', 'reis', 'cruz', 'ramos', 'mendes',
  'marques', 'machado', 'rosa', 'brito', 'moraes', 'junior', 'moura', 'teixeira',
  'barros', 'castro', 'borges', 'filho', 'maria', 'aparecida', 'campos', 'miranda',
  'bezerra', 'monteiro', 'pinheiro', 'paula', 'cunha', 'pinto', 'leite', 'neto',
  'matos', 'farias', 'neves', 'correia', 'duarte', 'viana', 'silveira', 'nogueira',
  'morais', 'medeiros', 'tavares', 'coelho', 'azevedo', 'fonseca', 'jose', 'garcia',
  'guimaraes', 'pires', 'correa', 'macedo', 'franca', 'amaral', 'xavier', 'assis',
  'mota', 'henrique', 'carmo', 'siqueira', 'menezes', 'queiroz', 'aguiar', 'sales',
  'braga', 'amorim', 'cavalcante', 'cordeiro',
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

/**
 * Lista pública de senhas comuns, já na forma comparável: `senhas` são senhas
 * inteiras (também valem como núcleo) e `nucleos`, palavras e nomes. Fica só
 * na API (etapa 5b); `ehSenhaComum` a soma às listas escritas à mão.
 */
export interface ListaDeSenhasComuns {
  readonly senhas: ReadonlySet<string>;
  readonly nucleos: ReadonlySet<string>;
}

const SENHAS_COMUNS: ReadonlySet<string> = new Set(SENHAS_LITERAIS);
const NUCLEOS_COMUNS: ReadonlySet<string> = new Set([
  ...PALAVRAS,
  ...NOMES,
  ...SOBRENOMES,
  ...SENHAS_LITERAIS,
]);

/** Um mesmo trecho de 1 a 4 caracteres repetido: `aaaaaaaa`, `12121212`, `abcabcabc`. */
const REPETICAO = /^(.{1,4})\1+$/u;

/** Letras que um trecho repetido de qualquer tamanho precisa ter (`senhasenha`). */
const LETRAS_DO_TRECHO_REPETIDO = 3;

/** Espaço, controle e caractere invisível (ZWSP, hífen mole, ZWJ, BOM...). */
const INVISIVEL = /[\s\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;

/**
 * `-`, `_` e `.` entre dois outros caracteres (`Bem-vindo1`, `joao.pedro`).
 * Nas pontas ficam, para a senha só de símbolos continuar sendo reconhecida.
 */
const SEPARADOR_INTERNO = /(?<=[^-_.])[-_.]+(?=[^-_.])/gu;

/**
 * Dígito ou símbolo: número, pontuação e símbolo matemático, de moeda ou
 * modificador. Fica de fora o "outro símbolo" (`\p{So}`), onde estão os
 * emojis: uma senha só de emojis distintos não é "só dígitos e símbolos".
 */
const DIGITO_OU_SIMBOLO = /^[\p{N}\p{P}\p{Sm}\p{Sc}\p{Sk}]+$/u;
/**
 * O que sai das pontas do núcleo e do lado do corte do núcleo composto: dígito,
 * pontuação e qualquer símbolo, inclusive emoji (`senha🔑123` tem núcleo
 * `senha`). Tudo sai das pontas do núcleo principal, sem limite (S83).
 */
const PONTA = /^[\p{N}\p{P}\p{S}]$/u;
const LETRA = /^\p{L}$/u;
/**
 * Quantos caracteres das pontas, no máximo, voltam ao núcleo para achar a
 * letra disfarçada (`s3nh4@2026` vira `s3nh4`).
 */
const MAXIMO_DE_VOLTA_NAS_PONTAS = 8;
/**
 * Núcleo mais curto que isso não é comparado com as listas nem com as
 * sequências (R34): `%354O3*1` tem núcleo `o`, que é trecho do alfabeto, e
 * não é uma senha comum. Vale também para cada metade do núcleo composto.
 */
const TAMANHO_MINIMO_DO_NUCLEO = 3;

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
  '€': 'e',
};

/**
 * Forma usada na comparação: compatibilidade (NFKC: largura total vira ASCII),
 * sem acentos, sem espaços nem caracteres invisíveis, em minúsculas e sem `-`,
 * `_` e `.` internos (`São Paulo 123`, `saopaulo123`, `sao\u200bpaulo123` e
 * `sao-paulo-123` são a mesma senha comum). Só para comparar: a senha não é
 * cortada nem normalizada aqui, e o `Hasher` (etapa 6) aplica NFKC no hash e
 * na verificação. `scripts/gerar-senhas-comuns.mjs` tem uma cópia desta
 * função: mudou aqui, mude lá e gere a lista de novo.
 */
export function formaComparavelDaSenha(senha: string): string {
  return senha
    .normalize('NFKC')
    .normalize('NFD')
    .replaceAll(/\p{M}/gu, '')
    .replaceAll(INVISIVEL, '')
    .toLowerCase()
    .replaceAll(SEPARADOR_INTERNO, '');
}

/**
 * A senha é feita só de dígitos e símbolos, na forma comparável (`10203040`,
 * `!@#$%^&*`). É recusada como comum, com motivo próprio (R34).
 */
export function ehSenhaSoDeDigitosESimbolos(senha: string): boolean {
  const forma = formaComparavelDaSenha(senha);
  return forma.length > 0 && DIGITO_OU_SIMBOLO.test(forma);
}

/** Nomes e sobrenomes à mão: no composto de três partes, duas têm de vir daqui (S83). */
const NOMES_E_SOBRENOMES: ReadonlySet<string> = new Set([...NOMES, ...SOBRENOMES]);

/** Tamanho, em pontos de código, da maior entrada de cada conjunto. */
function maiorEntrada(...conjuntos: readonly ReadonlySet<string>[]): number {
  let maior = 0;
  for (const conjunto of conjuntos) {
    for (const entrada of conjunto) maior = Math.max(maior, [...entrada].length);
  }
  return maior;
}

const MAIOR_ENTRADA_A_MAO = maiorEntrada(NUCLEOS_COMUNS);
/** A maior entrada de cada lista pública, calculada uma vez por objeto. */
const MAIOR_ENTRADA_DA_LISTA = new WeakMap<ListaDeSenhasComuns, number>();

function maiorEntradaDaLista(lista: ListaDeSenhasComuns): number {
  let maior = MAIOR_ENTRADA_DA_LISTA.get(lista);
  if (maior === undefined) {
    maior = maiorEntrada(lista.senhas, lista.nucleos);
    MAIOR_ENTRADA_DA_LISTA.set(lista, maior);
  }
  return maior;
}

function semDisfarce(texto: string): string {
  return [...texto].map((caractere) => LETRA_DISFARCADA[caractere] ?? caractere).join('');
}

/** Tamanho mínimo do trecho em que a letra disfarçada é desfeita (Q18). */
const TAMANHO_MINIMO_DO_DISFARCE = 4;

/**
 * O trecho pode ser uma palavra disfarçada (`s3nh4`, `j0a0`, `p@ssw0rd`): tem 4
 * caracteres ou mais e pelo menos metade de letras de verdade. Sem isso, trecho
 * curto ou quase só de dígitos vira palavra por acaso, como num hexadecimal:
 * `7ec` seria `tec`, `3d0` seria `edo` e `b04`, `boa` (Q18).
 */
function ehDisfarceVerossimil(caracteres: readonly string[]): boolean {
  const letras = caracteres.filter((caractere) => LETRA.test(caractere)).length;
  return caracteres.length >= TAMANHO_MINIMO_DO_DISFARCE && letras * 2 >= caracteres.length;
}

/**
 * A forma comparável de uma senha, pronta para a busca: os caracteres e, para
 * cada índice, o tamanho do trecho de `PONTA` que termina e que começa nele.
 * Montada uma vez por chamada, em O(n), para nenhuma regra andar de novo sobre
 * um trecho longo de símbolos (S85).
 */
interface FormaIndexada {
  readonly caracteres: readonly string[];
  readonly pontaAte: Int32Array;
  readonly pontaDesde: Int32Array;
}

function indexarForma(caracteres: readonly string[]): FormaIndexada {
  const tamanho = caracteres.length;
  const pontaAte = new Int32Array(tamanho);
  const pontaDesde = new Int32Array(tamanho);
  for (let i = 0; i < tamanho; i += 1) {
    if (PONTA.test(caracteres[i] ?? '')) pontaAte[i] = (i > 0 ? (pontaAte[i - 1] ?? 0) : 0) + 1;
  }
  for (let i = tamanho - 1; i >= 0; i -= 1) {
    if (pontaAte[i] !== 0) pontaDesde[i] = (i < tamanho - 1 ? (pontaDesde[i + 1] ?? 0) : 0) + 1;
  }
  return { caracteres, pontaAte, pontaDesde };
}

/** Tamanho do trecho de `PONTA` que termina em `fim - 1`, sem passar de `inicio`. */
function pontaQueTermina(forma: FormaIndexada, inicio: number, fim: number): number {
  return fim > inicio ? Math.min(forma.pontaAte[fim - 1] ?? 0, fim - inicio) : 0;
}

/** Tamanho do trecho de `PONTA` que começa em `inicio`, sem passar de `fim`. */
function pontaQueComeca(forma: FormaIndexada, inicio: number, fim: number): number {
  return inicio < fim ? Math.min(forma.pontaDesde[inicio] ?? 0, fim - inicio) : 0;
}

/**
 * Consulta às listas durante uma chamada de `ehSenhaComum`, por índices da
 * forma: recusa pelo tamanho antes de montar o texto (o trecho maior que a
 * maior entrada das listas nunca vira string) e guarda a resposta de cada
 * trecho, porque as variantes do núcleo repetem metades (S82, S85).
 */
class ConsultaAsListas {
  private readonly respostas = new Map<number, boolean>();
  private readonly lista: ListaDeSenhasComuns | undefined;
  private readonly forma: FormaIndexada;
  readonly maior: number;

  constructor(forma: FormaIndexada, lista: ListaDeSenhasComuns | undefined) {
    this.forma = forma;
    this.lista = lista;
    this.maior = Math.max(
      MAIOR_ENTRADA_A_MAO,
      lista === undefined ? 0 : maiorEntradaDaLista(lista),
    );
  }

  /** O trecho `[inicio, fim)` está nas listas, como está ou sem as letras disfarçadas. */
  conhece(inicio: number, fim: number): boolean {
    const tamanho = fim - inicio;
    if (tamanho < TAMANHO_MINIMO_DO_NUCLEO || tamanho > this.maior) return false;
    const chave = inicio * (this.forma.caracteres.length + 1) + fim;
    let resposta = this.respostas.get(chave);
    if (resposta === undefined) {
      const trecho = this.forma.caracteres.slice(inicio, fim);
      const texto = trecho.join('');
      resposta =
        this.estaNasListas(texto) ||
        (ehDisfarceVerossimil(trecho) && this.estaNasListas(semDisfarce(texto)));
      this.respostas.set(chave, resposta);
    }
    return resposta;
  }

  private estaNasListas(texto: string): boolean {
    return (
      NUCLEOS_COMUNS.has(texto) ||
      (this.lista !== undefined && (this.lista.nucleos.has(texto) || this.lista.senhas.has(texto)))
    );
  }
}

/**
 * O trecho `[inicio, fim)` é a junção de dois núcleos conhecidos, testando cada
 * ponto de corte (`joaopedro`, `gabrielsilva`, `senha@senha`, `jesusmeama`).
 * Cada metade vale sem os dígitos e símbolos do lado do corte (`senha@` vira
 * `senha`) ou inteira (`j0a0`, pela letra disfarçada). Só entram os cortes em
 * que a menor candidata de cada lado cabe na maior entrada das listas; cada
 * corte custa O(1) até a consulta (S85).
 */
function ehNucleoComposto(
  forma: FormaIndexada,
  inicio: number,
  fim: number,
  consulta: ConsultaAsListas,
): boolean {
  const minimo = TAMANHO_MINIMO_DO_NUCLEO;
  for (let corte = inicio + minimo; corte <= fim - minimo; corte += 1) {
    const fimDaEsquerda = corte - pontaQueTermina(forma, inicio, corte);
    // A esquerda limpa só cresce com o corte: passou da maior entrada, acabou.
    if (fimDaEsquerda - inicio > consulta.maior) break;
    const inicioDaDireita = corte + pontaQueComeca(forma, corte, fim);
    if (fim - inicioDaDireita > consulta.maior) continue;
    const esquerda =
      consulta.conhece(inicio, fimDaEsquerda) ||
      (fimDaEsquerda < corte && consulta.conhece(inicio, corte));
    if (!esquerda) continue;
    const direita =
      consulta.conhece(inicioDaDireita, fim) ||
      (inicioDaDireita > corte && consulta.conhece(corte, fim));
    if (direita) return true;
  }
  return false;
}

/** Está nos nomes e sobrenomes escritos à mão, como está ou sem o disfarce. */
function ehNomeOuSobrenome(forma: FormaIndexada, inicio: number, fim: number): boolean {
  const texto = forma.caracteres.slice(inicio, fim).join('');
  return NOMES_E_SOBRENOMES.has(texto) || NOMES_E_SOBRENOMES.has(semDisfarce(texto));
}

/**
 * O núcleo, sem dígito nem símbolo no meio, é a junção de três núcleos
 * conhecidos e pelo menos dois são nome ou sobrenome (S83): `joaopedrosilva`,
 * `anajuliasilva`. Três palavras quaisquer, ou separadas por símbolo
 * (`ana&pedro&lucas`), não contam.
 */
function ehNomeCompostoDeTres(
  forma: FormaIndexada,
  inicio: number,
  fim: number,
  consulta: ConsultaAsListas,
): boolean {
  if (fim - inicio > consulta.maior * 3) return false;
  for (let i = inicio; i < fim; i += 1) if ((forma.pontaAte[i] ?? 0) > 0) return false;
  const minimo = TAMANHO_MINIMO_DO_NUCLEO;
  for (let primeiro = inicio + minimo; primeiro <= fim - 2 * minimo; primeiro += 1) {
    if (!consulta.conhece(inicio, primeiro)) continue;
    for (let segundo = primeiro + minimo; segundo <= fim - minimo; segundo += 1) {
      if (!consulta.conhece(primeiro, segundo) || !consulta.conhece(segundo, fim)) continue;
      const nomes = [
        [inicio, primeiro],
        [primeiro, segundo],
        [segundo, fim],
      ].filter(([de = 0, ate = 0]) => ehNomeOuSobrenome(forma, de, ate)).length;
      if (nomes >= 2) return true;
    }
  }
  return false;
}

/**
 * Um trecho com 3 letras ou mais repetido, de qualquer tamanho e com dígitos
 * ou símbolos entre as repetições: `senhasenha`, `senha@senha`, `casa1casa2`.
 * O núcleo começa por letra (as pontas já saíram), então o separador nunca se
 * confunde com o começo do trecho.
 */
function ehPalavraRepetida(forma: FormaIndexada, inicio: number, fim: number): boolean {
  const { caracteres } = forma;
  let letras = 0;
  for (let tamanho = 1; inicio + tamanho * 2 <= fim; tamanho += 1) {
    if (LETRA.test(caracteres[inicio + tamanho - 1] ?? '')) letras += 1;
    if (letras < LETRAS_DO_TRECHO_REPETIDO) continue;
    let posicao = inicio + tamanho;
    let repeticoes = 1;
    while (posicao < fim) {
      posicao += pontaQueComeca(forma, posicao, fim);
      let i = 0;
      while (
        i < tamanho &&
        posicao + i < fim &&
        caracteres[posicao + i] === caracteres[inicio + i]
      ) {
        i += 1;
      }
      if (i < tamanho) break;
      posicao += tamanho;
      repeticoes += 1;
    }
    if (posicao === fim && repeticoes > 1) return true;
  }
  return false;
}

function ehRepeticaoOuSequencia(texto: string): boolean {
  return REPETICAO.test(texto) || SEQUENCIAS.some((sequencia) => sequencia.includes(texto));
}

/**
 * Forma comparável maior que isso (2 × 128, o máximo da senha) só sai de senha
 * cheia de caracteres que a NFKC expande (`⁗` vira `′′′′`, `⒇` vira `(20)`).
 * Nela ficam a busca direta e as regras de forma; o composto, os três nomes e
 * a palavra repetida não rodam (S85). Uma senha assim não está em dicionário.
 */
const TAMANHO_MAXIMO_DA_FORMA_COMPLETA = 256;

/**
 * A senha está nas listas, é só dígitos e símbolos, é repetição ou trecho de
 * sequência, ou é, cercada de dígitos e símbolos (S74): palavra óbvia, nome
 * próprio ou senha das listas; a junção de duas delas; três nomes e sobrenomes
 * juntos; ou uma palavra repetida. Sem `listaPublica`, valem só as listas
 * escritas à mão (painel e apps); a API passa a lista pública, somada às à mão
 * em todas as regras.
 *
 * O núcleo principal é a forma sem todos os dígitos e símbolos das pontas; com
 * menos de 3 caracteres, não há núcleo (R34: `%354O3*1`, núcleo `o`). As
 * variantes devolvem ao núcleo até 8 caracteres de cada ponta, para achar a
 * letra disfarçada (`s3nh4@2026`), a senha da lista cercada de dígitos e o
 * composto com senha da lista (`12qwaszxmaria`, R7). Tudo trabalha por índice
 * sobre a forma indexada: o pior caso é O(81 × n) consultas baratas (S85).
 */
export function ehSenhaComum(senha: string, listaPublica?: ListaDeSenhasComuns): boolean {
  const texto = formaComparavelDaSenha(senha);
  if (texto.length === 0 || DIGITO_OU_SIMBOLO.test(texto)) return true;
  if (SENHAS_COMUNS.has(texto) || listaPublica?.senhas.has(texto) === true) return true;
  if (ehRepeticaoOuSequencia(texto)) return true;
  const forma = indexarForma([...texto]);
  const tamanho = forma.caracteres.length;
  const comeco = pontaQueComeca(forma, 0, tamanho);
  const fim = pontaQueTermina(forma, 0, tamanho);
  const fimDoPrincipal = tamanho - fim;
  if (fimDoPrincipal - comeco < TAMANHO_MINIMO_DO_NUCLEO) return false;
  const completa = tamanho <= TAMANHO_MAXIMO_DA_FORMA_COMPLETA;
  const principal = forma.caracteres.slice(comeco, fimDoPrincipal).join('');
  if (ehRepeticaoOuSequencia(principal)) return true;
  if (completa && ehPalavraRepetida(forma, comeco, fimDoPrincipal)) return true;
  const consulta = new ConsultaAsListas(forma, listaPublica);
  for (let antes = 0; antes <= Math.min(comeco, MAXIMO_DE_VOLTA_NAS_PONTAS); antes += 1) {
    for (let depois = 0; depois <= Math.min(fim, MAXIMO_DE_VOLTA_NAS_PONTAS); depois += 1) {
      const inicio = comeco - antes;
      const final = fimDoPrincipal + depois;
      if (consulta.conhece(inicio, final)) return true;
      if (completa && ehNucleoComposto(forma, inicio, final, consulta)) return true;
    }
  }
  return completa && ehNomeCompostoDeTres(forma, comeco, fimDoPrincipal, consulta);
}
