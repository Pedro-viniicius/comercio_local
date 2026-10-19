// HMACs comuns aos casos de uso da Identidade (A-R4): a chave do freio por
// e-mail é uma só para login, redefinição e exclusão (S14), e o hash do token
// de renovação é o mesmo em todos os caminhos que abrem ou acham sessão.
import { describe, expect, it } from 'vitest';
import { CifradorFalso } from '../../../../../test/fakes/identidade/servicos-falsos.ts';
import { Email } from '../../dominio/email.ts';
import { chaveDoFreioPorEmail, hashDoTokenDeRenovacao } from './chaves.ts';

const cifrador = new CifradorFalso();

describe('chaveDoFreioPorEmail', () => {
  it('é o HMAC `bloqueio_email` do e-mail normalizado: a forma digitada não muda a chave', () => {
    expect(chaveDoFreioPorEmail(cifrador, Email.criar(' Ana@Exemplo.com '))).toBe(
      cifrador.hmac('bloqueio_email', ['ana@exemplo.com']),
    );
  });

  it('e-mails diferentes dão chaves diferentes, e a chave não contém o e-mail', () => {
    const ana = chaveDoFreioPorEmail(cifrador, Email.criar('ana@exemplo.com'));
    const bia = chaveDoFreioPorEmail(cifrador, Email.criar('bia@exemplo.com'));
    expect(ana).not.toBe(bia);
    expect(ana).not.toContain('ana');
  });
});

describe('hashDoTokenDeRenovacao', () => {
  it('é o HMAC `token_renovacao` com as partes `[token]`', () => {
    expect(hashDoTokenDeRenovacao(cifrador, 'token-1')).toBe(
      cifrador.hmac('token_renovacao', ['token-1']),
    );
    expect(hashDoTokenDeRenovacao(cifrador, 'token-1')).not.toBe(
      hashDoTokenDeRenovacao(cifrador, 'token-2'),
    );
  });
});
