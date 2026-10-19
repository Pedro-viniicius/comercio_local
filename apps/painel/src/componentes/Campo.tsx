// Campo de formulário do painel (design system, "Campos"): rótulo sempre visível, ajuda e erro
// ligados ao `input` por `aria-describedby`, e "Mostrar senha" no tipo senha. A mensagem de erro
// chega pronta (`mensagemDoCampo`): o Campo só a mostra. Ao enviar com erros, quem monta a tela põe
// o foco no primeiro campo inválido e anuncia o total.
import { useId, useState, type ComponentPropsWithRef } from 'react';
import { textos } from '../textos/pt-BR.ts';
import './componentes.css';

export type TipoDoCampo = 'texto' | 'email' | 'senha';

export interface CampoProps extends Omit<ComponentPropsWithRef<'input'>, 'type' | 'children'> {
  /** Sempre visível; nunca só o placeholder. */
  rotulo: string;
  /** Padrão: `texto`. O `autoComplete` certo fica por conta da tela (`current-password` etc.). */
  tipo?: TipoDoCampo;
  /** Texto de ajuda abaixo do campo. */
  ajuda?: string;
  /** Erro do campo: borda e mensagem de perigo, `aria-invalid` e anúncio ao leitor de tela. */
  erro?: string;
}

/** Junta ids para `aria-describedby`, sem repetir nem deixar vazio. */
const juntarIds = (...ids: (string | false | undefined)[]): string | undefined => {
  const lista = ids.flatMap((id) => (id ? id.split(/\s+/) : []));
  return lista.length > 0 ? [...new Set(lista)].join(' ') : undefined;
};

export function Campo({
  rotulo,
  tipo = 'texto',
  ajuda,
  erro,
  id: idDaTela,
  className,
  'aria-describedby': descritoPor,
  ...resto
}: CampoProps) {
  const idGerado = useId();
  const id = idDaTela ?? idGerado;
  const idDaAjuda = `${id}-ajuda`;
  const idDoErro = `${id}-erro`;
  const [senhaVisivel, setSenhaVisivel] = useState(false);
  // Dito só depois da primeira troca: no carregamento da tela não há o que anunciar.
  const [anuncioDaSenha, setAnuncioDaSenha] = useState('');

  const alternarSenha = () => {
    setSenhaVisivel(!senhaVisivel);
    setAnuncioDaSenha(
      senhaVisivel ? textos.componentes.senhaOculta : textos.componentes.senhaVisivel,
    );
  };

  const ehSenha = tipo === 'senha';
  const propriedadesDoTipo: ComponentPropsWithRef<'input'> =
    tipo === 'email'
      ? { type: 'email', inputMode: 'email', autoCapitalize: 'none', spellCheck: false }
      : ehSenha
        ? { type: senhaVisivel ? 'text' : 'password', autoCapitalize: 'none', spellCheck: false }
        : { type: 'text' };

  const classes = ['ui-campo'];
  if (erro) classes.push('ui-campo--erro');
  if (className) classes.push(className);

  return (
    <div className={classes.join(' ')}>
      <label className="ui-campo__rotulo" htmlFor={id}>
        {rotulo}
      </label>
      <div className="ui-campo__caixa">
        <input
          {...propriedadesDoTipo}
          {...resto}
          id={id}
          className={ehSenha ? 'ui-campo__entrada ui-campo__entrada--senha' : 'ui-campo__entrada'}
          aria-invalid={erro ? true : undefined}
          aria-describedby={juntarIds(ajuda && idDaAjuda, erro && idDoErro, descritoPor)}
        />
        {ehSenha && (
          <button type="button" className="ui-campo__alternar" onClick={alternarSenha}>
            {senhaVisivel ? textos.componentes.ocultarSenha : textos.componentes.mostrarSenha}
          </button>
        )}
      </div>
      {ehSenha && (
        <span role="status" className="ui-oculto-visual">
          {anuncioDaSenha}
        </span>
      )}
      {ajuda && (
        <p id={idDaAjuda} className="ui-campo__ajuda">
          {ajuda}
        </p>
      )}
      {/* A região existe sempre, então o erro que aparece depois é anunciado. */}
      <div aria-live="polite">
        {erro && (
          <p id={idDoErro} className="ui-campo__erro">
            <span aria-hidden="true">! </span>
            {erro}
          </p>
        )}
      </div>
    </div>
  );
}
