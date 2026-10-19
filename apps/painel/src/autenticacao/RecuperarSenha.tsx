// P1c. Recuperar senha (spec 01; mesmo fluxo e textos de A4; CA-06, CA-05). Passo 1: o e-mail, com
// resposta sempre igual (202). Passo 2: o código do e-mail e a senha nova, com "Reenviar código"
// liberado depois de 60 s. Código errado, vencido, usado ou no freio dá sempre a mesma mensagem
// ("Peça um novo", `erroPorTela.recuperacaoDeSenha`). Sucesso: P1 com o Banner de senha alterada;
// o 2FA continua exigido no próximo login.
import { redefinirSenhaSchema, solicitarRecuperacaoSchema } from '@bairrin/contratos';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Banner } from '../componentes/Banner.tsx';
import { Botao } from '../componentes/Botao.tsx';
import { Campo } from '../componentes/Campo.tsx';
import { Cartao } from '../componentes/Cartao.tsx';
import { mensagemDoCampo } from '../textos/mensagem-do-campo.ts';
import { textos } from '../textos/pt-BR.ts';
import type { AutenticacaoDoPainel } from '../sessao/autenticacao-do-painel.ts';
import {
  classificarFalha,
  errosParaATela,
  validarLocal,
  type ErrosDosCampos,
} from './erros-da-tela.ts';
import { LogoBairrin } from './LogoBairrin.tsx';
import { useTituloDaPagina } from './titulo-da-pagina.ts';
import './autenticacao.css';

const t = textos.autenticacao;
const r = t.recuperacao;
const TELA = 'recuperacaoDeSenha';
export const ESPERA_DO_REENVIO_S = 60;

type CampoDaRecuperacao = 'email' | 'codigo' | 'novaSenha';
type Aviso = 'servidor' | 'limite';

function formatarEspera(segundos: number): string {
  return `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')}`;
}

export interface RecuperarSenhaProps {
  autenticacao: Pick<AutenticacaoDoPainel, 'solicitarRecuperacao' | 'redefinirSenha'>;
  emailInicial?: string;
  /** Senha trocada: P1 com o e-mail e o Banner de sucesso. */
  aoConcluir: (email: string) => void;
  aoVoltar: (email: string) => void;
}

