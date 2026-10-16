// Página mínima do painel: mostra se a API responde. O cliente chega por propriedade (montado em
// `main.tsx` a partir de VITE_API_URL) para o teste trocar por um falso. `null` = sem endereço.
import { ehErroSemConexao, type ClienteApi } from '@bairrin/cliente-api';
import { useEffect, useState } from 'react';
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

export interface AppProps {
  cliente: Pick<ClienteApi, 'consultarSaude'> | null;
}

export default function App({ cliente }: AppProps) {
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
    <main className="pagina">
      <h1 className="pagina__titulo">{t.titulo}</h1>
      <section className="cartao" aria-labelledby="titulo-estado-api">
        <h2 id="titulo-estado-api" className="cartao__titulo">
          {t.secao}
        </h2>
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
          <button
            type="button"
            className="botao"
            aria-disabled={verificandoDeNovo || undefined}
            onClick={tentarDeNovo}
          >
            {verificandoDeNovo ? t.verificandoBotao : t.tentarDeNovo}
          </button>
        )}
      </section>
    </main>
  );
}
