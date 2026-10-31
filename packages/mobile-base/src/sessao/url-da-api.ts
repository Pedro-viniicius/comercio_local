// Endereço da API dos apps (plano 01b, etapa 12; S125). O valor de `EXPO_PUBLIC_API_URL` é embutido
// no build; fora do modo de desenvolvimento, um endereço sem `https://` levaria o token em texto
// puro pela rede, então conta como "sem configuração" e o app mostra o aviso em vez de chamar a
// API. Em desenvolvimento (`__DEV__`), o `http://` da máquina local continua valendo.

const COM_HTTPS = /^https:\/\/[^/\s?#]+/;

/**
 * O endereço da API, sem espaços nas pontas, ou `null` quando não há configuração válida: vazio,
 * ou sem `https://` fora do desenvolvimento. Quem chama passa `__DEV__`.
 */
export function urlDaApiConfigurada(
  valor: string | undefined,
  emDesenvolvimento: boolean,
): string | null {
  const endereco = valor?.trim() ?? '';
  if (endereco === '') return null;
  if (emDesenvolvimento) return endereco;
  return COM_HTTPS.test(endereco) ? endereco : null;
}
