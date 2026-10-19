// Estado da API (CA-F6 do plano 01a): mostra se a API responde. Desde a etapa 15 do 01b, fica na
// área protegida (Início) e na página sem configuração. O cliente chega por propriedade para o
// teste trocar por um falso. `null` = sem endereço (VITE_API_URL).
import { ehErroSemConexao, type ClienteApi } from '@bairrin/cliente-api';
import { useEffect, useState } from 'react';
import { Botao } from './componentes/Botao.tsx';
import { Cartao } from './componentes/Cartao.tsx';
import { textos } from './textos/pt-BR.ts';

type Estado = 'verificando' | 'disponivel' | 'semConexao' | 'erroDaApi';
type Tom = 'neutro' | 'sucesso' | 'aviso' | 'perigo';

interface Apresentacao {
  tom: Tom;
  /** Reforço do texto para quem não distingue cor; escondido do leitor de tela. */
  simbolo: string;
  texto: string;
  dica?: string;
  podeTentarDeNovo: boolean;
}

const t = textos.estadoDaApi;

const apresentacoes: Record<Estado | 'semConfiguracao', Apresentacao> = {
  verificando: { tom: 'neutro', simbolo: '…', texto: t.verificando, podeTentarDeNovo: false },
  disponivel: { tom: 'sucesso', simbolo: '✓', texto: t.disponivel, podeTentarDeNovo: false },
  semConexao: {
    tom: 'aviso',
    simbolo: '!',
    texto: t.semConexao,
    dica: t.semConexaoDica,
    podeTentarDeNovo: true,
  },
  erroDaApi: {
    tom: 'perigo',
    simbolo: '✕',
    texto: t.erroDaApi,
    dica: t.erroDaApiDica,
    podeTentarDeNovo: true,
  },
  semConfiguracao: {
    tom: 'aviso',
    simbolo: '!',
    texto: t.semConfiguracao,
    dica: t.semConfiguracaoDica,
    podeTentarDeNovo: false,
  },
};

export interface EstadoDaApiProps {
  cliente: Pick<ClienteApi, 'consultarSaude'> | null;
}

export function EstadoDaApi({ cliente }: EstadoDaApiProps) {
  const [estado, setEstado] = useState<Estado>('verificando');
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    if (!cliente) return;
    const controlador = new AbortController();
    cliente
      .consultarSaude({ sinal: controlador.signal })
      .then(() => setEstado('disponivel'))
      .catch((erro: unknown) => {
        // Troca de tentativa ou desmontagem: quem cancelou já cuida do estado.
        if (controlador.signal.aborted) return;
        setEstado(ehErroSemConexao(erro) ? 'semConexao' : 'erroDaApi');
      });
    return () => controlador.abort();
  }, [cliente, tentativa]);

  const apresentacao = apresentacoes[cliente ? estado : 'semConfiguracao'];

  // Depois de uma tentativa o botão fica no DOM (e com o foco) enquanto verifica; o resultado é
  // anunciado pela região de status. `aria-disabled` no lugar de `disabled`, que tira o foco.
  const verificandoDeNovo = estado === 'verificando' && tentativa > 0;
  const mostrarBotao = apresentacao.podeTentarDeNovo || (Boolean(cliente) && verificandoDeNovo);

  const tentarDeNovo = () => {
    if (verificandoDeNovo) return;
    setEstado('verificando');
    setTentativa((anterior) => anterior + 1);
  };

  return (
    <Cartao titulo={t.secao} nivelDoTitulo={2}>
      {/* A região existe desde o início, então a troca de texto é anunciada. */}
      <div role="status" className={`estado estado--${apresentacao.tom}`}>
        <span className="estado__simbolo" aria-hidden="true">
          {apresentacao.simbolo}
        </span>
        <div>
          <p className="estado__texto">{apresentacao.texto}</p>
          {apresentacao.dica && <p className="estado__dica">{apresentacao.dica}</p>}
        </div>
      </div>
      {mostrarBotao && (
        <Botao
          variante="secundario"
          carregando={verificandoDeNovo}
          textoCarregando={t.verificandoBotao}
          onClick={tentarDeNovo}
        >
          {t.tentarDeNovo}
        </Botao>
      )}
    </Cartao>
  );
}
