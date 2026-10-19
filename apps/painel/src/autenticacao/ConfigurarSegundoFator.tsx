// P1b. Configurar 2FA (spec 01; CA-09): obrigatório antes de qualquer outra tela do painel, com
// "Sair" no canto do cartão (D4). Passo 1: app autenticador. Passo 2: QR e chave, gerados no
// navegador a partir do `otpauthUri`, e o primeiro código. Passo 3: os códigos de recuperação,
// mostrados uma vez. O segredo, o desenho do QR e os códigos ficam só no estado deste componente:
// nada em `localStorage`, `sessionStorage`, URL ou cache. Erros seguem "Respostas do 2FA": 400 fica
// no campo com o texto próprio desta tela (`configuracaoDoSegundoFator`), 401 e 429 voltam a P1.
// No passo 3 a sessão já existe: "Sair" sem a caixa "Guardei os códigos" marcada pede confirmação
// num Banner em linha (D1, S88), e 30 min sem interação limpam os códigos e encerram a sessão.
import { confirmarConfiguracaoSchema, iniciarConfiguracaoSchema } from '@bairrin/contratos';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Banner } from '../componentes/Banner.tsx';
import { Botao } from '../componentes/Botao.tsx';
import { Campo } from '../componentes/Campo.tsx';
import { Cartao } from '../componentes/Cartao.tsx';
import { IndicadorDePassos } from '../componentes/IndicadorDePassos.tsx';
import { textos } from '../textos/pt-BR.ts';
import type { AutenticacaoDoPainel } from '../sessao/autenticacao-do-painel.ts';
import type { AvisoDeEntrada } from './Entrar.tsx';
import { classificarFalha, errosParaATela, validarLocal, type Falha } from './erros-da-tela.ts';
import { LogoBairrin } from './LogoBairrin.tsx';
import {
  agruparDeQuatro,
  desenharQr,
  ehUriDoAutenticador,
  formatarCodigoDeRecuperacao,
  soletrar,
  type DesenhoDoQr,
} from './qr.ts';
import { QrCodeDoAutenticador } from './QrCodeDoAutenticador.tsx';
import { useInatividade } from '../sessao/inatividade.ts';
import { useTituloDaPagina } from './titulo-da-pagina.ts';
import './autenticacao.css';

const t = textos.autenticacao;
const c = t.configuracao;
/** Texto próprio do passo 2 em `textos.erroPorTela` (o mesmo `codigo.invalido` de P1a). */
const TELA = 'configuracaoDoSegundoFator';
const TOTAL_DE_PASSOS = 3;
/**
 * Espera antes de soltar o endereço `blob:` do arquivo dos códigos (R5): soltar no mesmo instante
 * pode cancelar o download em alguns navegadores.
 */
export const ATRASO_PARA_SOLTAR_O_ARQUIVO_MS = 1_000;

export interface ConfigurarSegundoFatorProps {
  autenticacao: Pick<
    AutenticacaoDoPainel,
    'iniciarConfiguracao' | 'confirmarConfiguracao' | 'registrarInteracao' | 'aoAtividadeEmOutraAba'
  >;
  desafio: string;
  /** "Concluir e entrar": a sessão já foi guardada na confirmação. */
  aoConcluir: () => void;
  /** Volta a P1 com o e-mail: `desafioVencido` no 401, `credenciais` no 429. */
  aoVoltar: (aviso: AvisoDeEntrada) => void;
  /** "Sair" (confirmado no passo 3) ou, com `inatividade`, 30 min parado no passo 3 (S88). */
  aoSair: (motivo?: 'inatividade') => void;
}

interface Chave {
  desenho: DesenhoDoQr;
  grupos: string[];
}

async function copiar(texto: string): Promise<void> {
  // `navigator.clipboard` só existe em contexto seguro (HTTPS ou localhost).
  if (!('clipboard' in navigator)) throw new Error('Área de transferência indisponível');
  await navigator.clipboard.writeText(texto);
}

