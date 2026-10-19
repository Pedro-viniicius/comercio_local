// Contratos de conta (01b): campos de identidade reaproveitados pelas outras
// rotas, `POST /v1/contas`, verificação de e-mail e `GET /v1/conta`.
//
// Os campos usam os validadores puros de `../validadores`, os mesmos que o
// domínio da API usa. Só os checks levam mensagem própria: o tipo base fica
// sem `error`, para que o campo ausente continue com o código `obrigatorio`
// (`zod.ts`). Cada check que reprova encerra a validação do campo
// (`abort: true`), para o campo receber um erro só. Nenhum texto usa `.min`,
// `.max` ou `.length` do zod (ver `CAMPO_OBRIGATORIO`, Q14).
import { CAMPO_OBRIGATORIO, ehTextoPreenchido, objetoEstrito, z } from '../zod.ts';
import {
  MOTIVO_CELULAR_INVALIDO,
  MOTIVO_CODIGO_DO_AUTENTICADOR_INVALIDO,
  MOTIVO_CODIGO_INVALIDO,
  MOTIVO_EMAIL_INVALIDO,
  MOTIVO_NOME_COM_CARACTERE_INVALIDO,
  MOTIVO_NOME_LONGO,
  MOTIVO_SENHA_COM_CARACTERE_INVALIDO,
  MOTIVO_SENHA_COMUM,
  MOTIVO_SENHA_CURTA,
  MOTIVO_SENHA_LONGA,
  MOTIVO_SENHA_SO_DE_DIGITOS_E_SIMBOLOS,
  ehSenhaBemFormada,
  ehSenhaComum,
  ehSenhaSoDeDigitosESimbolos,
  normalizarCelular,
  normalizarCodigo,
  normalizarEmail,
  normalizarNome,
  problemaDoNome,
  tamanhoDaSenha,
  TAMANHO_MAXIMO_DA_SENHA,
  TAMANHO_MINIMO_DA_SENHA,
} from '../validadores/index.ts';

export const MOTIVO_VERSAO_INVALIDA = 'Versão do documento inválida';

const VERSAO = /^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$/;

/**
 * Nome como a pessoa quer ser chamada: NFC, sem espaço nas pontas, até 80
 * caracteres e sem caractere proibido (`normalizarNome`, `problemaDoNome`).
 */
export const nomeSchema = z
  .string()
  .overwrite(normalizarNome)
  .refine(ehTextoPreenchido, CAMPO_OBRIGATORIO)
  .refine((nome) => problemaDoNome(nome) !== 'longo', {
    error: MOTIVO_NOME_LONGO,
    abort: true,
  })
  .refine((nome) => problemaDoNome(nome) !== 'caractere_proibido', {
    error: MOTIVO_NOME_COM_CARACTERE_INVALIDO,
    abort: true,
  });

/** E-mail na forma normalizada (`normalizarEmail`): é o que a API recebe depois do parse. */
export const emailSchema = z
  .string()
  .trim()
  .refine(ehTextoPreenchido, CAMPO_OBRIGATORIO)
  .refine((email) => normalizarEmail(email) !== null, {
    error: MOTIVO_EMAIL_INVALIDO,
    abort: true,
  })
  .overwrite((email) => normalizarEmail(email) ?? email);

/** Celular com DDD; a saída é E.164 (`+5535999991234`, `contas.telefone_e164`). */
export const telefoneSchema = z
  .string()
  .trim()
  .refine(ehTextoPreenchido, CAMPO_OBRIGATORIO)
  .refine((telefone) => normalizarCelular(telefone) !== null, {
    error: MOTIVO_CELULAR_INVALIDO,
    abort: true,
  })
  .overwrite((telefone) => normalizarCelular(telefone) ?? telefone);

/**
 * Senha nova (cadastro e redefinição): 8 a 128 caracteres, texto Unicode bem
 * formado (S75) e fora da lista de senhas comuns (S22), que sai com o código
 * `comum` (a senha só de dígitos e símbolos sai com o mesmo código e motivo
 * próprio, R34). Não é cortada nem normalizada aqui: o tamanho é medido na senha
 * digitada, e o `Hasher` (etapa 6) aplica NFKC no hash e na verificação.
 */
export const senhaNovaSchema = z
  .string()
  .refine(ehTextoPreenchido, CAMPO_OBRIGATORIO)
  .refine((senha) => tamanhoDaSenha(senha) >= TAMANHO_MINIMO_DA_SENHA, {
    error: MOTIVO_SENHA_CURTA,
    abort: true,
  })
  .refine((senha) => tamanhoDaSenha(senha) <= TAMANHO_MAXIMO_DA_SENHA, {
    error: MOTIVO_SENHA_LONGA,
    abort: true,
  })
  .refine(ehSenhaBemFormada, { error: MOTIVO_SENHA_COM_CARACTERE_INVALIDO, abort: true })
  .refine((senha) => !ehSenhaSoDeDigitosESimbolos(senha), {
    error: MOTIVO_SENHA_SO_DE_DIGITOS_E_SIMBOLOS,
    params: { codigo: 'comum' },
    abort: true,
  })
  .refine((senha) => !ehSenhaComum(senha), {
    error: MOTIVO_SENHA_COMUM,
    params: { codigo: 'comum' },
  });