export function RecuperarSenha({
  autenticacao,
  emailInicial = '',
  aoConcluir,
  aoVoltar,
}: RecuperarSenhaProps) {
  useTituloDaPagina(r.titulo);
  const [passo, setPasso] = useState<1 | 2>(1);
  const [email, setEmail] = useState(emailInicial);
  const [codigo, setCodigo] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [erros, setErros] = useState<ErrosDosCampos<CampoDaRecuperacao>>({});
  const [aviso, setAviso] = useState<{ tipo: Aviso; vez: number } | undefined>();
  const [carregando, setCarregando] = useState(false);
  // Segundos até liberar o reenvio e o instante em que libera (a conta segue o relógio, não o
  // número de disparos: aba em segundo plano atrasa o timer).
  const [espera, setEspera] = useState(0);
  const [liberaEm, setLiberaEm] = useState<number | undefined>();
  const [anuncio, setAnuncio] = useState('');
  const refDoEmail = useRef<HTMLInputElement>(null);
  const refDoCodigo = useRef<HTMLInputElement>(null);
  const refDaNovaSenha = useRef<HTMLInputElement>(null);

  // Contagem do reenvio, em texto; só a liberação é anunciada (spec 01, A3).
  useEffect(() => {
    if (liberaEm === undefined) return;
    const temporizador = setInterval(() => {
      const restante = Math.max(0, Math.ceil((liberaEm - Date.now()) / 1000));
      setEspera(restante);
      if (restante === 0) {
        clearInterval(temporizador);
        setLiberaEm(undefined);
        setAnuncio(r.reenvioLiberado);
      }
    }, 1000);
    return () => clearInterval(temporizador);
  }, [liberaEm]);

  const mostrarAviso = (tipo: Aviso) => {
    setAnuncio('');
    setAviso((anterior) => ({ tipo, vez: (anterior?.vez ?? 0) + 1 }));
  };

  const mostrarErros = (novos: ErrosDosCampos<CampoDaRecuperacao>, ordem: CampoDaRecuperacao[]) => {
    setErros(novos);
    setAnuncio(t.errosNoEnvio(ordem.length));
    const primeiro = ordem[0];
    const ref =
      primeiro === 'email' ? refDoEmail : primeiro === 'codigo' ? refDoCodigo : refDaNovaSenha;
    if (primeiro !== undefined) ref.current?.focus();
  };

  /** `true` se a API aceitou (202). O resultado vai para o Banner ou para o campo de e-mail. */
  const pedirCodigo = async (): Promise<boolean> => {
    const validacao = validarLocal(solicitarRecuperacaoSchema, { email });
    if (!validacao.ok) {
      const { erros: novos, ordem } = errosParaATela(validacao.campos, ['email'] as const);
      mostrarErros(novos, ordem);
      return false;
    }
    setErros({});
    setCarregando(true);
    setAnuncio(t.enviando);
    try {
      await autenticacao.solicitarRecuperacao(validacao.dados);
      setCarregando(false);
      setEspera(ESPERA_DO_REENVIO_S);
      setLiberaEm(Date.now() + ESPERA_DO_REENVIO_S * 1000);
      return true;
    } catch (erro) {
      setCarregando(false);
      const falha = classificarFalha(erro);
      if (falha.tipo === 'campos') {
        const { erros: novos, ordem } = errosParaATela(falha.campos, ['email'] as const);
        if (ordem.length > 0) {
          mostrarErros(novos, ordem);
          return false;
        }
      }
      mostrarAviso(falha.tipo === 'limite' ? 'limite' : 'servidor');
      return false;
    }
  };

  const enviarEmail = async (evento: FormEvent) => {
    evento.preventDefault();
    if (carregando) return;
    setAviso(undefined);
    if (await pedirCodigo()) {
      setAnuncio('');
      setPasso(2);
    }
  };

  const reenviar = async () => {
    if (carregando || espera > 0) return;
    setAviso(undefined);
    if (await pedirCodigo()) setAnuncio(r.reenviado);
  };

  const salvar = async (evento: FormEvent) => {
    evento.preventDefault();
    if (carregando) return;
    setAviso(undefined);
    const visiveis = ['codigo', 'novaSenha'] as const;
    const validacao = validarLocal(redefinirSenhaSchema, { email, codigo, novaSenha });
    if (!validacao.ok) {
      const { erros: novos, ordem, foraDaTela } = errosParaATela(validacao.campos, visiveis, TELA);
      if (ordem.length > 0) mostrarErros(novos, ordem);
      // O e-mail foi conferido no passo 1; se mudou de algum jeito, volta para ele.
      else if (foraDaTela) setPasso(1);
      return;
    }
    setErros({});
    setCarregando(true);
    setAnuncio(t.enviando);
    try {
      await autenticacao.redefinirSenha(validacao.dados);
      aoConcluir(email);
    } catch (erro) {
      setCarregando(false);
      const falha = classificarFalha(erro);
      if (falha.tipo === 'campos') {
        const { erros: novos, ordem } = errosParaATela(falha.campos, visiveis, TELA);
        if (ordem.length > 0) return mostrarErros(novos, ordem);
      }
      if (falha.tipo === 'servidor' || falha.tipo === 'campos') return mostrarAviso('servidor');
      // 401, 403 ou 429: a mesma mensagem do código, sem dizer qual foi o caso (spec 01, A4).
      setCodigo('');
      mostrarErros({ codigo: mensagemDoCampo('codigo', 'invalido', '', TELA) }, ['codigo']);
    }
  };

  return (
    <div className="ui-cartao-fundo">
      <Cartao titulo={r.titulo} cabecalho={<LogoBairrin />}>
        {aviso && (
          <Banner key={aviso.vez} tom="erro">
            {aviso.tipo === 'limite' ? r.limite : t.aviso.servidor}
          </Banner>
        )}

        {passo === 1 ? (
          <>
            <p className="aut-texto">{r.texto}</p>
            <form className="aut-formulario" noValidate onSubmit={(e) => void enviarEmail(e)}>
              <Campo
                ref={refDoEmail}
                rotulo={r.email}
                tipo="email"
                autoComplete="email"
                name="email"
                value={email}
                readOnly={carregando}
                erro={erros.email}
                autoFocus
                onChange={(evento) => setEmail(evento.target.value)}
              />
              <Botao type="submit" larguraTotal carregando={carregando}>
                {r.enviar}
              </Botao>
            </form>
          </>
        ) : (
          <>
            <p className="aut-texto">{r.enviado(email.trim())}</p>
            <form className="aut-formulario" noValidate onSubmit={(e) => void salvar(e)}>
              <Campo
                ref={refDoCodigo}
                className="aut-campo-codigo"
                rotulo={r.codigo}
                name="codigo"
                inputMode="numeric"
                autoComplete="one-time-code"
                spellCheck={false}
                value={codigo}
                readOnly={carregando}
                erro={erros.codigo}
                autoFocus
                onChange={(evento) => setCodigo(evento.target.value)}
              />
              <Campo
                ref={refDaNovaSenha}
                rotulo={r.novaSenha}
                tipo="senha"
                autoComplete="new-password"
                name="novaSenha"
                ajuda={r.novaSenhaAjuda}
                value={novaSenha}
                readOnly={carregando}
                erro={erros.novaSenha}
                onChange={(evento) => setNovaSenha(evento.target.value)}
              />
              <Botao type="submit" larguraTotal carregando={carregando}>
                {r.salvar}
              </Botao>
            </form>
            <div className="aut-links">
              <Botao variante="terciario" disabled={espera > 0} onClick={() => void reenviar()}>
                {espera > 0 ? r.reenviarEm(formatarEspera(espera)) : r.reenviar}
              </Botao>
            </div>
          </>
        )}
        <div className="aut-links">
          <Botao variante="terciario" onClick={() => aoVoltar(email)}>
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
