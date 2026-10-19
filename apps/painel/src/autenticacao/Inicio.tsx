// Área protegida mínima do painel (plano 01b, etapa 15): barra com o logo e "Sair", a conta do
// admin (`GET /v1/admin/conta`, CA-08) e o estado da API. 401 ou 403 da rota protegida levam a P1
// com "Sua sessão terminou" (o cliente já renovou uma vez antes de devolver o 401). Inatividade de
// 30 min, medida só por interação (S9), com aviso 2 min antes; sem polling aqui (um polling futuro
// passa `renovarEm401: false`). Cada interação vai a `registrarInteracao` (renova no servidor e
// avisa as outras abas, R1 e R2). Com o aviso aberto, só "Continuar conectado" retoma (D2); se a
// renovação falhar, o aviso fica e um Banner de erro aparece.
import type { Conta } from '@bairrin/contratos';
import { useEffect, useRef, useState } from 'react';
import { Banner } from '../componentes/Banner.tsx';
import { Botao } from '../componentes/Botao.tsx';
import { EstadoDaApi } from '../EstadoDaApi.tsx';
import { textos } from '../textos/pt-BR.ts';
import type { AutenticacaoDoPainel } from '../sessao/autenticacao-do-painel.ts';
import { classificarFalha } from './erros-da-tela.ts';
import { useInatividade } from '../sessao/inatividade.ts';
import { RegiaoDeStatus } from './RegiaoDeStatus.tsx';
import { LogoBairrin } from './LogoBairrin.tsx';
import { useTituloDaPagina } from './titulo-da-pagina.ts';
import './autenticacao.css';

const t = textos.autenticacao;

export interface InicioProps {
  autenticacao: Pick<
    AutenticacaoDoPainel,
    | 'consultarConta'
    | 'consultarSaude'
    | 'renovarSessao'
    | 'registrarInteracao'
    | 'aoAtividadeEmOutraAba'
  >;
  aoSair: () => void;
  /** 401 ou 403 na rota protegida, inatividade ou renovação recusada: P1 com o aviso. */
  aoTerminarSessao: () => void;
}

type EstadoDaConta = { tipo: 'carregando' } | { tipo: 'pronta'; conta: Conta } | { tipo: 'falhou' };

export function Inicio({ autenticacao, aoSair, aoTerminarSessao }: InicioProps) {
  useTituloDaPagina(t.inicio.titulo);
  const [estado, setEstado] = useState<EstadoDaConta>({ tipo: 'carregando' });
  const [tentativa, setTentativa] = useState(0);
  const [expirando, setExpirando] = useState(false);
  const [renovando, setRenovando] = useState(false);
  /** Falhas de "Continuar conectado"; cada uma remonta o Banner, para ele se anunciar de novo. */
  const [falhasAoContinuar, setFalhasAoContinuar] = useState(0);
  // A função do pai muda a cada renderização; a consulta só se refaz numa nova tentativa.
  const refDoTitulo = useRef<HTMLHeadingElement>(null);
  // O foco chega ao título ao entrar no Início (vinha ficando no `body`).
  useEffect(() => {
    refDoTitulo.current?.focus();
  }, []);
  const terminar = useRef(aoTerminarSessao);
  useEffect(() => {
    terminar.current = aoTerminarSessao;
  });

  const { retomar } = useInatividade({
    ativo: true,
    aoAvisar: () => setExpirando(true),
    aoRetomar: () => {
      setExpirando(false);
      setFalhasAoContinuar(0);
    },
    aoExpirar: aoTerminarSessao,
    aoInteragir: () => {
      void autenticacao.registrarInteracao().then((ativa) => {
        if (!ativa) terminar.current();
      });
    },
    ouvirOutrasAbas: (ouvinte) => autenticacao.aoAtividadeEmOutraAba(ouvinte),
  });

  useEffect(() => {
    const controlador = new AbortController();
    autenticacao.consultarConta({ sinal: controlador.signal }).then(
      (conta) => setEstado({ tipo: 'pronta', conta }),
      (erro: unknown) => {
        if (controlador.signal.aborted) return;
        const falha = classificarFalha(erro);
        if (
          falha.tipo === 'nao_autenticado' ||
          falha.tipo === 'sem_permissao' ||
          falha.tipo === 'sem_acesso_painel'
        ) {
          terminar.current();
          return;
        }
        setEstado({ tipo: 'falhou' });
      },
    );
    return () => controlador.abort();
  }, [autenticacao, tentativa]);

  const tentarDeNovo = () => {
    setEstado({ tipo: 'carregando' });
    setTentativa((anterior) => anterior + 1);
  };

  // "Continuar conectado" renova agora: é a interação que estende a sessão também no servidor. O
  // aviso só sai quando a renovação deu certo.
  const continuarConectado = () => {
    if (renovando) return;
    setRenovando(true);
    autenticacao.renovarSessao().then(
      (sessao) => {
        setRenovando(false);
        if (sessao === null) terminar.current();
        else retomar();
      },
      () => {
        setRenovando(false);
        setFalhasAoContinuar((vez) => vez + 1);
      },
    );
  };

  return (
    <div className="aut-area">
      <header className="aut-barra">
        <LogoBairrin />
        <Botao variante="terciario" onClick={aoSair}>
          {t.sair}
        </Botao>
      </header>
      <main className="pagina">
        {expirando && (
          <div className="aut-aviso-fixo">
            <Banner
              tom="aviso"
              acao={
                <Botao variante="secundario" carregando={renovando} onClick={continuarConectado}>
                  {t.inicio.continuar}
                </Botao>
              }
            >
              {t.inicio.expirando}
            </Banner>
          </div>
        )}
        {expirando && falhasAoContinuar > 0 && (
          <Banner key={falhasAoContinuar} tom="erro">
            {t.inicio.naoContinuou}
          </Banner>
        )}
        <h1 ref={refDoTitulo} tabIndex={-1} className="pagina__titulo">
          {t.inicio.titulo}
        </h1>
        {estado.tipo === 'carregando' && (
          <RegiaoDeStatus className="aut-carregando" texto={t.inicio.carregando} />
        )}
        {estado.tipo === 'pronta' && <p>{t.inicio.conta(estado.conta.emailMascarado)}</p>}
        {estado.tipo === 'falhou' && (
          <Banner
            tom="erro"
            acao={
              <Botao variante="secundario" onClick={tentarDeNovo}>
                {t.tentarDeNovo}
              </Botao>
            }
          >
            {t.aviso.servidor}
          </Banner>
        )}
        <EstadoDaApi cliente={autenticacao} />
      </main>
    </div>
  );
}
