// Apoio dos testes de borda do fluxo do painel (QA do grupo C, etapa 15): rotas, constantes e a
// montagem do `App` com o cliente real sobre a API falsa. Só testes importam este arquivo.
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import App from '../../App.tsx';
import { textos } from '../../textos/pt-BR.ts';
import {
  criarAutenticacaoDoPainel,
  type OpcoesDaAutenticacaoDoPainel,
} from '../../sessao/autenticacao-do-painel.ts';
import { BASE_URL, type ApiFalsa } from '../teste/api-falsa.ts';

export const t = textos.autenticacao;

export const RENOVAR = 'POST /v1/sessoes/renovacao';
export const SAIR = 'DELETE /v1/sessoes/renovacao';
export const ENTRAR = 'POST /v1/sessoes';
export const SEGUNDO_FATOR = 'POST /v1/sessoes/segundo-fator';
export const CONFIGURACAO = 'POST /v1/segundo-fator/configuracao';
export const CONFIRMACAO = 'POST /v1/segundo-fator/confirmacao';
export const CONTA_DO_ADMIN = 'GET /v1/admin/conta';
export const SAUDE = 'GET /v1/saude';
export const RECUPERACAO = 'POST /v1/senha/recuperacao';
export const REDEFINICAO = 'POST /v1/senha/redefinicao';

export const EMAIL = 'pedro@exemplo.com.br';
export const SENHA = 'senha-boa-123';
export const DESAFIO = 'desafio-id.segredo-do-desafio';
export const SEGREDO = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
export const URI = `otpauth://totp/Bairrin:p***%40exemplo.com.br?secret=${SEGREDO}&issuer=Bairrin`;
/** Dez códigos de 10 caracteres base32, todos diferentes. */
export const CODIGOS = [
  'ABCDEFGHJK',
  'LMNPQRSTUV',
  'WXYZ234567',
  'AAAABBBBCC',
  'CCDDEEFFGG',
  'HHJJKKLLMM',
  'NNPPQQRRSS',
  'TTUUVVWWXX',
  'YYZZ222233',
  'TRESQUATRO',
];
/** Como a tela mostra cada código: dois grupos de 5 com hífen. */
export const CODIGOS_NA_TELA = CODIGOS.map((c) => `${c.slice(0, 5)}-${c.slice(5)}`);

export function montarApp(
  api: ApiFalsa,
  extras: Partial<OpcoesDaAutenticacaoDoPainel> & {
    envolver?: ComponentType<{ children: ReactNode }>;
  } = {},
) {
  api.responder(SAUDE, { status: 200, corpo: { status: 'ok' } });
  const { envolver: Envolver, ...opcoes } = extras;
  const autenticacao = criarAutenticacaoDoPainel({
    baseUrl: BASE_URL,
    fetch: api.fetch,
    ...opcoes,
  });
  const elemento = <App autenticacao={autenticacao} />;
  const resultado = render(Envolver ? <Envolver>{elemento}</Envolver> : elemento);
  return { autenticacao, ...resultado };
}

export function preencher(rotulo: string, valor: string) {
  fireEvent.change(screen.getByLabelText(rotulo), { target: { value: valor } });
}

export function campo(rotulo: string): HTMLInputElement {
  return screen.getByLabelText<HTMLInputElement>(rotulo);
}

export async function irParaEntrar() {
  await screen.findByRole('heading', { level: 1, name: t.entrar.titulo });
}

export async function digitarCredenciais(email = EMAIL, senha = SENHA) {
  await irParaEntrar();
  preencher(t.entrar.email, email);
  preencher(t.entrar.senha, senha);
}

export async function entrarComSenha(email = EMAIL, senha = SENHA) {
  await digitarCredenciais(email, senha);
  fireEvent.click(screen.getByRole('button', { name: t.entrar.botao }));
}

export function textoDosBanners(): string {
  return [...document.querySelectorAll('.ui-banner')].map((b) => b.textContent ?? '').join(' | ');
}

export function anuncios(): string[] {
  return screen.getAllByRole('status').map((regiao) => regiao.textContent ?? '');
}

/** Tudo o que o navegador guarda: armazenamentos, cookie, nome da janela e estado do histórico. */
export function tudoQueFicaNoNavegador(): string {
  return JSON.stringify({
    local: { ...localStorage },
    sessao: { ...sessionStorage },
    cookie: document.cookie,
    nome: window.name,
    estado: window.history.state as unknown,
  });
}
