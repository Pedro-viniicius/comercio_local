// P1a. Segundo fator (spec 01; CA-09). Código de 6 dígitos do app autenticador ou um código de
// recuperação. Segue "Respostas do 2FA" do plano 01b: 400 fica na tela com o erro no campo
// (`mensagemDoCampo` sem tela); 401 volta a P1 com o e-mail e o aviso de desafio vencido; 429 volta
// a P1 com o Banner genérico (CA-04). Qualquer outro status mostra o erro inesperado e fica aqui.
import { verificarSegundoFatorSchema } from '@bairrin/contratos';
import { useRef, useState, type FormEvent } from 'react';
import { Banner } from '../componentes/Banner.tsx';
import { Botao } from '../componentes/Botao.tsx';
import { Campo } from '../componentes/Campo.tsx';
import { Cartao } from '../componentes/Cartao.tsx';
import { textos } from '../textos/pt-BR.ts';
import type { AutenticacaoDoPainel } from '../sessao/autenticacao-do-painel.ts';
import type { AvisoDeEntrada } from './Entrar.tsx';
import { classificarFalha, errosParaATela, validarLocal } from './erros-da-tela.ts';
import { LogoBairrin } from './LogoBairrin.tsx';
import { useTituloDaPagina } from './titulo-da-pagina.ts';
import './autenticacao.css';

const t = textos.autenticacao;
const SEIS_DIGITOS = /^[0-9]{6}$/;

type Modo = 'codigo' | 'codigoRecuperacao';

export interface SegundoFatorProps {
  autenticacao: Pick<AutenticacaoDoPainel, 'verificarSegundoFator'>;
  desafio: string;
  aoConcluir: () => void;
  /** Volta a P1 (com o e-mail): `desafioVencido` no 401, `credenciais` no 429, nada em "Voltar". */
  aoVoltar: (aviso?: AvisoDeEntrada) => void;
}

export function SegundoFator({ autenticacao, desafio, aoConcluir, aoVoltar }: SegundoFatorProps) {
  useTituloDaPagina(t.segundoFator.titulo);
  const [modo, setModo] = useState<Modo>('codigo');
  const [valores, setValores] = useState<Record<Modo, string>>({
    codigo: '',
    codigoRecuperacao: '',
  });
  const [erro, setErro] = useState<string | undefined>();
  const [falhaInesperada, setFalhaInesperada] = useState(0);
  const [carregando, setCarregando] = useState(false);
  const [anuncio, setAnuncio] = useState('');
  const refDoCampo = useRef<HTMLInputElement>(null);
  // O envio automático e o clique podem chegar juntos: só um vai.
  const enviando = useRef(false);

  const mostrarErro = (texto: string) => {
    setErro(texto);
    setAnuncio(t.errosNoEnvio(1));
    refDoCampo.current?.focus();
  };

  const enviar = async (valor: string) => {
    if (enviando.current) return;
    setFalhaInesperada(0);
    const corpo =
      modo === 'codigo' ? { desafio, codigo: valor } : { desafio, codigoRecuperacao: valor };
    const validacao = validarLocal(verificarSegundoFatorSchema, corpo);
    if (!validacao.ok) {
      const { erros, foraDaTela } = errosParaATela(validacao.campos, [modo]);
      const texto = erros[modo];
      if (texto !== undefined) mostrarErro(texto);
      // Desafio fora do formato: não há o que digitar aqui, só entrar de novo.
      else if (foraDaTela) aoVoltar('desafioVencido');
      return;
    }
    enviando.current = true;
    setErro(undefined);
    setCarregando(true);
    setAnuncio(t.enviando);
    try {
      await autenticacao.verificarSegundoFator(validacao.dados);
      aoConcluir();
    } catch (falhaDaApi) {
      enviando.current = false;
      setCarregando(false);
      const falha = classificarFalha(falhaDaApi);
      if (falha.tipo === 'nao_autenticado') return aoVoltar('desafioVencido');
      if (falha.tipo === 'limite') return aoVoltar('credenciais');
      if (falha.tipo === 'campos') {
        const { erros } = errosParaATela(falha.campos, [modo]);
        const texto = erros[modo];
        if (texto !== undefined) return mostrarErro(texto);
      }
      setAnuncio('');
      setFalhaInesperada((vez) => vez + 1);
    }
  };

  const aoEnviar = (evento: FormEvent) => {
    evento.preventDefault();
    void enviar(valores[modo]);
  };

  const aoDigitar = (novo: string) => {
    const anterior = valores[modo];
    setValores((atuais) => ({ ...atuais, [modo]: novo }));
    // Envia sozinho ao completar os 6 dígitos (wireframe P1); o botão continua disponível. Um
    // código completo diferente colado por cima do anterior (recusado) também envia (Q23).
    const semEspacos = (texto: string) => texto.replaceAll(/\s/g, '');
    const completou = (texto: string) => SEIS_DIGITOS.test(semEspacos(texto));
    const outroCodigo = !completou(anterior) || semEspacos(novo) !== semEspacos(anterior);
    if (modo === 'codigo' && completou(novo) && outroCodigo) void enviar(novo);
  };

  const trocarModo = () => {
    setModo((atual) => (atual === 'codigo' ? 'codigoRecuperacao' : 'codigo'));
    setErro(undefined);
    setFalhaInesperada(0);
  };

  const ehCodigo = modo === 'codigo';
  return (
    <div className="ui-cartao-fundo">
      <Cartao titulo={t.segundoFator.titulo} cabecalho={<LogoBairrin />}>
        {falhaInesperada > 0 && (
          <Banner key={falhaInesperada} tom="erro">
            {t.aviso.servidor}
          </Banner>
        )}
        <p className="aut-texto">
          {ehCodigo ? t.segundoFator.instrucao : t.segundoFator.instrucaoRecuperacao}{' '}
          {t.segundoFator.prazo}
        </p>
        <form className="aut-formulario" noValidate onSubmit={aoEnviar}>
          <Campo
            // Trocar de modo monta o outro campo, com o foco nele.
            key={modo}
            ref={refDoCampo}
            className={ehCodigo ? 'aut-campo-codigo' : undefined}
            rotulo={ehCodigo ? t.segundoFator.codigo : t.segundoFator.codigoRecuperacao}
            name={modo}
            inputMode={ehCodigo ? 'numeric' : 'text'}
            autoComplete={ehCodigo ? 'one-time-code' : 'off'}
            autoCapitalize={ehCodigo ? undefined : 'characters'}
            spellCheck={false}
            value={valores[modo]}
            readOnly={carregando}
            erro={erro}
            autoFocus
            onChange={(evento) => aoDigitar(evento.target.value)}
          />
          <Botao type="submit" larguraTotal carregando={carregando}>
            {t.segundoFator.botao}
          </Botao>
        </form>
        <div className="aut-links">
          <Botao variante="terciario" onClick={trocarModo}>
            {ehCodigo ? t.segundoFator.usarRecuperacao : t.segundoFator.usarApp}
          </Botao>
          <Botao variante="terciario" onClick={() => aoVoltar()}>
            {t.voltarParaEntrar}
          </Botao>
        </div>
        <p role="status" className="ui-oculto-visual">
          {anuncio}
        </p>
      </Cartao>
    </div>
  );
}
