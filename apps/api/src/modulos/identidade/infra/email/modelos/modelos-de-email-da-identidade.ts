// Adaptador de `ModelosDeEmailDaIdentidade` (plano 01b, etapa 13): o conteúdo
// de cada e-mail da Identidade, em português, montado por `montarEmail` (texto
// puro e HTML com escape, S73). Só o necessário para o destinatário (S10): nada
// de dado de terceiros, de anexo nem de link com segredo; o código só aparece
// no e-mail que o leva. O nome só aparece na saudação, e só quando a
// aplicação o manda (e-mail verificado, S102); sem ele, "Olá!".
import { Injectable } from '@nestjs/common';
import {
  type ConteudoDoEmail,
  type DadosDoCodigo,
  ModelosDeEmailDaIdentidade,
  type NomeNaSaudacao,
} from '../../../aplicacao/assinantes/modelos-de-email.ts';
import { type Bloco, montarEmail } from './documento.ts';

const FUSO = 'America/Sao_Paulo';
/** Data no fuso de Brasília, como a pessoa a lê (`28/10/2026`). */
const DATA = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: FUSO,
});
/** Hora no fuso de Brasília, em 24 h (`14:30`). */
const HORA = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: FUSO,
});

/** `28/10/2026 às 14:30`, no fuso de Brasília (Q28: o prazo tem hora, não só dia). */
function dataEHora(quando: Date): string {
  return `${DATA.format(quando)} às ${HORA.format(quando)}`;
}

/** "Olá, <nome>." com o nome, ou "Olá!" sem ele (S102). */
function saudacao(nome: NomeNaSaudacao): Bloco {
  return nome === null ? ['Olá!'] : ['Olá, ', nome, '.'];
}

export const ASSUNTOS = {
  codigoDeVerificacao: 'Seu código de verificação do Bairrin',
  cadastroRepetido: 'Tentativa de cadastro com o seu e-mail no Bairrin',
  codigoDeRecuperacao: 'Seu código para definir uma senha nova no Bairrin',
  exportacaoPronta: 'Sua cópia dos dados do Bairrin está pronta',
  segundoFatorFreado: 'Tentativas erradas no acesso ao painel do Bairrin',
  senhaRemovida: 'Sua senha do Bairrin foi apagada por segurança',
} as const;

@Injectable()
export class ModelosDeEmailDaIdentidadeEmHtml extends ModelosDeEmailDaIdentidade {
  override codigoDeVerificacao({ codigo }: { readonly codigo: string }): ConteudoDoEmail {
    return montarEmail({
      assunto: ASSUNTOS.codigoDeVerificacao,
      blocos: [
        saudacao(null),
        ['Use este código para confirmar o seu e-mail no Bairrin:'],
        [{ destaque: codigo }],
        ['Ele vale por 30 minutos e só pode ser usado uma vez.'],
        ['Se você não criou uma conta no Bairrin, ignore este e-mail.'],
      ],
    });
  }

  override cadastroRepetido({ nome }: { readonly nome: NomeNaSaudacao }): ConteudoDoEmail {
    return montarEmail({
      assunto: ASSUNTOS.cadastroRepetido,
      blocos: [
        saudacao(nome),
        [
          'Alguém tentou criar uma conta no Bairrin com este e-mail, mas ele já tem conta. ',
          'Nada mudou na sua conta.',
        ],
        ['Se foi você, entre no app com este e-mail e a sua senha.'],
        [
          'Se você não lembra a senha, toque em "Esqueci minha senha" na tela de entrar: ',
          'enviaremos um código para este e-mail.',
        ],
        ['Se não foi você, não precisa fazer nada.'],
      ],
    });
  }

  override codigoDeRecuperacao({ nome, codigo }: DadosDoCodigo): ConteudoDoEmail {
    return montarEmail({
      assunto: ASSUNTOS.codigoDeRecuperacao,
      blocos: [
        saudacao(nome),
        ['Use este código para definir uma senha nova no Bairrin:'],
        [{ destaque: codigo }],
        ['Ele vale por 30 minutos e só pode ser usado uma vez.'],
        [
          'Se você não pediu este código, ignore este e-mail. ',
          'Ninguém consegue trocar a sua senha sem ele.',
        ],
      ],
    });
  }

  override exportacaoPronta({
    nome,
    disponivelAte,
  }: {
    readonly nome: NomeNaSaudacao;
    readonly disponivelAte: Date;
  }): ConteudoDoEmail {
    return montarEmail({
      assunto: ASSUNTOS.exportacaoPronta,
      blocos: [
        saudacao(nome),
        ['A cópia dos seus dados que você pediu ao Bairrin está pronta.'],
        [
          'Para baixar, abra o app, entre na sua conta e vá em Privacidade. ',
          'A cópia pode ser baixada uma vez, até ',
          dataEHora(disponivelAte),
          ' (horário de Brasília).',
        ],
        ['Por segurança, a cópia não vem neste e-mail.'],
        [
          'Se não foi você que pediu, troque a sua senha em "Esqueci minha senha", ',
          'na tela de entrar.',
        ],
      ],
    });
  }

  override segundoFatorFreado({
    nome,
    senhaRemovida,
  }: {
    readonly nome: NomeNaSaudacao;
    readonly senhaRemovida: boolean;
  }): ConteudoDoEmail {
    if (senhaRemovida) {
      return montarEmail({
        assunto: ASSUNTOS.senhaRemovida,
        blocos: [
          saudacao(nome),
          [
            'Houve tentativas erradas demais do código do app autenticador ao entrar no ',
            'painel com a sua conta. Por segurança, apagamos a sua senha.',
          ],
          [
            'Para voltar a entrar, use "Esqueci minha senha" na tela de entrar do painel: ',
            'enviaremos um código para este e-mail, e você define uma senha nova.',
          ],
          ['Se não foi você, alguém sabia a sua senha. A senha nova resolve isso.'],
        ],
      });
    }
    return montarEmail({
      assunto: ASSUNTOS.segundoFatorFreado,
      blocos: [
        saudacao(nome),
        [
          'Houve várias tentativas erradas do código do app autenticador ao entrar no ',
          'painel com a sua conta. Por segurança, novas tentativas ficam bloqueadas por ',
          'alguns minutos.',
        ],
        ['Se foi você, espere e tente de novo com o código que o app mostra na hora.'],
        [
          'Se não foi você, alguém sabe a sua senha: troque-a agora em "Esqueci minha ',
          'senha", na tela de entrar do painel.',
        ],
      ],
    });
  }
}
