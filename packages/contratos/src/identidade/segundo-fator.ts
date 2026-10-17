// Contratos do segundo fator do admin (01b, CA-09, S1). As três rotas são
// públicas e recebem o desafio emitido por `POST /v1/sessoes`; a API confere a
// etapa (`configurar` ou `verificar`) e as 5 tentativas.
import { CAMPO_OBRIGATORIO, ehTextoPreenchido, objetoEstrito, z } from '../zod.ts';
import {
  MOTIVO_CODIGO_DE_RECUPERACAO_INVALIDO,
  normalizarCodigoDeRecuperacao,
} from '../validadores/index.ts';
import { codigoDoAutenticadorSchema } from './contas.ts';
import { sessaoSchema, tokenSchema } from './sessoes.ts';

export const QUANTIDADE_DE_CODIGOS_DE_RECUPERACAO = 10;
export const MOTIVO_UM_CODIGO_SO =
  'Informe o código do app autenticador ou um código de recuperação';

/** Código de recuperação (10 caracteres base32); a saída vem em maiúsculas, sem hífen. */
export const codigoDeRecuperacaoSchema = z
  .string()
  .trim()
  .refine(ehTextoPreenchido, CAMPO_OBRIGATORIO)
  .refine((codigo) => normalizarCodigoDeRecuperacao(codigo) !== null, {
    error: MOTIVO_CODIGO_DE_RECUPERACAO_INVALIDO,
    abort: true,
  })
  .overwrite((codigo) => normalizarCodigoDeRecuperacao(codigo) ?? codigo);

/** `POST /v1/segundo-fator/configuracao`: só com desafio de etapa `configurar` (401 com outro). */
export const iniciarConfiguracaoSchema = objetoEstrito({ desafio: tokenSchema });
export type IniciarConfiguracao = z.infer<typeof iniciarConfiguracaoSchema>;

/** Resposta da configuração: a URI do QR code e a chave para digitar à mão. */
export const configuracaoDeSegundoFatorSchema = z.object({
  otpauthUri: z.string(),
  segredoBase32: z.string(),
});
export type ConfiguracaoDeSegundoFator = z.infer<typeof configuracaoDeSegundoFatorSchema>;

/** `POST /v1/segundo-fator/confirmacao`: desafio `configurar` e o primeiro código do app. */
export const confirmarConfiguracaoSchema = objetoEstrito({
  desafio: tokenSchema,
  codigo: codigoDoAutenticadorSchema,
});
export type ConfirmarConfiguracao = z.infer<typeof confirmarConfiguracaoSchema>;

/**
 * Resposta da confirmação: os códigos de recuperação (mostrados uma vez) e a
 * sessão. Leitura tolerante (R32): a API gera `QUANTIDADE_DE_CODIGOS_DE_RECUPERACAO`
 * códigos de `TAMANHO_DO_CODIGO_DE_RECUPERACAO` caracteres, mas o cliente não
 * recusa a resposta se esses números mudarem; a regra fica no produtor.
 */
export const segundoFatorConfirmadoSchema = z.object({
  codigosRecuperacao: z.array(z.string()),
  sessao: sessaoSchema,
});
export type SegundoFatorConfirmado = z.infer<typeof segundoFatorConfirmadoSchema>;

/**
 * `POST /v1/sessoes/segundo-fator`: desafio `verificar` e exatamente um dos
 * códigos (TOTP ou de recuperação). Resposta: 200 com `sessaoSchema` ou 401.
 */
export const verificarSegundoFatorSchema = objetoEstrito({
  desafio: tokenSchema,
  codigo: codigoDoAutenticadorSchema.optional(),
  codigoRecuperacao: codigoDeRecuperacaoSchema.optional(),
}).superRefine((corpo, contexto) => {
  const informados = [corpo.codigo, corpo.codigoRecuperacao].filter((c) => c !== undefined);
  if (informados.length === 1) return;
  contexto.addIssue({
    code: 'custom',
    path: ['codigo'],
    message: MOTIVO_UM_CODIGO_SO,
    params: { codigo: informados.length === 0 ? 'obrigatorio' : 'invalido' },
  });
});
export type VerificarSegundoFator = z.infer<typeof verificarSegundoFatorSchema>;
