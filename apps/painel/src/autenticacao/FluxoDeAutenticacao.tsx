// Fluxo de autenticação do painel (spec 01: P1 → P1a ou P1b → Início; P1c a partir de P1). Rota
// protegida mínima: a URL não muda durante o login, então depois de entrar a pessoa continua na
// URL em que estava (CA-101). Regras de sessão (plano 01b, etapa 15; S9, S80):
// - ao abrir, `renovarSessao()` pelo cookie; P1 só aparece depois que ela termina (ou depois que
//   `encerrarSessao()` termina, ao sair), para um login novo não correr junto com o logout pelo
//   cookie, que apagaria o cookie da sessão nova;
// - "Sair" usa `encerrarSessao()`; se a API não confirmou, P1 mostra o aviso do S80 com
//   "Tentar de novo" (a sessão local já foi limpa);
// - renovação recusada, 401 ou 403 na rota protegida, 30 min sem interação e o sinal `saiu` de
//   outra aba (R2, S89): P1 com "Sua sessão terminou". O sinal de outra aba não pede logout: a aba
//   que saiu já pediu;
// - 30 min sem interação no passo 3 da P1b (S88): os códigos somem e a sessão é encerrada;
// - o desafio do 2FA e o e-mail digitado ficam só no estado deste componente.
import type { RespostaDeEntrar } from '@bairrin/contratos';
import { useCallback, useEffect, useRef, useState } from 'react';
import { textos } from '../textos/pt-BR.ts';
import type { AutenticacaoDoPainel } from '../sessao/autenticacao-do-painel.ts';
import { ConfigurarSegundoFator } from './ConfigurarSegundoFator.tsx';
import { Entrar, type AvisoDeEntrada } from './Entrar.tsx';
import { Inicio } from './Inicio.tsx';
import { RegiaoDeStatus } from './RegiaoDeStatus.tsx';
import { RecuperarSenha } from './RecuperarSenha.tsx';
import { SegundoFator } from './SegundoFator.tsx';
import './autenticacao.css';

const t = textos.autenticacao;

type Tela =
  | { nome: 'abrindo' }
  | { nome: 'saindo' }
  /** `vez` remonta P1 a cada chegada, com o estado e o aviso novos. */
  | { nome: 'entrar'; email: string; aviso: AvisoDeEntrada | undefined; vez: number }
  | { nome: 'segundoFator'; email: string; desafio: string }
  | { nome: 'configurar'; email: string; desafio: string }
  | { nome: 'recuperar'; email: string }
  | { nome: 'painel' };

export interface FluxoDeAutenticacaoProps {
  autenticacao: AutenticacaoDoPainel;
}