function baixarTexto(conteudo: string, nomeDoArquivo: string): void {
  const url = URL.createObjectURL(new Blob([conteudo], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = nomeDoArquivo;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // O download já começou; o endereço `blob:` sai logo depois (R5).
  setTimeout(() => URL.revokeObjectURL(url), ATRASO_PARA_SOLTAR_O_ARQUIVO_MS);
}

export function ConfigurarSegundoFator({
  autenticacao,
  desafio,
  aoConcluir,
  aoVoltar,
  aoSair,
}: ConfigurarSegundoFatorProps) {
  useTituloDaPagina(c.titulo);
  const [passo, setPasso] = useState(1);
  const [chave, setChave] = useState<Chave | undefined>();
  const [codigos, setCodigos] = useState<string[]>([]);
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState<string | undefined>();
  const [falhaInesperada, setFalhaInesperada] = useState(0);
  const [carregando, setCarregando] = useState(false);
  const [guardou, setGuardou] = useState(false);
  const [confirmandoSaida, setConfirmandoSaida] = useState(false);
  const [anuncio, setAnuncio] = useState('');
  const refDoTitulo = useRef<HTMLHeadingElement>(null);
  const refDoCodigo = useRef<HTMLInputElement>(null);
  const refDoVoltarAosCodigos = useRef<HTMLButtonElement>(null);

  // Passo 3 (S88): a sessão já existe e os códigos estão na tela. Sem interação por 30 min, os
  // códigos saem do estado e a sessão é encerrada.
  useInatividade({
    ativo: passo === 3,
    // Sem aviso na tela (R8): toda interação conta até o fim dos 30 min.
    comAviso: false,
    aoAvisar: () => undefined,
    aoRetomar: () => undefined,
    aoExpirar: () => {
      setCodigos([]);
      aoSair('inatividade');
    },
    aoInteragir: () => void autenticacao.registrarInteracao(),
    // R10: a aba parada no passo 3 não encerra a sessão de outra aba em uso.
    ouvirOutrasAbas: (ouvinte) => autenticacao.aoAtividadeEmOutraAba(ouvinte),
  });

  // A confirmação de saída abre com o foco no botão seguro (D1).
  useEffect(() => {
    if (confirmandoSaida) refDoVoltarAosCodigos.current?.focus();
  }, [confirmandoSaida]);

  // Ao trocar de passo, o foco vai ao título do passo (o botão de antes some).
  useEffect(() => {
    if (passo > 1) refDoTitulo.current?.focus();
  }, [passo]);

  // Passo 3: os códigos não aparecem de novo; sair da página pede confirmação do navegador.
  useEffect(() => {
    if (passo !== 3) return;
    const aoSairDaPagina = (evento: BeforeUnloadEvent) => evento.preventDefault();
    window.addEventListener('beforeunload', aoSairDaPagina);
    return () => window.removeEventListener('beforeunload', aoSairDaPagina);
  }, [passo]);

  const mostrarFalhaInesperada = () => {
    setAnuncio('');
    setFalhaInesperada((vez) => vez + 1);
  };

  /** 401 (desafio vencido, usado ou esgotado) e 429 voltam a P1; `true` se voltou. */
  const voltouParaEntrar = (falha: Falha): boolean => {
    if (falha.tipo === 'nao_autenticado') aoVoltar('desafioVencido');
    else if (falha.tipo === 'limite') aoVoltar('credenciais');
    else return false;
    return true;
  };

  const continuar = async () => {
    if (carregando) return;
    const validacao = validarLocal(iniciarConfiguracaoSchema, { desafio });
    if (!validacao.ok) return aoVoltar('desafioVencido');
    setFalhaInesperada(0);
    setCarregando(true);
    setAnuncio(t.enviando);
    try {
      const { otpauthUri, segredoBase32 } = await autenticacao.iniciarConfiguracao(validacao.dados);
      // Fora do contrato (não é TOTP, ou não cabe num QR): erro inesperado, sem mostrar o valor.
      if (!ehUriDoAutenticador(otpauthUri)) throw new Error('URI fora do formato');
      setChave({ desenho: desenharQr(otpauthUri), grupos: agruparDeQuatro(segredoBase32) });
      setCarregando(false);
      setAnuncio('');
      setPasso(2);
    } catch (falhaDaApi) {
      setCarregando(false);
      const falha = classificarFalha(falhaDaApi);
      // 400 aqui só pode ser o desafio fora do formato: não há o que corrigir nesta tela.
      if (falha.tipo === 'campos') return aoVoltar('desafioVencido');
      if (!voltouParaEntrar(falha)) mostrarFalhaInesperada();
    }
  };

  const mostrarErroDoCodigo = (texto: string) => {
    setErro(texto);
    setAnuncio(t.errosNoEnvio(1));
    refDoCodigo.current?.focus();
  };

  const confirmar = async (evento: FormEvent) => {
    evento.preventDefault();
    if (carregando) return;
    setFalhaInesperada(0);
    const validacao = validarLocal(confirmarConfiguracaoSchema, { desafio, codigo });
    if (!validacao.ok) {
      const { erros, foraDaTela } = errosParaATela(validacao.campos, ['codigo'], TELA);
      if (erros.codigo !== undefined) mostrarErroDoCodigo(erros.codigo);
      else if (foraDaTela) aoVoltar('desafioVencido');
      return;
    }
    setErro(undefined);
    setCarregando(true);
    setAnuncio(t.enviando);
    try {
      const resposta = await autenticacao.confirmarConfiguracao(validacao.dados);
      setCodigos(resposta.codigosRecuperacao.map(formatarCodigoDeRecuperacao));
      // O segredo não serve mais para nada: sai do estado assim que o app confirmou.
      setChave(undefined);
      setCodigo('');
      setCarregando(false);
      setAnuncio('');
      setPasso(3);
    } catch (falhaDaApi) {
      setCarregando(false);
      const falha = classificarFalha(falhaDaApi);
      if (voltouParaEntrar(falha)) return;
      if (falha.tipo === 'campos') {
        const { erros } = errosParaATela(falha.campos, ['codigo'], TELA);
        if (erros.codigo !== undefined) return mostrarErroDoCodigo(erros.codigo);
      }
      mostrarFalhaInesperada();
    }
  };

  const copiarComAnuncio = (texto: string, sucesso: string) => {
    copiar(texto).then(
      () => setAnuncio(sucesso),
      () => setAnuncio(c.naoCopiou),
    );
  };

  const baixarCodigos = () => {
    baixarTexto(
      [c.passo3.cabecalhoDoArquivo, '', ...codigos, ''].join('\n'),
      c.passo3.nomeDoArquivo,
    );
    setAnuncio(c.passo3.baixado);
  };

  // D1: no passo 3, sem a caixa marcada, "Sair" perderia os códigos, que não aparecem de novo.
  const pedirSaida = () => {
    if (passo !== 3 || guardou) return aoSair();
    if (confirmandoSaida) refDoVoltarAosCodigos.current?.focus();
    else setConfirmandoSaida(true);
  };

  const voltarAosCodigos = () => {
    setConfirmandoSaida(false);
    refDoTitulo.current?.focus();
  };

  const sairSemGuardar = () => {
    setCodigos([]);
    aoSair();
  };

  const titulosDosPassos = [c.passo1.titulo, c.passo2.titulo, c.passo3.titulo];
  const cabecalho = (
    <>
      <LogoBairrin />
      <Botao variante="terciario" onClick={pedirSaida}>
        {t.sair}
      </Botao>
    </>
  );

  return (
    <div className="ui-cartao-fundo">
      <Cartao titulo={c.titulo} cabecalho={cabecalho}>
        <IndicadorDePassos
          passo={passo}
          total={TOTAL_DE_PASSOS}
          titulo={titulosDosPassos[passo - 1] ?? c.passo1.titulo}
          refDoTitulo={refDoTitulo}
        />
        {passo === 3 && confirmandoSaida && (
          <Banner
            tom="aviso"
            titulo={c.passo3.confirmarSaida.titulo}
            acao={
              <>
                <Botao ref={refDoVoltarAosCodigos} variante="secundario" onClick={voltarAosCodigos}>
                  {c.passo3.confirmarSaida.voltar}
                </Botao>
                <Botao variante="destrutivo" onClick={sairSemGuardar}>
                  {c.passo3.confirmarSaida.sair}
                </Botao>
              </>
            }
          >
            {c.passo3.confirmarSaida.texto}
          </Banner>
        )}
        {falhaInesperada > 0 && (
          <Banner key={falhaInesperada} tom="erro">
            {t.aviso.servidor}
          </Banner>
        )}

        {passo === 1 && (
          <>
            <p className="aut-texto">{c.passo1.texto}</p>
            <p className="aut-texto">{c.prazo}</p>
            <Botao larguraTotal carregando={carregando} onClick={() => void continuar()}>
              {c.passo1.botao}
            </Botao>
          </>
        )}

        {passo === 2 && chave && (
          <>
            <p className="aut-texto">{c.passo2.prazo}</p>
            <QrCodeDoAutenticador desenho={chave.desenho} rotulo={c.passo2.qr} />
            <p className="aut-texto">{c.passo2.semEscanear}</p>
            <p className="aut-chave">
              <span aria-hidden="true">{chave.grupos.join(' ')}</span>
              <span className="ui-oculto-visual">{soletrar(chave.grupos)}</span>
            </p>
            <div className="aut-acoes">
              <Botao
                variante="secundario"
                onClick={() => copiarComAnuncio(chave.grupos.join(''), c.passo2.chaveCopiada)}
              >
                {c.passo2.copiarChave}
              </Botao>
            </div>
            <form
              className="aut-formulario"
              noValidate
              onSubmit={(evento) => void confirmar(evento)}
            >
              <Campo
                ref={refDoCodigo}
                className="aut-campo-codigo"
                rotulo={c.passo2.codigo}
                name="codigo"
                inputMode="numeric"
                autoComplete="one-time-code"
                spellCheck={false}
                value={codigo}
                readOnly={carregando}
                erro={erro}
                onChange={(evento) => setCodigo(evento.target.value)}
              />
              <Botao type="submit" larguraTotal carregando={carregando}>
                {c.passo2.botao}
              </Botao>
            </form>
          </>
        )}

        {passo === 3 && (
          <>
            <Banner tom="aviso">{c.passo3.aviso}</Banner>
            <ul className="aut-codigos" aria-label={c.passo3.lista}>
              {codigos.map((item, indice) => (
                <li key={`${indice}-${item}`}>
                  <span aria-hidden="true">{item}</span>
                  <span className="ui-oculto-visual">{soletrar(item.split('-'))}</span>
                </li>
              ))}
            </ul>
            <div className="aut-acoes">
              <Botao
                variante="secundario"
                onClick={() => copiarComAnuncio(codigos.join('\n'), c.passo3.copiados)}
              >
                {c.passo3.copiarTodos}
              </Botao>
              <Botao variante="secundario" onClick={baixarCodigos}>
                {c.passo3.baixar}
              </Botao>
            </div>
            <label className="aut-caixa">
              <input
                type="checkbox"
                checked={guardou}
                onChange={(evento) => setGuardou(evento.target.checked)}
              />
              <span>{c.passo3.guardei}</span>
            </label>
            <Botao larguraTotal disabled={!guardou} onClick={aoConcluir}>
              {c.passo3.botao}
            </Botao>
          </>
        )}

        <p role="status" className="ui-oculto-visual">
          {anuncio}
        </p>
      </Cartao>
    </div>
  );
}