/**
 * Senha que confere com a guardada (login e exclusão de conta). Só exige que
 * exista, limita o tamanho e recusa texto mal formado (S75), que nenhuma senha
 * nova aceita; a regra de senha nova não se aplica, para não revelar nada sobre
 * a senha certa nem barrar uma conta antiga. Não é cortada nem normalizada
 * aqui: o `Hasher` (etapa 6) aplica NFKC na verificação.
 */
export const senhaAtualSchema = z
  .string()
  .refine(ehTextoPreenchido, CAMPO_OBRIGATORIO)
  .refine((senha) => tamanhoDaSenha(senha) <= TAMANHO_MAXIMO_DA_SENHA, {
    error: MOTIVO_SENHA_LONGA,
    abort: true,
  })
  .refine(ehSenhaBemFormada, { error: MOTIVO_SENHA_COM_CARACTERE_INVALIDO });

/**
 * Código de 6 dígitos de e-mail (verificação e recuperação de senha). O do app
 * autenticador é `codigoDoAutenticadorSchema`, com o motivo da tela do 2FA.
 */
export const codigoSchema = z
  .string()
  .trim()
  .refine(ehTextoPreenchido, CAMPO_OBRIGATORIO)
  .refine((codigo) => normalizarCodigo(codigo) !== null, {
    error: MOTIVO_CODIGO_INVALIDO,
    abort: true,
  })
  .overwrite((codigo) => normalizarCodigo(codigo) ?? codigo);

/** Código de 6 dígitos do app autenticador (TOTP), com o motivo da spec 01, P1a (R33). */
export const codigoDoAutenticadorSchema = z
  .string()
  .trim()
  .refine(ehTextoPreenchido, CAMPO_OBRIGATORIO)
  .refine((codigo) => normalizarCodigo(codigo) !== null, {
    error: MOTIVO_CODIGO_DO_AUTENTICADOR_INVALIDO,
    abort: true,
  })
  .overwrite((codigo) => normalizarCodigo(codigo) ?? codigo);

/** Versão de documento legal (`documentos_legais.versao`), como a tela a recebeu. */
export const versaoDeDocumentoSchema = z
  .string()
  .trim()
  .refine(ehTextoPreenchido, CAMPO_OBRIGATORIO)
  .regex(VERSAO, { error: MOTIVO_VERSAO_INVALIDA });

/**
 * Corpo de rota sem corpo (reenvio, exportação, logout...): ausente ou `{}`.
 * Qualquer campo gera 400 com código `desconhecido` (CA-13).
 */
export const corpoVazioSchema = objetoEstrito({}).optional();

/**
 * `POST /v1/contas` (público). `aceites` leva as versões de termos e política
 * que a pessoa leu; versão diferente da vigente é recusada pela API com 400
 * (S24). Resposta: 202 com `cadastroAceitoSchema`, igual exista ou não conta
 * com o e-mail (CA-02).
 */
export const criarContaSchema = objetoEstrito({
  nome: nomeSchema,
  email: emailSchema,
  telefone: telefoneSchema,
  senha: senhaNovaSchema,
  aceites: objetoEstrito({
    termos: versaoDeDocumentoSchema,
    privacidade: versaoDeDocumentoSchema,
  }),
});
export type CriarConta = z.infer<typeof criarContaSchema>;

/** Texto fixo da resposta do cadastro (CA-01, CA-02). */
export const MENSAGEM_DE_CADASTRO_ACEITO = 'Verifique seu e-mail para continuar.';

export const cadastroAceitoSchema = z.object({ mensagem: z.string() });
export type CadastroAceito = z.infer<typeof cadastroAceitoSchema>;

/**
 * `POST /v1/conta/verificacao-email` (com sessão, P1-dono): vale para a conta
 * da sessão. Resposta: 200 com a sessão renovada (`sessaoSchema`, com
 * `emailVerificado: true`). O reenvio (`.../reenvio`) usa `corpoVazioSchema`.
 */
export const verificarEmailSchema = objetoEstrito({ codigo: codigoSchema });
export type VerificarEmail = z.infer<typeof verificarEmailSchema>;

/**
 * `GET /v1/conta` e `GET /v1/admin/conta`. Resposta tolerante: `perfis` em
 * texto livre, para um app antigo não recusar um perfil novo (os conhecidos
 * estão em `PERFIS`, de `validadores/identidade.ts`).
 */
export const contaSchema = z.object({
  nome: z.string(),
  emailMascarado: z.string(),
  perfis: z.array(z.string()),
});
export type Conta = z.infer<typeof contaSchema>;
