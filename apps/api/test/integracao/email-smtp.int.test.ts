// Integração do adaptador SMTP com o Mailpit do `infra/docker-compose.yml`
// (SMTP em 127.0.0.1:1025, API em 127.0.0.1:8025). Sem rede externa. Cada
// teste usa um destinatário único e apaga só as mensagens dele (a caixa do
// Mailpit é a mesma do desenvolvimento).
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { Ambiente } from '../../src/compartilhado/config/ambiente.ts';
import { FalhaNoEnvioDeEmail } from '../../src/compartilhado/email/enviador-de-email.ts';
import { EnviadorDeEmailSmtp } from '../../src/compartilhado/infra/smtp.adaptador.ts';

const SMTP_TESTE = process.env['SMTP_URL_TESTE'] ?? 'smtp://127.0.0.1:1025';
const API_DO_MAILPIT = process.env['MAILPIT_API_TESTE'] ?? 'http://127.0.0.1:8025';
const REMETENTE = 'nao-responda@bairrin.com.br';

interface Endereco {
  Address: string;
}
interface MensagemDoMailpit {
  ID: string;
  From: Endereco;
  To: Endereco[];
  Subject: string;
  Text: string;
  HTML: string;
}

const abertos: EnviadorDeEmailSmtp[] = [];
const destinatarios: string[] = [];

afterEach(async () => {
  for (const enviador of abertos.splice(0)) enviador.onModuleDestroy();
  for (const destinatario of destinatarios.splice(0)) {
    await fetch(
      `${API_DO_MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${destinatario}"`)}`,
      {
        method: 'DELETE',
      },
    );
  }
});

function enviador(smtpUrl = SMTP_TESTE, nodeEnv: Ambiente['NODE_ENV'] = 'test') {
  const instancia = new EnviadorDeEmailSmtp({
    SMTP_URL: smtpUrl,
    EMAIL_REMETENTE: REMETENTE,
    NODE_ENV: nodeEnv,
  });
  abertos.push(instancia);
  return instancia;
}

function destinatarioUnico(): string {
  const endereco = `teste-${randomBytes(6).toString('hex')}@exemplo.test`;
  destinatarios.push(endereco);
  return endereco;
}

async function mensagensPara(destinatario: string): Promise<MensagemDoMailpit[]> {
  const busca = await fetch(
    `${API_DO_MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${destinatario}"`)}`,
  );
  expect(busca.ok).toBe(true);
  const { messages } = (await busca.json()) as { messages: { ID: string }[] };
  return Promise.all(
    messages.map(async ({ ID }) => {
      const resposta = await fetch(`${API_DO_MAILPIT}/api/v1/message/${ID}`);
      return (await resposta.json()) as MensagemDoMailpit;
    }),
  );
}

async function falhaDe(envio: Promise<void>): Promise<FalhaNoEnvioDeEmail> {
  const erro: unknown = await envio.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(erro).toBeInstanceOf(FalhaNoEnvioDeEmail);
  return erro as FalhaNoEnvioDeEmail;
}

describe('EnviadorDeEmailSmtp com o Mailpit', () => {
  it('entrega a mensagem com remetente, destinatário, assunto, texto e HTML', async () => {
    const para = destinatarioUnico();
    await enviador().enviar({
      para,
      assunto: 'Seu código do Bairrin',
      texto: 'Use o código enviado no app.',
      html: '<p>Use o código enviado no app.</p>',
    });
    const mensagens = await mensagensPara(para);
    expect(mensagens).toHaveLength(1);
    const [mensagem] = mensagens;
    expect(mensagem?.From.Address).toBe(REMETENTE);
    expect(mensagem?.To.map((to) => to.Address)).toEqual([para]);
    expect(mensagem?.Subject).toBe('Seu código do Bairrin');
    expect(mensagem?.Text.trim()).toBe('Use o código enviado no app.');
    expect(mensagem?.HTML).toContain('<p>Use o código enviado no app.</p>');
  });

  it('entrega só texto quando não há HTML', async () => {
    const para = destinatarioUnico();
    await enviador().enviar({ para, assunto: 'Aviso', texto: 'Só texto.' });
    const [mensagem] = await mensagensPara(para);
    expect(mensagem?.Text.trim()).toBe('Só texto.');
    expect(mensagem?.HTML ?? '').toBe('');
  });

  it('servidor fora do ar: rejeita só com o código, sem destinatário nem credencial', async () => {
    const para = destinatarioUnico();
    // Porta 1: nada escuta ali, a conexão é recusada na hora.
    const falha = await falhaDe(
      enviador('smtp://usuario-smtp:senha-que-nao-pode-vazar@127.0.0.1:1').enviar({
        para,
        assunto: 'Aviso',
        texto: 'Texto.',
      }),
    );
    expect(falha.codigo).toMatch(/^E[A-Z]+$/);
    const tudo = `${falha.message}${falha.stack ?? ''}${JSON.stringify(falha)}`;
    for (const proibido of ['senha-que-nao-pode-vazar', 'usuario-smtp', para]) {
      expect(tudo).not.toContain(proibido);
    }
  });

  it('em produção exige TLS: sem STARTTLS no servidor, não envia', async () => {
    const para = destinatarioUnico();
    const falha = await falhaDe(
      enviador(SMTP_TESTE, 'production').enviar({ para, assunto: 'Aviso', texto: 'Texto.' }),
    );
    expect(falha.codigo).toMatch(/^E[A-Z]+$/);
    expect(await mensagensPara(para)).toEqual([]);
  });
});