export function FluxoDeAutenticacao({ autenticacao }: FluxoDeAutenticacaoProps) {
  const [tela, setTela] = useState<Tela>({ nome: 'abrindo' });
  const vezes = useRef(0);
  const telaAtual = useRef<Tela['nome']>('abrindo');
  useEffect(() => {
    telaAtual.current = tela.nome;
  });

  const irParaEntrar = useCallback((email: string, aviso?: AvisoDeEntrada) => {
    // Já na hora: um 401 que chega logo depois do aviso de encerramento não sai de novo.
    telaAtual.current = 'entrar';
    vezes.current += 1;
    setTela({ nome: 'entrar', email, aviso, vez: vezes.current });
  }, []);

  // Abertura: o token de acesso só existe em memória, então renova pelo cookie (com logout
  // pendente, o cliente sai primeiro e devolve `null`). Rejeição (rede, 5xx) também leva a P1,
  // com o erro inesperado e "Tentar de novo".
  const abrir = useCallback(
    (ehAtual: () => boolean = () => true) => {
      autenticacao.renovarSessao().then(
        (sessao) => {
          if (!ehAtual()) return;
          if (sessao) setTela({ nome: 'painel' });
          else irParaEntrar('');
        },
        () => {
          if (ehAtual()) irParaEntrar('', 'falhaAoAbrir');
        },
      );
    },
    [autenticacao, irParaEntrar],
  );

  useEffect(() => {
    let atual = true;
    abrir(() => atual);
    return () => {
      atual = false;
    };
  }, [abrir]);

  // Renovação recusada no meio do uso, ou a sessão terminou em outra aba: o cliente (ou a outra
  // aba) já encerrou a sessão; só falta voltar a P1.
  useEffect(
    () =>
      autenticacao.aoEncerrar((motivo) => {
        if (
          (motivo === 'renovacao_recusada' || motivo === 'outra_aba') &&
          telaAtual.current === 'painel'
        ) {
          // A outra aba já pediu o logout: aqui só some o token de acesso da memória, sem DELETE.
          if (motivo === 'outra_aba') autenticacao.descartarSessaoLocal();
          irParaEntrar('', 'sessaoTerminou');
        }
      }),
    [autenticacao, irParaEntrar],
  );

  /** Sai e só depois mostra P1 (corrida do cookie). `terminou`: não foi a pessoa que pediu. */
  const sair = (terminou: boolean) => {
    if (telaAtual.current === 'saindo') return;
    telaAtual.current = 'saindo';
    setTela({ nome: 'saindo' });
    autenticacao.encerrarSessao().then(
      ({ revogadaNoServidor }) =>
        irParaEntrar('', terminou ? 'sessaoTerminou' : revogadaNoServidor ? 'saiu' : 'naoSaiu'),
      () => irParaEntrar('', terminou ? 'sessaoTerminou' : 'naoSaiu'),
    );
  };

  const terminarSessao = () => {
    if (telaAtual.current === 'painel') sair(true);
  };

  const aoEntrar = (resposta: RespostaDeEntrar, email: string) => {
    if ('tokenAcesso' in resposta) return setTela({ nome: 'painel' });
    setTela(
      resposta.etapa === 'configurar'
        ? { nome: 'configurar', email, desafio: resposta.desafio }
        : { nome: 'segundoFator', email, desafio: resposta.desafio },
    );
  };

  switch (tela.nome) {
    case 'abrindo':
    case 'saindo':
      return (
        <div className="ui-cartao-fundo">
          <RegiaoDeStatus
            className="aut-carregando"
            texto={tela.nome === 'abrindo' ? t.abrindo : t.saindo}
          />
        </div>
      );
    case 'entrar': {
      const { aviso } = tela;
      const tentarDeNovo =
        aviso === 'naoSaiu'
          ? () => sair(false)
          : aviso === 'falhaAoAbrir'
            ? () => {
                setTela({ nome: 'abrindo' });
                abrir();
              }
            : undefined;
      return (
        <Entrar
          key={tela.vez}
          autenticacao={autenticacao}
          emailInicial={tela.email}
          avisoInicial={aviso}
          aoTentarDeNovo={tentarDeNovo}
          aoEntrar={aoEntrar}
          aoEsquecerSenha={(email) => setTela({ nome: 'recuperar', email })}
        />
      );
    }
    case 'segundoFator':
      return (
        <SegundoFator
          autenticacao={autenticacao}
          desafio={tela.desafio}
          aoConcluir={() => setTela({ nome: 'painel' })}
          aoVoltar={(aviso) => irParaEntrar(tela.email, aviso)}
        />
      );
    case 'configurar':
      return (
        <ConfigurarSegundoFator
          autenticacao={autenticacao}
          desafio={tela.desafio}
          aoConcluir={() => setTela({ nome: 'painel' })}
          aoVoltar={(aviso) => irParaEntrar(tela.email, aviso)}
          aoSair={(motivo) => sair(motivo === 'inatividade')}
        />
      );
    case 'recuperar':
      return (
        <RecuperarSenha
          autenticacao={autenticacao}
          emailInicial={tela.email}
          aoConcluir={(email) => irParaEntrar(email, 'senhaAlterada')}
          aoVoltar={(email) => irParaEntrar(email)}
        />
      );
    case 'painel':
      return (
        <Inicio
          autenticacao={autenticacao}
          aoSair={() => sair(false)}
          aoTerminarSessao={terminarSessao}
        />
      );
  }
}
