// Erro do nodemailer convertido sem a mensagem, e o enviador falso. O envio
// real contra o Mailpit está em test/integracao/email-smtp.int.test.ts.
import { describe, expect, it } from 'vitest';
import { FalhaNoEnvioDeEmail } from '../email/enviador-de-email.ts';
import { EnviadorDeEmailFalso } from '../email/enviador-falso.ts';
import { falhaDoNodemailer } from './smtp.adaptador.ts';

describe('falhaDoNodemailer', () => {
  it('guarda o código e a resposta SMTP, nunca a mensagem', () => {
    const erro = Object.assign(new Error('Recipient maria@exemplo.com.br rejected; user bairrin'), {
      code: 'EENVELOPE',
      responseCode: 550,
    });
    const falha = falhaDoNodemailer(erro);
    expect(falha).toBeInstanceOf(FalhaNoEnvioDeEmail);
    expect(falha).toMatchObject({ codigo: 'EENVELOPE', codigoSmtp: 550 });
    expect(falha.message).toBe('O envio de e-mail falhou (EENVELOPE/550).');
    expect(`${falha.message}${falha.stack ?? ''}`).not.toMatch(/maria|bairrin/);
  });

  it.each([
    ['sem código', new Error('x')],
    ['código com texto livre', Object.assign(new Error('x'), { code: 'conta maria' })],
    ['valor que não é erro', 'falhou'],
    ['nulo', null],
  ])('usa DESCONHECIDO para erro %s', (_caso, erro) => {
    expect(falhaDoNodemailer(erro)).toMatchObject({
      codigo: 'DESCONHECIDO',
      codigoSmtp: undefined,
    });
  });
});

describe('EnviadorDeEmailFalso', () => {
  it('guarda cópias das mensagens enviadas', async () => {
    const enviador = new EnviadorDeEmailFalso();
    await enviador.enviar({ para: 'a@exemplo.test', assunto: 'Oi', texto: 'Texto' });
    expect(enviador.enviadas).toEqual([{ para: 'a@exemplo.test', assunto: 'Oi', texto: 'Texto' }]);
    enviador.limpar();
    expect(enviador.enviadas).toEqual([]);
  });

  it('falha nas próximas chamadas pedidas e depois volta a enviar', async () => {
    const enviador = new EnviadorDeEmailFalso();
    enviador.falharNasProximas(1);
    const mensagem = { para: 'a@exemplo.test', assunto: 'Oi', texto: 'Texto' };
    await expect(enviador.enviar(mensagem)).rejects.toBeInstanceOf(FalhaNoEnvioDeEmail);
    await enviador.enviar(mensagem);
    expect(enviador.enviadas).toHaveLength(1);
  });
});
