// Tela inicial: estado da API. O endereço de EXPO_PUBLIC_API_URL é embutido no build (não é
// segredo); sem ele, a tela mostra o aviso de configuração. O Babel do Expo só troca o acesso
// literal `process.env.EXPO_PUBLIC_*`, por isso a leitura é escrita assim.
import { criarClienteApi } from '@bairrin/cliente-api';
import { espaco, temaClaro } from '@bairrin/tokens';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { EstadoDaApi } from '../telas/EstadoDaApi.tsx';

function criarCliente() {
  const baseUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
  return baseUrl ? criarClienteApi({ baseUrl }) : null;
}

export default function Inicio() {
  // Um cliente por montagem da tela: `EstadoDaApi` refaz a consulta quando o cliente muda.
  const cliente = useMemo(() => criarCliente(), []);
  return (
    <View style={estilos.tela}>
      <EstadoDaApi cliente={cliente} />
    </View>
  );
}

const estilos = StyleSheet.create({
  tela: { flex: 1, padding: espaco[4], backgroundColor: temaClaro.bg.canvas },
});
